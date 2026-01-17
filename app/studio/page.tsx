'use client';

import { useState, useRef } from 'react';
import Sidebar from '@/components/Sidebar';
import PricingModal from '@/components/PricingModal';
import Link from 'next/link';
import { Image as ImageIcon, Upload, Sparkles, Loader2, Eraser, Camera, User, Wand2 } from 'lucide-react';
import { useToast } from '@/hooks/useToast';
import PreviewArea from '@/components/PreviewArea';
import { usePersona } from '@/hooks/usePersona';
import { canUsePersona } from '@/lib/subscription';

type ToolMode = 'background-remove' | 'studio-background' | 'face-identity' | null;

export default function StudioPage() {
  const { showToast } = useToast();
  const { user, persona } = usePersona();
  const canUsePersonaFeatures = canUsePersona(user);
  const personaReady = persona?.visualStatus === 'ready';
  const [selectedTool, setSelectedTool] = useState<ToolMode>(null);
  const [uploadedImage, setUploadedImage] = useState<File | null>(null);
  const [sourceImage, setSourceImage] = useState<File | null>(null);
  const [targetImage, setTargetImage] = useState<File | null>(null);
  const [backgroundPrompt, setBackgroundPrompt] = useState('');
  const [resultImage, setResultImage] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [selectedModel, setSelectedModel] = useState<'instantid' | 'faceswap'>('instantid');
  const [isPricingModalOpen, setIsPricingModalOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sourceInputRef = useRef<HTMLInputElement>(null);
  const targetInputRef = useRef<HTMLInputElement>(null);
  const [identityMode, setIdentityMode] = useState<'single' | 'persona'>('single');

  const getPersonaId = () => {
    return identityMode === 'persona' ? persona?.id : undefined;
  };

  const requirePersonaReady = () => {
    if (!canUsePersonaFeatures) {
      setIsPricingModalOpen(true);
      showToast('Premium required for Persona Mode.', 'warning');
      return false;
    }
    if (!personaReady) {
      showToast('Persona Mode requires a ready visual persona.', 'warning');
      return false;
    }
    if (!persona?.id) {
      showToast('Persona Mode requires a persona identity.', 'warning');
      return false;
    }
    return true;
  };

  const fileToDataUrl = async (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
    });
  };

  const tools = [
    {
      id: 'background-remove' as ToolMode,
      title: 'Background Remove',
      description: 'Clean background instantly',
      icon: Eraser,
      iconColor: '#10b981',
    },
    {
      id: 'studio-background' as ToolMode,
      title: 'Professional Studio Background',
      description: 'AI Photo Studio',
      icon: Camera,
      iconColor: '#fbbf24',
    },
    {
      id: 'face-identity' as ToolMode,
      title: 'Face / Identity',
      description: 'Your face. Infinite scenes.',
      icon: User,
      iconColor: '#ff6b9d',
    },
  ];

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setUploadedImage(file);
      setResultImage(null);
    }
  };

  const handleSourceImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) setSourceImage(file);
  };

  const handleTargetImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) setTargetImage(file);
  };

  const handleBackgroundRemove = async () => {
    if (!uploadedImage) {
      showToast('Please upload an image first', 'warning');
      return;
    }
    if (identityMode === 'persona' && !requirePersonaReady()) {
      return;
    }

    setIsProcessing(true);
    setResultImage(null);

    try {
    const imageDataUrl = await fileToDataUrl(uploadedImage);
    const personaId = getPersonaId();

      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'remove-background',
          image: imageDataUrl,
          triggerWord: undefined,
          personaId,
          personaMode: identityMode === 'persona' ? 'persona' : 'generic',
          personaStatus: persona?.visualStatus ?? 'none',
          user,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to remove background');
      }

      const data = await response.json();
      if (data.imageUrl) {
        setResultImage(data.imageUrl);
        
        // Auto-save to My Assets
        if (typeof window !== 'undefined') {
          const { saveImageAsset } = await import('@/lib/assets-storage');
          saveImageAsset(data.imageUrl, `Background Removed - ${new Date().toLocaleDateString()}`, {
            model: 'lucataco/remove-bg',
          });
        }
        
        showToast('Background removed successfully!', 'success');
      }
    } catch (error: any) {
      showToast(error.message || 'Failed to remove background', 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleStudioBackground = async () => {
    if (!uploadedImage) {
      showToast('Please upload an image first', 'warning');
      return;
    }
    if (identityMode === 'persona' && !requirePersonaReady()) {
      return;
    }

    setIsProcessing(true);
    setResultImage(null);

    try {
    const imageDataUrl = await fileToDataUrl(uploadedImage);
    const personaId = getPersonaId();

      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'studio-background',
          image: imageDataUrl,
          prompt: backgroundPrompt || 'professional studio background, clean white background, high quality photography',
          triggerWord: undefined,
          personaId,
          personaMode: identityMode === 'persona' ? 'persona' : 'generic',
          personaStatus: persona?.visualStatus ?? 'none',
          user,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to create studio background');
      }

      const data = await response.json();
      if (data.imageUrl) {
        setResultImage(data.imageUrl);
        
        // Auto-save to My Assets
        if (typeof window !== 'undefined') {
          const { saveImageAsset } = await import('@/lib/assets-storage');
          saveImageAsset(data.imageUrl, `Studio Background - ${new Date().toLocaleDateString()}`, {
            model: 'runwayml/stable-diffusion-inpainting',
            prompt: backgroundPrompt,
          });
        }
        
        showToast('Studio background created successfully!', 'success');
      }
    } catch (error: any) {
      showToast(error.message || 'Failed to create studio background', 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleFaceSwap = async () => {
    if (!sourceImage || !targetImage) {
      showToast('Please upload both source and target images', 'warning');
      return;
    }

    setIsProcessing(true);
    setResultImage(null);

    try {
      const formData = new FormData();
      formData.append('image', sourceImage);
      formData.append('targetImage', targetImage);
      formData.append('model', selectedModel);

      const response = await fetch('/api/face-identity', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to swap faces');
      }

      const data = await response.json();
      if (data.imageUrl) {
        setResultImage(data.imageUrl);
        
        // Auto-save to My Assets
        if (typeof window !== 'undefined') {
          const { saveImageAsset } = await import('@/lib/assets-storage');
          saveImageAsset(data.imageUrl, `Face Swap - ${new Date().toLocaleDateString()}`, {
            model: selectedModel,
          });
        }
        
        showToast('Face swap completed successfully!', 'success');
      }
    } catch (error: any) {
      showToast(error.message || 'Failed to swap faces', 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleProcess = () => {
    if (selectedTool === 'background-remove') {
      handleBackgroundRemove();
    } else if (selectedTool === 'studio-background') {
      handleStudioBackground();
    } else if (selectedTool === 'face-identity') {
      handleFaceSwap();
    }
  };

  const resetTool = () => {
    setSelectedTool(null);
    setUploadedImage(null);
    setSourceImage(null);
    setTargetImage(null);
    setResultImage(null);
    setBackgroundPrompt('');
  };

  return (
    <div className="relative min-h-screen bg-black">
      <Sidebar onSubscriptionClick={() => setIsPricingModalOpen(true)} />
      <PricingModal isOpen={isPricingModalOpen} onClose={() => setIsPricingModalOpen(false)} />

      <main className="relative z-10 ml-64">
        <div className="container mx-auto px-8 py-12">
          {/* Header */}
          <div className="mb-8">
            <Link href="/" className="text-[#00d9ff] hover:text-[#0099ff] mb-4 inline-block transition-colors">
              ← Back to Home
            </Link>
            <div className="flex items-center gap-3 mb-2">
              <Wand2 className="w-8 h-8 text-[#00d9ff]" style={{ filter: 'drop-shadow(0 0 8px #00d9ff)' }} />
              <h1 className="text-4xl font-bold text-white">
                <span className="bg-gradient-to-r from-[#00d9ff] via-[#0099cc] to-[#00d9ff] bg-clip-text text-transparent">
                  Image Studio
                </span>
              </h1>
            </div>
            <p className="text-gray-400 text-lg">
              Professional image editing tools powered by AI. Remove backgrounds, create studio shots, and swap faces.
            </p>
          </div>

          <div className="glass rounded-2xl p-6 mb-8">
            <div className="flex items-center justify-between gap-4 mb-2">
              <h2 className="text-xl font-semibold text-white">Identity Mode</h2>
            </div>
            <p className="text-sm text-gray-400 mb-5">
              Single Photo edits this image once. Persona keeps your identity consistent across all generations.
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setIdentityMode('single')}
                className={`rounded-lg border px-4 py-3 text-left transition-all ${
                  identityMode === 'single'
                    ? 'border-[#00d9ff]/60 bg-[#00d9ff]/10 text-white'
                    : 'border-white/10 text-gray-300 hover:border-[#00d9ff]/30 hover:bg-white/5'
                }`}
                disabled={isProcessing}
              >
                <div className="text-sm font-semibold">Single Photo</div>
                <div className="text-xs text-white/50">Default</div>
              </button>
              <button
                type="button"
                onClick={() => setIdentityMode('persona')}
                className={`rounded-lg border px-4 py-3 text-left transition-all ${
                  identityMode === 'persona'
                    ? 'border-[#00d9ff]/60 bg-[#00d9ff]/10 text-white'
                    : 'border-white/10 text-gray-300 hover:border-[#00d9ff]/30 hover:bg-white/5'
                }`}
                disabled={isProcessing || !canUsePersonaFeatures || !personaReady}
                title={
                  !personaReady
                    ? 'Create a Persona for consistent identity across images and videos.'
                    : !canUsePersonaFeatures
                      ? 'Upgrade to Premium to use your Persona.'
                      : ''
                }
              >
                <div className="text-sm font-semibold">Use My Persona 🔒 Premium</div>
                <div className="text-xs text-white/50">Consistent identity</div>
              </button>
            </div>
            {!canUsePersonaFeatures && (
              <div className="mt-4 flex items-center justify-between gap-4 rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-4 py-3">
                <p className="text-sm text-yellow-300">Upgrade to Premium to use your Persona.</p>
                <button
                  type="button"
                  onClick={() => setIsPricingModalOpen(true)}
                  className="rounded-lg bg-[#00d9ff] px-4 py-2 text-sm font-semibold text-black hover:bg-[#00b8d9] transition-colors"
                >
                  Upgrade to Premium
                </button>
              </div>
            )}
          </div>

          {!selectedTool ? (
            /* Tool Selection */
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {tools.map((tool) => {
                const Icon = tool.icon;
                return (
                  <button
                    key={tool.id}
                    onClick={() => setSelectedTool(tool.id)}
                    className="glass rounded-2xl p-8 text-left transition-all hover:border-[#00d9ff]/50 hover:bg-[#00d9ff]/10 border border-white/10 group"
                  >
                    <div className="flex flex-col gap-4">
                      <div
                        className="flex items-center justify-center w-16 h-16 rounded-lg bg-black/30 border border-white/10"
                        style={{ filter: `drop-shadow(0 0 8px ${tool.iconColor})` }}
                      >
                        <Icon className="w-8 h-8" style={{ color: tool.iconColor }} />
                      </div>
                      <div>
                        <h3 className="text-xl font-semibold text-white mb-2">{tool.title}</h3>
                        <p className="text-gray-400">{tool.description}</p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            /* Tool Interface */
            <div className="space-y-8">
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-semibold text-white">
                  {tools.find(t => t.id === selectedTool)?.title}
                </h2>
                <button
                  onClick={resetTool}
                  className="px-4 py-2 text-gray-400 hover:text-white transition-colors"
                >
                  ← Back to Tools
                </button>
              </div>

              {selectedTool === 'background-remove' && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                  <div className="glass rounded-2xl p-8">
                    <h3 className="text-xl font-semibold text-white mb-6">Upload Image</h3>
                    <div className="space-y-4">
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        onChange={handleImageUpload}
                        className="hidden"
                      />
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        className="w-full px-6 py-4 bg-white/5 border border-white/10 rounded-lg text-white hover:bg-white/10 transition-colors flex items-center justify-center gap-2"
                      >
                        <Upload className="w-5 h-5" />
                        {uploadedImage ? 'Change Image' : 'Upload Image'}
                      </button>
                      {uploadedImage && (
                        <div className="mt-4">
                          <img
                            src={URL.createObjectURL(uploadedImage)}
                            alt="Uploaded"
                            className="w-full rounded-lg"
                          />
                        </div>
                      )}
                      <button
                        onClick={handleProcess}
                        disabled={!uploadedImage || isProcessing}
                        className="w-full px-6 py-4 bg-gradient-to-r from-[#00d9ff] to-[#0099ff] text-white font-semibold rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                      >
                        {isProcessing ? (
                          <>
                            <Loader2 className="w-5 h-5 animate-spin" />
                            Processing...
                          </>
                        ) : (
                          <>
                            <Eraser className="w-5 h-5" />
                            Remove Background
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                  <PreviewArea
                    originalImage={uploadedImage ? URL.createObjectURL(uploadedImage) : null}
                    resultImage={resultImage}
                    isProcessing={isProcessing}
                    processingMessage="Removing background..."
                  />
                </div>
              )}

              {selectedTool === 'studio-background' && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                  <div className="glass rounded-2xl p-8">
                    <h3 className="text-xl font-semibold text-white mb-6">Upload Image</h3>
                    <div className="space-y-4">
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        onChange={handleImageUpload}
                        className="hidden"
                      />
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        className="w-full px-6 py-4 bg-white/5 border border-white/10 rounded-lg text-white hover:bg-white/10 transition-colors flex items-center justify-center gap-2"
                      >
                        <Upload className="w-5 h-5" />
                        {uploadedImage ? 'Change Image' : 'Upload Image'}
                      </button>
                      {uploadedImage && (
                        <div className="mt-4">
                          <img
                            src={URL.createObjectURL(uploadedImage)}
                            alt="Uploaded"
                            className="w-full rounded-lg"
                          />
                        </div>
                      )}
                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">
                          Background Description (Optional)
                        </label>
                        <textarea
                          value={backgroundPrompt}
                          onChange={(e) => setBackgroundPrompt(e.target.value)}
                          placeholder="e.g., professional studio background, clean white background, luxury office..."
                          className="w-full px-4 py-3 bg-black/40 border border-white/10 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-[#00d9ff]/50 transition-colors resize-none"
                          rows={3}
                        />
                      </div>
                      <button
                        onClick={handleProcess}
                        disabled={!uploadedImage || isProcessing}
                        className="w-full px-6 py-4 bg-gradient-to-r from-[#00d9ff] to-[#0099ff] text-white font-semibold rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                      >
                        {isProcessing ? (
                          <>
                            <Loader2 className="w-5 h-5 animate-spin" />
                            Processing...
                          </>
                        ) : (
                          <>
                            <Camera className="w-5 h-5" />
                            Create Studio Background
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                  <PreviewArea
                    originalImage={uploadedImage ? URL.createObjectURL(uploadedImage) : null}
                    resultImage={resultImage}
                    isProcessing={isProcessing}
                    processingMessage="Creating studio background..."
                  />
                </div>
              )}

              {selectedTool === 'face-identity' && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                  <div className="glass rounded-2xl p-8">
                    <h3 className="text-xl font-semibold text-white mb-6">Face Swap</h3>
                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">
                          Source Image (Face to Use)
                        </label>
                        <input
                          ref={sourceInputRef}
                          type="file"
                          accept="image/*"
                          onChange={handleSourceImageChange}
                          className="hidden"
                        />
                        <button
                          onClick={() => sourceInputRef.current?.click()}
                          className="w-full px-6 py-4 bg-white/5 border border-white/10 rounded-lg text-white hover:bg-white/10 transition-colors flex items-center justify-center gap-2"
                        >
                          <Upload className="w-5 h-5" />
                          {sourceImage ? 'Change Source' : 'Upload Source Image'}
                        </button>
                        {sourceImage && (
                          <div className="mt-4">
                            <img
                              src={URL.createObjectURL(sourceImage)}
                              alt="Source"
                              className="w-full rounded-lg"
                            />
                          </div>
                        )}
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">
                          Target Image (Face to Replace)
                        </label>
                        <input
                          ref={targetInputRef}
                          type="file"
                          accept="image/*"
                          onChange={handleTargetImageChange}
                          className="hidden"
                        />
                        <button
                          onClick={() => targetInputRef.current?.click()}
                          className="w-full px-6 py-4 bg-white/5 border border-white/10 rounded-lg text-white hover:bg-white/10 transition-colors flex items-center justify-center gap-2"
                        >
                          <Upload className="w-5 h-5" />
                          {targetImage ? 'Change Target' : 'Upload Target Image'}
                        </button>
                        {targetImage && (
                          <div className="mt-4">
                            <img
                              src={URL.createObjectURL(targetImage)}
                              alt="Target"
                              className="w-full rounded-lg"
                            />
                          </div>
                        )}
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">
                          Model
                        </label>
                        <select
                          value={selectedModel}
                          onChange={(e) => setSelectedModel(e.target.value as 'instantid' | 'faceswap')}
                          className="w-full px-4 py-3 bg-black/40 border border-white/10 rounded-lg text-white focus:outline-none focus:border-[#00d9ff]/50 transition-colors"
                        >
                          <option value="instantid">InstantID</option>
                          <option value="faceswap">FaceSwap</option>
                        </select>
                      </div>
                      <button
                        onClick={handleProcess}
                        disabled={!sourceImage || !targetImage || isProcessing}
                        className="w-full px-6 py-4 bg-gradient-to-r from-[#00d9ff] to-[#0099ff] text-white font-semibold rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                      >
                        {isProcessing ? (
                          <>
                            <Loader2 className="w-5 h-5 animate-spin" />
                            Processing...
                          </>
                        ) : (
                          <>
                            <User className="w-5 h-5" />
                            Swap Faces
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                  <PreviewArea
                    originalImage={targetImage ? URL.createObjectURL(targetImage) : null}
                    resultImage={resultImage}
                    isProcessing={isProcessing}
                    processingMessage="Swapping faces..."
                  />
                </div>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
