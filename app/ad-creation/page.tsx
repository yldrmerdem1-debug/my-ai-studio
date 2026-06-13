'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Sidebar from '@/components/Sidebar';
import AuroraBackground from '@/components/AuroraBackground';
import PricingModal from '@/components/PricingModal';
import Link from 'next/link';
import { usePersona } from '@/hooks/usePersona';
import { usePersonaOptions, type PersonaOption } from '@/hooks/usePersonaOptions';
import {
  BadgeCheck,
  Clapperboard,
  FileText,
  ImagePlus,
  LayoutTemplate,
  Loader2,
  Plus,
  Sparkles,
  Upload,
  Video,
  X,
} from 'lucide-react';
import { fileToDataUrl } from '@/lib/client/file-data-url';
import {
  VIDEO_ENGINES_CONFIG,
  VIDEO_QUALITY_PRESET_LABELS,
  type VideoEngineKey,
  type VideoQualityPreset,
} from '@/lib/constants';
import { isPublicFaceSwapEnabled } from '@/lib/feature-flags';
import {
  AUTO_EDITOR_SESSION_KEY,
  createEditorSessionFromDirectorPlan,
  createEditorSessionFromVideo,
  createDefaultShotPlan,
  createOutputVariants,
  upsertEditorAsset,
  type AutoEditorComposerResponse,
  type EditorCampaignDuration,
  type EditorAsset,
  type EditorAssetKind,
  type EditorAssetRole,
  type EditorSession,
  type OutputVariant,
} from '@/lib/ad-director';
import { planEditorTimeline } from '@/lib/auto-editor/timeline';

type OutputMap = Record<string, string>;

const OUTPUT_VARIANT_ORDER: Array<OutputVariant['aspectRatio']> = ['9:16', '16:9'];
const CAMPAIGN_DURATIONS: EditorCampaignDuration[] = [15, 30, 60];
const AUTO_EDITOR_VIDEO_ENGINES: VideoEngineKey[] = ['grok', 'seedance_2_0', 'veo', 'runway', 'kling_3_pro', 'kling_turbo', 'kling_2_6'];
const VIDEO_ENGINE_LABELS: Record<VideoEngineKey, string> = {
  grok: 'Grok',
  seedance_2_0: 'Seedance 2.0',
  veo: 'Veo',
  runway: 'Runway',
  kling_3_pro: 'Kling 3 Pro',
  kling_turbo: 'Kling Turbo',
  kling_2_6: 'Kling 2.6',
  kling_avatar_v2: 'Kling Avatar',
};

const createManualAsset = (params: {
  kind: EditorAssetKind;
  label: string;
  role: EditorAssetRole;
  url: string;
}): EditorAsset => ({
  id: `manual-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`}`,
  kind: params.kind,
  label: params.label,
  role: params.role,
  source: params.role === 'logo' ? 'brand' : 'manual',
  url: params.url,
});

const getHeroVideoAsset = (session: EditorSession | null) =>
  session?.assets.find((asset) => asset.kind === 'video' && asset.role === 'hero') || null;

const getPersonaImageUrl = (persona: PersonaOption | null) =>
  persona?.imageUrl || persona?.image_url || '';

const getPersonaModelId = (persona: PersonaOption | null) =>
  persona?.modelId || persona?.model_id || persona?.trainingId || persona?.training_id || '';

const getPersonaTriggerWord = (persona: PersonaOption | null) =>
  persona?.triggerWord || persona?.trigger_word || '';

export default function AdCreationPage() {
  const { user } = usePersona();
  const { personaOptions } = usePersonaOptions(user);
  const [session, setSession] = useState<EditorSession | null>(null);
  const [outputs, setOutputs] = useState<OutputMap>({});
  const [renderedTimeline, setRenderedTimeline] = useState<AutoEditorComposerResponse['timeline'] | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [isPackaging, setIsPackaging] = useState(false);
  const [isGeneratingScenes, setIsGeneratingScenes] = useState(false);
  const [isUploadingHeroVideo, setIsUploadingHeroVideo] = useState(false);
  const [isUploadingSupportingAsset, setIsUploadingSupportingAsset] = useState(false);
  const [isPricingModalOpen, setIsPricingModalOpen] = useState(false);
  const [assetUrlInput, setAssetUrlInput] = useState('');
  const [assetLabelInput, setAssetLabelInput] = useState('');
  const [assetKindInput, setAssetKindInput] = useState<EditorAssetKind>('image');
  const [assetRoleInput, setAssetRoleInput] = useState<EditorAssetRole>('broll');
  const [uploadRole, setUploadRole] = useState<EditorAssetRole>('product');
  const [heroVideoPreviewUrl, setHeroVideoPreviewUrl] = useState<string | null>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const supportingVideoInputRef = useRef<HTMLInputElement>(null);
  const heroVideoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const rawSession = localStorage.getItem(AUTO_EDITOR_SESSION_KEY);
    if (rawSession) {
      try {
        setSession(JSON.parse(rawSession) as EditorSession);
        return;
      } catch {
        // ignore and rebuild from legacy keys
      }
    }

    const latestVideo = localStorage.getItem('latestRawVideoUrl');
    const directorRaw = localStorage.getItem('adDirectorPlan');
    if (!latestVideo && !directorRaw) return;

    try {
      const directorPlan = directorRaw ? JSON.parse(directorRaw) : null;
      const nextSession = latestVideo
        ? createEditorSessionFromVideo({
            captionText: directorPlan?.scenario?.plan?.audio_script || '',
            directorPlan,
            prompt: directorPlan?.scenario?.plan?.visual_prompt || '',
            rawVideoUrl: latestVideo,
            referenceImageUrl:
              directorPlan?.recommendations?.referenceImageUrl
              || directorPlan?.sourceContext?.resolvedProductImageUrl,
          })
        : createEditorSessionFromDirectorPlan(directorPlan);
      setSession(nextSession);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || !session) return;
    localStorage.setItem(AUTO_EDITOR_SESSION_KEY, JSON.stringify(session));
  }, [session]);

  useEffect(() => {
    return () => {
      if (heroVideoPreviewUrl) {
        URL.revokeObjectURL(heroVideoPreviewUrl);
      }
    };
  }, [heroVideoPreviewUrl]);

  const plannedTimeline = useMemo(() => {
    if (!session) return null;
    return planEditorTimeline(session);
  }, [session]);

  const heroVideoAsset = useMemo(() => getHeroVideoAsset(session), [session]);
  const selectedVideoEngine = (session?.metadata?.engine || 'grok') as VideoEngineKey;
  const selectedEngineConfig = VIDEO_ENGINES_CONFIG[selectedVideoEngine] || VIDEO_ENGINES_CONFIG.grok;
  const selectedVideoQuality = (
    session?.metadata?.quality && selectedEngineConfig.supportedQualities.includes(session.metadata.quality)
      ? session.metadata.quality
      : selectedEngineConfig.defaultQuality
  ) as VideoQualityPreset;
  const selectedPersona = useMemo(
    () => personaOptions.find((option) => option.id === session?.metadata?.personaId) || null,
    [personaOptions, session?.metadata?.personaId]
  );
  const strictFaceLockAvailable = isPublicFaceSwapEnabled();
  const canUseStrictFaceLock = Boolean(strictFaceLockAvailable && selectedPersona && getPersonaImageUrl(selectedPersona));

  const updateSession = (updater: (current: EditorSession) => EditorSession) => {
    setSession((current) => (current ? updater(current) : current));
  };

  const createBlankSession = (rawVideoUrl = ''): EditorSession => {
    const now = new Date().toISOString();
    return {
      assets: rawVideoUrl
        ? [{
            id: `hero-${Date.now()}`,
            isPrimary: true,
            kind: 'video',
            label: 'Uploaded Hero Video',
            role: 'hero',
            source: 'manual',
            url: rawVideoUrl,
          }]
        : [],
      captionMode: 'segment-cues',
      captionText: '',
      createdAt: now,
      ctaPlan: {
        durationSec: 2.5,
        enabled: true,
        position: 'ending-card',
        text: 'Shop Now',
      },
      hookPlan: {
        emphasis: 'high',
        preferredDurationSec: 2.5,
        source: 'manual',
        text: 'Start with the strongest product moment.',
      },
      id: `editor-session-${Date.now()}`,
      metadata: {
        engine: 'grok',
        identityLock: false,
        quality: VIDEO_ENGINES_CONFIG.grok.defaultQuality,
      },
      notes: [],
      outputVariants: createOutputVariants(['9:16', '16:9']),
      shotPlan: createDefaultShotPlan({ durationSec: 30 }),
      targetDurationSec: 30,
      timelineStrategy: 'hook-first',
      title: 'Auto-Editor Project',
      updatedAt: now,
    };
  };

  const handleUseLatestVideo = () => {
    if (typeof window === 'undefined') return;
    const latest = localStorage.getItem('latestRawVideoUrl');
    if (!latest) {
      setErrorMessage('No latest AI Video output found yet.');
      return;
    }
    setErrorMessage('');
    if (!session) {
      const directorRaw = localStorage.getItem('adDirectorPlan');
      const directorPlan = directorRaw ? JSON.parse(directorRaw) : null;
      setSession(createEditorSessionFromVideo({
        captionText: directorPlan?.scenario?.plan?.audio_script || '',
        directorPlan,
        prompt: directorPlan?.scenario?.plan?.visual_prompt || '',
        rawVideoUrl: latest,
        referenceImageUrl:
          directorPlan?.recommendations?.referenceImageUrl
          || directorPlan?.sourceContext?.resolvedProductImageUrl,
      }));
      return;
    }
    updateSession((current) => upsertEditorAsset(current, {
      id: heroVideoAsset?.id || `hero-${Date.now()}`,
      isPrimary: true,
      kind: 'video',
      label: heroVideoAsset?.label || 'Raw Video Output',
      role: 'hero',
      source: 'video',
      url: latest,
    }));
  };

  const handleCampaignDurationChange = (targetDurationSec: EditorCampaignDuration) => {
    if (!session) return;
    updateSession((current) => ({
      ...current,
      shotPlan: createDefaultShotPlan({
        ctaText: current.ctaPlan.text,
        durationSec: targetDurationSec,
        hookText: current.hookPlan.text,
        productTitle: current.metadata?.productTitle || current.title,
        strategy: current.timelineStrategy,
        visualPrompt: current.directorPlan?.scenario?.plan?.visual_prompt || current.hookPlan.text,
      }),
      targetDurationSec,
      updatedAt: new Date().toISOString(),
    }));
  };

  const upsertHeroVideo = (params: { label: string; source: EditorAsset['source']; url: string }) => {
    if (!session) {
      setSession(createBlankSession(params.url));
      return;
    }
    updateSession((current) => upsertEditorAsset(current, {
      id: heroVideoAsset?.id || `hero-${Date.now()}`,
      isPrimary: true,
      kind: 'video',
      label: params.label,
      role: 'hero',
      source: params.source,
      url: params.url,
    }));
  };

  const handleHeroVideoUpload = async (file: File | null) => {
    if (!file) return;
    if (!file.type.startsWith('video/')) {
      setErrorMessage('Please upload a video file.');
      return;
    }

    if (heroVideoPreviewUrl) {
      URL.revokeObjectURL(heroVideoPreviewUrl);
    }
    const objectUrl = URL.createObjectURL(file);
    setHeroVideoPreviewUrl(objectUrl);
    setIsUploadingHeroVideo(true);
    setErrorMessage('');

    try {
      const formData = new FormData();
      formData.append('file', file);
      const response = await fetch('/api/upload-video', {
        method: 'POST',
        body: formData,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || data.details || 'Failed to upload video');
      }
      if (!data.publicUrl || typeof data.publicUrl !== 'string') {
        throw new Error('Video upload succeeded but no public URL was returned');
      }
      upsertHeroVideo({
        label: file.name || 'Uploaded Hero Video',
        source: 'manual',
        url: data.publicUrl,
      });
    } catch (error: unknown) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to upload video');
    } finally {
      setIsUploadingHeroVideo(false);
    }
  };

  const handleAddAssetUrl = () => {
    if (!session) return;
    if (!assetUrlInput.trim()) {
      setErrorMessage('Paste an asset URL before adding it.');
      return;
    }
    setErrorMessage('');
    updateSession((current) => ({
      ...current,
      assets: [
        ...current.assets,
        createManualAsset({
          kind: assetKindInput,
          label: assetLabelInput.trim() || `${assetRoleInput} asset`,
          role: assetRoleInput,
          url: assetUrlInput.trim(),
        }),
      ],
      updatedAt: new Date().toISOString(),
    }));
    setAssetUrlInput('');
    setAssetLabelInput('');
  };

  const handleUploadImageAsset = async (file: File | null) => {
    if (!file || !session) return;
    setErrorMessage('');
    try {
      const dataUrl = await fileToDataUrl(file);
      updateSession((current) => ({
        ...current,
        assets: [
          ...current.assets,
          createManualAsset({
            kind: 'image',
            label: file.name,
            role: uploadRole,
            url: dataUrl,
          }),
        ],
        updatedAt: new Date().toISOString(),
      }));
    } catch (error: unknown) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to add image asset');
    }
  };

  const handleUploadSupportingVideo = async (file: File | null) => {
    if (!file || !session) return;
    if (!file.type.startsWith('video/')) {
      setErrorMessage('Please upload a video file.');
      return;
    }

    setIsUploadingSupportingAsset(true);
    setErrorMessage('');

    try {
      const formData = new FormData();
      formData.append('file', file);
      const response = await fetch('/api/upload-video', {
        method: 'POST',
        body: formData,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || data.details || 'Failed to upload supporting video');
      }
      if (!data.publicUrl || typeof data.publicUrl !== 'string') {
        throw new Error('Video upload succeeded but no public URL was returned');
      }
      updateSession((current) => ({
        ...current,
        assets: [
          ...current.assets,
          createManualAsset({
            kind: 'video',
            label: file.name || 'B-roll video',
            role: 'broll',
            url: data.publicUrl,
          }),
        ],
        updatedAt: new Date().toISOString(),
      }));
    } catch (error: unknown) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to upload supporting video');
    } finally {
      setIsUploadingSupportingAsset(false);
    }
  };

  const handleLogoPick = async (file: File | null) => {
    if (!file || !session) return;
    setErrorMessage('');
    try {
      const dataUrl = await fileToDataUrl(file);
      updateSession((current) => upsertEditorAsset(current, {
        id: current.assets.find((asset) => asset.role === 'logo')?.id || `logo-${Date.now()}`,
        kind: 'image',
        label: file.name,
        role: 'logo',
        source: 'brand',
        url: dataUrl,
      }));
    } catch (error: unknown) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to load logo');
    }
  };

  const handleRemoveAsset = (assetId: string) => {
    if (!session) return;
    updateSession((current) => ({
      ...current,
      assets: current.assets.filter((asset) => asset.id !== assetId),
      updatedAt: new Date().toISOString(),
    }));
  };

  const handleOutputVariantToggle = (aspectRatio: OutputVariant['aspectRatio']) => {
    if (!session) return;
    updateSession((current) => {
      const exists = current.outputVariants.some((variant) => variant.aspectRatio === aspectRatio);
      const nextAspectRatios = exists
        ? current.outputVariants.filter((variant) => variant.aspectRatio !== aspectRatio).map((variant) => variant.aspectRatio)
        : [...current.outputVariants.map((variant) => variant.aspectRatio), aspectRatio];

      return {
        ...current,
        outputVariants: createOutputVariants(nextAspectRatios.length > 0 ? nextAspectRatios : ['9:16']),
        updatedAt: new Date().toISOString(),
      };
    });
  };

  const handleVideoEngineChange = (engine: VideoEngineKey) => {
    if (!session) return;
    const nextConfig = VIDEO_ENGINES_CONFIG[engine] || VIDEO_ENGINES_CONFIG.grok;
    updateSession((current) => {
      const currentQuality = current.metadata?.quality;
      return {
        ...current,
        metadata: {
          ...(current.metadata || {}),
          engine,
          quality: currentQuality && nextConfig.supportedQualities.includes(currentQuality)
            ? currentQuality
            : nextConfig.defaultQuality,
        },
        updatedAt: new Date().toISOString(),
      };
    });
  };

  const handleVideoQualityChange = (quality: VideoQualityPreset) => {
    if (!session) return;
    updateSession((current) => ({
      ...current,
      metadata: {
        ...(current.metadata || {}),
        engine: selectedVideoEngine,
        quality,
      },
      updatedAt: new Date().toISOString(),
    }));
  };

  const handlePersonaChange = (personaId: string) => {
    if (!session) return;
    const persona = personaOptions.find((option) => option.id === personaId) || null;
    updateSession((current) => ({
      ...current,
      metadata: {
        ...(current.metadata || {}),
        identityLock: persona ? true : current.metadata?.identityLock || false,
        personaId: persona?.id || undefined,
        personaImageUrl: getPersonaImageUrl(persona) || undefined,
        personaModelId: getPersonaModelId(persona) || undefined,
        personaName: persona?.name || undefined,
        triggerWord: getPersonaTriggerWord(persona) || undefined,
      },
      updatedAt: new Date().toISOString(),
    }));
  };

  const handleIdentityLockChange = (enabled: boolean) => {
    if (!session) return;
    updateSession((current) => ({
      ...current,
      metadata: {
        ...(current.metadata || {}),
        identityLock: enabled,
      },
      updatedAt: new Date().toISOString(),
    }));
  };

  const handleStrictFaceLockChange = (enabled: boolean) => {
    if (!session) return;
    if (enabled && !canUseStrictFaceLock) {
      setErrorMessage(
        strictFaceLockAvailable
          ? 'Strict face lock needs a selected persona with an image.'
          : 'Strict face lock is disabled in environment settings.'
      );
      return;
    }
    setErrorMessage('');
    updateSession((current) => ({
      ...current,
      metadata: {
        ...(current.metadata || {}),
        identityLock: enabled ? true : current.metadata?.identityLock || false,
        strictFaceLock: enabled,
      },
      updatedAt: new Date().toISOString(),
    }));
  };

  const handleShotPromptChange = (shotId: string, promptHint: string) => {
    if (!session) return;
    updateSession((current) => ({
      ...current,
      shotPlan: (current.shotPlan || []).map((shot) => (
        shot.id === shotId ? { ...shot, promptHint } : shot
      )),
      updatedAt: new Date().toISOString(),
    }));
  };

  const handlePackaging = async () => {
    if (!session) {
      setErrorMessage('Editor session is not ready yet.');
      return;
    }
    if (!heroVideoAsset?.url.trim()) {
      setErrorMessage('Upload a hero video or paste a raw video URL before rendering.');
      return;
    }
    if (isUploadingHeroVideo) {
      setErrorMessage('Please wait for the hero video upload to finish.');
      return;
    }
    if (session.outputVariants.length === 0) {
      setErrorMessage('Select at least one output format.');
      return;
    }

    setIsPackaging(true);
    setErrorMessage('');
    setOutputs({});

    try {
      const response = await fetch('/api/auto-editor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || data.details || 'Failed to compose ad');
      }

      setOutputs(data.outputs || {});
      if (typeof window !== 'undefined' && data.outputs && typeof data.outputs === 'object') {
        const { saveVideoAsset } = await import('@/lib/assets-storage');
        Object.entries(data.outputs).forEach(([variant, url]) => {
          if (typeof url !== 'string' || !url) return;
          saveVideoAsset(url, `Auto-Editor ${variant} - ${new Date().toLocaleDateString()}`, {
            model: 'auto-editor',
            variant,
            prompt: session.directorPlan?.inputs?.productBrief || session.title,
          });
        });
      }
      setRenderedTimeline(data.timeline || null);
      if (data.session) {
        setSession(data.session);
      }
    } catch (error: unknown) {
      setErrorMessage(error instanceof Error ? error.message : 'Composer failed');
    } finally {
      setIsPackaging(false);
    }
  };

  const handleGenerateScenes = async () => {
    if (!session) {
      setErrorMessage('Editor session is not ready yet.');
      return;
    }
    if (!user?.id) {
      setErrorMessage('User authentication required before generating scenes.');
      return;
    }
    if (!session.shotPlan?.length) {
      setErrorMessage('Choose a final ad length before generating scenes.');
      return;
    }

    setIsGeneratingScenes(true);
    setErrorMessage('');
    setOutputs({});
    setRenderedTimeline(null);

    try {
      const response = await fetch('/api/auto-editor/generate-scenes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          engine: selectedVideoEngine,
          qualityPreset: selectedVideoQuality,
          session,
          userId: user.id,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || data.details || 'Failed to generate planned scenes');
      }
      if (!data.session) {
        throw new Error('Scene generation finished but did not return an editor session');
      }
      setSession(data.session);
    } catch (error: unknown) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to generate planned scenes');
    } finally {
      setIsGeneratingScenes(false);
    }
  };

  const logoAsset = session?.assets.find((asset) => asset.role === 'logo') || null;

  return (
    <div className="relative min-h-screen bg-black">
      <AuroraBackground />
      <Sidebar onSubscriptionClick={() => setIsPricingModalOpen(true)} />
      <PricingModal isOpen={isPricingModalOpen} onClose={() => setIsPricingModalOpen(false)} />

      <main className="relative z-10 ml-64">
        <div className="container mx-auto px-8 py-12">
          <div className="mb-8">
            <Link href="/" className="text-[#00d9ff] hover:text-[#0099ff] mb-4 inline-block transition-colors">
              ← Back to Studio
            </Link>
            <div className="flex items-center gap-3 mb-2">
              <Sparkles className="w-8 h-8 text-[#fbbf24]" style={{ filter: 'drop-shadow(0 0 8px #fbbf24)' }} />
              <h1 className="text-4xl font-bold text-white">
                <span className="bg-gradient-to-r from-[#fbbf24] via-[#f59e0b] to-[#fbbf24] bg-clip-text text-transparent">
                  Auto-Editor
                </span>
              </h1>
            </div>
            <p className="text-gray-400 text-lg">
              Turn your idea into a finished, post-ready ad — built scene by scene, then stitched automatically.
            </p>
          </div>

          {/* How it works - clear 3-step flow so the page isn't confusing */}
          <div className="mb-8 grid grid-cols-1 gap-3 sm:grid-cols-3">
            {[
              {
                step: '1',
                title: 'Set up your project',
                desc: 'Add your hero video, supporting images, persona, captions and final length.',
                tone: 'cyan',
              },
              {
                step: '2',
                title: 'Generate scene videos',
                desc: 'AI creates one short clip per scene from your Multi-Shot Ad Plan.',
                tone: 'cyan',
              },
              {
                step: '3',
                title: 'Build the final ad',
                desc: 'Scenes are stitched into ready-to-post 9:16 and 16:9 videos with captions + CTA.',
                tone: 'amber',
              },
            ].map((item) => (
              <div
                key={item.step}
                className={`rounded-2xl border p-4 ${
                  item.tone === 'amber'
                    ? 'border-[#fbbf24]/25 bg-[#fbbf24]/[0.06]'
                    : 'border-[#00d9ff]/20 bg-[#00d9ff]/[0.05]'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                      item.tone === 'amber' ? 'bg-[#fbbf24] text-black' : 'bg-[#00d9ff] text-black'
                    }`}
                  >
                    {item.step}
                  </span>
                  <p className="text-sm font-semibold text-white">{item.title}</p>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-gray-400">{item.desc}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_0.9fr] gap-8">
            <div className="space-y-6">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-[#00d9ff]">
                <LayoutTemplate className="h-4 w-4" />
                Inputs &amp; settings
              </div>
              <div className="glass rounded-2xl p-8">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-xl font-semibold text-white flex items-center gap-2">
                      <LayoutTemplate className="w-5 h-5 text-[#00d9ff]" />
                      Project Brief
                    </h2>
                    <p className="mt-2 text-sm text-gray-400">
                      Composer session loaded from AI Director and AI Video handoff.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleUseLatestVideo}
                    className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-xs text-white hover:bg-white/10"
                  >
                    Use latest AI Video output
                  </button>
                </div>
                {session ? (
                  <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                    <div className="rounded-xl border border-white/10 bg-black/30 p-4">
                      <p className="text-xs uppercase tracking-wide text-gray-500">Project</p>
                      <p className="mt-2 text-white font-medium">{session.title}</p>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-black/30 p-4">
                      <p className="text-xs uppercase tracking-wide text-gray-500">Strategy</p>
                      <p className="mt-2 text-white font-medium">{session.timelineStrategy}</p>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-black/30 p-4">
                      <p className="text-xs uppercase tracking-wide text-gray-500">Hook</p>
                      <p className="mt-2 text-white font-medium">{session.hookPlan.text}</p>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-black/30 p-4">
                      <p className="text-xs uppercase tracking-wide text-gray-500">Outputs</p>
                      <p className="mt-2 text-white font-medium">
                        {session.outputVariants.map((variant) => variant.aspectRatio).join(', ')}
                      </p>
                    </div>
                  </div>
                ) : (
                  <p className="mt-4 text-sm text-white/50">Generate or approve a director plan to start a composer session.</p>
                )}
              </div>

              <div className="glass rounded-2xl p-8">
                <div className="flex items-start justify-between gap-4 mb-4">
                  <div>
                    <h2 className="text-xl font-semibold text-white flex items-center gap-2">
                      <Video className="w-5 h-5 text-[#00d9ff]" />
                      Hero Video
                    </h2>
                    <p className="mt-2 text-sm text-gray-400">
                      Upload the main raw video. URL paste stays available for AI Video handoff and advanced users.
                    </p>
                  </div>
                  {heroVideoAsset?.url && (
                    <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-xs text-emerald-200">
                      Video ready
                    </span>
                  )}
                </div>
                <input
                  ref={heroVideoInputRef}
                  type="file"
                  accept="video/*"
                  onChange={(event) => handleHeroVideoUpload(event.target.files?.[0] || null)}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => heroVideoInputRef.current?.click()}
                  className="interactive-element w-full min-h-48 border-2 border-dashed border-white/20 rounded-xl flex flex-col items-center justify-center gap-3 hover:border-[#00d9ff]/50 transition-colors bg-black/30"
                >
                  {isUploadingHeroVideo ? (
                    <>
                      <Loader2 className="w-10 h-10 animate-spin text-[#00d9ff]" />
                      <p className="text-white font-medium">Uploading video...</p>
                      <p className="text-xs text-gray-500">Keep this page open until the upload finishes.</p>
                    </>
                  ) : heroVideoPreviewUrl || heroVideoAsset?.url ? (
                    <>
                      <Video className="w-10 h-10 text-emerald-300" />
                      <p className="text-white font-medium">
                        {heroVideoAsset?.label || 'Hero video selected'}
                      </p>
                      <p className="text-xs text-gray-500">Click to replace with another video.</p>
                    </>
                  ) : (
                    <>
                      <Upload className="w-10 h-10 text-gray-400" />
                      <p className="text-white font-medium">Upload raw video</p>
                      <p className="text-xs text-gray-500">MP4, MOV, or WebM works best.</p>
                    </>
                  )}
                </button>
                <details className="mt-4 rounded-xl border border-white/10 bg-black/20 p-4">
                  <summary className="cursor-pointer text-sm text-gray-300">
                    Advanced: paste video URL instead
                  </summary>
                  <textarea
                    value={heroVideoAsset?.url || ''}
                    onChange={(event) => {
                      const nextValue = event.target.value;
                      upsertHeroVideo({
                        label: heroVideoAsset?.label || 'Raw Video URL',
                        source: 'manual',
                        url: nextValue,
                      });
                    }}
                    placeholder="Paste a raw video URL from AI Video or hosted file"
                    rows={3}
                    className="mt-3 w-full px-4 py-3 bg-black/40 border border-white/10 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-[#fbbf24]/50 transition-colors resize-none"
                  />
                </details>
              </div>

              <div className="glass rounded-2xl p-8 space-y-5">
                <div>
                  <h2 className="text-xl font-semibold text-white flex items-center gap-2">
                    <Plus className="w-5 h-5 text-[#00d9ff]" />
                    Supporting Assets
                  </h2>
                  <p className="mt-2 text-sm text-gray-400">
                    Optional product images, b-roll clips, covers, or reference visuals that make the edit richer.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <input
                    ref={imageInputRef}
                    type="file"
                    accept="image/*"
                    onChange={(event) => handleUploadImageAsset(event.target.files?.[0] || null)}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => imageInputRef.current?.click()}
                    disabled={!session}
                    className="rounded-xl border border-white/10 bg-white/5 p-4 text-left hover:bg-white/10 disabled:opacity-50"
                  >
                    <ImagePlus className="mb-3 h-6 w-6 text-[#00d9ff]" />
                    <p className="text-sm font-semibold text-white">Upload product / still image</p>
                    <p className="mt-1 text-xs text-gray-500">Use product shots, cover visuals, or references.</p>
                  </button>

                  <input
                    ref={supportingVideoInputRef}
                    type="file"
                    accept="video/*"
                    onChange={(event) => handleUploadSupportingVideo(event.target.files?.[0] || null)}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => supportingVideoInputRef.current?.click()}
                    disabled={!session || isUploadingSupportingAsset}
                    className="rounded-xl border border-white/10 bg-white/5 p-4 text-left hover:bg-white/10 disabled:opacity-50"
                  >
                    {isUploadingSupportingAsset ? (
                      <Loader2 className="mb-3 h-6 w-6 animate-spin text-[#00d9ff]" />
                    ) : (
                      <Video className="mb-3 h-6 w-6 text-[#00d9ff]" />
                    )}
                    <p className="text-sm font-semibold text-white">Upload b-roll video</p>
                    <p className="mt-1 text-xs text-gray-500">Add extra clips for demo, proof, or cutaways.</p>
                  </button>
                </div>

                <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                  <p className="mb-3 text-sm text-gray-300">Image role</p>
                  <select
                    value={uploadRole}
                    onChange={(event) => setUploadRole(event.target.value as EditorAssetRole)}
                    className="w-full px-4 py-3 bg-black/40 border border-white/10 rounded-lg text-white focus:outline-none"
                  >
                    <option value="product">Product image</option>
                    <option value="cover">Cover image</option>
                    <option value="reference">Reference visual</option>
                    <option value="broll">B-roll still</option>
                  </select>
                </div>

                <details className="rounded-xl border border-white/10 bg-black/20 p-4">
                  <summary className="cursor-pointer text-sm text-gray-300">
                    Advanced: add asset from URL
                  </summary>
                  <div className="mt-4 space-y-3">
                    <input
                      value={assetUrlInput}
                      onChange={(event) => setAssetUrlInput(event.target.value)}
                      placeholder="Paste image or video URL"
                      className="w-full px-4 py-3 bg-black/40 border border-white/10 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-[#fbbf24]/50"
                    />
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <input
                        value={assetLabelInput}
                        onChange={(event) => setAssetLabelInput(event.target.value)}
                        placeholder="Label"
                        className="w-full px-4 py-3 bg-black/40 border border-white/10 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-[#fbbf24]/50"
                      />
                      <select
                        value={assetKindInput}
                        onChange={(event) => setAssetKindInput(event.target.value as EditorAssetKind)}
                        className="w-full px-4 py-3 bg-black/40 border border-white/10 rounded-lg text-white focus:outline-none focus:border-[#fbbf24]/50"
                      >
                        <option value="image">Image</option>
                        <option value="video">Video</option>
                      </select>
                      <select
                        value={assetRoleInput}
                        onChange={(event) => setAssetRoleInput(event.target.value as EditorAssetRole)}
                        className="w-full px-4 py-3 bg-black/40 border border-white/10 rounded-lg text-white focus:outline-none focus:border-[#fbbf24]/50"
                      >
                        <option value="broll">B-roll</option>
                        <option value="product">Product</option>
                        <option value="cover">Cover</option>
                        <option value="reference">Reference</option>
                      </select>
                    </div>
                    <button
                      type="button"
                      onClick={handleAddAssetUrl}
                      disabled={!session}
                      className="rounded-lg bg-white/10 px-4 py-2 text-sm text-white hover:bg-white/15 disabled:opacity-50"
                    >
                      Add URL Asset
                    </button>
                  </div>
                </details>
              </div>

              <div className="glass rounded-2xl p-8 space-y-4">
                <h2 className="text-xl font-semibold text-white flex items-center gap-2">
                  <Clapperboard className="w-5 h-5 text-[#00d9ff]" />
                  Composition Controls
                </h2>
                <p className="text-sm text-gray-400">
                  Choose the engine, persona, length and captions used for every generated scene.
                </p>
                <select
                  value={session?.timelineStrategy || 'hook-first'}
                  onChange={(event) => {
                    if (!session) return;
                    const nextStrategy = event.target.value as EditorSession['timelineStrategy'];
                    updateSession((current) => ({
                      ...current,
                      shotPlan: createDefaultShotPlan({
                        ctaText: current.ctaPlan.text,
                        durationSec: current.targetDurationSec || 30,
                        hookText: current.hookPlan.text,
                        productTitle: current.metadata?.productTitle || current.title,
                        strategy: nextStrategy,
                        visualPrompt: current.directorPlan?.scenario?.plan?.visual_prompt || current.hookPlan.text,
                      }),
                      timelineStrategy: nextStrategy,
                      updatedAt: new Date().toISOString(),
                    }));
                  }}
                  className="w-full px-4 py-3 bg-black/40 border border-white/10 rounded-lg text-white focus:outline-none focus:border-[#fbbf24]/50"
                >
                  <option value="hook-first">Hook-first</option>
                  <option value="demo-first">Demo-first</option>
                  <option value="testimonial-first">Testimonial-first</option>
                </select>
                <div className="rounded-xl border border-[#00d9ff]/20 bg-[#00d9ff]/5 p-4">
                  <p className="text-sm font-medium text-white">Scene generation engine</p>
                  <p className="mt-1 text-xs text-gray-500">
                    These are the same engines used in AI Video Factory. Auto-Editor will generate every planned scene with this engine.
                  </p>
                  <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                    <select
                      value={selectedVideoEngine}
                      onChange={(event) => handleVideoEngineChange(event.target.value as VideoEngineKey)}
                      disabled={!session || isGeneratingScenes}
                      className="w-full px-4 py-3 bg-black/40 border border-white/10 rounded-lg text-white focus:outline-none focus:border-[#00d9ff]/50 disabled:opacity-50"
                    >
                      {AUTO_EDITOR_VIDEO_ENGINES.map((engine) => (
                        <option key={engine} value={engine}>
                          {VIDEO_ENGINE_LABELS[engine]}
                        </option>
                      ))}
                    </select>
                    <select
                      value={selectedVideoQuality}
                      onChange={(event) => handleVideoQualityChange(event.target.value as VideoQualityPreset)}
                      disabled={!session || isGeneratingScenes}
                      className="w-full px-4 py-3 bg-black/40 border border-white/10 rounded-lg text-white focus:outline-none focus:border-[#00d9ff]/50 disabled:opacity-50"
                    >
                      {selectedEngineConfig.supportedQualities.map((quality) => (
                        <option key={quality} value={quality}>
                          {VIDEO_QUALITY_PRESET_LABELS[quality]?.title || quality}
                          {VIDEO_QUALITY_PRESET_LABELS[quality]?.hint ? ` - ${VIDEO_QUALITY_PRESET_LABELS[quality].hint}` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                  <p className="mt-3 text-xs text-cyan-200">
                    Current: {VIDEO_ENGINE_LABELS[selectedVideoEngine]} / {VIDEO_QUALITY_PRESET_LABELS[selectedVideoQuality]?.title || selectedVideoQuality}
                  </p>
                </div>
                <div className="rounded-xl border border-white/10 bg-black/30 p-4">
                  <p className="text-sm font-medium text-white">Persona / identity lock</p>
                  <p className="mt-1 text-xs text-gray-500">
                    Select a persona to keep the same face or trained product across every generated scene.
                  </p>
                  <div className="mt-3 grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3">
                    <select
                      value={session?.metadata?.personaId || ''}
                      onChange={(event) => handlePersonaChange(event.target.value)}
                      disabled={!session || isGeneratingScenes}
                      className="w-full px-4 py-3 bg-black/40 border border-white/10 rounded-lg text-white focus:outline-none focus:border-[#00d9ff]/50 disabled:opacity-50"
                    >
                      <option value="">No persona selected</option>
                      {personaOptions.map((persona) => (
                        <option key={persona.id} value={persona.id}>
                          {persona.name || 'Persona'}{getPersonaTriggerWord(persona) ? ` - ${getPersonaTriggerWord(persona)}` : ''}
                        </option>
                      ))}
                    </select>
                    <label className="flex items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm text-gray-200">
                      <input
                        type="checkbox"
                        checked={Boolean(session?.metadata?.identityLock)}
                        onChange={(event) => handleIdentityLockChange(event.target.checked)}
                        disabled={!session || isGeneratingScenes}
                        className="h-4 w-4"
                      />
                      Identity lock
                    </label>
                  </div>
                  <label className="mt-3 flex items-start gap-3 rounded-lg border border-fuchsia-400/20 bg-fuchsia-400/10 p-3 text-sm text-gray-200">
                    <input
                      type="checkbox"
                      checked={Boolean(session?.metadata?.strictFaceLock)}
                      onChange={(event) => handleStrictFaceLockChange(event.target.checked)}
                      disabled={!session || isGeneratingScenes || !canUseStrictFaceLock}
                      className="mt-1 h-4 w-4"
                    />
                    <span>
                      <span className="block font-medium text-fuchsia-100">Strict face lock</span>
                      <span className="mt-1 block text-xs text-gray-400">
                        Uses the existing Video Factory face-swap correction after each generated scene. Use only with a persona you own or have consent to use.
                      </span>
                    </span>
                  </label>
                  {!canUseStrictFaceLock && (
                    <p className="mt-2 text-xs text-gray-500">
                      Strict face lock needs face swap enabled and a selected persona image.
                    </p>
                  )}
                  {selectedPersona ? (
                    <div className="mt-3 flex items-center gap-3 rounded-lg border border-white/10 bg-black/30 p-3">
                      {getPersonaImageUrl(selectedPersona) ? (
                        <div
                          className="h-12 w-12 rounded-lg bg-cover bg-center border border-white/10"
                          style={{ backgroundImage: `url(${getPersonaImageUrl(selectedPersona)})` }}
                        />
                      ) : (
                        <div className="h-12 w-12 rounded-lg border border-white/10 bg-white/5" />
                      )}
                      <div>
                        <p className="text-sm text-white">{selectedPersona.name || 'Persona selected'}</p>
                        <p className="text-xs text-gray-500">
                          Trigger: {getPersonaTriggerWord(selectedPersona) || 'n/a'} · Model: {getPersonaModelId(selectedPersona) ? 'ready' : 'missing'}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <p className="mt-3 text-xs text-gray-500">
                      If no persona is selected, product/reference image locking is still used when AI Director provided a product visual.
                    </p>
                  )}
                </div>
                <div className="rounded-xl border border-white/10 bg-black/30 p-4">
                  <p className="text-sm font-medium text-white">Final ad length</p>
                  <p className="mt-1 text-xs text-gray-500">
                    Auto-Editor builds this from short reusable scenes instead of asking one model for a long unstable generation.
                  </p>
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    {CAMPAIGN_DURATIONS.map((durationOption) => {
                      const active = (session?.targetDurationSec || 30) === durationOption;
                      return (
                        <button
                          key={durationOption}
                          type="button"
                          onClick={() => handleCampaignDurationChange(durationOption)}
                          disabled={!session}
                          className={`rounded-lg border px-3 py-2 text-sm transition-colors disabled:opacity-50 ${
                            active
                              ? 'border-[#fbbf24]/60 bg-[#fbbf24]/15 text-[#fbbf24]'
                              : 'border-white/10 bg-white/5 text-gray-300 hover:bg-white/10'
                          }`}
                        >
                          {durationOption}s
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="rounded-xl border border-[#fbbf24]/20 bg-[#fbbf24]/5 p-4">
                  <label className="block text-sm font-medium text-white" htmlFor="caption-script-text">
                    Caption / Script Text
                  </label>
                  <p className="mt-1 text-xs text-gray-500">
                    This is not a chat box. This text becomes on-screen captions or dialogue cues in the final ad.
                  </p>
                  <textarea
                    id="caption-script-text"
                    value={session?.captionText || ''}
                    onChange={(event) => {
                      if (!session) return;
                      updateSession((current) => ({
                        ...current,
                        captionText: event.target.value,
                        updatedAt: new Date().toISOString(),
                      }));
                    }}
                    placeholder="Write the caption or voiceover script that should appear in the final ad..."
                    rows={4}
                    className="mt-3 w-full px-4 py-3 bg-black/40 border border-white/10 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-[#fbbf24]/50 resize-none"
                  />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <label className="block">
                    <span className="mb-2 block text-xs font-medium text-gray-400">Caption mode</span>
                    <select
                      value={session?.captionMode || 'segment-cues'}
                      onChange={(event) => {
                        if (!session) return;
                        updateSession((current) => ({
                          ...current,
                          captionMode: event.target.value as EditorSession['captionMode'],
                          updatedAt: new Date().toISOString(),
                        }));
                      }}
                      className="w-full px-4 py-3 bg-black/40 border border-white/10 rounded-lg text-white focus:outline-none focus:border-[#fbbf24]/50"
                    >
                      <option value="segment-cues">Split text across scenes</option>
                      <option value="full-script">Use as full script</option>
                      <option value="none">No captions</option>
                    </select>
                  </label>
                  <label className="block">
                    <span className="mb-2 block text-xs font-medium text-gray-400">Final call-to-action</span>
                    <input
                      value={session?.ctaPlan.text || ''}
                      onChange={(event) => {
                        if (!session) return;
                        updateSession((current) => ({
                          ...current,
                          ctaPlan: {
                            ...current.ctaPlan,
                            text: event.target.value,
                          },
                          updatedAt: new Date().toISOString(),
                        }));
                      }}
                      placeholder="Example: Shop Now, Get Your Quote, Install Now"
                      className="w-full px-4 py-3 bg-black/40 border border-white/10 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-[#fbbf24]/50"
                    />
                  </label>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="rounded-xl border border-white/10 bg-black/30 p-4">
                    <p className="text-sm text-white mb-3">Output Variants</p>
                    {OUTPUT_VARIANT_ORDER.map((aspectRatio) => {
                      const checked = Boolean(session?.outputVariants.some((variant) => variant.aspectRatio === aspectRatio));
                      return (
                        <label key={aspectRatio} className="flex items-center gap-3 text-sm text-gray-300 mb-2">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => handleOutputVariantToggle(aspectRatio)}
                            className="h-4 w-4"
                          />
                          {aspectRatio}
                        </label>
                      );
                    })}
                  </div>
                  <div className="rounded-xl border border-white/10 bg-black/30 p-4">
                    <p className="text-sm text-white mb-3">Brand Logo</p>
                    <input
                      ref={logoInputRef}
                      type="file"
                      accept="image/*"
                      onChange={(event) => handleLogoPick(event.target.files?.[0] || null)}
                      className="hidden"
                    />
                    <button
                      type="button"
                      onClick={() => logoInputRef.current?.click()}
                      disabled={!session}
                      className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-white hover:bg-white/10 disabled:opacity-50"
                    >
                      Upload / Replace Logo
                    </button>
                    {logoAsset && (
                      <p className="mt-3 text-xs text-gray-400">{logoAsset.label}</p>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handlePackaging}
                  disabled={isPackaging || isGeneratingScenes || !session}
                  className="interactive-element w-full px-6 py-3 bg-gradient-to-r from-[#fbbf24] to-[#f59e0b] text-black font-semibold rounded-xl transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {isPackaging ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      Building final ad...
                    </>
                  ) : (
                    <>
                      <BadgeCheck className="w-5 h-5" />
                      Step 2: Build Final Ad
                    </>
                  )}
                </button>
                {errorMessage && (
                  <div className="text-sm text-red-300 border border-red-500/30 bg-red-500/10 rounded-lg px-3 py-2">
                    {errorMessage}
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-6">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-[#fbbf24]">
                <Clapperboard className="h-4 w-4" />
                Scenes &amp; final ad
              </div>
              <div className="glass rounded-2xl p-8">
                <h2 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
                  <Clapperboard className="w-5 h-5 text-[#fbbf24]" />
                  Multi-Shot Ad Plan
                </h2>
                <button
                  type="button"
                  onClick={handleGenerateScenes}
                  disabled={!session?.shotPlan?.length || isGeneratingScenes || isPackaging}
                  className="mb-4 w-full rounded-xl border border-[#00d9ff]/30 bg-[#00d9ff]/10 px-4 py-3 text-sm font-semibold text-cyan-100 hover:bg-[#00d9ff]/15 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {isGeneratingScenes ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Generating chained scenes...
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4" />
                      Step 1: Generate Scene Videos
                    </>
                  )}
                </button>
                <p className="mb-4 text-xs text-gray-500">
                  {"Creates one short AI video per scene. Each new scene starts from the previous scene's last frame."}
                </p>
                {!session?.shotPlan?.length ? (
                  <p className="text-sm text-white/50">Choose a final ad length to generate a scene plan.</p>
                ) : (
                  <div className="space-y-3">
                    {session.shotPlan.map((shot, index) => (
                      <div key={shot.id} className="rounded-xl border border-white/10 bg-black/30 p-4">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-sm font-medium text-white">
                              {index + 1}. {shot.title}
                            </p>
                            <p className="mt-1 text-xs text-gray-400">
                              {shot.purpose} · needs {shot.assetRoleHint} · {shot.durationSec.toFixed(1)}s
                            </p>
                          </div>
                          <span className="rounded-full bg-white/5 px-2 py-1 text-xs text-cyan-200">
                            Scene {index + 1}
                          </span>
                        </div>
                        <label className="mt-3 block">
                          <span className="mb-2 block text-xs font-medium text-gray-400">
                            Scene prompt
                          </span>
                          <textarea
                            value={shot.promptHint}
                            onChange={(event) => handleShotPromptChange(shot.id, event.target.value)}
                            disabled={isGeneratingScenes}
                            rows={4}
                            placeholder="Write the exact prompt for this scene..."
                            className="w-full resize-none rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-[#00d9ff]/50 disabled:opacity-50"
                          />
                        </label>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="glass rounded-2xl p-8">
                <h2 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
                  <FileText className="w-5 h-5 text-[#fbbf24]" />
                  Planned Timeline
                </h2>
                {!session || !plannedTimeline ? (
                  <p className="text-sm text-white/50">A composition plan will appear once the editor session is ready.</p>
                ) : (
                  <div className="space-y-3">
                    {plannedTimeline.segments.map((segment) => {
                      const asset = session.assets.find((item) => item.id === segment.assetId);
                      return (
                        <div key={segment.id} className="rounded-xl border border-white/10 bg-black/30 p-4">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <p className="text-sm font-medium text-white">
                                {segment.sequence + 1}. {segment.purpose}
                              </p>
                              <p className="mt-1 text-xs text-gray-400">
                                {asset?.label || 'Asset'} · {segment.targetDurationSec.toFixed(1)}s
                              </p>
                            </div>
                            <span className="text-xs text-cyan-300">{segment.motion}</span>
                          </div>
                          {segment.overlayText && (
                            <p className="mt-3 text-xs text-gray-300">{segment.overlayText}</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="glass rounded-2xl p-8">
                <h2 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
                  <ImagePlus className="w-5 h-5 text-[#fbbf24]" />
                  Asset Library
                </h2>
                {!session || session.assets.length === 0 ? (
                  <p className="text-sm text-white/50">No assets loaded yet.</p>
                ) : (
                  <div className="space-y-3">
                    {session.assets.map((asset) => (
                      <div key={asset.id} className="rounded-xl border border-white/10 bg-black/30 p-4">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-sm font-medium text-white">{asset.label}</p>
                            <p className="mt-1 text-xs text-gray-400">
                              {asset.role} · {asset.kind}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleRemoveAsset(asset.id)}
                            className="rounded-full bg-white/10 p-2 text-gray-300 hover:bg-white/20"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="glass rounded-2xl p-8">
                <h2 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
                  <Video className="w-5 h-5 text-[#fbbf24]" />
                  Ready-to-Post Outputs
                </h2>
                <p className="mb-4 text-xs text-gray-500">
                  Each format includes a clean version without text overlays and a captioned version with captions and CTA.
                </p>
                {Object.keys(outputs).length === 0 ? (
                  <div className="w-full h-[420px] border-2 border-dashed border-white/20 rounded-xl flex items-center justify-center bg-black/30">
                    <div className="text-center text-gray-500">
                      <Video className="w-16 h-16 mx-auto mb-4 text-white/40" />
                      <p>Render a project to see composed ad outputs.</p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-6">
                    {Object.entries(outputs).map(([format, url]) => (
                      <div key={format} className="space-y-3">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm font-medium text-gray-200">{format}</p>
                          <a
                            href={url}
                            download
                            className="rounded-lg border border-white/10 bg-white/5 px-3 py-1 text-xs text-gray-300 hover:bg-white/10"
                          >
                            Download
                          </a>
                        </div>
                        <video src={url} controls className="w-full rounded-lg border border-white/10" />
                      </div>
                    ))}
                  </div>
                )}
                {renderedTimeline && (
                  <p className="mt-4 text-xs text-gray-400">
                    Rendered timeline: {renderedTimeline.segments.length} segments / {renderedTimeline.totalDurationSec.toFixed(1)}s
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
