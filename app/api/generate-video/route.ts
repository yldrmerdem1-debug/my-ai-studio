import { NextResponse } from 'next/server';
import Replicate from 'replicate';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import crypto from 'node:crypto';
import { mixVideoWithDucking, processVideoWithAudio } from '@/lib/videoProcessor';
import { generateLivePortraitVideo } from '@/lib/live-portrait';
import { generateSpeech, generateSFX } from '@/lib/audio-service';
import { getGeminiModelId } from '@/lib/gemini';

export const runtime = 'nodejs';

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const parseRetryAfterMs = (error: any) => {
  const headerValue =
    error?.response?.headers?.get?.('retry-after')
    || error?.headers?.get?.('retry-after')
    || error?.response?.headers?.['retry-after']
    || error?.response?.headers?.['Retry-After'];
  if (headerValue) {
    const seconds = Number(headerValue);
    if (!Number.isNaN(seconds)) {
      return Math.max(0, Math.round(seconds * 1000));
    }
  }
  const message = String(error?.message || '');
  const match = message.match(/retry_after[:\s]+(\d+)/i) || message.match(/retry after[:\s]+(\d+)/i);
  if (match && match[1]) {
    const seconds = Number(match[1]);
    if (!Number.isNaN(seconds)) {
      return Math.max(0, Math.round(seconds * 1000));
    }
  }
  return 10000;
};

const runReplicateWithRetry = async (model: string, input: Record<string, any>, maxAttempts = 5) => {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await replicate.run(model, { input });
    } catch (error: any) {
      const status = error?.status || error?.response?.status;
      const message = String(error?.message || '');
      const isRateLimit = status === 429 || message.includes('429') || message.toLowerCase().includes('too many requests');
      if (!isRateLimit || attempt >= maxAttempts) {
        throw error;
      }
      const delayMs = parseRetryAfterMs(error);
      console.warn('Rate limit hit. Waiting to retry...', { attempt, delayMs });
      await sleep(delayMs);
    }
  }
  throw new Error('Replicate retry attempts exhausted.');
};

const isReadableStream = (value: any): value is ReadableStream => {
  return value && typeof value.getReader === 'function';
};

const stripJsonFences = (raw: string) => {
  const trimmed = raw.trim();
  if (trimmed.startsWith('```')) {
    return trimmed
      .replace(/^```[a-zA-Z]*\n?/, '')
      .replace(/```$/, '')
      .trim();
  }
  return trimmed;
};

const extractGeminiJson = (raw: string) => {
  const cleaned = stripJsonFences(raw);
  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      return JSON.parse(match[0]);
    }
  }
  return null;
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

async function resolveReplicateFileUrl(apiUrl: string, token: string): Promise<string> {
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
}

async function uploadStreamToReplicate(stream: ReadableStream, token: string): Promise<string> {
  const response = new Response(stream);
  const buffer = await response.arrayBuffer();
  const blob = new Blob([buffer], { type: 'image/jpeg' });
  const form = new FormData();
  form.append('content', blob, 'persona.jpg');
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
  if (candidateUrl) {
    return await resolveReplicateFileUrl(candidateUrl, token);
  }
  throw new Error(`Replicate upload returned no URL. Payload: ${text}`);
}

async function saveStreamToPublic(stream: ReadableStream, extension: string): Promise<string> {
  const dir = path.join(process.cwd(), 'public', 'generated');
  await mkdir(dir, { recursive: true });
  const fileName = `${crypto.randomUUID()}.${extension}`;
  const filePath = path.join(dir, fileName);
  await pipeline(Readable.fromWeb(stream as any), createWriteStream(filePath));
  return `/generated/${fileName}`;
}

function extractImageUrl(output: any): string {
  if (!output) return '';

  if (typeof output === 'string') {
    return output.includes('://') ? output : '';
  }

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
}

const normalizeReplicateAssetUrl = async (url: string) => {
  const replicateFilePrefix = 'https://api.replicate.com/v1/files/';
  if (url && url.includes('api.replicate.com/v1/files/')) {
    let resolved = await resolveReplicateFileUrl(url, process.env.REPLICATE_API_TOKEN || '');
    if (resolved.startsWith(replicateFilePrefix)) {
      const fileId = resolved.slice(replicateFilePrefix.length);
      resolved = `/api/replicate-file?id=${encodeURIComponent(fileId)}`;
    }
    return resolved;
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

const resolveBaseUrl = () => {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return 'http://localhost:3000';
};

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

const generateSfxAudioUrl = async (prompt: string) => {
  return await generateSFX({
    text: prompt,
    durationSeconds: 10,
    promptInfluence: 0.5,
  });
};

export async function POST(req: Request) {
  console.log('🚀 STRICT PIPELINE STARTING...');

  try {
    const body = await req.json();
    console.log('🧪 REQUEST BODY:', body);
    let {
      userPrompt,
      prompt,
      personaModelId,
      qualityTier,
      personaTriggerWord,
      dryRun,
      referenceImageUrl,
      personaImageUrl,
      personaUrl,
    } = body;
    let dialogue =
      typeof body?.dialogue === 'string'
        ? body.dialogue
        : typeof body?.script === 'string'
          ? body.script
          : typeof body?.voiceScript === 'string'
            ? body.voiceScript
            : '';
    const voiceId = typeof body?.voiceId === 'string' ? body.voiceId : undefined;
    const voiceFormat = body?.voiceFormat === 'wav' ? 'wav' : 'mp3';

    const resolvedPersonaModelId =
      personaModelId
      || body?.modelId
      || body?.model_id
      || body?.persona?.modelId
      || body?.persona?.model_id
      || body?.persona?.modelId;

    const resolvedTriggerWord =
      personaTriggerWord
      || body?.triggerWord
      || body?.trigger_word
      || body?.persona?.triggerWord
      || body?.persona?.trigger_word;

    const safePrompt = userPrompt || prompt || 'cinematic shot of a person moving';
    const normalizePrompt = (text: string, trigger?: string) => {
      if (!trigger) return text.trim();
      const escaped = trigger.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const stripRegex = new RegExp(`\\b${escaped}\\b`, 'gi');
      const cleaned = text.replace(stripRegex, '').replace(/^[,\s]+|[,\s]+$/g, '').trim();
      return cleaned;
    };
    const normalizedPrompt = normalizePrompt(safePrompt, resolvedTriggerWord);
    const personaActive = Boolean(resolvedPersonaModelId || resolvedTriggerWord);
    const personaName =
      body?.persona?.name
      || body?.personaName
      || body?.persona?.title
      || '';
    const personaPrefix = [resolvedTriggerWord, personaName]
      .filter((part, index, list) => part && list.indexOf(part) === index)
      .join(' ')
      .trim();
    const highQualityPrefix = 'photorealistic, cinematic film still, highly detailed, sharp focus, dramatic lighting,';
    let imagePrompt = safePrompt;
    let videoPrompt = safePrompt;
    let usedGeminiImagePrompt = false;
    let usedGeminiVideoPrompt = false;
    let audioContentType: 'speech' | 'sfx' | '' = '';
    let audioTextContent = '';
    let audioScript = '';
    let sfxPromptText = '';
    let avatarPerformance = '';
    let voiceEmotion = '';
    let voiceEmotionSettings: { stability?: number; similarity_boost?: number; style?: number } | undefined;
    let audioDrivenSource = false;

    let model: ReturnType<typeof genAI.getGenerativeModel> | null = null;
    if (process.env.GEMINI_API_KEY) {
      try {
        const preferredModel = 'gemini-3-pro-preview';
        const resolvedModel = await getGeminiModelId(process.env.GEMINI_API_KEY, preferredModel);
        model = genAI.getGenerativeModel({
          model: resolvedModel,
          generationConfig: { temperature: 0.7 },
        });
        const structuredResult = await model.generateContent(`
You are an expert Video & Sound Director. Classify the user's request by intent:
- Mode CHAOS (absurd/comedy, memes, chaotic actions).
- Mode COMMERCIAL only if the user explicitly signals ad intent (keywords like "reklam", "tanıtım", "lansman", "satış", "sponsorlu", "commercial style", "product showcase").
- Otherwise use CINEMATIC/STORY mode: objects are props; focus on character emotion and atmosphere.
Return ONLY valid JSON with this shape:
{
  "visual_prompt": "Flux-2-max prompt with technical cinematography details.",
  "audio_script": "Character speech text.",
  "voice_emotion": "ElevenLabs voice emotion description (e.g., 'intense whisper').",
  "sfx_prompt": "AudioLDM-2 ambience prompt.",
  "avatar_performance": "Kling avatar performance notes (micro-acting cues)."
}
Rules:
- Visual (Flux-2-max): use lens (85mm/35mm), film stock (Kodak Portra 400), lighting (Rembrandt, chiaroscuro, volumetric fog), texture (skin pores, fabric texture), atmospheric depth (dust, rain reflections, neon glow). Aim for Netflix 4K HDR look.
- Avatar performance (Kling): describe motion only (head turns, gaze shifts, steps, micro gestures). Keep it short and precise.
- Speech: include micro‑nuance (breathiness, through teeth, soft smile). Use pauses (...) and [emphasis] tags.
- SFX: Dynamic Acoustic Simulation (Physics + Space + Intensity + Mood + TIME).
  - Construct: [Specific action sounds] + [Environmental ambience/reverb] + [Matching musical mood].
  - Temporal Evolution: sudden, gradual build-up, fading in, abrupt stop, swells, intermittent.
  - Material Precision: leather creaks, heavy boots, metallic clank, liquid on concrete.
  - Mix Balance: action sounds foreground, music background (underscore). Duck music during impacts.
  - No artist names. No speaking/gibberish/vocals/singing. No cartoon boings unless comedy is explicit.
  - Always end SFX prompt with: "high fidelity, cinematic mix, stereo imaging, no vocals".
- If persona is active, the visual prompt must start with: "${personaPrefix || resolvedTriggerWord || 'TOK'}"
- Mandatory Facial Visibility: correct away‑facing actions with head turn or 3/4 profile; key light on face; sharp focus on eyes; no back-of-head unless user says "ONLY BACK VIEW".
- Output must be English.
User intent: "${normalizedPrompt}"
`);
        const raw = structuredResult.response.text().trim();
        const parsed = extractGeminiJson(raw);
        if (parsed && typeof parsed === 'object') {
          const visual = String((parsed as any).visual_prompt ?? '').trim();
          const videoAction = String((parsed as any).video_action_prompt ?? '').trim();
          const audioText = String((parsed as any).audio_text ?? '').trim();
          const audioScriptText = String((parsed as any).audio_script ?? '').trim();
          const sfxPrompt = String((parsed as any).sfx_prompt ?? '').trim();
          const avatarPerf = String((parsed as any).avatar_performance ?? '').trim();
          const voiceEmotionText = String((parsed as any).voice_emotion ?? '').trim();
          const emotionSettings = (parsed as any).voice_emotion_settings;
          audioDrivenSource = Boolean(
            Object.prototype.hasOwnProperty.call(parsed, 'audio_script')
              || Object.prototype.hasOwnProperty.call(parsed, 'avatar_performance')
              || Object.prototype.hasOwnProperty.call(parsed, 'voice_emotion')
          );
          if (visual) {
            usedGeminiImagePrompt = true;
            usedGeminiVideoPrompt = true;
            imagePrompt = visual;
            videoPrompt = videoAction ? `${visual}. ${videoAction}` : visual;
          }
          audioScript = audioScriptText || audioText;
          sfxPromptText = sfxPrompt;
          avatarPerformance = avatarPerf || videoAction;
          voiceEmotion = voiceEmotionText || String(emotionSettings?.description ?? '').trim();
          if (emotionSettings && typeof emotionSettings === 'object') {
            const stability = Number(emotionSettings?.stability);
            const similarityBoost = Number(emotionSettings?.similarity_boost);
            const style = Number(emotionSettings?.style);
            voiceEmotionSettings = {
              ...(Number.isFinite(stability) ? { stability } : {}),
              ...(Number.isFinite(similarityBoost) ? { similarity_boost: similarityBoost } : {}),
              ...(Number.isFinite(style) ? { style } : {}),
            };
          }
          if (audioScript) {
            audioContentType = 'speech';
            audioTextContent = audioScript;
          } else if (sfxPromptText) {
            audioContentType = 'sfx';
            audioTextContent = sfxPromptText;
          } else {
            audioContentType = '';
            audioTextContent = '';
          }
        }
      } catch (error) {
        console.warn('Gemini prompt enhancement failed, using raw prompt.');
      }
    }
    if (audioContentType === 'speech') {
      dialogue = audioTextContent;
    } else if (audioContentType === 'sfx') {
      dialogue = audioTextContent;
    } else {
      dialogue = '';
    }
    if (audioContentType === 'speech' && !dialogue.trim()) {
      audioContentType = '';
    }
    if (audioContentType === 'sfx' && !dialogue.trim()) {
      audioContentType = '';
    }
    if (!audioContentType && dialogue.trim()) {
      audioContentType = 'speech';
    }
    if (personaPrefix) {
      const prefixLower = personaPrefix.toLowerCase();
      if (!imagePrompt.toLowerCase().startsWith(prefixLower)) {
        imagePrompt = `${personaPrefix} ${imagePrompt}`.trim();
      }
      if (!videoPrompt.toLowerCase().startsWith(prefixLower)) {
        videoPrompt = `${personaPrefix} ${videoPrompt}`.trim();
      }
    }
    if (!usedGeminiImagePrompt || imagePrompt.trim().toLowerCase() === normalizedPrompt.trim().toLowerCase()) {
      const basePrefix = personaPrefix || resolvedTriggerWord || '';
      imagePrompt = `${basePrefix ? `${basePrefix} ` : ''}${normalizedPrompt}, cinematic lighting, shallow depth of field, photorealistic textures`.trim();
    }
    if (!usedGeminiVideoPrompt || videoPrompt.trim().toLowerCase() === imagePrompt.trim().toLowerCase()) {
      videoPrompt = `${imagePrompt}. Smooth tracking shot, dramatic lighting, realistic movement.`;
    }
    if (resolvedTriggerWord) {
      const triggerLower = resolvedTriggerWord.toLowerCase();
      if (!imagePrompt.toLowerCase().includes(triggerLower)) {
        imagePrompt = `${resolvedTriggerWord} ${imagePrompt}`.trim();
      }
      if (!videoPrompt.toLowerCase().includes(triggerLower)) {
        videoPrompt = `${resolvedTriggerWord} ${videoPrompt}`.trim();
      }
    }
    if (model) {
      const hasTurkishImage = /[ğüşöçıİ]/i.test(imagePrompt) || /\b(yolda|yuruyor|yürüyor|sokakta|adam|kadin|kadın)\b/i.test(imagePrompt);
      if (hasTurkishImage) {
        const translateResult = await model.generateContent(`
Translate this prompt to clean, cinematic English. Output ONLY the English prompt.
Prompt: "${imagePrompt}"
`);
        const translated = translateResult.response.text().trim();
        if (translated) {
          imagePrompt = translated;
        }
      }
      const hasTurkishVideo = /[ğüşöçıİ]/i.test(videoPrompt) || /\b(yolda|yuruyor|yürüyor|sokakta|adam|kadin|kadın)\b/i.test(videoPrompt);
      if (hasTurkishVideo) {
        const translateVideoResult = await model.generateContent(`
Translate this prompt to clean, cinematic English. Output ONLY the English prompt.
Prompt: "${videoPrompt}"
`);
        const translatedVideo = translateVideoResult.response.text().trim();
        if (translatedVideo) {
          videoPrompt = translatedVideo;
        }
      }
    }

    if (resolvedTriggerWord) {
      const triggerLower = resolvedTriggerWord.toLowerCase();
      if (!imagePrompt.toLowerCase().includes(triggerLower)) {
        imagePrompt = `${resolvedTriggerWord} ${imagePrompt}`.trim();
      }
      if (!videoPrompt.toLowerCase().includes(triggerLower)) {
        videoPrompt = `${resolvedTriggerWord} ${videoPrompt}`.trim();
      }
    }

    const shouldDryRun = dryRun === true || dryRun === 'true' || dryRun === 1 || dryRun === '1';
    console.log('🧪 DRY RUN:', shouldDryRun, 'raw:', dryRun);

    if (shouldDryRun) {
      return NextResponse.json({
        success: true,
        dryRun: true,
        imagePrompt,
        videoPrompt,
        usedGeminiImagePrompt,
        usedGeminiVideoPrompt,
        audioCategory: audioContentType,
        audioText: audioTextContent,
        audioScript,
        sfxPrompt: sfxPromptText,
        avatarPerformance,
        voiceEmotion,
        voiceEmotionSettings,
      });
    }

    const restoreFace = async (inputUrl: string) => {
      try {
        console.log('🧼 RESTORING FACE (GFPGAN)...');
        const restoreOutput = await runReplicateWithRetry('tencentarc/gfpgan', {
          image: inputUrl,
          upscale: 2,
        });
        let restoredUrl = extractImageUrl(restoreOutput);
        if (!restoredUrl) {
          const stream = findFirstStream(restoreOutput);
          if (stream) {
            try {
              console.log('🧪 RESTORE STREAM OUTPUT: uploading to Replicate files...');
              restoredUrl = await uploadStreamToReplicate(stream, process.env.REPLICATE_API_TOKEN || '');
              console.log('✅ RESTORE STREAM URL:', restoredUrl);
            } catch (error) {
              console.error('❌ RESTORE STREAM UPLOAD FAILED:', error);
            }
          }
        }
        if (restoredUrl && typeof restoredUrl === 'string') {
          console.log('✅ FACE RESTORATION APPLIED:', restoredUrl);
          return restoredUrl;
        }
        throw new Error('GFPGAN returned no output');
      } catch (error) {
        console.warn('⚠️ GFPGAN RESTORE FAILED, TRYING CODEFORMER...', error);
      }

      try {
        console.log('🧼 RESTORING FACE (CodeFormer)...');
        const restoreOutput = await runReplicateWithRetry('sczhou/codeformer', {
          image: inputUrl,
          upscale: 2,
          fidelity: 0.5,
          face_upsample: true,
        });
        let restoredUrl = extractImageUrl(restoreOutput);
        if (!restoredUrl) {
          const stream = findFirstStream(restoreOutput);
          if (stream) {
            try {
              console.log('🧪 RESTORE STREAM OUTPUT: uploading to Replicate files...');
              restoredUrl = await uploadStreamToReplicate(stream, process.env.REPLICATE_API_TOKEN || '');
              console.log('✅ RESTORE STREAM URL:', restoredUrl);
            } catch (error) {
              console.error('❌ RESTORE STREAM UPLOAD FAILED:', error);
            }
          }
        }
        if (restoredUrl && typeof restoredUrl === 'string') {
          console.log('✅ FACE RESTORATION APPLIED:', restoredUrl);
          return restoredUrl;
        }
        console.warn('⚠️ CODEFORMER RESTORE FAILED, USING ORIGINAL IMAGE.');
      } catch (error) {
        console.warn('⚠️ CODEFORMER RESTORE ERROR, USING ORIGINAL IMAGE.', error);
      }

      return inputUrl;
    };
    const buildReferenceImage = async () => {
      const referenceImage =
        body?.sourceImage
        || personaImageUrl
        || personaUrl
        || referenceImageUrl
        || body?.reference_image_url
        || body?.referenceImage;
      let cleanImageUrl = '';

      if (resolvedPersonaModelId) {
        let targetModelVersion = resolvedPersonaModelId;
        if (resolvedPersonaModelId && !resolvedPersonaModelId.includes('/') && !resolvedPersonaModelId.includes(':')) {
          try {
            const training = await replicate.trainings.get(resolvedPersonaModelId);
            if (training.output?.version) targetModelVersion = training.output.version;
            else if (training.version) targetModelVersion = training.version;
          } catch {
            console.warn('ID resolve skipped');
          }
        }

        console.log('📸 GENERATING PERSONA REFERENCE IMAGE...');
        const personaVisibilityPrefix = 'distinct facial features visible, recognizable identity, cinematic shot revealing the face,';
        const personaPrompt = `${resolvedTriggerWord || 'TOK'}, ${personaVisibilityPrefix} ${highQualityPrefix} ${imagePrompt}`.trim();
        const personaImagePayload = {
          prompt: personaPrompt,
          num_outputs: 1,
          num_inference_steps: 50,
          guidance_scale: 3.5,
          output_quality: 100,
          aspect_ratio: '16:9',
          output_format: 'jpg',
          lora_scale: 1.0,
          disable_safety_checker: true,
        };

        const imageOutput = await runReplicateWithRetry(targetModelVersion, personaImagePayload);

        cleanImageUrl = extractImageUrl(imageOutput);
        if (!cleanImageUrl) {
          const stream = findFirstStream(imageOutput);
          if (stream) {
            try {
              console.log('🧪 STREAM OUTPUT DETECTED: uploading to Replicate files...');
              cleanImageUrl = await uploadStreamToReplicate(stream, process.env.REPLICATE_API_TOKEN || '');
              console.log('✅ STREAM UPLOAD URL:', cleanImageUrl);
            } catch (error) {
              console.error('❌ STREAM UPLOAD FAILED:', error);
            }
          }
        }

        if (!cleanImageUrl || typeof cleanImageUrl !== 'string') {
          console.error('❌ INVALID IMAGE OUTPUT:', imageOutput);
          throw new Error('Critical: Persona reference image generation failed.');
        }

        console.log('✅ VALID PERSONA IMAGE URL EXTRACTED:', cleanImageUrl);
        cleanImageUrl = await restoreFace(cleanImageUrl);
      } else if (referenceImage) {
        cleanImageUrl = referenceImage;
        console.log('✅ USING PROVIDED REFERENCE IMAGE:', cleanImageUrl);
      } else {
        console.log('📸 GENERATING REFERENCE IMAGE (Flux 2 Max)...');
        const imagePayload = {
          prompt: `${highQualityPrefix} ${imagePrompt}`.trim(),
          aspect_ratio: '16:9',
          output_quality: 100,
          output_format: 'jpg',
          num_inference_steps: 50,
        };

        const imageOutput = await runReplicateWithRetry('black-forest-labs/flux-2-max', imagePayload);

        cleanImageUrl = extractImageUrl(imageOutput);
        if (!cleanImageUrl) {
          const stream = findFirstStream(imageOutput);
          if (stream) {
            try {
              console.log('🧪 STREAM OUTPUT DETECTED: uploading to Replicate files...');
              cleanImageUrl = await uploadStreamToReplicate(stream, process.env.REPLICATE_API_TOKEN || '');
              console.log('✅ STREAM UPLOAD URL:', cleanImageUrl);
            } catch (error) {
              console.error('❌ STREAM UPLOAD FAILED:', error);
            }
          }
        }

        if (!cleanImageUrl || typeof cleanImageUrl !== 'string') {
          console.error('❌ INVALID IMAGE OUTPUT:', imageOutput);
          throw new Error('Critical: Reference image generation failed.');
        }

        console.log('✅ VALID IMAGE URL EXTRACTED:', cleanImageUrl);
        cleanImageUrl = await restoreFace(cleanImageUrl);
      }

      return cleanImageUrl;
    };

    const tier = (qualityTier || '').toString().toLowerCase();
    console.log(`🎬 GENERATING VIDEO (${tier || 'standard'})...`);

    let finalVideoUrl = '';
    let audioMerged = false;
    let audioUrlForLipSync = '';
    let cleanImageUrl = '';
    const isAudioDrivenPipeline = audioDrivenSource && Boolean(audioScript || sfxPromptText);

    console.log('--- DEBUG KONTROL ---');
    console.log('1. Dialogue Var mı?:', !!dialogue);
    console.log('2. Audio Category Nedir?:', audioContentType);
    console.log('3. Voice ID Var mı?:', voiceId);
    console.log('--- DEBUG SONU ---');

    if (isAudioDrivenPipeline) {
      if (voiceEmotion) {
        console.log('🎭 VOICE EMOTION:', voiceEmotion);
      }
      const voiceTask = audioScript
        ? generateSpeech({
          text: audioScript,
          voiceId,
          emotion_level: voiceEmotionSettings?.style ?? 0.5,
        })
        : Promise.resolve('');
      const sfxTask = sfxPromptText ? generateSfxAudioUrl(sfxPromptText) : Promise.resolve('');

      const [imageUrl, voiceUrl, sfxUrl] = await Promise.all([
        buildReferenceImage(),
        voiceTask,
        sfxTask,
      ]);

      cleanImageUrl = imageUrl;

      let klingImageUrl = await ensureReplicateUri(cleanImageUrl, 'image.jpg', 'image/jpeg');
      let klingAudioUrl = voiceUrl
        ? await ensureReplicateUri(voiceUrl, 'audio.mp3', 'audio/mpeg')
        : '';
      if (klingImageUrl.includes('api.replicate.com/v1/files/')) {
        klingImageUrl = await resolveReplicateFileUrl(klingImageUrl, process.env.REPLICATE_API_TOKEN || '');
      }
      if (klingAudioUrl.includes('api.replicate.com/v1/files/')) {
        klingAudioUrl = await resolveReplicateFileUrl(klingAudioUrl, process.env.REPLICATE_API_TOKEN || '');
      }
      console.log('🎧 KLING AUDIO URI:', klingAudioUrl);
      if (!klingAudioUrl || !/^https?:\/\//.test(klingAudioUrl)) {
        throw new Error(`Kling audio URI invalid: ${klingAudioUrl || 'empty'}`);
      }

      if (!voiceUrl) {
        throw new Error('Audio-driven pipeline requires speech audio.');
      }
      if (!sfxUrl) {
        throw new Error('Audio-driven pipeline requires SFX audio.');
      }

      console.log('🎬 MODE: AUDIO-DRIVEN CINEMATIC (Kling Avatar v2)');
      const avatarModel = 'kwaivgi/kling-avatar-v2';
      const avatarOutput = await runReplicateWithRetry(avatarModel, {
        image: klingImageUrl,
        audio: klingAudioUrl,
        prompt: avatarPerformance || 'subtle head movement, micro facial expressions',
        cfg_scale: 0.6,
      });
      console.log('🎥 AVATAR OUTPUT:', avatarOutput);

      let avatarVideoUrl = extractImageUrl(avatarOutput);
      if (!avatarVideoUrl) {
        const stream = findFirstStream(avatarOutput);
        if (stream) {
          try {
            console.log('🧪 AVATAR STREAM OUTPUT DETECTED: saving locally...');
            avatarVideoUrl = await saveStreamToPublic(stream, 'mp4');
            console.log('✅ LOCAL AVATAR VIDEO URL:', avatarVideoUrl);
          } catch (error) {
            console.error('❌ AVATAR STREAM SAVE FAILED:', error);
          }
        }
      }
      if (!avatarVideoUrl || typeof avatarVideoUrl !== 'string') {
        throw new Error('Critical: Avatar video generation failed.');
      }

      avatarVideoUrl = await normalizeReplicateAssetUrl(avatarVideoUrl);
      const mixed = await mixVideoWithDucking({
        videoUrl: avatarVideoUrl,
        voiceUrl,
        sfxUrl,
        voiceVolume: 1.0,
        sfxBedVolume: 0.6,
        duckedSfxVolume: 0.2,
      });
      finalVideoUrl = mixed.videoUrl;
      audioMerged = true;

      return NextResponse.json({
        success: true,
        videoUrl: finalVideoUrl,
        imageUrl: cleanImageUrl,
        imagePrompt,
        videoPrompt,
        usedGeminiImagePrompt,
        usedGeminiVideoPrompt,
        audioMerged,
      });
    }

    cleanImageUrl = await buildReferenceImage();

    if (dialogue && audioContentType === 'speech') {
      try {
        console.log('🎙️ GENERATING AUDIO FOR LIP-SYNC...');
        const rawAudioUrl = await generateSpeech({
          text: dialogue,
          voiceId,
          emotion_level: voiceEmotionSettings?.style ?? 0.5,
        });
        audioUrlForLipSync = await ensureReplicateUri(rawAudioUrl, 'audio.mp3', 'audio/mpeg');
      } catch (error) {
        console.warn('Failed to generate speech audio for LivePortrait.', error);
      }
    }

    if (audioUrlForLipSync && audioContentType === 'speech') {
      try {
        console.log('🎬 MODE: TALKING HEAD (LivePortrait)');
        finalVideoUrl = await generateLivePortraitVideo(cleanImageUrl, audioUrlForLipSync);
        audioMerged = true;
      } catch (error) {
        console.error('⚠️ LivePortrait failed, falling back to Kling', error);
      }
    }

    if (!finalVideoUrl) {
      const videoPromptWithRef = `Match the reference image exactly (subject identity, outfit, lighting, framing). Start from the same scene. ${videoPrompt}`;
      const klingImageUrl = await ensureReplicateUri(cleanImageUrl, 'image.jpg', 'image/jpeg');
      const videoModel = 'kwaivgi/kling-v2.5-turbo-pro';
      const videoInput: Record<string, any> = {
        prompt: videoPromptWithRef,
        start_image: klingImageUrl,
        image_fidelity: 0.75,
        aspect_ratio: '16:9',
        duration: 30,
        cfg_scale: 0.5,
      };

      const videoOutput = await runReplicateWithRetry(videoModel, videoInput);
      console.log('🎥 RAW VIDEO OUTPUT:', videoOutput);

      let cleanVideoUrl = extractImageUrl(videoOutput);
      if (!cleanVideoUrl) {
        const stream = findFirstStream(videoOutput);
        if (stream) {
          try {
            console.log('🧪 VIDEO STREAM OUTPUT DETECTED: saving locally...');
            cleanVideoUrl = await saveStreamToPublic(stream, 'mp4');
            console.log('✅ LOCAL VIDEO URL:', cleanVideoUrl);
          } catch (error) {
            console.error('❌ VIDEO STREAM SAVE FAILED:', error);
          }
        }
      }
      const replicateFilePrefix = 'https://api.replicate.com/v1/files/';
      if (cleanVideoUrl && cleanVideoUrl.includes('api.replicate.com/v1/files/')) {
        cleanVideoUrl = await resolveReplicateFileUrl(cleanVideoUrl, process.env.REPLICATE_API_TOKEN || '');
        if (cleanVideoUrl.startsWith(replicateFilePrefix)) {
          const fileId = cleanVideoUrl.slice(replicateFilePrefix.length);
          cleanVideoUrl = `/api/replicate-file?id=${encodeURIComponent(fileId)}`;
        }
      }

      if (!cleanVideoUrl || typeof cleanVideoUrl !== 'string') {
        throw new Error('Critical: Video generation finished but returned an invalid format. Expected a plain URL string.');
      }

      finalVideoUrl = cleanVideoUrl;
      if (audioContentType === 'speech' || audioContentType === 'sfx') {
        try {
          const merged = await processVideoWithAudio({
            videoUrl: cleanVideoUrl,
            dialogue,
            audioCategory: audioContentType,
            targetDuration: 6,
            voiceId,
            format: voiceFormat,
          });
          finalVideoUrl = merged.videoUrl;
          audioMerged = merged.audioMerged;
        } catch (error) {
          console.warn('Audio generation failed, returning silent video.', error);
        }
      }
    }

    return NextResponse.json({
      success: true,
      videoUrl: finalVideoUrl,
      imageUrl: cleanImageUrl,
      imagePrompt,
      videoPrompt,
      usedGeminiImagePrompt,
      usedGeminiVideoPrompt,
      audioMerged,
    });
  } catch (error: any) {
    console.error('❌ GENERATION ERROR:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
