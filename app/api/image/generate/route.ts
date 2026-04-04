import { NextRequest, NextResponse } from 'next/server';
import Replicate from 'replicate';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { ensureFalConfigured } from '@/lib/fal';
import {
  buildFluxActionPrompt,
  isActionLikePrompt,
} from '@/lib/flux-action-prompts';
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

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

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
const isFluxModelRef = (value: unknown) => {
  const normalized = safeTrim(value).toLowerCase();
  return !normalized || normalized.includes('flux');
};
const isUnsupportedLegacyPersona = (value: any) => {
  const modelFamily = safeTrim(value?.modelFamily ?? value?.model_family).toLowerCase();
  const trainingBaseModel = safeTrim(value?.trainingBaseModel ?? value?.training_base_model).toLowerCase();
  const destinationModel = safeTrim(value?.destinationModel ?? value?.destination_model).toLowerCase();
  return (modelFamily && modelFamily !== 'flux-lora')
    || !isFluxModelRef(trainingBaseModel)
    || !isFluxModelRef(destinationModel);
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

const extractPersonaReferenceUrls = (persona: PersonaRecord | Record<string, any>) => uniqStrings([
  ...normalizeReferenceImageUrls((persona as any)?.referenceImages),
  ...normalizeReferenceImageUrls((persona as any)?.reference_images),
]);

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
      dryRun,
    } = body;

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
    const fluxSteps = clampFluxInferenceSteps(wantsHighQuality ? 50 : 40);
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
    const personaPool = [...providedPersonas, ...loadedPersonas];
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
    const subjectFocusGuidance = isHumanPersonaSubject
      ? 'The background must be highly detailed and cinematic but must not overpower the subject\'s face.'
      : resolvedSubjectType === 'animal'
        ? 'The subject must stay dominant and anatomically consistent. The environment must support the animal without overpowering its fur pattern, markings, or silhouette.'
        : resolvedSubjectType === 'product'
          ? 'The product must stay dominant, centered, and geometrically accurate. The environment must support the product without overpowering its silhouette, logo placement, or material details.'
          : 'The subject must stay dominant and consistent. The environment must support the subject without overpowering its defining silhouette, markings, texture, or proportions.';
    const identityGuidance = isHumanPersonaSubject
      ? 'Keep the subject identity locked and consistent.'
      : resolvedSubjectType === 'animal'
        ? 'Keep the animal identity, anatomy, fur pattern, markings, and proportions locked and consistent.'
        : resolvedSubjectType === 'product'
          ? 'Keep the product identity, silhouette, proportions, materials, and logo placement locked and consistent.'
          : 'Keep the subject identity, silhouette, proportions, texture, markings, and defining features locked and consistent.';
    const hasResolvableReplicateModelId = Boolean(resolvedModelId) && !isFalTrainingJobId(resolvedModelId);
    const shouldPreferTrainedModel = hasResolvableReplicateModelId && personaLoraUrls.length <= 1;
    const shouldUseExternalLoras = personaLoraUrls.length > 0 && !shouldPreferTrainedModel;
    const resolvedReferenceImageUrls = uniqStrings([
      ...normalizeReferenceImageUrls(referenceImageUrl),
      ...normalizeReferenceImageUrls(referenceImageUrls),
      ...normalizeReferenceImageUrls((body as any)?.reference_image_url),
      ...normalizeReferenceImageUrls((body as any)?.reference_images),
      ...personaPool.flatMap((persona) => extractPersonaReferenceUrls(persona)),
      ...personaPool.flatMap((persona) => [
        safeTrim((persona as any)?.imageUrl),
        safeTrim((persona as any)?.image_url),
      ]),
    ]);
    const primaryReferenceImageUrl = resolvedReferenceImageUrls[0] || '';
    const resolvedImageEngine = resolvePersonaImageEngine({
      requestedEngine: imageEngine,
      hasPersona: personaPool.length > 0 || Boolean(resolvedModelId),
      hasReferenceImage: Boolean(primaryReferenceImageUrl),
      generationMode,
    });
    const shouldPreferReplicateReferenceLora =
      resolvedImageEngine === 'flux-kontext-lora'
      && personaLoraUrls.length > 0
      && personaLoraUrls.some((url) => isArchiveLoraUrl(url));
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

    // Video route parity: first run Gemini to shape a scene-specific single-frame image prompt.
    if (process.env.GEMINI_API_KEY?.trim()) {
      try {
        const preferredModel = 'gemini-2.5-flash';
        const resolvedGeminiModel = await getGeminiModelId(process.env.GEMINI_API_KEY, preferredModel);
        const geminiModel = genAI.getGenerativeModel({
          model: resolvedGeminiModel,
          generationConfig: { temperature: 0.7 },
        });
        const phase1Prompt = `
You are an elite cinematic director and visual prompt engineer. Return ONLY valid JSON:
{
  "mode": "ACTION_MODE | TALKING_MODE",
  "image_prompt": "One complete photorealistic cinematic image prompt (single frozen frame) in English. [Persona]. [Camera/framing]. [Environment]. [Frozen pose]. [Lighting]. [Style: photorealistic, 8k, cinematic, Hollywood-level production design, exceptional environmental realism, premium color grading]. ${subjectFocusGuidance}"
}
Rules:
- If user intent implies motion/action, choose ACTION_MODE and freeze at a decisive instant.
- ${identityGuidance}
- No multi-step sequence language. Only one frame.
User idea: "${rawPrompt}"
Persona token: "${resolvedTrigger || 'TOK'}"
`;
        const phase1 = await geminiModel.generateContent(phase1Prompt);
        const phase1Text = phase1.response.text().trim();
        const phase1Json = extractGeminiJson(phase1Text) as
          | { mode?: string; image_prompt?: string }
          | null;
        if (phase1Json?.image_prompt?.trim()) imagePrompt = phase1Json.image_prompt.trim();
        if (String(phase1Json?.mode || '').trim().toUpperCase() === 'ACTION_MODE') {
          resolvedIsActionMode = true;
        }
      } catch (error) {
        console.warn('[image/generate] Gemini phase-1 failed, fallback to raw prompt.', error);
      }
    }

    if (resolvedIsActionMode) {
      imagePrompt = buildFluxActionPrompt(imagePrompt, {
        triggerWord: resolvedTrigger || undefined,
        opponentOrContext: opponentOrContext ? String(opponentOrContext).trim() : undefined,
      });
      console.log('[image/generate] ACTION_MODE: using wide shot + no portrait prompt');
    }

    if (dryRun === true || dryRun === 'true' || dryRun === 1 || dryRun === '1') {
      return NextResponse.json({
        success: true,
        dryRun: true,
        plannedEngine: resolvedImageEngine,
        plannedModel:
          resolvedImageEngine === 'flux-kontext-lora'
            ? (shouldPreferReplicateReferenceLora
                ? 'black-forest-labs/flux-2-klein-9b-base-lora'
                : 'fal-ai/flux-kontext-lora/image-to-image')
            : resolvedImageEngine === 'flux-kontext-pro'
              ? 'fal-ai/flux-pro/kontext'
              : resolvedImageEngine === 'flux-2-max'
                ? 'black-forest-labs/flux-2-max'
                : shouldUseExternalLoras
                  ? (personaLoraUrls.length > 1
                      ? (process.env.REPLICATE_FLUX_MULTI_LORA_MODEL || 'lucataco/flux-dev-multi-lora')
                      : (process.env.REPLICATE_FLUX_LORA_MODEL || 'black-forest-labs/flux-dev-lora'))
                  : (resolvedDestinationModel || personaModelId || trainingId || 'black-forest-labs/flux-2-max'),
        plannedSteps: fluxSteps,
        plannedAspect: aspect,
        triggerWords,
        referenceImageUrl: primaryReferenceImageUrl || null,
      });
    }

    if (
      (resolvedImageEngine === 'flux-kontext-lora' || resolvedImageEngine === 'flux-kontext-pro')
      && primaryReferenceImageUrl
    ) {
      const preparedReferenceImageUrl = await prepareReferenceImageUrlForProvider(primaryReferenceImageUrl);
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
      const model =
        personaLoraUrls.length > 1
          ? (process.env.REPLICATE_FLUX_MULTI_LORA_MODEL || 'lucataco/flux-dev-multi-lora')
          : (process.env.REPLICATE_FLUX_LORA_MODEL || 'black-forest-labs/flux-dev-lora');

      const loraPrompt = ensurePromptHasTriggers(imagePrompt, triggerWords);
      const baseInput: Record<string, any> = {
        prompt: loraPrompt,
        output_format: 'png',
        aspect_ratio: resolvedIsActionMode ? '16:9' : aspect.fluxAspectRatio,
        output_quality: 100,
        num_inference_steps: fluxSteps,
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
      if (personaLoraUrls.length > 1) {
        // Multi-LoRA: array input
        const richInput = { ...baseInput, hf_loras: personaLoraUrls };
        try {
          output = await replicate.run(model as any, { input: richInput });
        } catch {
          // Fallback for models that don't accept some optional fields
          output = await replicate.run(model as any, { input: { prompt: loraPrompt, hf_loras: personaLoraUrls } });
        }
      } else {
        // Single LoRA
        const url = personaLoraUrls[0];
        const richInput = { ...baseInput, lora_weights: url, lora_scale: 1.0 };
        try {
          output = await replicate.run(model as any, { input: richInput });
        } catch {
          output = await replicate.run(model as any, { input: { prompt: loraPrompt, lora_weights: url, lora_scale: 1.0 } });
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
      if (!targetVersion.includes('/') && !targetVersion.includes(':')) {
        try {
          const training = await replicate.trainings.get(targetVersion);
          targetVersion = training?.output?.version || training?.version || resolvedDestinationModel || targetVersion;
        } catch {
          targetVersion = resolvedDestinationModel || targetVersion;
        }
      }
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
            ? 'identity-locked hero product, same exact product as trained persona, preserve exact silhouette, shape, proportions, materials, reflections, surface finish, buttons, ports, seams, and logo placement, centered commercial framing, no deformation, no extra parts,'
            : 'identity-locked subject, same exact trained subject, preserve defining silhouette, proportions, texture, markings, and distinctive features, centered framing, no deformation, no identity drift,';
      const personaActionAnchorPrefix = isHumanPersonaSubject
        ? 'identity-locked subject, same person as trained persona, full-body dynamic action frame, clear visible face, ultra-sharp facial details, no facial distortion, no face drift,'
        : resolvedSubjectType === 'animal'
          ? 'identity-locked subject, same exact animal as trained persona, dynamic action frame, preserve anatomy, fur pattern, markings, and eye color, no anatomy distortion, no identity drift,'
          : resolvedSubjectType === 'product'
            ? 'identity-locked hero product, same exact product as trained persona, dynamic commercial hero shot, preserve silhouette, proportions, materials, reflections, buttons, ports, seams, and logo placement, no deformation, no extra parts,'
            : 'identity-locked subject, same exact trained subject, dynamic hero frame, preserve silhouette, proportions, texture, markings, and defining features, no deformation, no identity drift,';
      const personaPrompt = resolvedIsActionMode
        ? `${personaActionAnchorPrefix} ${triggerWord || triggerWords[0] || 'TOK'}, ${imagePrompt}`.trim()
        : `${personaAnchorPrefix} ${triggerWord || triggerWords[0] || 'TOK'}, ${imagePrompt}`.trim();

      const imageOutput = await replicate.run(targetVersion as `${string}/${string}` | `${string}/${string}:${string}`, {
        input: {
          prompt: ensurePromptHasTriggers(personaPrompt, triggerWords),
          output_format: 'png',
          disable_safety_checker: true,
          aspect_ratio: resolvedIsActionMode ? '16:9' : aspect.fluxAspectRatio,
          num_inference_steps: fluxSteps,
          guidance_scale: wantsHighQuality ? 4.5 : 3.5,
          lora_scale: 1.0,
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
    const fluxOutput = await replicate.run('black-forest-labs/flux-2-max', {
      input: {
        prompt: imagePrompt,
        aspect_ratio: resolvedIsActionMode ? '16:9' : aspect.fluxAspectRatio,
        output_quality: 100,
        output_format: 'png',
        num_inference_steps: fluxSteps,
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
