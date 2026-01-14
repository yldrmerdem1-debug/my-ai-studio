'use client';

import { useState } from 'react';
import Sidebar from '@/components/Sidebar';
import PricingModal from '@/components/PricingModal';
import Link from 'next/link';
import { FileText, Volume2, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/useToast';

export default function AdScriptPage() {
  const { showToast } = useToast();
  const [prompt, setPrompt] = useState('');
  const [context, setContext] = useState({
    tone: '',
    targetAudience: '',
    callToAction: '',
    length: 'medium',
    style: '',
  });
  const [script, setScript] = useState('');
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isConverting, setIsConverting] = useState(false);
  const [isPricingModalOpen, setIsPricingModalOpen] = useState(false);

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      showToast('Please enter a prompt', 'warning');
      return;
    }

    setIsGenerating(true);
    setScript('');
    setAudioUrl(null);

    try {
      const response = await fetch('/api/generate-ad-script', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt,
          context: Object.keys(context).reduce((acc, key) => {
            if (context[key as keyof typeof context]) {
              acc[key] = context[key as keyof typeof context];
            }
            return acc;
          }, {} as Record<string, string>),
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to generate script');
      }

      const data = await response.json();
      const generatedScript = data.script || '';
      setScript(generatedScript);

      // Auto-save to My Assets
      if (generatedScript && typeof window !== 'undefined') {
        const { saveScriptAsset } = await import('@/lib/assets-storage');
        const scriptName = `Ad Script - ${prompt.substring(0, 30)}${prompt.length > 30 ? '...' : ''}`;
        saveScriptAsset(generatedScript, scriptName, {
          prompt,
          tone: context.tone,
          targetAudience: context.targetAudience,
          model: 'gemini-1.5-pro',
        });
      }

      showToast('Script generated successfully!', 'success');
    } catch (error: any) {
      showToast(error.message || 'Failed to generate script', 'error');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleConvertToSpeech = async () => {
    if (!script.trim()) {
      showToast('Please generate a script first', 'warning');
      return;
    }

    setIsConverting(true);
    setAudioUrl(null);

    try {
      const response = await fetch('/api/text-to-speech', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: script,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to convert to speech');
      }

      const data = await response.json();
      setAudioUrl(data.audioUrl);

      // Auto-save audio to My Assets
      if (data.audioUrl && typeof window !== 'undefined') {
        const { saveAudioAsset } = await import('@/lib/assets-storage');
        saveAudioAsset(data.audioUrl, `Ad Voiceover - ${new Date().toLocaleDateString()}`, {
          model: 'elevenlabs',
          script: script.substring(0, 100),
        });
      }

      showToast('Voiceover generated successfully!', 'success');
    } catch (error: any) {
      showToast(error.message || 'Failed to convert to speech', 'error');
    } finally {
      setIsConverting(false);
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
              <FileText className="w-8 h-8 text-[#00d9ff]" style={{ filter: 'drop-shadow(0 0 8px #00d9ff)' }} />
              <h1 className="text-4xl font-bold text-white">
                <span className="bg-gradient-to-r from-[#00d9ff] via-[#0099cc] to-[#00d9ff] bg-clip-text text-transparent">
                  AI Ad Script
                </span>
              </h1>
            </div>
            <p className="text-gray-400 text-lg">
              Generate high-converting marketing scripts with AI. Convert scripts to professional voiceovers.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Input Section */}
            <div className="glass rounded-2xl p-8">
              <h2 className="text-2xl font-semibold text-white mb-6">Script Details</h2>
              
              <div className="space-y-6">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Product/Service Description *
                  </label>
                  <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="Describe your product, service, or the ad you want to create..."
                    className="w-full px-4 py-3 bg-black/40 border border-white/10 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-[#00d9ff]/50 transition-colors resize-none interactive-element"
                    rows={6}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Tone
                  </label>
                  <select
                    value={context.tone}
                    onChange={(e) => setContext({ ...context, tone: e.target.value })}
                    className="w-full px-4 py-3 bg-black/40 border border-white/10 rounded-lg text-white focus:outline-none focus:border-[#00d9ff]/50 transition-colors interactive-element"
                  >
                    <option value="">Select tone...</option>
                    <option value="professional">Professional</option>
                    <option value="casual">Casual</option>
                    <option value="humorous">Humorous</option>
                    <option value="energetic">Energetic</option>
                    <option value="serious">Serious</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Target Audience
                  </label>
                  <input
                    type="text"
                    value={context.targetAudience}
                    onChange={(e) => setContext({ ...context, targetAudience: e.target.value })}
                    placeholder="e.g., Young professionals, Parents, Tech enthusiasts..."
                    className="w-full px-4 py-3 bg-black/40 border border-white/10 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-[#00d9ff]/50 transition-colors interactive-element"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Call to Action
                  </label>
                  <input
                    type="text"
                    value={context.callToAction}
                    onChange={(e) => setContext({ ...context, callToAction: e.target.value })}
                    placeholder="e.g., Buy now, Sign up, Learn more..."
                    className="w-full px-4 py-3 bg-black/40 border border-white/10 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-[#00d9ff]/50 transition-colors interactive-element"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Length
                  </label>
                  <select
                    value={context.length}
                    onChange={(e) => setContext({ ...context, length: e.target.value })}
                    className="w-full px-4 py-3 bg-black/40 border border-white/10 rounded-lg text-white focus:outline-none focus:border-[#00d9ff]/50 transition-colors interactive-element"
                  >
                    <option value="short">Short (15-30 seconds)</option>
                    <option value="medium">Medium (30-60 seconds)</option>
                    <option value="long">Long (60+ seconds)</option>
                  </select>
                </div>

                <button
                  onClick={handleGenerate}
                  disabled={isGenerating || !prompt.trim()}
                  className="interactive-element try-now-button-modern w-full px-6 py-4 bg-gradient-to-r from-[#00d9ff] to-[#0099ff] text-white font-semibold rounded-xl transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {isGenerating ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    'Generate Script'
                  )}
                </button>
              </div>
            </div>

            {/* Output Section */}
            <div className="glass rounded-2xl p-8">
              <h2 className="text-2xl font-semibold text-white mb-6">Generated Script</h2>
              
              {script ? (
                <div className="space-y-4">
                  <div className="bg-black/40 border border-white/10 rounded-lg p-6">
                    <pre className="text-white whitespace-pre-wrap font-sans text-sm leading-relaxed">
                      {script}
                    </pre>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(script);
                        showToast('Script copied to clipboard!', 'success');
                      }}
                      className="interactive-element px-4 py-3 bg-white/10 border border-white/20 rounded-lg text-white text-sm hover:bg-white/20 transition-colors"
                    >
                      Copy Script
                    </button>
                    <button
                      onClick={handleConvertToSpeech}
                      disabled={isConverting}
                      className="interactive-element px-4 py-3 bg-gradient-to-r from-[#00d9ff] to-[#0099ff] border border-[#00d9ff]/50 rounded-lg text-white text-sm hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                      {isConverting ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Converting...
                        </>
                      ) : (
                        <>
                          <Volume2 className="w-4 h-4" />
                          Convert to Speech
                        </>
                      )}
                    </button>
                  </div>

                  {audioUrl && (
                    <div className="mt-4">
                      <audio src={audioUrl} controls className="w-full" />
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex items-center justify-center h-64 text-gray-500">
                  <p>Your generated script will appear here...</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
