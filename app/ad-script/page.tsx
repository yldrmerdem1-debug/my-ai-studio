'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CheckCircle2, FileText, Link2, Loader2, Sparkles, UserRound, X } from 'lucide-react';
import Sidebar from '@/components/Sidebar';
import AuroraBackground from '@/components/AuroraBackground';
import PricingModal from '@/components/PricingModal';
import {
  AUTO_EDITOR_SESSION_KEY,
  createEditorSessionFromDirectorPlan,
  type DirectorResponse,
  type DirectorScenario,
  type DirectorStoredPayload,
} from '@/lib/ad-director';
import { canUsePersona } from '@/lib/subscription';
import { usePersona } from '@/hooks/usePersona';
import { usePersonaOptions, type PersonaOption } from '@/hooks/usePersonaOptions';
import { fileToDataUrl } from '@/lib/client/file-data-url';

const PLATFORM_OPTIONS = ['Instagram', 'TikTok', 'YouTube', 'Facebook', 'LinkedIn', 'Podcast'];
const TONE_OPTIONS = ['Premium', 'Modern', 'Confident', 'Playful', 'Minimal'];
const DURATION_OPTIONS = ['6 seconds', '15 seconds', '30 seconds', '60 seconds', '90 seconds'];
const OBJECTIVE_OPTIONS = ['Brand awareness', 'Conversions', 'Product launch', 'App installs', 'Lead gen'];

const getPersonaImageUrl = (persona: PersonaOption | null) =>
  persona?.referenceImages?.[0]?.url
  || persona?.reference_images?.[0]?.url
  || persona?.imageUrl
  || persona?.image_url
  || '';

const getPersonaReferenceImageUrls = (persona: PersonaOption | null) => {
  if (!persona) return [];
  const values = [
    ...(persona.referenceImages?.map((item) => item.url) || []),
    ...(persona.reference_images?.map((item) => item.url) || []),
    persona.imageUrl,
    persona.image_url,
  ];
  return Array.from(new Set(values.filter((value): value is string => Boolean(value?.trim()))));
};

const getPersonaModelId = (persona: PersonaOption | null) =>
  persona?.modelId
  || persona?.model_id
  || persona?.trainingId
  || persona?.training_id
  || '';

const getPersonaDestinationModel = (persona: PersonaOption | null) =>
  persona?.destinationModel || persona?.destination_model || '';

export default function AdScriptPage() {
  const router = useRouter();
  const { user } = usePersona();
  const { personaOptions } = usePersonaOptions(user);
  const canUsePersonaFeatures = canUsePersona(user);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [productUrl, setProductUrl] = useState('');
  const [productBrief, setProductBrief] = useState('');
  const [productImageUrl, setProductImageUrl] = useState('');
  const [platform, setPlatform] = useState('');
  const [tone, setTone] = useState('');
  const [duration, setDuration] = useState('');
  const [objective, setObjective] = useState('');
  const [audience, setAudience] = useState('');
  const [selectedPersonaId, setSelectedPersonaId] = useState('');
  const [scenarios, setScenarios] = useState<DirectorScenario[]>([]);
  const [analysis, setAnalysis] = useState<DirectorResponse['analysis'] | null>(null);
  const [recommendations, setRecommendations] = useState<DirectorResponse['recommendations'] | null>(null);
  const [personaAnalysis, setPersonaAnalysis] = useState<DirectorResponse['personaAnalysis'] | null>(null);
  const [sourceContext, setSourceContext] = useState<DirectorResponse['sourceContext'] | null>(null);
  const [recommendation, setRecommendation] = useState('');
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [productImageFile, setProductImageFile] = useState<File | null>(null);
  const [productImagePreview, setProductImagePreview] = useState<string | null>(null);
  const [uploadedProductImageUrl, setUploadedProductImageUrl] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [isPricingModalOpen, setIsPricingModalOpen] = useState(false);

  const readyPersonas = useMemo(
    () => personaOptions.filter((option) => option.status === 'completed' || option.visualStatus === 'ready'),
    [personaOptions]
  );
  const selectedPersona = useMemo(
    () => readyPersonas.find((option) => option.id === selectedPersonaId) || null,
    [readyPersonas, selectedPersonaId]
  );
  const selectedScenario = useMemo(
    () => (selectedIndex !== null ? scenarios[selectedIndex] : null),
    [scenarios, selectedIndex]
  );
  const effectiveProductImageUrl =
    uploadedProductImageUrl || productImageUrl.trim() || sourceContext?.resolvedProductImageUrl || '';

  useEffect(() => {
    if (!productImageFile) {
      setProductImagePreview(null);
      return;
    }

    const objectUrl = URL.createObjectURL(productImageFile);
    setProductImagePreview(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [productImageFile]);

  const handleProductImageUpload = async (file: File | null) => {
    if (!file) return;

    setProductImageFile(file);
    setUploadedProductImageUrl('');
    setErrorMessage('');
    setIsUploadingImage(true);

    try {
      const dataUrl = await fileToDataUrl(file);
      const response = await fetch('/api/upload-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataUrl, userId: user?.id }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || data.details || 'Failed to upload product image');
      }
      if (!data.publicUrl || typeof data.publicUrl !== 'string') {
        throw new Error('Image upload succeeded but no public URL was returned');
      }
      setUploadedProductImageUrl(data.publicUrl);
    } catch (error: unknown) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to upload product image');
    } finally {
      setIsUploadingImage(false);
    }
  };

  const handleGenerate = async () => {
    if (!productUrl.trim() && !productBrief.trim() && !productImageUrl.trim() && !uploadedProductImageUrl) {
      setErrorMessage('Please add a product link, product image, or describe the offer.');
      return;
    }

    if (isUploadingImage) {
      setErrorMessage('Please wait for the product image upload to finish.');
      return;
    }

    setIsLoading(true);
    setErrorMessage('');
    setScenarios([]);
    setAnalysis(null);
    setRecommendations(null);
    setPersonaAnalysis(null);
    setSourceContext(null);
    setRecommendation('');
    setSelectedIndex(null);

    try {
      const response = await fetch('/api/ad-script', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productUrl: productUrl.trim() || undefined,
          productBrief: productBrief.trim() || undefined,
          productImageUrl: uploadedProductImageUrl || productImageUrl.trim() || undefined,
          platform: platform || undefined,
          tone: tone || undefined,
          duration: duration || undefined,
          objective: objective || undefined,
          audience: audience || undefined,
          persona: selectedPersona
            ? {
                destinationModel: getPersonaDestinationModel(selectedPersona) || undefined,
                id: selectedPersona.id,
                imageUrl: getPersonaImageUrl(selectedPersona) || undefined,
                modelFamily: selectedPersona.modelFamily || selectedPersona.model_family,
                modelId: getPersonaModelId(selectedPersona) || undefined,
                name: selectedPersona.name || undefined,
                referenceImageUrls: getPersonaReferenceImageUrls(selectedPersona),
                trainingId: selectedPersona.trainingId || selectedPersona.training_id,
                trainingBaseModel: selectedPersona.trainingBaseModel || selectedPersona.training_base_model,
                triggerWord: selectedPersona.triggerWord || selectedPersona.trigger_word,
              }
            : undefined,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || data.details || 'Failed to generate director plan');
      }

      setScenarios(Array.isArray(data.scenarios) ? data.scenarios : []);
      setAnalysis(data.analysis ?? null);
      setRecommendations(data.recommendations ?? null);
      setPersonaAnalysis(data.personaAnalysis ?? null);
      setSourceContext(data.sourceContext ?? null);
      setRecommendation(typeof data.recommendation === 'string' ? data.recommendation : '');
      if (Array.isArray(data.scenarios) && data.scenarios.length > 0) {
        setSelectedIndex(0);
      }
    } catch (error: unknown) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to generate director plan');
    } finally {
      setIsLoading(false);
    }
  };

  const handleApprove = async (destination: 'video' | 'editor') => {
    if (!selectedScenario) {
      setErrorMessage('Select a scenario before continuing.');
      return;
    }

    const payload: DirectorStoredPayload = {
      analysis: analysis ?? {
        audienceInsights: [],
        keyFeatures: [],
        offerHighlights: [],
        platformFit: [],
        summary: '',
        visualObservations: [],
      },
      createdAt: new Date().toISOString(),
      inputs: {
        audience,
        duration,
        objective,
        persona: selectedPersona
          ? {
              destinationModel: getPersonaDestinationModel(selectedPersona) || undefined,
              id: selectedPersona.id,
              imageUrl: getPersonaImageUrl(selectedPersona) || undefined,
              modelFamily: selectedPersona.modelFamily || selectedPersona.model_family,
              modelId: getPersonaModelId(selectedPersona) || undefined,
              name: selectedPersona.name || undefined,
              referenceImageUrls: getPersonaReferenceImageUrls(selectedPersona),
              trainingId: selectedPersona.trainingId || selectedPersona.training_id,
              trainingBaseModel: selectedPersona.trainingBaseModel || selectedPersona.training_base_model,
              triggerWord: selectedPersona.triggerWord || selectedPersona.trigger_word,
            }
          : null,
        platform,
        productBrief: productBrief.trim(),
        productImageUrl: uploadedProductImageUrl || productImageUrl.trim() || undefined,
        productUrl: productUrl.trim(),
        tone,
      },
      personaAnalysis: personaAnalysis ?? null,
      recommendation,
      recommendations: recommendations ?? {
        engineReason: '',
        needsPersona: false,
        needsReferenceImage: false,
        productionNotes: [],
        recommendedAspectRatio: '16:9',
        recommendedDuration: 5,
        recommendedEngine: 'runway',
        recommendedQuality: '720p',
        riskNotes: [],
      },
      scenario: selectedScenario,
      scenarios,
      sourceContext: sourceContext ?? {
        extractedSignals: [],
        fetchedPage: false,
      },
    };

    if (typeof window !== 'undefined') {
      localStorage.setItem('adDirectorPlan', JSON.stringify(payload));
      localStorage.setItem(AUTO_EDITOR_SESSION_KEY, JSON.stringify(createEditorSessionFromDirectorPlan(payload)));
      const { saveScriptAsset } = await import('@/lib/assets-storage');
      saveScriptAsset(
        selectedScenario.plan.audio_script || selectedScenario.plan.visual_prompt || productBrief.trim(),
        `AI Director Script - ${new Date().toLocaleDateString()}`,
        {
          model: recommendations?.recommendedEngine || 'ai-director',
          prompt: productBrief.trim(),
          platform,
          destination,
        }
      );
    }
    router.push(destination === 'editor' ? '/ad-creation?from=director' : '/video?from=director');
  };

  const handlePersonaSelect = (personaId: string) => {
    if (personaId && !canUsePersonaFeatures) {
      setIsPricingModalOpen(true);
      return;
    }
    setSelectedPersonaId(personaId);
  };

  return (
    <div className="relative min-h-screen bg-[#050505]">
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
              <FileText className="w-8 h-8 text-[#00d9ff]" style={{ filter: 'drop-shadow(0 0 8px #00d9ff)' }} />
              <h1 className="text-4xl font-bold text-white">
                <span className="bg-gradient-to-r from-[#00d9ff] via-[#0099cc] to-[#00d9ff] bg-clip-text text-transparent">
                  AI Director
                </span>
              </h1>
            </div>
            <p className="text-gray-400 text-lg">
              Deep campaign analysis for your offer. Feed a link, visuals, and an optional persona to get a grounded production plan.
            </p>
          </div>

          <section className="grid grid-cols-1 lg:grid-cols-2 gap-8 perf-section">
            <div className="glass rounded-2xl p-8 space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2" htmlFor="product-url">
                  Product Page URL
                </label>
                <p className="mb-2 text-xs text-gray-500">
                  Optional. Paste a Shopify, Amazon, Trendyol, or product page link so AI Director can read the offer, title, price, features, and page images.
                </p>
                <div className="flex items-center gap-3 rounded-lg border border-white/10 bg-black/40 px-4 py-3">
                  <Link2 className="h-4 w-4 text-gray-400" />
                  <input
                    id="product-url"
                    type="url"
                    value={productUrl}
                    onChange={(event) => setProductUrl(event.target.value)}
                    placeholder="https://your-store.com/products/product-name"
                    className="w-full bg-transparent text-sm text-white outline-none placeholder:text-gray-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2" htmlFor="product-brief">
                  Offer Summary
                </label>
                <p className="mb-2 text-xs text-gray-500">
                  Tell the AI what you sell and what matters if the page does not explain everything clearly.
                </p>
                <textarea
                  id="product-brief"
                  className="w-full glass rounded-lg px-4 py-3 text-white border border-white/10 focus:border-[#00d9ff]/50 focus:outline-none placeholder-gray-500 resize-none"
                  placeholder="Spor ayakkabı satıyorum, enerjik ve hızlı olsun. Avantajlar: hafif taban, 30 gün deneme..."
                  rows={5}
                  value={productBrief}
                  onChange={(event) => setProductBrief(event.target.value)}
                />
              </div>

              <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-white">Upload Product Image</p>
                    <p className="mt-1 text-xs text-gray-400">
                      Recommended. Upload a product shot, screenshot, or packshot so AI Director can visually understand color, material, style, and scene.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-white hover:bg-white/10"
                  >
                    Upload
                  </button>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={(event) => handleProductImageUpload(event.target.files?.[0] || null)}
                  className="hidden"
                />
                {(productImagePreview || effectiveProductImageUrl) && (
                  <div className="mt-4">
                    <div
                      aria-hidden="true"
                      className="h-48 w-full rounded-xl bg-cover bg-center ring-1 ring-white/10"
                      style={{ backgroundImage: `url(${productImagePreview || effectiveProductImageUrl})` }}
                    />
                  </div>
                )}
                {(productImageFile || uploadedProductImageUrl) && (
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-gray-300">
                    {productImageFile && (
                      <span className="inline-flex items-center gap-2 rounded-full bg-white/5 px-3 py-1">
                        {productImageFile.name}
                        <button
                          type="button"
                          onClick={() => {
                            setProductImageFile(null);
                            setUploadedProductImageUrl('');
                          }}
                          className="rounded-full bg-white/10 p-1 hover:bg-white/20"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    )}
                    {isUploadingImage && <span className="text-[#00d9ff]">Uploading product image...</span>}
                    {uploadedProductImageUrl && !isUploadingImage && (
                      <span className="text-emerald-300">Product image ready for analysis</span>
                    )}
                  </div>
                )}
              </div>

              <details className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <summary className="cursor-pointer text-sm font-medium text-gray-300">
                  Advanced: Direct Image URL instead of upload
                </summary>
                <p className="mt-3 text-xs text-gray-500">
                  Optional. Use this only if you already have a direct CDN/image URL. If both page URL and image URL are provided, this image is used as the primary visual reference.
                </p>
                <div className="mt-3 flex items-center gap-3 rounded-lg border border-white/10 bg-black/40 px-4 py-3">
                  <Link2 className="h-4 w-4 text-gray-400" />
                  <input
                    id="product-image-url"
                    type="url"
                    value={productImageUrl}
                    onChange={(event) => setProductImageUrl(event.target.value)}
                    placeholder="https://cdn.example.com/product-image.jpg"
                    className="w-full bg-transparent text-sm text-white outline-none placeholder:text-gray-500"
                  />
                </div>
              </details>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Platform</label>
                  <select
                    value={platform}
                    onChange={(event) => setPlatform(event.target.value)}
                    className="w-full glass rounded-lg px-4 py-3 text-white border border-white/10 focus:border-[#00d9ff]/50 focus:outline-none"
                  >
                    <option value="">Any</option>
                    {PLATFORM_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Objective</label>
                  <select
                    value={objective}
                    onChange={(event) => setObjective(event.target.value)}
                    className="w-full glass rounded-lg px-4 py-3 text-white border border-white/10 focus:border-[#00d9ff]/50 focus:outline-none"
                  >
                    <option value="">Any</option>
                    {OBJECTIVE_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Tone</label>
                  <select
                    value={tone}
                    onChange={(event) => setTone(event.target.value)}
                    className="w-full glass rounded-lg px-4 py-3 text-white border border-white/10 focus:border-[#00d9ff]/50 focus:outline-none"
                  >
                    <option value="">Any</option>
                    {TONE_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Duration</label>
                  <select
                    value={duration}
                    onChange={(event) => setDuration(event.target.value)}
                    className="w-full glass rounded-lg px-4 py-3 text-white border border-white/10 focus:border-[#00d9ff]/50 focus:outline-none"
                  >
                    <option value="">Any</option>
                    {DURATION_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Audience</label>
                  <input
                    value={audience}
                    onChange={(event) => setAudience(event.target.value)}
                    placeholder="Gen Z sneakerheads"
                    className="w-full glass rounded-lg px-4 py-3 text-white border border-white/10 focus:border-[#00d9ff]/50 focus:outline-none placeholder:text-gray-500"
                  />
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
                <div className="flex items-center justify-between gap-3 mb-3">
                  <div>
                    <p className="text-sm font-medium text-white">Persona Input</p>
                    <p className="mt-1 text-xs text-gray-400">
                      Optional. Director will decide if this persona should present the offer or if the product should stay standalone.
                    </p>
                  </div>
                  {!canUsePersonaFeatures && (
                    <button
                      type="button"
                      onClick={() => setIsPricingModalOpen(true)}
                      className="text-xs text-yellow-300 hover:text-yellow-200"
                    >
                      Premium
                    </button>
                  )}
                </div>
                <select
                  value={selectedPersonaId}
                  onChange={(event) => handlePersonaSelect(event.target.value)}
                  className="w-full glass rounded-lg px-4 py-3 text-white border border-white/10 focus:border-[#00d9ff]/50 focus:outline-none"
                >
                  <option value="">No persona</option>
                  {readyPersonas.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name || 'Persona'}
                    </option>
                  ))}
                </select>
                {selectedPersona && (
                  <div className="mt-3 rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-3">
                    <div className="flex items-center gap-3">
                      <span className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-cyan-500/50 to-blue-500/50">
                        {getPersonaImageUrl(selectedPersona) ? (
                          <span
                            aria-hidden="true"
                            className="h-full w-full bg-cover bg-center"
                            style={{ backgroundImage: `url(${getPersonaImageUrl(selectedPersona)})` }}
                          />
                        ) : (
                          <UserRound className="h-4 w-4 text-white" />
                        )}
                      </span>
                      <div>
                        <p className="text-sm text-white">{selectedPersona.name || 'Persona'}</p>
                        <p className="text-xs text-cyan-200/80">
                          Trigger: {selectedPersona.triggerWord || selectedPersona.trigger_word || 'n/a'}
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={handleGenerate}
                disabled={isLoading || isUploadingImage}
                className="interactive-element w-full glass rounded-lg px-6 py-4 text-white font-semibold bg-gradient-to-r from-[#00d9ff] to-[#0099cc] hover:from-[#00d9ff]/90 hover:to-[#0099cc]/90 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Building Strategy...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-5 h-5" />
                    Generate Scenarios
                  </>
                )}
              </button>

              {errorMessage ? (
                <div className="glass rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                  {errorMessage}
                </div>
              ) : null}
            </div>

            <div className="space-y-6">
              <div className="glass rounded-2xl p-8">
                <h2 className="text-2xl font-semibold text-white mb-4">Product Analysis</h2>
                {analysis ? (
                  <div className="space-y-5 text-sm">
                    <div>
                      <p className="text-white font-medium">Summary</p>
                      <p className="mt-2 text-gray-300 leading-6">{analysis.summary}</p>
                    </div>
                    {analysis.keyFeatures.length > 0 && (
                      <div>
                        <p className="text-white font-medium">Key Features</p>
                        <ul className="mt-2 space-y-2 text-gray-300">
                          {analysis.keyFeatures.map((feature) => (
                            <li key={feature}>• {feature}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {analysis.visualObservations.length > 0 && (
                      <div>
                        <p className="text-white font-medium">Visual Observations</p>
                        <ul className="mt-2 space-y-2 text-gray-300">
                          {analysis.visualObservations.map((item) => (
                            <li key={item}>• {item}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {sourceContext && (
                      <div className="rounded-xl border border-white/10 bg-black/30 p-4 text-xs text-gray-400">
                        <p className="font-medium text-white">Source Context</p>
                        <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
                          <span>Host: {sourceContext.hostname || 'n/a'}</span>
                          <span>Page fetched: {sourceContext.fetchedPage ? 'Yes' : 'No'}</span>
                          {sourceContext.productBrand && <span>Brand: {sourceContext.productBrand}</span>}
                          {sourceContext.productCategory && <span>Category: {sourceContext.productCategory}</span>}
                          {sourceContext.productPrice && <span>Price: {sourceContext.productPrice}</span>}
                          {sourceContext.extractedSignals.length > 0 && (
                            <span>Signals: {sourceContext.extractedSignals.join(', ')}</span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-sm text-white/40 space-y-3">
                    <p>Product analysis will appear here.</p>
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-[#00d9ff]/60 animate-pulse" />
                      <span className="text-xs uppercase tracking-[0.2em] text-white/40">Awaiting inputs</span>
                    </div>
                  </div>
                )}
              </div>

              <div className="glass rounded-2xl p-8">
                <h2 className="text-2xl font-semibold text-white mb-4">Production Recommendation</h2>
                {recommendations ? (
                  <div className="space-y-5 text-sm">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-xl border border-white/10 bg-black/30 p-4">
                        <p className="text-xs uppercase tracking-wide text-gray-500">Engine</p>
                        <p className="mt-2 text-white font-medium">{recommendations.recommendedEngine}</p>
                      </div>
                      <div className="rounded-xl border border-white/10 bg-black/30 p-4">
                        <p className="text-xs uppercase tracking-wide text-gray-500">Duration / Quality</p>
                        <p className="mt-2 text-white font-medium">
                          {recommendations.recommendedDuration || 'Auto'}s / {recommendations.recommendedQuality}
                        </p>
                      </div>
                      <div className="rounded-xl border border-white/10 bg-black/30 p-4">
                        <p className="text-xs uppercase tracking-wide text-gray-500">Aspect Ratio</p>
                        <p className="mt-2 text-white font-medium">{recommendations.recommendedAspectRatio}</p>
                      </div>
                      <div className="rounded-xl border border-white/10 bg-black/30 p-4">
                        <p className="text-xs uppercase tracking-wide text-gray-500">Persona / Ref Image</p>
                        <p className="mt-2 text-white font-medium">
                          {recommendations.needsPersona ? 'Use persona' : 'Product-only'}
                          {' / '}
                          {recommendations.needsReferenceImage ? 'Use reference image' : 'Reference optional'}
                        </p>
                      </div>
                    </div>

                    <div>
                      <p className="text-white font-medium">Why this setup</p>
                      <p className="mt-2 text-gray-300 leading-6">{recommendations.engineReason}</p>
                    </div>

                    {personaAnalysis && (
                      <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-4">
                        <p className="text-white font-medium">Persona Fit</p>
                        <p className="mt-2 text-gray-200">{personaAnalysis.fitSummary}</p>
                        <p className="mt-2 text-gray-300">{personaAnalysis.usageRecommendation}</p>
                        {personaAnalysis.cautions.length > 0 && (
                          <ul className="mt-3 space-y-2 text-xs text-cyan-100/80">
                            {personaAnalysis.cautions.map((item) => (
                              <li key={item}>• {item}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}

                    {recommendations.productionNotes.length > 0 && (
                      <div>
                        <p className="text-white font-medium">Production Notes</p>
                        <ul className="mt-2 space-y-2 text-gray-300">
                          {recommendations.productionNotes.map((note) => (
                            <li key={note}>• {note}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {recommendations.riskNotes.length > 0 && (
                      <div>
                        <p className="text-white font-medium">Risk Notes</p>
                        <ul className="mt-2 space-y-2 text-gray-300">
                          {recommendations.riskNotes.map((note) => (
                            <li key={note}>• {note}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-white/40">Engine and production recommendations will appear here.</p>
                )}
              </div>

              <div className="glass rounded-2xl p-8">
                <h2 className="text-2xl font-semibold text-white mb-4">Scenario Options</h2>
                {scenarios.length === 0 ? (
                  <div className="text-sm text-white/40 space-y-3">
                    <p>Director scenarios will appear here.</p>
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-[#00d9ff]/60 animate-pulse" />
                      <span className="text-xs uppercase tracking-[0.2em] text-white/40">Awaiting brief</span>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {scenarios.map((scenario, index) => (
                      <button
                        key={`${scenario.title}-${index}`}
                        type="button"
                        onClick={() => setSelectedIndex(index)}
                        className={`w-full rounded-xl border px-4 py-4 text-left transition-all ${
                          selectedIndex === index
                            ? 'border-[#00d9ff] bg-[#00d9ff]/10'
                            : 'border-white/10 bg-black/30 hover:border-white/30'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm font-semibold text-white">{scenario.title}</p>
                            <p className="text-xs text-gray-400 mt-1">{scenario.hook}</p>
                          </div>
                          {selectedIndex === index && <CheckCircle2 className="h-5 w-5 text-[#00d9ff]" />}
                        </div>
                        <p className="mt-3 text-xs text-gray-500">{scenario.angle}</p>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="glass rounded-2xl p-8">
                <h2 className="text-2xl font-semibold text-white mb-4">Selected Plan</h2>
                {selectedScenario ? (
                  <>
                    <pre className="text-white whitespace-pre-wrap font-mono text-xs leading-relaxed bg-black/40 border border-white/10 rounded-lg p-4">
                      {JSON.stringify(selectedScenario.plan, null, 2)}
                    </pre>
                    {recommendation && (
                      <p className="mt-4 text-sm text-gray-400">{recommendation}</p>
                    )}
                    <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-2">
                      <button
                        type="button"
                        onClick={() => handleApprove('video')}
                        className="rounded-lg px-6 py-4 text-sm font-semibold text-black bg-gradient-to-r from-[#00d9ff] to-[#0099cc] hover:opacity-90 transition-all"
                      >
                        Send to AI Video
                      </button>
                      <button
                        type="button"
                        onClick={() => handleApprove('editor')}
                        className="rounded-lg border border-[#fbbf24]/40 bg-[#fbbf24]/10 px-6 py-4 text-sm font-semibold text-[#fbbf24] hover:bg-[#fbbf24]/15 transition-all"
                      >
                        Send to Auto-Editor
                      </button>
                    </div>
                    <p className="mt-3 text-xs text-gray-500">
                      Use AI Video for one short generated clip. Use Auto-Editor for 30-60s multi-shot ads built from multiple scenes.
                    </p>
                  </>
                ) : (
                  <p className="text-sm text-white/40">Pick a scenario to view the JSON plan.</p>
                )}
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
