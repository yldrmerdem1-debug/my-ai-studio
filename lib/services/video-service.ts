import Replicate from 'replicate';
import { fal } from '@fal-ai/client';

import { MODELS, ModelKey, type Provider } from '@/config/models';

export type GenerateVideoWithFallbackParams = {
  prompt: string;
  modelType: ModelKey;
  imageUrl?: string | null;
  /**
   * Optional overrides; kept minimal so callers can tweak without changing routing logic.
   */
  aspectRatio?: '16:9' | '9:16' | '1:1' | string;
  durationSeconds?: number;
};

export type VideoFallbackOptions = {
  /**
   * Testing / debugging:
   * - "replicate": only try Replicate (no Fal fallback)
   * - "fal": skip Replicate and go directly to Fal
   */
  forceProvider?: Provider;
  durationSeconds?: number;
  aspectRatio?: '16:9' | '9:16' | '1:1' | string;
};

export type VideoGenerationResult = {
  provider: Provider;
  modelType: ModelKey;
  providerModel: string;
  /**
   * Replicate prediction id OR Fal request id (best-effort).
   */
  id: string;
  /**
   * If the provider returns the final url within this call.
   * (Fal subscribe usually does; Replicate path returns once it reaches `processing`.)
   */
  videoUrl?: string;
  status: 'processing' | 'succeeded';
  raw: unknown;
};

const ANSI = {
  reset: '\x1b[0m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  dim: '\x1b[2m',
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const clampDuration = (modelType: ModelKey, seconds: number) => {
  const s = Math.round(Number(seconds));
  if (modelType === ModelKey.KLING_PRO) return Math.max(3, Math.min(15, s || 5));
  // Kling 2.x variants generally accept 5 or 10
  if (modelType === ModelKey.KLING_TURBO || modelType === ModelKey.KLING_STANDARD) {
    return s >= 10 ? 10 : 5;
  }
  return Math.max(1, Math.min(15, s || 5));
};

function extractFirstUrl(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = extractFirstUrl(item);
      if (found) return found;
    }
    return null;
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    for (const key of ['video', 'url', 'mp4', 'output']) {
      const found = extractFirstUrl(obj[key]);
      if (found) return found;
    }
    for (const v of Object.values(obj)) {
      const found = extractFirstUrl(v);
      if (found) return found;
    }
  }
  return null;
}

function getReplicateClient() {
  const token = String(process.env.REPLICATE_API_TOKEN || '').trim();
  return new Replicate({ auth: token });
}

function ensureFalConfigured() {
  const key = String(process.env.FAL_KEY || '').trim();
  // `@fal-ai/client` uses `fal.config({ credentials })`
  fal.config({ credentials: key });
}

function buildVideoInput(params: GenerateVideoWithFallbackParams): Record<string, unknown> {
  const aspect_ratio = (params.aspectRatio || '16:9').toString();
  const duration = clampDuration(params.modelType, params.durationSeconds ?? 5);

  const input: Record<string, unknown> = {
    prompt: String(params.prompt || '').trim(),
    aspect_ratio,
    duration,
  };

  const imageUrl = String(params.imageUrl || '').trim();
  if (imageUrl) {
    // Different providers/models use different keys; we will try start_image first and fall back to image.
    input.start_image = imageUrl;
  }
  return input;
}

function toFalInput(falModel: string, input: Record<string, unknown>) {
  const falInput: Record<string, unknown> = { ...input };

  // Normalize image key per endpoint.
  if (Object.prototype.hasOwnProperty.call(falInput, 'start_image')) {
    const v = (falInput as any).start_image;
    delete (falInput as any).start_image;

    // kling v2.5 turbo pro i2v expects `image_url` (not `start_image_url`)
    if (falModel.includes('/v2.5-turbo/') || falModel.includes('/v2.5/')) {
      if (v) (falInput as any).image_url = v;
    } else {
      if (v) (falInput as any).start_image_url = v;
    }
  }

  // Some endpoints are strict and do NOT accept aspect_ratio.
  if (falModel.includes('/v2.5-turbo/') || falModel.includes('/v2.5/') || falModel.includes('/v2.6/')) {
    delete (falInput as any).aspect_ratio;
  }

  // fal schemas often use enums represented as strings (e.g. duration: "5")
  if (typeof (falInput as any).duration === 'number') {
    (falInput as any).duration = String((falInput as any).duration);
  }
  if (typeof (falInput as any).aspect_ratio !== 'string' && (falInput as any).aspect_ratio != null) {
    (falInput as any).aspect_ratio = String((falInput as any).aspect_ratio);
  }

  return falInput;
}

function makeFalVideoId(model: string, requestId: string) {
  return `fal:${encodeURIComponent(model)}:${requestId}`;
}

async function falSubmit(model: string, input: Record<string, unknown>) {
  ensureFalConfigured();
  const falKey = String(process.env.FAL_KEY || '').trim();
  if (!falKey) {
    throw new Error('FAL_KEY is missing, cannot use fal.ai');
  }
  const submitted = await fal.queue.submit(model, { input: input as any } as any);
  const requestId = String((submitted as any)?.request_id || (submitted as any)?.requestId || '').trim();
  if (!requestId) {
    throw new Error('fal.ai queue.submit returned no request_id');
  }
  return requestId;
}

async function replicateCreatePredictionWithCompatibility(
  replicate: Replicate,
  endpoint: { model: string; version?: string | null },
  input: Record<string, unknown>
) {
  const versionOrModel = endpoint.version ? `${endpoint.model}:${endpoint.version}` : endpoint.model;
  try {
    // Note: this repo historically passes "owner/name" into `version`. We keep that convention for compatibility.
    return await replicate.predictions.create({ version: versionOrModel as any, input: input as any });
  } catch (err) {
    // If the model rejects `start_image`, retry with `image`
    if (Object.prototype.hasOwnProperty.call(input, 'start_image')) {
      const { start_image, ...rest } = input as any;
      const retryInput = { ...rest, image: start_image };
      return await replicate.predictions.create({ version: versionOrModel as any, input: retryInput as any });
    }
    throw err;
  }
}

async function waitUntilProcessingOrDone(options: {
  replicate: Replicate;
  predictionId: string;
  timeoutMs: number;
  pollMs: number;
}) {
  const startedAt = Date.now();
  while (true) {
    const pred = await options.replicate.predictions.get(options.predictionId);
    const st = String((pred as any)?.status || '').toLowerCase();
    if (st === 'processing') return pred;
    if (st === 'succeeded' || st === 'failed' || st === 'canceled') return pred;
    if (Date.now() - startedAt > options.timeoutMs) {
      throw new Error(`Replicate did not enter processing within ${Math.round(options.timeoutMs / 1000)}s`);
    }
    await sleep(options.pollMs);
  }
}

/**
 * Generate a video using Replicate first, with a 15s "processing" gate.
 * If Replicate errors or doesn't transition to `processing` within 15 seconds, fall back to fal.ai.
 */
export async function generateVideoWithFallback(
  prompt: string,
  modelType: ModelKey,
  imageUrl?: string | null,
  options?: VideoFallbackOptions
): Promise<VideoGenerationResult> {
  const cfg = MODELS[modelType];
  if (!cfg || cfg.kind !== 'video') {
    throw new Error(`ModelType ${modelType} is not a video model.`);
  }

  const params: GenerateVideoWithFallbackParams = {
    prompt,
    modelType,
    imageUrl,
    durationSeconds: typeof options?.durationSeconds === 'number' ? options.durationSeconds : undefined,
    aspectRatio: options?.aspectRatio,
  };
  const input = buildVideoInput(params);

  const forced = options?.forceProvider;

  if (forced === 'fal') {
    const falInput = toFalInput(cfg.fal.model, input);
    console.log(`${ANSI.cyan}🚀 Fal.ai queue.submit (forced)...${ANSI.reset}`, { modelType, model: cfg.fal.model });
    const requestId = await falSubmit(cfg.fal.model, falInput);
    return {
      provider: 'fal',
      modelType,
      providerModel: cfg.fal.model,
      id: makeFalVideoId(cfg.fal.model, requestId),
      status: 'processing',
      raw: { request_id: requestId },
    };
  }

  const replicate = getReplicateClient();
  const replicateToken = String(process.env.REPLICATE_API_TOKEN || '').trim();

  console.log(`${ANSI.cyan}🚀 Replicate deneniyor...${ANSI.reset}`, { modelType, model: cfg.replicate.model });
  let predictionId: string | null = null;
  try {
    if (forced === 'replicate') {
      // continue as normal but never fall back to Fal (handled below)
    }
    if (!replicateToken) {
      throw new Error('REPLICATE_API_TOKEN missing');
    }

    const created = await replicateCreatePredictionWithCompatibility(replicate, cfg.replicate, input);
    predictionId = String((created as any)?.id || '').trim() || null;
    if (!predictionId) {
      throw new Error('Replicate prediction create returned no id');
    }

    const processingGate = waitUntilProcessingOrDone({
      replicate,
      predictionId,
      timeoutMs: 15_000,
      pollMs: 1_000,
    });

    const gated = await Promise.race([
      processingGate,
      (async () => {
        await sleep(15_000);
        throw new Error('Replicate processing gate timeout (15s)');
      })(),
    ]);

    const st = String((gated as any)?.status || '').toLowerCase();
    if (st === 'failed') {
      throw new Error(String((gated as any)?.error || 'Replicate prediction failed'));
    }

    // If it already succeeded quickly, return the URL. Otherwise return processing + id for caller-side polling.
    const maybeUrl = extractFirstUrl((gated as any)?.output);
    if (st === 'succeeded' && maybeUrl) {
      console.log(`${ANSI.green}✅ Replicate succeeded quickly.${ANSI.reset}`);
      return {
        provider: 'replicate',
        modelType,
        providerModel: cfg.replicate.model,
        id: predictionId,
        videoUrl: maybeUrl,
        status: 'succeeded',
        raw: gated,
      };
    }

    console.log(`${ANSI.green}✅ Replicate processing başladı.${ANSI.reset}`, `${ANSI.dim}(id=${predictionId})${ANSI.reset}`);
    return {
      provider: 'replicate',
      modelType,
      providerModel: cfg.replicate.model,
      id: predictionId,
      status: 'processing',
      raw: gated,
    };
  } catch (err: any) {
    const msg = String(err?.message || err || 'Unknown error');
    console.warn(`${ANSI.yellow}⚠️ Replicate tıkandı, Fal.ai'ye geçiliyor!${ANSI.reset}`, msg);
    if (predictionId) {
      try {
        await replicate.predictions.cancel(predictionId);
        console.warn(`${ANSI.dim}↩ Replicate prediction canceled:${ANSI.reset}`, predictionId);
      } catch (cancelErr) {
        console.warn(`${ANSI.dim}↩ Replicate cancel failed (ignored):${ANSI.reset}`, (cancelErr as any)?.message || cancelErr);
      }
    }
    if (forced === 'replicate') {
      // Replicate-only mode: surface the error.
      throw err;
    }
  }

  // --- FAL fallback ---
  console.log(`${ANSI.cyan}🚀 Fal.ai queue.submit...${ANSI.reset}`, { modelType, model: cfg.fal.model });
  const falInput = toFalInput(cfg.fal.model, input);
  const requestId = await falSubmit(cfg.fal.model, falInput);
  return {
    provider: 'fal',
    modelType,
    providerModel: cfg.fal.model,
    id: makeFalVideoId(cfg.fal.model, requestId),
    status: 'processing',
    raw: { request_id: requestId },
  };
}

