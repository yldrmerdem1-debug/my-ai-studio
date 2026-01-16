'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { FileText, Loader2, Volume2, Lock } from 'lucide-react';
import Sidebar from '@/components/Sidebar';
import PricingModal from '@/components/PricingModal';
import { usePersona } from '@/hooks/usePersona';
import { canUsePersona } from '@/lib/subscription';

const PLATFORM_OPTIONS = ['Instagram', 'TikTok', 'YouTube', 'Facebook', 'LinkedIn', 'Podcast'];
const TONE_OPTIONS = ['Premium', 'Modern', 'Confident', 'Playful', 'Minimal'];
const DURATION_OPTIONS = ['6 seconds', '15 seconds', '30 seconds', '60 seconds', '90 seconds'];

export default function AdScriptPage() {
  const [productDescription, setProductDescription] = useState('');
  const [platform, setPlatform] = useState('');
  const [tone, setTone] = useState('');
  const [duration, setDuration] = useState('');
  const [script, setScript] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isGeneratingVoice, setIsGeneratingVoice] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioFormat, setAudioFormat] = useState<'mp3' | 'wav'>('mp3');
  const [errorMessage, setErrorMessage] = useState('');
  const [isPricingModalOpen, setIsPricingModalOpen] = useState(false);
  const { user, persona } = usePersona();
  const canUsePersonaFeatures = canUsePersona(user);
  const personaReady = persona?.visualStatus === 'ready';
  const voiceReady = persona?.voiceStatus === 'ready';
  const [personaMode, setPersonaMode] = useState<'generic' | 'persona'>('generic');
  const [trainedPersonas, setTrainedPersonas] = useState<string[]>([]);
  const [selectedPersona, setSelectedPersona] = useState('');

  const waveformHeights = useMemo(() => [10, 18, 12, 22, 14, 26, 16, 24, 12, 20, 14, 28, 16, 22], []);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('trainedPersonas');
      if (saved) {
        try {
          setTrainedPersonas(JSON.parse(saved));
        } catch (e) {
          console.error('Failed to load personas:', e);
        }
      }
    }
  }, []);

  const handleGenerate = async () => {
    if (!productDescription.trim()) {
      setErrorMessage('Please describe your product or brand.');
      return;
    }
    if (personaMode === 'persona') {
      if (!canUsePersonaFeatures) {
        setIsPricingModalOpen(true);
        setErrorMessage('Premium required to use Persona Mode.');
        return;
      }
      if (!personaReady) {
        setErrorMessage('Persona Mode requires a ready visual persona.');
        return;
      }
      if (!persona?.id) {
        setErrorMessage('Persona Mode requires a persona identity.');
        return;
      }
      if (!selectedPersona) {
        setErrorMessage('Select a trained persona trigger word for Persona Mode.');
        return;
      }
    }

    setIsLoading(true);
    setErrorMessage('');
    setScript('');
    setAudioUrl(null);

    const preferenceParts = [
      platform ? `Platform: ${platform}` : null,
      tone ? `Tone: ${tone}` : null,
      duration ? `Duration: ${duration}` : null,
    ].filter(Boolean) as string[];

    const composedDescription =
      preferenceParts.length > 0
        ? `${productDescription.trim()}\n\nPreferences: ${preferenceParts.join('. ')}.`
        : productDescription.trim();

    const finalDescription =
      personaMode === 'persona' && selectedPersona
        ? `${composedDescription}\n\nPersona reference: ${selectedPersona}`
        : composedDescription;

    try {
      const response = await fetch('/api/ad-script', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          productDescription: finalDescription,
          triggerWord: personaMode === 'persona' ? selectedPersona : undefined,
          personaMode,
          personaId: persona?.id,
          user,
        }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error || data.details || 'Failed to generate ad script');
      }

      setScript(data.script || '');
    } catch (error: any) {
      setErrorMessage(error.message || 'Failed to generate ad script');
    } finally {
      setIsLoading(false);
    }
  };

  const handleGenerateVoice = async () => {
    if (!script.trim()) {
      setErrorMessage('Generate a script before creating audio.');
      return;
    }
    if (!canUsePersonaFeatures) {
      setIsPricingModalOpen(true);
      setErrorMessage('Premium required to generate voice.');
      return;
    }
    setIsGeneratingVoice(true);
    setErrorMessage('');
    try {
      const response = await fetch('/api/text-to-speech', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: script,
          format: audioFormat,
          useTrainedVoice: voiceReady,
          personaId: persona?.id,
          user,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || data.details || 'Failed to generate voice');
      }
      setAudioUrl(data.audioUrl || null);
    } catch (error: any) {
      setErrorMessage(error.message || 'Failed to generate voice');
    } finally {
      setIsGeneratingVoice(false);
    }
  };

  return (
    <div className="relative min-h-screen bg-[#050505]">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            'radial-gradient(circle at 20% 15%, rgba(0, 217, 255, 0.08), transparent 45%), radial-gradient(circle at 80% 70%, rgba(139, 92, 246, 0.08), transparent 50%)',
        }}
      />
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
                  Ad Script
                </span>
              </h1>
            </div>
            <p className="text-gray-400 text-lg">Generate high-conversion ad scripts with AI.</p>
          </div>

          <section className="grid grid-cols-1 lg:grid-cols-2 gap-8 perf-section">
            <div className="glass rounded-2xl p-8">
              <div className="mb-6">
                <h2 className="text-2xl font-semibold text-white mb-2">Generation Mode</h2>
                <p className="text-sm text-white/50">Persona requires ready visual persona</p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                <button
                  type="button"
                  onClick={() => {
                    setPersonaMode('generic');
                    setSelectedPersona('');
                  }}
                  className={`rounded-lg px-4 py-3 font-medium transition-all ${
                    personaMode === 'generic'
                      ? 'bg-gradient-to-r from-[#00d9ff] to-[#0099cc] text-white'
                      : 'glass text-gray-300 hover:bg-white/5 border border-white/10'
                  }`}
                  disabled={isLoading}
                >
                  Generic Mode (Free)
                </button>
                <button
                  type="button"
                  onClick={() => setPersonaMode('persona')}
                  className={`rounded-lg px-4 py-3 font-medium transition-all ${
                    personaMode === 'persona'
                      ? 'bg-gradient-to-r from-[#00d9ff] to-[#0099cc] text-white'
                      : 'glass text-gray-300 hover:bg-white/5 border border-white/10'
                  }`}
                  disabled={isLoading || !canUsePersonaFeatures || !personaReady}
                >
                  Persona Mode (Premium)
                </button>
              </div>
              {!canUsePersonaFeatures && (
                <p className="text-sm text-yellow-400 mb-4">
                  Premium required to use Persona Mode.
                </p>
              )}
              {canUsePersonaFeatures && !personaReady && (
                <p className="text-sm text-yellow-400 mb-4">
                  Persona Mode is disabled until your visual persona is ready.
                </p>
              )}
              {personaMode === 'persona' && (
                <div className="mb-6">
                  <label className="block text-sm font-medium text-gray-300 mb-2">Trained Persona</label>
                  {trainedPersonas.length > 0 ? (
                    <select
                      value={selectedPersona}
                      onChange={(event) => setSelectedPersona(event.target.value)}
                      disabled={isLoading}
                      className="w-full glass rounded-lg px-4 py-3 text-white border border-white/10 focus:border-[#00d9ff]/50 focus:outline-none"
                    >
                      <option value="">Select a persona</option>
                      {trainedPersonas.map((persona, index) => (
                        <option key={`${persona}-${index}`} value={persona}>
                          {persona}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <p className="text-sm text-yellow-400">
                      No trained personas found. Train one in the Persona Lab first.
                    </p>
                  )}
                </div>
              )}

              <h2 className="text-2xl font-semibold text-white mb-6">Script Details</h2>

              <div className="space-y-6">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2" htmlFor="ad-script-input">
                    Prompt
                  </label>
                  <textarea
                    id="ad-script-input"
                    className="w-full glass rounded-lg px-4 py-3 text-white border border-white/10 focus:border-[#00d9ff]/50 focus:outline-none placeholder-gray-500 resize-none"
                    placeholder="Write a 15-second Instagram ad for a fitness product..."
                    rows={6}
                    value={productDescription}
                    onChange={(event) => setProductDescription(event.target.value)}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
                </div>

                <button
                  type="button"
                  onClick={handleGenerate}
                  disabled={isLoading}
                  className="interactive-element w-full glass rounded-lg px-6 py-4 text-white font-semibold bg-gradient-to-r from-[#00d9ff] to-[#0099cc] hover:from-[#00d9ff]/90 hover:to-[#0099cc]/90 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    'Generate Ad Script'
                  )}
                </button>

                <div className="glass rounded-xl border border-white/10 p-4">
                  <div className="flex items-center justify-between gap-4 mb-3">
                    <div>
                      <p className="text-sm text-white font-medium">Generate Voice</p>
                      <p className="text-xs text-white/50">
                        {voiceReady ? 'Using your trained voice.' : 'Using default voice.'}
                      </p>
                    </div>
                    <select
                      value={audioFormat}
                      onChange={(event) => setAudioFormat(event.target.value as 'mp3' | 'wav')}
                      className="glass rounded-lg px-3 py-2 text-white border border-white/10 focus:border-[#00d9ff]/50 focus:outline-none text-sm"
                      disabled={isGeneratingVoice}
                    >
                      <option value="mp3">MP3</option>
                      <option value="wav">WAV</option>
                    </select>
                  </div>
                  <button
                    type="button"
                    onClick={handleGenerateVoice}
                    disabled={isGeneratingVoice || !script.trim() || !canUsePersonaFeatures}
                    className="interactive-element w-full glass rounded-lg px-6 py-3 text-white font-semibold bg-gradient-to-r from-[#00d9ff] to-[#0099cc] hover:from-[#00d9ff]/90 hover:to-[#0099cc]/90 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    title={!canUsePersonaFeatures ? 'Premium required to generate voice' : ''}
                  >
                    {isGeneratingVoice ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin" />
                        Generating Voice...
                      </>
                    ) : (
                      'Generate Voice'
                    )}
                  </button>
                  {!canUsePersonaFeatures && (
                    <p className="text-xs text-yellow-400 mt-3 flex items-center gap-2">
                      <Lock className="w-4 h-4" />
                      Premium required to generate voice.
                    </p>
                  )}
                </div>

                {errorMessage ? (
                  <div className="glass rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                    {errorMessage}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="space-y-8">
              <div className="glass rounded-2xl p-8">
                <h2 className="text-2xl font-semibold text-white mb-4">Generated Script</h2>
                <div className="min-h-[220px] bg-black/40 border border-white/10 rounded-lg p-6">
                  {script ? (
                    <pre className="text-white whitespace-pre-wrap font-sans text-sm leading-relaxed">
                      {script}
                    </pre>
                  ) : (
                    <div className="text-sm text-white/40 space-y-3">
                      <p>Generated ad script will appear here.</p>
                      <div className="flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full bg-[#00d9ff]/60 animate-pulse" />
                        <span className="text-xs uppercase tracking-[0.2em] text-white/40">Awaiting prompt</span>
                      </div>
                    </div>
                  )}
                  <div className="mt-6 flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-white/40">
                    <span className="h-1 w-1 rounded-full bg-[#00d9ff]/70 animate-pulse" />
                    <span className="h-1 w-3 rounded-full bg-[#00d9ff]/50 animate-pulse" />
                    <span className="h-1 w-2 rounded-full bg-[#00d9ff]/40 animate-pulse" />
                    <span>Audio pulse</span>
                  </div>
                </div>
                {audioUrl && (
                  <div className="mt-6">
                    <h3 className="text-sm font-semibold text-white mb-2">Generated Audio</h3>
                    <audio controls className="w-full">
                      <source src={audioUrl} type={`audio/${audioFormat}`} />
                    </audio>
                  </div>
                )}
              </div>

              <div className="glass rounded-2xl p-8 border border-white/10">
                <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-gray-300">
                  <Volume2 className="w-4 h-4 text-[#00d9ff]" />
                  Audio Pulse
                </div>
                <div className="mt-4 flex items-end gap-1">
                  {waveformHeights.map((height, index) => (
                    <span
                      key={`${height}-${index}`}
                      className="w-2 rounded-full bg-[#00d9ff]/70 animate-pulse"
                      style={{ height: `${height}px`, animationDelay: `${index * 0.12}s` }}
                    />
                  ))}
                </div>
                <p className="mt-4 text-sm text-gray-400">
                  Subtle waveform animation keeps the experience audio-forward without visual noise.
                </p>
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
