import { NextResponse } from 'next/server';
import Replicate from 'replicate';
import { GoogleGenerativeAI } from '@google/generative-ai';
import path from 'node:path';
import { persistGeneratedStream } from '@/lib/generated-assets';
import { getGeminiModelId } from '@/lib/gemini';
import { generateAtmosphere, generateSpeech } from '@/lib/audio-service';
import { CINEMATIC_VISUAL_SUFFIX } from '@/lib/constants';
import { buildFluxActionPrompt, isActionLikePrompt } from '@/lib/flux-action-prompts';
import { SFX_QUALITY_SUFFIX, VOICE_CAST } from '@/lib/voice-constants';
import { mixVideoWithDucking } from '@/lib/videoProcessor';
import { runVeoImageToVideo } from '@/lib/veo-client';
import { readPersonas, type PersonaRecord } from '@/lib/persona-registry';
import { ensurePromptHasTriggers, uniqStrings, withDownloadTrue } from '@/lib/lora-utils';
import { isSensitiveFlag, softenVeoPrompt } from '@/lib/video-generation-safety';
import { generateXaiVideo } from '@/lib/xai-video';
import { getConfiguredSiteUrl } from '@/lib/site-url';
const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
  fetch: (url, options) => fetch(url, { ...(options as RequestInit), timeout: 300000 } as any),
});

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

const safeTrim = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

const isReadableStream = (value: any): value is ReadableStream => {
  return value && typeof value.getReader === 'function';
};

const findFirstStream = (output: any): ReadableStream | null => {
  if (!output) return null;
  if (isReadableStream(output)) return output;
  if (Array.isArray(output)) {
    for (const item of output) {
      const found = findFirstStream(item);
      if (found) return found;
    }
    return null;
  }
  if (typeof output === 'object') {
    for (const value of Object.values(output)) {
      const found = findFirstStream(value);
      if (found) return found;
    }
  }
  return null;
};

const saveStreamToPublic = async (stream: ReadableStream, extension: string): Promise<string> =>
  persistGeneratedStream(stream, {
    prefix: extension === 'mp4' ? 'generated/videos' : 'generated/images',
    suggestedName: `video-generate.${extension}`,
    contentType: extension === 'mp4' ? 'video/mp4' : 'image/png',
  });

const toBase64 = (buffer: ArrayBuffer) => Buffer.from(buffer).toString('base64');

const getImageInlineData = async (url: string) => {
  const absolute = ensureAbsoluteUrl(url);
  const isReplicateFile = absolute.includes('api.replicate.com/v1/files/');
  const resolved = isReplicateFile
    ? await resolveReplicateFileUrl(absolute, process.env.REPLICATE_API_TOKEN || '')
    : absolute;
  const response = await fetch(resolved);
  if (!response.ok) {
    if (isReplicateFile) {
      const token = process.env.REPLICATE_API_TOKEN || '';
      if (!token) {
        throw new Error(`Failed to fetch image for analysis: ${response.status}`);
      }
      const fileResponse = await fetch(absolute, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!fileResponse.ok) {
        throw new Error(`Failed to fetch image for analysis: ${response.status}`);
      }
      const arrayBuffer = await fileResponse.arrayBuffer();
      const mimeType = fileResponse.headers.get('content-type') || 'image/jpeg';
      return { data: toBase64(arrayBuffer), mimeType };
    }
    throw new Error(`Failed to fetch image for analysis: ${response.status}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  const mimeType = response.headers.get('content-type') || 'image/jpeg';
  return {
    data: toBase64(arrayBuffer),
    mimeType,
  };
};

const analyzeImageWithGemini = async (imageUrl: string, plan: {
  voice_category?: string;
  speech_text?: string;
  sfx_prompt?: string;
  audio_environment?: string;
  is_action_scene?: boolean;
  voice_settings?: Record<string, unknown>;
}) => {
  if (!process.env.GEMINI_API_KEY) return null;
  const preferredModel = 'gemini-2.5-flash';
  const resolvedModel = await getGeminiModelId(process.env.GEMINI_API_KEY, preferredModel);
  const model = genAI.getGenerativeModel({ model: resolvedModel, generationConfig: { temperature: 0.4 } });
  let inlineData: { data: string; mimeType: string } | null = null;
  try {
    inlineData = await getImageInlineData(imageUrl);
  } catch (error) {
    console.warn('⚠️ Image analysis fetch failed, skipping vision refinement.', error);
    return null;
  }
  const analysisPrompt = `
You are an elite casting director and sound designer. Analyze the IMAGE and refine the audio plan.
Pick the best voice category and audio environment based on the visual cues in the image.
Return ONLY JSON:
{
  "gender": "male | female | unknown",
  "voice_category": "male_villain | male_heroic | male_soft_calm | male_aggressive | female_seductive | female_news_anchor | female_scared",
  "voice_settings": {"stability": 0.1-0.9, "similarity_boost": 0.75, "style": 0.0-1.0, "use_speaker_boost": true},
  "audio_environment": "studio | cave | large_hall | bathroom | forest_outdoor",
  "sfx_prompt": "Refined SFX prompt including Foley if action",
  "speech_text": "Only adjust if needed to match facial expression",
  "is_action_scene": true | false
}
If you are unsure, keep values close to the provided plan.
Current plan:
${JSON.stringify(plan)}
`;
  const result = await model.generateContent([
    { text: analysisPrompt },
    { inlineData },
  ]);
  const raw = result.response.text().trim();
  return extractSceneJson(raw);
};

const extractImageUrl = (output: any): string => {
  if (!output) return '';
  if (typeof output === 'string') return output.includes('://') ? output : '';
  if (Array.isArray(output)) {
    for (const item of output) {
      const found = extractImageUrl(item);
      if (found) return found;
    }
    return '';
  }
  if (typeof output === 'object') {
    for (const value of Object.values(output)) {
      const found = extractImageUrl(value);
      if (found) return found;
    }
  }
  return '';
};

const extractSceneJson = (raw: string) => {
  const cleaned = raw.trim().replace(/^```[a-zA-Z]*\n?/, '').replace(/```$/, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : null;
  }
};

const resolveIntentMode = (raw: unknown, isActionScene: boolean) => {
  const normalized = typeof raw === 'string' ? raw.trim().toUpperCase() : '';
  if (normalized === 'ACTION_MODE' || normalized === 'TALKING_MODE') {
    return normalized;
  }
  return isActionScene ? 'ACTION_MODE' : 'TALKING_MODE';
};

const HARD_VIOLENCE_PATTERNS: RegExp[] = [
  /\b(gore|gory|dismember|decapitat|behead|execution|massacre|torture)\b/i,
  /\b(kill|killing|murder|stab|stabbing|strangle|shoot|headshot)\b/i,
  /\b(blood|bloody|bleeding|gut|organs?)\b/i,
];

const SOFT_ACTION_PATTERNS: RegExp[] = [
  /\b(action|cinematic|stunt|choreograph|fight|battle|impact|explosion|motion blur|kinetic)\b/i,
  /\b(superhero|cape|tracking shot|low-angle|dramatic lighting)\b/i,
];

const containsHardViolence = (text: string) => {
  if (!text) return false;
  return HARD_VIOLENCE_PATTERNS.some(pattern => pattern.test(text));
};

const containsSoftAction = (text: string) => {
  if (!text) return false;
  return SOFT_ACTION_PATTERNS.some(pattern => pattern.test(text));
};

const isRateLimit = (error: any) => {
  const message = String(error?.message || error || '').toLowerCase();
  return message.includes('429') || message.includes('resource_exhausted') || message.includes('rate limit');
};

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));


const resolveReplicateFileUrl = async (apiUrl: string, token: string): Promise<string> => {
  if (!apiUrl.includes('api.replicate.com/v1/files/')) return apiUrl;
  const fileResponse = await fetch(apiUrl, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const fileText = await fileResponse.text();
  if (!fileResponse.ok) {
    throw new Error(`Replicate file lookup failed: ${fileResponse.status} ${fileText}`);
  }
  const filePayload = fileText ? JSON.parse(fileText) : null;
  const fileSignedUrl = filePayload?.urls?.get || filePayload?.urls?.original;
  const fileServingUrl = filePayload?.serving_url;
  if (typeof fileServingUrl === 'string' && fileServingUrl.includes('://') && !fileServingUrl.includes('api.replicate.com/v1/files/')) {
    return fileServingUrl;
  }
  if (typeof fileSignedUrl === 'string' && fileSignedUrl.includes('://') && !fileSignedUrl.includes('api.replicate.com/v1/files/')) {
    return fileSignedUrl;
  }
  if (typeof fileServingUrl === 'string' && fileServingUrl.includes('://')) {
    return fileServingUrl;
  }
  if (typeof fileSignedUrl === 'string' && fileSignedUrl.includes('://')) {
    return fileSignedUrl;
  }
  throw new Error(`Replicate file lookup returned no signed URL. Payload: ${fileText}`);
};

const normalizeReplicateAssetUrl = async (url: string) => {
  if (url && url.includes('api.replicate.com/v1/files/')) {
    return await resolveReplicateFileUrl(url, process.env.REPLICATE_API_TOKEN || '');
  }
  return url;
};

const resolveReplicatePublicUrl = async (url: string) => {
  if (!url) return url;
  if (url.includes('api.replicate.com/v1/files/')) {
    return await resolveReplicateFileUrl(url, process.env.REPLICATE_API_TOKEN || '');
  }
  return url;
};

const resolveBaseUrl = () => getConfiguredSiteUrl();

const ensureAbsoluteUrl = (url: string) => {
  if (!url) return url;
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  if (url.startsWith('/')) return `${resolveBaseUrl()}${url}`;
  return url;
};

const uploadUrlToReplicate = async (url: string, filename: string, contentType: string) => {
  const token = process.env.REPLICATE_API_TOKEN || '';
  if (!token) {
    throw new Error('REPLICATE_API_TOKEN not configured');
  }
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch asset for upload: ${response.status}`);
  }
  const buffer = await response.arrayBuffer();
  const blob = new Blob([buffer], { type: contentType });
  const form = new FormData();
  form.append('content', blob, filename);
  const upload = await fetch('https://api.replicate.com/v1/files', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const text = await upload.text();
  if (!upload.ok) {
    throw new Error(`Replicate upload failed: ${upload.status} ${text}`);
  }
  let payload: any = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }
  const servingUrl = payload?.serving_url;
  const signedUrl = payload?.urls?.get || payload?.urls?.original;
  const apiUrl = payload?.url;
  const candidateUrl = typeof signedUrl === 'string' && signedUrl.includes('://')
    ? signedUrl
    : typeof servingUrl === 'string' && servingUrl.includes('://')
      ? servingUrl
      : typeof apiUrl === 'string' && apiUrl.includes('://')
        ? apiUrl
        : '';
  if (!candidateUrl) {
    throw new Error(`Replicate upload returned no URL. Payload: ${text}`);
  }
  return await resolveReplicatePublicUrl(candidateUrl);
};

const ensureReplicateUri = async (url: string, filename: string, contentType: string) => {
  if (!url) return url;
  const absolute = ensureAbsoluteUrl(url);
  const isLocal = absolute.includes('localhost') || absolute.includes('127.0.0.1') || absolute.includes('0.0.0.0');
  if (isLocal || absolute.startsWith('/')) {
    return await uploadUrlToReplicate(absolute, filename, contentType);
  }
  return await resolveReplicatePublicUrl(absolute);
};

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      userPrompt,
      prompt,
      personaModelId,
      personaTriggerWord,
      voiceId,
      personaIds,
      personas,
    } = body || {};

    const inputPrompt = (userPrompt || prompt || '').toString().trim();
    if (!inputPrompt) {
      throw new Error('Prompt is required.');
    }

    const sanitizePrompt = (text: string) => (
      text
        .replace(/\bblood\b/gi, 'red cinematic lighting, crimson fluid, dark liquid')
        .replace(/\bbrutal kill\b/gi, 'high stakes combat, neutralizing threat, intense action choreography')
        .replace(/\bbone cracking\b/gi, 'heavy impact sound, deep thud, physical collision')
        .replace(/\bkill\b/gi, 'neutralize opponent, final strike, dramatic ending')
        .replace(/\bbreak bones\b/gi, 'heavy impact, brutal physics, martial arts choreography')
    );
    const softenPrompt = (text: string) => (
      text
        .replace(/\bfight scene\b/gi, 'intense action sequence')
        .replace(/\bviolence\b/gi, 'high stakes action')
        .replace(/\bgore\b/gi, 'dramatic tension')
    );
    const safeUserIdea = inputPrompt.trim();
    const hasHardViolence = containsHardViolence(inputPrompt);
    const hasSoftAction = containsSoftAction(inputPrompt);

    const triggerWord = personaTriggerWord || 'TOK';

    // --- Collect selected personas for HF LoRA routing (supports multi-persona) ---
    const requestedPersonaIds: string[] = Array.isArray(personaIds)
      ? personaIds.map((v: any) => String(v)).filter(Boolean)
      : [];
    const providedPersonas: PersonaRecord[] = Array.isArray(personas)
      ? (personas as any[]).filter(Boolean)
      : [];
    let loadedPersonas: PersonaRecord[] = [];
    if (requestedPersonaIds.length > 0) {
      const all = await readPersonas();
      loadedPersonas = all.filter((p) => requestedPersonaIds.includes(p.personaId));
    }
    const personaPool = [...providedPersonas, ...loadedPersonas];
    const hfUrls = uniqStrings(personaPool.map((p) => (p as any)?.huggingFaceUrl || (p as any)?.huggingface_url))
      .map(withDownloadTrue);
    const configuredMultiLoraModel = safeTrim(process.env.REPLICATE_FLUX_MULTI_LORA_MODEL);
    const shouldUseMultiLoraEndpoint =
      hfUrls.length > 1
      && Boolean(configuredMultiLoraModel)
      && configuredMultiLoraModel !== 'lucataco/flux-dev-multi-lora';
    const primaryHfUrl = hfUrls[0] || '';
    const triggerWords = uniqStrings([triggerWord, ...personaPool.map((p) => p?.triggerWord || '')]);

    const preferredModel = 'gemini-2.5-flash';
    const geminiApiKey = process.env.GEMINI_API_KEY || '';
    if (!geminiApiKey.trim()) {
      throw new Error('GEMINI_API_KEY not configured.');
    }
    const resolvedModel = await getGeminiModelId(geminiApiKey, preferredModel);
    const model = genAI.getGenerativeModel({
      model: resolvedModel,
      generationConfig: { temperature: 0.7 },
    });

    /** Generate reference image. If fluxImagePrompt provided (from Gemini prompt-enhance), use it for keyframe continuity; otherwise use rawPrompt + action logic. */
    const generateInitialImage = async (rawPrompt: string, options?: { fluxImagePrompt?: string }): Promise<string> => {
      const ref = body?.sourceImage || body?.reference_image_url || body?.referenceImage;
      if (ref && typeof ref === 'string') {
        console.log('✅ [FLUX FIRST] Using provided reference image:', ref);
        return await normalizeReplicateAssetUrl(ref);
      }
      const fluxImagePrompt = options?.fluxImagePrompt?.trim();
      const useContextPrompt = Boolean(fluxImagePrompt);
      const promptForImage = useContextPrompt
        ? (personaModelId && !fluxImagePrompt!.toLowerCase().includes(triggerWord.toLowerCase())
            ? `${triggerWord} ${fluxImagePrompt}`
            : fluxImagePrompt!)
        : `${triggerWord} ${rawPrompt.trim()}`.trim();

      // If we have HF LoRA(s) selected, generate the keyframe using a LoRA-capable Flux endpoint.
      if (hfUrls.length > 0) {
        const model = shouldUseMultiLoraEndpoint
          ? configuredMultiLoraModel
          : (process.env.REPLICATE_FLUX_LORA_MODEL || 'black-forest-labs/flux-dev-lora');
        const fluxBasePrompt = useContextPrompt ? promptForImage : rawPrompt.trim();
        const fluxInputPrompt = useContextPrompt
          ? fluxBasePrompt
          : (isActionLikePrompt(fluxBasePrompt) ? buildFluxActionPrompt(fluxBasePrompt, { triggerWord }) : fluxBasePrompt);
        const loraPrompt = ensurePromptHasTriggers(fluxInputPrompt, triggerWords);

        let imageOutput: any = null;
        try {
          if (shouldUseMultiLoraEndpoint) {
            imageOutput = await replicate.run(model as any, { input: { prompt: loraPrompt, hf_loras: hfUrls, aspect_ratio: '16:9', output_format: 'png', output_quality: 100, num_inference_steps: 50 } });
          } else {
            imageOutput = await replicate.run(model as any, { input: { prompt: loraPrompt, lora_weights: primaryHfUrl, lora_scale: 1.0, aspect_ratio: '16:9', output_format: 'png', output_quality: 100, num_inference_steps: 50 } });
          }
        } catch (error: any) {
          // Fallback to minimal inputs if the model rejects extra fields
          if (shouldUseMultiLoraEndpoint) {
            imageOutput = await replicate.run(model as any, { input: { prompt: loraPrompt, hf_loras: hfUrls } });
          } else {
            imageOutput = await replicate.run(model as any, { input: { prompt: loraPrompt, lora_weights: primaryHfUrl, lora_scale: 1.0 } });
          }
        }

        let url = extractImageUrl(imageOutput);
        if (!url) {
          const stream = findFirstStream(imageOutput);
          if (stream) url = await saveStreamToPublic(stream, 'png');
        }
        if (!url) throw new Error('HF LoRA keyframe generation failed.');
        return await normalizeReplicateAssetUrl(url);
      }

      if (personaModelId) {
        console.log('📸 [FLUX FIRST] Generating persona reference image' + (useContextPrompt ? ' (context-aware keyframe)' : '') + '...');
        let targetVersion = personaModelId;
        if (!personaModelId.includes('/') && !personaModelId.includes(':')) {
          try {
            const training = await replicate.trainings.get(personaModelId);
            targetVersion = training.output?.version || training.version || personaModelId;
          } catch {
            targetVersion = personaModelId;
          }
        }
        const isAction = useContextPrompt ? false : isActionLikePrompt(rawPrompt);
        const personaPrompt = useContextPrompt
          ? promptForImage
          : isAction
            ? buildFluxActionPrompt(`${triggerWord}, ${rawPrompt}`.trim(), { triggerWord })
            : `${triggerWord}, wide angle, full body or face, cinematic, ${rawPrompt}`.trim();
        let imageOutput: any = null;
        try {
          imageOutput = await replicate.run(targetVersion, {
            input: {
              prompt: personaPrompt,
              output_format: 'png',
              disable_safety_checker: true,
            },
          });
        } catch (error: any) {
          if (String(error?.message || '').includes('E005')) {
            imageOutput = await replicate.run(targetVersion, {
              input: {
                prompt: softenPrompt(personaPrompt),
                output_format: 'png',
                disable_safety_checker: true,
              },
            });
          } else {
            throw error;
          }
        }
        let url = extractImageUrl(imageOutput);
        if (!url) {
          const stream = findFirstStream(imageOutput);
          if (stream) url = await saveStreamToPublic(stream, 'png');
        }
        if (!url) throw new Error('Persona reference image generation failed.');
        return await normalizeReplicateAssetUrl(url);
      }
      console.log('📸 [FLUX FIRST] Generating Flux 2 Max reference image' + (useContextPrompt ? ' (context-aware keyframe)' : '') + '...');
      const fluxBasePrompt = useContextPrompt ? promptForImage : rawPrompt.trim();
      const fluxInputPrompt = useContextPrompt
        ? fluxBasePrompt
        : (isActionLikePrompt(fluxBasePrompt) ? buildFluxActionPrompt(fluxBasePrompt, { triggerWord }) : fluxBasePrompt);
      let imageOutput: any = null;
      try {
        imageOutput = await replicate.run('black-forest-labs/flux-2-max', {
          input: {
            prompt: fluxInputPrompt,
            aspect_ratio: '16:9',
            output_quality: 100,
            output_format: 'png',
            num_inference_steps: 50,
          },
        });
      } catch (error: any) {
        if (String(error?.message || '').includes('E005')) {
          imageOutput = await replicate.run('black-forest-labs/flux-2-max', {
            input: {
              prompt: softenPrompt(fluxInputPrompt),
              aspect_ratio: '16:9',
              output_quality: 100,
              output_format: 'png',
              num_inference_steps: 50,
            },
          });
        } else {
          throw error;
        }
      }
      let url = extractImageUrl(imageOutput);
      if (!url) {
        const stream = findFirstStream(imageOutput);
        if (stream) url = await saveStreamToPublic(stream, 'png');
      }
      if (!url) throw new Error('Flux reference image generation failed.');
      return await normalizeReplicateAssetUrl(url);
    };

    // ——— CONTEXT-AWARE: Gemini first → flux_image_prompt (keyframe) + video_motion_prompt (motion after image). Perfect continuity. ———
    const promptEnhanceSchema = `
You are a context-aware visual prompt engineer for image-to-video. Output ONLY valid JSON. English for both prompts.

——— flux_image_prompt (for the INITIAL image / Flux keyframe) ———
- Do NOT generate a generic portrait if the user asks for action. Visualize as a "Keyframe" or "Movie Still".
- If the user asks for fight/action, describe MID-ACTION (e.g. "fist connecting", "mid-air kick", "gripping steering wheel"). Include environment, lighting, camera angle.
- For Personas: Inject the persona token (${triggerWord}) into this dynamic scene. Do NOT revert to a static pose when action is requested.
- Example — User: "Hıdır Baba araba sürüyor." → "Side angle shot of ${triggerWord} gripping the steering wheel of a fast car, motion blur on the road, intense focus, sunset lighting, cinematic 8k."
- Structure: [Camera angle] of [persona] [mid-action or keyframe], [environment], [lighting], photorealistic, 8k, cinematic.

——— video_motion_prompt (ONLY movement/physics AFTER the image) ———
- Describe ONLY what happens after the keyframe. Video starts from the exact Flux frame. No static scene repeat.
- Example: "The car accelerates forward, dust kicking up, camera tracks the movement."
- Motion, camera movement, physics. Same character. 6–8 seconds. No text, no watermark. English.

——— Director fields ———
- mode: ACTION_MODE if action/fight/drive/combat; TALKING_MODE if dialogue/speech.
- is_fight_action: true if blood/gore/knife/stab/fight/weapon/combat.
- voice_category, speech_text, sfx_prompt, audio_environment, is_action_scene, voice_settings.

JSON:
{
  "flux_image_prompt": "Full keyframe prompt. Persona in mid-action if action requested. English.",
  "video_motion_prompt": "Only movement and physics after the image. English.",
  "mode": "ACTION_MODE | TALKING_MODE",
  "is_fight_action": true | false,
  "visual_prompt": "Same as flux_image_prompt for fallback",
  "voice_category": "male_villain",
  "speech_text": "",
  "sfx_prompt": "",
  "audio_environment": "studio",
  "is_action_scene": true | false,
  "voice_settings": { "stability": 0.35, "similarity_boost": 0.75, "style": 0.5, "use_speaker_boost": true }
}

User idea: "${safeUserIdea}"
Persona token: ${triggerWord}
`;

    let scene: Record<string, unknown> | null = null;
    try {
      const directorCut = await model.generateContent(promptEnhanceSchema);
      const raw = directorCut.response.text().trim();
      scene = extractSceneJson(raw);
    } catch (err) {
      console.warn('Gemini prompt-enhance failed, using raw prompt for image.', err);
    }

    const fluxImagePromptFromGemini = scene && typeof scene.flux_image_prompt === 'string' ? scene.flux_image_prompt.trim() : '';
    const videoMotionPromptFromGemini = scene && typeof scene.video_motion_prompt === 'string' ? scene.video_motion_prompt.trim() : '';

    const referenceImageUrl = await generateInitialImage(safeUserIdea, fluxImagePromptFromGemini ? { fluxImagePrompt: fluxImagePromptFromGemini } : undefined);
    console.log('🖼️ [FLUX FIRST] Reference image URL (context-aware keyframe) for Veo/Grok/Kling:', referenceImageUrl);

    if (!scene) {
      throw new Error('Gemini returned invalid JSON.');
    }

    const hasVoiceId = Boolean(typeof voiceId === 'string' && voiceId.trim());
    const isFightAction = Boolean((scene as any).is_fight_action);
    const provider = hasVoiceId
      ? ('KLING_ELEVEN' as const)
      : isFightAction
        ? ('GROK' as const)
        : ('VEO' as const);
    console.log('🎬 Routing (Gemini):', hasVoiceId ? 'voice_id → KLING_ELEVEN' : isFightAction ? 'fight/action → GROK' : 'default → VEO', '→', provider);

    const rawFluxPrompt = typeof scene.visual_prompt === 'string' ? scene.visual_prompt.trim() : (typeof scene.flux_image_prompt === 'string' ? scene.flux_image_prompt.trim() : '');
    const fluxPrompt = rawFluxPrompt.toLowerCase().includes('arri alexa')
      ? rawFluxPrompt
      : `${rawFluxPrompt}${CINEMATIC_VISUAL_SUFFIX}`;
    const videoMotionPrompt = videoMotionPromptFromGemini || rawFluxPrompt;
    const sceneAny = scene as Record<string, unknown> & { kling_prompt?: string; movement_direction?: { kling_prompt?: string } };
    const klingPrompt = typeof sceneAny.kling_prompt === 'string'
      ? sceneAny.kling_prompt.trim()
      : typeof sceneAny.movement_direction?.kling_prompt === 'string'
        ? sceneAny.movement_direction.kling_prompt.trim()
        : '';
    const rawUserDialogue = typeof body?.dialogue === 'string'
      ? body.dialogue.trim()
      : typeof body?.dialogueText === 'string'
        ? body.dialogueText.trim()
        : typeof body?.voiceScript === 'string'
          ? body.voiceScript.trim()
          : typeof body?.script === 'string'
            ? body.script.trim()
            : '';
    const hasUserScript = Boolean(rawUserDialogue && rawUserDialogue.trim());
    const speechText = typeof scene.speech_text === 'string' ? scene.speech_text.trim() : '';
    const sfxPrompt = typeof scene.sfx_prompt === 'string' ? scene.sfx_prompt.trim() : '';
    const suggestedVoiceCategory = typeof scene.voice_category === 'string'
      ? scene.voice_category.trim()
      : '';
    const audioEnvironment = typeof scene.audio_environment === 'string'
      ? scene.audio_environment.trim()
      : '';
    const femaleCueRegex = /\b(woman|female|girl|lady|she|her)\b/i;
    const maleCueRegex = /\b(man|male|boy|he|him)\b/i;
    const hasFemaleCue = femaleCueRegex.test(inputPrompt);
    const hasMaleCue = maleCueRegex.test(inputPrompt);
    const resolvedVoiceCategory = personaModelId && !hasFemaleCue && !hasMaleCue
      ? (suggestedVoiceCategory?.startsWith('female_') ? 'male_heroic' : suggestedVoiceCategory)
      : suggestedVoiceCategory;
    const isActionScene = Boolean((scene as any).is_action_scene);
    const baseMode = resolveIntentMode((scene as any).mode, isActionScene);
    const intentMode = provider === 'KLING_ELEVEN' ? 'TALKING_MODE' : 'ACTION_MODE';
    const vs = scene.voice_settings as { stability?: number; similarity_boost?: number; style?: number; use_speaker_boost?: boolean } | undefined;
    const voiceSettings = typeof vs === 'object' && vs
      ? {
        stability: Number(vs.stability),
        similarity_boost: Number(vs.similarity_boost),
        style: Number(vs.style),
        use_speaker_boost: Boolean(vs.use_speaker_boost),
      }
      : undefined;
    const dialogueText = rawUserDialogue || speechText;
    const isDialogue = intentMode === 'TALKING_MODE';
    if (isDialogue && !dialogueText) {
      throw new Error('TALKING_MODE requires a text script or Gemini speech_text.');
    }
    if (isDialogue && !hasVoiceId) {
      throw new Error('TALKING_MODE requires a voice_id.');
    }

    if (!sfxPrompt || !fluxPrompt) {
      throw new Error('Director output missing required prompts.');
    }

    const generateImage = async () => {
      if (personaModelId) {
        let targetVersion = personaModelId;
        if (personaModelId && !personaModelId.includes('/') && !personaModelId.includes(':')) {
          const training = await replicate.trainings.get(personaModelId);
          targetVersion = training.output?.version || training.version || personaModelId;
        }
        const personaPrompt = fluxPrompt.toLowerCase().includes(triggerWord.toLowerCase())
          ? fluxPrompt
          : `${triggerWord} ${fluxPrompt}`.trim();
        let imageOutput: any = null;
        try {
          imageOutput = await replicate.run(targetVersion, {
            input: {
              prompt: personaPrompt,
              output_format: 'png',
              disable_safety_checker: true,
            },
          });
        } catch (error: any) {
          const message = String(error?.message || '');
          if (message.includes('E005')) {
            const softened = softenPrompt(personaPrompt);
            imageOutput = await replicate.run(targetVersion, {
              input: {
                prompt: softened,
                output_format: 'png',
                disable_safety_checker: true,
              },
            });
          } else {
            throw error;
          }
        }
        let imageUrl = extractImageUrl(imageOutput);
        if (!imageUrl) {
          const stream = findFirstStream(imageOutput);
          if (stream) imageUrl = await saveStreamToPublic(stream, 'png');
        }
        if (!imageUrl) throw new Error('Persona image generation failed.');
        return await normalizeReplicateAssetUrl(imageUrl);
      }

      let imageOutput: any = null;
      try {
        imageOutput = await replicate.run('black-forest-labs/flux-2-max', {
          input: {
            prompt: fluxPrompt,
            aspect_ratio: '16:9',
            output_quality: 100,
            output_format: 'png',
            num_inference_steps: 50,
          },
        });
      } catch (error: any) {
        const message = String(error?.message || '');
        if (message.includes('E005')) {
          const softened = softenPrompt(fluxPrompt);
          imageOutput = await replicate.run('black-forest-labs/flux-2-max', {
            input: {
              prompt: softened,
              aspect_ratio: '16:9',
              output_quality: 100,
              output_format: 'png',
              num_inference_steps: 50,
            },
          });
        } else {
          throw error;
        }
      }
      let imageUrl = extractImageUrl(imageOutput);
      if (!imageUrl) {
        const stream = findFirstStream(imageOutput);
        if (stream) imageUrl = await saveStreamToPublic(stream, 'png');
      }
      if (!imageUrl) throw new Error('Flux image generation failed.');
      return await normalizeReplicateAssetUrl(imageUrl);
    };

    const imageUrl = referenceImageUrl;
    if (!imageUrl || typeof imageUrl !== 'string' || !String(imageUrl).trim()) {
      throw new Error('Referans görsel gerekli: Persona/Flux görseli video motoruna (Veo/Grok/Kling) verilmeden önce üretilmeli.');
    }
    const visionPlan = await analyzeImageWithGemini(imageUrl, {
      voice_category: resolvedVoiceCategory,
      speech_text: dialogueText,
      sfx_prompt: sfxPrompt,
      audio_environment: audioEnvironment,
      is_action_scene: isActionScene,
      voice_settings: voiceSettings,
    });
    const refinedVoiceCategory = visionPlan?.voice_category || resolvedVoiceCategory;
    const refinedSpeechText = isDialogue ? (visionPlan?.speech_text || dialogueText) : dialogueText;
    const refinedSfxPrompt = visionPlan?.sfx_prompt || sfxPrompt;
    const refinedAudioEnvironment = visionPlan?.audio_environment || audioEnvironment;
    const refinedVoiceSettings = visionPlan?.voice_settings || voiceSettings;
    const refinedActionScene = typeof visionPlan?.is_action_scene === 'boolean'
      ? visionPlan.is_action_scene
      : isActionScene;
    const sfxPromptWithAction = refinedActionScene
      ? `${refinedSfxPrompt}, impact, hit, crash, explosion`
      : refinedSfxPrompt;

    switch (provider) {
      case 'VEO': {
        if (!imageUrl || typeof imageUrl !== 'string') {
          throw new Error('VEO I2V requires Persona/Flux reference image. Generate image first.');
        }
        let veoImageUrl = ensureAbsoluteUrl(imageUrl);
        const isVeoLocal = veoImageUrl.includes('localhost') || veoImageUrl.includes('127.0.0.1') || veoImageUrl.includes('0.0.0.0') || veoImageUrl.startsWith('/');
        if (isVeoLocal) {
          veoImageUrl = await ensureReplicateUri(veoImageUrl, 'veo-ref.jpg', 'image/jpeg');
        } else if (veoImageUrl.includes('api.replicate.com/v1/files/')) {
          veoImageUrl = await resolveReplicateFileUrl(veoImageUrl, process.env.REPLICATE_API_TOKEN || '');
        }
        const actionPromptBase = videoMotionPrompt;
        const actionAudioPrompt = [
          refinedAudioEnvironment ? `Ambient sound: ${refinedAudioEnvironment}.` : '',
          refinedSfxPrompt ? `Sound effects: ${refinedSfxPrompt}.` : '',
        ]
          .filter(Boolean)
          .join(' ');
        const actionPrompt = actionAudioPrompt
          ? `${actionPromptBase} ${actionAudioPrompt}`.trim()
          : actionPromptBase;
        const veoModel = process.env.REPLICATE_VEO_MODEL || 'google/veo-3.1';
        const veoFallbackModel = (process.env.REPLICATE_VEO_FALLBACK_MODEL || '').trim() || null;
        const baseVeoPrompt = actionPrompt;
        let veoOutput: any = null;
        let lastError: any = null;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            veoOutput = await runVeoImageToVideo({
              image_url: veoImageUrl,
              prompt: baseVeoPrompt,
              model: veoModel,
            });
            lastError = null;
            break;
          } catch (error: any) {
            lastError = error;
            if (isRateLimit(error)) {
              await sleep(1200);
              continue;
            }
            if (isSensitiveFlag(error)) {
              continue;
            }
            break;
          }
        }

        if (!veoOutput && veoFallbackModel) {
          try {
            veoOutput = await runVeoImageToVideo({
              image_url: veoImageUrl,
              prompt: baseVeoPrompt,
              model: veoFallbackModel,
            });
            lastError = null;
          } catch (error: any) {
            lastError = error;
          }
        }

        if (!veoOutput) {
          throw lastError || new Error('Veo video generation failed.');
        }

        let videoUrl = extractImageUrl(veoOutput);
        if (!videoUrl) {
          const stream = findFirstStream(veoOutput);
          if (stream) videoUrl = await saveStreamToPublic(stream, 'mp4');
        }
        if (!videoUrl) {
          throw new Error('Veo video generation failed.');
        }
        videoUrl = await normalizeReplicateAssetUrl(videoUrl);
        return NextResponse.json({
          success: true,
          videoUrl,
          imageUrl,
          scene,
          engine: veoModel,
        });
      }

      case 'GROK': {
        const actionPromptBase = videoMotionPrompt;
        const actionAudioPrompt = [
          refinedAudioEnvironment ? `Ambient sound: ${refinedAudioEnvironment}.` : '',
          refinedSfxPrompt ? `Sound effects: ${refinedSfxPrompt}.` : '',
        ]
          .filter(Boolean)
          .join(' ');
        const actionPrompt = actionAudioPrompt
          ? `${actionPromptBase} ${actionAudioPrompt}`.trim()
          : actionPromptBase;
        const grokPrompt = actionPrompt;
        const imageAbsolute = ensureAbsoluteUrl(imageUrl);
        let grokImageForInput: string | null = null;
        // Prefer xAI Video API (console.x.ai) if configured; fallback to Replicate otherwise.
        const xaiKey = String(process.env.XAI_API_KEY || process.env.XAI_KEY || process.env.XAI_TOKEN || '').trim();
        const isGrokLocal = imageAbsolute.includes('localhost') || imageAbsolute.includes('127.0.0.1') || imageAbsolute.includes('0.0.0.0') || imageUrl.startsWith('/');
        if (isGrokLocal) {
          // If xAI is enabled, avoid uploading to Replicate; we'll send a data URI instead.
          if (!xaiKey) {
            try {
              grokImageForInput = await ensureReplicateUri(imageAbsolute, 'grok-ref.jpg', 'image/jpeg');
            } catch {
              // fallback to data URI below
            }
          }
        } else if (imageAbsolute.includes('api.replicate.com/v1/files/')) {
          // Replicate file URLs are not public; for xAI we prefer data URI.
          if (!xaiKey) {
            try {
              grokImageForInput = await resolveReplicateFileUrl(imageAbsolute, process.env.REPLICATE_API_TOKEN || '');
            } catch {
              // will try data URI below
            }
          }
        } else if (imageAbsolute.startsWith('http')) {
          grokImageForInput = imageAbsolute;
        }
        const getReferenceImageAsDataUri = async (): Promise<string | null> => {
          try {
            if (imageUrl.startsWith('/generated/')) {
              const { readFile } = await import('node:fs/promises');
              const buf = await readFile(path.join(process.cwd(), 'public', imageUrl));
              return `data:image/jpeg;base64,${buf.toString('base64')}`;
            }
            const urlToFetch = imageAbsolute.includes('api.replicate.com/v1/files/')
              ? await resolveReplicateFileUrl(imageAbsolute, process.env.REPLICATE_API_TOKEN || '')
              : imageAbsolute.startsWith('http')
                ? imageAbsolute
                : null;
            if (!urlToFetch) return null;
            const res = urlToFetch.includes('api.replicate.com')
              ? await fetch(urlToFetch, { headers: { Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}` } })
              : await fetch(urlToFetch);
            if (!res.ok) return null;
            const buf = await res.arrayBuffer();
            const mime = res.headers.get('content-type')?.split(';')[0]?.trim() || 'image/jpeg';
            return `data:${mime};base64,${toBase64(buf)}`;
          } catch {
            return null;
          }
        };
        if (!grokImageForInput) {
          const dataUri = await getReferenceImageAsDataUri();
          if (dataUri) grokImageForInput = dataUri;
        }
        if (!grokImageForInput || !String(grokImageForInput).trim()) {
          throw new Error('Grok icin referans gorsel gerekli; persona/Flux gorseli verilmedi.');
        }
        const durationSec = Math.min(15, Math.max(5, Number(body?.duration_seconds ?? body?.video_duration ?? body?.duration ?? 5)));
        // xAI-only: if GROK is selected, require XAI_API_KEY and do not fall back to Replicate.
        if (!xaiKey) {
          throw new Error('XAI_API_KEY is missing. Grok engine requires xAI API key (no Replicate fallback).');
        }
        const xai = await generateXaiVideo({
          prompt: grokPrompt,
          imageUrl: grokImageForInput,
          duration: durationSec,
          aspectRatio: '16:9',
          resolution: (process.env.XAI_VIDEO_RESOLUTION || '480p') as any,
          model: (process.env.XAI_VIDEO_MODEL || 'grok-imagine-video') as any,
          timeoutMs: Number(process.env.XAI_VIDEO_TIMEOUT_MS || '') || undefined,
          pollIntervalMs: Number(process.env.XAI_VIDEO_POLL_MS || '') || undefined,
        });
        return NextResponse.json({
          success: true,
          videoUrl: xai.url,
          imageUrl,
          scene,
          engine: `xai/${xai.model}`,
        });

      }

      default:
        break;
    }

    const [voiceUrl, sfxUrl] = await Promise.all([
      isDialogue
        ? generateSpeech(
          `${refinedSpeechText}${refinedAudioEnvironment ? ` speaking in a ${refinedAudioEnvironment}, natural reverb.` : ''}`,
          voiceId,
          refinedVoiceSettings
        )
        : Promise.resolve(''),
      generateAtmosphere(`${sfxPromptWithAction}${SFX_QUALITY_SUFFIX}`, 10),
    ]);

    const absoluteVoiceUrl = isDialogue ? ensureAbsoluteUrl(voiceUrl) : '';
    if (isDialogue && !absoluteVoiceUrl) {
      throw new Error('Dialogue requested but speech audio failed.');
    }
    let klingImageUrl = await ensureReplicateUri(imageUrl, 'image.jpg', 'image/jpeg');
    let klingAudioUrl = isDialogue
      ? await ensureReplicateUri(absoluteVoiceUrl, 'audio.mp3', 'audio/mpeg')
      : '';
    if (klingImageUrl.includes('api.replicate.com/v1/files/')) {
      klingImageUrl = await resolveReplicateFileUrl(klingImageUrl, process.env.REPLICATE_API_TOKEN || '');
    }
    if (klingAudioUrl.includes('api.replicate.com/v1/files/')) {
      klingAudioUrl = await resolveReplicateFileUrl(klingAudioUrl, process.env.REPLICATE_API_TOKEN || '');
    }
    if (isDialogue) {
      console.log('🎧 KLING AUDIO URI:', klingAudioUrl);
      if (!klingAudioUrl || !/^https?:\/\//.test(klingAudioUrl)) {
        throw new Error(`Kling audio URI invalid: ${klingAudioUrl || 'empty'}`);
      }
    }

    const avatarModel = 'kwaivgi/kling-avatar-v2';
    const avatarOutput = await replicate.run(avatarModel, {
      input: {
        image: klingImageUrl,
        audio: klingAudioUrl,
        prompt: klingPrompt || 'subtle head movement, micro facial expressions',
        match_mode: 'audio_driven',
        audio_strength: 1.0,
        animation_mode: 'high_fidelity',
        cfg_scale: 0.6,
        aspect_ratio: '16:9',
        duration: 10,
      },
    });
    let videoUrl = extractImageUrl(avatarOutput);
    if (!videoUrl) {
      const stream = findFirstStream(avatarOutput);
      if (stream) videoUrl = await saveStreamToPublic(stream, 'mp4');
    }
    if (!videoUrl) throw new Error('Kling avatar video failed.');
    videoUrl = await normalizeReplicateAssetUrl(videoUrl);

    const finalMovie = await mixVideoWithDucking({
      videoUrl,
      voiceUrl,
      sfxUrl,
      voiceVolume: 1.0,
      sfxBedVolume: refinedActionScene ? 0.6 : 0.2,
      duckedSfxVolume: 0.2,
      audioEnvironment: refinedAudioEnvironment,
    });

    return NextResponse.json({
      success: true,
      videoUrl: finalMovie.videoUrl,
      imageUrl,
      scene,
      engine: 'kling-avatar-v2',
    });
  } catch (error: any) {
    console.error('❌ HATA:', error.message || error);
    const msg = String(error?.message || 'Unknown error');
    const isMissingXaiKey = msg.toLowerCase().includes('xai_api_key') && msg.toLowerCase().includes('missing');
    return NextResponse.json({ error: msg }, { status: isMissingXaiKey ? 400 : 500 });
  }
}
