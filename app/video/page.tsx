'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Sidebar from '@/components/Sidebar';
import PricingModal from '@/components/PricingModal';
import { ImagePlus, Loader2, Plus, X, Video, Sparkles, CheckCircle2 } from 'lucide-react';
import { usePersona } from '@/hooks/usePersona';
import VideoPlayerWithAudio from '@/components/VideoPlayerWithAudio';

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


type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  videoUrl?: string | null;
  audioMerged?: boolean;
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
          setPersonaOptions(cachedPersonas);
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
  const [dialogueText, setDialogueText] = useState('');
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const { personaOptions } = usePersonaOptions(user);
  const [isGenerating, setIsGenerating] = useState(false);
  const [hasGenerated, setHasGenerated] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [audioMerged, setAudioMerged] = useState(false);
  const [generatedImageUrl, setGeneratedImageUrl] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState('Analyzing Prompt...');
  const [errorMessage, setErrorMessage] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
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
    if (typeof window === 'undefined') return;
    const raw = localStorage.getItem('adDirectorPlan');
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as DirectorPlanPayload;
      const plan = parsed?.scenario?.plan;
      if (plan?.visual_prompt) {
        setPrompt(plan.visual_prompt);
      }
      if (plan?.audio_script) {
        setDialogueText(plan.audio_script);
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

  const pollVideoStatus = async (videoId: string, runId: number) => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < 300000) {
      if (generationRunRef.current !== runId) return null;
      const response = await fetch(`/api/generate-video/status?id=${videoId}`);
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
        return data.videoUrl as string;
      }
      if (data.status === 'failed' || data.status === 'canceled') {
        throw new Error(data.error || 'Video generation failed');
      }
      await sleep(3000);
    }
    throw new Error('Video generation timed out');
  };

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
    setIsMenuOpen(false);
    const userMessageId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    setMessages(prev => ([
      ...prev,
      { id: userMessageId, role: 'user', text: prompt.trim() },
    ]));

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
          dialogue: dialogueText.trim(),
          referenceImageUrl: uploadedImageUrl,
          personaImageUrl:
            finalImageUrl,
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
        rawVideoUrl = await pollVideoStatus(videoData.videoId, currentRun);
      }
      if (!rawVideoUrl || generationRunRef.current !== currentRun) return;

      const finalVideoUrl = rawVideoUrl;
      setVideoUrl(finalVideoUrl);
      setAudioMerged(Boolean(videoData.audioMerged));
      setHasGenerated(true);
      if (typeof window !== 'undefined') {
        localStorage.setItem('latestRawVideoUrl', finalVideoUrl);
      }
      setMessages(prev => ([
        ...prev,
        {
          id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          role: 'assistant',
          text: 'Video hazır.',
          videoUrl: finalVideoUrl,
          audioMerged: Boolean(videoData.audioMerged),
        },
      ]));
    } catch (error: any) {
      if (generationRunRef.current !== currentRun) return;
      setErrorMessage(error.message || 'Failed to generate video');
    } finally {
      if (generationRunRef.current === currentRun) {
        setIsGenerating(false);
      }
    }
  };

  const isPersonaReady = (option: PersonaOption) =>
    option.status === 'completed' || option.visualStatus === 'ready';
  const succeededPersonas = personaOptions.filter(isPersonaReady);
  const trainingPersonas = personaOptions.filter(option => !isPersonaReady(option));

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
            {messages.length > 0 && (
              <div className="mb-6 space-y-4">
                {messages.map((message) => (
                  <div
                    key={message.id}
                    className={`rounded-xl border border-white/10 p-4 ${
                      message.role === 'user'
                        ? 'bg-white/5'
                        : 'bg-gradient-to-br from-white/5 via-black/40 to-black/70'
                    }`}
                  >
                    <p className="text-sm text-gray-300">{message.text}</p>
                    {message.videoUrl && (!hasGenerated || !videoUrl || message.videoUrl !== videoUrl) && (
                      <div className="mt-3 w-full rounded-xl border border-white/10 bg-black/70">
                        <VideoPlayerWithAudio
                          videoUrl={message.videoUrl}
                          poster={generatedImageUrl || "/images/video-studio-poster.jpg"}
                          hasAudio={message.audioMerged ?? false}
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
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
                  <div className="relative mt-4">
                    <textarea
                      value={dialogueText}
                      onChange={(event) => setDialogueText(event.target.value)}
                      placeholder="Diyalog (isteğe bağlı)..."
                      rows={3}
                      className="w-full resize-none rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white outline-none placeholder:text-gray-500 focus:border-white/20"
                    />
                    {dialogueText.trim().length > 0 && (
                      <span className="absolute right-3 top-3 rounded-full bg-emerald-500/15 px-3 py-1 text-[11px] font-semibold text-emerald-200">
                        🗣️ Konuşma Modu Aktif
                      </span>
                    )}
                    <p className="mt-2 text-xs text-gray-400">
                      ℹ️ İpucu: Metin girerseniz karakter konuşur (Lip-Sync). Boş bırakırsanız sinematik video üretilir.
                    </p>
                  </div>

                  <div className="mt-4 flex justify-end">
                    <button
                      type="button"
                      onClick={handleGenerate}
                      disabled={
                        prompt.trim() === ''
                        || isUploadingImage
                        || (selected.imageFile && !uploadedImageUrl)
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
                  <div className="w-full rounded-xl border border-white/10 bg-black/70 shadow-[0_0_35px_rgba(255,255,255,0.06)]">
                    <VideoPlayerWithAudio
                      videoUrl={videoUrl}
                      poster={generatedImageUrl || "/images/video-studio-poster.jpg"}
                      hasAudio={audioMerged}
                    />
                  </div>
                  <p className="text-sm text-gray-400">Video Created</p>
                </div>
              )}

              {isMenuOpen && (
                <div className="absolute left-4 top-16 z-10 w-72 rounded-xl border border-white/10 bg-[#0b0b0b] shadow-xl">
                  <div className="p-3 text-xs uppercase tracking-wide text-gray-500">
                    Add assets
                  </div>
                  <div className="border-t border-white/10">
                    <button
                      type="button"
                      onClick={() => {}}
                      className="w-full px-4 py-3 text-left text-sm text-white hover:bg-white/5"
                    >
                      👤 Select Visual Persona
                    </button>
                    <div className="px-4 pb-3">
                      <div className="max-h-[320px] overflow-y-auto rounded-lg border border-white/10 bg-black/40">
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
                            className={`relative cursor-pointer transition-all duration-200 p-2 rounded-xl border-2 ${
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
                            <div className="absolute bottom-0 left-0 right-0 bg-black/80 p-1 text-[8px] text-green-400 font-mono break-all z-20">
                              ID: {option.model_id || option.training_id || 'YOK'}
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
                  </div>

                  <div className="border-t border-white/10">
                    <button
                      type="button"
                      onClick={() => {}}
                      className="w-full px-4 py-3 text-left text-sm text-white hover:bg-white/5"
                    >
                      🗣️ Select Voice Persona
                    </button>
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
                  </div>

                  <div className="border-t border-white/10">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm text-white hover:bg-white/5"
                    >
                      <ImagePlus className="h-4 w-4 text-gray-400" />
                      Upload Image
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
