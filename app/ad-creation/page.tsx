'use client';

import { useState, useRef } from 'react';
import Sidebar from '@/components/Sidebar';
import PricingModal from '@/components/PricingModal';
import Link from 'next/link';
import { Sparkles, Upload, Video, FileText, Volume2, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/useToast';

export default function AdCreationPage() {
  const { showToast } = useToast();
  const [productImage, setProductImage] = useState<File | null>(null);
  const [productDescription, setProductDescription] = useState('');
  const [generatedScript, setGeneratedScript] = useState('');
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [isGeneratingScript, setIsGeneratingScript] = useState(false);
  const [isConvertingToVoice, setIsConvertingToVoice] = useState(false);
  const [isGeneratingVideo, setIsGeneratingVideo] = useState(false);
  const [currentStep, setCurrentStep] = useState<'script' | 'voice' | 'video' | null>(null);
  const [isPricingModalOpen, setIsPricingModalOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) setProductImage(file);
  };

  const handleGenerateScript = async () => {
    if (!productDescription.trim()) {
      showToast('Please enter a product description', 'warning');
      return;
    }

    setIsGeneratingScript(true);
    setCurrentStep('script');
    setGeneratedScript('');
    setAudioUrl(null);
    setVideoUrl(null);

    try {
      const response = await fetch('/api/generate-ad-script', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt: productDescription,
          context: {
            length: 'medium',
            tone: 'energetic',
          },
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to generate script');
      }

      const data = await response.json();
      setGeneratedScript(data.script || '');
      showToast('Script generated successfully!', 'success');
    } catch (error: any) {
      showToast(error.message || 'Failed to generate script', 'error');
    } finally {
      setIsGeneratingScript(false);
    }
  };

  const handleConvertToVoice = async () => {
    if (!generatedScript.trim()) {
      showToast('Please generate a script first', 'warning');
      return;
    }

    setIsConvertingToVoice(true);
    setCurrentStep('voice');
    setAudioUrl(null);

    try {
      const response = await fetch('/api/text-to-speech', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: generatedScript,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to convert to speech');
      }

      const data = await response.json();
      setAudioUrl(data.audioUrl);

      // Auto-save audio
      if (data.audioUrl && typeof window !== 'undefined') {
        const { saveAudioAsset } = await import('@/lib/assets-storage');
        saveAudioAsset(data.audioUrl, `Ad Voiceover - ${new Date().toLocaleDateString()}`, {
          model: 'elevenlabs',
        });
      }

      showToast('Voiceover generated successfully!', 'success');
    } catch (error: any) {
      showToast(error.message || 'Failed to convert to speech', 'error');
    } finally {
      setIsConvertingToVoice(false);
    }
  };

  const handleGenerateVideo = async () => {
    if (!productImage) {
      showToast('Please upload a product image', 'warning');
      return;
    }
    if (!generatedScript.trim()) {
      showToast('Please generate a script first', 'warning');
      return;
    }

    setIsGeneratingVideo(true);
    setCurrentStep('video');
    setVideoUrl(null);

    try {
      const formData = new FormData();
      formData.append('image', productImage);
      formData.append('prompt', generatedScript);

      const response = await fetch('/api/ad-creation', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to create ad video');
      }

      const data = await response.json();
      
      if (data.predictionId) {
        // Poll for result
        const pollInterval = setInterval(async () => {
          try {
            const statusResponse = await fetch(`/api/ad-creation/status?predictionId=${data.predictionId}`);
            const statusData = await statusResponse.json();
            
            if (statusData.status === 'succeeded' && statusData.output) {
              clearInterval(pollInterval);
              const videoUrlResult = Array.isArray(statusData.output) ? statusData.output[0] : statusData.output;
              setVideoUrl(videoUrlResult);
              
              // Auto-save video
              if (typeof window !== 'undefined') {
                const { saveVideoAsset } = await import('@/lib/assets-storage');
                saveVideoAsset(videoUrlResult, `Ad Video - ${new Date().toLocaleDateString()}`, {
                  model: 'fofr/luma-dream-machine',
                  prompt: generatedScript,
                });
              }
              
              setIsGeneratingVideo(false);
              setCurrentStep(null);
              showToast('Video generated successfully!', 'success');
            } else if (statusData.status === 'failed') {
              clearInterval(pollInterval);
              setIsGeneratingVideo(false);
              setCurrentStep(null);
              showToast('Video generation failed: ' + (statusData.error || 'Unknown error'), 'error');
            }
          } catch (pollError: any) {
            clearInterval(pollInterval);
            setIsGeneratingVideo(false);
            setCurrentStep(null);
            showToast('Failed to check video status', 'error');
          }
        }, 3000);

        setTimeout(() => {
          clearInterval(pollInterval);
          setIsGeneratingVideo(false);
          setCurrentStep(null);
          showToast('Generation timeout. Please try again.', 'warning');
        }, 120000);
      }
    } catch (error: any) {
      setIsGeneratingVideo(false);
      setCurrentStep(null);
      showToast(error.message || 'Failed to create ad', 'error');
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
              <Sparkles className="w-8 h-8 text-[#fbbf24]" style={{ filter: 'drop-shadow(0 0 8px #fbbf24)' }} />
              <h1 className="text-4xl font-bold text-white">
                <span className="bg-gradient-to-r from-[#fbbf24] via-[#f59e0b] to-[#fbbf24] bg-clip-text text-transparent">
                  AI Ad Creation
                </span>
              </h1>
            </div>
            <p className="text-gray-400 text-lg">
              Create complete ad videos: Generate script with Gemini, convert to voice with ElevenLabs, and create video with Replicate.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Input Section */}
            <div className="space-y-6">
              {/* Product Image */}
              <div className="glass rounded-2xl p-8">
                <h2 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
                  <Upload className="w-5 h-5 text-[#00d9ff]" />
                  Product Image
                </h2>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleImageUpload}
                  className="hidden"
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="interactive-element w-full h-64 border-2 border-dashed border-white/20 rounded-xl flex flex-col items-center justify-center gap-4 hover:border-[#00d9ff]/50 transition-colors"
                >
                  {productImage ? (
                    <img
                      src={URL.createObjectURL(productImage)}
                      alt="Product"
                      className="w-full h-full object-cover rounded-lg"
                    />
                  ) : (
                    <>
                      <Upload className="w-12 h-12 text-gray-400" />
                      <p className="text-gray-400">Click to upload product image</p>
                    </>
                  )}
                </button>
              </div>

              {/* Product Description */}
              <div className="glass rounded-2xl p-8">
                <h2 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
                  <FileText className="w-5 h-5 text-[#00d9ff]" />
                  Product Description
                </h2>
                <textarea
                  value={productDescription}
                  onChange={(e) => setProductDescription(e.target.value)}
                  placeholder="Describe your product, key features, and target audience..."
                  rows={6}
                  className="w-full px-4 py-3 bg-black/40 border border-white/10 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-[#fbbf24]/50 transition-colors resize-none interactive-element"
                />
                <button
                  onClick={handleGenerateScript}
                  disabled={isGeneratingScript || !productDescription.trim()}
                  className="interactive-element mt-4 w-full px-6 py-3 bg-gradient-to-r from-[#00d9ff] to-[#0099ff] text-white font-semibold rounded-xl transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {isGeneratingScript ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      Generating Script...
                    </>
                  ) : (
                    <>
                      <FileText className="w-5 h-5" />
                      Step 1: Generate Script (Gemini)
                    </>
                  )}
                </button>
              </div>

              {/* Script Output */}
              {generatedScript && (
                <div className="glass rounded-2xl p-8">
                  <h2 className="text-xl font-semibold text-white mb-4">Generated Script</h2>
                  <div className="bg-black/40 border border-white/10 rounded-lg p-4 mb-4 max-h-48 overflow-y-auto">
                    <pre className="text-white whitespace-pre-wrap font-sans text-sm leading-relaxed">
                      {generatedScript}
                    </pre>
                  </div>
                  <button
                    onClick={handleConvertToVoice}
                    disabled={isConvertingToVoice}
                    className="interactive-element w-full px-6 py-3 bg-gradient-to-r from-[#00d9ff] to-[#0099ff] text-white font-semibold rounded-xl transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {isConvertingToVoice ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin" />
                        Converting to Voice...
                      </>
                    ) : (
                      <>
                        <Volume2 className="w-5 h-5" />
                        Step 2: Convert to Voice (ElevenLabs)
                      </>
                    )}
                  </button>
                </div>
              )}

              {/* Audio Output */}
              {audioUrl && (
                <div className="glass rounded-2xl p-8">
                  <h2 className="text-xl font-semibold text-white mb-4">Voiceover</h2>
                  <audio src={audioUrl} controls className="w-full mb-4" />
                  <button
                    onClick={handleGenerateVideo}
                    disabled={isGeneratingVideo || !productImage}
                    className="interactive-element w-full px-6 py-3 bg-gradient-to-r from-[#fbbf24] to-[#f59e0b] text-white font-semibold rounded-xl transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {isGeneratingVideo ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin" />
                        Generating Video...
                      </>
                    ) : (
                      <>
                        <Video className="w-5 h-5" />
                        Step 3: Generate Video (Replicate)
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>

            {/* Result Section */}
            <div className="glass rounded-2xl p-8">
              <h2 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
                <Video className="w-5 h-5 text-[#fbbf24]" />
                Final Ad Video
              </h2>
              <div className="w-full h-[600px] border-2 border-dashed border-white/20 rounded-xl flex items-center justify-center bg-black/30">
                {isGeneratingVideo || currentStep === 'video' ? (
                  <div className="text-center">
                    <Loader2 className="w-16 h-16 border-4 border-[#fbbf24] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
                    <p className="text-gray-400">Generating ad video...</p>
                    <p className="text-sm text-gray-500 mt-2">This may take a few minutes</p>
                  </div>
                ) : videoUrl ? (
                  <video src={videoUrl} controls className="w-full h-full rounded-lg" />
                ) : (
                  <div className="text-center text-gray-500">
                    <Video className="w-20 h-20 mx-auto mb-4 text-white/40" />
                    <p>Complete all steps to generate your ad video</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
