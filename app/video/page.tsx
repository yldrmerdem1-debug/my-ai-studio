'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Sidebar from '@/components/Sidebar';
import AuroraBackground from '@/components/AuroraBackground';
import PricingModal from '@/components/PricingModal';
import { ImagePlus, Loader2, Plus, X, Video, Sparkles, CheckCircle2, ChevronDown, ChevronUp } from 'lucide-react';
import { usePersona } from '@/hooks/usePersona';
import VideoPlayerWithAudio from '@/components/VideoPlayerWithAudio';
import {
  VIDEO_ENGINES_CONFIG,
  VIDEO_QUALITY_PRESET_LABELS,
  supportsDirectVideoPolling,
  type VideoEngineKey,
  type VideoQualityPreset,
} from '@/lib/constants';
import { isPublicFaceSwapEnabled } from '@/lib/feature-flags';
import { isPremiumUser } from '@/lib/subscription';
import { usePersonaOptions, type PersonaOption } from '@/hooks/usePersonaOptions';
import { fileToDataUrl } from '@/lib/client/file-data-url';
import { useVideoGenerationPolling } from '@/app/video/_hooks/useVideoGenerationPolling';
import {
  AUTO_EDITOR_SESSION_KEY,
  createDefaultShotPlan,
  createEditorSessionFromVideo,
  createEditorSessionFromDirectorPlan,
  createOutputVariants,
  type EditorCampaignDuration,
  type EditorSession,
  type DirectorStoredPayload,
} from '@/lib/ad-director';

type RunwayModel =
  | 'gen4.5'
  | 'gen4_turbo'
  | 'gen3a_turbo'
  | 'veo3.1'
  | 'veo3.1_fast'
  | 'veo3';

type SelectedAssets = {
  selectedPersona: PersonaOption | null;
  imageFile: File | null;
  imagePreview: string | null;
};

const getPersonaImageUrl = (persona: PersonaOption | null) =>
  persona?.image_url || persona?.imageUrl || '';

const comparableUrlPath = (value?: string | null) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    return `${parsed.hostname}${parsed.pathname}`;
  } catch {
    return raw.split('?')[0];
  }
};

const getPersonaModelId = (persona: PersonaOption | null) =>
  persona?.model_id || persona?.modelId || persona?.training_id || persona?.trainingId || '';

const getPersonaTriggerWord = (persona: PersonaOption | null) =>
  persona?.trigger_word || persona?.triggerWord || '';

type VideoEngineItem = {
  id: VideoEngineKey;
  name: string;
  hint?: string;
  accent: string;
  tile: string;
};

const VIDEO_ENGINE_ITEMS: VideoEngineItem[] = [
  { id: 'grok', name: 'Standard', hint: 'Grok · hızlı', accent: 'border-blue-500/40 bg-blue-500/10 text-blue-100', tile: 'from-slate-600 to-slate-900' },
  { id: 'seedance_2_0', name: 'Seedance 2.0', hint: 'Sesli + sinematik hareket', accent: 'border-cyan-500/40 bg-cyan-500/10 text-cyan-100', tile: 'from-cyan-400 to-blue-600' },
  { id: 'veo', name: 'Premium · Veo 3.1', hint: 'Reklam yedeği', accent: 'border-purple-500/40 bg-purple-500/10 text-purple-100', tile: 'from-fuchsia-500 to-indigo-600' },
  { id: 'runway', name: 'Ultra Premium · Runway', hint: 'Ürün reklamları', accent: 'border-amber-500/40 bg-amber-500/10 text-amber-100', tile: 'from-amber-400 to-orange-600' },
  { id: 'kling_3_pro', name: 'Kling 3.0 Pro', hint: 'Ürün reklamları', accent: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-100', tile: 'from-emerald-400 to-teal-600' },
  { id: 'kling_turbo', name: 'ProTurbo', hint: 'Kling 2.5 Turbo Pro', accent: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-100', tile: 'from-lime-400 to-emerald-600' },
  { id: 'kling_2_6', name: 'Kling 2.6', hint: 'Ürün reklamları', accent: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-100', tile: 'from-teal-400 to-emerald-700' },
  { id: 'kling_avatar_v2', name: 'Kling Avatar v2', hint: 'Dudak senkronu', accent: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-100', tile: 'from-green-400 to-emerald-700' },
];

function EngineGlyph({ id }: { id: VideoEngineKey }) {
  const cls = 'h-4 w-4';
  switch (id) {
    case 'grok':
      return (
        <svg viewBox="0 0 24 24" className={cls} fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round">
          <path d="M5 4l14 16M19 4L5 20" />
        </svg>
      );
    case 'seedance_2_0':
      return (
        <svg viewBox="0 0 24 24" className={cls} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
          <path d="M3 12h2M7 7v10M11 3v18M15 7v10M19 10v4M21 12h0" />
        </svg>
      );
    case 'veo':
      return (
        <svg viewBox="0 0 24 24" className={cls} fill="currentColor">
          <path d="M12 2c.7 5 2.3 6.6 7.3 7.3-5 .7-6.6 2.3-7.3 7.3-.7-5-2.3-6.6-7.3-7.3C9.7 8.6 11.3 7 12 2z" />
        </svg>
      );
    case 'runway':
      return (
        <svg viewBox="0 0 24 24" className={cls} fill="currentColor">
          <path d="M8 5.5v13l11-6.5z" />
        </svg>
      );
    case 'kling_turbo':
      return (
        <svg viewBox="0 0 24 24" className={cls} fill="currentColor">
          <path d="M13 2L4 14h6l-1 8 9-12h-6z" />
        </svg>
      );
    case 'kling_avatar_v2':
      return (
        <svg viewBox="0 0 24 24" className={cls} fill="none" stroke="currentColor" strokeWidth={2}>
          <circle cx="12" cy="8" r="3.2" />
          <path d="M5 20c1.5-3.6 4-5.2 7-5.2s5.5 1.6 7 5.2" />
        </svg>
      );
    case 'kling_2_6':
      return (
        <svg viewBox="0 0 24 24" className={cls} fill="none" stroke="currentColor" strokeWidth={2}>
          <rect x="4" y="5" width="16" height="14" rx="2" />
          <path d="M9 5v14M15 5v14" />
        </svg>
      );
    case 'kling_3_pro':
    default:
      return (
        <svg viewBox="0 0 24 24" className={cls} fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
          <path d="M7 4v16M7 12l8-8M9 12l8 8" />
        </svg>
      );
  }
}

export default function VideoPage() {
  const { user } = usePersona();
  const [isPricingModalOpen, setIsPricingModalOpen] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [selectedEngine, setSelectedEngine] = useState<
    VideoEngineKey
  >('grok');
  const [selectedQuality, setSelectedQuality] = useState<VideoQualityPreset>(VIDEO_ENGINES_CONFIG.grok.defaultQuality);
  const [runwayModel, setRunwayModel] = useState<RunwayModel>('gen4.5');
  const [settingsTab, setSettingsTab] = useState<'engine' | 'format' | 'persona'>('engine');
  const [durationSec, setDurationSec] = useState<number>(VIDEO_ENGINES_CONFIG.grok.defaultDuration);
  const [generationMode, setGenerationMode] = useState<'single' | 'long-ad'>('single');
  const [longAdDuration, setLongAdDuration] = useState<EditorCampaignDuration>(30);
  const { personaOptions } = usePersonaOptions(user);
  const [isGenerating, setIsGenerating] = useState(false);
  const [hasGenerated, setHasGenerated] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [audioMerged, setAudioMerged] = useState(false);
  const [generatedImageUrl, setGeneratedImageUrl] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState('Analyzing Prompt...');
  const [errorMessage, setErrorMessage] = useState('');
  const [pendingVideoId, setPendingVideoId] = useState<string | null>(null);
  const [uploadedImageUrl, setUploadedImageUrl] = useState<string | null>(null);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [directorPlan, setDirectorPlan] = useState<DirectorStoredPayload | null>(null);
  const [selected, setSelected] = useState<SelectedAssets>({
    selectedPersona: null,
    imageFile: null,
    imagePreview: null,
  });
  const selectedIdRef = useRef<string | null>(null);
  const directorPlanAppliedRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const generationRunRef = useRef(0);
  const pendingRunIdRef = useRef(0);
  
  // Face swap states
  const [enableFaceSwap, setEnableFaceSwap] = useState(false);
  const [faceSwapConsent, setFaceSwapConsent] = useState(false);
  const [actorPhotos, setActorPhotos] = useState<Record<string, File | null>>({});
  const [actorPhotoUrls, setActorPhotoUrls] = useState<Record<string, string>>({});
  const [characterPersonas, setCharacterPersonas] = useState<Record<string, PersonaOption | null>>({});
  const [isFaceSwapping, setIsFaceSwapping] = useState(false);
  const [faceSwapSuccess, setFaceSwapSuccess] = useState(false);
  const [, setFaceSwapError] = useState('');
  const [detectedCharacters, setDetectedCharacters] = useState<string[]>([]);
  const [lastGenerationParams, setLastGenerationParams] = useState<any>(null);
  const [originalVideoUrl, setOriginalVideoUrl] = useState<string | null>(null);
  const [activeVideoTab, setActiveVideoTab] = useState<'original' | 'swapped'>('swapped');
  
  const faceSwapUiEnabled = isPublicFaceSwapEnabled();
  const faceSwapAllowedForUser = faceSwapUiEnabled && isPremiumUser(user);

  // Settings accordion states
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    engine: true, // Video Motoru açık
    faceSwap: false,
    visualPersona: false,
    uploadImage: false,
  });
  
  const toggleSection = (section: string) => {
    setOpenSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  useEffect(() => {
    const cfg = VIDEO_ENGINES_CONFIG[selectedEngine];
    if (cfg.mode === 'auto' || cfg.supportedDurations.length === 0) {
      setDurationSec(0);
    } else if (!cfg.supportedDurations.includes(durationSec)) {
      setDurationSec(cfg.defaultDuration);
    }
    if (!cfg.supportedQualities.includes(selectedQuality)) {
      setSelectedQuality(cfg.defaultQuality);
    }
  }, [selectedEngine, durationSec, selectedQuality]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const raw = localStorage.getItem('adDirectorPlan');
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as DirectorStoredPayload;
      const plan = parsed?.scenario?.plan;
      if (plan?.visual_prompt) {
        setPrompt(plan.visual_prompt);
      }
      setDirectorPlan(parsed);
    } catch (error) {
      console.warn('Failed to parse director plan from storage', error);
    }
  }, []);

  useEffect(() => {
    if (!directorPlan || directorPlanAppliedRef.current) return;

    const nextEngine = directorPlan.recommendations?.recommendedEngine;
    const nextQuality = directorPlan.recommendations?.recommendedQuality;
    const nextDuration = directorPlan.recommendations?.recommendedDuration;
    const nextReferenceImageUrl =
      directorPlan.recommendations?.referenceImageUrl
      || directorPlan.inputs?.productImageUrl
      || directorPlan.sourceContext?.resolvedProductImageUrl
      || '';
    const nextPersonaId = directorPlan.inputs?.persona?.id;

    if (nextEngine) {
      setSelectedEngine(nextEngine);
    }
    if (nextQuality) {
      setSelectedQuality(nextQuality);
    }
    if (typeof nextDuration === 'number') {
      setDurationSec(nextDuration);
    }
    if (nextReferenceImageUrl) {
      setUploadedImageUrl(nextReferenceImageUrl);
    }
    if (nextPersonaId) {
      const matchedPersona = personaOptions.find(option => option.id === nextPersonaId);
      if (!matchedPersona) {
        return;
      }
      selectedIdRef.current = matchedPersona.id;
      setSelected(prev => ({
        ...prev,
        selectedPersona: matchedPersona,
      }));
    }

    directorPlanAppliedRef.current = true;
  }, [directorPlan, personaOptions]);

  useEffect(() => {
    if (typeof window === 'undefined' || !videoUrl) return;
    localStorage.setItem('latestRawVideoUrl', videoUrl);
    import('@/lib/assets-storage')
      .then(({ saveVideoAsset }) => {
        saveVideoAsset(videoUrl, `AI Video - ${new Date().toLocaleDateString()}`, {
          model: selectedEngine,
          prompt,
          quality: selectedQuality,
          personaId: selected.selectedPersona?.id || selected.selectedPersona?.modelId || undefined,
        });
      })
      .catch((error) => console.warn('Failed to save video asset', error));
    const editorSession = createEditorSessionFromVideo({
      captionText: directorPlan?.scenario?.plan?.audio_script || '',
      directorPlan,
      personaName: selected.selectedPersona?.name || undefined,
      prompt,
      rawVideoUrl: videoUrl,
      referenceImageUrl: uploadedImageUrl || undefined,
      selectedEngine,
      selectedQuality,
    });
    localStorage.setItem(AUTO_EDITOR_SESSION_KEY, JSON.stringify(editorSession));
  }, [
    directorPlan,
    prompt,
    selected.selectedPersona?.name,
    selectedEngine,
    selectedQuality,
    uploadedImageUrl,
    videoUrl,
  ]);

    const handleSelectPersona = (persona: any) => {
      const clickedId = persona?.id || persona?.modelId || persona?.model_id || persona?._id;
      if (!clickedId) {
        console.error('❌ CRITICAL: Clicked card has no ID!', persona);
        alert('Hata: Bu kartın kimlik bilgisi (ID) eksik.');
        return;
      }
      console.log('🟢 CLICK VALIDATED. Saving ID:', clickedId);
      selectedIdRef.current = clickedId;
      setSelected(prev => ({
        ...prev,
        selectedPersona: persona,
      }));
      setIsMenuOpen(false);
    };

  const handleImagePick = (file: File | null) => {
    if (!file) return;
    const preview = URL.createObjectURL(file);
    setSelected(prev => ({
      ...prev,
      imageFile: file,
      imagePreview: preview,
    }));
    setUploadedImageUrl(null);
    setIsUploadingImage(true);
    setIsMenuOpen(false);
    const runUpload = async () => {
      try {
        const dataUrl = await fileToDataUrl(file);
        const response = await fetch('/api/upload-image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dataUrl, userId: user?.id }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data.error || data.details || 'Failed to upload image');
        }
        if (!data.publicUrl || typeof data.publicUrl !== 'string') {
          throw new Error('Upload succeeded but no public URL was returned');
        }
        setUploadedImageUrl(data.publicUrl);
      } catch (error: any) {
        setErrorMessage(error?.message || 'Failed to upload image');
      } finally {
        setIsUploadingImage(false);
      }
    };
    runUpload();
  };

  // Auto-style is now handled server-side using optional image input.

  const removeChip = (key: keyof SelectedAssets) => {
    setSelected(prev => {
      if (key === 'imageFile' || key === 'imagePreview') {
        if (prev.imagePreview) URL.revokeObjectURL(prev.imagePreview);
        setUploadedImageUrl(null);
        setIsUploadingImage(false);
        return { ...prev, imageFile: null, imagePreview: null };
      }
      if (key === 'selectedPersona') {
        return { ...prev, selectedPersona: null };
      }
      return prev;
    });
  };

  const fetchWithTimeout = async (input: RequestInfo, init?: RequestInit, timeoutMs = 300000) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(input, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timeoutId);
    }
  };
  const pollingActions = useMemo(() => ({
    setStatusMessage,
    setVideoUrl,
    setHasGenerated,
    setAudioMerged,
    setIsGenerating,
    setPendingVideoId,
    setOriginalVideoUrl,
    setFaceSwapSuccess,
    setFaceSwapError,
    setGeneratedImageUrl,
    setErrorMessage,
    setActiveVideoTab,
  }), []);
  const hasVideoReady = Boolean(videoUrl?.trim());
  const showGeneratingPanel = isGenerating && !hasVideoReady;
  const showVideoPanel = hasVideoReady;
  const usesDirectVideoPolling = supportsDirectVideoPolling(selectedEngine);

  const createLongAdSession = (params: {
    persona: PersonaOption | null;
    promptText: string;
  }): EditorSession => {
    const persona = params.persona;
    const baseSession: EditorSession = directorPlan
      ? createEditorSessionFromDirectorPlan(directorPlan)
      : (() => {
          const now = new Date().toISOString();
          return {
            assets: [],
            captionMode: 'segment-cues' as const,
            captionText: '',
            createdAt: now,
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
              source: 'manual' as const,
              text: params.promptText,
            },
            id: `video-factory-long-ad-${Date.now()}`,
            notes: [],
            outputVariants: createOutputVariants(['9:16']),
            shotPlan: createDefaultShotPlan({
              durationSec: longAdDuration,
              hookText: params.promptText,
              visualPrompt: params.promptText,
            }),
            targetDurationSec: longAdDuration,
            timelineStrategy: 'hook-first' as const,
            title: 'Video Factory Long Ad',
            updatedAt: now,
          } satisfies EditorSession;
        })();

    return {
      ...baseSession,
      captionText: baseSession.captionText || directorPlan?.scenario?.plan?.audio_script || '',
      metadata: {
        ...(baseSession.metadata || {}),
        engine: selectedEngine,
        identityLock: Boolean(persona || uploadedImageUrl || directorPlan?.recommendations?.referenceImageUrl),
        personaId: persona?.id,
        personaImageUrl: getPersonaImageUrl(persona) || undefined,
        personaModelId: getPersonaModelId(persona) || undefined,
        personaName: persona?.name,
        quality: selectedQuality,
        referenceImageUrl:
          uploadedImageUrl
          || directorPlan?.recommendations?.referenceImageUrl
          || directorPlan?.sourceContext?.resolvedProductImageUrl
          || undefined,
        strictProductLock: Boolean(
          uploadedImageUrl
          || directorPlan?.recommendations?.referenceImageUrl
          || directorPlan?.sourceContext?.resolvedProductImageUrl
        ),
        triggerWord: getPersonaTriggerWord(persona) || undefined,
      },
      outputVariants: createOutputVariants(['9:16']),
      shotPlan: createDefaultShotPlan({
        ctaText: baseSession.ctaPlan.text,
        durationSec: longAdDuration,
        hookText: baseSession.hookPlan.text || params.promptText,
        productTitle: baseSession.metadata?.productTitle || baseSession.title,
        strategy: baseSession.timelineStrategy,
        visualPrompt: directorPlan?.scenario?.plan?.visual_prompt || params.promptText,
      }),
      targetDurationSec: longAdDuration,
      updatedAt: new Date().toISOString(),
    };
  };

  const handleGenerateLongAd = async (promptText: string, persona: PersonaOption | null) => {
    if (!user?.id) {
      throw new Error('User authentication required before generating a long ad.');
    }
    const session = createLongAdSession({ persona, promptText });
    setStatusMessage(`Generating ${longAdDuration}s multi-shot scenes...`);
    const scenesResponse = await fetchWithTimeout('/api/auto-editor/generate-scenes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        engine: selectedEngine,
        qualityPreset: selectedQuality,
        session,
        userId: user.id,
      }),
    }, 900000);
    const scenesData = await scenesResponse.json().catch(() => ({}));
    if (!scenesResponse.ok) {
      throw new Error(scenesData.error || scenesData.details || 'Failed to generate long ad scenes');
    }
    if (!scenesData.session) {
      throw new Error('Scene generation finished but did not return an editor session');
    }

    setStatusMessage('Composing final long ad...');
    const composeResponse = await fetchWithTimeout('/api/auto-editor', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session: scenesData.session }),
    }, 900000);
    const composeData = await composeResponse.json().catch(() => ({}));
    if (!composeResponse.ok) {
      throw new Error(composeData.error || composeData.details || 'Failed to compose long ad');
    }
    const outputs = composeData.outputs || {};
    const finalUrl =
      outputs['9:16 - Clean / No Text']
      || outputs['9:16 - With Captions & CTA']
      || outputs['16:9 - Clean / No Text']
      || outputs['16:9 - With Captions & CTA']
      || outputs['9:16']
      || outputs['16:9']
      || Object.values(outputs)[0];
    if (!finalUrl || typeof finalUrl !== 'string') {
      throw new Error('Long ad render finished but no output URL was returned');
    }
    if (typeof window !== 'undefined') {
      localStorage.setItem(AUTO_EDITOR_SESSION_KEY, JSON.stringify(composeData.session || scenesData.session));
      localStorage.setItem('latestRawVideoUrl', finalUrl);
    }
    setVideoUrl(finalUrl);
    setAudioMerged(false);
    setGeneratedImageUrl(uploadedImageUrl);
    setHasGenerated(true);
  };

  useVideoGenerationPolling({
    pendingVideoId,
    generationRunRef,
    pendingRunIdRef,
    actions: pollingActions,
  });

  const handleGenerate = async (e?: React.MouseEvent<HTMLButtonElement>) => {
    if (e) e.preventDefault();
    if (!prompt.trim() || isGenerating) return;
    const targetId = selectedIdRef.current || selected.selectedPersona?.id;
    const exactPersona = personaOptions.find(option => option.id === targetId);
    const finalModelId = (exactPersona as any)?.model_id
      || (exactPersona as any)?.modelId
      || (exactPersona as any)?.training_id
      || (exactPersona as any)?.trainingId
      || (exactPersona as any)?.replicate_model_id;
    const finalImageUrl = exactPersona?.image_url
      || exactPersona?.imageUrl
      || '';
    const finalDestinationModel = (exactPersona as any)?.destination_model
      || (exactPersona as any)?.destinationModel
      || '';
    const finalModelFamily = (exactPersona as any)?.model_family
      || (exactPersona as any)?.modelFamily
      || '';
    const finalTrainingBaseModel = (exactPersona as any)?.training_base_model
      || (exactPersona as any)?.trainingBaseModel
      || '';
    const explicitReferenceForRequest =
      uploadedImageUrl
      && comparableUrlPath(uploadedImageUrl) !== comparableUrlPath(finalImageUrl)
        ? uploadedImageUrl
        : undefined;
    const finalTrigger = exactPersona
      ? (exactPersona as any)?.trigger_word
        || (exactPersona as any)?.triggerWord
      : undefined;
    if (targetId && (!exactPersona || !finalModelId)) {
      alert(`⚠️ HATA: Model ID Eksik!\nID: ${targetId}\nDurum: ${exactPersona ? 'Bulundu' : 'Yok'}`);
      return;
    }
    if (selected.imageFile && (isUploadingImage || !uploadedImageUrl)) {
      alert('Please wait for image upload to finish.');
      return;
    }
    const currentRun = generationRunRef.current + 1;
    generationRunRef.current = currentRun;

    setErrorMessage('');
    setIsGenerating(true);
    setHasGenerated(false);
    setVideoUrl(null);
    setAudioMerged(false);
    setGeneratedImageUrl(null);
    setPendingVideoId(null);
    setIsMenuOpen(false);

    const resolvedTriggerWord = finalTrigger || 'img';
    const resolvedPrompt = exactPersona
      ? `${resolvedTriggerWord} ${prompt.trim()}`.trim()
      : prompt.trim();
    let handedOffToPolling = false;
    try {
      if (generationMode === 'long-ad') {
        await handleGenerateLongAd(resolvedPrompt, exactPersona || null);
        return;
      }
      setStatusMessage('Generating video + voice...');
      const videoResponse = await fetchWithTimeout('/api/generate-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: resolvedPrompt,
          ...(durationSec > 0 ? { duration: durationSec } : {}),
          referenceImageUrl: explicitReferenceForRequest,
          hasUserReferenceImage: Boolean(explicitReferenceForRequest),
          referenceImageSource: explicitReferenceForRequest ? 'user-upload' : undefined,
          personaImageUrl: finalImageUrl,
          personaUrl: finalImageUrl,
          personaModelId: finalModelId,
          personaTriggerWord: finalTrigger,
          destinationModel: finalDestinationModel || undefined,
          modelFamily: finalModelFamily || undefined,
          trainingBaseModel: finalTrainingBaseModel || undefined,
          persona: exactPersona,
          isTextOnly: true,
          personaMode: exactPersona ? 'persona' : 'generic',
          personaId: exactPersona?.id,
          id: exactPersona?.id,
          modelId: finalModelId,
          model_id: finalModelId,
          triggerWord: exactPersona ? resolvedTriggerWord : undefined,
          trigger_word: exactPersona ? resolvedTriggerWord : undefined,
          engine: selectedEngine,
          qualityPreset: selectedQuality,
          runwayModel: selectedEngine === 'runway' ? runwayModel : undefined,
          // Face swap gated by public flag + premium + explicit consent
          enableFaceSwap: faceSwapAllowedForUser && enableFaceSwap && faceSwapConsent && Object.keys(actorPhotoUrls).length > 0,
          faceSwapConsent: faceSwapAllowedForUser && enableFaceSwap ? faceSwapConsent : undefined,
          actorPhotos: faceSwapAllowedForUser && enableFaceSwap && faceSwapConsent && Object.keys(actorPhotoUrls).length > 0 ? Object.fromEntries(
            Object.entries(actorPhotoUrls).map(([char, url]) => [char, url])
          ) : undefined,
          detectedCharacters: faceSwapAllowedForUser && enableFaceSwap && faceSwapConsent && Object.keys(actorPhotoUrls).length > 0 ? detectedCharacters : undefined,
          user,
          async: !usesDirectVideoPolling,
        }),
      });
      const videoData = await videoResponse.json().catch(() => ({}));
      if (!videoResponse.ok) {
        throw new Error(videoData.error || videoData.details || 'Failed to start video generation');
      }
      if (videoData.imageUrl && generationRunRef.current === currentRun) {
        setGeneratedImageUrl(videoData.imageUrl);
        setStatusMessage('Persona görseli hazır, video motoruna gönderildi...');
      }
      let rawVideoUrl = videoData.videoUrl as string | undefined;
      if (!rawVideoUrl) {
        if (!videoData.videoId) {
          throw new Error('Video generation did not return an ID');
        }
        handedOffToPolling = true;
        pendingRunIdRef.current = currentRun;
        setPendingVideoId(String(videoData.videoId));
        // Keep spinner on; status polling effect will resolve.
        return;
      }
      if (!rawVideoUrl || generationRunRef.current !== currentRun) return;

      // Backend already applies face swap if enableFaceSwap && actorPhotos are provided
      // Use the response from backend directly
      const finalVideoUrl = rawVideoUrl;
      const faceSwapped = Boolean(videoData.faceSwapped);
      const originalVideoUrlFromBackend = videoData.originalVideoUrl;
      const faceSwapErrorFromBackend = videoData.faceSwapError;
      
      // Set face swap states based on backend response
      if (faceSwapped && originalVideoUrlFromBackend) {
        setOriginalVideoUrl(originalVideoUrlFromBackend);
        setFaceSwapSuccess(true);
        setTimeout(() => setFaceSwapSuccess(false), 3000);
      } else if (enableFaceSwap && Object.keys(actorPhotoUrls).length > 0) {
        if (!faceSwapped) {
          // Face swap was requested but backend didn't apply it
          if (faceSwapErrorFromBackend) {
            console.warn('⚠️ Face swap failed:', faceSwapErrorFromBackend);
          } else {
            console.warn('⚠️ Face swap was requested but not applied by backend');
          }
        }
      }
      
      setErrorMessage('');
      setVideoUrl(finalVideoUrl);
      setAudioMerged(Boolean(videoData.audioMerged));
      setHasGenerated(true);
      setIsGenerating(false);
      setActiveVideoTab('swapped');
      
      // Store generation params for face swap
      setLastGenerationParams({
        exactPersona,
        prompt: resolvedPrompt,
        referenceImageUrl: explicitReferenceForRequest,
        personaImageUrl: finalImageUrl,
        personaUrl: finalImageUrl,
        personaModelId: finalModelId,
        personaTriggerWord: finalTrigger,
        destinationModel: finalDestinationModel || undefined,
        modelFamily: finalModelFamily || undefined,
        trainingBaseModel: finalTrainingBaseModel || undefined,
        persona: exactPersona,
        isTextOnly: true,
        personaMode: exactPersona ? 'persona' : 'generic',
        personaId: exactPersona?.id,
        id: exactPersona?.id,
        modelId: finalModelId,
        model_id: finalModelId,
        triggerWord: exactPersona ? resolvedTriggerWord : undefined,
        trigger_word: exactPersona ? resolvedTriggerWord : undefined,
        qualityPreset: selectedQuality,
        user,
      });
      
      if (typeof window !== 'undefined') {
        localStorage.setItem('latestRawVideoUrl', finalVideoUrl);
      }
    } catch (error: any) {
      if (generationRunRef.current !== currentRun) return;
      setErrorMessage(error.message || 'Failed to generate video');
    } finally {
      if (generationRunRef.current === currentRun && !handedOffToPolling) {
        setIsGenerating(false);
      }
    }
  };

  // Fallback character detection (simple keyword matching) - defined first
  const detectCharactersFallback = useCallback((text: string): string[] => {
    const lowerText = text.toLowerCase();
    const characters: string[] = [];
    
    // DC Characters
    const dcChars = ['superman', 'batman', 'wonder woman', 'aquaman', 'flash', 'cyborg', 'green lantern', 'shazam', 'black adam', 'harley quinn', 'joker', 'darkseid', 'zod', 'doomsday', 'lex luthor'];
    // Marvel Characters
    const marvelChars = ['thor', 'iron man', 'captain america', 'hulk', 'spider-man', 'wolverine', 'deadpool', 'black panther', 'doctor strange', 'thanos', 'loki', 'black widow'];
    
    const allChars = [...dcChars, ...marvelChars];
    
    for (const char of allChars) {
      if (lowerText.includes(char)) {
        const formatted = char.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
        if (!characters.includes(formatted)) {
          characters.push(formatted);
        }
      }
    }
    
    // Check for "vs" pattern
    const vsMatch = text.match(/(\w+)\s+vs\s+(\w+)/i);
    if (vsMatch) {
      const char1 = vsMatch[1].charAt(0).toUpperCase() + vsMatch[1].slice(1).toLowerCase();
      const char2 = vsMatch[2].charAt(0).toUpperCase() + vsMatch[2].slice(1).toLowerCase();
      if (!characters.includes(char1)) characters.push(char1);
      if (!characters.includes(char2)) characters.push(char2);
    }
    
    return characters;
  }, []);

  // Character detection function with Gemini
  const detectCharacters = useCallback(async (text: string): Promise<string[]> => {
    if (!text.trim()) return [];
    
    try {
      const response = await fetch('/api/detect-characters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: text }),
      });
      
      const data = await response.json();
      if (response.ok && Array.isArray(data.characters)) {
        return data.characters;
      }
      
      // Fallback to simple detection if API fails
      return detectCharactersFallback(text);
    } catch (error) {
      console.error('Character detection error:', error);
      // Fallback to simple detection
      return detectCharactersFallback(text);
    }
  }, [detectCharactersFallback]);


  // Auto-detect characters when prompt changes and face swap is enabled
  useEffect(() => {
    if (enableFaceSwap && prompt.trim()) {
      detectCharacters(prompt).then(chars => {
        setDetectedCharacters(chars);
      });
    }
  }, [prompt, enableFaceSwap, detectCharacters]);

  const isPersonaReady = (option: PersonaOption) =>
    option.status === 'completed' || option.visualStatus === 'ready';
  const succeededPersonas = personaOptions.filter(isPersonaReady);
  const trainingPersonas = personaOptions.filter(option =>
    (option.status === 'training' || option.visualStatus === 'training') && !isPersonaReady(option)
  );

  return (
    <div className="min-h-screen bg-black text-white relative">
      <AuroraBackground />
      <Sidebar onSubscriptionClick={() => setIsPricingModalOpen(true)} />
      <main className="ml-64 px-6 py-10 relative z-10">
        {/* Background ambient glow when generating */}
        {showGeneratingPanel && (
          <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden">
            <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-[100px] animate-pulse"></div>
            <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-500/10 rounded-full blur-[100px] animate-[pulse_3s_ease-in-out_infinite]"></div>
          </div>
        )}
        <div className="mx-auto max-w-4xl relative z-10">
          <header className="text-center mb-10">
            <h1 className="text-4xl font-bold">AI Video Factory</h1>
            <p className="text-gray-400 mt-3">
              Executes your director plan into a raw, high-quality talking video.
            </p>
          </header>

          <section className="relative">
            {directorPlan?.scenario?.plan && (
              <div className="mb-6 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-100">
                <div className="flex items-center gap-2 font-semibold">
                  <CheckCircle2 className="h-4 w-4" />
                  AI Director plan loaded
                </div>
                <p className="mt-2 text-xs text-emerald-200/80">
                  Prompt is pre-filled, and recommended engine settings were applied when possible.
                </p>
                {directorPlan.recommendations && (
                  <p className="mt-2 text-xs text-emerald-200/80">
                    {directorPlan.recommendations.recommendedEngine} / {directorPlan.recommendations.recommendedDuration || 'auto'}s / {directorPlan.recommendations.recommendedQuality}
                  </p>
                )}
              </div>
            )}
            <div className="mb-4 flex flex-wrap gap-2">
              {selected.selectedPersona && (
                <span className="inline-flex items-center gap-2 rounded-full bg-blue-500/20 px-3 py-1 text-sm text-blue-200">
                  👤 {selected.selectedPersona.name ?? 'Persona'}
                  <button
                    type="button"
                    onClick={() => removeChip('selectedPersona')}
                    className="rounded-full bg-blue-500/30 p-1 hover:bg-blue-500/40"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              )}
              {selected.imageFile && (
                <span className="inline-flex items-center gap-2 rounded-full bg-emerald-500/20 px-3 py-1 text-sm text-emerald-200">
                  🖼️ {selected.imageFile.name}
              {isUploadingImage && (
                <span className="text-xs text-emerald-100/70">Uploading…</span>
              )}
                  <button
                    type="button"
                    onClick={() => removeChip('imageFile')}
                    className="rounded-full bg-emerald-500/30 p-1 hover:bg-emerald-500/40"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              )}
            </div>
            {errorMessage && (
              <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                {errorMessage}
              </div>
            )}
            {!isGenerating && !hasGenerated && (
              <div className="mb-4 rounded-2xl border border-white/10 bg-white/5 p-4">
                <p className="text-sm font-semibold text-white">Generation mode</p>
                <p className="mt-1 text-xs text-gray-500">
                  Single clip uses the selected Video Factory engine directly. Long ad creates multiple short scenes, chains last-frame references, then composes the final video.
                </p>
                <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => setGenerationMode('single')}
                    className={`rounded-xl border p-3 text-left transition-colors ${
                      generationMode === 'single'
                        ? 'border-[#00d9ff]/60 bg-[#00d9ff]/10 text-cyan-100'
                        : 'border-white/10 bg-black/30 text-gray-300 hover:bg-white/10'
                    }`}
                  >
                    <span className="block text-sm font-semibold">Single clip</span>
                    <span className="mt-1 block text-xs text-gray-500">One short generated video.</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setGenerationMode('long-ad')}
                    className={`rounded-xl border p-3 text-left transition-colors ${
                      generationMode === 'long-ad'
                        ? 'border-[#fbbf24]/60 bg-[#fbbf24]/10 text-yellow-100'
                        : 'border-white/10 bg-black/30 text-gray-300 hover:bg-white/10'
                    }`}
                  >
                    <span className="block text-sm font-semibold">Long ad</span>
                    <span className="mt-1 block text-xs text-gray-500">30-60s multi-shot ad from chained scenes.</span>
                  </button>
                </div>
                {generationMode === 'long-ad' && (
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    {[30, 60].map((durationOption) => (
                      <button
                        key={durationOption}
                        type="button"
                        onClick={() => setLongAdDuration(durationOption as EditorCampaignDuration)}
                        className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                          longAdDuration === durationOption
                            ? 'border-[#fbbf24]/60 bg-[#fbbf24]/15 text-[#fbbf24]'
                            : 'border-white/10 bg-black/30 text-gray-300 hover:bg-white/10'
                        }`}
                      >
                        {durationOption}s final ad
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <div className="relative rounded-2xl border border-white/10 bg-white/5 p-4 shadow-[0_0_0_1px_rgba(255,255,255,0.05)] focus-within:border-white/20 focus-within:ring-2 focus-within:ring-[#7c3aed]/40 focus-within:shadow-[0_0_45px_rgba(124,58,237,0.25),0_0_90px_rgba(59,130,246,0.18)]">
              {!isGenerating && !hasGenerated && (
                <button
                  type="button"
                  onClick={() => setIsMenuOpen(prev => !prev)}
                  className="absolute left-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
                >
                  <Plus className="h-5 w-5" />
                </button>
              )}

              {!isGenerating && !hasGenerated && (
                <>
                  <textarea
                    value={prompt}
                    onChange={(event) => setPrompt(event.target.value)}
                    placeholder="Describe your video idea..."
                    rows={5}
                    className="w-full resize-none bg-transparent pl-16 pr-4 text-base text-white outline-none placeholder:text-gray-500"
                  />

                  <div className="mt-4 flex justify-end">
                    <button
                      type="button"
                      onClick={handleGenerate}
                      disabled={
                        prompt.trim() === ''
                        || isUploadingImage
                        || !!(selected.imageFile && !uploadedImageUrl)
                      }
                      className="rounded-xl bg-gradient-to-r from-[#00d9ff] to-[#0099cc] px-6 py-3 text-sm font-semibold text-black hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {generationMode === 'long-ad' ? `Generate ${longAdDuration}s Ad` : 'Generate Video'}
                    </button>
                  </div>
                </>
              )}

              {showGeneratingPanel && (
                <div className="flex flex-col items-center justify-center gap-6 rounded-2xl border border-white/10 bg-gradient-to-br from-[#07111f] via-black/70 to-[#12091f] px-6 py-14 shadow-[0_0_50px_rgba(124,58,237,0.1)] relative overflow-hidden min-h-[520px]">
                  {/* Animated Background Glow */}
                  <div className="absolute -left-24 top-10 h-64 w-64 rounded-full bg-cyan-500/20 blur-3xl animate-pulse pointer-events-none"></div>
                  <div className="absolute -right-20 bottom-0 h-72 w-72 rounded-full bg-purple-500/20 blur-3xl animate-pulse pointer-events-none"></div>
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.08),transparent_35%)] pointer-events-none"></div>
                  
                  {/* Progress Indicator */}
                  <div className="relative z-10 flex w-full max-w-2xl flex-col items-center gap-7">
                    {generatedImageUrl && (
                      <div className="group w-full overflow-hidden rounded-[28px] border border-emerald-300/35 bg-black/70 shadow-[0_0_55px_rgba(16,185,129,0.2),0_0_90px_rgba(59,130,246,0.12)]">
                        <div className="relative">
                          <div
                            className="aspect-video w-full bg-cover bg-center transition-transform duration-700 group-hover:scale-[1.02]"
                            style={{ backgroundImage: `url(${generatedImageUrl})` }}
                          />
                          <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-transparent to-black/10" />
                          <div className="absolute left-4 top-4 rounded-full border border-emerald-300/40 bg-emerald-400/15 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-100 shadow-[0_0_25px_rgba(16,185,129,0.25)]">
                            Anchor Ready
                          </div>
                          <div className="absolute bottom-4 left-4 right-4">
                            <p className="text-sm font-semibold text-white">Persona başlangıç görseli hazır</p>
                            <p className="mt-1 text-xs text-emerald-100/80">
                              Video motoru bu kareyi kilit referans olarak kullanıyor.
                            </p>
                          </div>
                        </div>
                        <div className="grid grid-cols-3 border-t border-white/10 bg-white/[0.03] text-center text-[11px] font-medium text-gray-300">
                          <div className="border-r border-white/10 px-3 py-2 text-emerald-200">Persona kilitli</div>
                          <div className="border-r border-white/10 px-3 py-2 text-cyan-200">Ürün/kimlik korunuyor</div>
                          <div className="px-3 py-2 text-purple-200">Video hazırlanıyor</div>
                        </div>
                      </div>
                    )}
                    <div className={`relative flex ${generatedImageUrl ? 'h-20 w-20' : 'h-28 w-28'} items-center justify-center rounded-full bg-black/50 border border-white/10 shadow-[0_0_40px_rgba(124,58,237,0.2)]`}>
                      <div className="absolute inset-0 rounded-full border-t-4 border-r-4 border-blue-400 animate-spin"></div>
                      <div className="absolute inset-3 rounded-full border-b-4 border-l-4 border-purple-400 animate-[spin_1.5s_linear_infinite_reverse]"></div>
                      <div className="absolute inset-6 rounded-full border-t-4 border-l-4 border-pink-400 animate-[spin_2s_linear_infinite]"></div>
                      <Loader2 className="h-10 w-10 animate-pulse text-white" />
                    </div>
                    
                    <div className="flex flex-col items-center gap-3 text-center w-full">
                      <h3 className="text-2xl font-bold text-white tracking-wide">Video Üretiliyor</h3>
                      <div className="h-2 w-full bg-white/10 rounded-full overflow-hidden mt-2 relative">
                        <div className="absolute top-0 left-0 h-full bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 w-1/2 animate-[shimmer_2s_infinite] bg-[length:200%_100%] rounded-full"></div>
                      </div>
                      <p className="text-base font-medium text-blue-300 mt-2 animate-pulse">{statusMessage || 'Motorlar ısınıyor...'}</p>
                      <p className="text-sm text-gray-400 mt-1">Bu işlem seçilen motora göre 1-5 dakika sürebilir. Lütfen bekleyin.</p>
                    </div>
                  </div>
                </div>
              )}

              {showVideoPanel && videoUrl && (
                <div className="flex flex-col gap-4">
                  {/* Video Tabs: only when face swap was applied (backend returned both URLs) */}
                  {originalVideoUrl && (
                    <div className="flex gap-2 border-b border-white/10">
                      <button
                        type="button"
                        onClick={() => setActiveVideoTab('original')}
                        className={`px-4 py-2 text-sm font-medium transition-colors ${
                          activeVideoTab === 'original'
                            ? 'border-b-2 border-blue-500 text-blue-400'
                            : 'text-gray-400 hover:text-white'
                        }`}
                      >
                        📹 Orijinal video
                      </button>
                      <button
                        type="button"
                        onClick={() => setActiveVideoTab('swapped')}
                        className={`px-4 py-2 text-sm font-medium transition-colors ${
                          activeVideoTab === 'swapped'
                            ? 'border-b-2 border-blue-500 text-blue-400'
                            : 'text-gray-400 hover:text-white'
                        }`}
                      >
                        🎭 Yüz değiştirilmiş (persona)
                      </button>
                    </div>
                  )}
                  
                  {/* Video Player */}
                  <div className="relative w-full rounded-xl border border-white/10 bg-black/70 shadow-[0_0_35px_rgba(255,255,255,0.06)]">
                    {isFaceSwapping && (
                      <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 rounded-xl bg-black/80 backdrop-blur-sm">
                        <Loader2 className="h-8 w-8 animate-spin text-blue-400" />
                        <p className="text-sm text-gray-300">Face swap yapılıyor...</p>
                      </div>
                    )}
                    <VideoPlayerWithAudio
                      videoUrl={activeVideoTab === 'original' && originalVideoUrl ? originalVideoUrl : videoUrl}
                      poster={generatedImageUrl || "/images/video-studio-poster.jpg"}
                      hasAudio={audioMerged}
                    />
                  </div>
                  
                  {/* Download Buttons */}
                  <div className="flex gap-2">
                    {originalVideoUrl ? (
                      <>
                        <a
                          href={originalVideoUrl}
                          download
                          className="flex-1 rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-center text-sm text-gray-300 hover:bg-white/10 transition-colors"
                        >
                          ⬇️ Orijinal indir
                        </a>
                        <a
                          href={videoUrl}
                          download
                          className="flex-1 rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-center text-sm text-gray-300 hover:bg-white/10 transition-colors"
                        >
                          ⬇️ Yüz değiştirilmiş indir
                        </a>
                      </>
                    ) : (
                      <a
                        href={videoUrl}
                        download
                        className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-center text-sm text-gray-300 hover:bg-white/10 transition-colors"
                      >
                        ⬇️ Video İndir
                      </a>
                    )}
                  </div>
                  
                  {/* Face Swap Success Message */}
                  {faceSwapSuccess && (
                    <div className="rounded-lg border border-green-500/30 bg-green-500/10 px-4 py-2 text-sm text-green-200">
                      ✅ Face swap tamamlandı!
                    </div>
                  )}
                  
                  <p className="text-sm text-gray-400">Video Created</p>
                </div>
              )}

              {isMenuOpen && (
                <div className="absolute left-4 top-16 z-10 flex max-h-[80vh] w-80 flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0b0b0b]/95 shadow-2xl backdrop-blur-xl">
                  <div className="flex items-center justify-between border-b border-white/10 px-4 pt-3 pb-2">
                    <span className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-400">Settings</span>
                    <span className="rounded-full bg-cyan-500/10 px-2 py-0.5 text-[10px] font-medium text-cyan-200">{selectedQuality}</span>
                  </div>
                  <div className="flex gap-1 border-b border-white/10 p-2">
                    {([
                      { id: 'engine', label: 'Engine' },
                      { id: 'format', label: 'Duration & Quality' },
                      { id: 'persona', label: 'Persona' },
                    ] as const).map((tab) => (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setSettingsTab(tab.id)}
                        className={`flex-1 rounded-lg px-2 py-1.5 text-xs font-medium transition-all ${
                          settingsTab === tab.id
                            ? 'bg-white/10 text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.15)]'
                            : 'text-gray-400 hover:bg-white/5 hover:text-gray-200'
                        }`}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>
                  <div className="flex-1 overflow-y-auto">

                  {/* Engine Selection */}
                  {settingsTab === 'engine' && (
                  <div className="border-b border-white/10">
                    <div className="px-4 py-3">
                      <div className="mb-2 text-xs font-medium text-gray-400">Video Engine</div>
                      <div className="flex flex-col gap-1.5">
                        {VIDEO_ENGINE_ITEMS.map((item) => {
                          const active = selectedEngine === item.id;
                          return (
                            <button
                              key={item.id}
                              type="button"
                              onClick={() => setSelectedEngine(item.id)}
                              className={`group flex w-full items-center gap-3 rounded-xl border px-2.5 py-2 text-left transition-all ${
                                active
                                  ? item.accent
                                  : 'border-white/10 bg-white/5 text-gray-300 hover:bg-white/10'
                              }`}
                            >
                              <span
                                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br ${item.tile} text-white shadow-[inset_0_1px_1px_rgba(255,255,255,0.25)] transition ${
                                  active ? 'ring-2 ring-white/30' : 'opacity-90 group-hover:opacity-100'
                                }`}
                              >
                                <EngineGlyph id={item.id} />
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-xs font-semibold leading-tight">{item.name}</span>
                                {item.hint && (
                                  <span className="block truncate text-[10px] leading-tight text-gray-500">{item.hint}</span>
                                )}
                              </span>
                              {active && <CheckCircle2 className="h-4 w-4 shrink-0 opacity-80" />}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Runway model picker */}
                    {selectedEngine === 'runway' && (
                      <div className="px-4 pb-4">
                        <div className="mb-2 text-xs font-medium text-gray-400">Runway Model</div>
                        <select
                          value={runwayModel}
                          onChange={(e) => setRunwayModel(e.target.value as RunwayModel)}
                          className="w-full rounded-lg border border-white/10 bg-black/60 px-3 py-2 text-xs text-white focus:border-amber-500 focus:outline-none"
                        >
                          <option value="gen4.5">Gen-4.5 (flagship)</option>
                          <option value="gen4_turbo">Gen-4 Turbo (fast)</option>
                          <option value="gen3a_turbo">Gen-3A Turbo</option>
                          <option value="veo3.1">Veo 3.1</option>
                          <option value="veo3.1_fast">Veo 3.1 Fast</option>
                          <option value="veo3">Veo 3</option>
                        </select>
                        <p className="mt-2 text-[11px] text-gray-500">
                          Çıktı linkleri geçici olabilir; sistem mümkünse videoyu kendi storage’ınıza kaydeder.
                        </p>
                      </div>
                    )}
                  </div>
                  )}

                  {/* Format: Duration + Quality */}
                  {settingsTab === 'format' && (
                  <div className="border-b border-white/10">
                    {/* Duration */}
                    <div className="px-4 pt-4 pb-4">
                      <div className="mb-2 text-xs font-medium text-gray-400">Duration</div>
                      {(() => {
                        const cfg = VIDEO_ENGINES_CONFIG[selectedEngine];
                        if (cfg.mode === 'auto' || cfg.supportedDurations.length === 0) {
                          return (
                            <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-gray-400">
                              Auto {cfg.note ? `— ${cfg.note}` : ''}
                            </div>
                          );
                        }
                        const supported = cfg.supportedDurations;
                        const disabled = supported.length <= 1;
                        return (
                          <div className="flex flex-wrap gap-2">
                            {supported.map((s) => (
                              <button
                                key={s}
                                type="button"
                                disabled={disabled}
                                onClick={() => setDurationSec(s)}
                                className={`px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                                  durationSec === s
                                    ? 'bg-white/10 text-white border border-white/20'
                                    : 'bg-white/5 text-gray-400 border border-white/10 hover:bg-white/10'
                                } ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
                                title={disabled ? 'This engine supports only one duration.' : undefined}
                              >
                                {s}s
                              </button>
                            ))}
                          </div>
                        );
                      })()}
                    </div>

                    {/* Quality */}
                    <div className="px-4 pb-4">
                      <div className="mb-2 text-xs font-medium text-gray-400">Quality</div>
                      <div className="grid grid-cols-1 gap-2">
                        {VIDEO_ENGINES_CONFIG[selectedEngine].supportedQualities.map((q) => {
                          const meta = VIDEO_QUALITY_PRESET_LABELS[q];
                          const active = selectedQuality === q;
                          return (
                            <button
                              key={q}
                              type="button"
                              onClick={() => setSelectedQuality(q)}
                              className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                                active
                                  ? 'border-white/30 bg-white/10 text-white'
                                  : 'border-white/10 bg-white/5 text-gray-300 hover:bg-white/10'
                              }`}
                            >
                              <div className="text-xs font-medium">{meta.title}</div>
                              <div className="text-[11px] text-gray-400">{meta.hint}</div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                  )}

                  {/* Persona tab: Face Swap + Visual Persona + Upload */}
                  {settingsTab === 'persona' && (
                  <>
                  {/* Face Swap Section - Accordion */}
                  {faceSwapUiEnabled && (
                  <div className="border-b border-white/10">
                    <button
                      type="button"
                      onClick={() => toggleSection('faceSwap')}
                      className="flex w-full items-center justify-between px-4 py-3 text-left text-sm text-white hover:bg-white/5 transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={enableFaceSwap}
                          onChange={(e) => {
                            e.stopPropagation();
                            if (!faceSwapAllowedForUser && e.target.checked) {
                              setIsPricingModalOpen(true);
                              return;
                            }
                            setEnableFaceSwap(e.target.checked);
                            if (!e.target.checked) {
                              setActorPhotos({});
                              setActorPhotoUrls({});
                              setCharacterPersonas({});
                              setDetectedCharacters([]);
                              setFaceSwapConsent(false);
                            } else {
                              detectCharacters(prompt).then(chars => {
                                setDetectedCharacters(chars);
                                if (!openSections.faceSwap && chars.length > 0) toggleSection('faceSwap');
                              });
                            }
                          }}
                          onClick={(e) => e.stopPropagation()}
                          className="h-4 w-4 rounded border-white/20 bg-white/5 text-blue-500 focus:ring-2 focus:ring-blue-500"
                        />
                        <span className="text-sm font-medium">🎭 Face Swap</span>
                      </div>
                      {openSections.faceSwap ? (
                        <ChevronUp className="h-4 w-4 text-gray-400" />
                      ) : (
                        <ChevronDown className="h-4 w-4 text-gray-400" />
                      )}
                    </button>
                    {openSections.faceSwap && enableFaceSwap && (
                      <div className="px-4 pb-3 space-y-3">
                        <label className="flex items-start gap-2 rounded-lg border border-white/10 bg-black/40 p-2 text-xs text-gray-300">
                          <input
                            type="checkbox"
                            checked={faceSwapConsent}
                            onChange={(e) => setFaceSwapConsent(e.target.checked)}
                            className="mt-0.5 h-4 w-4 rounded border-white/20 bg-white/5 text-blue-500 focus:ring-2 focus:ring-blue-500"
                          />
                          <span>
                            I confirm I have the legal right and explicit consent to use these faces for face swap, and I will not use third‑party/celebrity images without permission.
                          </span>
                        </label>
                        {detectedCharacters.length > 0 ? (
                          detectedCharacters.map((character) => {
                            const selectedPersona = characterPersonas[character];
                            const hasPhoto = !!actorPhotoUrls[character] && !selectedPersona;
                            const hasSelectedPersona = !!selectedPersona;
                            
                            return (
                              <div key={character} className="space-y-2 rounded-lg border border-white/10 bg-black/40 p-2">
                                <label className="text-xs font-medium text-gray-400">
                                  {character} için:
                                </label>
                                
                                {/* Persona Seçimi */}
                                {personaOptions.length > 0 && (
                                  <div className="space-y-1">
                                    <select
                                      value={selectedPersona?.id || ''}
                                      onChange={(e) => {
                                        const personaId = e.target.value;
                                        if (personaId) {
                                          const persona = personaOptions.find(p => p.id === personaId);
                                          if (persona) {
                                            setCharacterPersonas(prev => ({ ...prev, [character]: persona }));
                                            const imgUrl = persona.image_url || persona.imageUrl;
                                            if (imgUrl) {
                                              setActorPhotoUrls(prev => ({ ...prev, [character]: imgUrl }));
                                              setActorPhotos(prev => ({ ...prev, [character]: null }));
                                            }
                                          }
                                        } else {
                                          setCharacterPersonas(prev => ({ ...prev, [character]: null }));
                                          setActorPhotoUrls(prev => {
                                            const next = { ...prev };
                                            delete next[character];
                                            return next;
                                          });
                                        }
                                      }}
                                      className="w-full rounded-lg border border-white/10 bg-black/60 px-2 py-1.5 text-xs text-white focus:border-blue-500 focus:outline-none"
                                    >
                                      <option value="">Persona seç...</option>
                                      {personaOptions.map((p) => (
                                        <option key={p.id} value={p.id}>
                                          {p.name}
                                        </option>
                                      ))}
                                    </select>
                                  </div>
                                )}
                                
                                {/* Fotoğraf Yükleme - Her zaman göster */}
                                <div className="flex items-center gap-2">
                                  <span className="text-[10px] text-gray-500">veya</span>
                                  <input
                                    type="file"
                                    accept="image/*"
                                    onChange={async (e) => {
                                      const file = e.target.files?.[0];
                                      if (file) {
                                        setActorPhotos(prev => ({ ...prev, [character]: file }));
                                        setCharacterPersonas(prev => ({ ...prev, [character]: null }));
                                        try {
                                          const formData = new FormData();
                                          formData.append('file', file);
                                          const uploadRes = await fetch('/api/upload-image', {
                                            method: 'POST',
                                            body: formData,
                                          });
                                          const uploadData = await uploadRes.json();
                                          if (uploadData.publicUrl) {
                                            setActorPhotoUrls(prev => ({ ...prev, [character]: uploadData.publicUrl }));
                                          }
                                        } catch (error) {
                                          console.error('Photo upload failed:', error);
                                        }
                                      }
                                    }}
                                    className="hidden"
                                    id={`actor-photo-${character}`}
                                  />
                                  <label
                                    htmlFor={`actor-photo-${character}`}
                                    className="flex flex-1 cursor-pointer items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-gray-300 hover:bg-white/10"
                                  >
                                    <ImagePlus className="h-3 w-3" />
                                    <span className="flex-1 truncate text-xs">
                                      {actorPhotos[character]?.name || 'Fotoğraf seç...'}
                                    </span>
                                  </label>
                                  {hasPhoto && <span className="text-xs text-green-400">✓</span>}
                                </div>
                                
                                {/* Seçim Onayı */}
                                {(hasSelectedPersona || hasPhoto) && (
                                  <p className="text-[10px] text-gray-500">
                                    {hasSelectedPersona ? `✓ Persona: ${selectedPersona?.name}` : '✓ Fotoğraf yüklendi'}
                                  </p>
                                )}
                              </div>
                            );
                          })
                        ) : (
                          <p className="text-xs text-gray-500 italic px-2">
                            {"Prompt'tan karakter tespit edilemedi. Lütfen karakter isimlerini açıkça belirtin (örn: \"Superman vs Thor\")."}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                  )}
                  
                  {/* Visual Persona - Accordion */}
                  <div className="border-b border-white/10">
                    <button
                      type="button"
                      onClick={() => toggleSection('visualPersona')}
                      className="flex w-full items-center justify-between px-4 py-3 text-left text-sm text-white hover:bg-white/5 transition-colors"
                    >
                      <span>👤 Visual Persona</span>
                      {openSections.visualPersona ? (
                        <ChevronUp className="h-4 w-4 text-gray-400" />
                      ) : (
                        <ChevronDown className="h-4 w-4 text-gray-400" />
                      )}
                    </button>
                    {openSections.visualPersona && (
                      <div className="px-4 pb-3">
                        <div className="max-h-[240px] overflow-y-auto rounded-lg border border-white/10 bg-black/40">
                          {succeededPersonas.length === 0 && trainingPersonas.length === 0 && (
                            <p className="p-3 text-xs text-gray-500">No personas found.</p>
                          )}
                          {succeededPersonas.map((option) => (
                            <div
                              key={option.id || option.modelId || Math.random()}
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                handleSelectPersona(option);
                              }}
                              className={`relative cursor-pointer transition-all duration-200 p-2 rounded-xl border-2 m-1 ${
                                (selectedIdRef.current === (option.id || option.modelId)
                                  || selected.selectedPersona?.id === (option.id || option.modelId))
                                  ? 'border-blue-500 bg-blue-500/10 shadow-[0_0_15px_rgba(59,130,246,0.5)]'
                                  : 'border-transparent hover:border-white/20'
                              }`}
                            >
                              <div className="flex w-full items-center gap-3 text-left text-sm text-white">
                                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500/80 to-sky-500/80 text-[10px] font-semibold text-white">
                                  {(option.name || option.triggerWord || 'P').trim().charAt(0).toUpperCase() || 'P'}
                                </span>
                                <span className="truncate">{option.name || option.triggerWord || 'Untitled persona'}</span>
                              </div>
                            </div>
                          ))}
                          {trainingPersonas.length > 0 && (
                            <div className="border-t border-white/10 px-3 py-2 text-[11px] uppercase tracking-wide text-gray-500">
                              Training
                            </div>
                          )}
                          {trainingPersonas.map((option) => (
                            <div
                              key={option.id}
                              className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm text-gray-500 opacity-70"
                            >
                              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/10 text-[10px] font-semibold text-white/60">
                                {(option.name || option.triggerWord || 'P').trim().charAt(0).toUpperCase() || 'P'}
                              </span>
                              <span className="truncate">{option.name || option.triggerWord || 'Untitled persona'}</span>
                              <span className="ml-auto text-[10px] uppercase text-white/40">
                                {option.status || 'training'}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Upload Image */}
                  <div className="border-b border-white/10">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm text-white hover:bg-white/5 transition-colors"
                    >
                      <ImagePlus className="h-4 w-4 text-gray-400" />
                      <span>Upload Image</span>
                    </button>
                  </div>
                  </>
                  )}
                  </div>
                </div>
              )}

              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => handleImagePick(event.target.files?.[0] ?? null)}
              />
            </div>
          </section>

          <footer className="mt-16 border-t border-white/5 pt-8 text-gray-500">
            <div className="grid gap-4 text-sm md:grid-cols-3">
              <div className="flex items-start gap-3">
                <Sparkles className="mt-1 h-4 w-4" />
                <div>
                  <p className="text-gray-300">Describe your scene</p>
                  <p className="text-xs text-gray-500">Write a cinematic prompt.</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Video className="mt-1 h-4 w-4" />
                <div>
                  <p className="text-gray-300">Add personas or references</p>
                  <p className="text-xs text-gray-500">Attach identities or a guide image.</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Sparkles className="mt-1 h-4 w-4" />
                <div>
                  <p className="text-gray-300">Generate and iterate</p>
                  <p className="text-xs text-gray-500">Preview and refine fast.</p>
                </div>
              </div>
            </div>
          </footer>
        </div>
      </main>

      <PricingModal
        isOpen={isPricingModalOpen}
        onClose={() => setIsPricingModalOpen(false)}
      />
    </div>
  );
}
