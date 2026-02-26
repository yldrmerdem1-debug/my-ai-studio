import { NextResponse } from 'next/server';
import Replicate from 'replicate';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import crypto from 'node:crypto';
import ffmpeg from 'fluent-ffmpeg';
import { mixVideoWithDucking } from '@/lib/videoProcessor';
import { generateAtmosphere, generateSpeech } from '@/lib/audio-service';
import { generateVoiceBuffer, generateSoundEffectBuffer } from '@/lib/voice';
import { CINEMATIC_VISUAL_SUFFIX, VIDEO_ENGINES_CONFIG } from '@/lib/constants';
import { buildFluxActionPrompt, isActionLikePrompt } from '@/lib/flux-action-prompts';
import { SFX_QUALITY_SUFFIX, VOICE_CAST } from '@/lib/voice-constants';
import { getGeminiModelId } from '@/lib/gemini';
import { logVideoCost } from '@/lib/video-cost-log';
import { getJob, setJob } from '@/lib/async-video-jobs';
import {
  downloadMediaWithValidation,
  extractOutputUrlByKind,
  resolveReplicateDownloadUrl,
} from '@/lib/replicate-media';
import { isFaceSwapEnabled } from '@/lib/feature-flags';
import { filterActorPhotosToAllowed } from '@/lib/face-swap-policy';
import { ensurePublicAssetUrl } from '@/lib/public-asset-url';
import { ensurePromptHasTriggers, uniqStrings, withDownloadTrue } from '@/lib/lora-utils';
import { readPersonas } from '@/lib/persona-registry';
import { enhancePrompt } from '@/lib/services/prompt-enhancer';
import { generateXaiVideo } from '@/lib/xai-video';
import { generateVideoWithFallback } from '@/lib/services/video-service';
import { ModelKey } from '@/config/models';
import { getStorageProvider, makeStorageObjectKey } from '@/lib/storage';
import { isTruthy } from '@/lib/consent';
import { isPremiumUser } from '@/lib/subscription';
import { createRunwayImageToVideoTask, type RunwayI2VModel } from '@/lib/runway';

export const runtime = 'nodejs';

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

const normalizeDurationForEngine = (engine: string, body: any): number | null => {
  const raw = Number(body?.duration_seconds ?? body?.video_duration ?? body?.duration);
  const requested = Number.isFinite(raw) ? Math.round(raw) : NaN;

  const cfg = (VIDEO_ENGINES_CONFIG as any)[engine] as { supportedDurations?: number[]; defaultDuration?: number; mode?: string } | undefined;
  const supported = Array.isArray(cfg?.supportedDurations) ? cfg!.supportedDurations : [];
  const def = typeof cfg?.defaultDuration === 'number' ? cfg!.defaultDuration : 5;
  const mode = cfg?.mode || 'select';

  if (mode === 'auto' || supported.length === 0) return null;
  if (Number.isFinite(requested) && supported.includes(requested)) return requested;
  return supported.includes(def) ? def : (supported[0] ?? 5);
};

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const isSensitiveFlag = (error: any) => {
  const message = String(error?.message || error || '').toLowerCase();
  return message.includes('flagged as sensitive') || message.includes('e005') || message.includes('sensitive');
};

const softenVeoPrompt = (prompt: string, level: 1 | 2 | 3) => {
  let softened = prompt;
  const safetyTail = ' no blood, no injury, no harm, no violence, no weapons, no killing, family-friendly action.';
  const swaps: Array<[RegExp, string]> = [
    [/\bstrike\b/gi, 'forceful move'],
    [/\bpowerful\b/gi, 'dramatic'],
    [/\bimpact\b/gi, 'shockwave'],
    [/\bhit\b/gi, 'push'],
    [/\bpunch\b/gi, 'gesture'],
    [/\bknock(ed)?\b/gi, 'send'],
    [/\bflying backwards\b/gi, 'sliding backward'],
    [/\bexecuting\b/gi, 'performing'],
    [/\btough\b/gi, 'determined'],
  ];
  if (level >= 1) {
    for (const [re, rep] of swaps) softened = softened.replace(re, rep);
    if (!softened.toLowerCase().includes('no blood')) softened += ` ${safetyTail}`;
  }
  if (level >= 2) {
    softened = softened.replace(/\b(stunt choreography)\b/gi, 'stage choreography (no contact)');
    softened += ' show no physical contact; depict a near-miss or shockwave-only moment.';
  }
  if (level >= 3) {
    softened = 'dynamic cinematic shot, dramatic gesture, motion blur, kinetic camera, dramatic lighting, family-friendly action, no violence, no injury, no blood.';
  }
  return softened.trim();
};

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
  const modelId = model as `${string}/${string}` | `${string}/${string}:${string}`;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await replicate.run(modelId, { input });
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

const resolveIntentMode = (raw: unknown, isActionScene: boolean) => {
  const normalized = typeof raw === 'string' ? raw.trim().toUpperCase() : '';
  if (normalized === 'ACTION_MODE' || normalized === 'TALKING_MODE') {
    return normalized;
  }
  return isActionScene ? 'ACTION_MODE' : 'TALKING_MODE';
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

async function saveBufferToPublic(buffer: Buffer, extension: string): Promise<string> {
  const dir = path.join(process.cwd(), 'public', 'generated');
  await mkdir(dir, { recursive: true });
  const fileName = `${crypto.randomUUID()}.${extension}`;
  const filePath = path.join(dir, fileName);
  await writeFile(filePath, buffer);
  return `/generated/${fileName}`;
}

async function extractFirstFrameToPng(videoUrl: string): Promise<string> {
  const token = process.env.REPLICATE_API_TOKEN || '';
  const media = await downloadMediaWithValidation(ensureAbsoluteUrl(videoUrl), {
    token,
    expectedKind: 'video',
    strictExpectedKind: false,
    logger: {
      info: (...args) => console.log(...args),
      warn: (...args) => console.warn(...args),
    },
  });
  if (media.kind !== 'video') {
    throw new Error(
      `First-frame extraction expects video input, got ${media.kind} (content-type=${media.contentType})`
    );
  }
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'first-frame-'));
  const inputPath = path.join(tempDir, `input-${crypto.randomUUID()}.mp4`);
  const outputPath = path.join(tempDir, `frame-${crypto.randomUUID()}.png`);
  await writeFile(inputPath, media.buffer);
  await new Promise<void>((resolve, reject) => {
    ffmpeg(inputPath)
      .outputOptions(['-y', '-frames:v 1'])
      .save(outputPath)
      .on('end', () => resolve())
      .on('error', (error) => reject(new Error(`FFmpeg frame extraction failed: ${error?.message || error}`)));
  });
  const frame = await (await import('node:fs/promises')).readFile(outputPath);
  return await saveBufferToPublic(frame, 'png');
}

async function extractLastFrameToPng(videoUrl: string): Promise<string> {
  const absolute = ensureAbsoluteUrl(videoUrl);
  const token = process.env.REPLICATE_API_TOKEN || '';
  const media = await downloadMediaWithValidation(absolute, {
    token,
    expectedKind: 'video',
    strictExpectedKind: true,
    logger: {
      info: (...args) => console.log(...args),
      warn: (...args) => console.warn(...args),
    },
  });
  if (media.kind !== 'video') {
    throw new Error(
      `Last-frame extraction expects video input, got ${media.kind} (content-type=${media.contentType})`
    );
  }
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'last-frame-'));
  const inputPath = path.join(tempDir, `input-${crypto.randomUUID()}.mp4`);
  const outputPath = path.join(tempDir, `frame-${crypto.randomUUID()}.png`);
  await writeFile(inputPath, media.buffer);
  await new Promise<void>((resolve, reject) => {
    ffmpeg(inputPath)
      .outputOptions(['-y', '-vf', 'select=eq(n\\,-1)', '-frames:v', '1'])
      .save(outputPath)
      .on('end', () => resolve())
      .on('error', (error) => reject(new Error(`FFmpeg last frame extraction failed: ${error?.message || error}`)));
  });
  const frame = await (await import('node:fs/promises')).readFile(outputPath);
  return await saveBufferToPublic(frame, 'png');
}

async function applyFaceSwap(videoUrl: string, actorPhotoUrl: string, characterName: string, maxRetries = 2, allCharacters?: string[]): Promise<string> {
  if (!actorPhotoUrl || typeof actorPhotoUrl !== 'string' || !actorPhotoUrl.trim()) {
    throw new Error(`Face swap: invalid source image URL for ${characterName}`);
  }
  if (!videoUrl || typeof videoUrl !== 'string' || !videoUrl.trim()) {
    throw new Error('Face swap: invalid target video URL');
  }
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`🎭 Applying face swap for ${characterName}... (attempt ${attempt}/${maxRetries})`);
      const faceSwapModel = process.env.REPLICATE_FACE_SWAP_MODEL || 'logerzhu/face-swap';
      
      const input: Record<string, any> = {
        source_image: actorPhotoUrl,
        target_video: videoUrl,
      };

      if (characterName) {
        input.character_name = characterName;
      }
      
      const output = await runReplicateWithRetry(faceSwapModel, input);
      
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
      lastError = error instanceof Error ? error : new Error(String(error));
      console.error(`❌ Face swap error for ${characterName} (attempt ${attempt}/${maxRetries}):`, lastError);
      
      // If not the last attempt, wait before retrying
      if (attempt < maxRetries) {
        const delayMs = attempt * 2000; // Exponential backoff: 2s, 4s
        console.log(`⏳ Retrying face swap for ${characterName} in ${delayMs}ms...`);
        await sleep(delayMs);
      }
    }
  }
  
  // All retries failed
  throw lastError || new Error(`Face swap failed for ${characterName} after ${maxRetries} attempts`);
}

async function applyFaceSwapIfEnabled(
  videoUrl: string, 
  enableFaceSwap: boolean, 
  actorPhotos: Record<string, string> | null,
  detectedCharacters?: string[]
): Promise<{ 
  videoUrl: string; 
  faceSwapped: boolean; 
  originalVideoUrl?: string;
  faceSwapError?: string;
}> {
  if (!enableFaceSwap || !actorPhotos || Object.keys(actorPhotos).length === 0) {
    return { videoUrl, faceSwapped: false };
  }

  const originalVideoUrl = videoUrl;
  let swappedVideoUrl = videoUrl;
  const errors: string[] = [];
  
  // Helper function to sleep
  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  
  try {
    console.log('🎭 Face swap enabled, applying to video...');
    
    // Use detectedCharacters for ordering if available, otherwise use Object.keys
    const characterNames = detectedCharacters && detectedCharacters.length > 0 
      ? detectedCharacters.filter(char => actorPhotos[char]) // Only include characters that have photos
      : Object.keys(actorPhotos);
    
    console.log(`📋 Characters to process: ${characterNames.join(', ')}`);

    for (let i = 0; i < characterNames.length; i++) {
      const characterName = characterNames[i];
      const actorPhotoUrl = actorPhotos[characterName];
      if (actorPhotoUrl && typeof actorPhotoUrl === 'string') {
        try {
          swappedVideoUrl = await applyFaceSwap(
            swappedVideoUrl, 
            actorPhotoUrl, 
            characterName,
            2, // maxRetries
            characterNames // allCharacters context
          );
          console.log(`✅ Face swap completed for ${characterName} (${i + 1}/${characterNames.length})`);

          // Small delay between swaps to avoid overwhelming the API
          if (i < characterNames.length - 1) {
            await sleep(1000);
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          errors.push(`${characterName}: ${errorMessage}`);
          console.error(`❌ Face swap failed for ${characterName}, continuing with previous result:`, error);
          // Continue with previous swappedVideoUrl (or original if first character fails)
          // Don't throw - allow other characters to be processed
        }
      }
    }
    
    // If all face swaps failed, return original video
    if (errors.length === Object.keys(actorPhotos).length) {
      console.warn('⚠️ All face swaps failed, returning original video');
      return { 
        videoUrl: originalVideoUrl, 
        faceSwapped: false, 
        originalVideoUrl,
        faceSwapError: errors.join('; ') 
      };
    }
    
    // If at least one succeeded, return swapped video
    if (errors.length > 0) {
      console.warn(`⚠️ Some face swaps failed (${errors.length}/${Object.keys(actorPhotos).length}), but continuing with partial result`);
      return { 
        videoUrl: swappedVideoUrl, 
        faceSwapped: true, 
        originalVideoUrl,
        faceSwapError: errors.join('; ') 
      };
    }
    
    // All succeeded
    console.log('✅ Face swap completed successfully for all characters');
    return { videoUrl: swappedVideoUrl, faceSwapped: true, originalVideoUrl };
  } catch (error) {
    // Unexpected error (shouldn't happen with per-character error handling)
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('⚠️ Face swap failed unexpectedly, using original video:', error);
    return { 
      videoUrl: originalVideoUrl, 
      faceSwapped: false, 
      originalVideoUrl,
      faceSwapError: errorMessage 
    };
  }
}

const toBase64 = (buffer: ArrayBuffer | Buffer) =>
  Buffer.isBuffer(buffer) ? buffer.toString('base64') : Buffer.from(buffer).toString('base64');

const getImageInlineData = async (url: string) => {
  const absolute = ensureAbsoluteUrl(url);
  const token = process.env.REPLICATE_API_TOKEN || '';
  const media = await downloadMediaWithValidation(absolute, {
    token,
    expectedKind: 'image',
    strictExpectedKind: true,
    logger: {
      info: (...args) => console.log(...args),
      warn: (...args) => console.warn(...args),
    },
  });
  const mimeType = media.contentType || 'image/jpeg';
  return {
    data: toBase64(media.buffer),
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
  return extractGeminiJson(raw);
};

function extractImageUrl(output: unknown): string {
  return extractOutputUrlByKind(output, 'image');
}

function extractVideoUrl(output: unknown): string {
  return extractOutputUrlByKind(output, 'video');
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

/** Upload raw buffer to Replicate files; returns public URL (Grok accepts only .png/.jpg/.jpeg/.webp URLs). */
const uploadBufferToReplicate = async (
  buffer: ArrayBuffer | Buffer,
  filename: string,
  contentType: string
): Promise<string> => {
  const token = process.env.REPLICATE_API_TOKEN || '';
  if (!token) throw new Error('REPLICATE_API_TOKEN not configured');
  const part: BlobPart = Buffer.isBuffer(buffer) ? new Uint8Array(buffer) : buffer;
  const blob = new Blob([part], { type: contentType });
  const form = new FormData();
  form.append('content', blob, filename);
  const upload = await fetch('https://api.replicate.com/v1/files', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const text = await upload.text();
  if (!upload.ok) throw new Error(`Replicate upload failed: ${upload.status} ${text}`);
  let payload: { serving_url?: string; urls?: { get?: string; original?: string }; url?: string } | null = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }
  const signedUrl = payload?.urls?.get || payload?.urls?.original;
  const servingUrl = payload?.serving_url;
  const apiUrl = payload?.url;
  const candidateUrl =
    (typeof signedUrl === 'string' && signedUrl.includes('://') ? signedUrl : null) ||
    (typeof servingUrl === 'string' && servingUrl.includes('://') ? servingUrl : null) ||
    (typeof apiUrl === 'string' && apiUrl.includes('://') ? apiUrl : null);
  if (!candidateUrl) throw new Error(`Replicate upload returned no URL. Payload: ${text}`);
  return resolveReplicateFileUrl(candidateUrl, token);
};

/** Upload buffer to Replicate and return file id. Used to build Grok-ready URL with extension (e.g. /api/grok-image/image.jpg?id=xxx). */
async function uploadBufferToReplicateAndGetFileId(
  buffer: ArrayBuffer | Buffer,
  filename: string,
  contentType: string
): Promise<string> {
  const token = process.env.REPLICATE_API_TOKEN || '';
  if (!token) throw new Error('REPLICATE_API_TOKEN not configured');
  const part: BlobPart = Buffer.isBuffer(buffer) ? new Uint8Array(buffer) : buffer;
  const blob = new Blob([part], { type: contentType });
  const form = new FormData();
  form.append('content', blob, filename);
  const upload = await fetch('https://api.replicate.com/v1/files', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const text = await upload.text();
  if (!upload.ok) throw new Error(`Replicate upload failed: ${upload.status} ${text}`);
  let payload: { id?: string; urls?: { get?: string }; serving_url?: string; url?: string } | null = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }
  const fileIdFromPayload = payload?.id;
  const getUrl = payload?.urls?.get || payload?.serving_url || payload?.url || '';
  const match = getUrl.match(/\/v1\/files\/([^/?#]+)/);
  const fileId = fileIdFromPayload || (match ? match[1] : null);
  if (!fileId) throw new Error(`Replicate upload returned no file id. Payload: ${text}`);
  return fileId;
}

async function uploadReplicateFileToPublicUrl(fileId: string, filename: string): Promise<string | null> {
  const token = process.env.REPLICATE_API_TOKEN || '';
  if (!token) return null;
  try {
    const apiUrl = `https://api.replicate.com/v1/files/${fileId}`;
    return await ensurePublicAssetUrl(
      { url: apiUrl, suggestedName: filename, contentType: 'image/jpeg' },
      {
        token,
        resolveAbsoluteUrl: ensureAbsoluteUrl,
        bypassReplicateFileApi: false,
        logger: {
          info: (...args) => console.log(...args),
          warn: (...args) => console.warn(...args),
        },
      }
    );
  } catch (e) {
    console.warn('GROK: storage public URL exception:', (e as Error)?.message || String(e));
    return null;
  }
}

/** Upload buffer to Replicate and return a signed/public URL that Replicate's runner can fetch without auth (Grok image-to-video). Never return api.replicate.com/v1/files/ — that requires Bearer and causes 401. */
async function uploadBufferToReplicateAndGetUrl(
  buffer: ArrayBuffer | Buffer,
  filename: string,
  contentType: string
): Promise<string> {
  const token = process.env.REPLICATE_API_TOKEN || '';
  if (!token) throw new Error('REPLICATE_API_TOKEN not configured');
  const part: BlobPart = Buffer.isBuffer(buffer) ? new Uint8Array(buffer) : buffer;
  const blob = new Blob([part], { type: contentType });
  const form = new FormData();
  form.append('content', blob, filename);
  const upload = await fetch('https://api.replicate.com/v1/files', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const text = await upload.text();
  if (!upload.ok) throw new Error(`Replicate upload failed: ${upload.status} ${text}`);
  let payload: { id?: string; urls?: Record<string, unknown>; serving_url?: string; url?: string } | null = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }
  const candidates: string[] = [];
  if (typeof payload?.serving_url === 'string') candidates.push(payload.serving_url);
  if (typeof payload?.url === 'string') candidates.push(payload.url);
  if (payload?.urls && typeof payload.urls === 'object') {
    for (const value of Object.values(payload.urls)) {
      if (typeof value === 'string') candidates.push(value);
    }
  }
  const publicCandidate = candidates.find(
    (u) => u.includes('://') && !u.includes('api.replicate.com/v1/files/')
  );
  if (publicCandidate && publicCandidate.includes('://')) {
    return publicCandidate;
  }
  const fileId = payload?.id;
  const apiUrl = fileId ? `https://api.replicate.com/v1/files/${fileId}` : (payload?.url as string) || '';
  if (apiUrl && apiUrl.includes('api.replicate.com/v1/files/')) {
    try {
      const resolved = await resolveReplicateFileUrl(apiUrl, token);
      if (resolved && !resolved.includes('api.replicate.com/v1/files/')) return resolved;
    } catch {
      // Keep trying below; some file backends expose public/signed URL a bit later.
    }
    for (let attempt = 1; attempt <= 20; attempt += 1) {
      await sleep(1500);
      try {
        const retryResolved = await resolveReplicateFileUrl(apiUrl, token);
        if (retryResolved && !retryResolved.includes('api.replicate.com/v1/files/')) return retryResolved;
      } catch {
        // continue polling
      }
    }
    // Grok/Veo need a URL Replicate can fetch. Prefer storage (buffer upload) so we never depend on Replicate file metadata.
    if (fileId) {
      const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
      try {
        const fromBuffer = await ensurePublicAssetUrl(
          { buffer: buf, contentType, suggestedName: filename },
          {
            token: process.env.REPLICATE_API_TOKEN || '',
            resolveAbsoluteUrl: ensureAbsoluteUrl,
            logger: { info: (...a: unknown[]) => console.log(...a), warn: (...a: unknown[]) => console.warn(...a) },
          }
        );
        if (fromBuffer && !fromBuffer.includes('localhost') && !fromBuffer.includes('127.0.0.1')) return fromBuffer;
      } catch (e) {
        console.warn('uploadBufferToReplicateAndGetUrl: buffer→storage failed', (e as Error)?.message ?? e);
      }
      const publicUrl = await uploadReplicateFileToPublicUrl(fileId, filename);
      if (publicUrl) return publicUrl;
      const base = resolveBaseUrl();
      const isBaseLocal =
        base.includes('localhost') || base.includes('127.0.0.1') || base.includes('0.0.0.0');
      if (isBaseLocal) {
        console.warn('uploadBufferToReplicateAndGetUrl: storage/public URL yok; Replicate file URL kullaniliyor (Veo/Grok runner erisebilir).');
        return apiUrl;
      }
      return `${base}/api/grok-image/${filename}?id=${encodeURIComponent(fileId)}`;
    }
    return apiUrl;
  }
  throw new Error('Replicate upload did not return a usable URL.');
}

const ensureReplicateUri = async (url: string, filename: string, contentType: string) => {
  if (!url) return url;
  const absolute = ensureAbsoluteUrl(url);
  const isLocal = absolute.includes('localhost') || absolute.includes('127.0.0.1') || absolute.includes('0.0.0.0');
  if (isLocal || absolute.startsWith('/')) {
    return await uploadUrlToReplicate(absolute, filename, contentType);
  }
  return await resolveReplicatePublicUrl(absolute);
};

const ensureExternallyFetchableImageUrl = async (url: string): Promise<string> => {
  if (!url) return url;
  const absolute = ensureAbsoluteUrl(url);
  const isLocal =
    absolute.includes('localhost') || absolute.includes('127.0.0.1') || absolute.includes('0.0.0.0');
  if (!isLocal && absolute.startsWith('http')) return absolute;

  // In dev, provider backends can't fetch localhost URLs. Upload to storage and return a signed URL.
  try {
    const media = await downloadMediaWithValidation(absolute, {
      token: process.env.REPLICATE_API_TOKEN || '',
      expectedKind: 'image',
      strictExpectedKind: false,
      logger: {
        info: (...args) => console.log(...args),
        warn: (...args) => console.warn(...args),
      },
    });
    const contentType = media.contentType || 'image/jpeg';
    const storage = getStorageProvider();
    const key = makeStorageObjectKey('generated/anchor-frames', contentType, 'anchor.jpg');
    await storage.upload(media.buffer, contentType, key);
    const signed = await storage.getSignedUrl(key, 60 * 60);
    console.log('✅ Uploaded local anchor frame to storage for providers.');
    return signed;
  } catch (e: any) {
    console.warn('⚠️ Could not upload local image to storage; using absolute URL (may fail for Fal/Replicate in dev).', e?.message || e);
    return absolute;
  }
};

const generateSfxAudioUrl = async (prompt: string) => {
  return await generateAtmosphere(prompt, 10);
};

export async function POST(req: Request) {
  console.log('🚀 STRICT PIPELINE STARTING...');

  try {
    const body = await req.json();
    console.log('🧪 REQUEST BODY:', body);

    // Optional async mode: return jobId immediately, run generation in background
    if (body?.async === true) {
      const jobId = 'job_' + crypto.randomUUID();
      setJob(jobId, { status: 'pending' });
      const origin = process.env.NEXT_PUBLIC_SITE_URL
        || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');
      const bodySync = { ...body, async: false };
      fetch(`${origin}/api/generate-video`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodySync),
      })
        .then(async (res) => {
          const data = await res.json().catch(() => ({}));
          if (res.ok) setJob(jobId, { status: 'succeeded', result: data });
          else setJob(jobId, { status: 'failed', error: (data as { error?: string; details?: string }).error || (data as { details?: string }).details || 'Request failed' });
        })
        .catch((e) => setJob(jobId, { status: 'failed', error: (e as Error).message }));
      return NextResponse.json({ videoId: jobId });
    }

    let {
      userPrompt,
      prompt,
      personaModelId,
      qualityTier,
      engine: bodyEngine,
      personaTriggerWord,
      dryRun,
      referenceImageUrl: bodyReferenceImageUrl,
      personaImageUrl,
      personaUrl,
    } = body;
    const videoMode = body?.videoMode === 'ads' ? 'ads' : body?.videoMode === 'cinematic_fight' ? 'cinematic_fight' : null;
    const enableFaceSwap = Boolean(body?.faceSwap === true || body?.enableFaceSwap === true);
    let actorPhotos = body?.actorPhotos && typeof body.actorPhotos === 'object' 
      ? body.actorPhotos as Record<string, string>
      : null;
    const detectedCharacters = Array.isArray(body?.detectedCharacters)
      ? body.detectedCharacters as string[]
      : [];

    if (enableFaceSwap && !isFaceSwapEnabled()) {
      return NextResponse.json(
        { error: 'Face swap is disabled' },
        { status: 403 }
      );
    }

    if (enableFaceSwap && !isPremiumUser(body?.user)) {
      return NextResponse.json(
        { error: 'Premium required for face swap' },
        { status: 402 }
      );
    }

    if (enableFaceSwap && !isTruthy(body?.faceSwapConsent)) {
      return NextResponse.json(
        { error: 'Face swap consent is required' },
        { status: 400 }
      );
    }
    
    // Ensure actor photo URLs are absolute so Replicate can fetch them
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL 
      || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');

    // Reduce abuse: only allow actor photo URLs from same origin or Supabase storage.
    if (enableFaceSwap && actorPhotos) {
      const { allowed, rejected } = filterActorPhotosToAllowed(actorPhotos, {
        baseUrl,
        supabaseUrl: process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL,
      });
      actorPhotos = Object.keys(allowed).length > 0 ? allowed : null;
      if (rejected.length > 0) {
        console.warn('⚠️ Face swap rejected actor photo URLs for characters:', rejected);
      }
    }
    if (actorPhotos) {
      const normalized: Record<string, string> = {};
      for (const [char, url] of Object.entries(actorPhotos)) {
        if (typeof url !== 'string' || !url.trim()) continue;
        const u = url.trim();
        if (u.startsWith('http://') || u.startsWith('https://')) {
          normalized[char] = u;
        } else if (u.startsWith('/')) {
          normalized[char] = `${baseUrl.replace(/\/$/, '')}${u}`;
          console.log(`🎭 Resolved relative actor photo URL for ${char}`);
        } else {
          normalized[char] = u;
        }
      }
      actorPhotos = Object.keys(normalized).length > 0 ? normalized : null;
    }
    
    // Validate face swap prerequisites
    const hasActorPhotos = actorPhotos && Object.keys(actorPhotos).length > 0;
    const shouldApplyFaceSwap = enableFaceSwap && hasActorPhotos;
    
    if (enableFaceSwap && !hasActorPhotos) {
      console.warn('⚠️ Face swap enabled but no actor photos provided');
    }
    if (shouldApplyFaceSwap) {
      console.log(`🎭 Face swap will be applied with ${Object.keys(actorPhotos!).length} character(s):`, Object.keys(actorPhotos!));
      if (detectedCharacters.length > 0) {
        console.log(`📋 Detected characters: ${detectedCharacters.join(', ')}`);
      }
    }
    const existingVideoUrl =
      (typeof body?.videoUrl === 'string' && body.videoUrl.trim() ? body.videoUrl : null)
      || (typeof body?.existingVideoUrl === 'string' && body.existingVideoUrl.trim() ? body.existingVideoUrl : null);

    // If video URL is provided and face swap is enabled, apply face swap directly without generating new video
    if (existingVideoUrl && shouldApplyFaceSwap) {
      try {
        const faceSwapResult = await applyFaceSwapIfEnabled(existingVideoUrl, enableFaceSwap, actorPhotos, detectedCharacters);
        return NextResponse.json({
          videoUrl: faceSwapResult.videoUrl,
          faceSwapped: faceSwapResult.faceSwapped,
          originalVideoUrl: faceSwapResult.originalVideoUrl,
          faceSwapError: faceSwapResult.faceSwapError,
          audioMerged: false,
        });
      } catch (error: any) {
        console.error('Face swap error:', error);
        return NextResponse.json(
          { error: 'Face swap failed', details: error.message },
          { status: 500 }
        );
      }
    }
    const rawUserDialogue =
      typeof body?.dialogue === 'string'
        ? body.dialogue
        : typeof body?.script === 'string'
          ? body.script
          : typeof body?.voiceScript === 'string'
            ? body.voiceScript
            : '';
    let dialogue = rawUserDialogue;
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

    const resolvedPersonaStoragePath =
      (typeof body?.persona?.storage_path === 'string' ? body.persona.storage_path : '')
      || (typeof body?.persona?.storagePath === 'string' ? body.persona.storagePath : '')
      || (typeof body?.storage_path === 'string' ? body.storage_path : '')
      || (typeof body?.storagePath === 'string' ? body.storagePath : '');

    // Default to grok when engine is not specified (quick generate / frictionless UX).
    const fallbackEngineFromBooleans =
      body?.engine
        ? null
        : body?.useVeo
          ? 'veo'
          : body?.useKling
            ? 'kling_avatar_v2'
            : body?.useGrok
              ? 'grok'
              : null;
    const rawEngine = String(fallbackEngineFromBooleans ?? bodyEngine ?? qualityTier ?? 'grok').trim().toLowerCase();
    const engine =
      rawEngine === 'runway' || rawEngine === 'runway_gen4' || rawEngine === 'runway_gen45' || rawEngine === 'runway-gen4' || rawEngine === 'runway-gen4.5'
        ? 'runway'
        : rawEngine === 'veo'
          ? 'veo'
          : rawEngine === 'grok'
            ? 'grok'
            : rawEngine === 'kling' || rawEngine === 'kling_avatar_v2' || rawEngine === 'kling-avatar-v2'
              ? 'kling_avatar_v2'
              : rawEngine === 'kling_3_pro' || rawEngine === 'kling3' || rawEngine === 'kling3pro'
                ? 'kling_3_pro'
                : rawEngine === 'kling_2_6' || rawEngine === 'kling2.6' || rawEngine === 'kling26'
                  ? 'kling_2_6'
                  : rawEngine === 'kling_turbo' || rawEngine === 'kling_2_5_turbo' || rawEngine === 'protubo' || rawEngine === 'proturbo'
                    ? 'kling_turbo'
                    : 'grok';

    const useVeo = engine === 'veo';
    const useGrok = engine === 'grok';
    const useRunway = engine === 'runway';
    const useKlingAvatar = engine === 'kling_avatar_v2';
    const klingVideoModelKey =
      engine === 'kling_3_pro'
        ? ModelKey.KLING_PRO
        : engine === 'kling_turbo'
          ? ModelKey.KLING_TURBO
          : engine === 'kling_2_6'
            ? ModelKey.KLING_STANDARD
            : null;
    const useKlingVideo = Boolean(klingVideoModelKey);

    const runwayModelRaw = String((body as any)?.runwayModel || (body as any)?.runway_model || (body as any)?.runway?.model || 'gen4.5').trim();
    const runwayModelAllowed: RunwayI2VModel[] = ['gen4.5', 'gen4_turbo', 'gen3a_turbo', 'veo3', 'veo3.1', 'veo3.1_fast'];
    const runwayModel: RunwayI2VModel = runwayModelAllowed.includes(runwayModelRaw as any) ? (runwayModelRaw as RunwayI2VModel) : 'gen4.5';

    // Enhance prompt with detected characters for better video generation
    let enhancedPrompt = userPrompt || prompt || 'cinematic shot of a person moving';
    if (detectedCharacters.length > 0 && enableFaceSwap) {
      const charactersList = detectedCharacters.join(', ');
      enhancedPrompt = `${enhancedPrompt}. Characters in scene: ${charactersList}. Each character should be clearly visible and distinct.`;
      console.log('🎬 Enhanced prompt with characters:', charactersList);
    }
    const safePrompt = enhancedPrompt;
    const originalPrompt = safePrompt;
    const normalizePrompt = (text: string, trigger?: string) => {
      if (!trigger) return text.trim();
      const escaped = trigger.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const stripRegex = new RegExp(`\\b${escaped}\\b`, 'gi');
      const cleaned = text.replace(stripRegex, '').replace(/^[,\s]+|[,\s]+$/g, '').trim();
      return cleaned;
    };
    let normalizedPrompt = normalizePrompt(safePrompt, resolvedTriggerWord);
    const sanitizePrompt = (text: string) => (
      text
        .replace(/\bblood\b/gi, 'red cinematic lighting, crimson fluid, dark liquid')
        .replace(/\bbrutal kill\b/gi, 'high stakes combat, neutralizing threat, intense action choreography')
        .replace(/\bbone cracking\b/gi, 'heavy impact sound, deep thud, physical collision')
        .replace(/\bkill\b/gi, 'neutralize opponent, final strike, dramatic ending')
        .replace(/\bbreak bones\b/gi, 'heavy impact, brutal physics, martial arts choreography')
    );
    const makeSafePrompt = (promptText: string): string => (
      promptText
        .replace(/blood/gi, 'red light')
        .replace(/fight/gi, 'action pose')
        .replace(/punch/gi, 'dynamic motion')
        .replace(/hit/gi, 'impact')
        .replace(/kill/gi, 'victory')
        .replace(/hurt/gi, 'intense')
        .replace(/wound/gi, 'battle mark')
        .replace(/bravewarrior108/gi, 'hero character')
        + ', cinematic lighting, hero shot, no violence'
    );
    const softenPrompt = (text: string) => (
      text
        .replace(/\bfight scene\b/gi, 'intense action sequence')
        .replace(/\bviolence\b/gi, 'high stakes action')
        .replace(/\bgore\b/gi, 'dramatic tension')
    );
    const personaActive = Boolean(resolvedPersonaModelId || resolvedTriggerWord);
    const genderRaw = (body as any)?.persona?.gender ?? (body as any)?.gender;
    let personaGender: 'male' | 'female' | undefined =
      genderRaw === 'male' || genderRaw === 'female' ? genderRaw : undefined;
    if (personaActive && !personaGender) {
      try {
        const personaIdHint = String((body as any)?.personaId || (body as any)?.id || '').trim();
        const all = await readPersonas();
        const match = all.find((p: any) =>
          (personaIdHint && (p?.personaId === personaIdHint || p?.trainingId === personaIdHint || p?.modelId === personaIdHint))
          || (resolvedPersonaModelId && (p?.personaId === resolvedPersonaModelId || p?.trainingId === resolvedPersonaModelId || p?.modelId === resolvedPersonaModelId || p?.destinationModel === resolvedPersonaModelId))
        );
        if (match?.gender === 'male' || match?.gender === 'female') {
          personaGender = match.gender;
        }
      } catch (e: any) {
        console.warn('Persona gender lookup failed; continuing without gender.', String(e?.message || e));
      }
    }
    if (personaActive && personaGender) {
      try {
        const token = String(resolvedTriggerWord || '').trim();
        const withToken = token ? `${token} ${normalizedPrompt}`.trim() : normalizedPrompt;
        normalizedPrompt = await enhancePrompt(withToken, true, personaGender);
      } catch (e: any) {
        console.warn('Prompt enhancer failed; continuing with normalized prompt.', String(e?.message || e));
      }
    }
    const safeUserIdea = normalizedPrompt;
    const audioPrompt = `${originalPrompt}, heavy impact sounds, fighting sfx, grunts, aggressive atmosphere`;
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
    let voiceEmotionSettings: {
      stability?: number;
      similarity_boost?: number;
      style?: number;
      use_speaker_boost?: boolean;
    } | undefined;
    let voiceCategory = '';
    let audioEnvironment = '';
    let isActionScene = false;
    let isFightAction = false;
    let intentMode: 'ACTION_MODE' | 'TALKING_MODE' = 'TALKING_MODE';
    let referenceImageUrl = '';
    // HF LoRA collection: supports multi-persona selection (character + location + prop).
    const providedPersonas = Array.isArray((body as any)?.personas)
      ? (body as any).personas
      : (body as any)?.persona
        ? [(body as any).persona]
        : [];
    const requestedPersonaIds: string[] = Array.isArray((body as any)?.personaIds)
      ? (body as any).personaIds.map((v: any) => String(v)).filter(Boolean)
      : [];
    let loadedPersonas: any[] = [];
    if (requestedPersonaIds.length > 0) {
      try {
        const all = await readPersonas();
        loadedPersonas = all.filter((p) => requestedPersonaIds.includes(p.personaId));
      } catch (e) {
        console.warn('[generate-video] readPersonas failed while resolving personaIds:', (e as Error)?.message ?? e);
      }
    }
    const personaPool = [...providedPersonas, ...loadedPersonas];
    const hfUrls = uniqStrings(personaPool.map((p: any) => p?.huggingFaceUrl || p?.huggingface_url)).map(withDownloadTrue);
    const triggerWords = uniqStrings([resolvedTriggerWord, ...personaPool.map((p: any) => p?.triggerWord || p?.trigger_word || '')]);

        /** Generate reference image. If sceneImagePrompt provided (from Gemini Phase 1), use it so the image matches the scene. Otherwise use rawPrompt + action/talk logic. */
    const buildReferenceImageFirst = async (
      rawPrompt: string,
      options?: { sceneImagePrompt?: string; forceActionFraming?: boolean }
    ): Promise<string> => {
      const explicitUserRef = body?.sourceImage || bodyReferenceImageUrl || body?.reference_image_url || body?.referenceImage;
      if (explicitUserRef) {
        console.log('✅ USING PROVIDED REFERENCE IMAGE (Flux-first flow):', explicitUserRef);
        return explicitUserRef;
      }
      const refWithoutPersona = personaImageUrl || personaUrl;
      if (!resolvedPersonaModelId && refWithoutPersona) {
        console.log('✅ USING PERSONA/REF IMAGE (no model):', refWithoutPersona);
        return refWithoutPersona;
      }
      const sceneImagePrompt = options?.sceneImagePrompt?.trim();
      const useScenePrompt = !!sceneImagePrompt;
      if (useScenePrompt) {
        console.log('📸 Using Gemini scene-specific image prompt for reference frame');
      }
      let cleanImageUrl = '';
      const promptWithTrigger = (resolvedTriggerWord ? `${resolvedTriggerWord} ` : '') + rawPrompt.trim();
      const baseForImage = useScenePrompt
        ? (resolvedTriggerWord && !sceneImagePrompt!.toLowerCase().includes(resolvedTriggerWord.toLowerCase())
            ? `${resolvedTriggerWord} ${sceneImagePrompt}`
            : sceneImagePrompt!)
        : promptWithTrigger;
      const qualityPrefix = highQualityPrefix;
      if (resolvedPersonaModelId) {
        console.log('📸 [FLUX FIRST] Generating persona reference image' + (useScenePrompt ? ' (scene-tailored)' : '') + '...');
        let targetModelVersion = resolvedPersonaModelId;
        if (!resolvedPersonaModelId.includes('/') && !resolvedPersonaModelId.includes(':')) {
          try {
            const training = await replicate.trainings.get(resolvedPersonaModelId);
            if (training.output?.version) targetModelVersion = training.output.version;
            else if (training.version) targetModelVersion = training.version;
          } catch {
            console.warn('ID resolve skipped');
          }
        }
        const shouldForceAction = Boolean(options?.forceActionFraming);
        const isAction =
          shouldForceAction
          || isActionLikePrompt(rawPrompt)
          || (useScenePrompt ? isActionLikePrompt(sceneImagePrompt || '') : false);
        const personaPrompt = useScenePrompt
          ? (isAction
              ? buildFluxActionPrompt(`${resolvedTriggerWord || 'TOK'}, ${qualityPrefix} ${baseForImage}`.trim(), { triggerWord: resolvedTriggerWord })
              : `${resolvedTriggerWord || 'TOK'}, ${qualityPrefix} ${baseForImage}`.trim())
          : (isAction
              ? buildFluxActionPrompt(`${resolvedTriggerWord || 'TOK'}, ${qualityPrefix} ${promptWithTrigger}`.trim(), { triggerWord: resolvedTriggerWord })
              : `${resolvedTriggerWord || 'TOK'}, wide angle, full body or face, cinematic, ${qualityPrefix} ${promptWithTrigger}`.trim());
        // If persona has Hugging Face LoRA(s), inject them into a LoRA-capable Flux endpoint.
        if (hfUrls.length > 0) {
          const model =
            hfUrls.length > 1
              ? (process.env.REPLICATE_FLUX_MULTI_LORA_MODEL || 'lucataco/flux-dev-multi-lora')
              : (process.env.REPLICATE_FLUX_LORA_MODEL || 'black-forest-labs/flux-dev-lora');
          const loraPrompt = ensurePromptHasTriggers(personaPrompt, triggerWords);
          let loraOutput: any = null;
          try {
            if (hfUrls.length > 1) {
              loraOutput = await runReplicateWithRetry(model, {
                prompt: loraPrompt,
                hf_loras: hfUrls,
                aspect_ratio: '16:9',
                output_quality: 100,
                output_format: 'png',
                num_inference_steps: 50,
              });
            } else {
              loraOutput = await runReplicateWithRetry(model, {
                prompt: loraPrompt,
                lora_weights: hfUrls[0],
                lora_scale: 1.0,
                aspect_ratio: '16:9',
                output_quality: 100,
                output_format: 'png',
                num_inference_steps: 50,
              });
            }
          } catch (e: any) {
            // Fallback to minimal inputs if the model rejects optional fields.
            if (hfUrls.length > 1) {
              loraOutput = await runReplicateWithRetry(model, { prompt: loraPrompt, hf_loras: hfUrls });
            } else {
              loraOutput = await runReplicateWithRetry(model, { prompt: loraPrompt, lora_weights: hfUrls[0], lora_scale: 1.0 });
            }
          }
          const loraStream = findFirstStream(loraOutput);
          if (loraStream) {
            try {
              const streamBuffer = Buffer.from(await new Response(loraStream).arrayBuffer());
              cleanImageUrl = await saveBufferToPublic(streamBuffer, 'png');
              console.log('🧪 STREAM OUTPUT SAVED TO /generated:', cleanImageUrl);
            } catch (error) {
              console.warn('STREAM SAVE FAILED, URL fallback denenecek:', error);
            }
          }
          if (!cleanImageUrl) cleanImageUrl = extractImageUrl(loraOutput);
          if (!cleanImageUrl) throw new Error('HF LoRA persona reference image generation failed.');
          return cleanImageUrl;
        }
        const personaImagePayload = {
          prompt: personaPrompt,
          aspect_ratio: '16:9',
          num_outputs: 1,
          num_inference_steps: 50,
          guidance_scale: 3.5,
          output_format: 'png',
          disable_safety_checker: true,
          lora_scale: 1.0,
        };
        let imageOutput: any = null;
        try {
          imageOutput = await runReplicateWithRetry(targetModelVersion, personaImagePayload);
        } catch (error: any) {
          if (String(error?.message || '').includes('E005')) {
            imageOutput = await runReplicateWithRetry(targetModelVersion, { ...personaImagePayload, prompt: makeSafePrompt(personaPrompt) });
          } else {
            throw error;
          }
        }
        const personaStream = findFirstStream(imageOutput);
        if (personaStream) {
          try {
            const streamBuffer = Buffer.from(await new Response(personaStream).arrayBuffer());
            cleanImageUrl = await saveBufferToPublic(streamBuffer, 'png');
            console.log('🧪 STREAM OUTPUT SAVED TO /generated:', cleanImageUrl);
          } catch (error) {
            console.warn('STREAM SAVE FAILED, URL fallback denenecek:', error);
          }
        }
        if (!cleanImageUrl) cleanImageUrl = extractImageUrl(imageOutput);
        if (!cleanImageUrl) {
          const videoUrl = extractVideoUrl(imageOutput);
          if (videoUrl) {
            console.warn('Reference model returned video for image slot; extracting first frame as PNG.');
            cleanImageUrl = await extractFirstFrameToPng(videoUrl);
          }
        }
        if (!cleanImageUrl) throw new Error('Persona reference image generation failed.');
      } else {
        console.log('📸 [FLUX FIRST] Generating Flux 2 Max reference image' + (useScenePrompt ? ' (scene-tailored)' : '') + '...');
        const basePrompt = useScenePrompt ? `${qualityPrefix} ${baseForImage}`.trim() : `${highQualityPrefix} ${promptWithTrigger}`.trim();
        const shouldForceAction = Boolean(options?.forceActionFraming);
        const isAction =
          shouldForceAction
          || isActionLikePrompt(rawPrompt)
          || (useScenePrompt ? isActionLikePrompt(sceneImagePrompt || '') : false);
        const fluxPrompt = isAction ? buildFluxActionPrompt(basePrompt, { triggerWord: resolvedTriggerWord }) : basePrompt;
        // If HF LoRAs are selected (no trained model), use LoRA-capable endpoint instead of Flux 2 Max.
        if (hfUrls.length > 0) {
          const model =
            hfUrls.length > 1
              ? (process.env.REPLICATE_FLUX_MULTI_LORA_MODEL || 'lucataco/flux-dev-multi-lora')
              : (process.env.REPLICATE_FLUX_LORA_MODEL || 'black-forest-labs/flux-dev-lora');
          const loraPrompt = ensurePromptHasTriggers(fluxPrompt, triggerWords);
          let loraOutput: any = null;
          try {
            if (hfUrls.length > 1) {
              loraOutput = await runReplicateWithRetry(model, {
                prompt: loraPrompt,
                hf_loras: hfUrls,
                aspect_ratio: '16:9',
                output_quality: 100,
                output_format: 'png',
                num_inference_steps: 50,
              });
            } else {
              loraOutput = await runReplicateWithRetry(model, {
                prompt: loraPrompt,
                lora_weights: hfUrls[0],
                lora_scale: 0.95,
                aspect_ratio: '16:9',
                output_quality: 100,
                output_format: 'png',
                num_inference_steps: 50,
              });
            }
          } catch (e: any) {
            if (hfUrls.length > 1) {
              loraOutput = await runReplicateWithRetry(model, { prompt: loraPrompt, hf_loras: hfUrls });
            } else {
              loraOutput = await runReplicateWithRetry(model, { prompt: loraPrompt, lora_weights: hfUrls[0], lora_scale: 0.95 });
            }
          }
          const loraStream = findFirstStream(loraOutput);
          if (loraStream) {
            try {
              const streamBuffer = Buffer.from(await new Response(loraStream).arrayBuffer());
              cleanImageUrl = await saveBufferToPublic(streamBuffer, 'png');
              console.log('🧪 STREAM OUTPUT SAVED TO /generated:', cleanImageUrl);
            } catch (error) {
              console.warn('STREAM SAVE FAILED, URL fallback denenecek:', error);
            }
          }
          if (!cleanImageUrl) cleanImageUrl = extractImageUrl(loraOutput);
          if (!cleanImageUrl) throw new Error('HF LoRA reference image generation failed.');
          return cleanImageUrl;
        }
        const imagePayload = {
          prompt: fluxPrompt,
          aspect_ratio: '16:9',
          output_quality: 100,
          output_format: 'png',
          num_inference_steps: 50,
        };
        let imageOutput: any = null;
        try {
          imageOutput = await runReplicateWithRetry('black-forest-labs/flux-2-max', imagePayload);
        } catch (error: any) {
          if (String(error?.message || '').includes('E005')) {
            imageOutput = await runReplicateWithRetry('black-forest-labs/flux-2-max', { ...imagePayload, prompt: makeSafePrompt(`${resolvedTriggerWord || 'hero'} ${rawPrompt}`) });
          } else {
            throw error;
          }
        }
        const fluxStream = findFirstStream(imageOutput);
        if (fluxStream) {
          try {
            const streamBuffer = Buffer.from(await new Response(fluxStream).arrayBuffer());
            cleanImageUrl = await saveBufferToPublic(streamBuffer, 'png');
            console.log('🧪 STREAM OUTPUT SAVED TO /generated:', cleanImageUrl);
          } catch (error) {
            console.warn('STREAM SAVE FAILED, URL fallback denenecek:', error);
          }
        }
        if (!cleanImageUrl) cleanImageUrl = extractImageUrl(imageOutput);
        if (!cleanImageUrl) {
          const videoUrl = extractVideoUrl(imageOutput);
          if (videoUrl) {
            console.warn('Flux output returned video for image slot; extracting first frame as PNG.');
            cleanImageUrl = await extractFirstFrameToPng(videoUrl);
          }
        }
        if (!cleanImageUrl) throw new Error('Flux reference image generation failed.');
      }
      return cleanImageUrl;
    };

    let model: ReturnType<typeof genAI.getGenerativeModel> | null = null;
    let phase1ImagePrompt = '';
    if (process.env.GEMINI_API_KEY) {
      try {
        const preferredModel = 'gemini-2.5-flash';
        const resolvedModel = await getGeminiModelId(process.env.GEMINI_API_KEY, preferredModel);
        model = genAI.getGenerativeModel({
          model: resolvedModel,
          generationConfig: { temperature: 0.7 },
        });


        // ——— PHASE 1: Scene-specific IMAGE prompt (no image yet). This prompt will be used to GENERATE the reference image. ———
        const cinemaSceneRecognition = videoMode === 'cinematic_fight' ? `
——— CINEMA SCENE & CHARACTER RECOGNITION (MANDATORY) ———
You are a Film Historian and VFX Director. Automatically recognize famous cinematic scenes and inject their EXACT physics, visuals, and audio style into the prompt. Make it BETTER than the original: 8k resolution, ultra-detailed CGI, advanced fluid/particle physics simulation.

**DCEU SCENE DATABASE (Auto-Triggered by keywords):**
- If user input matches "Superman vs Zod" / "Man of Steel" / "Man of Steel final fight" / "Superman final fight" / "Superman Zod fight": Inject -> "Zack Snyder's Man of Steel (2013) style. High-impact physics, slow-motion debris, building destruction, heat vision impacts, devastating sonic booms, volumetric dust, heat vision distortion. Desaturated color grading, IMAX 70mm, epic scale. Heavy impact sound design, Hans Zimmer's 'Flight' style epic score, massive impact sounds."
- If matches "Batman warehouse fight" / "Batman warehouse" / "Batman vs thugs" / "Batman warehouse scene": Inject -> "Batman v Superman (2016) style. Brutal hand-to-hand combat, bone-cracking impacts, debris flying, splintering wood crates. Dark, gritty, handheld camera, shaky-cam. Junkie XL's percussive score style, visceral impact thuds."
- If matches "Wonder Woman No Man's Land" / "Wonder Woman trench" / "Wonder Woman No Man's Land scene": Inject -> "Wonder Woman (2017) style. Bullet-time effects, spark showers from shield impacts, slow-motion trench debris. Golden hour lighting, epic heroic wide shots. Rupert Gregson-Williams' epic orchestral heroic score."
- If matches "Superman vs Doomsday" / "Superman death" / "Doomsday fight": Inject -> "Batman v Superman (2016) style. Massive impacts, building destruction, kryptonite effects, slow-motion death. Dark, desaturated, epic scale. Hans Zimmer/Junkie XL emotional strings, massive impacts."
- If matches "Justice League action" / "Snyder Cut" / "Justice League fight" / "Justice League battle": Inject -> "Zack Snyder's Justice League (2021). Extreme slow-motion action, debris, lightning/energy blasts, floating debris. Dark epic scale, 4:3 aspect ratio framing feel. Junkie XL's massive operatic score."
- If matches "Aquaman underwater" / "Aquaman battle" / "Aquaman underwater fight": Inject -> "Aquaman (2018) style. Water dynamics, slow-motion underwater, hair/cloth movement, bubbles. Vibrant colors, underwater lighting, James Wan's style. Rupert Gregson-Williams' aquatic score."
- If matches "Shazam action" / "Shazam fight" / "Shazam battle": Inject -> "Shazam! (2019) style. Superhero impacts, building destruction, lightning effects, practical comedy. Bright, colorful, David F. Sandberg's style. Benjamin Wallfisch's heroic score."

**DC CHARACTER AUTO-REFERENCE (Fallback if scene not specified):**
- Superman → "Man of Steel/Zack Snyder visual aesthetic. Henry Cavill's Superman, textured suit, heat vision, epic scale. Slow-motion debris, building destruction, sonic booms. Desaturated color grading, IMAX 70mm. Hans Zimmer's epic score style."
- Batman → "Batman v Superman warehouse/The Dark Knight gritty tactical aesthetic. Christian Bale's Batman or Ben Affleck's tactical suit, dark, brutal combat. Handheld camera, bone-cracking impacts. Junkie XL percussive score style."
- Wonder Woman → "Wonder Woman No Man's Land/Patty Jenkins style. Gal Gadot's Wonder Woman, golden hour, epic heroic framing. Bullet-time, shield impacts. Orchestral heroic score."
- Flash → "Snyder Cut Speed Force lightning effects, hyper-slow-motion, energy trails. Extreme slow-motion action, energy blasts."
- Darkseid → "Snyder Cut Darkseid design. Highly detailed CGI design, imposing presence, massive scale. Dark epic scale, 4:3 aspect ratio feel."
- Aquaman → "Aquaman underwater/James Wan style. Jason Momoa's Aquaman, underwater dynamics, vibrant colors. Water dynamics, slow-motion underwater. Aquatic score."
- Cyborg → "Snyder Cut CGI design. Energy blasts, mechanical detail, CGI design."
- Shazam → "Shazam! (2019) style. Bright, colorful, comedic timing, lightning effects. Superhero impacts, building destruction."

**RECOGNITION RULES (MANDATORY):**
1. If user describes a famous scene (e.g. "Superman vs Zod", "Batman warehouse fight"), IMMEDIATELY recognize it and inject the EXACT physics engine (slow-motion patterns, debris behavior, impact style), EXACT visual style (director's color grading, camera work, lighting), and EXACT audio style (composer's score style, impact sound design) from the database above.
2. Make it BETTER than the original: Add "8k resolution, ultra-detailed CGI, advanced fluid/particle physics simulation, improved VFX rendering" to enhance beyond the source material.
3. For DC characters mentioned without a specific scene, use the AUTO-REFERENCE fallback above to inject the appropriate cinematic style.

**OUTPUT FORMAT:**
When you recognize a scene or character, add to image_prompt/video_prompt: "[Scene Reference: Movie Name (Year). Director: Name. Physics: exact description. Visual: exact style. Audio: composer/style.] Then describe the scene with those exact references applied, enhanced to 8k, more detailed CGI, better physics simulation than the original."

` : '';

        const adsModeSection = videoMode === 'ads' ? `
——— ADS / PROMO MODE (Brand-Safe, Conversion-Focused) ———
When generating prompts for ads/promo content:

**HOOK → BENEFIT → CTA STRUCTURE:**
- Hook (0-3s): Attention-grabbing opening, clear visual focus
- Benefit (3-8s): Product/feature showcase, problem-solution, social proof
- CTA (8-12s): Clear call-to-action, product shot, contact info

**BRAND-SAFE RULES:**
- Clean, professional environment. No excessive destruction/VFX unless product-related
- Focus on product/person, not environment chaos
- Avoid dark/gritty unless brand requires it
- Keep lighting flattering and clear

**PLATFORM OPTIMIZATION:**
- For TikTok/Shorts: Vertical framing (9:16), quick cuts, hook-first
- For YouTube: Horizontal (16:9), longer beats, narrative flow

**NO CINEMA INJECTION:**
- Do NOT inject DCEU scene references, Snyder style, or excessive VFX unless user explicitly asks
- Keep it clean, conversion-focused, brand-appropriate

` : '';

        const premiumModeSection = useVeo ? `
——— PREMIUM MODE (Veo 3.1 — Ultra-Cinematic Hollywood VFX) ———
When generating the image_prompt, you MUST inject these Hollywood-grade cinematic elements:

**THE ZACK SNYDER RULE (Visuals):**
- ALWAYS include: "Zack Snyder style, IMAX 70mm, highly detailed CGI, 8k resolution, photorealistic, dramatic cinematic lighting, high contrast"
- Force exact movie references: "Henry Cavill as Superman wearing the Man of Steel textured suit," "Zack Snyder's Justice League Darkseid CGI design," "Josh Brolin's Thanos (Infinity War armored look)"

**THE VFX & PHYSICS RULE:**
- ALWAYS describe the environment being destroyed or reacting: "Shattering glass, concrete debris flying in slow-motion, volumetric smoke, dust particles illuminating in the light, shockwave ripples through the air"
- For action scenes: Include destruction, debris, volumetric effects, particles, shockwaves

**DYNAMIC CAMERA RULE:**
- NO static shots. ALWAYS include: "Dynamic tracking camera, shaky cam on impact, rapid zoom, heroic low-angle"
- Camera must feel kinetic and cinematic

**EXAMPLE TRANSFORMATION FOR VEO:**
User: "Superman fights Darkseid in the city"
Your image_prompt MUST include: "IMAX 70mm, Zack Snyder style cinematic action shot. Henry Cavill as Superman in his textured suit violently collides mid-air with the massive CGI Darkseid. A massive shockwave shatters the glass of surrounding skyscrapers. Concrete debris and dust particles float in slow-motion. Superman's eyes glow with intense, bright red heat vision lighting up the volumetric smoke. Hyper-realistic, dramatic dark lighting, Hollywood blockbuster VFX. Dynamic tracking camera, shaky cam on impact, heroic low-angle. 8k resolution, photorealistic."

` : '';

        const phase1Prompt = `
You are an elite cinematic director and visual prompt engineer. Classify the user's intent and output a scene-specific IMAGE prompt that will be used to GENERATE the reference frame. The generated image MUST match the scene type exactly — no shortcuts, no generic prompts.

${cinemaSceneRecognition}
——— CRITICAL: MOTION → FROZEN FRAME RULE (MANDATORY) ———
The image_prompt is a SINGLE frozen cinematic frame (film still). Users will often describe MOTION (jumping, diving, falling, punching, running, flying, etc.).
You MUST convert any motion request into a frozen mid-action POSE captured at a decisive moment:
- Use "freeze-frame", "high shutter speed", "mid-air", "impact moment", "splash about to happen", "just before contact", "caught in mid-leap", etc.
- Do NOT write a sequence of events for the image_prompt (no "then", no timelines). Describe ONE instant.
- Save all temporal / step-by-step motion for the video_prompt (Phase 2 will handle motion).

——— PURPOSE TYPES (choose one; image_prompt MUST match) ———
- FIGHT/WAR/ACTION: Fight-ready stance, tense, combat-ready. Environment: dark alley, warehouse, battlefield, dojo. No smiling. Low/wide angle, power and tension. First frame of a fight video.
- TALKING/CHAT/PODCAST: Calm, approachable, intelligent. Studio or warm room, soft background. Relaxed posture, eye contact. Soft lighting. No action cues.
- ADVERTISEMENT/PROMOTION: Confident, charismatic, controlled. Clean or premium environment. Clear silhouette, flattering light. Sells power/trust. No chaos.
- STORY/CINEMATIC: Narrative moment, emotion over action. Environment tells a story. Cinematic framing, depth. Movie still, not promo.
- HERO SHOT/ICONIC: Alone, strong iconic posture. Minimal background. Timeless, legendary. Defines the character.
- THREAT/INTIMIDATION: Menacing, standoff. Dark or imposing space. Dominant posture. Cold, threatening.
${premiumModeSection}
Rules:
- Always include the persona/character token (e.g. ${resolvedTriggerWord || 'character'}) in image_prompt.
- If user asks for action/movement (including non-violent stunts like diving/jumping), set mode=ACTION_MODE and is_action_scene=true.
- No comedy/cartoon unless user asks.
- Output ONLY valid JSON.

Persona/character token for this request: ${resolvedTriggerWord || 'the character'}
User idea: "${safeUserIdea}"

JSON:
{
  "purpose_type": "FIGHT_WAR_ACTION | TALKING_CHAT_PODCAST | ADVERTISEMENT_PROMOTION | STORY_CINEMATIC | HERO_SHOT_ICONIC | THREAT_INTIMIDATION",
  "mode": "ACTION_MODE | TALKING_MODE",
  "is_fight_action": true | false,
  "image_prompt": "Full scene-specific image prompt as a SINGLE frozen film still. [Persona]. [Camera/framing]. [Environment]. [Frozen pose capturing the user-requested motion as a decisive instant]. [Lighting]. [Style: photorealistic, 8k, cinematic${useVeo ? ', Zack Snyder style, IMAX 70mm, highly detailed CGI, dramatic cinematic lighting, high contrast, VFX destruction, volumetric smoke, dynamic camera' : ''}]. English. You MAY describe mid-action pose (e.g. mid-air dive) but DO NOT write multi-step motion sequences. Must look like the perfect starting frame for the described scene.",
  "voice_category": "male_villain | male_heroic | ...",
  "speech_text": "...",
  "sfx_prompt": "...",
  "audio_environment": "studio | cave | ...",
  "is_action_scene": true | false,
  "voice_settings": { "stability": 0.35, "similarity_boost": 0.75, "style": 0.5, "use_speaker_boost": true }
}
`;
        const phase1Result = await model.generateContent(phase1Prompt);
        const phase1Raw = phase1Result.response.text().trim();
        const phase1Parsed = extractGeminiJson(phase1Raw);
        if (phase1Parsed && typeof phase1Parsed === 'object') {
          phase1ImagePrompt = String((phase1Parsed as any).image_prompt ?? '').trim();
          const speechText = String((phase1Parsed as any).speech_text ?? '').trim();
          const sfxPrompt = String((phase1Parsed as any).sfx_prompt ?? '').trim();
          voiceCategory = String((phase1Parsed as any).voice_category ?? '').trim();
          audioEnvironment = String((phase1Parsed as any).audio_environment ?? '').trim();
          isActionScene = Boolean((phase1Parsed as any).is_action_scene);
          intentMode = resolveIntentMode((phase1Parsed as any).mode, isActionScene);
          isFightAction = Boolean((phase1Parsed as any).is_fight_action);
          if (!voiceId) intentMode = 'ACTION_MODE';
          const voiceSettingsRaw = (phase1Parsed as any).voice_settings;
          if (voiceSettingsRaw && typeof voiceSettingsRaw === 'object') {
            voiceEmotionSettings = {
              ...(Number.isFinite(Number(voiceSettingsRaw?.stability)) ? { stability: Number(voiceSettingsRaw.stability) } : {}),
              ...(Number.isFinite(Number(voiceSettingsRaw?.similarity_boost)) ? { similarity_boost: Number(voiceSettingsRaw.similarity_boost) } : {}),
              ...(Number.isFinite(Number(voiceSettingsRaw?.style)) ? { style: Number(voiceSettingsRaw.style) } : {}),
              use_speaker_boost: Boolean(voiceSettingsRaw?.use_speaker_boost),
            };
          }
          if (speechText) {
            audioContentType = 'speech';
            audioTextContent = speechText;
          } else if (sfxPrompt) {
            audioContentType = 'sfx';
            audioTextContent = sfxPrompt;
          }
          audioScript = speechText;
          sfxPromptText = sfxPrompt;
          if (personaActive && phase1ImagePrompt) {
            usedGeminiImagePrompt = true;
            imagePrompt = phase1ImagePrompt;
          }
        }

        if (personaActive) {
          // Persona varsa image-to-video akisi: referans gorsel + image-aware video prompt
          const forceActionFraming = intentMode === 'ACTION_MODE' || isFightAction || isActionScene;
          referenceImageUrl = await buildReferenceImageFirst(
            safeUserIdea,
            phase1ImagePrompt ? { sceneImagePrompt: phase1ImagePrompt, forceActionFraming } : { forceActionFraming }
          );
          console.log('🖼️ [FLUX FIRST] Reference image URL for Veo I2V:', referenceImageUrl?.slice(0, 80) + (referenceImageUrl?.length > 80 ? '...' : ''));

          // ——— PHASE 2: After image is generated — get VIDEO prompt from actual image (gorsel analiz). ———
          let videoFromPhase2 = '';
          try {
            const inlineData = await getImageInlineData(referenceImageUrl);
            const phase2PremiumNote = useVeo ? `
——— PREMIUM MODE (Veo 3.1 — Ultra-Cinematic) ———
ALWAYS inject into video_prompt: "Zack Snyder style, IMAX 70mm, highly detailed CGI, 8k resolution, photorealistic, dramatic cinematic lighting, high contrast. Shattering glass, concrete debris flying in slow-motion, volumetric smoke, dust particles illuminating in the light, shockwave ripples through the air. Dynamic tracking camera, shaky cam on impact, rapid zoom, heroic low-angle."
Force exact movie references (e.g. "Henry Cavill's Superman", "Josh Brolin's Thanos"). Describe environment destruction and VFX physics.

` : '';
            const phase2Prompt = `
This image is the reference frame for a video. The video will start from this EXACT frame. Based on this image and the user intent below, output ONLY a video_prompt that describes motion, physics, and camera from this starting frame. Same character/persona as in the image. No morphing, no face/outfit change. 6–8 seconds. No text, no watermark. English only.${phase2PremiumNote}
${cinemaSceneRecognition}
Output valid JSON only: { "video_prompt": "..." }.
User intent: "${safeUserIdea}"
`;
            const phase2Result = await model.generateContent([
              { text: phase2Prompt },
              { inlineData },
            ]);
            const phase2Raw = phase2Result.response.text().trim();
            const phase2Parsed = extractGeminiJson(phase2Raw);
            if (phase2Parsed && typeof phase2Parsed === 'object') {
              videoFromPhase2 = String((phase2Parsed as any).video_prompt ?? '').trim();
            }
          } catch (phase2Err) {
            console.warn('Phase 2 (video_prompt from image) failed, using fallback.', phase2Err);
          }

          if (videoFromPhase2) {
            usedGeminiVideoPrompt = true;
            videoPrompt = videoFromPhase2;
          } else {
            // Fallback: single Gemini call with image context (legacy-style) for video_prompt only
            const visualFallback = String((phase1Parsed as any)?.visual_prompt ?? '').trim();
            const videoFallback = String((phase1Parsed as any)?.video_prompt ?? '').trim() || visualFallback;
            if (videoFallback) {
              usedGeminiVideoPrompt = true;
              videoPrompt = videoFallback;
            }
          }
        } else {
          // Persona yoksa: sadece video promptu uret, referans gorsel olusturma.
          const videoOnlyPremiumNote = useVeo ? `
——— PREMIUM MODE (Veo 3.1 — Ultra-Cinematic) ———
For video_prompt, ALWAYS inject: "Zack Snyder style, IMAX 70mm, highly detailed CGI, 8k resolution, photorealistic, dramatic cinematic lighting, high contrast. Shattering glass, concrete debris flying in slow-motion, volumetric smoke, dust particles illuminating in the light, shockwave ripples through the air. Dynamic tracking camera, shaky cam on impact, rapid zoom, heroic low-angle."
Force exact movie references (e.g. "Henry Cavill's Superman", "Josh Brolin's Thanos"). Describe environment destruction and VFX physics.

` : '';
          const videoOnlyPrompt = `
You are a cinematic video motion prompt writer.${videoOnlyPremiumNote}
${cinemaSceneRecognition}
Return ONLY valid JSON:
{
  "video_prompt": "6-8s cinematic movement and camera plan in English${useVeo ? ', Zack Snyder style, IMAX 70mm, VFX destruction, volumetric effects, dynamic camera' : ''}",
  "mode": "ACTION_MODE | TALKING_MODE",
  "is_fight_action": true | false
}
User intent: "${safeUserIdea}"
`;
          const videoOnlyResult = await model.generateContent(videoOnlyPrompt);
          const videoOnlyRaw = videoOnlyResult.response.text().trim();
          const videoOnlyParsed = extractGeminiJson(videoOnlyRaw);
          const videoOnlyText = videoOnlyParsed && typeof videoOnlyParsed === 'object'
            ? String((videoOnlyParsed as any).video_prompt ?? '').trim()
            : '';
          if (videoOnlyText) {
            usedGeminiVideoPrompt = true;
            videoPrompt = videoOnlyText;
            intentMode = resolveIntentMode((videoOnlyParsed as any)?.mode, Boolean((videoOnlyParsed as any)?.is_fight_action));
            isFightAction = Boolean((videoOnlyParsed as any)?.is_fight_action);
          }
        }
      } catch (error) {
        console.warn('Gemini prompt enhancement failed, using raw prompt.', error);
      }
    }

    // When Gemini was not used or Phase 1 did not run: generate reference image without scene prompt
    if (!referenceImageUrl && personaActive) {
      referenceImageUrl = await buildReferenceImageFirst(safeUserIdea);
      console.log('🖼️ [FLUX FIRST] Reference image (no Gemini scene prompt):', referenceImageUrl?.slice(0, 80) + '...');
    }
    const femaleCueRegex = /\b(woman|female|girl|lady|she|her)\b/i;
    const maleCueRegex = /\b(man|male|boy|he|him)\b/i;
    const hasFemaleCue = femaleCueRegex.test(safeUserIdea);
    const hasMaleCue = maleCueRegex.test(safeUserIdea);
    const resolvedVoiceCategory = personaActive && !hasFemaleCue && !hasMaleCue
      ? (voiceCategory?.startsWith('female_') ? 'male_heroic' : voiceCategory)
      : voiceCategory;
    if (audioContentType === 'speech') {
      dialogue = audioTextContent;
    } else if (audioContentType === 'sfx') {
      dialogue = audioTextContent;
    } else {
      dialogue = '';
    }
    // If user explicitly selected Kling Avatar v2 (Lip-Sync), preserve the user-provided dialogue/script.
    if (useKlingAvatar) {
      const userDialogue = String(rawUserDialogue || '').trim();
      if (userDialogue) {
        dialogue = userDialogue;
        if (!audioContentType) audioContentType = 'speech';
      }
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
      imagePrompt = `${basePrefix ? `${basePrefix} ` : ''}${normalizedPrompt}`.trim();
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

    if (imagePrompt && !imagePrompt.toLowerCase().includes('arri alexa lf')) {
      imagePrompt = `${imagePrompt}${CINEMATIC_VISUAL_SUFFIX}`;
    }
    const visualPrompt = `${imagePrompt || originalPrompt}, 8k, action movie aesthetic`;

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

    // No persona: for Grok/Veo we can send the prompt directly without generating an anchor image.
    // Skip when user chose Kling (video or avatar): Kling video needs an anchor; Kling avatar needs image+audio.
    if (!personaActive && !useKlingAvatar && !useKlingVideo) {
      const promptOnly = videoPrompt || safeUserIdea;
      const durationSec = normalizeDurationForEngine(engine, body) ?? 5;
      console.log(`🎬 NO PERSONA → engine=${engine}`);

      if (useGrok) {
        const xaiKey = String(process.env.XAI_API_KEY || process.env.XAI_KEY || process.env.XAI_TOKEN || '').trim();
        const grokModel = process.env.REPLICATE_GROK_VIDEO_MODEL || 'xai/grok-imagine-video';
        let grokVideoUrl = '';
        let engineUsed = grokModel;

        // xAI-only: if Grok is selected, require XAI_API_KEY and do not fall back to Replicate.
        if (!xaiKey) {
          throw new Error('XAI_API_KEY is missing. Grok engine requires xAI API key (no Replicate fallback).');
        }
        const xai = await generateXaiVideo({
          prompt: promptOnly,
          duration: durationSec,
          aspectRatio: '16:9',
          resolution: (process.env.XAI_VIDEO_RESOLUTION || '480p') as any,
          model: (process.env.XAI_VIDEO_MODEL || 'grok-imagine-video') as any,
          timeoutMs: Number(process.env.XAI_VIDEO_TIMEOUT_MS || '') || undefined,
          pollIntervalMs: Number(process.env.XAI_VIDEO_POLL_MS || '') || undefined,
        });
        grokVideoUrl = xai.url;
        engineUsed = `xai/${xai.model}`;

        if (!grokVideoUrl || typeof grokVideoUrl !== 'string') {
          throw new Error('Grok video generation failed.');
        }
        grokVideoUrl = await normalizeReplicateAssetUrl(grokVideoUrl);
        logVideoCost(engineUsed, { mode: 'ACTION_MODE', intentMode });
        
        // Apply face swap if enabled (after grokVideoUrl is ready)
        let finalVideoUrl = grokVideoUrl;
        let originalVideoUrl: string | undefined = undefined;
        let faceSwapError: string | undefined = undefined;
        if (shouldApplyFaceSwap) {
          console.log('🎬 Grok (no persona): Applying face swap to generated video...');
          originalVideoUrl = grokVideoUrl;
          const faceSwapResult = await applyFaceSwapIfEnabled(grokVideoUrl, enableFaceSwap, actorPhotos!, detectedCharacters);
          finalVideoUrl = faceSwapResult.videoUrl;
          faceSwapError = faceSwapResult.faceSwapError;
          console.log(`✅ Grok (no persona): Face swap ${faceSwapResult.faceSwapped ? 'completed' : 'skipped'}`);
        }
        
        return NextResponse.json({
          success: true,
          type: 'video',
          url: finalVideoUrl,
          videoUrl: finalVideoUrl,
          thumbnailUrl: undefined,
          imageUrl: '',
          imagePrompt,
          videoPrompt,
          usedGeminiImagePrompt,
          usedGeminiVideoPrompt,
          audioMerged: false,
          engine: engineUsed,
          faceSwapped: shouldApplyFaceSwap ? true : false,
          originalVideoUrl: shouldApplyFaceSwap ? originalVideoUrl : undefined,
          faceSwapError: faceSwapError,
        });
      }

      if (useVeo) {
      const veoModel = process.env.REPLICATE_VEO_MODEL || 'google/veo-3.1';
      const veoFallbackModel = (process.env.REPLICATE_VEO_FALLBACK_MODEL || '').trim() || null;
      let veoOutput: unknown = null;
      let lastVeoError: unknown = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          veoOutput = await runReplicateWithRetry(veoModel, { prompt: promptOnly, duration: durationSec });
          lastVeoError = null;
          break;
        } catch (err: any) {
          lastVeoError = err;
          if (err?.status === 429 || String(err?.message || '').toLowerCase().includes('429')) {
            await sleep(1200);
            continue;
          }
          if (isSensitiveFlag(err)) continue;
          break;
        }
      }
      if (!veoOutput && veoFallbackModel) {
        try {
          veoOutput = await runReplicateWithRetry(veoFallbackModel, { prompt: promptOnly, duration: durationSec });
          lastVeoError = null;
        } catch (err) {
          lastVeoError = err;
        }
      }
      if (!veoOutput) {
        throw (lastVeoError as Error) || new Error('Veo video generation failed.');
      }
      let veoVideoUrl = extractVideoUrl(veoOutput);
      if (!veoVideoUrl) {
        const stream = findFirstStream(veoOutput);
        if (stream) {
          try {
            veoVideoUrl = await saveStreamToPublic(stream, 'mp4');
          } catch (error) {
            console.error('❌ VEO STREAM SAVE FAILED:', error);
          }
        }
      }
      if (!veoVideoUrl || typeof veoVideoUrl !== 'string') {
        throw new Error('Veo video generation failed.');
      }
      veoVideoUrl = await normalizeReplicateAssetUrl(veoVideoUrl);
      logVideoCost(veoModel, { mode: 'ACTION_MODE', intentMode });
      
      // Apply face swap if enabled (after veoVideoUrl is ready)
      let finalVideoUrl = veoVideoUrl;
      let originalVideoUrl: string | undefined = undefined;
      let faceSwapError: string | undefined = undefined;
      if (enableFaceSwap && actorPhotos && Object.keys(actorPhotos).length > 0) {
        originalVideoUrl = veoVideoUrl;
        const faceSwapResult = await applyFaceSwapIfEnabled(veoVideoUrl, enableFaceSwap, actorPhotos, detectedCharacters);
        finalVideoUrl = faceSwapResult.videoUrl;
        faceSwapError = faceSwapResult.faceSwapError;
      }
      
      return NextResponse.json({
        success: true,
        type: 'video',
        url: finalVideoUrl,
        videoUrl: finalVideoUrl,
        thumbnailUrl: undefined,
        imageUrl: '',
        imagePrompt,
        videoPrompt,
        usedGeminiImagePrompt,
        usedGeminiVideoPrompt,
        audioMerged: false,
        engine: veoModel,
        faceSwapped: enableFaceSwap && actorPhotos && Object.keys(actorPhotos).length > 0 ? true : false,
        originalVideoUrl: enableFaceSwap && actorPhotos && Object.keys(actorPhotos).length > 0 ? originalVideoUrl : undefined,
        faceSwapError: faceSwapError,
      });
      }
    }

    const restoreFace = async (inputUrl: string) => {
      const gfpganModel = process.env.RESTORE_FACE_MODEL_GFPGAN || '';
      const codeformerModel = process.env.RESTORE_FACE_MODEL_CODEFORMER || '';
      if (!gfpganModel && !codeformerModel) {
        return inputUrl;
      }
      try {
        console.log('🧼 RESTORING FACE (GFPGAN)...');
        const restoreOutput = await runReplicateWithRetry(gfpganModel, {
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

      if (!codeformerModel) {
        return inputUrl;
      }
      try {
        console.log('🧼 RESTORING FACE (CodeFormer)...');
        const restoreOutput = await runReplicateWithRetry(codeformerModel, {
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
      const explicitUserRef = body?.sourceImage || body?.reference_image_url || body?.referenceImage || referenceImageUrl;
      if (explicitUserRef) {
        return explicitUserRef;
      }
      if (!resolvedPersonaModelId && (personaImageUrl || personaUrl)) {
        const fallback = personaImageUrl || personaUrl;
        console.log('✅ USING PERSONA/REF IMAGE (no model):', fallback);
        return fallback;
      }
      let cleanImageUrl = '';

      if (resolvedPersonaModelId) {
        console.log('👤 PERSONA SEÇİLİ: Önce persona ile referans görsel üretiliyor, sonra video bu görsele göre yapılacak.');
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
        const isActionOrFight = intentMode === 'ACTION_MODE' || isFightAction;
        const personaVisibilityPrefix = isActionOrFight
          ? 'wide angle, full body shot, dynamic combat framing, environmental interaction,'
          : 'distinct facial features visible, recognizable identity, cinematic shot revealing the face,';
        const personaPrompt = `${resolvedTriggerWord || 'TOK'}, ${personaVisibilityPrefix} ${highQualityPrefix} ${visualPrompt}`.trim();
        const personaImagePayload = {
          prompt: personaPrompt,
          aspect_ratio: '16:9',
          num_outputs: 1,
          num_inference_steps: 50,
          guidance_scale: 3.5,
          output_format: 'png',
          disable_safety_checker: true,
          lora_scale: 0.95,
        };

        let imageOutput: any = null;
        try {
          imageOutput = await runReplicateWithRetry(targetModelVersion, personaImagePayload);
        } catch (error: any) {
          const message = String(error?.message || '');
          if (message.includes('E005') || message.toLowerCase().includes('sensitive')) {
            const fallbackPrompt = `${resolvedTriggerWord || 'hero character'}, cinematic portrait, dramatic lighting, intense atmosphere, 8k`;
            const safePrompt = makeSafePrompt(fallbackPrompt);
            imageOutput = await runReplicateWithRetry(targetModelVersion, {
              ...personaImagePayload,
              prompt: safePrompt,
            });
          } else {
            throw error;
          }
        }

        const personaStream = findFirstStream(imageOutput);
        if (personaStream) {
          try {
            const streamBuffer = Buffer.from(await new Response(personaStream).arrayBuffer());
            cleanImageUrl = await saveBufferToPublic(streamBuffer, 'png');
            console.log('🧪 STREAM OUTPUT SAVED TO /generated:', cleanImageUrl);
          } catch (error) {
            console.warn('STREAM SAVE FAILED, URL fallback denenecek:', error);
          }
        }
        if (!cleanImageUrl) cleanImageUrl = extractImageUrl(imageOutput);
        if (!cleanImageUrl) {
          const videoUrl = extractVideoUrl(imageOutput);
          if (videoUrl) {
            console.warn('Persona reference returned video; extracting first frame as PNG.');
            cleanImageUrl = await extractFirstFrameToPng(videoUrl);
          }
        }

        if (!cleanImageUrl || typeof cleanImageUrl !== 'string') {
          console.error('❌ INVALID IMAGE OUTPUT:', imageOutput);
          throw new Error('Critical: Persona reference image generation failed.');
        }

        console.log('✅ VALID PERSONA IMAGE URL EXTRACTED:', cleanImageUrl);
        cleanImageUrl = await restoreFace(cleanImageUrl);
      } else {
        console.log('📸 PERSONA YOK: Sadece prompt ile Flux 2 Max referans görsel üretiliyor.');
        const baseVisual = `${highQualityPrefix} ${visualPrompt}`.trim();
        const fluxPromptForImage =
          intentMode === 'ACTION_MODE' || isFightAction
            ? buildFluxActionPrompt(baseVisual, { triggerWord: resolvedTriggerWord })
            : baseVisual;
        const imagePayload = {
          prompt: fluxPromptForImage,
          aspect_ratio: '16:9',
          output_quality: 100,
          output_format: 'png',
          num_inference_steps: 50,
        };

        let imageOutput: any = null;
        try {
          imageOutput = await runReplicateWithRetry('black-forest-labs/flux-2-max', imagePayload);
        } catch (error: any) {
          const message = String(error?.message || '');
          if (message.includes('E005') || message.toLowerCase().includes('sensitive')) {
            const fallbackPrompt = `${resolvedTriggerWord || 'hero character'}, cinematic portrait, dramatic lighting, intense atmosphere, 8k`;
            const safePrompt = makeSafePrompt(fallbackPrompt);
            imageOutput = await runReplicateWithRetry('black-forest-labs/flux-2-max', {
              ...imagePayload,
              prompt: safePrompt,
            });
          } else {
            throw error;
          }
        }

        const fluxStream = findFirstStream(imageOutput);
        if (fluxStream) {
          try {
            const streamBuffer = Buffer.from(await new Response(fluxStream).arrayBuffer());
            cleanImageUrl = await saveBufferToPublic(streamBuffer, 'png');
            console.log('🧪 STREAM OUTPUT SAVED TO /generated:', cleanImageUrl);
          } catch (error) {
            console.warn('STREAM SAVE FAILED, URL fallback denenecek:', error);
          }
        }
        if (!cleanImageUrl) cleanImageUrl = extractImageUrl(imageOutput);
        if (!cleanImageUrl) {
          const videoUrl = extractVideoUrl(imageOutput);
          if (videoUrl) {
            console.warn('Reference generation returned video; extracting first frame as PNG.');
            cleanImageUrl = await extractFirstFrameToPng(videoUrl);
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

    console.log(
      `🎬 ENGINE: ${engine} → ${
        useKlingAvatar
          ? 'Kling Avatar v2 (Lip-Sync)'
          : useKlingVideo
            ? 'Kling Video (I2V)'
            : useVeo
              ? 'Veo 3.1'
              : 'Grok'
      }`
    );

    let finalVideoUrl = '';
    let audioMerged = false;
    let cleanImageUrl = '';
    const isActionMode = intentMode === 'ACTION_MODE';
    const isTalkingMode = intentMode === 'TALKING_MODE';

    console.log('--- DEBUG KONTROL ---');
    console.log('1. Dialogue Var mı?:', !!dialogue);
    console.log('2. Audio Category Nedir?:', audioContentType);
    console.log('3. Voice ID (ses personasi) Var mı?:', voiceId);
    console.log('4. engine (user selection):', engine);
    console.log('5. intentMode (ses yoksa zorla ACTION→Veo/Grok):', intentMode);
    console.log('--- DEBUG SONU ---');

    // Helper function to enhance prompt with actor facial details
    const enhancePromptWithActorDetails = (actionText: string): string => {
      const actorDetails: Record<string, string> = {
        'Henry Cavill': "Henry Cavill's exact facial features, distinctive jawline, blue eyes, strong chin, defined cheekbones",
        'Chris Hemsworth': "Chris Hemsworth's exact facial features, blonde beard, blue eyes, strong build, chiseled jawline",
        'Ben Affleck': "Ben Affleck's exact facial features, strong jawline, dark hair, brown eyes, mature look",
        'Gal Gadot': "Gal Gadot's exact facial features, dark hair, brown eyes, elegant features, strong presence",
        'Jason Momoa': "Jason Momoa's exact facial features, long dark hair, beard, blue eyes, muscular build",
        'Ezra Miller': "Ezra Miller's exact facial features, dark hair, expressive eyes, youthful appearance",
        'Ray Fisher': "Ray Fisher's exact facial features, strong jawline, dark features, commanding presence",
        'Zachary Levi': "Zachary Levi's exact facial features, dark hair, expressive eyes, youthful charm",
        'Michael Shannon': "Michael Shannon's exact facial features, intense eyes, strong jawline, commanding presence",
        'Michael Fassbender': "Michael Fassbender's exact facial features, strong jawline, blue eyes, intense look",
        'Tom Hardy': "Tom Hardy's exact facial features, strong build, intense eyes, rugged appearance",
        'Christian Bale': "Christian Bale's exact facial features, strong jawline, intense eyes, chiseled features",
      };
      
      let enhanced = actionText;
      
      // Extract actor names and add facial details
      for (const [actorName, facialDetails] of Object.entries(actorDetails)) {
        // Check if actor name appears in the action text (case-insensitive)
        const actorRegex = new RegExp(`\\b${actorName.replace(/\s+/g, '\\s+')}\\b`, 'gi');
        if (actorRegex.test(actionText)) {
          // Check if facial details are already present
          if (!actionText.toLowerCase().includes('facial features') && !actionText.toLowerCase().includes('exact facial')) {
            // Add facial details after actor name
            enhanced = enhanced.replace(actorRegex, `${actorName}, ${facialDetails}`);
          }
        }
      }
      
      return enhanced;
    };


    if (!useKlingAvatar && !useKlingVideo) {
      cleanImageUrl = referenceImageUrl || (personaActive ? (await buildReferenceImage()) : '');
      if (personaActive && (!cleanImageUrl || typeof cleanImageUrl !== 'string' || !cleanImageUrl.trim())) {
        throw new Error('Referans gorsel gerekli: Persona/Flux gorseli video motoruna (Veo/Grok) verilmeden once uretilmeli.');
      }
      const actionPrompt = videoPrompt || imagePrompt || safeUserIdea;
      const imageAbsolute = cleanImageUrl ? ensureAbsoluteUrl(cleanImageUrl) : '';

      if (useGrok && cleanImageUrl) {
        const xaiKey = String(process.env.XAI_API_KEY || process.env.XAI_KEY || process.env.XAI_TOKEN || '').trim();
        console.log('ENGINE=Grok (xAI): referans görsel (persona/Flux) ile image-to-video');
        // xAI-only: if Grok is selected, require XAI_API_KEY and do not fall back to Replicate.
        if (!xaiKey) {
          throw new Error('XAI_API_KEY is missing. Grok engine requires xAI API key (no Replicate fallback).');
        }
        const getReferenceImageAsDataUri = async (): Promise<string | null> => {
          try {
            if (cleanImageUrl.startsWith('data:')) return cleanImageUrl;
            if (cleanImageUrl.startsWith('/generated/')) {
              const { readFile } = await import('node:fs/promises');
              const buf = await readFile(path.join(process.cwd(), 'public', cleanImageUrl));
              return `data:image/jpeg;base64,${buf.toString('base64')}`;
            }
            const urlToFetch = imageAbsolute && imageAbsolute.startsWith('http') ? imageAbsolute : null;
            if (!urlToFetch) return null;
            const media = await downloadMediaWithValidation(urlToFetch, {
              token: process.env.REPLICATE_API_TOKEN || '',
              expectedKind: 'image',
              strictExpectedKind: true,
              logger: {
                info: (...args) => console.log(...args),
                warn: (...args) => console.warn(...args),
              },
            });
            const mime = media.contentType || 'image/jpeg';
            return `data:${mime};base64,${media.buffer.toString('base64')}`;
          } catch {
            return null;
          }
        };
        const grokImageInput = await getReferenceImageAsDataUri();
        if (!grokImageInput || !grokImageInput.trim()) {
          throw new Error('Grok icin referans gorsel gerekli; persona/Flux gorseli alinamadi (data URI).');
        }
        const durationSec = normalizeDurationForEngine(engine, body) ?? 5;
        let grokVideoUrl = '';
        let engineUsed = 'xai/grok-imagine-video';

        const xai = await generateXaiVideo({
          prompt: actionPrompt,
          imageUrl: grokImageInput,
          duration: durationSec,
          aspectRatio: '16:9',
          resolution: (process.env.XAI_VIDEO_RESOLUTION || '480p') as any,
          model: (process.env.XAI_VIDEO_MODEL || 'grok-imagine-video') as any,
          timeoutMs: Number(process.env.XAI_VIDEO_TIMEOUT_MS || '') || undefined,
          pollIntervalMs: Number(process.env.XAI_VIDEO_POLL_MS || '') || undefined,
        });
        grokVideoUrl = xai.url;
        engineUsed = `xai/${xai.model}`;
        if (!grokVideoUrl || typeof grokVideoUrl !== 'string') {
          throw new Error('Grok video generation failed.');
        }
        logVideoCost(engineUsed, { mode: 'ACTION_MODE', intentMode: 'ACTION_MODE' });
        
        // Apply face swap if enabled (after grokVideoUrl is ready)
        let finalVideoUrl = grokVideoUrl;
        let originalVideoUrl: string | undefined = undefined;
        let faceSwapError: string | undefined = undefined;
        if (shouldApplyFaceSwap) {
          console.log('🎬 Grok (with persona): Applying face swap to generated video...');
          originalVideoUrl = grokVideoUrl;
          const faceSwapResult = await applyFaceSwapIfEnabled(grokVideoUrl, enableFaceSwap, actorPhotos!, detectedCharacters);
          finalVideoUrl = faceSwapResult.videoUrl;
          faceSwapError = faceSwapResult.faceSwapError;
          console.log(`✅ Grok (with persona): Face swap ${faceSwapResult.faceSwapped ? 'completed' : 'skipped'}`);
        }
        
        return NextResponse.json({
          success: true,
          type: 'video',
          url: finalVideoUrl,
          videoUrl: finalVideoUrl,
          thumbnailUrl: cleanImageUrl || undefined,
          imageUrl: cleanImageUrl,
          imagePrompt,
          videoPrompt,
          usedGeminiImagePrompt,
          usedGeminiVideoPrompt,
          audioMerged: false,
          engine: engineUsed,
          faceSwapped: shouldApplyFaceSwap ? true : false,
          originalVideoUrl: shouldApplyFaceSwap ? originalVideoUrl : undefined,
          faceSwapError: faceSwapError,
        });
      }

      if (useGrok && !cleanImageUrl) {
        throw new Error('Grok icin referans gorsel gerekli; persona/Flux gorseli alinamadi.');
      }

      if (useVeo) {
      const veoModel = process.env.REPLICATE_VEO_MODEL || 'google/veo-3.1';
      const veoFallbackModel = (process.env.REPLICATE_VEO_FALLBACK_MODEL || '').trim() || null;
      console.log('ENGINE=Veo 3.1:', veoModel, 'referans gorsel var=', !!imageAbsolute);
      const baseVeoPrompt = actionPrompt;
      // Veo must receive a URL Replicate can fetch (no localhost). Reuse same buffer logic as Grok when local.
      let veoImageUrl = imageAbsolute;
      const isVeoUrlLocal =
        !!veoImageUrl && (veoImageUrl.includes('localhost') || veoImageUrl.includes('127.0.0.1') || veoImageUrl.includes('0.0.0.0') || veoImageUrl.startsWith('/'));
      if (veoImageUrl && isVeoUrlLocal) {
        const getRef = async (): Promise<{ buffer: Buffer; mime: string } | null> => {
          try {
            if (cleanImageUrl.startsWith('/generated/')) {
              const { readFile } = await import('node:fs/promises');
              const buf = await readFile(path.join(process.cwd(), 'public', cleanImageUrl));
              return { buffer: buf, mime: 'image/jpeg' };
            }
            const urlToFetch = imageAbsolute.includes('api.replicate.com/v1/files/')
              ? await resolveReplicateFileUrl(imageAbsolute, process.env.REPLICATE_API_TOKEN || '')
              : imageAbsolute.startsWith('http') ? imageAbsolute : null;
            if (!urlToFetch) return null;
            const media = await downloadMediaWithValidation(urlToFetch, {
              token: process.env.REPLICATE_API_TOKEN || '',
              expectedKind: 'image',
              strictExpectedKind: true,
              logger: {
                info: (...args) => console.log(...args),
                warn: (...args) => console.warn(...args),
              },
            });
            return { buffer: media.buffer, mime: media.contentType || 'image/jpeg' };
          } catch {
            return null;
          }
        };
        const ref = await getRef();
        if (ref) {
          const ext = ref.mime === 'image/png' ? 'png' : ref.mime === 'image/webp' ? 'webp' : 'jpg';
          try {
            veoImageUrl = await uploadBufferToReplicateAndGetUrl(ref.buffer, `veo-ref.${ext}`, ref.mime || 'image/jpeg');
            if (!veoImageUrl) throw new Error('uploadBufferToReplicateAndGetUrl returned empty');
          } catch (e) {
            console.warn('VEO: buffer→URL failed, trying storage direct.', (e as Error)?.message ?? e);
            try {
              veoImageUrl = await ensurePublicAssetUrl(
                { buffer: ref.buffer, contentType: ref.mime || 'image/jpeg', suggestedName: `veo-ref.${ext}` },
                { token: process.env.REPLICATE_API_TOKEN || '', resolveAbsoluteUrl: ensureAbsoluteUrl, logger: { info: (...a: unknown[]) => console.log(...a), warn: (...a: unknown[]) => console.warn(...a) } }
              );
            } catch (e2) {
              console.warn('VEO: storage direct failed.', (e2 as Error)?.message ?? e2);
            }
          }
        }
      } else if (veoImageUrl && imageAbsolute.includes('api.replicate.com/v1/files/')) {
        try {
          const resolved = await resolveReplicateFileUrl(imageAbsolute, process.env.REPLICATE_API_TOKEN || '');
          if (resolved && resolved !== imageAbsolute) veoImageUrl = resolved;
        } catch {
          // keep veoImageUrl as api URL; runner may resolve with token
        }
      }
      const isVeoImageUrlLocal =
        !!veoImageUrl && (veoImageUrl.includes('localhost') || veoImageUrl.includes('127.0.0.1') || veoImageUrl.startsWith('/'));
      if (isVeoImageUrlLocal) {
        console.warn('VEO: referans URL local kaldi; Veo text-only (image yok) ile cagriliyor.');
        veoImageUrl = '';
      }
      const runVeo = async (promptText: string, modelKey?: string) =>
        runReplicateWithRetry(
          modelKey || veoModel,
          veoImageUrl
            ? { prompt: promptText, image: veoImageUrl }
            : { prompt: promptText }
        );
      let veoOutput: unknown = null;
      let lastVeoError: unknown = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          veoOutput = await runVeo(baseVeoPrompt);
          lastVeoError = null;
          break;
        } catch (err: any) {
          lastVeoError = err;
          if (err?.status === 429 || String(err?.message || '').toLowerCase().includes('429')) {
            await sleep(1200);
            continue;
          }
          if (isSensitiveFlag(err)) continue;
          break;
        }
      }
      if (!veoOutput && veoFallbackModel) {
        try {
          veoOutput = await runVeo(baseVeoPrompt, veoFallbackModel);
          lastVeoError = null;
        } catch (err) {
          lastVeoError = err;
        }
      }
      if (!veoOutput) {
        throw (lastVeoError as Error) || new Error('Veo video generation failed.');
      }
      let veoVideoUrl = extractVideoUrl(veoOutput);
      if (!veoVideoUrl) {
        const stream = findFirstStream(veoOutput);
        if (stream) {
          try {
            console.log('🧪 VEO STREAM OUTPUT DETECTED: saving locally...');
            veoVideoUrl = await saveStreamToPublic(stream, 'mp4');
          } catch (error) {
            console.error('❌ VEO STREAM SAVE FAILED:', error);
          }
        }
      }
      if (!veoVideoUrl || typeof veoVideoUrl !== 'string') {
        throw new Error('Veo video generation failed.');
      }
      veoVideoUrl = await normalizeReplicateAssetUrl(veoVideoUrl);
      logVideoCost(veoModel, { mode: 'ACTION_MODE', intentMode: 'ACTION_MODE' });
      
      // Apply face swap if enabled (after veoVideoUrl is ready)
      let finalVideoUrl = veoVideoUrl;
      let originalVideoUrl: string | undefined = undefined;
      let faceSwapError: string | undefined = undefined;
      if (enableFaceSwap && actorPhotos && Object.keys(actorPhotos).length > 0) {
        originalVideoUrl = veoVideoUrl;
        const faceSwapResult = await applyFaceSwapIfEnabled(veoVideoUrl, enableFaceSwap, actorPhotos, detectedCharacters);
        finalVideoUrl = faceSwapResult.videoUrl;
        faceSwapError = faceSwapResult.faceSwapError;
      }
      
      return NextResponse.json({
        success: true,
        type: 'video',
        url: finalVideoUrl,
        videoUrl: finalVideoUrl,
        thumbnailUrl: cleanImageUrl || undefined,
        imageUrl: cleanImageUrl,
        imagePrompt,
        videoPrompt,
        usedGeminiImagePrompt,
        usedGeminiVideoPrompt,
        audioMerged: false,
        engine: veoModel,
        faceSwapped: enableFaceSwap && actorPhotos && Object.keys(actorPhotos).length > 0 ? true : false,
        originalVideoUrl: enableFaceSwap && actorPhotos && Object.keys(actorPhotos).length > 0 ? originalVideoUrl : undefined,
        faceSwapError: faceSwapError,
      });
    }
    }

    if (useRunway) {
      // Runway is async-first: create task and return task id immediately (never wait for completion).
      cleanImageUrl = referenceImageUrl || (await buildReferenceImage());
      if (!cleanImageUrl || typeof cleanImageUrl !== 'string' || !cleanImageUrl.trim()) {
        throw new Error('Referans görsel gerekli: Runway için önce bir başlangıç karesi üretilmeli.');
      }

      // Ensure Runway can fetch the prompt image (must be public https/data/runway://). Convert local/Replicate-auth URLs.
      const promptImage = await ensurePublicAssetUrl(
        { url: cleanImageUrl },
        {
          token: process.env.REPLICATE_API_TOKEN || '',
          resolveAbsoluteUrl: ensureAbsoluteUrl,
          bypassReplicateFileApi: false,
          logger: { info: (...a: unknown[]) => console.log(...a), warn: (...a: unknown[]) => console.warn(...a) },
        }
      );

      const runwayPrompt = String(videoPrompt || imagePrompt || safeUserIdea || '').trim();
      if (!runwayPrompt) {
        throw new Error('Runway prompt is required.');
      }

      const durationSec = normalizeDurationForEngine(engine, body) ?? 5;
      const task = await createRunwayImageToVideoTask({
        model: runwayModel,
        promptImage,
        promptText: runwayPrompt,
        ratio: '1280:720',
        duration: durationSec,
      });

      return NextResponse.json({
        success: true,
        type: 'video',
        videoId: `runway:${task.id}`,
        task_id: task.id,
        imageUrl: cleanImageUrl,
        imagePrompt,
        videoPrompt,
        usedGeminiImagePrompt,
        usedGeminiVideoPrompt,
        audioMerged: false,
        engine: `runway:${runwayModel}`,
      });
    }

    if (useKlingVideo && klingVideoModelKey) {
      // Kling Video (I2V): always anchor-frame -> Kling video model with Replicate->Fal fallback.
      cleanImageUrl = referenceImageUrl || (await buildReferenceImage());
      if (!cleanImageUrl || typeof cleanImageUrl !== 'string' || !cleanImageUrl.trim()) {
        throw new Error('Referans görsel gerekli: Kling Video için önce bir başlangıç karesi üretilmeli.');
      }
      const klingPrompt = videoPrompt || imagePrompt || safeUserIdea;
      console.log(`🎬 ENGINE=Kling Video (${String(klingVideoModelKey)}) with fallback (Replicate -> Fal.ai)`);

      const startImageUrl = await ensureExternallyFetchableImageUrl(cleanImageUrl);
      const requestedProvider = String(body?.videoProvider || body?.provider || '').trim().toLowerCase();
      const forceProvider =
        requestedProvider === 'fal'
          ? 'fal'
          : requestedProvider === 'replicate'
            ? 'replicate'
            : undefined;
      const durationSec = normalizeDurationForEngine(engine, body) ?? 5;
      const out = await generateVideoWithFallback(
        klingPrompt,
        klingVideoModelKey,
        startImageUrl,
        {
          ...(forceProvider ? { forceProvider: forceProvider as any } : {}),
          durationSeconds: durationSec,
          aspectRatio: '16:9',
        }
      );
      if (out.provider === 'replicate' && out.status === 'processing') {
        // Let existing frontend polling use /api/generate-video/status?id=...
        return NextResponse.json({
          success: true,
          type: 'video',
          videoId: out.id,
          imageUrl: cleanImageUrl,
          imagePrompt,
          videoPrompt,
          usedGeminiImagePrompt,
          usedGeminiVideoPrompt,
          audioMerged: false,
          engine: `replicate:${out.providerModel}`,
        });
      }
      if (out.provider === 'fal' && out.status === 'processing') {
        // Poll via /api/generate-video/status?id=fal:<model>:<requestId>
        return NextResponse.json({
          success: true,
          type: 'video',
          videoId: out.id,
          imageUrl: cleanImageUrl,
          imagePrompt,
          videoPrompt,
          usedGeminiImagePrompt,
          usedGeminiVideoPrompt,
          audioMerged: false,
          engine: `fal:${out.providerModel}`,
        });
      }
      if (!out.videoUrl) {
        throw new Error('Kling video generation failed (no videoUrl).');
      }
      return NextResponse.json({
        success: true,
        type: 'video',
        url: out.videoUrl,
        videoUrl: out.videoUrl,
        thumbnailUrl: cleanImageUrl || undefined,
        imageUrl: cleanImageUrl,
        imagePrompt,
        videoPrompt,
        usedGeminiImagePrompt,
        usedGeminiVideoPrompt,
        audioMerged: false,
        engine: `${out.provider}:${out.providerModel}`,
      });
    }

    if (useKlingAvatar) {
      if (voiceEmotion) {
        console.log('🎭 VOICE EMOTION:', voiceEmotion);
      }
      if (!audioScript && dialogue.trim()) {
        audioScript = dialogue.trim();
      }
      if (!audioScript) {
        throw new Error('Kling Avatar (Lip-Sync) requires dialogue/speech text. Add script or select another engine.');
      }
      cleanImageUrl = referenceImageUrl || (await buildReferenceImage());
      if (!cleanImageUrl || typeof cleanImageUrl !== 'string' || !cleanImageUrl.trim()) {
        throw new Error('Referans görsel gerekli: Persona/Flux görseli video motoruna (Kling) verilmeden önce üretilmeli.');
      }
      const visionPlan = await analyzeImageWithGemini(cleanImageUrl, {
        voice_category: resolvedVoiceCategory,
        speech_text: audioScript,
        sfx_prompt: sfxPromptText,
        audio_environment: audioEnvironment,
        is_action_scene: isActionScene,
        voice_settings: voiceEmotionSettings,
      });
      const refinedVoiceCategory = visionPlan?.voice_category || resolvedVoiceCategory;
      const refinedSpeechText = visionPlan?.speech_text || audioScript;
      const refinedSfxPrompt = visionPlan?.sfx_prompt || sfxPromptText;
      const refinedAudioEnvironment = visionPlan?.audio_environment || audioEnvironment;
      const refinedVoiceSettings = visionPlan?.voice_settings || voiceEmotionSettings;
      const refinedActionScene = typeof visionPlan?.is_action_scene === 'boolean'
        ? visionPlan.is_action_scene
        : isActionScene;

      const fallbackVoiceId = VOICE_CAST.male_heroic || '21m00Tcm4TlvDq8ikWAM';
      const voiceTask = refinedSpeechText
        ? generateSpeech(refinedSpeechText, VOICE_CAST[refinedVoiceCategory] || voiceId || fallbackVoiceId, refinedVoiceSettings)
        : Promise.resolve('');
      const sfxPromptWithAction = refinedActionScene
        ? `${refinedSfxPrompt}, impact, hit, crash, explosion`
        : refinedSfxPrompt;
      const sfxPromptForAudio = sfxPromptWithAction
        ? `${sfxPromptWithAction}. ${audioPrompt}`
        : audioPrompt;
      const sfxTask = refinedSfxPrompt
        ? generateSfxAudioUrl(`${sfxPromptForAudio}${SFX_QUALITY_SUFFIX}`)
        : Promise.resolve('');

      const [voiceRes, sfxRes] = await Promise.allSettled([voiceTask, sfxTask]);
      if (voiceRes.status === 'rejected') {
        const reason = (voiceRes.reason as any)?.message || String(voiceRes.reason || 'Unknown error');
        throw new Error(`Speech generation failed: ${reason}`);
      }
      const voiceUrl = voiceRes.value;
      const sfxUrl = sfxRes.status === 'fulfilled' ? sfxRes.value : '';
      if (sfxRes.status === 'rejected') {
        console.warn('⚠️ SFX generation failed; continuing without SFX.', sfxRes.reason?.message || sfxRes.reason);
      }

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
      console.log('🎬 MODE: AUDIO-DRIVEN CINEMATIC (Kling Avatar v2)');
      const avatarModel = 'kwaivgi/kling-avatar-v2';
      const avatarOutput = await runReplicateWithRetry(avatarModel, {
        image: klingImageUrl,
        audio: klingAudioUrl,
        prompt: avatarPerformance || 'subtle head movement, micro facial expressions',
        cfg_scale: 0.6,
      });
      console.log('🎥 AVATAR OUTPUT:', avatarOutput);

      let avatarVideoUrl = extractVideoUrl(avatarOutput);
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
        sfxBedVolume: refinedActionScene ? 0.6 : 0.2,
        duckedSfxVolume: 0.2,
        audioEnvironment: refinedAudioEnvironment,
      });
      finalVideoUrl = mixed.videoUrl;
      audioMerged = true;

      logVideoCost('kling-avatar-v2', { mode: 'TALKING_MODE', intentMode: 'TALKING_MODE' });
      
      // Apply face swap if enabled (after finalVideoUrl is ready)
      let originalVideoUrl: string | undefined = undefined;
      let faceSwapError: string | undefined = undefined;
      if (enableFaceSwap && actorPhotos && Object.keys(actorPhotos).length > 0) {
        originalVideoUrl = finalVideoUrl;
        const faceSwapResult = await applyFaceSwapIfEnabled(finalVideoUrl, enableFaceSwap, actorPhotos, detectedCharacters);
        finalVideoUrl = faceSwapResult.videoUrl;
        faceSwapError = faceSwapResult.faceSwapError;
      }
      
      return NextResponse.json({
        success: true,
        type: 'video',
        url: finalVideoUrl,
        videoUrl: finalVideoUrl,
        thumbnailUrl: cleanImageUrl || undefined,
        imageUrl: cleanImageUrl,
        imagePrompt,
        videoPrompt,
        usedGeminiImagePrompt,
        usedGeminiVideoPrompt,
        audioMerged,
        engine: 'kling-avatar-v2',
        faceSwapped: enableFaceSwap && actorPhotos && Object.keys(actorPhotos).length > 0 ? true : false,
        originalVideoUrl: enableFaceSwap && actorPhotos && Object.keys(actorPhotos).length > 0 ? originalVideoUrl : undefined,
        faceSwapError: faceSwapError,
      });
    }
    throw new Error('No engine path matched. Ensure engine is one of: grok, kling, veo.');
  } catch (error: any) {
    console.error('❌ GENERATION ERROR:', error);
    const msg = String(error?.message || 'Unknown error');
    const isMissingXaiKey = msg.toLowerCase().includes('xai_api_key') && msg.toLowerCase().includes('missing');
    return NextResponse.json({ error: msg }, { status: isMissingXaiKey ? 400 : 500 });
  }
}
