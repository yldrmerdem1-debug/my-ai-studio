import Replicate from 'replicate';
import { fal } from '@fal-ai/client';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

import { MODELS, ModelKey } from '@/config/models';
import HuggingFaceService from '@/lib/huggingface-service';
import { normalizeLoraWeightsBuffer } from '@/lib/lora-weights';
import { downloadMediaWithValidation } from '@/lib/replicate-media';

type Provider = 'replicate' | 'fal';

const ANSI = {
  reset: '\x1b[0m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  dim: '\x1b[2m',
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const nowIsoSafe = () => new Date().toISOString().replace(/[:.]/g, '-');

const getReplicateClient = () => {
  const token = String(process.env.REPLICATE_API_TOKEN || '').trim();
  if (!token) {
    throw new Error('REPLICATE_API_TOKEN missing');
  }
  return new Replicate({ auth: token });
};

const ensureFalConfigured = () => {
  const key = String(process.env.FAL_KEY || '').trim();
  if (!key) {
    throw new Error('FAL_KEY missing');
  }
  fal.config({ credentials: key });
};

const collectUrls = (value: unknown, out: string[] = []): string[] => {
  if (!value) return out;
  if (typeof value === 'string') {
    if (value.startsWith('http://') || value.startsWith('https://') || value.startsWith('ipfs://')) out.push(value);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectUrls(item, out);
    return out;
  }
  if (typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) collectUrls(v, out);
  }
  return out;
};

const extractSafetensorsUrl = (output: unknown): string => {
  const urls = collectUrls(output);
  const safes = urls.filter((u) => /\.safetensors(\?|#|$)/i.test(u));
  if (safes.length > 0) return safes[0]!;

  // Heuristics: prefer anything containing "lora" or "weights"
  const ranked = urls
    .map((u) => {
      const lu = u.toLowerCase();
      let score = 0;
      if (lu.includes('safetensor')) score += 50;
      if (lu.includes('lora')) score += 30;
      if (lu.includes('weight')) score += 25;
      if (lu.endsWith('.zip')) score -= 20;
      return { u, score };
    })
    .sort((a, b) => b.score - a.score);
  return ranked[0]?.u || '';
};

async function downloadToTempFile(url: string, options: { suggestedName: string; token?: string }): Promise<string> {
  const token = String(options.token || process.env.REPLICATE_API_TOKEN || '').trim();
  const media = await downloadMediaWithValidation(url, {
    token,
    strictExpectedKind: false,
    logger: {
      info: (...args) => console.log(...args),
      warn: (...args) => console.warn(...args),
    },
  });
  const normalizedWeights = normalizeLoraWeightsBuffer(media.buffer, `${options.suggestedName} ${url}`);
  if (normalizedWeights.kind !== 'safetensors') {
    throw new Error('LoRA weights could not be normalized to safetensors.');
  }
  const ext = normalizedWeights.extension;
  const tempPath = path.join(os.tmpdir(), `${path.parse(options.suggestedName).name || 'asset'}-${Date.now()}.${ext}`);
  await fs.writeFile(tempPath, normalizedWeights.buffer);
  return tempPath;
}

async function uploadWeightsToHf(localPath: string, options: { triggerWord?: string; provider: Provider; providerId?: string }): Promise<string> {
  const repoId = 'shah1112/seedance-loras';
  const hf = new HuggingFaceService();
  const filename = path.basename(localPath);
  const safeTrigger = String(options.triggerWord || 'persona').trim().replace(/[^a-z0-9_-]+/gi, '-').slice(0, 40) || 'persona';
  const remotePath = `personas/training/${safeTrigger}/${nowIsoSafe()}-${options.provider}${options.providerId ? `-${options.providerId}` : ''}/${filename}`;
  return await hf.uploadLoRA(localPath, repoId, { repoType: 'dataset', branch: 'main', remotePath });
}

async function pollReplicateUntilTerminal(replicate: Replicate, id: string, options: { timeoutMs: number; pollMs: number }) {
  const startedAt = Date.now();
  while (true) {
    const pred = await replicate.predictions.get(id);
    const st = String((pred as any)?.status || '').toLowerCase();
    if (st === 'succeeded' || st === 'failed' || st === 'canceled') return pred;
    if (Date.now() - startedAt > options.timeoutMs) {
      throw new Error(`Replicate prediction timed out after ${Math.round(options.timeoutMs / 1000)}s (id=${id})`);
    }
    await sleep(options.pollMs);
  }
}

async function waitForReplicateProcessingGate(replicate: Replicate, id: string, gateMs: number) {
  const startedAt = Date.now();
  while (true) {
    const pred = await replicate.predictions.get(id);
    const st = String((pred as any)?.status || '').toLowerCase();
    if (st === 'processing') return pred;
    if (st === 'succeeded' || st === 'failed' || st === 'canceled') return pred;
    if (Date.now() - startedAt > gateMs) {
      throw new Error(`Replicate did not enter processing within ${Math.round(gateMs / 1000)}s (id=${id})`);
    }
    await sleep(1000);
  }
}

/**
 * Train persona LoRA with Replicate first; if queue is stuck/error within 30s gate, fallback to fal.ai portrait training.
 * Returns a Hugging Face resolve URL for the resulting weights.
 */
export async function trainPersonaFallback(imagesZipUrl: string, triggerWord: string): Promise<{ huggingFaceUrl: string; provider: Provider; raw: unknown }> {
  const cfg = MODELS[ModelKey.PERSONA_TRAINING];
  const zipUrl = String(imagesZipUrl || '').trim();
  const trig = String(triggerWord || '').trim();
  if (!zipUrl) throw new Error('imagesZipUrl is required');
  if (!trig) throw new Error('triggerWord is required');

  const replicateToken = String(process.env.REPLICATE_API_TOKEN || '').trim();
  let lastError: unknown = null;

  console.log(`${ANSI.cyan}🧠 Persona training (fallback) starting...${ANSI.reset}`, { triggerWord: trig });

  // --- Replicate first ---
  try {
    console.log(`${ANSI.cyan}🚀 Replicate LoRA training deneniyor...${ANSI.reset}`, cfg.replicate.model);
    const replicate = getReplicateClient();

    const created = await replicate.predictions.create({
      version: (cfg.replicate.version ? `${cfg.replicate.model}:${cfg.replicate.version}` : cfg.replicate.model) as any,
      input: {
        input_images: zipUrl,
        trigger_word: trig,
        steps: 1000,
      } as any,
    });
    const id = String((created as any)?.id || '').trim();
    if (!id) throw new Error('Replicate training create returned no id');

    // Gate: ensure it transitions to processing quickly, otherwise fall back.
    await Promise.race([
      waitForReplicateProcessingGate(replicate, id, 30_000),
      (async () => {
        await sleep(30_000);
        throw new Error('Replicate training gate timeout (30s)');
      })(),
    ]);

    console.log(`${ANSI.green}✅ Replicate training accepted (processing).${ANSI.reset}`, `${ANSI.dim}id=${id}${ANSI.reset}`);

    // Training can take long; wait until terminal (default 45 minutes).
    const finished = await pollReplicateUntilTerminal(replicate, id, {
      timeoutMs: Number(process.env.PERSONA_TRAIN_TOTAL_TIMEOUT_MS || '') || 45 * 60_000,
      pollMs: Number(process.env.PERSONA_TRAIN_POLL_MS || '') || 10_000,
    });
    const st = String((finished as any)?.status || '').toLowerCase();
    if (st !== 'succeeded') {
      throw new Error(String((finished as any)?.error || `Replicate training failed (status=${st})`));
    }

    const weightsUrl = extractSafetensorsUrl((finished as any)?.output);
    if (!weightsUrl) {
      throw new Error('Replicate training succeeded but no weights URL found in output');
    }

    console.log(`${ANSI.dim}⬇️ Downloading weights...${ANSI.reset}`, weightsUrl.slice(0, 80));
    const tempPath = await downloadToTempFile(weightsUrl, {
      suggestedName: `${trig}.safetensors`,
      token: replicateToken,
    });
    try {
      console.log(`${ANSI.dim}⬆️ Uploading weights to Hugging Face...${ANSI.reset}`);
      const hfUrl = await uploadWeightsToHf(tempPath, { triggerWord: trig, provider: 'replicate', providerId: id });
      console.log(`${ANSI.green}✅ HF upload complete.${ANSI.reset}`, hfUrl);
      return { huggingFaceUrl: hfUrl, provider: 'replicate', raw: finished };
    } finally {
      try { await fs.unlink(tempPath); } catch { /* ignore */ }
    }
  } catch (err) {
    lastError = err;
    console.warn(`${ANSI.yellow}⚠️ Replicate training tıkandı, Fal.ai'ye geçiliyor!${ANSI.reset}`, String((err as any)?.message || err));
  }

  // --- Fal fallback ---
  try {
    ensureFalConfigured();
    console.log(`${ANSI.cyan}🚀 Fal.ai LoRA training deneniyor...${ANSI.reset}`, cfg.fal.model);
    const falTrainingInput = cfg.fal.model.includes('flux-lora-portrait-trainer')
      ? {
          images_data_url: zipUrl,
          trigger_phrase: trig,
          steps: 2200,
          multiresolution_training: true,
          subject_crop: true,
          create_masks: false,
        }
      : {
          images_data_url: zipUrl,
          trigger_word: trig,
          steps: 1000,
        };
    const result = await fal.subscribe(cfg.fal.model, {
      input: falTrainingInput as any,
      logs: true,
      onQueueUpdate: (update: any) => {
        const st = update?.status || update?.type || 'update';
        if (st === 'IN_PROGRESS' && Array.isArray(update?.logs)) {
          update.logs.map((l: any) => l?.message).filter(Boolean).forEach((m: any) => console.log(`${ANSI.dim}[fal]${ANSI.reset}`, m));
        }
      },
    });

    const weightsUrl = String((result as any)?.data?.diffusers_lora_file?.url || (result as any)?.diffusers_lora_file?.url || '').trim();
    if (!weightsUrl) {
      throw new Error('fal training returned no diffusers_lora_file.url');
    }
    console.log(`${ANSI.dim}⬇️ Downloading fal weights...${ANSI.reset}`, weightsUrl.slice(0, 80));
    const tempPath = await downloadToTempFile(weightsUrl, { suggestedName: `${trig}.safetensors` });
    try {
      console.log(`${ANSI.dim}⬆️ Uploading fal weights to Hugging Face...${ANSI.reset}`);
      const hfUrl = await uploadWeightsToHf(tempPath, { triggerWord: trig, provider: 'fal', providerId: String((result as any)?.requestId || '') });
      console.log(`${ANSI.green}✅ HF upload complete.${ANSI.reset}`, hfUrl);
      return { huggingFaceUrl: hfUrl, provider: 'fal', raw: result };
    } finally {
      try { await fs.unlink(tempPath); } catch { /* ignore */ }
    }
  } catch (falErr) {
    const msg = String((falErr as any)?.message || falErr);
    console.error(`${ANSI.red}❌ Fal.ai training failed.${ANSI.reset}`, msg);
    const repMsg = String((lastError as any)?.message || lastError || '');
    throw new Error(`Persona training failed on both providers. Replicate: ${repMsg || '(none)'}; Fal: ${msg}`);
  }
}

/**
 * Generate an image using a given LoRA URL, with Replicate first and 10s timeout, then fal.ai fallback.
 */
export async function generateImageWithPersonaFallback(
  prompt: string,
  loraUrl: string
): Promise<{ imageUrl: string; provider: Provider; raw: unknown }> {
  const cfg = MODELS[ModelKey.PERSONA_INFERENCE];
  const p = String(prompt || '').trim();
  const lora = String(loraUrl || '').trim();
  if (!p) throw new Error('prompt is required');
  if (!lora) throw new Error('loraUrl is required');

  console.log(`${ANSI.cyan}🖼️ Persona inference (fallback) starting...${ANSI.reset}`);

  // --- Replicate first (10s budget to finish) ---
  try {
    console.log(`${ANSI.cyan}🚀 Replicate (Flux Dev + LoRA) deneniyor...${ANSI.reset}`, cfg.replicate.model);
    const replicate = getReplicateClient();
    const created = await replicate.predictions.create({
      version: (cfg.replicate.version ? `${cfg.replicate.model}:${cfg.replicate.version}` : cfg.replicate.model) as any,
      input: {
        prompt: p,
        lora_weights: lora,
        lora_scale: 0.85,
        aspect_ratio: '16:9',
        output_format: 'png',
        output_quality: 100,
        num_inference_steps: 50,
      } as any,
    });
    const id = String((created as any)?.id || '').trim();
    if (!id) throw new Error('Replicate inference create returned no id');

    const finished = await Promise.race([
      pollReplicateUntilTerminal(replicate, id, { timeoutMs: 10_000, pollMs: 1_000 }),
      (async () => {
        await sleep(10_000);
        throw new Error('Replicate inference timeout (10s)');
      })(),
    ]);
    const st = String((finished as any)?.status || '').toLowerCase();
    if (st !== 'succeeded') {
      throw new Error(String((finished as any)?.error || `Replicate inference failed (status=${st})`));
    }
    const imageUrl = (collectUrls((finished as any)?.output).find((u) => /\.(png|jpe?g|webp)(\?|#|$)/i.test(u)) || collectUrls((finished as any)?.output)[0] || '').trim();
    if (!imageUrl) throw new Error('Replicate inference succeeded but no image URL found');
    console.log(`${ANSI.green}✅ Replicate inference succeeded.${ANSI.reset}`);
    return { imageUrl, provider: 'replicate', raw: finished };
  } catch (err) {
    console.warn(`${ANSI.yellow}⚠️ Replicate inference tıkandı, Fal.ai'ye geçiliyor!${ANSI.reset}`, String((err as any)?.message || err));
  }

  // --- Fal fallback ---
  ensureFalConfigured();
  console.log(`${ANSI.cyan}🚀 Fal.ai (Flux LoRA) deneniyor...${ANSI.reset}`, cfg.fal.model);
  const result = await fal.subscribe(cfg.fal.model, {
    input: {
      prompt: p,
      loras: [{ path: lora, scale: 0.85 }],
      image_size: 'landscape_16_9',
      output_format: 'png',
      num_images: 1,
      enable_safety_checker: false,
    } as any,
    logs: true,
    onQueueUpdate: (update: any) => {
      const st = update?.status || update?.type || 'update';
      if (st === 'IN_PROGRESS' && Array.isArray(update?.logs)) {
        update.logs.map((l: any) => l?.message).filter(Boolean).forEach((m: any) => console.log(`${ANSI.dim}[fal]${ANSI.reset}`, m));
      }
    },
  });
  const imageUrl = String((result as any)?.data?.images?.[0]?.url || (result as any)?.images?.[0]?.url || '').trim();
  if (!imageUrl) {
    throw new Error('fal inference returned no images[0].url');
  }
  console.log(`${ANSI.green}✅ Fal.ai inference succeeded.${ANSI.reset}`);
  return { imageUrl, provider: 'fal', raw: result };
}

