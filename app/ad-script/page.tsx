'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FileText, Link2, Loader2, Sparkles, CheckCircle2 } from 'lucide-react';
import Sidebar from '@/components/Sidebar';
import PricingModal from '@/components/PricingModal';

const PLATFORM_OPTIONS = ['Instagram', 'TikTok', 'YouTube', 'Facebook', 'LinkedIn', 'Podcast'];
const TONE_OPTIONS = ['Premium', 'Modern', 'Confident', 'Playful', 'Minimal'];
const DURATION_OPTIONS = ['6 seconds', '15 seconds', '30 seconds', '60 seconds', '90 seconds'];
const OBJECTIVE_OPTIONS = ['Brand awareness', 'Conversions', 'Product launch', 'App installs', 'Lead gen'];

type DirectorPlan = {
  visual_prompt: string;
  audio_script: string;
  voice_emotion: string;
  sfx_prompt: string;
  camera_movement: string;
};

type DirectorScenario = {
  title: string;
  hook: string;
  angle: string;
  plan: DirectorPlan;
};

export default function AdScriptPage() {
  const router = useRouter();
  const [productUrl, setProductUrl] = useState('');
  const [productBrief, setProductBrief] = useState('');
  const [platform, setPlatform] = useState('');
  const [tone, setTone] = useState('');
  const [duration, setDuration] = useState('');
  const [objective, setObjective] = useState('');
  const [audience, setAudience] = useState('');
  const [scenarios, setScenarios] = useState<DirectorScenario[]>([]);
  const [recommendation, setRecommendation] = useState('');
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [isPricingModalOpen, setIsPricingModalOpen] = useState(false);

  const selectedScenario = useMemo(
    () => (selectedIndex !== null ? scenarios[selectedIndex] : null),
    [scenarios, selectedIndex]
  );

  const handleGenerate = async () => {
    if (!productUrl.trim() && !productBrief.trim()) {
      setErrorMessage('Please paste a product link or describe the offer.');
      return;
    }
    setIsLoading(true);
    setErrorMessage('');
    setScenarios([]);
    setRecommendation('');
    setSelectedIndex(null);
    try {
      const response = await fetch('/api/ad-script', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productUrl: productUrl.trim() || undefined,
          productBrief: productBrief.trim() || undefined,
          platform: platform || undefined,
          tone: tone || undefined,
          duration: duration || undefined,
          objective: objective || undefined,
          audience: audience || undefined,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || data.details || 'Failed to generate director plan');
      }
      setScenarios(Array.isArray(data.scenarios) ? data.scenarios : []);
      setRecommendation(typeof data.recommendation === 'string' ? data.recommendation : '');
      if (Array.isArray(data.scenarios) && data.scenarios.length > 0) {
        setSelectedIndex(0);
      }
    } catch (error: any) {
      setErrorMessage(error.message || 'Failed to generate director plan');
    } finally {
      setIsLoading(false);
    }
  };

  const handleApprove = () => {
    if (!selectedScenario) {
      setErrorMessage('Select a scenario before sending to AI Video.');
      return;
    }
    const payload = {
      scenario: selectedScenario,
      inputs: {
        productUrl: productUrl.trim(),
        productBrief: productBrief.trim(),
        platform,
        tone,
        duration,
        objective,
        audience,
      },
      createdAt: new Date().toISOString(),
    };
    if (typeof window !== 'undefined') {
      localStorage.setItem('adDirectorPlan', JSON.stringify(payload));
    }
    router.push('/video?from=director');
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
                  AI Director
                </span>
              </h1>
            </div>
            <p className="text-gray-400 text-lg">
              Strategy center for your campaign. Paste a link, get the full scene plan.
            </p>
          </div>

          <section className="grid grid-cols-1 lg:grid-cols-2 gap-8 perf-section">
            <div className="glass rounded-2xl p-8 space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2" htmlFor="product-url">
                  Product Link
                </label>
                <div className="flex items-center gap-3 rounded-lg border border-white/10 bg-black/40 px-4 py-3">
                  <Link2 className="h-4 w-4 text-gray-400" />
                  <input
                    id="product-url"
                    type="url"
                    value={productUrl}
                    onChange={(event) => setProductUrl(event.target.value)}
                    placeholder="https://your-product-page.com"
                    className="w-full bg-transparent text-sm text-white outline-none placeholder:text-gray-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2" htmlFor="product-brief">
                  Offer Summary
                </label>
                <textarea
                  id="product-brief"
                  className="w-full glass rounded-lg px-4 py-3 text-white border border-white/10 focus:border-[#00d9ff]/50 focus:outline-none placeholder-gray-500 resize-none"
                  placeholder="Spor ayakkabı satıyorum, enerjik ve hızlı olsun. Avantajlar: hafif taban, 30 gün deneme..."
                  rows={5}
                  value={productBrief}
                  onChange={(event) => setProductBrief(event.target.value)}
                />
              </div>

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

              <button
                type="button"
                onClick={handleGenerate}
                disabled={isLoading}
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
                    <button
                      type="button"
                      onClick={handleApprove}
                      className="mt-6 w-full rounded-lg px-6 py-4 text-sm font-semibold text-black bg-gradient-to-r from-[#00d9ff] to-[#0099cc] hover:opacity-90 transition-all"
                    >
                      Approve & Send to AI Video
                    </button>
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
