import { NextRequest, NextResponse } from 'next/server';
import Replicate from 'replicate';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { ensureFalConfigured } from '@/lib/fal';
import {
  buildFluxActionPrompt,
  isActionLikePrompt,
} from '@/lib/flux-action-prompts';
import {
  buildNanoBananaPrompt,
  buildSceneDirectorGuidance,
  buildSinglePhotographRules,
  decideRefinementOutput,
  getNanoRefinerResolution,
  resolveGenerationMode,
} from '@/lib/generation-strategy';
import { persistGeneratedBuffer, persistGeneratedStream } from '@/lib/generated-assets';
import { getGeminiModelId } from '@/lib/gemini';
import { isArchiveLoraUrl, normalizeLoraWeightsBuffer } from '@/lib/lora-weights';
import {
  resolvePersonaImageEngine,
} from '@/lib/persona-pipeline';
import { normalizePersonaSubjectType } from '@/lib/persona-subject';
import { decodeFalTrainingJobId, isFalTrainingJobId } from '@/lib/persona-training-jobs';
import { readPersonas, type PersonaRecord } from '@/lib/persona-registry';
import { ensurePublicAssetUrl } from '@/lib/public-asset-url';
import { downloadMediaWithValidation } from '@/lib/replicate-media';
import { getSiteUrlFromRequest } from '@/lib/site-url';
import { ensurePromptHasTriggers, uniqStrings, withDownloadTrue } from '@/lib/lora-utils';
import { getStorageProvider } from '@/lib/storage';

const isReadableStream = (value: unknown): value is ReadableStream =>
  typeof value === 'object' && value !== null && typeof (value as any).getReader === 'function';

const findFirstStream = (output: unknown): ReadableStream | null => {
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

const extractImageUrl = (output: unknown): string => {
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

const saveStreamToPublic = async (stream: ReadableStream, extension: string): Promise<string> =>
  persistGeneratedStream(stream, {
    prefix: 'generated/images',
    suggestedName: `image.${extension}`,
    contentType: extension === 'png' ? 'image/png' : extension === 'webp' ? 'image/webp' : 'image/jpeg',
  });

const saveBufferToPublic = async (buffer: Buffer, extension: string, prefix = 'generated/files'): Promise<string> =>
  persistGeneratedBuffer(buffer, {
    prefix,
    suggestedName: `file.${extension}`,
    contentType: extension === 'png'
      ? 'image/png'
      : extension === 'webp'
        ? 'image/webp'
        : extension === 'jpg' || extension === 'jpeg'
          ? 'image/jpeg'
          : 'application/octet-stream',
  });

const clampFluxInferenceSteps = (steps: number) =>
  Math.max(1, Math.min(50, Math.round(Number(steps) || 50)));

const stableSeedFromParts = (...parts: unknown[]) => {
  const input = parts.map((part) => String(part ?? '')).join('|');
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

const productNaturalInteractionRule = [
  'PRODUCT NATURAL INTERACTION RULE:',
  'prefer a clean standalone hero product shot with no hands unless the user explicitly asks for hands or real usage.',
  'If hands appear, they must interact with the product in a believable, ergonomic, real-world way and never look reversed, awkward, claw-like, anatomically wrong, or staged incorrectly.',
  'For a mouse, fingers must rest naturally on the left/right buttons with the wrist and palm aligned behind the mouse; never grip it backwards, sideways, from the wrong end, or cover the logo/scroll wheel/buttons.',
  'Hands may touch only edges or normal contact points and must not dominate the frame, hide the product face, cover the brand mark, or make the product look unusable.',
].join(' ');

const extractGeminiJson = (raw: string) => {
  const cleaned = raw.trim().replace(/^```[a-zA-Z]*\n?/, '').replace(/```$/, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    return jsonMatch ? JSON.parse(jsonMatch[0]) : null;
  }
};

const resolveAspect = (raw: unknown) => {
  const value = String(raw || '').trim().toLowerCase();
  if (value === 'square') {
    return { width: 1024, height: 1024, fluxAspectRatio: '1:1' };
  }
  if (value === 'landscape') {
    return { width: 1344, height: 768, fluxAspectRatio: '16:9' };
  }
  return { width: 768, height: 1344, fluxAspectRatio: '9:16' };
};

const resolveFalImageSize = (aspectRatio: string) => {
  if (aspectRatio === '1:1') return 'square_hd';
  if (aspectRatio === '9:16') return 'portrait_16_9';
  return 'landscape_16_9';
};

const safeTrim = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
const cleanPromptInstructionLeak = (value: string) => safeTrim(value)
  .replace(/^One complete photorealistic cinematic image prompt \(single frozen frame\) in English\.\s*/i, '')
  .replace(/\[(?:Persona|Camera\/framing|Environment|Frozen pose|Lighting|Style:[^\]]+)\]\.?\s*/gi, '')
  .trim();
const isFluxModelRef = (value: unknown) => {
  const normalized = safeTrim(value).toLowerCase();
  return !normalized || normalized.includes('flux');
};
const isUnsupportedLegacyPersona = (value: any) => {
  const modelFamily = safeTrim(value?.modelFamily ?? value?.model_family).toLowerCase();
  const trainingBaseModel = safeTrim(value?.trainingBaseModel ?? value?.training_base_model).toLowerCase();
  return (modelFamily && modelFamily !== 'flux-lora')
    || !isFluxModelRef(trainingBaseModel);
};

const extractFalWeightsUrl = (result: any) =>
  safeTrim(
    result?.data?.diffusers_lora_file?.url
    || result?.diffusers_lora_file?.url
    || result?.data?.lora?.url
    || result?.lora?.url
  );

const normalizeReferenceImageUrls = (value: unknown): string[] => {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === 'string') return item.trim();
        if (item && typeof item === 'object') return safeTrim((item as any).url);
        return '';
      })
      .filter(Boolean);
  }
  const single = safeTrim(value);
  return single ? [single] : [];
};

const extractPersonaReferenceItems = (persona: PersonaRecord | Record<string, any>) => [
  ...((Array.isArray((persona as any)?.referenceImages) ? (persona as any).referenceImages : []) as any[]),
  ...((Array.isArray((persona as any)?.reference_images) ? (persona as any).reference_images : []) as any[]),
];

const resolvePersonaReferenceUrls = async (personas: Array<PersonaRecord | Record<string, any>>) => {
  const items = personas.flatMap((persona) => extractPersonaReferenceItems(persona));
  const urls = await Promise.all(items.map(async (item: any) => {
    const storagePath = safeTrim(item?.storagePath || item?.storage_path);
    if (storagePath) {
      try {
        const provider = getStorageProvider();
        if (provider.getPublicUrl) {
          return await provider.getPublicUrl(storagePath).catch(() => provider.getSignedUrl(storagePath, 60 * 60 * 24 * 7));
        }
        return await provider.getSignedUrl(storagePath, 60 * 60 * 24 * 7);
      } catch (error) {
        console.warn('[image/generate] Persona reference storagePath could not be resolved.', (error as Error)?.message || error);
      }
    }
    return safeTrim(item?.url || item);
  }));
  return uniqStrings(urls.filter(Boolean));
};

export async function POST(request: NextRequest) {
  try {
    const apiToken = safeTrim(process.env.REPLICATE_API_TOKEN);
    const body = await request.json().catch(() => ({}));
    const {
      prompt,
      mode,
      triggerWord,
      opponentOrContext,
      personaModelId,
      trainingId,
      personaIds,
      personas,
      destinationModel,
      modelFamily,
      aspectRatio,
      qualityPreset,
      imageEngine,
      generationMode,
      referenceImageUrl,
      referenceImageUrls,
      refinePass,
      dryRun,
    } = body;
    const isRefinePass = refinePass === true || refinePass === 'true' || refinePass === 1 || refinePass === '1';

    const rawPrompt = (prompt ?? '').toString().trim();
    if (!rawPrompt) {
      return NextResponse.json(
        { error: 'prompt is required' },
        { status: 400 }
      );
    }

    const isActionModeHint =
      mode === 'ACTION_MODE' ||
      mode === 'HARDCORE_MODE' ||
      isActionLikePrompt(rawPrompt);
    let imagePrompt = rawPrompt;
    let resolvedIsActionMode = isActionModeHint;

    const replicate = apiToken
      ? new Replicate({
          auth: apiToken,
          fetch: (url, options) =>
            fetch(url, { ...(options as RequestInit), timeout: 120000 } as RequestInit),
        })
      : null;
    const aspect = resolveAspect(aspectRatio);
    const wantsHighQuality = String(qualityPreset || '').toLowerCase() === '1080p' || String(qualityPreset || '').toLowerCase() === 'hq';
    const resolvedModelId = String(personaModelId || trainingId || '').trim();

    // --- HF LoRA injection (single or multiple personas) ---
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
    const personasByKey = new Map<string, PersonaRecord>();
    [...providedPersonas, ...loadedPersonas].forEach((persona, index) => {
      const key = String(
        (persona as any)?.personaId
        || (persona as any)?.id
        || (persona as any)?.trainingId
        || (persona as any)?.training_id
        || (persona as any)?.modelId
        || (persona as any)?.model_id
        || (persona as any)?.triggerWord
        || (persona as any)?.trigger_word
        || `persona-${index}`
      );
      personasByKey.set(key, { ...(personasByKey.get(key) || {}), ...(persona as any) } as PersonaRecord);
    });
    const personaPool = [...personasByKey.values()];
    if (personaPool.some((persona) => isUnsupportedLegacyPersona(persona))) {
      return NextResponse.json(
        { error: 'Legacy personas are no longer supported. Retrain this persona with FLUX.' },
        { status: 400 }
      );
    }
    const storedLoraUrls = uniqStrings(personaPool.flatMap((p) => [
      (p as any)?.huggingFaceUrl,
      (p as any)?.huggingface_url,
      (p as any)?.weightsUrl,
      (p as any)?.weights_url,
    ]))
      .map(withDownloadTrue);
    const trainingWeightIds = uniqStrings([
      resolvedModelId,
      ...personaPool.flatMap((p) => [(p as any)?.trainingId, (p as any)?.training_id, (p as any)?.modelId, (p as any)?.model_id]),
    ]).filter((value) =>
      Boolean(value)
      && !String(value).includes('/')
      && !String(value).includes(':')
      && !isFalTrainingJobId(value)
      && !/^https?:\/\//i.test(String(value))
    );
    const replicateTrainingWeightUrls = replicate && trainingWeightIds.length > 0
      ? uniqStrings(await Promise.all(trainingWeightIds.map(async (id) => {
          try {
            const training = await replicate.trainings.get(String(id));
            const output = (training?.output ?? {}) as Record<string, unknown>;
            return String(
              output?.weights_url
              || output?.weights
              || output?.weightsUrl
              || output?.lora_weights_url
              || output?.lora_weights
              || output?.lora
              || ''
            ).trim();
          } catch {
            return '';
          }
        })))
      : [];
    const falTrainingWeightUrls = process.env.FAL_KEY?.trim()
      ? uniqStrings(await Promise.all(personaPool.map(async (persona) => {
          const trainingIdentifiers = uniqStrings([
            (persona as any)?.trainingId,
            (persona as any)?.training_id,
            (persona as any)?.modelId,
            (persona as any)?.model_id,
          ]);
          const falTrainingId = trainingIdentifiers.find((value) => isFalTrainingJobId(value));
          const trainingBaseModel = safeTrim((persona as any)?.trainingBaseModel || (persona as any)?.training_base_model);
          if (!falTrainingId || !trainingBaseModel) return '';
          try {
            const fal = ensureFalConfigured();
            const result = await fal.queue.result(trainingBaseModel, {
              requestId: decodeFalTrainingJobId(falTrainingId),
            } as any);
            return extractFalWeightsUrl(result);
          } catch {
            return '';
          }
        })))
      : [];
    const singlePersonaLoraSource = replicateTrainingWeightUrls.length > 0
      ? replicateTrainingWeightUrls
      : storedLoraUrls.length > 0
        ? storedLoraUrls
        : falTrainingWeightUrls;
    const personaLoraUrls = personaPool.length <= 1
      // A single persona can surface the same LoRA from multiple sources; prefer one source to avoid false multi-LoRA routing.
      ? uniqStrings(singlePersonaLoraSource)
      : uniqStrings([
          ...replicateTrainingWeightUrls,
          ...storedLoraUrls,
          ...falTrainingWeightUrls,
        ]);
    const resolvedDestinationModel = uniqStrings([
      destinationModel,
      ...personaPool.flatMap((p) => [(p as any)?.destinationModel, (p as any)?.destination_model]),
    ])[0] || '';
    const resolvedSubjectType = uniqStrings([
      ...personaPool.flatMap((p) => [(p as any)?.subjectType, (p as any)?.subject_type]),
      (body as any)?.subjectType,
      (body as any)?.subject_type,
    ])
      .map((value) => normalizePersonaSubjectType(value))
      .filter((value): value is NonNullable<typeof value> => Boolean(value))[0];
    const isHumanPersonaSubject = !resolvedSubjectType || resolvedSubjectType === 'human';
    const isProductPersonaSubject = resolvedSubjectType === 'product';
    const fluxSteps = clampFluxInferenceSteps(
      wantsHighQuality || isProductPersonaSubject ? 50 : 40
    );
    const productLoraScale = isProductPersonaSubject ? 0.98 : 1.0;
    const subjectFocusGuidance = isHumanPersonaSubject
      ? 'The background must be highly detailed and cinematic but must not overpower the subject\'s face.'
      : resolvedSubjectType === 'animal'
        ? 'The subject must stay dominant and anatomically consistent. The environment must support the animal without overpowering its fur pattern, markings, or silhouette.'
        : resolvedSubjectType === 'product'
          ? 'The product must stay dominant, centered, geometrically accurate, and premium. The environment must support the product without overpowering its silhouette, logo/brand placement, identifying marks, material finish, or functional details.'
          : 'The subject must stay dominant and consistent. The environment must support the subject without overpowering its defining silhouette, markings, texture, or proportions.';
    const identityGuidance = isHumanPersonaSubject
      ? 'Keep the subject identity locked and consistent.'
      : resolvedSubjectType === 'animal'
        ? 'Keep the animal identity, anatomy, fur pattern, markings, and proportions locked and consistent.'
        : resolvedSubjectType === 'product'
          ? 'The persona token represents the trained product itself, not a generic product category. Keep the exact trained product identity, silhouette, proportions, materials, surface finish, logo/brand placement, identifying marks, buttons, closures, zippers, straps, ports, seams, panel lines, engravings, labels, hardware, texture, and signature design language locked and consistent.'
          : 'Keep the subject identity, silhouette, proportions, texture, markings, and defining features locked and consistent.';
    const productVisibilityGuidance = resolvedSubjectType === 'product'
      ? `Product visibility is mandatory: the trained product must be clearly visible, fully in frame, sharp, premium, and unobstructed as the hero subject. This applies to any product category: pen, bag, accessory, jewelry, bottle, cosmetic, shoe, clothing item, packaging, device, mouse, gadget, tool, furniture, or any physical object. Use a clean commercial hero angle that reveals the product face carrying the logo/brand area or most recognizable identifying marks. Preserve distinctive silhouette, proportions, labels, engraving, logo/brand placement, buttons, caps, clips, zipper pulls, straps, buckles, seams, ports, panel lines, texture, material finish, stitching, hardware, surface details, and color blocking whenever present. Never generate a generic substitute, simplified object, wrong category, hidden-logo angle, cropped product, hand-covered product, hand-only usage shot, awkward/reversed grip, anatomically wrong hand pose, or environment-dominant composition. If hands or a person interact with it, they may touch or hold only normal ergonomic contact points and must never cover, hide, crop, or replace the product. The product must remain more visually important than the hand, environment, or lighting. ${productNaturalInteractionRule}`
      : '';
    const enforceProductVisibility = (promptText: string) =>
      productVisibilityGuidance
        ? `${promptText.trim()} ${productVisibilityGuidance}`.trim()
        : promptText;
    const hasResolvableReplicateModelId = Boolean(resolvedModelId) && !isFalTrainingJobId(resolvedModelId);
    const shouldPreferTrainedModel = hasResolvableReplicateModelId && personaLoraUrls.length <= 1;
    const shouldUseExternalLoras = personaLoraUrls.length > 0 && !shouldPreferTrainedModel;
    const configuredMultiLoraModel = safeTrim(process.env.REPLICATE_FLUX_MULTI_LORA_MODEL);
    const shouldUseMultiLoraEndpoint =
      personaLoraUrls.length > 1
      && Boolean(configuredMultiLoraModel)
      && configuredMultiLoraModel !== 'lucataco/flux-dev-multi-lora';
    const primaryPersonaLoraUrl = personaLoraUrls[0] || '';
    const personaReferenceImageUrls = await resolvePersonaReferenceUrls(personaPool);
    const explicitReferenceImageUrls = uniqStrings([
      ...normalizeReferenceImageUrls(referenceImageUrl),
      ...normalizeReferenceImageUrls(referenceImageUrls),
      ...normalizeReferenceImageUrls((body as any)?.reference_image_url),
      ...normalizeReferenceImageUrls((body as any)?.reference_images),
    ]);
    // Refine pass: only the LoRA/base render should guide Nano — training photos cause collage drift.
    const resolvedReferenceImageUrls = isRefinePass
      ? explicitReferenceImageUrls
      : uniqStrings([
          ...explicitReferenceImageUrls,
          ...personaReferenceImageUrls,
          ...personaPool.flatMap((persona) => [
            safeTrim((persona as any)?.imageUrl),
            safeTrim((persona as any)?.image_url),
          ]),
        ]);
    const primaryReferenceImageUrl = resolvedReferenceImageUrls[0] || '';
    let resolvedImageEngine = resolvePersonaImageEngine({
      requestedEngine: imageEngine,
      hasPersona: personaPool.length > 0 || Boolean(resolvedModelId),
      hasReferenceImage: Boolean(primaryReferenceImageUrl),
      generationMode,
    });
    if (
      !isRefinePass
      && (isHumanPersonaSubject || resolvedSubjectType === 'product')
      && (personaPool.length > 0 || Boolean(resolvedModelId))
      && (resolvedImageEngine === 'nano-banana' || resolvedImageEngine === 'nano-banana-2' || resolvedImageEngine === 'nano-banana-pro')
    ) {
      resolvedImageEngine = primaryReferenceImageUrl && normalizePersonaGenerationMode(generationMode) === 'exact'
        ? 'flux-kontext-lora'
        : 'flux-dev-lora';
      console.warn('[image/generate] Persona requested Nano Banana as base; rerouting to LoRA identity base before creative rebuild.', {
        requestedEngine: imageEngine,
        reroutedEngine: resolvedImageEngine,
      });
    }
    const shouldPreferReplicateReferenceLora =
      resolvedImageEngine === 'flux-kontext-lora'
      && personaLoraUrls.length > 0
      && personaLoraUrls.some((url) => isArchiveLoraUrl(url));
    console.log('[image/generate] ROUTING:', {
      requestedEngine: imageEngine || '(none)',
      resolvedImageEngine,
      isRefinePass,
      personaCount: personaPool.length,
      resolvedModelId: resolvedModelId || '(none)',
      resolvedDestinationModel: resolvedDestinationModel || '(none)',
      isFalTrainingJob: isFalTrainingJobId(resolvedModelId),
      hasResolvableReplicateModelId,
      personaLoraUrls: personaLoraUrls.length,
      shouldPreferTrainedModel,
      shouldUseExternalLoras,
    });
    const resolveAbsoluteUrl = (url: string) => {
      const raw = safeTrim(url);
      if (!raw) return '';
      if (/^https?:\/\//i.test(raw)) return raw;
      const baseUrl = getSiteUrlFromRequest(request);
      return raw.startsWith('/') ? `${baseUrl}${raw}` : raw;
    };
    const prepareReferenceImageUrlForProvider = async (url: string) => {
      const safeUrl = safeTrim(url);
      if (!safeUrl) return '';
      return ensurePublicAssetUrl(
        { url: safeUrl, suggestedName: 'reference.png' },
        {
          token: apiToken,
          resolveAbsoluteUrl,
          bypassReplicateFileApi: false,
        }
      );
    };
    const prepareFalCompatibleLoraUrl = async (url: string) => {
      const safeUrl = safeTrim(url);
      if (!safeUrl) return '';
      const media = await downloadMediaWithValidation(safeUrl, {
        token: apiToken,
        strictExpectedKind: false,
      });
      const normalized = normalizeLoraWeightsBuffer(media.buffer, safeUrl);
      if (normalized.kind !== 'safetensors') {
        throw new Error('LoRA weights could not be normalized to a safetensors file for fal.ai.');
      }
      const canReuseOriginalUrl =
        !normalized.extractedFromArchive
        && /^https:\/\//i.test(safeUrl)
        && !safeUrl.toLowerCase().includes('api.replicate.com/v1/files/');
      if (canReuseOriginalUrl) {
        return safeUrl;
      }
      return saveBufferToPublic(normalized.buffer, normalized.extension, 'generated/persona-loras');
    };
    const prepareFalCompatibleLoraUrls = async (urls: string[]) =>
      uniqStrings((await Promise.all(urls.map((url) => prepareFalCompatibleLoraUrl(url)))).filter(Boolean));
    const triggerWords = uniqStrings([
      triggerWord ? String(triggerWord).trim() : '',
      ...personaPool.map((p) => p?.triggerWord || (p as any)?.trigger_word || ''),
    ]);
    const resolvedTrigger = triggerWords[0] || (triggerWord ? String(triggerWord).trim() : '');

    const hasPersonaContext = personaPool.length > 0 || Boolean(resolvedModelId);
    // Human personas only stay recognizable when the face is large in frame; wide/full-body shots destroy identity.
    const lockHumanPersonaFraming = isHumanPersonaSubject && hasPersonaContext;
    const humanIdentityFramingRule = lockHumanPersonaFraming
      ? '- IDENTITY FRAMING (critical): keep the trained person clearly recognizable. Use a close-up to medium shot where the face is large, sharp, well-lit, and front-facing or three-quarter. Never place the subject far from camera; avoid wide full-body, distant, or tiny-face shots. The face must occupy a significant portion of the frame so the trained identity is preserved, even if the user idea implies motion.'
      : '';

    // Video route parity: first run Gemini to shape a scene-specific single-frame image prompt.
    if (process.env.GEMINI_API_KEY?.trim() && !isRefinePass) {
      try {
        const preferredModel = process.env.GEMINI_PRODUCT_PROMPT_MODEL || 'gemini-2.5-flash';
        const resolvedGeminiModel = await getGeminiModelId(process.env.GEMINI_API_KEY, preferredModel);
        const geminiModel = genAI.getGenerativeModel({
          model: resolvedGeminiModel,
          generationConfig: { temperature: 0, topP: 1, topK: 1 },
        });
        const directorGuidance = buildSceneDirectorGuidance(resolvedSubjectType || 'human', 'image');
        const singlePhotoRules = buildSinglePhotographRules(rawPrompt);
        const phase1Prompt = `
You are an elite cinematic director and visual prompt engineer. ${directorGuidance} Return ONLY valid JSON:
{
  "mode": "ACTION_MODE | TALKING_MODE",
  "image_prompt": "<write the final production-ready photorealistic cinematic image prompt here in English>"
}
Rules:
- image_prompt must be 60-120 words maximum, written as a pure camera-facing visual description in English.
- Describe only what the camera sees: subject, framing, environment, lighting, materials, mood, lens feel. No meta-instructions, no rule text, no schema labels, no "must preserve" wording.
- ${singlePhotoRules}
- If user intent implies motion/action, choose ACTION_MODE and freeze at a decisive instant.
- ${identityGuidance}
${humanIdentityFramingRule}
- For product personas, write a premium commercial product prompt that works for any physical product category. First infer the product DNA that must never change: exact silhouette, proportions, logo/brand/text placement, label geometry, material finish, color blocking, buttons, ports, caps, clips, closures, straps, buckles, zipper pulls, seams, stitching, panel lines, hardware, texture, markings, and strongest identifying surface. The product face with logo/brand area or strongest identifying marks must be visible, sharp, and unobstructed. Prefer a clean standalone front/top three-quarter or category-appropriate hero angle that reveals distinctive design details. Avoid hands unless the user explicitly asks for usage. If hands appear, they must be natural, ergonomic, and must not cover the product or brand area. Never let lighting, hands, environment, or action become more important than product identity. If the user mentions ad slogans or campaign copy, use them only to set mood — never as visible text inside the photograph. ${productNaturalInteractionRule}
- The image_prompt must naturally include persona, camera/framing, environment, frozen pose, lighting, and this style baseline: photorealistic, 8k, cinematic, Hollywood-level production design, exceptional environmental realism, premium color grading. ${subjectFocusGuidance}
- Do not copy placeholder text, schema labels, brackets, or instruction wording into image_prompt.
- No multi-step sequence language. Only one frame. One photograph. No collage.
User idea: "${rawPrompt}"
Persona token: "${resolvedTrigger || 'TOK'}"
`;
        const phase1 = await geminiModel.generateContent(phase1Prompt);
        const phase1Text = phase1.response.text().trim();
        const phase1Json = extractGeminiJson(phase1Text) as
          | { mode?: string; image_prompt?: string }
          | null;
        if (phase1Json?.image_prompt?.trim()) imagePrompt = cleanPromptInstructionLeak(phase1Json.image_prompt);
        if (String(phase1Json?.mode || '').trim().toUpperCase() === 'ACTION_MODE') {
          resolvedIsActionMode = true;
        }
      } catch (error) {
        console.warn('[image/generate] Gemini phase-1 failed, fallback to raw prompt.', error);
      }
    }

    // For human personas, recognizable identity beats a wide action frame. Wide/full-body shots shrink
    // the face until the trained identity is lost, so prioritise face-forward framing and keep the user's aspect.
    if (resolvedIsActionMode && lockHumanPersonaFraming) {
      resolvedIsActionMode = false;
      console.log('[image/generate] Human persona: prioritising identity framing over wide action shot');
    }

    if (resolvedIsActionMode) {
      imagePrompt = buildFluxActionPrompt(imagePrompt, {
        triggerWord: resolvedTrigger || undefined,
        opponentOrContext: opponentOrContext ? String(opponentOrContext).trim() : undefined,
      });
      console.log('[image/generate] ACTION_MODE: using wide shot + no portrait prompt');
    }

    imagePrompt = enforceProductVisibility(imagePrompt);

    if (dryRun === true || dryRun === 'true' || dryRun === 1 || dryRun === '1') {
      return NextResponse.json({
        success: true,
        dryRun: true,
        plannedEngine: resolvedImageEngine,
        plannedModel:
          resolvedImageEngine === 'nano-banana'
            ? (process.env.REPLICATE_NANO_BANANA_MODEL || 'google/nano-banana')
            : resolvedImageEngine === 'nano-banana-pro'
            ? (process.env.REPLICATE_NANO_BANANA_PRO_MODEL || 'google/nano-banana-pro')
            : resolvedImageEngine === 'nano-banana-2'
            ? (process.env.REPLICATE_NANO_BANANA_2_MODEL || 'google/nano-banana-2')
            : resolvedImageEngine === 'flux-kontext-lora'
            ? (shouldPreferReplicateReferenceLora
                ? 'black-forest-labs/flux-2-klein-9b-base-lora'
                : 'fal-ai/flux-kontext-lora/image-to-image')
            : resolvedImageEngine === 'flux-kontext-pro'
              ? 'fal-ai/flux-pro/kontext'
              : resolvedImageEngine === 'flux-2-max'
                ? 'black-forest-labs/flux-2-max'
                : shouldUseExternalLoras
                  ? (shouldUseMultiLoraEndpoint
                      ? configuredMultiLoraModel
                      : (process.env.REPLICATE_FLUX_LORA_MODEL || 'black-forest-labs/flux-dev-lora'))
                  : (resolvedDestinationModel || personaModelId || trainingId || 'black-forest-labs/flux-2-max'),
        plannedSteps: fluxSteps,
        plannedSeed: stableSeedFromParts(rawPrompt, resolvedTrigger, aspect.fluxAspectRatio, resolvedImageEngine, resolvedModelId, resolvedDestinationModel),
        plannedAspect: aspect,
        triggerWords,
        referenceImageUrl: primaryReferenceImageUrl || null,
        imagePrompt,
        productVisibilityGuidance: productVisibilityGuidance || null,
      });
    }

    if (
      resolvedImageEngine === 'nano-banana'
      || resolvedImageEngine === 'nano-banana-2'
      || resolvedImageEngine === 'nano-banana-pro'
    ) {
      if (!replicate) {
        return NextResponse.json(
          { error: 'REPLICATE_API_TOKEN not configured for Nano Banana' },
          { status: 500 }
        );
      }

      const nanoModel =
        resolvedImageEngine === 'nano-banana-pro'
          ? (process.env.REPLICATE_NANO_BANANA_PRO_MODEL || 'google/nano-banana-pro')
          : resolvedImageEngine === 'nano-banana-2'
            ? (process.env.REPLICATE_NANO_BANANA_2_MODEL || 'google/nano-banana-2')
            : (process.env.REPLICATE_NANO_BANANA_MODEL || 'google/nano-banana');
      // Gemini 3 family (Pro / NB2) accepts more reference shots; more persona angles = stronger identity lock.
      const isGemini3Nano = resolvedImageEngine === 'nano-banana-pro' || resolvedImageEngine === 'nano-banana-2';
      const maxNanoReferences = resolvedImageEngine === 'nano-banana-pro' ? 10 : isGemini3Nano ? 8 : 6;

      // Nano Banana keeps identity by referencing input images (persona shots + any uploaded reference).
      const preparedNanoReferences = uniqStrings(
        await Promise.all(
          resolvedReferenceImageUrls.slice(0, maxNanoReferences).map((url) => prepareReferenceImageUrlForProvider(url))
        )
      ).filter(Boolean);

      const strategyMode = resolveGenerationMode({
        requestedMode: (body as any)?.generationStrategy || (body as any)?.generation_mode,
        qualityPreset,
        target: 'image',
        hasPersona: personaPool.length > 0 || Boolean(resolvedModelId),
        isAction: resolvedIsActionMode,
      });
      const nanoPrompt = buildNanoBananaPrompt({
        subjectType: resolvedSubjectType || 'human',
        creativeBrief: imagePrompt,
        mode: strategyMode,
        isRefinePass,
        isAction: resolvedIsActionMode,
        strictIdentity: Boolean(personaPool.length > 0 || resolvedModelId),
      });
      console.log('[image/generate] Nano Banana prompt:', {
        engine: resolvedImageEngine,
        isRefinePass,
        subjectType: resolvedSubjectType || 'human',
        promptChars: nanoPrompt.length,
        referenceCount: resolvedReferenceImageUrls.length,
      });
      // Refine should preserve identity but still rebuild the shot to match the user's chosen format.
      const nanoAspectRatio = resolvedIsActionMode ? '16:9' : aspect.fluxAspectRatio;
      const nanoInput: Record<string, any> = {
        prompt: nanoPrompt,
        aspect_ratio: nanoAspectRatio,
        output_format: 'png',
      };
      if (preparedNanoReferences.length > 0) {
        nanoInput.image_input = preparedNanoReferences;
      }
      if (resolvedImageEngine === 'nano-banana-pro') {
        // Studio-grade refiner: push resolution and keep the safety filter at its most permissive
        // setting so legitimate real-person digital twins aren't false-flagged.
        nanoInput.resolution = getNanoRefinerResolution(strategyMode, resolvedSubjectType, isRefinePass);
        nanoInput.safety_filter_level = 'block_only_high';
      } else if (resolvedImageEngine === 'nano-banana-2') {
        nanoInput.resolution = getNanoRefinerResolution(
          strategyMode === 'fast' ? 'fast' : 'standard',
          resolvedSubjectType,
          isRefinePass
        );
        nanoInput.safety_filter_level = 'block_only_high';
      }

      const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
      const getErrorStatus = (err: any) => Number(err?.response?.status || err?.status || 0);
      const errMessage = (err: any) => String(err?.message || '');
      const isInsufficientCredit = (err: any) =>
        getErrorStatus(err) === 402 || /insufficient credit|payment required/i.test(errMessage(err));
      const isRateLimited = (err: any) =>
        getErrorStatus(err) === 429 || /throttl|too many requests/i.test(errMessage(err));
      const isInvalidInput = (err: any) => [400, 422].includes(getErrorStatus(err));
      const getRetryAfterSeconds = (err: any) => {
        const headerValue = Number(err?.response?.headers?.get?.('retry-after'));
        if (Number.isFinite(headerValue) && headerValue > 0) return headerValue;
        const match = errMessage(err).match(/resets in ~?(\d+)\s*s/i);
        return match ? Number(match[1]) : 0;
      };

      let nanoOutput: unknown;
      let nanoError: unknown;
      let droppedAspectRatio = false;
      let droppedSafetyFilter = false;
      for (let attempt = 0; attempt < 4; attempt += 1) {
        try {
          nanoOutput = await replicate.run(nanoModel as `${string}/${string}`, { input: nanoInput });
          nanoError = undefined;
          break;
        } catch (error) {
          nanoError = error;
          // No point retrying when the account simply has no credit.
          if (isInsufficientCredit(error)) {
            break;
          }
          if (isRateLimited(error) && attempt < 3) {
            const waitSeconds = Math.min(getRetryAfterSeconds(error) || 8, 12);
            console.warn(`[image/generate] nano-banana throttled (429), waiting ${waitSeconds}s before retry ${attempt + 1}/3`);
            await sleep((waitSeconds + 1) * 1000);
            continue;
          }
          // Self-heal optional params some model versions may reject (e.g. safety_filter_level).
          if (isInvalidInput(error) && !droppedSafetyFilter && 'safety_filter_level' in nanoInput) {
            droppedSafetyFilter = true;
            delete nanoInput.safety_filter_level;
            console.warn('[image/generate] nano-banana retry without safety_filter_level:', errMessage(error));
            continue;
          }
          // Only drop aspect_ratio for genuine input-validation errors, not billing/rate issues.
          if (isInvalidInput(error) && !droppedAspectRatio && 'aspect_ratio' in nanoInput) {
            droppedAspectRatio = true;
            delete nanoInput.aspect_ratio;
            console.warn('[image/generate] nano-banana retry without aspect_ratio:', errMessage(error));
            continue;
          }
          break;
        }
      }

      if (nanoError && !nanoOutput) {
        if (isInsufficientCredit(nanoError)) {
          return NextResponse.json(
            {
              error: 'Your Replicate account is out of credit, so Nano Banana cannot run. Add credit at replicate.com/account/billing, wait a few minutes, then try again.',
              code: 'REPLICATE_INSUFFICIENT_CREDIT',
            },
            { status: 402 }
          );
        }
        if (isRateLimited(nanoError)) {
          return NextResponse.json(
            {
              error: 'Nano Banana is rate-limited on your Replicate account because the balance is under $5. Add credit at replicate.com/account/billing to lift the throttle, then try again.',
              code: 'REPLICATE_RATE_LIMITED',
            },
            { status: 429 }
          );
        }
        throw nanoError;
      }

      let nanoUrl = extractImageUrl(nanoOutput);
      if (!nanoUrl) {
        const stream = findFirstStream(nanoOutput);
        if (stream) nanoUrl = await saveStreamToPublic(stream, 'png');
      }
      if (!nanoUrl) {
        return NextResponse.json(
          { error: 'Nano Banana image generation failed' },
          { status: 500 }
        );
      }
      const refinementDecision = isRefinePass
        ? decideRefinementOutput({
            baseUrl: preparedNanoReferences[0],
            refinedUrl: nanoUrl,
            hadRuntimeError: Boolean(nanoError),
          })
        : { useRefined: true, reason: 'direct_generation', shouldRetry: false };
      const outputUrl = refinementDecision.useRefined
        ? nanoUrl
        : (preparedNanoReferences[0] || nanoUrl);
      if (!refinementDecision.useRefined) {
        console.warn('[image/generate] Nano refinement did not improve the base; falling back.', refinementDecision);
      }
      return NextResponse.json({
        output: outputUrl,
        engine: resolvedImageEngine,
        model: nanoModel,
        referenceImageUrl: preparedNanoReferences[0] || null,
        refinementDecision,
      });
    }

    if (
      (resolvedImageEngine === 'flux-kontext-lora' || resolvedImageEngine === 'flux-kontext-pro')
      && primaryReferenceImageUrl
    ) {
      const preparedReferenceImageUrl = await prepareReferenceImageUrlForProvider(primaryReferenceImageUrl);
      const stableSeed = stableSeedFromParts(
        rawPrompt,
        resolvedTrigger,
        preparedReferenceImageUrl,
        aspect.fluxAspectRatio,
        resolvedImageEngine,
        resolvedModelId,
        resolvedDestinationModel
      );
      const preservePrompt = ensurePromptHasTriggers(
        `${identityGuidance} ${imagePrompt}`.trim(),
        triggerWords
      );
      const runReplicateReferenceLora = async () => {
        if (!replicate) {
          throw new Error('REPLICATE_API_TOKEN not configured');
        }
        const output = await replicate.run('black-forest-labs/flux-2-klein-9b-base-lora', {
          input: {
            images: [preparedReferenceImageUrl],
            prompt: preservePrompt,
            lora_weights: personaLoraUrls,
            lora_scales: personaLoraUrls.map(() => 1),
            aspect_ratio: 'match_input_image',
            output_megapixels: wantsHighQuality ? '2' : '1',
            output_format: 'jpg',
            output_quality: 95,
            seed: stableSeed,
          },
        });
        let url = extractImageUrl(output);
        if (!url) {
          const stream = findFirstStream(output);
          if (stream) url = await saveStreamToPublic(stream, 'jpg');
        }
        if (!url) {
          return NextResponse.json(
            { error: 'FLUX 2 Klein reference image generation failed' },
            { status: 500 }
          );
        }
        return NextResponse.json({
          output: url,
          engine: 'flux-2-klein-9b-base-lora',
          referenceImageUrl: preparedReferenceImageUrl,
        });
      };
      const canUseKontextLora = resolvedImageEngine === 'flux-kontext-lora'
        && personaLoraUrls.length > 0
        && Boolean(process.env.FAL_KEY?.trim());

      if (shouldPreferReplicateReferenceLora && replicate) {
        return runReplicateReferenceLora();
      }

      if (canUseKontextLora) {
        try {
          const falLoraUrls = await prepareFalCompatibleLoraUrls(personaLoraUrls);
          const fal = ensureFalConfigured();
          const output = await fal.subscribe('fal-ai/flux-kontext-lora/image-to-image', {
            input: {
              image_url: preparedReferenceImageUrl,
              prompt: preservePrompt,
              loras: falLoraUrls.map((url) => ({ path: url, scale: 1 })),
              num_inference_steps: Math.max(24, fluxSteps),
              guidance_scale: 2.5,
              strength: resolvedIsActionMode ? 0.92 : 0.88,
              output_format: 'png',
              seed: stableSeed,
              enable_safety_checker: false,
            } as any,
            logs: true,
          } as any);
          const url = safeTrim((output as any)?.data?.images?.[0]?.url || (output as any)?.images?.[0]?.url);
          if (!url) {
            return NextResponse.json(
              { error: 'Flux Kontext LoRA image generation failed' },
              { status: 500 }
            );
          }
          return NextResponse.json({ output: url, engine: 'flux-kontext-lora', referenceImageUrl: preparedReferenceImageUrl });
        } catch (error) {
          if (replicate && personaLoraUrls.length > 0) {
            console.warn('[image/generate] flux-kontext-lora fallback -> flux-2-klein-9b-base-lora:', error);
            return runReplicateReferenceLora();
          }
          throw error;
        }
      }

      if (process.env.FAL_KEY?.trim()) {
        const fal = ensureFalConfigured();
        const output = await fal.subscribe('fal-ai/flux-pro/kontext', {
          input: {
            prompt: preservePrompt,
            image_url: preparedReferenceImageUrl,
            aspect_ratio: resolvedIsActionMode ? '16:9' : aspect.fluxAspectRatio,
            guidance_scale: 3.5,
            num_images: 1,
            output_format: 'png',
            seed: stableSeed,
            enhance_prompt: false,
          } as any,
          logs: true,
        } as any);
        const url = safeTrim((output as any)?.data?.images?.[0]?.url || (output as any)?.images?.[0]?.url);
        if (!url) {
          return NextResponse.json(
            { error: 'Flux Kontext Pro image generation failed' },
            { status: 500 }
          );
        }
        return NextResponse.json({ output: url, engine: 'flux-kontext-pro', referenceImageUrl: preparedReferenceImageUrl });
      }

      if (!replicate) {
        return NextResponse.json(
          { error: 'No image generation provider is configured for exact mode' },
          { status: 500 }
        );
      }

      const kontextOutput = await replicate.run('black-forest-labs/flux-kontext-pro', {
        input: {
          prompt: preservePrompt,
          input_image: preparedReferenceImageUrl,
          aspect_ratio: resolvedIsActionMode ? '16:9' : aspect.fluxAspectRatio,
          output_format: 'png',
          seed: stableSeed,
        },
      });
      let url = extractImageUrl(kontextOutput);
      if (!url) {
        const stream = findFirstStream(kontextOutput);
        if (stream) url = await saveStreamToPublic(stream, 'png');
      }
      if (!url) {
        return NextResponse.json(
          { error: 'Flux Kontext Pro image generation failed' },
          { status: 500 }
        );
      }
      return NextResponse.json({ output: url, engine: 'flux-kontext-pro', referenceImageUrl: preparedReferenceImageUrl });
    }

    if (shouldUseExternalLoras) {
      const model = shouldUseMultiLoraEndpoint
        ? configuredMultiLoraModel
        : (process.env.REPLICATE_FLUX_LORA_MODEL || 'black-forest-labs/flux-dev-lora');

      console.log('[image/generate] HF LoRA branch:', {
        model,
        loraCount: personaLoraUrls.length,
        loraUrls: personaLoraUrls,
        trigger: resolvedTrigger || triggerWords[0] || '(none)',
      });

      const loraPrompt = ensurePromptHasTriggers(imagePrompt, triggerWords);
      const stableSeed = stableSeedFromParts(
        rawPrompt,
        resolvedTrigger,
        aspect.fluxAspectRatio,
        resolvedImageEngine,
        personaLoraUrls.join(','),
        resolvedModelId,
        resolvedDestinationModel
      );
      const baseInput: Record<string, any> = {
        prompt: loraPrompt,
        output_format: 'png',
        aspect_ratio: resolvedIsActionMode ? '16:9' : aspect.fluxAspectRatio,
        output_quality: 100,
        num_inference_steps: fluxSteps,
        seed: stableSeed,
      };

      if (!replicate && process.env.FAL_KEY?.trim()) {
        const falLoraUrls = await prepareFalCompatibleLoraUrls(personaLoraUrls);
        const fal = ensureFalConfigured();
        const output = await fal.subscribe('fal-ai/flux-lora', {
          input: {
            prompt: loraPrompt,
            loras: falLoraUrls.map((url) => ({ path: url, scale: 1 })),
            image_size: resolveFalImageSize(resolvedIsActionMode ? '16:9' : aspect.fluxAspectRatio),
            output_format: 'png',
            num_images: 1,
            seed: stableSeed,
            enable_safety_checker: false,
          } as any,
          logs: true,
        } as any);
        const url = safeTrim((output as any)?.data?.images?.[0]?.url || (output as any)?.images?.[0]?.url);
        if (!url) {
          return NextResponse.json(
            { error: 'Flux LoRA image generation failed' },
            { status: 500 }
          );
        }
        return NextResponse.json({ output: url, loras: personaLoraUrls, engine: 'flux-dev-lora' });
      }

      if (!replicate) {
        return NextResponse.json(
          { error: 'No image generation provider is configured' },
          { status: 500 }
        );
      }

      let output: any = null;
      if (shouldUseMultiLoraEndpoint) {
        // Multi-LoRA: array input
        const richInput = { ...baseInput, hf_loras: personaLoraUrls };
        try {
          output = await replicate.run(model as any, { input: richInput });
        } catch {
          // Fallback for models that don't accept some optional fields
          output = await replicate.run(model as any, { input: { prompt: loraPrompt, hf_loras: personaLoraUrls } });
        }
      } else {
        // Single LoRA, or safe primary-LoRA fallback when no valid multi-LoRA endpoint is configured.
        const url = primaryPersonaLoraUrl;
        const richInput = { ...baseInput, lora_weights: url, lora_scale: productLoraScale };
        try {
          output = await replicate.run(model as any, { input: richInput });
        } catch {
          output = await replicate.run(model as any, { input: { prompt: loraPrompt, lora_weights: url, lora_scale: productLoraScale } });
        }
      }

      let url = extractImageUrl(output);
      if (!url) {
        const stream = findFirstStream(output);
        if (stream) url = await saveStreamToPublic(stream, 'png');
      }
      if (!url) {
        return NextResponse.json(
          { error: 'HF LoRA image generation failed' },
          { status: 500 }
        );
      }
      return NextResponse.json({ output: url, loras: personaLoraUrls, engine: 'flux-dev-lora' });
    }

    if (shouldPreferTrainedModel && (resolvedModelId || resolvedDestinationModel)) {
      if (!replicate) {
        return NextResponse.json(
          { error: 'REPLICATE_API_TOKEN not configured' },
          { status: 500 }
        );
      }
      let targetVersion = (personaModelId || trainingId || resolvedDestinationModel) as string;
      const rawTargetIdentifier = targetVersion;
      if (!targetVersion.includes('/') && !targetVersion.includes(':')) {
        try {
          const training = await replicate.trainings.get(targetVersion);
          const resolvedVersion = training?.output?.version || training?.version || '';
          console.log('[image/generate] trainings.get resolved:', {
            input: rawTargetIdentifier,
            status: (training as any)?.status,
            resolvedVersion: resolvedVersion || '(none)',
            hasOutput: Boolean(training?.output),
          });
          targetVersion = resolvedVersion || resolvedDestinationModel || targetVersion;
        } catch (error) {
          console.warn('[image/generate] trainings.get FAILED for', rawTargetIdentifier, '-', String((error as any)?.message || error));
          targetVersion = resolvedDestinationModel || targetVersion;
        }
      }
      console.log('[image/generate] Persona trained-model branch:', {
        targetVersion,
        trigger: triggerWord || triggerWords[0] || '(none)',
        subjectType: resolvedSubjectType || 'human',
        engine: resolvedImageEngine,
      });
      if (!targetVersion.includes('/') && !targetVersion.includes(':')) {
        return NextResponse.json(
          { error: 'Persona model version could not be resolved' },
          { status: 400 }
        );
      }
      const personaAnchorPrefix = isHumanPersonaSubject
        ? 'identity-locked subject, same person as trained persona, close-up to medium close-up framing, face centered, clear eyes, natural skin texture, symmetric facial proportions, ultra-sharp facial details, no facial distortion, no face drift,'
        : resolvedSubjectType === 'animal'
          ? 'identity-locked subject, same exact animal as trained persona, preserve species, fur pattern, face markings, eye color, anatomy, and body proportions, subject centered, ultra-sharp texture details, no anatomy distortion, no identity drift,'
          : resolvedSubjectType === 'product'
            ? `identity-locked premium product hero shot, same exact trained product persona, not a generic product category, category-appropriate front/top three-quarter hero angle, logo/brand area or strongest identifying mark visible and sharp, preserve exact silhouette, shape, proportions, material finish, color blocking, labels, engravings, buttons, caps, clips, closures, straps, buckles, zipper pulls, ports, seams, stitching, panel lines, markings, hardware, texture, and logo/brand placement, centered commercial framing, product fully visible and unobstructed, clean standalone product packshot preferred, no hands unless explicitly requested, no awkward or reversed grip, no hidden-logo angle, no cropping, no deformation, no extra parts, no replacement product, ${productNaturalInteractionRule}`
            : 'identity-locked subject, same exact trained subject, preserve defining silhouette, proportions, texture, markings, and distinctive features, centered framing, no deformation, no identity drift,';
      const personaActionAnchorPrefix = isHumanPersonaSubject
        ? 'identity-locked subject, same person as trained persona, full-body dynamic action frame, clear visible face, ultra-sharp facial details, no facial distortion, no face drift,'
        : resolvedSubjectType === 'animal'
          ? 'identity-locked subject, same exact animal as trained persona, dynamic action frame, preserve anatomy, fur pattern, markings, and eye color, no anatomy distortion, no identity drift,'
          : resolvedSubjectType === 'product'
            ? `identity-locked dynamic commercial product hero still, same exact trained product persona, not a generic product category, category-appropriate angle that keeps logo/brand area or strongest identifying marks visible, preserve silhouette, proportions, material finish, color blocking, labels, engravings, buttons, caps, clips, closures, straps, buckles, zipper pulls, ports, seams, stitching, panel lines, markings, hardware, texture, and logo/brand placement, product fully visible and unobstructed, no hands covering it, no hidden-logo angle, no cropped product, no awkward or reversed grip, no deformation, no extra parts, no replacement product, ${productNaturalInteractionRule}`
            : 'identity-locked subject, same exact trained subject, dynamic hero frame, preserve silhouette, proportions, texture, markings, and defining features, no deformation, no identity drift,';
      const personaPrompt = resolvedIsActionMode
        ? `${personaActionAnchorPrefix} ${triggerWord || triggerWords[0] || 'TOK'}, ${imagePrompt}`.trim()
        : `${personaAnchorPrefix} ${triggerWord || triggerWords[0] || 'TOK'}, ${imagePrompt}`.trim();
      const stableSeed = stableSeedFromParts(
        rawPrompt,
        resolvedTrigger,
        aspect.fluxAspectRatio,
        resolvedImageEngine,
        targetVersion,
        resolvedDestinationModel
      );

      const imageOutput = await replicate.run(targetVersion as `${string}/${string}` | `${string}/${string}:${string}`, {
        input: {
          prompt: ensurePromptHasTriggers(personaPrompt, triggerWords),
          output_format: 'png',
          disable_safety_checker: true,
          aspect_ratio: resolvedIsActionMode ? '16:9' : aspect.fluxAspectRatio,
          num_inference_steps: fluxSteps,
          guidance_scale: isProductPersonaSubject ? 5.2 : (wantsHighQuality ? 4.5 : 3.5),
          lora_scale: productLoraScale,
          seed: stableSeed,
        },
      });

      let url = extractImageUrl(imageOutput);
      if (!url) {
        const stream = findFirstStream(imageOutput);
        if (stream) url = await saveStreamToPublic(stream, 'png');
      }
      if (!url) {
        return NextResponse.json(
          { error: 'Persona image generation failed' },
          { status: 500 }
        );
      }
      return NextResponse.json({ output: url, engine: resolvedImageEngine });
    }

    // Flux 2 Max
    if (!replicate) {
      return NextResponse.json(
        { error: 'No image generation provider is configured' },
        { status: 500 }
      );
    }
    if (personaPool.length > 0 || resolvedModelId) {
      console.warn('[image/generate] ⚠️ PERSONA SELECTED BUT NO IDENTITY BRANCH MATCHED — falling back to plain flux-2-max (no LoRA, no trigger word). This produces a random face. routing:', {
        resolvedImageEngine,
        resolvedModelId: resolvedModelId || '(none)',
        resolvedDestinationModel: resolvedDestinationModel || '(none)',
        isFalTrainingJob: isFalTrainingJobId(resolvedModelId),
        hasResolvableReplicateModelId,
        personaLoraUrls: personaLoraUrls.length,
        shouldPreferTrainedModel,
        shouldUseExternalLoras,
      });
    }
    const fluxOutput = await replicate.run('black-forest-labs/flux-2-max', {
      input: {
        prompt: imagePrompt,
        aspect_ratio: resolvedIsActionMode ? '16:9' : aspect.fluxAspectRatio,
        output_quality: 100,
        output_format: 'png',
        num_inference_steps: fluxSteps,
        seed: stableSeedFromParts(rawPrompt, aspect.fluxAspectRatio, resolvedImageEngine),
      },
    });

    let url = extractImageUrl(fluxOutput);
    if (!url) {
      const stream = findFirstStream(fluxOutput);
      if (stream) url = await saveStreamToPublic(stream, 'png');
    }
    if (!url) {
      return NextResponse.json(
        { error: 'Flux image generation failed' },
        { status: 500 }
      );
    }

    return NextResponse.json({ output: url, engine: 'flux-2-max' });
  } catch (error: any) {
    console.error('[image/generate]', error);
    return NextResponse.json(
      { error: error?.message ?? 'Image generation failed' },
      { status: 500 }
    );
  }
}
