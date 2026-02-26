import { NextResponse } from 'next/server';
import Replicate from 'replicate';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { extractOutputUrlByKind } from '@/lib/replicate-media';
import { resolveReplicateDownloadUrl } from '@/lib/replicate-media';
import { isFaceSwapEnabled } from '@/lib/feature-flags';
import { filterActorPhotosToAllowed } from '@/lib/face-swap-policy';
import { isTruthy } from '@/lib/consent';

export const runtime = 'nodejs';

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const parseRetryAfterMs = (error: any): number => {
  const retryAfter = error?.headers?.['retry-after'] || error?.response?.headers?.['retry-after'];
  if (retryAfter) {
    const seconds = parseInt(String(retryAfter), 10);
    if (!isNaN(seconds)) return seconds * 1000;
  }
  return 5000;
};

const runReplicateWithRetry = async (model: string, input: Record<string, any>, maxAttempts = 5) => {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const output = await replicate.run(model as any, { input });
      return output;
    } catch (error: any) {
      const status = error?.status || error?.response?.status;
      const message = String(error?.message || '');
      const lower = message.toLowerCase();
      const isRateLimit = status === 429 || message.includes('429') || lower.includes('too many requests');
      const isQueueFull =
        lower.includes('queue is full') ||
        lower.includes('try again later') ||
        (lower.includes('queue') && lower.includes('full'));
      const isRetryable = isRateLimit || isQueueFull;

      if (!isRetryable || attempt >= maxAttempts) {
        throw error;
      }

      const delayMs = isQueueFull
        ? Math.max(20000, parseRetryAfterMs(error))
        : parseRetryAfterMs(error);
      if (isQueueFull) {
        console.warn('Queue full, retrying...', { attempt, maxAttempts, delayMs: delayMs / 1000 + 's' });
      } else {
        console.warn('Rate limit hit. Waiting to retry...', { attempt, delayMs });
      }
      await sleep(delayMs);
    }
  }
  throw new Error('Replicate retry attempts exhausted.');
};

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

async function saveStreamToPublic(stream: ReadableStream, extension: string): Promise<string> {
  const dir = path.join(process.cwd(), 'public', 'generated');
  await mkdir(dir, { recursive: true });
  const fileName = `${crypto.randomUUID()}.${extension}`;
  const filePath = path.join(dir, fileName);
  await pipeline(Readable.fromWeb(stream as any), createWriteStream(filePath));
  return `/generated/${fileName}`;
}

async function saveBufferToPublic(buffer: ArrayBuffer | Buffer, extension: string): Promise<string> {
  const dir = path.join(process.cwd(), 'public', 'generated');
  await mkdir(dir, { recursive: true });
  const fileName = `${crypto.randomUUID()}.${extension}`;
  const filePath = path.join(dir, fileName);
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  await writeFile(filePath, buf);
  return `/generated/${fileName}`;
}

function extractVideoUrl(output: unknown): string {
  return extractOutputUrlByKind(output, 'video');
}

async function resolveReplicateFileUrl(apiUrl: string, token: string): Promise<string> {
  if (!apiUrl.includes('api.replicate.com/v1/files/')) return apiUrl;
  const resolved = await resolveReplicateDownloadUrl(apiUrl, {
    token,
    logger: {
      info: (...args) => console.log(...args),
      warn: (...args) => console.warn(...args),
    },
  });
  console.log('REPLICATE FILE LOOKUP RESOLVED:', apiUrl, '->', resolved);
  return resolved;
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

async function applyFaceSwap(videoUrl: string, actorPhotoUrl: string, characterName: string): Promise<string> {
  try {
    console.log(`🎭 Applying face swap for ${characterName}...`);
    const faceSwapModel = process.env.REPLICATE_FACE_SWAP_MODEL || 'logerzhu/face-swap';
    
    const output = await runReplicateWithRetry(faceSwapModel, {
      source_image: actorPhotoUrl,
      target_video: videoUrl,
    });
    
    const swappedVideoUrl = extractVideoUrl(output);
    if (!swappedVideoUrl) {
      const stream = findFirstStream(output);
      if (stream) {
        const streamVideoUrl = await saveStreamToPublic(stream, 'mp4');
        if (streamVideoUrl) {
          return await normalizeReplicateAssetUrl(streamVideoUrl);
        }
      }
      throw new Error('Face swap failed: no video URL returned');
    }
    
    return await normalizeReplicateAssetUrl(swappedVideoUrl);
  } catch (error) {
    console.error(`❌ Face swap error for ${characterName}:`, error);
    throw error;
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { videoUrl, actorPhotos } = body;

    if (!isFaceSwapEnabled()) {
      return NextResponse.json(
        { error: 'Face swap is disabled' },
        { status: 403 }
      );
    }

    if (!isTruthy(body?.faceSwapConsent)) {
      return NextResponse.json(
        { error: 'Face swap consent is required' },
        { status: 400 }
      );
    }
    
    if (!videoUrl || typeof videoUrl !== 'string') {
      return NextResponse.json(
        { error: 'videoUrl is required and must be a string' },
        { status: 400 }
      );
    }
    
    if (!actorPhotos || typeof actorPhotos !== 'object' || Object.keys(actorPhotos).length === 0) {
      return NextResponse.json(
        { error: 'actorPhotos is required and must be a non-empty object' },
        { status: 400 }
      );
    }

    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL
      || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');
    const { allowed, rejected } = filterActorPhotosToAllowed(actorPhotos as Record<string, string>, {
      baseUrl,
      supabaseUrl: process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL,
    });
    if (Object.keys(allowed).length === 0) {
      return NextResponse.json(
        { error: 'No allowed actor photo URLs', rejectedCharacters: rejected },
        { status: 400 }
      );
    }

    // Replicate requires absolute URLs; resolve app-relative paths to same-origin absolute.
    const normalizedAllowed: Record<string, string> = {};
    for (const [character, url] of Object.entries(allowed)) {
      if (typeof url !== 'string') continue;
      const trimmed = url.trim();
      normalizedAllowed[character] = trimmed.startsWith('/')
        ? `${baseUrl.replace(/\/$/, '')}${trimmed}`
        : trimmed;
    }
    
    // Her karakter için face swap uygula
    let resultVideoUrl = videoUrl;
    for (const [character, photoUrl] of Object.entries(normalizedAllowed)) {
      if (photoUrl && typeof photoUrl === 'string') {
        resultVideoUrl = await applyFaceSwap(resultVideoUrl, photoUrl as string, character);
      }
    }
    
    return NextResponse.json({
      success: true,
      videoUrl: resultVideoUrl,
      faceSwapped: true,
    });
  } catch (error: any) {
    console.error('❌ Face swap endpoint error:', error);
    return NextResponse.json(
      { error: error.message || 'Face swap failed', details: String(error) },
      { status: 500 }
    );
  }
}
