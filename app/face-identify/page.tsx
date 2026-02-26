'use client';

import { useState, useRef } from 'react';
import Sidebar from '@/components/Sidebar';
import PricingModal from '@/components/PricingModal';
import Link from 'next/link';
import { User, Upload, Image as ImageIcon, Sparkles, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/useToast';
import { isPublicFaceSwapEnabled } from '@/lib/feature-flags';

export default function FaceIdentifyPage() {
  const { showToast } = useToast();
  const faceSwapUiEnabled = isPublicFaceSwapEnabled();
  const [faceSwapConsent, setFaceSwapConsent] = useState(false);
  const [sourceImage, setSourceImage] = useState<File | null>(null);
  const [targetImage, setTargetImage] = useState<File | null>(null);
  const [resultImage, setResultImage] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [selectedModel, setSelectedModel] = useState<'instantid' | 'faceswap'>('instantid');
  const [isPricingModalOpen, setIsPricingModalOpen] = useState(false);

  const sourceInputRef = useRef<HTMLInputElement>(null);
  const targetInputRef = useRef<HTMLInputElement>(null);

  const handleSourceImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) setSourceImage(file);
  };

  const handleTargetImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) setTargetImage(file);
  };

  const handleFaceSwap = async () => {
    if (!faceSwapUiEnabled) {
      showToast('Face swap is disabled', 'warning');
      return;
    }
    if (!faceSwapConsent) {
      showToast('Please confirm consent to use face swap', 'warning');
      return;
    }
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
      formData.append('faceSwapConsent', String(faceSwapConsent));

      const response = await fetch('/api/face-identity', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to swap faces');
      }

      const data = await response.json();
      
      if (data.predictionId) {
        // Poll for result
        const pollInterval = setInterval(async () => {
          try {
            const statusResponse = await fetch(`/api/face-identity/status?predictionId=${data.predictionId}`);
            const statusData = await statusResponse.json();
            
            if (statusData.status === 'succeeded' && statusData.output) {
              clearInterval(pollInterval);
              const resultUrl = Array.isArray(statusData.output) ? statusData.output[0] : statusData.output;
              setResultImage(resultUrl);
              
              // Auto-save to My Assets
              if (typeof window !== 'undefined') {
                import('@/lib/assets-storage').then(({ saveImageAsset }) => {
                  saveImageAsset(resultUrl, `Face Swap - ${new Date().toLocaleDateString()}`, {
                    model: selectedModel === 'instantid' ? 'subhash/instantid' : 'lucataco/faceswap',
                  });
                });
              }
              
              setIsProcessing(false);
              showToast('Face swap completed successfully!', 'success');
            } else if (statusData.status === 'failed') {
              clearInterval(pollInterval);
              setIsProcessing(false);
              showToast('Face swap failed: ' + (statusData.error || 'Unknown error'), 'error');
            }
          } catch (pollError: any) {
            clearInterval(pollInterval);
            setIsProcessing(false);
            showToast('Failed to check processing status', 'error');
          }
        }, 2000);

        setTimeout(() => {
          clearInterval(pollInterval);
          setIsProcessing(false);
          showToast('Processing timeout. Please try again.', 'warning');
        }, 60000);
      }
    } catch (error: any) {
      setIsProcessing(false);
      showToast(error.message || 'Failed to process images', 'error');
    }
  };

  return (
    <div className="relative min-h-screen bg-black">
      <Sidebar onSubscriptionClick={() => setIsPricingModalOpen(true)} />
      <PricingModal isOpen={isPricingModalOpen} onClose={() => setIsPricingModalOpen(false)} />

      <main className="relative z-10 ml-64">
        {!faceSwapUiEnabled ? (
          <div className="container mx-auto px-8 py-12">
            <div className="glass rounded-2xl p-8">
              <h1 className="text-2xl font-semibold text-white">Face Swap is disabled</h1>
              <p className="mt-2 text-gray-400">
                This feature is currently turned off.
              </p>
              <Link href="/" className="mt-4 inline-block text-[#00d9ff] hover:text-[#0099ff] transition-colors">
                ← Back to Studio
              </Link>
            </div>
          </div>
        ) : (
        <div className="container mx-auto px-8 py-12">
          {/* Header */}
          <div className="mb-8">
            <Link href="/" className="text-[#00d9ff] hover:text-[#0099ff] mb-4 inline-block transition-colors">
              ← Back to Studio
            </Link>
            <div className="flex items-center gap-3 mb-2">
              <User className="w-8 h-8 text-[#ff6b9d]" style={{ filter: 'drop-shadow(0 0 8px #ff6b9d)' }} />
              <h1 className="text-4xl font-bold text-white">
                <span className="bg-gradient-to-r from-[#ff6b9d] via-[#ff3f3f] to-[#ff6b9d] bg-clip-text text-transparent">
                  Face Identify
                </span>
              </h1>
            </div>
            <p className="text-gray-400 text-lg">
              Your face. Infinite scenes. Swap faces with professional quality using Replicate InstantID.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Source Image */}
            <div className="glass rounded-2xl p-8">
              <h2 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
                <Upload className="w-5 h-5 text-[#00d9ff]" />
                Source Face
              </h2>
              <input
                ref={sourceInputRef}
                type="file"
                accept="image/*"
                onChange={handleSourceImageChange}
                className="hidden"
              />
              <button
                onClick={() => sourceInputRef.current?.click()}
                className="interactive-element w-full h-64 border-2 border-dashed border-white/20 rounded-xl flex flex-col items-center justify-center gap-4 hover:border-[#00d9ff]/50 transition-colors"
              >
                {sourceImage ? (
                  <img
                    src={URL.createObjectURL(sourceImage)}
                    alt="Source"
                    className="w-full h-full object-cover rounded-lg"
                  />
                ) : (
                  <>
                    <Upload className="w-12 h-12 text-gray-400" />
                    <p className="text-gray-400">Upload source face</p>
                  </>
                )}
              </button>
            </div>

            {/* Target Image */}
            <div className="glass rounded-2xl p-8">
              <h2 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
                <ImageIcon className="w-5 h-5 text-[#ff6b9d]" />
                Target Image
              </h2>
              <input
                ref={targetInputRef}
                type="file"
                accept="image/*"
                onChange={handleTargetImageChange}
                className="hidden"
              />
              <button
                onClick={() => targetInputRef.current?.click()}
                className="interactive-element w-full h-64 border-2 border-dashed border-white/20 rounded-xl flex flex-col items-center justify-center gap-4 hover:border-[#ff6b9d]/50 transition-colors"
              >
                {targetImage ? (
                  <img
                    src={URL.createObjectURL(targetImage)}
                    alt="Target"
                    className="w-full h-full object-cover rounded-lg"
                  />
                ) : (
                  <>
                    <Upload className="w-12 h-12 text-gray-400" />
                    <p className="text-gray-400">Upload target image</p>
                  </>
                )}
              </button>
            </div>

            {/* Controls & Result */}
            <div className="glass rounded-2xl p-8 flex flex-col">
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-6">
                  <Sparkles className="w-6 h-6 text-[#fbbf24]" />
                  <h2 className="text-xl font-semibold text-white">Settings & Result</h2>
                </div>
                <div className="mb-6">
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Model (Replicate)
                  </label>
                  <select
                    value={selectedModel}
                    onChange={(e) => setSelectedModel(e.target.value as 'instantid' | 'faceswap')}
                    className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-[#00d9ff]/50 transition-colors interactive-element"
                    disabled={isProcessing}
                  >
                    <option value="instantid">InstantID (subhash/instantid)</option>
                    <option value="faceswap">FaceSwap (lucataco/faceswap)</option>
                  </select>
                </div>
                <button
                  onClick={handleFaceSwap}
                  disabled={isProcessing || !sourceImage || !targetImage || !faceSwapConsent}
                  className="interactive-element try-now-button-modern w-full px-6 py-4 bg-gradient-to-r from-[#00d9ff] to-[#0099ff] text-white font-semibold rounded-xl transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {isProcessing ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      Processing...
                    </>
                  ) : (
                    'Swap Faces'
                  )}
                </button>
                <label className="mt-4 flex items-start gap-2 rounded-lg border border-white/10 bg-black/40 p-3 text-xs text-gray-300">
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
              </div>

              {resultImage && (
                <div className="mt-8">
                  <h3 className="text-lg font-semibold text-white mb-4">Result</h3>
                  <div className="relative w-full h-64 rounded-lg overflow-hidden border border-white/10">
                    <img src={resultImage} alt="Face Swap Result" className="w-full h-full object-contain" />
                  </div>
                  <a
                    href={resultImage}
                    download="face-swap-result.png"
                    className="mt-4 block text-center text-[#00d9ff] hover:underline interactive-element"
                  >
                    Download Result
                  </a>
                </div>
              )}

              {isProcessing && !resultImage && (
                <div className="mt-8 text-center">
                  <Loader2 className="w-12 h-12 animate-spin text-[#00d9ff] mx-auto mb-4" />
                  <p className="text-gray-400">Processing face swap...</p>
                </div>
              )}
            </div>
          </div>
        </div>
        )}
      </main>
    </div>
  );
}
