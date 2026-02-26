import { NextRequest, NextResponse } from 'next/server';
import Replicate from 'replicate';
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import crypto from 'node:crypto';
import {
  buildFluxActionPrompt,
  isActionLikePrompt,
} from '@/lib/flux-action-prompts';
import { readPersonas, type PersonaRecord } from '@/lib/persona-registry';
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

const saveStreamToPublic = async (stream: ReadableStream, extension: string): Promise<string> => {
  const dir = path.join(process.cwd(), 'public', 'generated');
  await mkdir(dir, { recursive: true });
  const fileName = `${crypto.randomUUID()}.${extension}`;
  const filePath = path.join(dir, fileName);
  await pipeline(Readable.fromWeb(stream as any), createWriteStream(filePath));
  return `/generated/${fileName}`;
};

export async function POST(request: NextRequest) {
  try {
    const apiToken = process.env.REPLICATE_API_TOKEN;
    if (!apiToken?.trim()) {
      return NextResponse.json(
        { error: 'REPLICATE_API_TOKEN not configured' },
        { status: 500 }
      );
    }

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
    } = body;

    const rawPrompt = (prompt ?? '').toString().trim();
    if (!rawPrompt) {
      return NextResponse.json(
        { error: 'prompt is required' },
        { status: 400 }
      );
    }

    const isActionMode =
      mode === 'ACTION_MODE' ||
      mode === 'HARDCORE_MODE' ||
      isActionLikePrompt(rawPrompt);

    let imagePrompt: string;
    if (isActionMode) {
      imagePrompt = buildFluxActionPrompt(rawPrompt, {
        triggerWord: triggerWord ? String(triggerWord).trim() : undefined,
        opponentOrContext: opponentOrContext ? String(opponentOrContext).trim() : undefined,
      });
      console.log('[image/generate] ACTION_MODE: using wide shot + no portrait prompt');
    } else {
      imagePrompt = rawPrompt;
    }

    const replicate = new Replicate({
      auth: apiToken.trim(),
      fetch: (url, options) =>
        fetch(url, { ...(options as RequestInit), timeout: 120000 } as RequestInit),
    });

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
    const hfUrls = uniqStrings(personaPool.map((p) => (p as any)?.huggingFaceUrl || (p as any)?.huggingface_url))
      .map(withDownloadTrue);
    const triggerWords = uniqStrings([
      triggerWord ? String(triggerWord).trim() : '',
      ...personaPool.map((p) => p?.triggerWord || ''),
    ]);

    if (hfUrls.length > 0) {
      const model =
        hfUrls.length > 1
          ? (process.env.REPLICATE_FLUX_MULTI_LORA_MODEL || 'lucataco/flux-dev-multi-lora')
          : (process.env.REPLICATE_FLUX_LORA_MODEL || 'black-forest-labs/flux-dev-lora');

      const loraPrompt = ensurePromptHasTriggers(imagePrompt, triggerWords);
      const baseInput: Record<string, any> = {
        prompt: loraPrompt,
        output_format: 'png',
        ...(isActionMode ? { aspect_ratio: '16:9', num_inference_steps: 50, output_quality: 100 } : {}),
      };

      let output: any = null;
      if (hfUrls.length > 1) {
        // Multi-LoRA: array input
        const richInput = { ...baseInput, hf_loras: hfUrls, aspect_ratio: '16:9', output_quality: 100, num_inference_steps: 50 };
        try {
          output = await replicate.run(model as any, { input: richInput });
        } catch (e: any) {
          // Fallback for models that don't accept some optional fields
          output = await replicate.run(model as any, { input: { prompt: loraPrompt, hf_loras: hfUrls } });
        }
      } else {
        // Single LoRA
        const url = hfUrls[0];
        const richInput = { ...baseInput, lora_weights: url, lora_scale: 1.0, aspect_ratio: '16:9', output_quality: 100, num_inference_steps: 50 };
        try {
          output = await replicate.run(model as any, { input: richInput });
        } catch (e: any) {
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
      return NextResponse.json({ output: url, loras: hfUrls });
    }

    if (personaModelId || trainingId) {
      let targetVersion = (personaModelId || trainingId) as string;
      if (!targetVersion.includes('/') && !targetVersion.includes(':')) {
        try {
          const training = await replicate.trainings.get(targetVersion);
          targetVersion = training?.output?.version || training?.version || targetVersion;
        } catch {
          // keep targetVersion
        }
      }
      const personaPrompt = isActionMode
        ? imagePrompt
        : `${triggerWord || 'TOK'}, ${imagePrompt}`.trim();

      const imageOutput = await replicate.run(targetVersion as `${string}/${string}`, {
        input: {
          prompt: personaPrompt,
          output_format: 'png',
          disable_safety_checker: true,
          ...(isActionMode ? { aspect_ratio: '16:9', num_inference_steps: 50 } : {}),
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
      return NextResponse.json({ output: url });
    }

    // Flux 2 Max
    const fluxOutput = await replicate.run('black-forest-labs/flux-2-max', {
      input: {
        prompt: imagePrompt,
        aspect_ratio: '16:9',
        output_quality: 100,
        output_format: 'png',
        num_inference_steps: 50,
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

    return NextResponse.json({ output: url });
  } catch (error: any) {
    console.error('[image/generate]', error);
    return NextResponse.json(
      { error: error?.message ?? 'Image generation failed' },
      { status: 500 }
    );
  }
}
