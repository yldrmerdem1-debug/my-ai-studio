'use client';

import { useState, useRef } from 'react';
import Sidebar from '@/components/Sidebar';
import PricingModal from '@/components/PricingModal';
import Link from 'next/link';
import { Image as ImageIcon, Upload, Sparkles, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/useToast';

export default function BackgroundChangePage() {
  const { showToast } = useToast();
  const [uploadedImage, setUploadedImage] = useState<File | null>(null);
  const [backgroundPrompt, setBackgroundPrompt] = useState('');
  const [resultImage, setResultImage] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isPricingModalOpen, setIsPricingModalOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setUploadedImage(file);
      setResultImage(null);
    }
  };

  const handleBackgroundChange = async () => {
    if (!uploadedImage) {
      showToast('Please upload an image first', 'warning');
      return;
    }

    setIsProcessing(true);
    setResultImage(null);

    try {
      const formData = new FormData();
      formData.append('image', uploadedImage);
      formData.append('prompt', backgroundPrompt);

      const response = await fetch('/api/background-change', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to change background');
      }

      const data = await response.json();
      setResultImage(data.imageUrl);
      
      // Auto-save to My Assets
      if (data.imageUrl && typeof window !== 'undefined') {
        const { saveImageAsset } = await import('@/lib/assets-storage');
        saveImageAsset(data.imageUrl, `Background Changed - ${new Date().toLocaleDateString()}`, {
          model: 'lucataco/remove-bg',
          prompt: backgroundPrompt,
        });
      }
      
      showToast('Background changed successfully!', 'success');
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
                  Background Change
                </span>
              </h1>
            </div>
            <p className="text-gray-400 text-lg">
              One face. Multiple worlds. Change backgrounds instantly with Replicate (lucataco/remove-bg).
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Image Upload */}
            <div className="glass rounded-2xl p-8">
              <div className="flex items-center gap-3 mb-6">
                <Upload className="w-6 h-6 text-[#00d9ff]" />
                <h2 className="text-2xl font-semibold text-white">Upload Image</h2>
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
                {uploadedImage ? (
                  <img
                    src={URL.createObjectURL(uploadedImage)}
                    alt="Uploaded"
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
                  <h2 className="text-2xl font-semibold text-white">Background Details</h2>
                </div>
                <div className="mb-6">
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Describe your desired background
                  </label>
                  <textarea
                    value={backgroundPrompt}
                    onChange={(e) => setBackgroundPrompt(e.target.value)}
                    placeholder="e.g., professional studio, space, office, beach..."
                    rows={4}
                    className="w-full px-4 py-3 bg-black/40 border border-white/10 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-[#8b5cf6]/50 transition-colors resize-none interactive-element"
                  />
                </div>
                <button
                  onClick={handleBackgroundChange}
                  disabled={isProcessing || !uploadedImage}
                  className="interactive-element try-now-button-modern w-full px-10 py-4 bg-gradient-to-r from-[#00d9ff] to-[#0099ff] text-white font-semibold text-lg rounded-xl transition-all duration-300 relative overflow-hidden group disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {isProcessing ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      Processing...
                    </>
                  ) : (
                    'Change Background'
                  )}
                </button>
              </div>

              {resultImage && (
                <div className="mt-8">
                  <h3 className="text-xl font-semibold text-white mb-4">Result</h3>
                  <div className="relative w-full h-64 rounded-lg overflow-hidden border border-white/10">
                    <img src={resultImage} alt="Background Change Result" className="w-full h-full object-contain" />
                  </div>
                  <a
                    href={resultImage}
                    download="background-change-result.png"
                    className="mt-4 block text-center text-[#00d9ff] hover:underline interactive-element"
                  >
                    Download Result
                  </a>
                </div>
              )}

              {isProcessing && !resultImage && (
                <div className="mt-8 text-center">
                  <Loader2 className="w-12 h-12 animate-spin text-[#8b5cf6] mx-auto mb-4" />
                  <p className="text-gray-400">Processing background change...</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
