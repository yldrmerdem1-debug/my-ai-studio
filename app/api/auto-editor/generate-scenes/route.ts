import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getFfmpeg } from '@/lib/ffmpeg-client';
import { isFaceSwapEnabled } from '@/lib/feature-flags';
import { persistGeneratedBuffer } from '@/lib/generated-assets';
import { downloadMediaWithValidation } from '@/lib/replicate-media';
import { getConfiguredSiteUrl, getSiteUrlFromRequest } from '@/lib/site-url';
import {
  VIDEO_ENGINES_CONFIG,
  type VideoEngineKey,
  type VideoQualityPreset,
} from '@/lib/constants';
import { createGeminiModel, getGeminiModelId } from '@/lib/gemini';
import { buildAutoEditorContinuityRule, buildSceneDirectorGuidance } from '@/lib/generation-strategy';
import type { EditorAsset, EditorSession, EditorShotPlan } from '@/lib/ad-director';

export const runtime = 'nodejs';
export const maxDuration = 300;

type SceneGenerationRequest = {
  dryRun?: boolean;
  engine?: VideoEngineKey;
  qualityPreset?: VideoQualityPreset;
  session?: EditorSession;
  userId?: string;
};

type ProductLockValidation = {
  confidence: number;
  passed: boolean;
  reason: string;
  differences: string[];
};

class ProductLockValidationError extends Error {
  code = 'PRODUCT_LOCK_FAILED' as const;
  confidence: number;
  differences: string[];
  scene: number;

  constructor(scene: number, validation: ProductLockValidation) {
    super(`Product lock failed on scene ${scene}: ${validation.reason}`);
    this.name = 'ProductLockValidationError';
    this.scene = scene;
    this.confidence = validation.confidence;
    this.differences = validation.differences;
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const safeTrim = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

const toAbsoluteUrl = (url: string, baseUrl: string) => {
  const trimmed = safeTrim(url);
  if (!trimmed) return '';
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('data:')) return trimmed;
  if (trimmed.startsWith('/')) return `${baseUrl.replace(/\/$/, '')}${trimmed}`;
  return trimmed;
};

const normalizeEngine = (value: unknown): VideoEngineKey => {
  const normalized = safeTrim(value).toLowerCase();
  if (
    normalized === 'grok'
    || normalized === 'seedance_2_0'
    || normalized === 'veo'
    || normalized === 'runway'
    || normalized === 'kling_3_pro'
    || normalized === 'kling_turbo'
    || normalized === 'kling_2_6'
    || normalized === 'kling_avatar_v2'
  ) {
    return normalized;
  }
  if (normalized === 'seedance' || normalized === 'seedance2' || normalized === 'seedance-2.0' || normalized === 'seedance_2') {
    return 'seedance_2_0';
  }
  return 'grok';
};

const normalizeQuality = (engine: VideoEngineKey, value: unknown): VideoQualityPreset => {
  const cfg = VIDEO_ENGINES_CONFIG[engine];
  const requested = safeTrim(value).toLowerCase() as VideoQualityPreset;
  return cfg.supportedQualities.includes(requested) ? requested : cfg.defaultQuality;
};

const normalizeDuration = (engine: VideoEngineKey, shotDuration: number) => {
  const cfg = VIDEO_ENGINES_CONFIG[engine];
  if (cfg.mode === 'auto' || cfg.supportedDurations.length === 0) return undefined;
  const requested = Math.max(1, Math.round(Number(shotDuration) || cfg.defaultDuration));
  return cfg.supportedDurations.reduce((best, candidate) => (
    Math.abs(candidate - requested) < Math.abs(best - requested) ? candidate : best
  ), cfg.supportedDurations[0]);
};

const getProductReferenceImageUrl = (session: EditorSession) =>
  safeTrim(session.metadata?.referenceImageUrl)
  || safeTrim(session.directorPlan?.recommendations?.referenceImageUrl)
  || safeTrim(session.directorPlan?.sourceContext?.resolvedProductImageUrl);

const parseDataUrl = (url: string) => {
  const match = url.match(/^data:([^;,]+)[^,]*,(.+)$/);
  if (!match) return null;
  return {
    mimeType: match[1] || 'image/png',
    data: match[2] || '',
  };
};

const getImageInlineData = async (url: string, baseUrl: string) => {
  const dataUrl = parseDataUrl(url);
  if (dataUrl) return dataUrl;

  const absolute = toAbsoluteUrl(url, baseUrl);
  const media = await downloadMediaWithValidation(absolute, {
    expectedKind: 'image',
    logger: {
      info: (...args) => console.log(...args),
      warn: (...args) => console.warn(...args),
    },
    strictExpectedKind: true,
    token: process.env.REPLICATE_API_TOKEN || '',
  });
  return {
    mimeType: media.contentType || 'image/png',
    data: media.buffer.toString('base64'),
  };
};

const extractJsonObject = (raw: string) => {
  const cleaned = raw.trim().replace(/^```[a-zA-Z]*\s*/, '').replace(/```$/, '').trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  return JSON.parse(match ? match[0] : cleaned);
};

const validateProductLock = async (params: {
  baseUrl: string;
  generatedFrameUrl: string;
  productReferenceImageUrl: string;
  productTitle?: string;
  scene: number;
}): Promise<ProductLockValidation> => {
  const apiKey = safeTrim(process.env.GEMINI_API_KEY);
  if (!apiKey) {
    throw new Error('Product lock validation requires GEMINI_API_KEY. Stopping to avoid unverified product drift.');
  }

  const modelId = await getGeminiModelId(
    apiKey,
    process.env.GEMINI_PRODUCT_LOCK_MODEL || 'gemini-2.5-pro'
  );
  const model = createGeminiModel(apiKey, modelId, {
    responseMimeType: 'application/json',
    temperature: 0,
  });
  const [referenceInline, generatedInline] = await Promise.all([
    getImageInlineData(params.productReferenceImageUrl, params.baseUrl),
    getImageInlineData(params.generatedFrameUrl, params.baseUrl),
  ]);
  const prompt = `
You are a strict product identity inspector for paid ad generation.
Compare IMAGE 1 (original product reference) against IMAGE 2 (generated scene last frame).

Pass ONLY if the same product identity is preserved:
- same silhouette/proportions/packaging shape
- same dominant colors and material finish
- same logo/text/label placement when visible
- same distinctive product details

Do not fail for acceptable changes in camera angle, lighting, tiny motion blur, scale, background, or perspective if the product identity is still clearly the same.
Fail if the product appears redesigned, replaced, mutated, has wrong colors/materials, wrong logo/text layout, loses distinctive product geometry, or if hands/objects/motion blur hide the logo/identifying surface enough that the product is no longer clearly identifiable.

Product title/context: ${params.productTitle || 'unknown product'}
Scene: ${params.scene}

Return ONLY JSON:
{
  "passed": true,
  "confidence": 0.0,
  "reason": "short user-facing explanation",
  "differences": ["specific visual differences if failed"]
}
`.trim();

  const result = await model.generateContent([
    { text: prompt },
    { text: 'IMAGE 1: original product reference' },
    { inlineData: referenceInline },
    { text: 'IMAGE 2: generated scene last frame' },
    { inlineData: generatedInline },
  ]);
  const text = (await result.response).text();
  const parsed = extractJsonObject(text) as Partial<ProductLockValidation>;
  return {
    passed: parsed.passed === true,
    confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0)),
    reason: safeTrim(parsed.reason) || 'Product identity validation failed.',
    differences: Array.isArray(parsed.differences)
      ? parsed.differences.map(item => safeTrim(item)).filter(Boolean).slice(0, 6)
      : [],
  };
};

const buildScenePrompt = (session: EditorSession, shot: EditorShotPlan, index: number) => {
  const shotPlan = session.shotPlan || [];
  const previousShot = index > 0 ? shotPlan[index - 1] : null;
  const nextShot = index < shotPlan.length - 1 ? shotPlan[index + 1] : null;
  const hasProductReference = Boolean(getProductReferenceImageUrl(session));
  const basePrompt =
    shot.promptHint
    || session.directorPlan?.scenario?.plan?.visual_prompt
    || session.hookPlan.text
    || 'cinematic product ad scene';
  const campaignArc = shotPlan
    .map((item, itemIndex) => `${itemIndex + 1}. ${item.title} (${item.purpose})`)
    .join(' -> ');
  const personaSubjectType =
    session.directorPlan?.inputs?.persona?.subjectType
    || session.directorPlan?.inputs?.persona?.subject_type
    || session.metadata?.subjectType
    || session.metadata?.subject_type
    || 'human';
  const directorGuidance = buildSceneDirectorGuidance(personaSubjectType, 'auto-editor-scene');
  const continuityUpgradeRule = buildAutoEditorContinuityRule(personaSubjectType);
  const style = [
    `Scene ${index + 1}: ${shot.title}.`,
    `Campaign sequence: ${campaignArc}.`,
    `Purpose: ${shot.purpose}.`,
    directorGuidance,
    previousShot
      ? `This scene must continue naturally from Scene ${index}: ${previousShot.title}. Use the provided reference image as the exact starting visual from the previous scene's final frame.`
      : 'This is the opening scene. Establish the visual language clearly for all following scenes.',
    nextShot
      ? `End this scene with a clean visual composition that can transition into Scene ${index + 2}: ${nextShot.title}.`
      : 'This is the final scene. Resolve the ad with a clear ending beat.',
    `Prompt: ${basePrompt}`,
    session.metadata?.productTitle ? `Product: ${session.metadata.productTitle}.` : '',
    hasProductReference
      ? 'STRICT PRODUCT LOCK: the product in the provided reference image is the source of truth. Preserve the exact product silhouette, proportions, color palette, material finish, logo/text placement, label geometry, packaging shape, and distinctive details. Do not redesign, simplify, stylize, mutate, replace, hallucinate, or invent a different product. If product clarity is at risk, use a simpler camera move and clearer framing rather than changing the product.'
      : '',
    session.metadata?.identityLock
      ? 'Identity lock: preserve the exact same face or product design across scenes. Keep facial proportions, product shape, colors, logo placement, materials, and key details consistent.'
      : '',
    'Continuity rule: keep the same product/persona, environment logic, lighting direction, color palette, wardrobe/material details, and camera geography unless the prompt explicitly says to change them.',
    continuityUpgradeRule,
    previousShot
      ? 'Do not reset back to a packshot or original product photo. Continue from the previous frame and evolve the action while keeping the exact same product identity.'
      : '',
    'Make this a distinct short shot in the same ad story. Avoid repeating the exact previous composition while preserving continuity.',
  ].filter(Boolean);
  return style.join(' ');
};

const resolvePersonaPayload = (session: EditorSession) => {
  const directorPersona = session.directorPlan?.inputs?.persona || null;
  const personaId = safeTrim(session.metadata?.personaId) || safeTrim(directorPersona?.id);
  const personaImageUrl = safeTrim(session.metadata?.personaImageUrl) || safeTrim(directorPersona?.imageUrl);
  const personaModelId =
    safeTrim(session.metadata?.personaModelId)
    || safeTrim(directorPersona?.modelId)
    || safeTrim(directorPersona?.trainingId)
    || safeTrim(directorPersona?.destinationModel);
  const triggerWord = safeTrim(session.metadata?.triggerWord) || safeTrim(directorPersona?.triggerWord);
  const persona = directorPersona || null;

  return {
    hasPersona: Boolean(personaId || personaModelId || triggerWord || personaImageUrl),
    persona,
    personaId,
    personaImageUrl,
    personaModelId,
    strictFaceLock: Boolean(session.metadata?.strictFaceLock),
    triggerWord,
  };
};

const pollVideoStatus = async (origin: string, videoId: string, timeoutMs = 8 * 60 * 1000) => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const response = await fetch(`${origin}/api/generate-video/status?id=${encodeURIComponent(videoId)}`, {
      cache: 'no-store',
    });
    const data = await response.json().catch(() => ({}));
    if (response.ok && data?.status === 'succeeded' && typeof data.videoUrl === 'string' && data.videoUrl.trim()) {
      return data.videoUrl.trim() as string;
    }
    if (data?.status === 'failed' || data?.status === 'error' || data?.status === 'canceled') {
      throw new Error(data?.error || data?.statusMessage || 'Scene video generation failed');
    }
    await sleep(5000);
  }
  throw new Error('Scene video generation timed out');
};

const generateSceneVideo = async (params: {
  duration?: number;
  engine: VideoEngineKey;
  origin: string;
  personaPayload: ReturnType<typeof resolvePersonaPayload>;
  prompt: string;
  qualityPreset: VideoQualityPreset;
  strictProductLock?: boolean;
  referenceImageUrl?: string;
  userId: string;
}) => {
  const personaActive = params.personaPayload.hasPersona;
  const strictFaceLock = Boolean(params.personaPayload.strictFaceLock && params.personaPayload.personaImageUrl);
  const resolvedPrompt = personaActive && params.personaPayload.triggerWord
    ? `${params.personaPayload.triggerWord} ${params.prompt}`.trim()
    : params.prompt;
  const response = await fetch(`${params.origin}/api/generate-video`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      async: false,
      duration: params.duration,
      engine: params.engine,
      generationStrategy: personaActive
        ? (params.qualityPreset === '1080p' || params.qualityPreset === '1584x672' ? 'cinematic' : 'premium')
        : 'standard',
      actorPhotos: strictFaceLock ? { main_persona: params.personaPayload.personaImageUrl } : undefined,
      detectedCharacters: strictFaceLock ? ['main_persona'] : undefined,
      enableFaceSwap: strictFaceLock,
      faceSwapConsent: strictFaceLock ? true : undefined,
      isTextOnly: true,
      id: params.personaPayload.personaId || undefined,
      modelId: params.personaPayload.personaModelId || undefined,
      model_id: params.personaPayload.personaModelId || undefined,
      persona: params.personaPayload.persona || undefined,
      personaId: params.personaPayload.personaId || undefined,
      personaImageUrl: params.personaPayload.personaImageUrl || undefined,
      personaMode: personaActive ? 'persona' : 'generic',
      personaModelId: params.personaPayload.personaModelId || undefined,
      personaTriggerWord: params.personaPayload.triggerWord || undefined,
      personaUrl: params.personaPayload.personaImageUrl || undefined,
      prompt: resolvedPrompt,
      qualityPreset: params.qualityPreset,
      referenceImageUrl: params.referenceImageUrl || undefined,
      reference_image_url: params.referenceImageUrl || undefined,
      sourceImage: params.referenceImageUrl || undefined,
      strictProductLock: params.strictProductLock || undefined,
      strictReferenceImage: params.strictProductLock || undefined,
      triggerWord: params.personaPayload.triggerWord || undefined,
      trigger_word: params.personaPayload.triggerWord || undefined,
      userId: params.userId,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || data.details || 'Failed to generate scene video');
  }
  if (typeof data.videoUrl === 'string' && data.videoUrl.trim()) {
    return data.videoUrl.trim() as string;
  }
  if (typeof data.videoId === 'string' && data.videoId.trim()) {
    return pollVideoStatus(params.origin, data.videoId.trim());
  }
  throw new Error('Scene generation returned no video URL or video ID');
};

const extractLastFrameToPng = async (videoUrl: string, baseUrl: string) => {
  const absolute = toAbsoluteUrl(videoUrl, baseUrl);
  const media = await downloadMediaWithValidation(absolute, {
    expectedKind: 'video',
    logger: {
      info: (...args) => console.log(...args),
      warn: (...args) => console.warn(...args),
    },
    strictExpectedKind: true,
    token: process.env.REPLICATE_API_TOKEN || '',
  });
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'auto-editor-last-frame-'));
  const inputPath = path.join(tempDir, `input-${crypto.randomUUID()}.mp4`);
  const outputPath = path.join(tempDir, `frame-${crypto.randomUUID()}.png`);
  try {
    await writeFile(inputPath, media.buffer);
    const ffmpeg = await getFfmpeg();
    await new Promise<void>((resolve, reject) => {
      ffmpeg(inputPath)
        .outputOptions(['-y', '-sseof', '-0.1', '-frames:v', '1'])
        .on('end', () => resolve())
        .on('error', (error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          reject(new Error(`Last-frame extraction failed: ${message}`));
        })
        .save(outputPath);
    });
    const frame = await readFile(outputPath);
    return persistGeneratedBuffer(frame, {
      prefix: 'generated/images',
      suggestedName: `scene-last-frame-${crypto.randomUUID()}.png`,
      contentType: 'image/png',
    });
  } finally {
    await rm(tempDir, { force: true, recursive: true }).catch(() => undefined);
  }
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as SceneGenerationRequest;
    const session = body.session;
    const userId = safeTrim(body.userId);
    if (!session?.shotPlan?.length) {
      return NextResponse.json({ error: 'session.shotPlan is required' }, { status: 400 });
    }
    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 401 });
    }

    const origin = getSiteUrlFromRequest(request);
    const baseUrl = getConfiguredSiteUrl();
    const engine = normalizeEngine(body.engine || session.metadata?.engine || 'grok');
    const qualityPreset = normalizeQuality(engine, body.qualityPreset || session.metadata?.quality);
    const dryRun = body.dryRun === true;
    const generatedAssets: EditorAsset[] = [];
    const personaPayload = resolvePersonaPayload(session);
    if (!dryRun && personaPayload.strictFaceLock) {
      if (!personaPayload.personaImageUrl) {
        return NextResponse.json(
          { error: 'Strict face lock requires a selected persona with an image.' },
          { status: 400 }
        );
      }
      if (!isFaceSwapEnabled()) {
        return NextResponse.json(
          { error: 'Strict face lock is disabled. Enable face swap to use this mode.' },
          { status: 400 }
        );
      }
    }
    const productReferenceImageUrl = getProductReferenceImageUrl(session);
    const strictProductLock = Boolean(productReferenceImageUrl);
    if (!dryRun && strictProductLock && !safeTrim(process.env.GEMINI_API_KEY)) {
      return NextResponse.json(
        {
          code: 'PRODUCT_LOCK_VALIDATION_UNAVAILABLE',
          error: 'Product lock validation requires GEMINI_API_KEY. Stopping before generation to avoid unverified product drift.',
        },
        { status: 500 }
      );
    }
    let referenceImageUrl =
      productReferenceImageUrl
      || (session.metadata?.identityLock && personaPayload.personaImageUrl ? personaPayload.personaImageUrl : '');
    const updatedShotPlan: EditorShotPlan[] = [];
    const sceneReferenceTrace: Array<{
      inputReferenceImageUrl?: string;
      lastFrameReferenceUrl?: string;
      productLockConfidence?: number;
      productLockPassed?: boolean;
      productLockReason?: string;
      scene: number;
      shotId: string;
    }> = [];

    for (let index = 0; index < session.shotPlan.length; index += 1) {
      const shot = session.shotPlan[index];
      const prompt = buildScenePrompt(session, shot, index);
      const duration = normalizeDuration(engine, shot.durationSec);
      const inputReferenceImageUrl = referenceImageUrl ? toAbsoluteUrl(referenceImageUrl, baseUrl) : undefined;
      const videoUrl = dryRun
        ? `/generated/videos/dry-run-scene-${index + 1}.mp4`
        : await generateSceneVideo({
            duration,
            engine,
            origin,
            personaPayload,
            prompt,
            qualityPreset,
            referenceImageUrl: inputReferenceImageUrl,
            strictProductLock,
            userId,
          });

      const asset: EditorAsset = {
        id: `generated-scene-${index + 1}-${crypto.randomUUID()}`,
        isPrimary: index === 0,
        kind: 'video',
        label: `${index + 1}. ${shot.title}`,
        role: index === 0 ? 'hero' : 'broll',
        source: 'generated',
        url: videoUrl,
      };
      generatedAssets.push(asset);
      updatedShotPlan.push({
        ...shot,
        assetId: asset.id,
        assetRoleHint: asset.role,
      });

      try {
        const lastFrameReferenceUrl = dryRun
          ? `/generated/images/dry-run-scene-${index + 1}-last-frame.png`
          : await extractLastFrameToPng(videoUrl, baseUrl);
        sceneReferenceTrace.push({
          inputReferenceImageUrl,
          lastFrameReferenceUrl,
          scene: index + 1,
          shotId: shot.id,
        });
        if (!dryRun && strictProductLock) {
          const validation = await validateProductLock({
            baseUrl,
            generatedFrameUrl: lastFrameReferenceUrl,
            productReferenceImageUrl,
            productTitle: session.metadata?.productTitle || session.directorPlan?.sourceContext?.productTitle,
            scene: index + 1,
          });
          sceneReferenceTrace[sceneReferenceTrace.length - 1] = {
            ...sceneReferenceTrace[sceneReferenceTrace.length - 1],
            productLockConfidence: validation.confidence,
            productLockPassed: validation.passed,
            productLockReason: validation.reason,
          };
          if (!validation.passed || validation.confidence < 0.85) {
            throw new ProductLockValidationError(index + 1, validation);
          }
        }
        referenceImageUrl = lastFrameReferenceUrl;
      } catch (error) {
        if (error instanceof ProductLockValidationError) {
          throw error;
        }
        console.warn('[auto-editor/generate-scenes] Last frame extraction failed, stopping chained scene generation:', error);
        throw new Error(
          `Could not extract the last frame for scene ${index + 1}; stopped to avoid reusing the original reference image for the next scene.`
        );
      }
    }

    const preservedAssets = (session.assets || []).filter((asset) => asset.source !== 'generated');
    const nextSession: EditorSession = {
      ...session,
      assets: [
        ...preservedAssets,
        ...generatedAssets,
      ],
      metadata: {
        ...(session.metadata || {}),
        engine,
        quality: qualityPreset,
        referenceImageUrl,
        strictProductLock,
      },
      shotPlan: updatedShotPlan,
      updatedAt: new Date().toISOString(),
    };

    return NextResponse.json({
      assets: generatedAssets,
      lastFrameReferenceUrl: referenceImageUrl || undefined,
      sceneReferenceTrace,
      session: nextSession,
    });
  } catch (error: unknown) {
    console.error('[auto-editor/generate-scenes] error:', error);
    if (error instanceof ProductLockValidationError) {
      return NextResponse.json(
        {
          code: error.code,
          differences: error.differences,
          error: error.message,
          productLockConfidence: error.confidence,
          scene: error.scene,
        },
        { status: 422 }
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to generate scenes' },
      { status: 500 }
    );
  }
}
