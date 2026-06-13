import type { VideoEngineKey, VideoQualityPreset } from '@/lib/constants';

export const AUTO_EDITOR_SESSION_KEY = 'autoEditorSession';

export type DirectorPlan = {
  visual_prompt: string;
  audio_script: string;
  voice_emotion: string;
  sfx_prompt: string;
  camera_movement: string;
};

export type DirectorScenario = {
  title: string;
  hook: string;
  angle: string;
  plan: DirectorPlan;
};

export type DirectorPersonaContext = {
  destinationModel?: string;
  id?: string;
  imageUrl?: string;
  modelFamily?: string;
  modelId?: string;
  name?: string;
  referenceImageUrls?: string[];
  trainingId?: string;
  trainingBaseModel?: string;
  triggerWord?: string;
};

export type DirectorAnalysis = {
  audienceInsights: string[];
  keyFeatures: string[];
  offerHighlights: string[];
  platformFit: string[];
  summary: string;
  visualObservations: string[];
};

export type DirectorRecommendations = {
  engineReason: string;
  needsPersona: boolean;
  needsReferenceImage: boolean;
  productionNotes: string[];
  recommendedAspectRatio: '9:16' | '16:9' | '1:1';
  recommendedDuration: number;
  recommendedEngine: VideoEngineKey;
  recommendedQuality: VideoQualityPreset;
  referenceImageUrl?: string;
  riskNotes: string[];
};

export type DirectorPersonaAnalysis = {
  cautions: string[];
  fitSummary: string;
  selectedPersonaName?: string;
  usageRecommendation: string;
};

export type DirectorSourceContext = {
  extractedSignals: string[];
  fetchedPage: boolean;
  hostname?: string;
  productBrand?: string;
  productCategory?: string;
  productDescription?: string;
  productPrice?: string;
  productTitle?: string;
  resolvedProductImageUrl?: string;
  usedDirectImageUrl?: boolean;
};

export type DirectorInputPayload = {
  audience?: string;
  duration?: string;
  objective?: string;
  persona?: DirectorPersonaContext | null;
  platform?: string;
  productBrief?: string;
  productImageUrl?: string;
  productUrl?: string;
  tone?: string;
};

export type DirectorResponse = {
  analysis: DirectorAnalysis;
  personaAnalysis?: DirectorPersonaAnalysis | null;
  recommendation: string;
  recommendations: DirectorRecommendations;
  scenarios: DirectorScenario[];
  sourceContext: DirectorSourceContext;
};

export type DirectorStoredPayload = DirectorResponse & {
  createdAt?: string;
  inputs?: DirectorInputPayload;
  scenario: DirectorScenario;
};

export type EditorAssetKind = 'video' | 'image';
export type EditorAssetRole = 'hero' | 'broll' | 'product' | 'cover' | 'logo' | 'reference';
export type EditorAssetSource = 'video' | 'director' | 'manual' | 'brand' | 'generated';
export type EditorTimelineStrategy = 'hook-first' | 'demo-first' | 'testimonial-first';
export type EditorCaptionMode = 'none' | 'segment-cues' | 'full-script';
export type EditorSegmentPurpose = 'hook' | 'intro-card' | 'product' | 'demo' | 'proof' | 'cta';
export type EditorMotionMode = 'static' | 'cover' | 'slow-zoom';
export type EditorOutputAspectRatio = '9:16' | '16:9';
export type EditorCaptionCueStyle = 'hook' | 'body' | 'cta';
export type EditorCampaignDuration = 15 | 30 | 60;

export type EditorAsset = {
  id: string;
  kind: EditorAssetKind;
  label: string;
  role: EditorAssetRole;
  source: EditorAssetSource;
  url: string;
  durationSec?: number;
  height?: number;
  isPrimary?: boolean;
  width?: number;
};

export type HookPlan = {
  emphasis: 'low' | 'medium' | 'high';
  preferredDurationSec: number;
  source: 'derived' | 'director' | 'manual';
  text: string;
};

export type CaptionCue = {
  assetId?: string;
  endSec: number;
  id: string;
  startSec: number;
  style: EditorCaptionCueStyle;
  text: string;
};

export type TimelineSegment = {
  assetId: string;
  endSec?: number;
  id: string;
  motion: EditorMotionMode;
  overlayText?: string;
  purpose: EditorSegmentPurpose;
  sequence: number;
  startSec?: number;
  targetDurationSec: number;
};

export type EditorShotPlan = {
  assetId?: string;
  assetRoleHint: EditorAssetRole;
  durationSec: number;
  id: string;
  promptHint: string;
  purpose: EditorSegmentPurpose;
  title: string;
};

export type TimelineSpec = {
  captions: CaptionCue[];
  segments: TimelineSegment[];
  totalDurationSec: number;
};

export type OutputVariant = {
  aspectRatio: EditorOutputAspectRatio;
  height: number;
  id: string;
  label: string;
  width: number;
};

export type CTAPlan = {
  durationSec: number;
  enabled: boolean;
  position: 'ending-card' | 'lower-third';
  text: string;
};

export type EditorSession = {
  assets: EditorAsset[];
  captionMode: EditorCaptionMode;
  captionText: string;
  createdAt: string;
  ctaPlan: CTAPlan;
  directorPlan?: DirectorStoredPayload | null;
  hookPlan: HookPlan;
  id: string;
  metadata?: {
    audience?: string;
    engine?: VideoEngineKey;
    identityLock?: boolean;
    objective?: string;
    personaId?: string;
    personaImageUrl?: string;
    personaModelId?: string;
    personaName?: string;
    platform?: string;
    productTitle?: string;
    productUrl?: string;
    quality?: VideoQualityPreset;
    rawVideoUrl?: string;
    referenceImageUrl?: string;
    strictFaceLock?: boolean;
    strictProductLock?: boolean;
    tone?: string;
    triggerWord?: string;
  };
  notes?: string[];
  outputVariants: OutputVariant[];
  selectedScenarioTitle?: string;
  shotPlan?: EditorShotPlan[];
  targetDurationSec?: EditorCampaignDuration;
  timelineStrategy: EditorTimelineStrategy;
  title: string;
  updatedAt: string;
};

export type AutoEditorComposerRequest = {
  session?: EditorSession;
};

export type AutoEditorComposerResponse = {
  outputs: Record<string, string>;
  session: EditorSession;
  timeline: TimelineSpec;
};

export type AutoEditorLegacyRequest = {
  addCaptions?: boolean;
  captionsText?: string;
  ctaText?: string;
  logoDataUrl?: string;
  outputFormats?: string[];
  videoUrl: string;
};

const createId = (prefix: string) =>
  `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`}`;

export const createOutputVariants = (
  aspectRatios: EditorOutputAspectRatio[] = ['9:16', '16:9']
): OutputVariant[] => {
  const uniqueRatios = Array.from(new Set(aspectRatios));
  return uniqueRatios.map((aspectRatio) => ({
    aspectRatio,
    height: aspectRatio === '16:9' ? 1080 : 1920,
    id: createId(`variant-${aspectRatio.replace(':', 'x')}`),
    label: aspectRatio === '16:9' ? '16:9 (YouTube)' : '9:16 (TikTok / Reels)',
    width: aspectRatio === '16:9' ? 1920 : 1080,
  }));
};

const createDefaultCtaText = (objective?: string) => {
  const normalized = String(objective || '').toLowerCase();
  if (normalized.includes('lead')) return 'Get Your Quote';
  if (normalized.includes('app')) return 'Install Now';
  if (normalized.includes('launch')) return 'Discover It Now';
  if (normalized.includes('brand')) return 'Learn More';
  return 'Shop Now';
};

export const createDefaultShotPlan = (params: {
  ctaText?: string;
  durationSec?: EditorCampaignDuration;
  hookText?: string;
  productTitle?: string;
  strategy?: EditorTimelineStrategy;
  visualPrompt?: string;
} = {}): EditorShotPlan[] => {
  const targetDuration = params.durationSec || 30;
  const productName = params.productTitle || 'the product';
  const hookText = params.hookText || `Open with the strongest reason to care about ${productName}.`;
  const visualPrompt = params.visualPrompt || `Show ${productName} in a clean, conversion-focused product ad style.`;
  const ctaText = params.ctaText || 'Shop Now';
  const isLong = targetDuration >= 60;
  const isShort = targetDuration <= 15;
  const strategy = params.strategy || 'hook-first';

  if (isShort) {
    return [
      {
        assetRoleHint: strategy === 'testimonial-first' ? 'reference' : 'hero',
        durationSec: 3,
        id: createId('shot-hook'),
        promptHint: hookText,
        purpose: 'hook',
        title: 'Hook opener',
      },
      {
        assetRoleHint: strategy === 'demo-first' ? 'product' : 'hero',
        durationSec: 6,
        id: createId('shot-demo'),
        promptHint: visualPrompt,
        purpose: strategy === 'demo-first' ? 'product' : 'demo',
        title: strategy === 'demo-first' ? 'Product demo' : 'Main product moment',
      },
      {
        assetRoleHint: 'hero',
        durationSec: 3.5,
        id: createId('shot-proof'),
        promptHint: `Show why ${productName} is credible, useful, or worth trying.`,
        purpose: 'proof',
        title: 'Proof point',
      },
      {
        assetRoleHint: 'product',
        durationSec: 2.5,
        id: createId('shot-cta'),
        promptHint: ctaText,
        purpose: 'cta',
        title: 'CTA ending',
      },
    ];
  }

  return [
    {
      assetRoleHint: strategy === 'testimonial-first' ? 'reference' : 'hero',
      durationSec: isLong ? 5 : 4,
      id: createId('shot-hook'),
      promptHint: hookText,
      purpose: 'hook',
      title: 'Hook opener',
    },
    {
      assetRoleHint: 'product',
      durationSec: isLong ? 9 : 5,
      id: createId('shot-product'),
      promptHint: `Hero product reveal for ${productName}. Show the most important visual detail clearly.`,
      purpose: 'product',
      title: 'Product reveal',
    },
    {
      assetRoleHint: 'hero',
      durationSec: isLong ? 12 : 7,
      id: createId('shot-demo'),
      promptHint: visualPrompt,
      purpose: 'demo',
      title: 'Demo / use case',
    },
    {
      assetRoleHint: 'broll',
      durationSec: isLong ? 10 : 5,
      id: createId('shot-proof'),
      promptHint: `Show proof, texture, result, benefit, or social validation for ${productName}.`,
      purpose: 'proof',
      title: 'Proof / benefit',
    },
    ...(isLong
      ? [{
          assetRoleHint: 'broll' as EditorAssetRole,
          durationSec: 10,
          id: createId('shot-offer'),
          promptHint: `Show offer details, lifestyle context, or a second product angle for ${productName}.`,
          purpose: 'demo' as EditorSegmentPurpose,
          title: 'Offer expansion',
        }]
      : []),
    {
      assetRoleHint: 'product',
      durationSec: isLong ? 6 : 4,
      id: createId('shot-cta'),
      promptHint: ctaText,
      purpose: 'cta',
      title: 'CTA ending',
    },
  ];
};

const inferOutputVariantsFromPlatform = (platform?: string): EditorOutputAspectRatio[] => {
  const normalized = String(platform || '').toLowerCase();
  if (normalized.includes('instagram') || normalized.includes('tiktok') || normalized.includes('facebook')) {
    return ['9:16', '16:9'];
  }
  if (normalized.includes('youtube') || normalized.includes('linkedin')) {
    return ['16:9', '9:16'];
  }
  return ['9:16', '16:9'];
};

const createDirectorAssets = (plan: DirectorStoredPayload): EditorAsset[] => {
  const assets: EditorAsset[] = [];
  const productImageUrl =
    plan.inputs?.productImageUrl
    || plan.recommendations?.referenceImageUrl
    || plan.sourceContext?.resolvedProductImageUrl
    || '';
  const personaImageUrl = plan.inputs?.persona?.imageUrl || '';

  if (productImageUrl) {
    assets.push({
      id: createId('asset-product'),
      kind: 'image',
      label: 'Product Reference',
      role: 'product',
      source: 'director',
      url: productImageUrl,
    });
  }

  if (personaImageUrl) {
    assets.push({
      id: createId('asset-reference'),
      kind: 'image',
      label: plan.inputs?.persona?.name ? `${plan.inputs.persona.name} Persona` : 'Persona Reference',
      role: 'reference',
      source: 'director',
      url: personaImageUrl,
    });
  }

  return assets;
};

export const createEditorSessionFromDirectorPlan = (plan: DirectorStoredPayload): EditorSession => {
  const now = new Date().toISOString();
  const scenario = plan.scenario;
  const targetDurationSec: EditorCampaignDuration = plan.recommendations?.recommendedDuration >= 30
    ? 30
    : 15;
  const ctaText = createDefaultCtaText(plan.inputs?.objective);
  return {
    assets: createDirectorAssets(plan),
    captionMode: scenario?.plan?.audio_script ? 'segment-cues' : 'none',
    captionText: scenario?.plan?.audio_script || '',
    createdAt: now,
    ctaPlan: {
      durationSec: 2.5,
      enabled: true,
      position: 'ending-card',
      text: ctaText,
    },
    directorPlan: plan,
    hookPlan: {
      emphasis: 'high',
      preferredDurationSec: 2.5,
      source: scenario?.hook ? 'director' : 'derived',
      text: scenario?.hook || plan.recommendation || 'Lead with the strongest product moment.',
    },
    id: createId('editor-session'),
    metadata: {
      audience: plan.inputs?.audience,
      engine: plan.recommendations?.recommendedEngine,
      identityLock: Boolean(plan.inputs?.persona?.id || plan.inputs?.persona?.imageUrl || plan.recommendations?.referenceImageUrl),
      objective: plan.inputs?.objective,
      personaId: plan.inputs?.persona?.id,
      personaImageUrl: plan.inputs?.persona?.imageUrl,
      personaModelId:
        plan.inputs?.persona?.modelId
        || plan.inputs?.persona?.trainingId
        || plan.inputs?.persona?.destinationModel,
      personaName: plan.inputs?.persona?.name,
      platform: plan.inputs?.platform,
      productTitle: plan.sourceContext?.productTitle,
      productUrl: plan.inputs?.productUrl,
      quality: plan.recommendations?.recommendedQuality,
      referenceImageUrl: plan.recommendations?.referenceImageUrl || plan.sourceContext?.resolvedProductImageUrl,
      tone: plan.inputs?.tone,
      triggerWord: plan.inputs?.persona?.triggerWord,
    },
    notes: [
      ...plan.recommendations.productionNotes,
      ...plan.recommendations.riskNotes,
    ].filter(Boolean),
    outputVariants: createOutputVariants(inferOutputVariantsFromPlatform(plan.inputs?.platform)),
    selectedScenarioTitle: scenario?.title,
    shotPlan: createDefaultShotPlan({
      ctaText,
      durationSec: targetDurationSec,
      hookText: scenario?.hook,
      productTitle: plan.sourceContext?.productTitle || plan.inputs?.productBrief,
      strategy: 'hook-first',
      visualPrompt: scenario?.plan?.visual_prompt,
    }),
    targetDurationSec,
    timelineStrategy: 'hook-first',
    title: scenario?.title || plan.sourceContext?.productTitle || 'Auto-Editor Project',
    updatedAt: now,
  };
};

export const createEditorSessionFromVideo = (params: {
  captionText?: string;
  directorPlan?: DirectorStoredPayload | null;
  personaName?: string;
  prompt: string;
  rawVideoUrl: string;
  referenceImageUrl?: string;
  selectedEngine?: VideoEngineKey;
  selectedQuality?: VideoQualityPreset;
}) => {
  const base = params.directorPlan
    ? createEditorSessionFromDirectorPlan(params.directorPlan)
    : {
        assets: [] as EditorAsset[],
        captionMode: params.captionText ? 'segment-cues' : 'none' as EditorCaptionMode,
        captionText: params.captionText || '',
        createdAt: new Date().toISOString(),
        ctaPlan: {
          durationSec: 2.5,
          enabled: true,
          position: 'ending-card' as const,
          text: 'Shop Now',
        },
        directorPlan: null,
        hookPlan: {
          emphasis: 'high' as const,
          preferredDurationSec: 2.5,
          source: 'derived' as const,
          text: params.prompt.trim(),
        },
        id: createId('editor-session'),
        metadata: {
          engine: params.selectedEngine,
          identityLock: Boolean(params.referenceImageUrl),
          personaName: params.personaName,
          quality: params.selectedQuality,
          rawVideoUrl: params.rawVideoUrl,
          referenceImageUrl: params.referenceImageUrl,
        },
        notes: [] as string[],
        outputVariants: createOutputVariants(['9:16', '16:9']),
        selectedScenarioTitle: undefined,
        shotPlan: createDefaultShotPlan({
          durationSec: 30,
          hookText: params.prompt.trim(),
          visualPrompt: params.prompt.trim(),
        }),
        targetDurationSec: 30 as EditorCampaignDuration,
        timelineStrategy: 'hook-first' as EditorTimelineStrategy,
        title: 'Auto-Editor Project',
        updatedAt: new Date().toISOString(),
      };

  return upsertEditorAsset({
    ...base,
    captionText: base.captionText || params.captionText || '',
    metadata: {
      ...(base.metadata || {}),
      engine: params.selectedEngine || base.metadata?.engine,
      personaName: params.personaName || base.metadata?.personaName,
      quality: params.selectedQuality || base.metadata?.quality,
      rawVideoUrl: params.rawVideoUrl,
      referenceImageUrl: params.referenceImageUrl || base.metadata?.referenceImageUrl,
    },
    updatedAt: new Date().toISOString(),
  }, {
    id: createId('asset-hero-video'),
    isPrimary: true,
    kind: 'video',
    label: 'Raw Video Output',
    role: 'hero',
    source: 'video',
    url: params.rawVideoUrl,
  });
};

export const upsertEditorAsset = (session: EditorSession, asset: EditorAsset): EditorSession => {
  const existingIndex = session.assets.findIndex((item) =>
    item.id === asset.id || (item.url === asset.url && item.role === asset.role)
  );
  const assets = [...session.assets];
  if (existingIndex >= 0) {
    assets[existingIndex] = {
      ...assets[existingIndex],
      ...asset,
      id: assets[existingIndex].id,
    };
  } else {
    assets.push(asset);
  }
  return {
    ...session,
    assets,
    updatedAt: new Date().toISOString(),
  };
};
