import { NextResponse } from 'next/server';
import type {
  AutoEditorComposerRequest,
  AutoEditorLegacyRequest,
  AutoEditorComposerResponse,
  EditorAsset,
  EditorCaptionMode,
  EditorCampaignDuration,
  EditorOutputAspectRatio,
  EditorShotPlan,
  EditorSession,
} from '@/lib/ad-director';
import { createDefaultShotPlan, createOutputVariants } from '@/lib/ad-director';
import { cleanupResolvedEditorAssets, resolveEditorAssets } from '@/lib/auto-editor/assets';
import { renderEditorTimeline } from '@/lib/auto-editor/render';
import { planEditorTimeline } from '@/lib/auto-editor/timeline';

export const runtime = 'nodejs';
export const maxDuration = 300;

const safeTrim = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

const createId = (prefix: string) =>
  `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`}`;

const isClientAssetError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error || '');
  return /asset|upload|private|local network|too large|public directory|invalid/i.test(message);
};

const normalizeOutputFormats = (formats: unknown): EditorOutputAspectRatio[] => {
  if (!Array.isArray(formats) || formats.length === 0) return ['9:16'];
  return Array.from(
    new Set(
      formats
        .map((item) => safeTrim(item))
        .filter((item): item is EditorOutputAspectRatio => item === '9:16' || item === '16:9')
    )
  );
};

const normalizeCampaignDuration = (value: unknown): EditorCampaignDuration => {
  const numeric = Number(value);
  if (numeric === 15 || numeric === 30 || numeric === 60) return numeric;
  return 30;
};

const sanitizeAssets = (assets: unknown): EditorAsset[] => {
  if (!Array.isArray(assets)) return [];
  return assets
    .map((asset, index): EditorAsset | null => {
      if (!asset || typeof asset !== 'object') return null;
      const record = asset as Record<string, unknown>;
      const url = safeTrim(record.url);
      const kind = safeTrim(record.kind) === 'video' ? 'video' : 'image';
      const role = safeTrim(record.role) || (kind === 'video' ? 'hero' : 'product');
      if (!url) return null;
      return {
        durationSec: typeof record.durationSec === 'number' ? record.durationSec : undefined,
        id: safeTrim(record.id) || createId(`asset-${index}`),
        isPrimary: Boolean(record.isPrimary),
        kind,
        label: safeTrim(record.label) || `Asset ${index + 1}`,
        role: (
          ['hero', 'broll', 'product', 'cover', 'logo', 'reference'].includes(role)
            ? role
            : (kind === 'video' ? 'hero' : 'product')
        ) as EditorAsset['role'],
        source: (
          ['video', 'director', 'manual', 'brand', 'generated'].includes(safeTrim(record.source))
            ? safeTrim(record.source)
            : 'manual'
        ) as EditorAsset['source'],
        url,
      };
    })
    .filter((asset): asset is EditorAsset => Boolean(asset));
};

const sanitizeShotPlan = (shots: unknown, targetDurationSec: EditorCampaignDuration): EditorShotPlan[] => {
  if (!Array.isArray(shots) || shots.length === 0) {
    return createDefaultShotPlan({ durationSec: targetDurationSec });
  }

  return shots
    .map((shot, index): EditorShotPlan | null => {
      if (!shot || typeof shot !== 'object') return null;
      const record = shot as Record<string, unknown>;
      const purpose = safeTrim(record.purpose);
      const assetRoleHint = safeTrim(record.assetRoleHint);
      return {
        assetId: safeTrim(record.assetId) || undefined,
        assetRoleHint: (
          ['hero', 'broll', 'product', 'cover', 'logo', 'reference'].includes(assetRoleHint)
            ? assetRoleHint
            : 'hero'
        ) as EditorShotPlan['assetRoleHint'],
        durationSec: Math.max(1.5, Number(record.durationSec || 3)),
        id: safeTrim(record.id) || createId(`shot-${index}`),
        promptHint: safeTrim(record.promptHint) || 'Show the product clearly.',
        purpose: (
          ['hook', 'intro-card', 'product', 'demo', 'proof', 'cta'].includes(purpose)
            ? purpose
            : 'demo'
        ) as EditorShotPlan['purpose'],
        title: safeTrim(record.title) || `Scene ${index + 1}`,
      };
    })
    .filter((shot): shot is EditorShotPlan => Boolean(shot));
};

const mapLegacyRequestToSession = (body: AutoEditorLegacyRequest): EditorSession => {
  const now = new Date().toISOString();
  const outputVariants = createOutputVariants(normalizeOutputFormats(body.outputFormats));
  const targetDurationSec = 15;
  const assets: EditorAsset[] = [
    {
      id: createId('asset-hero-video'),
      isPrimary: true,
      kind: 'video',
      label: 'Raw Video Input',
      role: 'hero',
      source: 'video',
      url: safeTrim(body.videoUrl),
    },
  ];

  if (safeTrim(body.logoDataUrl)) {
    assets.push({
      id: createId('asset-logo'),
      kind: 'image',
      label: 'Brand Logo',
      role: 'logo',
      source: 'brand',
      url: safeTrim(body.logoDataUrl),
    });
  }

  const captionText = safeTrim(body.captionsText);
  const ctaText = safeTrim(body.ctaText);
  return {
    assets,
    captionMode: body.addCaptions && captionText ? 'full-script' : 'none',
    captionText,
    createdAt: now,
    ctaPlan: {
      durationSec: 2.5,
      enabled: Boolean(ctaText),
      position: 'ending-card',
      text: ctaText || 'Shop Now',
    },
    hookPlan: {
      emphasis: 'high',
      preferredDurationSec: 2.5,
      source: 'derived',
      text: captionText.split(/\s+/).slice(0, 8).join(' ') || 'Lead with the strongest moment.',
    },
    id: createId('editor-session'),
    notes: [],
    outputVariants,
    shotPlan: createDefaultShotPlan({
      ctaText: ctaText || 'Shop Now',
      durationSec: targetDurationSec,
      hookText: captionText.split(/\s+/).slice(0, 8).join(' ') || 'Lead with the strongest moment.',
      visualPrompt: captionText,
    }),
    targetDurationSec,
    timelineStrategy: 'hook-first',
    title: 'Legacy Auto-Editor Project',
    updatedAt: now,
  };
};

const sanitizeSession = (rawSession: EditorSession): EditorSession => {
  const now = new Date().toISOString();
  const assets = sanitizeAssets(rawSession.assets);
  const targetDurationSec = normalizeCampaignDuration(rawSession.targetDurationSec);
  const outputVariants = Array.isArray(rawSession.outputVariants) && rawSession.outputVariants.length > 0
    ? rawSession.outputVariants
    : createOutputVariants(['9:16', '16:9']);
  const captionMode: EditorCaptionMode = rawSession.captionMode === 'none'
    ? 'none'
    : rawSession.captionMode === 'full-script'
      ? 'full-script'
      : 'segment-cues';

  return {
    ...rawSession,
    assets,
    captionMode,
    captionText: safeTrim(rawSession.captionText),
    createdAt: rawSession.createdAt || now,
    ctaPlan: {
      durationSec: Math.max(1.8, Number(rawSession.ctaPlan?.durationSec || 2.5)),
      enabled: rawSession.ctaPlan?.enabled ?? true,
      position: rawSession.ctaPlan?.position === 'lower-third' ? 'lower-third' : 'ending-card',
      text: safeTrim(rawSession.ctaPlan?.text) || 'Shop Now',
    },
    hookPlan: {
      emphasis: rawSession.hookPlan?.emphasis || 'high',
      preferredDurationSec: Math.max(1.8, Number(rawSession.hookPlan?.preferredDurationSec || 2.5)),
      source: rawSession.hookPlan?.source || 'derived',
      text: safeTrim(rawSession.hookPlan?.text) || 'Lead with the strongest product moment.',
    },
    id: safeTrim(rawSession.id) || createId('editor-session'),
    outputVariants,
    shotPlan: sanitizeShotPlan(rawSession.shotPlan, targetDurationSec),
    targetDurationSec,
    timelineStrategy: rawSession.timelineStrategy || 'hook-first',
    title: safeTrim(rawSession.title) || 'Auto-Editor Project',
    updatedAt: now,
  };
};

const resolveEditorSession = (body: AutoEditorComposerRequest | AutoEditorLegacyRequest) => {
  if ('session' in body && body.session) {
    return sanitizeSession(body.session);
  }
  return mapLegacyRequestToSession(body as AutoEditorLegacyRequest);
};

export async function POST(request: Request) {
  let resolvedAssets: Awaited<ReturnType<typeof resolveEditorAssets>> = [];
  try {
    const body = (await request.json()) as AutoEditorComposerRequest | AutoEditorLegacyRequest;
    const session = resolveEditorSession(body);
    const nonLogoAssets = session.assets.filter((asset) => asset.role !== 'logo');
    if (nonLogoAssets.length === 0) {
      return NextResponse.json({ error: 'At least one non-logo asset is required' }, { status: 400 });
    }

    resolvedAssets = await resolveEditorAssets(session.assets);
    const enrichedSession = sanitizeSession({
      ...session,
      assets: session.assets.map((asset) => {
        const resolved = resolvedAssets.find((item) => item.id === asset.id);
        return resolved
          ? {
              ...asset,
              durationSec: resolved.durationSec,
              height: resolved.height,
              width: resolved.width,
            }
          : asset;
      }),
    });
    const timeline = planEditorTimeline(enrichedSession);
    const outputs = await renderEditorTimeline({
      assets: resolvedAssets,
      outputVariants: enrichedSession.outputVariants,
      session: enrichedSession,
      timeline,
    });

    return NextResponse.json({
      outputs,
      session: enrichedSession,
      timeline,
    } satisfies AutoEditorComposerResponse);
  } catch (error: unknown) {
    console.error('Auto-editor error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to package video' },
      { status: isClientAssetError(error) ? 400 : 500 }
    );
  } finally {
    await cleanupResolvedEditorAssets(resolvedAssets);
  }
}
