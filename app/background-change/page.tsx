'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, Image as ImageIcon, Sparkles, Upload, UserRound, X } from 'lucide-react';
import Sidebar from '@/components/Sidebar';
import AuroraBackground from '@/components/AuroraBackground';
import PricingModal from '@/components/PricingModal';
import PreviewArea from '@/components/PreviewArea';
import { useToast } from '@/hooks/useToast';
import { usePersona } from '@/hooks/usePersona';
import { PersonaOption, usePersonaOptions } from '@/hooks/usePersonaOptions';
import { fileToDataUrl } from '@/lib/client/file-data-url';
import {
  getPersonaImageEngineOptions,
  getTrainingEngineLabel,
  type PersonaGenerationMode,
  type PersonaImageEngineId,
} from '@/lib/persona-pipeline';
import { canUsePersona } from '@/lib/subscription';

type ImageAspectRatio = 'portrait' | 'landscape' | 'square';
type ImageQuality = 'standard' | 'hq';

const ASPECT_OPTIONS: Array<{ id: ImageAspectRatio; title: string; hint: string }> = [
  { id: 'portrait', title: 'Portrait', hint: 'Best for ads, covers, profile shots' },
  { id: 'landscape', title: 'Landscape', hint: 'Best for banners and cinematic frames' },
  { id: 'square', title: 'Square', hint: 'Best for posts and catalog cards' },
];

const QUALITY_OPTIONS: Array<{ id: ImageQuality; title: string; hint: string }> = [
  { id: 'standard', title: 'Standard', hint: 'Fast iteration, clean preview quality' },
  { id: 'hq', title: 'HQ Persona', hint: 'Higher detail, stronger face preservation' },
];

const FORCE_PERSONA_ACCESS_PREVIEW = true;

const GENERATION_MODE_OPTIONS: Array<{
  id: PersonaGenerationMode;
  title: string;
  hint: string;
}> = [
  {
    id: 'creative',
    title: 'Creative',
    hint: 'Best for new scenes, bigger composition changes, and prompt freedom.',
  },
  {
    id: 'exact',
    title: 'Exact',
    hint: 'Best for tighter identity lock. A reference image is recommended.',
  },
];

const ENGINE_TAGS: Partial<Record<PersonaImageEngineId, string>> = {
  'nano-banana': 'Identity-safe',
  'nano-banana-2': '4K · Identity-safe',
  'nano-banana-pro': 'Pro · Best identity',
};

const getOptionButtonClass = (isActive: boolean, compact = false) =>
  `rounded-2xl border text-left transition-all ${
    compact ? 'px-3 py-3' : 'px-3 py-3.5'
  } ${
    isActive
      ? 'border-cyan-400/50 bg-cyan-400/[0.08] text-white shadow-[0_0_20px_rgba(34,211,238,0.12)]'
      : 'border-white/10 bg-white/[0.02] text-gray-300 hover:border-white/20 hover:bg-white/[0.05]'
  }`;

export default function ImageStudioPage() {
  const { showToast } = useToast();
  const { user } = usePersona();
  const { personaOptions } = usePersonaOptions(user);
  const canUsePersonaFeatures = FORCE_PERSONA_ACCESS_PREVIEW || canUsePersona(user);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const referenceInputRef = useRef<HTMLInputElement>(null);
  const [selectedPersona, setSelectedPersona] = useState<PersonaOption | null>(null);
  const [uploadedImage, setUploadedImage] = useState<File | null>(null);
  const [uploadedImageUrl, setUploadedImageUrl] = useState<string | null>(null);
  const [referenceImage, setReferenceImage] = useState<File | null>(null);
  const [referenceImageUrl, setReferenceImageUrl] = useState<string | null>(null);
  const [studioPrompt, setStudioPrompt] = useState('');
  const [resultImage, setResultImage] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isPricingModalOpen, setIsPricingModalOpen] = useState(false);
  const [selectedAspect, setSelectedAspect] = useState<ImageAspectRatio>('portrait');
  const [selectedQuality, setSelectedQuality] = useState<ImageQuality>('hq');
  const [selectedGenerationMode, setSelectedGenerationMode] = useState<PersonaGenerationMode>('creative');
  const [selectedImageEngine, setSelectedImageEngine] = useState<PersonaImageEngineId>('flux-2-max');

  useEffect(() => {
    if (!uploadedImage) {
      setUploadedImageUrl(null);
      return;
    }

    const objectUrl = URL.createObjectURL(uploadedImage);
    setUploadedImageUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [uploadedImage]);

  useEffect(() => {
    if (!referenceImage) {
      setReferenceImageUrl(null);
      return;
    }

    const objectUrl = URL.createObjectURL(referenceImage);
    setReferenceImageUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [referenceImage]);

  const readyPersonas = useMemo(
    () => personaOptions.filter((option) => option.status === 'completed' || option.visualStatus === 'ready'),
    [personaOptions]
  );
  const trainingPersonas = useMemo(
    () => personaOptions.filter((option) =>
      (option.status === 'training' || option.visualStatus === 'training')
      && !(option.status === 'completed' || option.visualStatus === 'ready')
    ),
    [personaOptions]
  );
  const engineOptions = useMemo(
    () => getPersonaImageEngineOptions(Boolean(selectedPersona)),
    [selectedPersona]
  );
  const selectedPersonaTrainingEngine = selectedPersona
    ? getTrainingEngineLabel(selectedPersona.trainingBaseModel || selectedPersona.training_base_model)
    : null;

  const originalPreview = selectedPersona
    ? (referenceImageUrl || selectedPersona.imageUrl || selectedPersona.image_url || null)
    : uploadedImageUrl;

  const processingMessage = selectedPersona
    ? selectedGenerationMode === 'exact'
      ? 'Persona and reference image are being fused into a tighter exact-mode result...'
      : 'Persona reference is being rendered into a polished photo...'
    : uploadedImage
      ? 'Source photo is being rebuilt with a new studio background...'
      : 'Prompt is being turned into a polished image...';

  const clearUploadedImage = () => {
    setUploadedImage(null);
    setUploadedImageUrl(null);
  };

  const clearReferenceImage = () => {
    setReferenceImage(null);
    setReferenceImageUrl(null);
    setSelectedGenerationMode('creative');
    setSelectedImageEngine(selectedPersona ? 'flux-dev-lora' : 'flux-2-max');
  };

  const clearSelectedPersona = () => {
    setSelectedPersona(null);
    setReferenceImage(null);
    setReferenceImageUrl(null);
    setSelectedGenerationMode('creative');
    setSelectedImageEngine('flux-2-max');
  };

  const handlePickPersona = (persona: PersonaOption) => {
    if (!canUsePersonaFeatures) {
      setIsPricingModalOpen(true);
      showToast('Persona-based photo generation requires persona access.', 'warning');
      return;
    }
    clearUploadedImage();
    setSelectedPersona(persona);
    setSelectedGenerationMode(referenceImage ? 'exact' : 'creative');
    setSelectedImageEngine(referenceImage ? 'flux-kontext-lora' : 'flux-dev-lora');
    setResultImage(null);
  };

  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    clearSelectedPersona();
    clearReferenceImage();
    setUploadedImage(file);
    setSelectedGenerationMode('creative');
    setSelectedImageEngine('flux-2-max');
    setResultImage(null);
  };

  const handleReferenceUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setReferenceImage(file);
    setSelectedGenerationMode('exact');
    setSelectedImageEngine(selectedPersona ? 'flux-kontext-lora' : 'flux-kontext-pro');
    setResultImage(null);
  };

  const uploadImageForGeneration = async (file: File) => {
    const dataUrl = await fileToDataUrl(file);

    const uploadResponse = await fetch('/api/upload-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dataUrl,
        userId: user?.id,
      }),
    });
    const uploadData = await uploadResponse.json().catch(() => ({}));
    if (!uploadResponse.ok || typeof uploadData.publicUrl !== 'string' || !uploadData.publicUrl.trim()) {
      throw new Error(uploadData.error || uploadData.details || 'Reference image upload failed');
    }
    return uploadData.publicUrl.trim();
  };

  const refineWithNanoBanana = async (baseUrl: string, refinerEngine: PersonaImageEngineId, trimmedPrompt: string) => {
    const response = await fetch('/api/image/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: trimmedPrompt,
        subjectType: selectedPersona?.subjectType || selectedPersona?.subject_type,
        imageEngine: refinerEngine,
        refinePass: true,
        referenceImageUrl: baseUrl,
        aspectRatio: selectedAspect,
        qualityPreset: selectedQuality === 'hq' ? '1080p' : '720p',
        generationStrategy: selectedQuality === 'hq' ? 'premium' : 'standard',
        user,
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      showToast(data.error || 'Refine step failed — keeping the base image.', 'warning');
      return null;
    }
    const refinedUrl = data.output || data.imageUrl;
    return typeof refinedUrl === 'string' && refinedUrl.trim() ? refinedUrl.trim() : null;
  };

  const handleGenerate = async () => {
    const trimmedPrompt = studioPrompt.trim();
    if (!trimmedPrompt) {
      showToast('Describe the photo you want to create first.', 'warning');
      return;
    }

    const isNanoEngine =
      selectedImageEngine === 'nano-banana'
      || selectedImageEngine === 'nano-banana-2'
      || selectedImageEngine === 'nano-banana-pro';
    const selectedSubjectType = selectedPersona?.subjectType || selectedPersona?.subject_type || 'human';
    const shouldUseLoraIdentityBase =
      Boolean(selectedPersona)
      && (selectedSubjectType === 'human' || selectedSubjectType === 'product')
      && isNanoEngine;
    const baseImageEngine: PersonaImageEngineId = shouldUseLoraIdentityBase
      ? (selectedGenerationMode === 'exact' ? 'flux-kontext-lora' : 'flux-dev-lora')
      : selectedImageEngine;
    // Digital-twin refiner: respect the explicit Nano engine the user picked; otherwise pick the
    // strongest identity-preserving refiner for the chosen quality tier (Pro on HQ).
    const refinerEngine: PersonaImageEngineId =
      selectedImageEngine === 'nano-banana-pro'
        ? 'nano-banana-pro'
        : selectedImageEngine === 'nano-banana-2'
          ? 'nano-banana-2'
          : selectedImageEngine === 'nano-banana'
            ? 'nano-banana'
            : selectedQuality === 'hq'
              ? 'nano-banana-pro'
              : 'nano-banana-2';
    // Human persona identity must come from LoRA first; Nano Banana can then polish the LoRA render.
    // Product + Exact: keep the LoRA render — Nano refine often invents collage layouts and baked-in ad copy.
    const shouldRefine =
      shouldUseLoraIdentityBase
      && !(selectedSubjectType === 'product' && selectedGenerationMode === 'exact');

    setIsProcessing(true);
    setResultImage(null);

    try {
      let baseOutputUrl = '';
      let baseEngineLabel = '';

      if (selectedPersona || !uploadedImage || isNanoEngine) {
        // Nano Banana can edit a user's own uploaded photo directly via reference images.
        const referenceFile = referenceImage || (!selectedPersona && isNanoEngine ? uploadedImage : null);
        const uploadedReferenceUrl = referenceFile
          ? await uploadImageForGeneration(referenceFile)
          : undefined;
        const response = await fetch('/api/image/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: trimmedPrompt,
            personas: selectedPersona ? [selectedPersona] : undefined,
            personaIds: selectedPersona ? [selectedPersona.id] : undefined,
            triggerWord: selectedPersona?.triggerWord || selectedPersona?.trigger_word,
            personaModelId: selectedPersona?.modelId || selectedPersona?.model_id || selectedPersona?.id,
            trainingId:
              selectedPersona?.trainingId
              || selectedPersona?.training_id
              || selectedPersona?.modelId
              || selectedPersona?.model_id
              || selectedPersona?.id,
            destinationModel: selectedPersona?.destinationModel || selectedPersona?.destination_model,
            trainingBaseModel: selectedPersona?.trainingBaseModel || selectedPersona?.training_base_model,
            modelFamily: selectedPersona?.modelFamily || selectedPersona?.model_family,
            imageEngine: baseImageEngine,
            generationMode: selectedGenerationMode,
            referenceImageUrl: uploadedReferenceUrl,
            referenceImageUrls: selectedPersona?.referenceImages || selectedPersona?.reference_images,
            aspectRatio: selectedAspect,
            qualityPreset: selectedQuality === 'hq' ? '1080p' : '720p',
            generationStrategy: selectedPersona
              ? (selectedQuality === 'hq' ? 'premium' : 'standard')
              : 'standard',
            user,
          }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data.error || data.details || 'Failed to generate image');
        }
        const outputUrl = data.output || data.imageUrl;
        if (!outputUrl || typeof outputUrl !== 'string') {
          throw new Error('Image generation finished without an output URL');
        }
        baseOutputUrl = outputUrl;
        baseEngineLabel = data.engine || (selectedPersona ? baseImageEngine : 'black-forest-labs/flux-2-max');
      } else {
        const formData = new FormData();
        formData.append('image', uploadedImage);
        formData.append('prompt', trimmedPrompt);

        const response = await fetch('/api/background-change', {
          method: 'POST',
          body: formData,
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data.error || data.details || 'Failed to generate studio image');
        }
        if (!data.imageUrl || typeof data.imageUrl !== 'string') {
          throw new Error('Studio background flow returned no image');
        }
        baseOutputUrl = data.imageUrl;
        baseEngineLabel = data.engine || 'bria/generate-background';
      }

      // Show the base render immediately, then optionally polish it.
      setResultImage(baseOutputUrl);

      let finalUrl = baseOutputUrl;
      let finalEngineLabel = baseEngineLabel;

      if (shouldRefine && baseOutputUrl) {
        showToast('Identity base ready — Nano Banana is rebuilding the shot from your prompt...', 'info');
        const refinedUrl = await refineWithNanoBanana(baseOutputUrl, refinerEngine, trimmedPrompt);
        if (refinedUrl) {
          finalUrl = refinedUrl;
          finalEngineLabel = refinerEngine;
          setResultImage(refinedUrl);
        }
      }

      if (typeof window !== 'undefined') {
        const { saveImageAsset } = await import('@/lib/assets-storage');
        saveImageAsset(finalUrl, `Image Studio - ${new Date().toLocaleDateString()}`, {
          model: finalEngineLabel,
          prompt: trimmedPrompt,
        });
      }
      showToast(
        shouldUseLoraIdentityBase && finalUrl !== baseOutputUrl
          ? 'Persona image ready (LoRA identity → Nano polish)!'
          : selectedPersona
            ? 'Persona photo is ready!'
            : uploadedImage && !isNanoEngine
              ? 'Source photo rebuilt successfully!'
              : 'Image is ready!',
        'success'
      );
    } catch (error: unknown) {
      showToast(error instanceof Error ? error.message : 'Failed to process image', 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="relative min-h-screen bg-black text-white">
      <AuroraBackground />
      <Sidebar onSubscriptionClick={() => setIsPricingModalOpen(true)} />
      <PricingModal isOpen={isPricingModalOpen} onClose={() => setIsPricingModalOpen(false)} />

      <main className="relative z-10 ml-64 px-6 py-10">
        <div className="mx-auto max-w-6xl">
          <div className="mb-8">
            <Link href="/" className="mb-4 inline-block text-[#00d9ff] transition-colors hover:text-[#0099ff]">
              ← Back to Studio
            </Link>
            <div className="mb-3 flex items-center gap-3">
              <ImageIcon className="h-8 w-8 text-[#8b5cf6]" style={{ filter: 'drop-shadow(0 0 8px #8b5cf6)' }} />
              <h1 className="text-4xl font-bold">
                <span className="bg-gradient-to-r from-[#8b5cf6] via-[#6366f1] to-[#8b5cf6] bg-clip-text text-transparent">
                  Image Studio
                </span>
              </h1>
            </div>
            <p className="max-w-3xl text-lg text-gray-400">
              Use the exact same persona logic as video: pick a trained persona, write a prompt, and get a polished photo.
              Or upload a source photo and rebuild only the environment around it.
            </p>
          </div>

          <section className="grid gap-6 xl:grid-cols-[minmax(0,1.55fr)_360px] xl:items-start">
            <div className="space-y-6">
              <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-6 shadow-[0_0_0_1px_rgba(255,255,255,0.05)]">
                <div className="mb-4 flex flex-wrap gap-2">
                  {selectedPersona && (
                    <span className="inline-flex items-center gap-2 rounded-full bg-blue-500/20 px-3 py-1 text-sm text-blue-200">
                      👤 {selectedPersona.name || 'Persona'}
                      <button
                        type="button"
                        onClick={clearSelectedPersona}
                        className="rounded-full bg-blue-500/30 p-1 hover:bg-blue-500/40"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  )}
                  {uploadedImage && (
                    <span className="inline-flex items-center gap-2 rounded-full bg-emerald-500/20 px-3 py-1 text-sm text-emerald-200">
                      🖼️ {uploadedImage.name}
                      <button
                        type="button"
                        onClick={clearUploadedImage}
                        className="rounded-full bg-emerald-500/30 p-1 hover:bg-emerald-500/40"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  )}
                  {referenceImage && selectedPersona && (
                    <span className="inline-flex items-center gap-2 rounded-full bg-fuchsia-500/20 px-3 py-1 text-sm text-fuchsia-200">
                      🎯 {referenceImage.name}
                      <button
                        type="button"
                        onClick={clearReferenceImage}
                        className="rounded-full bg-fuchsia-500/30 p-1 hover:bg-fuchsia-500/40"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  )}
                  {!selectedPersona && !uploadedImage && (
                    <span className="inline-flex items-center gap-2 rounded-full bg-white/5 px-3 py-1 text-sm text-gray-400">
                      Add a persona, then optionally add a reference image for exact mode
                    </span>
                  )}
                </div>

                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-[0.2em] text-gray-500">Prompt</p>
                    <p className="mt-1 text-sm text-gray-400">
                      Describe the final shot, lighting, styling, and scene feel.
                    </p>
                  </div>
                  <div className="hidden rounded-full border border-white/10 bg-black/30 px-3 py-1 text-xs text-gray-400 sm:block">
                    {selectedPersona ? 'Persona Flow' : uploadedImage ? 'Source Photo Flow' : 'Prompt Flow'}
                  </div>
                </div>

                <textarea
                  value={studioPrompt}
                  onChange={(event) => setStudioPrompt(event.target.value)}
                  placeholder="Describe the final image. Example: luxury fashion portrait, clean editorial studio, glossy floor reflections, dramatic rim light, premium campaign photography."
                  rows={5}
                  className="min-h-[210px] w-full resize-none rounded-2xl border border-white/10 bg-black/30 px-4 py-4 text-base text-white outline-none placeholder:text-gray-500"
                />

                <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-4">
                  <div className="flex max-w-2xl items-start gap-2 text-sm text-gray-400">
                    <Sparkles className="h-4 w-4 text-[#fbbf24]" />
                    <span>
                      {selectedPersona
                        ? selectedGenerationMode === 'exact'
                          ? 'Exact mode active: the output will lock closer to your persona and reference.'
                          : 'Persona selected: the image will follow your trained identity.'
                        : uploadedImage
                          ? 'Source photo selected: the environment will be rebuilt around it.'
                          : 'Prompt-only mode: generate a fresh image from text.'}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={handleGenerate}
                    disabled={isProcessing}
                    className="w-full rounded-xl bg-gradient-to-r from-[#00d9ff] to-[#0099cc] px-6 py-3 text-sm font-semibold text-black hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
                  >
                    {isProcessing ? 'Generating...' : 'Create Photo'}
                  </button>
                </div>
              </div>

              <PreviewArea
                originalImage={originalPreview}
                resultImage={resultImage}
                isProcessing={isProcessing}
                processingMessage={processingMessage}
              />
            </div>

            <div className="space-y-4 xl:sticky xl:top-8">
              <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-5">
                <div className="mb-4 flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                  <h2 className="text-lg font-semibold">Inputs</h2>
                </div>
                <p className="mb-5 text-sm text-gray-400">
                  Pick one identity source first, then optionally tighten it with a reference image.
                </p>

                <div className="space-y-5">
                  <div>
                    <div className="mb-2 flex items-center justify-between">
                      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Visual Persona</p>
                      {!canUsePersonaFeatures && (
                        <button
                          type="button"
                          onClick={() => setIsPricingModalOpen(true)}
                          className="text-[11px] text-yellow-300 hover:text-yellow-200"
                        >
                          Premium
                        </button>
                      )}
                    </div>
                    <div className="max-h-[220px] overflow-y-auto rounded-2xl border border-white/10 bg-black/40 p-1">
                      {readyPersonas.length === 0 && trainingPersonas.length === 0 && (
                        <p className="p-3 text-xs text-gray-500">No personas found yet.</p>
                      )}
                      {readyPersonas.map((option) => {
                        const isActive = selectedPersona?.id === option.id;
                        return (
                          <button
                            key={option.id}
                            type="button"
                            onClick={() => handlePickPersona(option)}
                            className={`mb-1 flex w-full items-center gap-3 rounded-2xl border px-3 py-2.5 text-left transition-all last:mb-0 ${
                              isActive
                                ? 'border-blue-500 bg-blue-500/10 text-white shadow-[0_0_15px_rgba(59,130,246,0.2)]'
                                : 'border-transparent bg-transparent text-white hover:border-white/10 hover:bg-white/5'
                            }`}
                          >
                            <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-indigo-500/80 to-sky-500/80">
                              {option.imageUrl || option.image_url ? (
                                <span
                                  aria-hidden="true"
                                  className="h-full w-full bg-cover bg-center"
                                  style={{ backgroundImage: `url(${option.imageUrl || option.image_url})` }}
                                />
                              ) : (
                                <UserRound className="h-4 w-4 text-white" />
                              )}
                            </span>
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-medium">{option.name || 'Persona'}</span>
                              <span className="block truncate text-xs text-gray-400">
                                {getTrainingEngineLabel(option.trainingBaseModel || option.training_base_model || option.modelFamily || option.model_family || 'flux-lora')}
                              </span>
                            </span>
                          </button>
                        );
                      })}
                      {trainingPersonas.length > 0 && (
                        <div className="border-t border-white/10 px-3 py-2 text-[11px] uppercase tracking-wide text-gray-500">
                          Training
                        </div>
                      )}
                      {trainingPersonas.map((option) => (
                        <div key={option.id} className="flex items-center gap-3 px-3 py-2 text-sm text-gray-500 opacity-70">
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-[10px] font-semibold text-white/60">
                            {(option.name || 'P').trim().charAt(0).toUpperCase()}
                          </span>
                          <span className="truncate">{option.name || 'Persona'}</span>
                          <span className="ml-auto text-[10px] uppercase text-white/40">{option.status || 'training'}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {selectedPersona && (
                    <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-xs font-medium uppercase tracking-wide text-cyan-200">Active Persona</p>
                          <p className="mt-1 text-sm text-white">{selectedPersona.name || 'Persona'}</p>
                          <p className="mt-1 text-xs text-cyan-100/80">
                            Training: {selectedPersonaTrainingEngine || 'Unknown trainer'}
                          </p>
                        </div>
                        <span className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-2.5 py-1 text-[11px] uppercase tracking-wide text-cyan-100">
                          {selectedGenerationMode}
                        </span>
                      </div>
                      <p className="mt-3 text-xs leading-5 text-cyan-100/80">
                        Creative mode works best with `FLUX Dev LoRA`. Exact mode works best with `FLUX Kontext LoRA`, and a reference image is recommended.
                      </p>
                    </div>
                  )}

                  {selectedPersona && (
                    <div>
                      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">Reference Image</p>
                      <input
                        ref={referenceInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={handleReferenceUpload}
                      />
                      {referenceImageUrl ? (
                        <div className="flex items-center gap-3 rounded-2xl border border-fuchsia-500/25 bg-fuchsia-500/5 p-2.5">
                          <span
                            aria-hidden="true"
                            className="h-14 w-14 shrink-0 rounded-xl bg-cover bg-center"
                            style={{ backgroundImage: `url(${referenceImageUrl})` }}
                          />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm text-white">{referenceImage?.name || 'Reference image'}</p>
                            <p className="text-xs text-fuchsia-200/70">Guiding the exact look</p>
                          </div>
                          <button
                            type="button"
                            onClick={clearReferenceImage}
                            className="shrink-0 rounded-full bg-white/10 p-1.5 text-gray-300 hover:bg-white/20"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => referenceInputRef.current?.click()}
                          className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-fuchsia-500/25 bg-fuchsia-500/5 px-4 py-4 text-sm text-fuchsia-100 hover:border-fuchsia-400/40"
                        >
                          <Upload className="h-4 w-4" />
                          Upload an optional reference image
                        </button>
                      )}
                    </div>
                  )}

                  <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Use your own photo</p>
                      <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-wide text-gray-500">No persona needed</span>
                    </div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleImageUpload}
                    />
                    {uploadedImageUrl ? (
                      <div className="flex items-center gap-3 rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-2.5">
                        <span
                          aria-hidden="true"
                          className="h-14 w-14 shrink-0 rounded-xl bg-cover bg-center"
                          style={{ backgroundImage: `url(${uploadedImageUrl})` }}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm text-white">{uploadedImage?.name || 'Your photo'}</p>
                          <p className="text-xs text-emerald-200/70">The scene will be rebuilt around it</p>
                        </div>
                        <button
                          type="button"
                          onClick={clearUploadedImage}
                          className="shrink-0 rounded-full bg-white/10 p-1.5 text-gray-300 hover:bg-white/20"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-white/15 bg-black/30 px-4 py-4 text-sm text-gray-300 hover:border-[#00d9ff]/40 hover:text-white"
                      >
                        <Upload className="h-4 w-4" />
                        Upload a photo to use as the subject
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-5">
                <div className="mb-4 flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                  <h2 className="text-lg font-semibold">Generation Setup</h2>
                </div>
                <p className="mb-5 text-sm text-gray-400">
                  Fine-tune the output after you choose your persona or source photo.
                </p>

                <div className="space-y-5">
                  <div>
                    <div className="mb-2 flex items-center justify-between">
                      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Aspect Ratio</p>
                      <span className="text-[11px] uppercase tracking-wide text-gray-500">{selectedAspect}</span>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      {ASPECT_OPTIONS.map((option) => (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() => setSelectedAspect(option.id)}
                          className={getOptionButtonClass(selectedAspect === option.id, true)}
                        >
                          <div className="text-sm font-medium">{option.title}</div>
                          <div className="mt-1 text-[11px] leading-4 text-gray-400">{option.hint}</div>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="mb-2 flex items-center justify-between">
                      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Quality</p>
                      <span className="text-[11px] uppercase tracking-wide text-gray-500">{selectedQuality}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {QUALITY_OPTIONS.map((option) => (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() => setSelectedQuality(option.id)}
                          className={getOptionButtonClass(selectedQuality === option.id, true)}
                        >
                          <div className="text-sm font-medium">{option.title}</div>
                          <div className="mt-1 text-[11px] leading-4 text-gray-400">{option.hint}</div>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="mb-2 flex items-center justify-between">
                      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Generation Mode</p>
                      <span className="text-[11px] uppercase tracking-wide text-gray-500">{selectedGenerationMode}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {GENERATION_MODE_OPTIONS.map((option) => (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() => {
                            setSelectedGenerationMode(option.id);
                            const keepNano =
                              selectedImageEngine === 'nano-banana'
                              || selectedImageEngine === 'nano-banana-2'
                              || selectedImageEngine === 'nano-banana-pro';
                            if (keepNano) return;
                            if (selectedPersona) {
                              setSelectedImageEngine(option.id === 'exact' ? 'flux-kontext-lora' : 'flux-dev-lora');
                            } else {
                              setSelectedImageEngine(option.id === 'exact' ? 'flux-kontext-pro' : 'flux-2-max');
                            }
                          }}
                          className={getOptionButtonClass(selectedGenerationMode === option.id, true)}
                        >
                          <div className="text-sm font-medium">{option.title}</div>
                          <div className="mt-1 text-[11px] leading-4 text-gray-400">{option.hint}</div>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="mb-2 flex items-center justify-between">
                      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Image Engine</p>
                      <span className="text-[11px] uppercase tracking-wide text-gray-500">Selected</span>
                    </div>
                    <div className="grid gap-2">
                      {engineOptions.map((option) => (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() => setSelectedImageEngine(option.id)}
                          className={getOptionButtonClass(selectedImageEngine === option.id)}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="text-sm font-medium">{option.label}</div>
                            {ENGINE_TAGS[option.id] && (
                              <span className="shrink-0 rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-200">
                                {ENGINE_TAGS[option.id]}
                              </span>
                            )}
                          </div>
                          <div className="mt-1 text-xs leading-5 text-gray-400">{option.description}</div>
                          {selectedImageEngine === option.id && (
                            <div className="mt-3 text-[11px] font-medium uppercase tracking-wide text-cyan-200">
                              Active engine
                            </div>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-cyan-500/15 bg-cyan-500/[0.04] p-4">
                    <div className="flex items-center gap-2">
                      <Sparkles className="h-3.5 w-3.5 text-cyan-300" />
                      <p className="text-xs font-medium uppercase tracking-wide text-cyan-200/80">Current Flow</p>
                    </div>
                    <p className="mt-2 text-sm text-white">
                      {selectedPersona
                        ? selectedGenerationMode === 'exact'
                          ? 'Persona + reference image + exact rendering'
                          : 'Persona-driven creative rendering'
                        : uploadedImage
                          ? 'Source photo environment rebuild'
                          : 'Prompt-only image generation'}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
