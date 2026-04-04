'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, Image as ImageIcon, Loader2, Sparkles, Upload, UserRound, X } from 'lucide-react';
import Sidebar from '@/components/Sidebar';
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

export default function ImageStudioPage() {
  const { showToast } = useToast();
  const { user } = usePersona();
  const { personaOptions } = usePersonaOptions(user);
  const canUsePersonaFeatures = canUsePersona(user);
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

  const handleGenerate = async () => {
    const trimmedPrompt = studioPrompt.trim();
    if (!trimmedPrompt) {
      showToast('Describe the photo you want to create first.', 'warning');
      return;
    }

    setIsProcessing(true);
    setResultImage(null);

    try {
      if (selectedPersona || !uploadedImage) {
        const uploadedReferenceUrl = referenceImage
          ? await uploadImageForGeneration(referenceImage)
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
            trainingId: (selectedPersona as any)?.trainingId || (selectedPersona as any)?.training_id || selectedPersona?.modelId || selectedPersona?.model_id || selectedPersona?.id,
            destinationModel: selectedPersona?.destinationModel || selectedPersona?.destination_model,
            trainingBaseModel: selectedPersona?.trainingBaseModel || selectedPersona?.training_base_model,
            modelFamily: selectedPersona?.modelFamily || selectedPersona?.model_family,
            imageEngine: selectedImageEngine,
            generationMode: selectedGenerationMode,
            referenceImageUrl: uploadedReferenceUrl,
            referenceImageUrls: selectedPersona?.referenceImages || selectedPersona?.reference_images,
            aspectRatio: selectedAspect,
            qualityPreset: selectedQuality === 'hq' ? '1080p' : '720p',
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
        setResultImage(outputUrl);
        if (typeof window !== 'undefined') {
          const { saveImageAsset } = await import('@/lib/assets-storage');
          saveImageAsset(outputUrl, `Image Studio - ${new Date().toLocaleDateString()}`, {
            model: data.engine || (selectedPersona ? selectedImageEngine : 'black-forest-labs/flux-2-max'),
            prompt: trimmedPrompt,
          });
        }
        showToast(selectedPersona ? 'Persona photo is ready!' : 'Image is ready!', 'success');
        return;
      }

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
      setResultImage(data.imageUrl);
      if (typeof window !== 'undefined') {
        const { saveImageAsset } = await import('@/lib/assets-storage');
        saveImageAsset(data.imageUrl, `Image Studio - ${new Date().toLocaleDateString()}`, {
          model: 'runwayml/stable-diffusion-inpainting',
          prompt: trimmedPrompt,
        });
      }
      showToast('Source photo rebuilt successfully!', 'success');
    } catch (error: any) {
      showToast(error.message || 'Failed to process image', 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="min-h-screen bg-black text-white">
      <Sidebar onSubscriptionClick={() => setIsPricingModalOpen(true)} />
      <PricingModal isOpen={isPricingModalOpen} onClose={() => setIsPricingModalOpen(false)} />

      <main className="ml-64 px-6 py-10">
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

          <section className="grid gap-8 lg:grid-cols-[1.5fr_1fr]">
            <div className="space-y-6">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-5 shadow-[0_0_0_1px_rgba(255,255,255,0.05)]">
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

                <textarea
                  value={studioPrompt}
                  onChange={(event) => setStudioPrompt(event.target.value)}
                  placeholder="Describe the final image. Example: luxury fashion portrait, clean editorial studio, glossy floor reflections, dramatic rim light, premium campaign photography."
                  rows={6}
                  className="w-full resize-none bg-transparent px-1 text-base text-white outline-none placeholder:text-gray-500"
                />

                <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-4">
                  <div className="flex items-center gap-2 text-sm text-gray-400">
                    <Sparkles className="h-4 w-4 text-[#fbbf24]" />
                    {selectedPersona
                      ? selectedGenerationMode === 'exact'
                        ? 'Exact mode active: the output will lock closer to your persona and reference.'
                        : 'Persona selected: the image will follow your trained identity.'
                      : uploadedImage
                        ? 'Source photo selected: the environment will be rebuilt around it.'
                        : 'Prompt-only mode: generate a fresh image from text.'}
                  </div>
                  <button
                    type="button"
                    onClick={handleGenerate}
                    disabled={isProcessing}
                    className="rounded-xl bg-gradient-to-r from-[#00d9ff] to-[#0099cc] px-6 py-3 text-sm font-semibold text-black hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
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

            <div className="space-y-6">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
                <div className="mb-4 flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                  <h2 className="text-lg font-semibold">Generation Setup</h2>
                </div>

                <div className="space-y-5">
                  <div>
                    <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">Aspect Ratio</p>
                    <div className="grid gap-2">
                      {ASPECT_OPTIONS.map((option) => (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() => setSelectedAspect(option.id)}
                          className={`rounded-xl border px-3 py-3 text-left transition-colors ${
                            selectedAspect === option.id
                              ? 'border-white/30 bg-white/10 text-white'
                              : 'border-white/10 bg-white/5 text-gray-300 hover:bg-white/10'
                          }`}
                        >
                          <div className="text-sm font-medium">{option.title}</div>
                          <div className="text-xs text-gray-400">{option.hint}</div>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">Quality</p>
                    <div className="grid gap-2">
                      {QUALITY_OPTIONS.map((option) => (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() => setSelectedQuality(option.id)}
                          className={`rounded-xl border px-3 py-3 text-left transition-colors ${
                            selectedQuality === option.id
                              ? 'border-white/30 bg-white/10 text-white'
                              : 'border-white/10 bg-white/5 text-gray-300 hover:bg-white/10'
                          }`}
                        >
                          <div className="text-sm font-medium">{option.title}</div>
                          <div className="text-xs text-gray-400">{option.hint}</div>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">Generation Mode</p>
                    <div className="grid gap-2">
                      {([
                        {
                          id: 'creative' as const,
                          title: 'Creative',
                          hint: 'Best for new scenes, bigger composition changes, and prompt freedom.',
                        },
                        {
                          id: 'exact' as const,
                          title: 'Exact',
                          hint: 'Best for tighter identity lock. A reference image is recommended.',
                        },
                      ]).map((option) => (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() => {
                            setSelectedGenerationMode(option.id);
                            if (selectedPersona) {
                              setSelectedImageEngine(option.id === 'exact' ? 'flux-kontext-lora' : 'flux-dev-lora');
                            } else {
                              setSelectedImageEngine(option.id === 'exact' ? 'flux-kontext-pro' : 'flux-2-max');
                            }
                          }}
                          className={`rounded-xl border px-3 py-3 text-left transition-colors ${
                            selectedGenerationMode === option.id
                              ? 'border-white/30 bg-white/10 text-white'
                              : 'border-white/10 bg-white/5 text-gray-300 hover:bg-white/10'
                          }`}
                        >
                          <div className="text-sm font-medium">{option.title}</div>
                          <div className="text-xs text-gray-400">{option.hint}</div>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">Image Engine</p>
                    <div className="grid gap-2">
                      {engineOptions.map((option) => (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() => setSelectedImageEngine(option.id)}
                          className={`rounded-xl border px-3 py-3 text-left transition-colors ${
                            selectedImageEngine === option.id
                              ? 'border-white/30 bg-white/10 text-white'
                              : 'border-white/10 bg-white/5 text-gray-300 hover:bg-white/10'
                          }`}
                        >
                          <div className="text-sm font-medium">{option.label}</div>
                          <div className="text-xs text-gray-400">{option.description}</div>
                        </button>
                      ))}
                    </div>
                  </div>

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
                    <div className="max-h-[260px] overflow-y-auto rounded-xl border border-white/10 bg-black/40">
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
                            className={`m-1 flex w-[calc(100%-0.5rem)] items-center gap-3 rounded-xl border px-3 py-3 text-left transition-all ${
                              isActive
                                ? 'border-blue-500 bg-blue-500/10 text-white shadow-[0_0_15px_rgba(59,130,246,0.3)]'
                                : 'border-transparent bg-transparent text-white hover:border-white/10 hover:bg-white/5'
                            }`}
                          >
                            <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-indigo-500/80 to-sky-500/80">
                              {option.imageUrl || option.image_url ? (
                                <img
                                  src={option.imageUrl || option.image_url}
                                  alt={option.name || 'Persona'}
                                  className="h-full w-full object-cover"
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
                    <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-4">
                      <p className="text-xs font-medium uppercase tracking-wide text-cyan-200">Persona Engine Stack</p>
                      <p className="mt-2 text-sm text-white">
                        Training: {selectedPersonaTrainingEngine || 'Unknown trainer'}
                      </p>
                      <p className="mt-1 text-xs text-cyan-100/80">
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
                      <button
                        type="button"
                        onClick={() => referenceInputRef.current?.click()}
                        className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-fuchsia-500/25 bg-fuchsia-500/5 px-4 py-5 text-sm text-fuchsia-100 hover:border-fuchsia-400/40"
                      >
                        <Upload className="h-4 w-4" />
                        Upload an optional reference image (recommended for exact mode)
                      </button>
                      {referenceImage && (
                        <button
                          type="button"
                          onClick={clearReferenceImage}
                          className="mt-3 w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-gray-300 hover:bg-white/10"
                        >
                          Remove reference image
                        </button>
                      )}
                    </div>
                  )}

                  <div>
                    <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">Source Photo</p>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleImageUpload}
                    />
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-white/15 bg-black/30 px-4 py-5 text-sm text-gray-300 hover:border-[#00d9ff]/40 hover:text-white"
                    >
                      <Upload className="h-4 w-4" />
                      {selectedPersona
                        ? 'Upload a real photo instead of using the selected persona'
                        : 'Upload a real photo instead of using a persona'}
                    </button>
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
