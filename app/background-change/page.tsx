'use client';

import { useState, useRef, useEffect } from 'react';
import Sidebar from '@/components/Sidebar';
import PricingModal from '@/components/PricingModal';
import Link from 'next/link';
import { Image as ImageIcon, Upload, Sparkles, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/useToast';

export default function ImageStudioPage() {
  const { showToast } = useToast();
  const [uploadedImage, setUploadedImage] = useState<File | null>(null);
  const [uploadedImageUrl, setUploadedImageUrl] = useState<string | null>(null);
  const [studioPrompt, setStudioPrompt] = useState('');
  const [resultImage, setResultImage] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isPricingModalOpen, setIsPricingModalOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!uploadedImage) {
      setUploadedImageUrl(null);
      return;
    }

    const objectUrl = URL.createObjectURL(uploadedImage);
    setUploadedImageUrl(objectUrl);

    return () => URL.revokeObjectURL(objectUrl);
  }, [uploadedImage]);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setUploadedImage(file);
      setResultImage(null);
    }
  };

  const handleImageStudio = async () => {
    if (!uploadedImage) {
      showToast('Please upload an image first', 'warning');
      return;
    }

    setIsProcessing(true);
    setResultImage(null);

    try {
      const formData = new FormData();
      formData.append('image', uploadedImage);
      formData.append('prompt', studioPrompt);

      const response = await fetch('/api/background-change', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to generate studio image');
      }

      const data = await response.json();
      setResultImage(data.imageUrl);
      
      // Auto-save to My Assets
      if (data.imageUrl && typeof window !== 'undefined') {
        const { saveImageAsset } = await import('@/lib/assets-storage');
        saveImageAsset(data.imageUrl, `Image Studio - ${new Date().toLocaleDateString()}`, {
          model: 'replicate/image-to-image',
          prompt: studioPrompt,
        });
      }
      
      showToast('Image Studio result is ready!', 'success');
    } catch (error: any) {
      showToast(error.message || 'Failed to process image', 'error');
    } finally {
      setIsProcessing(false);
    }
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
              ← Back to Studio
            </Link>
            <div className="flex items-center gap-3 mb-2">
              <ImageIcon className="w-8 h-8 text-[#8b5cf6]" style={{ filter: 'drop-shadow(0 0 8px #8b5cf6)' }} />
              <h1 className="text-4xl font-bold text-white">
                <span className="bg-gradient-to-r from-[#8b5cf6] via-[#6366f1] to-[#8b5cf6] bg-clip-text text-transparent">
                  Image Studio
                </span>
              </h1>
            </div>
            <p className="text-gray-400 text-lg">Turn any photo into a studio-quality image</p>
            <p className="text-gray-400 text-base max-w-2xl mt-3">
              Our AI recreates lighting, background, and atmosphere to produce professional, commercial-ready images — not just cutouts.
            </p>
            <p className="text-gray-400 text-sm max-w-2xl mt-3">
              From a single photo, Image Studio recreates a professional environment — lighting, background, and mood — while preserving facial identity.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Image Upload */}
            <div className="glass rounded-2xl p-8">
              <div className="flex items-center gap-3 mb-6">
                <Upload className="w-6 h-6 text-[#00d9ff]" />
                <h2 className="text-2xl font-semibold text-white">Upload Photo</h2>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleImageUpload}
                className="hidden"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="interactive-element w-full h-96 border-2 border-dashed border-white/20 rounded-xl flex flex-col items-center justify-center gap-4 hover:border-[#00d9ff]/50 transition-colors"
              >
                {uploadedImageUrl ? (
                  <img
                    src={uploadedImageUrl}
                    alt="Uploaded photo"
                    className="w-full h-full object-cover rounded-lg"
                  />
                ) : (
                  <>
                    <Upload className="w-16 h-16 text-gray-400" />
                    <p className="text-gray-400">Drag & drop or click to upload</p>
                  </>
                )}
              </button>
            </div>

            {/* Controls & Result */}
            <div className="glass rounded-2xl p-8 flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-3 mb-6">
                  <Sparkles className="w-6 h-6 text-[#fbbf24]" />
                  <h2 className="text-2xl font-semibold text-white">Studio Direction</h2>
                </div>
                <div className="mb-6">
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Describe the lighting, mood, and studio environment
                  </label>
                  <textarea
                    value={studioPrompt}
                    onChange={(e) => setStudioPrompt(e.target.value)}
                    placeholder="e.g., soft key light, warm cinematic mood, premium product photography"
                    rows={4}
                    className="w-full px-4 py-3 bg-black/40 border border-white/10 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-[#8b5cf6]/50 transition-colors resize-none interactive-element"
                  />
                </div>
                <button
                  onClick={handleImageStudio}
                  disabled={isProcessing || !uploadedImage}
                  className="interactive-element try-now-button-modern w-full px-10 py-4 bg-gradient-to-r from-[#00d9ff] to-[#0099ff] text-white font-semibold text-lg rounded-xl transition-all duration-300 relative overflow-hidden group disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {isProcessing ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      Crafting studio image...
                    </>
                  ) : (
                    'Create Studio Image'
                  )}
                </button>
              </div>

              <div className="mt-8">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-xl font-semibold text-white">Before / After</h3>
                  {resultImage && (
                    <a
                      href={resultImage}
                      download="image-studio-result.png"
                      className="text-sm text-[#00d9ff] hover:underline interactive-element"
                    >
                      Download studio image
                    </a>
                  )}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="rounded-lg border border-white/10 bg-black/30 p-4">
                    <p className="text-xs font-semibold text-gray-400 mb-3">BEFORE · Raw photo</p>
                    <div className="flex h-56 items-center justify-center rounded-md bg-black/40">
                      {uploadedImageUrl ? (
                        <img src={uploadedImageUrl} alt="Raw photo" className="w-full h-full object-cover rounded-md" />
                      ) : (
                        <p className="text-gray-500 text-sm">Upload a photo to preview</p>
                      )}
                    </div>
                  </div>
                  <div className="rounded-lg border border-[#00d9ff]/30 bg-black/30 p-4">
                    <p className="text-xs font-semibold text-[#00d9ff] mb-3">AFTER · Studio image</p>
                    <div className="flex h-56 items-center justify-center rounded-md bg-black/40">
                      {isProcessing ? (
                        <div className="text-center">
                          <Loader2 className="w-8 h-8 animate-spin text-[#00d9ff] mx-auto mb-3" />
                          <p className="text-[#00d9ff] text-sm">Lighting, mood, realism in progress...</p>
                        </div>
                      ) : resultImage ? (
                        <img src={resultImage} alt="Studio result" className="w-full h-full object-cover rounded-md" />
                      ) : (
                        <p className="text-gray-500 text-sm">Studio output appears here</p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
