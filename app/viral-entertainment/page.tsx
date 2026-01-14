'use client';

import { useState } from 'react';
import Sidebar from '@/components/Sidebar';
import PricingModal from '@/components/PricingModal';
import Link from 'next/link';
import { Zap, Video, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/useToast';

export default function ViralEntertainmentPage() {
  const { showToast } = useToast();
  const [prompt, setPrompt] = useState('');
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isPricingModalOpen, setIsPricingModalOpen] = useState(false);

  const handleGenerateVideo = async () => {
    if (!prompt.trim()) {
      showToast('Please enter a prompt for your video', 'warning');
      return;
    }

    setIsGenerating(true);
    setVideoUrl(null);

    try {
      const response = await fetch('/api/viral-entertainment', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ prompt }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to generate viral video');
      }

      const data = await response.json();
      
      if (data.predictionId) {
        // Poll for result
        const pollInterval = setInterval(async () => {
          try {
            const statusResponse = await fetch(`/api/viral-entertainment/status?predictionId=${data.predictionId}`);
            const statusData = await statusResponse.json();
            
            if (statusData.status === 'succeeded' && statusData.output) {
              clearInterval(pollInterval);
              const videoUrlResult = Array.isArray(statusData.output) ? statusData.output[0] : statusData.output;
              setVideoUrl(videoUrlResult);
              
              // Auto-save to My Assets
              if (typeof window !== 'undefined') {
                const { saveVideoAsset } = await import('@/lib/assets-storage');
                saveVideoAsset(videoUrlResult, `Viral Video - ${new Date().toLocaleDateString()}`, {
                  model: 'fofr/luma-dream-machine',
                  prompt: prompt,
                });
              }
              
              setIsGenerating(false);
              showToast('Video generated successfully!', 'success');
            } else if (statusData.status === 'failed') {
              clearInterval(pollInterval);
              setIsGenerating(false);
              showToast('Video generation failed: ' + (statusData.error || 'Unknown error'), 'error');
            }
          } catch (pollError: any) {
            clearInterval(pollInterval);
            setIsGenerating(false);
            showToast('Failed to check video status', 'error');
          }
        }, 3000);

        setTimeout(() => {
          clearInterval(pollInterval);
          setIsGenerating(false);
          showToast('Generation timeout. Please try again.', 'warning');
        }, 120000);
      }
    } catch (error: any) {
      setIsGenerating(false);
      showToast(error.message || 'Failed to generate video', 'error');
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
              <Zap className="w-8 h-8 text-[#ec4899]" style={{ filter: 'drop-shadow(0 0 8px #ec4899)' }} />
              <h1 className="text-4xl font-bold text-white">
                <span className="bg-gradient-to-r from-[#ec4899] via-[#f43f5e] to-[#ec4899] bg-clip-text text-transparent">
                  Viral / Entertainment
                </span>
              </h1>
            </div>
            <p className="text-gray-400 text-lg">
              Your imagination. Powered by AI. Create viral and entertaining videos with Replicate (Luma/Kling).
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Input Section */}
            <div className="glass rounded-2xl p-8">
              <h2 className="text-2xl font-semibold text-white mb-6">Video Details</h2>
              <div className="space-y-6">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Describe your viral video idea
                  </label>
                  <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="e.g., person dancing in space, action movie scene, podium with lights..."
                    rows={8}
                    className="w-full px-4 py-3 bg-black/40 border border-white/10 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-[#ec4899]/50 transition-colors resize-none interactive-element"
                  />
                </div>

                <button
                  onClick={handleGenerateVideo}
                  disabled={isGenerating || !prompt.trim()}
                  className="interactive-element try-now-button-modern w-full px-10 py-4 bg-gradient-to-r from-[#00d9ff] to-[#0099ff] text-white font-semibold text-lg rounded-xl transition-all duration-300 relative overflow-hidden group disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {isGenerating ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      Generating Video...
                    </>
                  ) : (
                    <>
                      <Video className="w-5 h-5" />
                      Generate Viral Video
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Result Section */}
            <div className="glass rounded-2xl p-8">
              <h2 className="text-2xl font-semibold text-white mb-6">Generated Video</h2>
              <div className="w-full h-[500px] border-2 border-dashed border-white/20 rounded-xl flex items-center justify-center bg-black/30">
                {isGenerating ? (
                  <div className="text-center">
                    <Loader2 className="w-16 h-16 border-4 border-[#ec4899] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
                    <p className="text-gray-400">Generating viral video...</p>
                    <p className="text-sm text-gray-500 mt-2">This may take a few minutes</p>
                  </div>
                ) : videoUrl ? (
                  <video src={videoUrl} controls className="w-full h-full rounded-lg" />
                ) : (
                  <div className="text-center text-gray-500">
                    <Video className="w-20 h-20 mx-auto mb-4 text-white/40" />
                    <p>Your generated video will appear here</p>
                  </div>
                )}
              </div>
              {videoUrl && (
                <a
                  href={videoUrl}
                  download="viral-video.mp4"
                  className="mt-4 block text-center text-[#00d9ff] hover:underline interactive-element"
                >
                  Download Video
                </a>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
