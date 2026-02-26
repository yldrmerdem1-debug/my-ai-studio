'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Sidebar from '@/components/Sidebar';
import PricingModal from '@/components/PricingModal';
import { ImagePlus, Loader2, Plus, X, Video, Sparkles, CheckCircle2, User, ChevronDown, ChevronUp } from 'lucide-react';
import { usePersona } from '@/hooks/usePersona';
import VideoPlayerWithAudio from '@/components/VideoPlayerWithAudio';
import { VIDEO_ENGINES_CONFIG, type VideoEngineKey } from '@/lib/constants';
import { isPublicFaceSwapEnabled } from '@/lib/feature-flags';
import { isPremiumUser } from '@/lib/subscription';

type RunwayModel =
  | 'gen4.5'
  | 'gen4_turbo'
  | 'gen3a_turbo'
  | 'veo3.1'
  | 'veo3.1_fast'
  | 'veo3';

type PersonaOption = {
  id: string;
  name: string;
  triggerWord?: string;
  trigger_word?: string;
  modelId?: string;
  model_id?: string;
  image_url?: string;
  imageUrl?: string;
  type?: 'visual' | 'voice';
  voiceStatus?: 'none' | 'training' | 'ready';
  visualStatus?: 'none' | 'training' | 'ready';
  status?: string;
};

type SelectedAssets = {
  selectedPersona: PersonaOption | null;
  voicePersonaId: string | null;
  voicePersonaName: string | null;
  imageFile: File | null;
  imagePreview: string | null;
};


type DirectorPlanPayload = {
  scenario: {
    title?: string;
    hook?: string;
    angle?: string;
    plan?: {
      visual_prompt?: string;
      audio_script?: string;
      voice_emotion?: string;
      sfx_prompt?: string;
      camera_movement?: string;
    };
  };
  inputs?: Record<string, string>;
  createdAt?: string;
};

let cachedPersonas: PersonaOption[] | null = null;

const usePersonaOptions = (user: any) => {
  const [personaOptions, setPersonaOptions] = useState<PersonaOption[]>([]);
  const cacheKey = useMemo(() => {
    const id = user?.id || 'anon';
    return `personaOptionsCache:${id}`;
  }, [user?.id]);

  const fetchPersonas = useCallback((force = false) => {
    let isActive = true;
    if (cachedPersonas && !force) {
      setPersonaOptions(cachedPersonas);
      return () => {
        isActive = false;
      };
    }
    if (!cachedPersonas && typeof window !== 'undefined') {
      try {
        const cachedRaw = localStorage.getItem(cacheKey);
        const cachedParsed = cachedRaw ? JSON.parse(cachedRaw) : null;
        if (Array.isArray(cachedParsed) && cachedParsed.length > 0) {
          cachedPersonas = cachedParsed;
          setPersonaOptions(cachedParsed);
        }
      } catch (error) {
        console.warn('Failed to read persona cache', error);
      }
    }
    const run = async () => {
      try {
        const userQuery = user?.id ? `?userId=${user.id}` : '';
        const cacheBuster = Date.now();
        const listQuery = userQuery ? `${userQuery}&t=${cacheBuster}` : `?t=${cacheBuster}`;
        const res = await fetch(`/api/save-persona${listQuery}`, {
          cache: 'no-store',
          headers: { Pragma: 'no-cache' },
        });
        const rawData = await res.json().catch(() => ({}));
        const personasPayload = Array.isArray(rawData?.personas) ? rawData.personas : Array.isArray(rawData) ? rawData : [];
        if (!res.ok) {
          console.error('Supabase Response:', rawData);
          if (isActive) {
            setPersonaOptions([]);
          }
          return;
        }
        console.log('🔥 RAW DATA INTO STATE:', personasPayload);
        if (isActive) {
          cachedPersonas = personasPayload;
          setPersonaOptions(personasPayload);
          if (typeof window !== 'undefined') {
            try {
              localStorage.setItem(cacheKey, JSON.stringify(cachedPersonas));
            } catch (error) {
              console.warn('Failed to write persona cache', error);
            }
          }
        }
      } catch (error) {
        if (isActive) {
          setPersonaOptions([]);
        }
      }
    };
    run();
    return () => {
      isActive = false;
    };
  }, [user?.id, cacheKey]);

  useEffect(() => {
    const cleanup = fetchPersonas();
    return () => {
      if (cleanup) cleanup();
    };
  }, [fetchPersonas]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleUpdate = () => {
      cachedPersonas = null;
      fetchPersonas(true);
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key === 'personasUpdated') {
        handleUpdate();
      }
    };
    window.addEventListener('personas:updated', handleUpdate);
    window.addEventListener('storage', handleStorage);
    window.addEventListener('focus', handleUpdate);
    document.addEventListener('visibilitychange', handleUpdate);
    return () => {
      window.removeEventListener('personas:updated', handleUpdate);
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('focus', handleUpdate);
      document.removeEventListener('visibilitychange', handleUpdate);
    };
  }, [fetchPersonas]);

  return { personaOptions };
};

export default function VideoPage() {
  const { user } = usePersona();
  const [isPricingModalOpen, setIsPricingModalOpen] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [selectedEngine, setSelectedEngine] = useState<
    VideoEngineKey
  >('grok');
  const [runwayModel, setRunwayModel] = useState<RunwayModel>('gen4.5');
  const [durationSec, setDurationSec] = useState<number>(VIDEO_ENGINES_CONFIG.grok.defaultDuration);
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
  const [directorPlan, setDirectorPlan] = useState<DirectorPlanPayload | null>(null);
  const [selected, setSelected] = useState<SelectedAssets>({
    selectedPersona: null,
    voicePersonaId: null,
    voicePersonaName: null,
    imageFile: null,
    imagePreview: null,
  });
  const selectedIdRef = useRef<string | null>(null);
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
    voicePersona: false,
    uploadImage: false,
  });
  
  const toggleSection = (section: string) => {
    setOpenSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  const voiceOptions = useMemo(
    () => [
      { id: 'voice-1', name: 'Studio Voice' },
      { id: 'voice-2', name: 'Narrator Voice' },
      { id: 'voice-3', name: 'Warm Voice' },
    ],
    []
  );

  useEffect(() => {
    console.log('✅ STATE UPDATED: Selected Persona is now:', selected.selectedPersona);
  }, [selected.selectedPersona]);

  useEffect(() => {
    const cfg = VIDEO_ENGINES_CONFIG[selectedEngine];
    if (cfg.mode === 'auto' || cfg.supportedDurations.length === 0) {
      setDurationSec(0);
      return;
    }
    if (!cfg.supportedDurations.includes(durationSec)) {
      setDurationSec(cfg.defaultDuration);
    }
  }, [selectedEngine]); // intentionally not depending on durationSec to avoid loops

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const raw = localStorage.getItem('adDirectorPlan');
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as DirectorPlanPayload;
      const plan = parsed?.scenario?.plan;
      if (plan?.visual_prompt) {
        setPrompt(plan.visual_prompt);
      }
      setDirectorPlan(parsed);
    } catch (error) {
      console.warn('Failed to parse director plan from storage', error);
    }
  }, []);

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

  const handleSelectVoice = (option: PersonaOption) => {
    setSelected(prev => ({
      ...prev,
      voicePersonaId: option.id,
      voicePersonaName: option.name,
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
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(new Error('Failed to read image file.'));
          reader.readAsDataURL(file);
        });
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
      if (key === 'voicePersonaId' || key === 'voicePersonaName') {
        return { ...prev, voicePersonaId: null, voicePersonaName: null };
      }
      return prev;
    });
  };

  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  const fetchWithTimeout = async (input: RequestInfo, init?: RequestInit, timeoutMs = 300000) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(input, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timeoutId);
    }
  };

  useEffect(() => {
    if (!pendingVideoId) return;
    let cancelled = false;
    const runId = pendingRunIdRef.current;

    const pollOnce = async () => {
      if (cancelled) return;
      if (generationRunRef.current !== runId) return;

      try {
        // Runway: use dedicated status endpoint + premium message.
        if (pendingVideoId.startsWith('runway:')) {
          setStatusMessage('Gen-4.5 Motoru işliyor... Ultra Gerçekçi Video Hazırlanıyor');
          const taskId = pendingVideoId.slice('runway:'.length);
          const res = await fetch(`/api/video/runway-gen4/status?task_id=${encodeURIComponent(taskId)}`);
          const data = await res.json().catch(() => ({}));
          if (!res.ok) {
            throw new Error(data.error || 'Failed to check Runway status');
          }
          const st = String(data.status || '').toUpperCase();
          if (st === 'SUCCEEDED') {
            if (!data.videoUrl) throw new Error('Runway succeeded but videoUrl is missing');
            if (generationRunRef.current !== runId) return;
            setVideoUrl(String(data.videoUrl));
            setHasGenerated(true);
            setAudioMerged(false);
            setIsGenerating(false);
            setPendingVideoId(null);
            return;
          }
          if (st === 'FAILED') {
            throw new Error(data.error || 'Runway generation failed');
          }
          return;
        }

        // Default: existing unified status route.
        const response = await fetch(`/api/generate-video/status?id=${encodeURIComponent(pendingVideoId)}`);
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data.error || data.details || 'Failed to check video status');
        }
        if (data.statusMessage) {
          setStatusMessage(data.statusMessage);
        }
        if (data.status === 'succeeded') {
          if (!data.videoUrl) {
            throw new Error('Video generated but URL is missing');
          }
          if (generationRunRef.current !== runId) return;
          setVideoUrl(String(data.videoUrl));
          setHasGenerated(true);
          setAudioMerged(Boolean(data.audioMerged));
          setIsGenerating(false);
          setPendingVideoId(null);
          return;
        }
        if (data.status === 'failed' || data.status === 'canceled') {
          throw new Error(data.error || 'Video generation failed');
        }
      } catch (error: any) {
        if (generationRunRef.current !== runId) return;
        setErrorMessage(error?.message || 'Failed to generate video');
        setIsGenerating(false);
        setPendingVideoId(null);
      }
    };

    pollOnce();
    const intervalId = window.setInterval(pollOnce, 4000);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [pendingVideoId]);

  const handleGenerate = async (e?: React.MouseEvent<HTMLButtonElement>) => {
    if (e) e.preventDefault();
    if (!prompt.trim() || isGenerating) return;
    const targetId = selectedIdRef.current || selected.selectedPersona?.id;
    const exactPersona = personaOptions.find(option => option.id === targetId);
    console.log('🕵️ DEBUGGING PERSONA:', exactPersona);
    const finalModelId = (exactPersona as any)?.model_id
      || (exactPersona as any)?.modelId
      || (exactPersona as any)?.training_id
      || (exactPersona as any)?.trainingId
      || (exactPersona as any)?.replicate_model_id;
    const finalImageUrl = exactPersona?.image_url
      || exactPersona?.imageUrl
      || '';
    const finalTrigger = exactPersona
      ? (exactPersona as any)?.trigger_word
        || (exactPersona as any)?.triggerWord
      : undefined;
    if (targetId && (!exactPersona || !finalModelId)) {
      alert(`⚠️ HATA: Model ID Eksik!\nID: ${targetId}\nDurum: ${exactPersona ? 'Bulundu' : 'Yok'}`);
      return;
    }
    console.log('🚀 GENERATING WITH:', exactPersona);
    console.log('🚀 DEBUG: Sending Persona URL:', finalImageUrl);
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
    try {
      setStatusMessage('Generating video + voice...');
      const videoResponse = await fetchWithTimeout('/api/generate-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: resolvedPrompt,
          ...(durationSec > 0 ? { duration: durationSec } : {}),
          referenceImageUrl: uploadedImageUrl,
          personaImageUrl: finalImageUrl,
          personaUrl: finalImageUrl,
          personaModelId: finalModelId,
          personaTriggerWord: finalTrigger,
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
          runwayModel: selectedEngine === 'runway' ? runwayModel : undefined,
          // Face swap gated by public flag + premium + explicit consent
          enableFaceSwap: faceSwapAllowedForUser && enableFaceSwap && faceSwapConsent && Object.keys(actorPhotoUrls).length > 0,
          faceSwapConsent: faceSwapAllowedForUser && enableFaceSwap ? faceSwapConsent : undefined,
          actorPhotos: faceSwapAllowedForUser && enableFaceSwap && faceSwapConsent && Object.keys(actorPhotoUrls).length > 0 ? Object.fromEntries(
            Object.entries(actorPhotoUrls).map(([char, url]) => [char, url])
          ) : undefined,
          detectedCharacters: faceSwapAllowedForUser && enableFaceSwap && faceSwapConsent && Object.keys(actorPhotoUrls).length > 0 ? detectedCharacters : undefined,
          user,
        }),
      });
      const videoData = await videoResponse.json().catch(() => ({}));
      if (!videoResponse.ok) {
        throw new Error(videoData.error || videoData.details || 'Failed to start video generation');
      }
      if (videoData.imageUrl && generationRunRef.current === currentRun) {
        setGeneratedImageUrl(videoData.imageUrl);
      }
      let rawVideoUrl = videoData.videoUrl as string | undefined;
      if (!rawVideoUrl) {
        if (!videoData.videoId) {
          throw new Error('Video generation did not return an ID');
        }
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
        console.log('✅ Face swap completed successfully');
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
      
      setVideoUrl(finalVideoUrl);
      setAudioMerged(Boolean(videoData.audioMerged));
      setHasGenerated(true);
      setActiveVideoTab('swapped');
      
      // Store generation params for face swap
      setLastGenerationParams({
        exactPersona,
        prompt: resolvedPrompt,
        referenceImageUrl: uploadedImageUrl,
        personaImageUrl: finalImageUrl,
        personaUrl: finalImageUrl,
        personaModelId: finalModelId,
        personaTriggerWord: finalTrigger,
        persona: exactPersona,
        isTextOnly: true,
        personaMode: exactPersona ? 'persona' : 'generic',
        personaId: exactPersona?.id,
        id: exactPersona?.id,
        modelId: finalModelId,
        model_id: finalModelId,
        triggerWord: exactPersona ? resolvedTriggerWord : undefined,
        trigger_word: exactPersona ? resolvedTriggerWord : undefined,
        user,
      });
      
      if (typeof window !== 'undefined') {
        localStorage.setItem('latestRawVideoUrl', finalVideoUrl);
      }
    } catch (error: any) {
      if (generationRunRef.current !== currentRun) return;
      setErrorMessage(error.message || 'Failed to generate video');
    } finally {
      if (generationRunRef.current === currentRun) {
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
    <div className="min-h-screen bg-black text-white">
      <Sidebar onSubscriptionClick={() => setIsPricingModalOpen(true)} />
      <main className="ml-64 px-6 py-10">
        <div className="mx-auto max-w-4xl">
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
                  Prompt and dialogue are pre-filled from your selected scenario.
                </p>
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
              {selected.voicePersonaId && (
                <span className="inline-flex items-center gap-2 rounded-full bg-purple-500/20 px-3 py-1 text-sm text-purple-200">
                  🗣️ {selected.voicePersonaName ?? 'Voice Persona'}
                  <button
                    type="button"
                    onClick={() => removeChip('voicePersonaId')}
                    className="rounded-full bg-purple-500/30 p-1 hover:bg-purple-500/40"
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
                      Generate Video
                    </button>
                  </div>
                </>
              )}

              {isGenerating && (
                <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-white/10 bg-gradient-to-br from-white/5 via-black/40 to-black/70 px-6 py-10">
                  <div className="aspect-video w-full overflow-hidden rounded-xl border border-white/10 bg-black/60 shadow-[0_0_35px_rgba(255,255,255,0.06)]">
                    <div className="flex h-full w-full flex-col items-center justify-center gap-3 animate-pulse">
                      <Loader2 className="h-6 w-6 animate-spin text-white/70" />
                      <p className="text-sm text-gray-300">{statusMessage}</p>
                    </div>
                  </div>
                </div>
              )}

              {!isGenerating && hasGenerated && videoUrl && (
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
                <div className="absolute left-4 top-16 z-10 w-72 max-h-[80vh] overflow-y-auto rounded-xl border border-white/10 bg-[#0b0b0b] shadow-xl">
                  <div className="sticky top-0 bg-[#0b0b0b] p-3 text-xs uppercase tracking-wide text-gray-500 border-b border-white/10 z-10">
                    Settings
                  </div>
                  
                  {/* Engine Selection - Always Open */}
                  <div className="border-b border-white/10">
                    <div className="px-4 py-3">
                      <div className="mb-2 text-xs font-medium text-gray-400">Video Motoru</div>
                      <div className="flex flex-col gap-2">
                        <button
                          type="button"
                          onClick={() => setSelectedEngine('grok')}
                          className={`w-full px-3 py-2 rounded-lg text-xs font-medium transition-colors text-left ${
                            selectedEngine === 'grok'
                              ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                              : 'bg-white/5 text-gray-400 border border-white/10 hover:bg-white/10'
                          }`}
                        >
                          ⚡ Standard (Grok)
                        </button>
                        <button
                          type="button"
                          onClick={() => setSelectedEngine('veo')}
                          className={`w-full px-3 py-2 rounded-lg text-xs font-medium transition-colors text-left ${
                            selectedEngine === 'veo'
                              ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                              : 'bg-white/5 text-gray-400 border border-white/10 hover:bg-white/10'
                          }`}
                        >
                          🎬 Premium (Veo 3.1)
                        </button>
                        <button
                          type="button"
                          onClick={() => setSelectedEngine('runway')}
                          className={`w-full px-3 py-2 rounded-lg text-xs font-medium transition-colors text-left ${
                            selectedEngine === 'runway'
                              ? 'bg-amber-500/20 text-amber-200 border border-amber-500/30'
                              : 'bg-white/5 text-gray-400 border border-white/10 hover:bg-white/10'
                          }`}
                        >
                          👑 Ultra Premium (Runway)
                        </button>
                        <button
                          type="button"
                          onClick={() => setSelectedEngine('kling_3_pro')}
                          className={`w-full px-3 py-2 rounded-lg text-xs font-medium transition-colors text-left ${
                            selectedEngine === 'kling_3_pro'
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                              : 'bg-white/5 text-gray-400 border border-white/10 hover:bg-white/10'
                          }`}
                        >
                          🎥 Kling 3.0 Pro (Video)
                        </button>
                        <button
                          type="button"
                          onClick={() => setSelectedEngine('kling_turbo')}
                          className={`w-full px-3 py-2 rounded-lg text-xs font-medium transition-colors text-left ${
                            selectedEngine === 'kling_turbo'
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                              : 'bg-white/5 text-gray-400 border border-white/10 hover:bg-white/10'
                          }`}
                        >
                          🚀 ProTurbo (Kling 2.5 Turbo Pro)
                        </button>
                        <button
                          type="button"
                          onClick={() => setSelectedEngine('kling_2_6')}
                          className={`w-full px-3 py-2 rounded-lg text-xs font-medium transition-colors text-left ${
                            selectedEngine === 'kling_2_6'
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                              : 'bg-white/5 text-gray-400 border border-white/10 hover:bg-white/10'
                          }`}
                        >
                          🎞️ Kling 2.6 (Video)
                        </button>
                        <button
                          type="button"
                          onClick={() => setSelectedEngine('kling_avatar_v2')}
                          className={`w-full px-3 py-2 rounded-lg text-xs font-medium transition-colors text-left ${
                            selectedEngine === 'kling_avatar_v2'
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                              : 'bg-white/5 text-gray-400 border border-white/10 hover:bg-white/10'
                          }`}
                        >
                          🎭 Kling Avatar v2 (Lip-Sync)
                        </button>
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

                    {/* Duration */}
                    <div className="px-4 pb-4">
                      <div className="mb-2 text-xs font-medium text-gray-400">Süre (Duration)</div>
                      {(() => {
                        const cfg = VIDEO_ENGINES_CONFIG[selectedEngine];
                        if (cfg.mode === 'auto' || cfg.supportedDurations.length === 0) {
                          return (
                            <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-gray-400">
                              Otomatik {cfg.note ? `— ${cfg.note}` : ''}
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
                                title={disabled ? 'Bu motor tek süre destekliyor.' : undefined}
                              >
                                {s}s
                              </button>
                            ))}
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                  
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
                            const usePersona = !!selectedPersona;
                            
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
                                {(usePersona || hasPhoto) && (
                                  <p className="text-[10px] text-gray-500">
                                    {usePersona ? `✓ Persona: ${selectedPersona?.name}` : '✓ Fotoğraf yüklendi'}
                                  </p>
                                )}
                              </div>
                            );
                          })
                        ) : (
                          <p className="text-xs text-gray-500 italic px-2">
                            Prompt'tan karakter tespit edilemedi. Lütfen karakter isimlerini açıkça belirtin (örn: "Superman vs Thor").
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
                                  {option.name.trim().charAt(0).toUpperCase() || 'P'}
                                </span>
                                <span className="truncate">{option.name}</span>
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
                                {option.name.trim().charAt(0).toUpperCase() || 'P'}
                              </span>
                              <span className="truncate">{option.name}</span>
                              <span className="ml-auto text-[10px] uppercase text-white/40">
                                {option.status || 'training'}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Voice Persona - Accordion */}
                  <div className="border-b border-white/10">
                    <button
                      type="button"
                      onClick={() => toggleSection('voicePersona')}
                      className="flex w-full items-center justify-between px-4 py-3 text-left text-sm text-white hover:bg-white/5 transition-colors"
                    >
                      <span>🗣️ Voice Persona</span>
                      {openSections.voicePersona ? (
                        <ChevronUp className="h-4 w-4 text-gray-400" />
                      ) : (
                        <ChevronDown className="h-4 w-4 text-gray-400" />
                      )}
                    </button>
                    {openSections.voicePersona && (
                      <div className="px-4 pb-3">
                        <div className="max-h-32 overflow-auto rounded-lg border border-white/10 bg-black/40">
                          {voiceOptions.map((option) => (
                            <button
                              key={option.id}
                              type="button"
                              onClick={() => handleSelectVoice(option)}
                              className="block w-full px-3 py-2 text-left text-sm text-white hover:bg-white/10"
                            >
                              {option.name}
                            </button>
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
