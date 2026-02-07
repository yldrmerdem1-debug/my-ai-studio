'use client';

import { useEffect, useRef, useState } from 'react';
import Sidebar from '@/components/Sidebar';
import PricingModal from '@/components/PricingModal';
import Link from 'next/link';
import { Sparkles, Upload, Video, FileText, Loader2, BadgeCheck } from 'lucide-react';

type OutputMap = Record<string, string>;

export default function AdCreationPage() {
  const [videoUrl, setVideoUrl] = useState('');
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [ctaText, setCtaText] = useState('Shop Now');
  const [captionText, setCaptionText] = useState('');
  const [useCaptions, setUseCaptions] = useState(true);
  const [format916, setFormat916] = useState(true);
  const [format169, setFormat169] = useState(true);
  const [isPackaging, setIsPackaging] = useState(false);
  const [outputs, setOutputs] = useState<OutputMap>({});
  const [errorMessage, setErrorMessage] = useState('');
  const [isPricingModalOpen, setIsPricingModalOpen] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const latestVideo = localStorage.getItem('latestRawVideoUrl');
    if (latestVideo && !videoUrl) {
      setVideoUrl(latestVideo);
    }
    const directorRaw = localStorage.getItem('adDirectorPlan');
    if (directorRaw) {
      try {
        const parsed = JSON.parse(directorRaw);
        const audioScript = parsed?.scenario?.plan?.audio_script;
        if (audioScript && !captionText) {
          setCaptionText(audioScript);
        }
      } catch {
        // ignore
      }
    }
  }, [videoUrl, captionText]);

  useEffect(() => {
    if (!logoFile) {
      setLogoPreview(null);
      return;
    }
    const objectUrl = URL.createObjectURL(logoFile);
    setLogoPreview(objectUrl);
    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [logoFile]);

  const handlePackaging = async () => {
    if (!videoUrl.trim()) {
      setErrorMessage('Paste a raw video URL from AI Video.');
      return;
    }
    if (!format916 && !format169) {
      setErrorMessage('Select at least one output format.');
      return;
    }
    setIsPackaging(true);
    setErrorMessage('');
    setOutputs({});
    try {
      const logoDataUrl = logoFile
        ? await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(new Error('Failed to read logo'));
          reader.readAsDataURL(logoFile);
        })
        : undefined;

      const response = await fetch('/api/auto-editor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoUrl: videoUrl.trim(),
          logoDataUrl,
          ctaText: ctaText.trim(),
          captionsText: captionText.trim(),
          addCaptions: useCaptions,
          outputFormats: [
            ...(format916 ? ['9:16'] : []),
            ...(format169 ? ['16:9'] : []),
          ],
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || data.details || 'Failed to package video');
      }
      setOutputs(data.outputs || {});
    } catch (error: any) {
      setErrorMessage(error.message || 'Packaging failed');
    } finally {
      setIsPackaging(false);
    }
  };

  return (
    <div className="relative min-h-screen bg-black">
      <Sidebar onSubscriptionClick={() => setIsPricingModalOpen(true)} />
      <PricingModal isOpen={isPricingModalOpen} onClose={() => setIsPricingModalOpen(false)} />

      <main className="relative z-10 ml-64">
        <div className="container mx-auto px-8 py-12">
          <div className="mb-8">
            <Link href="/" className="text-[#00d9ff] hover:text-[#0099ff] mb-4 inline-block transition-colors">
              ← Back to Studio
            </Link>
            <div className="flex items-center gap-3 mb-2">
              <Sparkles className="w-8 h-8 text-[#fbbf24]" style={{ filter: 'drop-shadow(0 0 8px #fbbf24)' }} />
              <h1 className="text-4xl font-bold text-white">
                <span className="bg-gradient-to-r from-[#fbbf24] via-[#f59e0b] to-[#fbbf24] bg-clip-text text-transparent">
                  Auto-Editor
                </span>
              </h1>
            </div>
            <p className="text-gray-400 text-lg">
              Turn a raw AI video into a publish-ready ad with captions, branding, and CTA.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div className="space-y-6">
              <div className="glass rounded-2xl p-8">
                <h2 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
                  <Video className="w-5 h-5 text-[#00d9ff]" />
                  Raw Video Input
                </h2>
                <textarea
                  value={videoUrl}
                  onChange={(event) => setVideoUrl(event.target.value)}
                  placeholder="Paste raw video URL from AI Video"
                  rows={3}
                  className="w-full px-4 py-3 bg-black/40 border border-white/10 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-[#fbbf24]/50 transition-colors resize-none"
                />
                <button
                  type="button"
                  onClick={() => {
                    if (typeof window === 'undefined') return;
                    const latest = localStorage.getItem('latestRawVideoUrl');
                    if (latest) setVideoUrl(latest);
                  }}
                  className="mt-3 text-xs text-[#00d9ff] hover:text-[#0099ff]"
                >
                  Use latest AI Video output
                </button>
              </div>

              <div className="glass rounded-2xl p-8">
                <h2 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
                  <Upload className="w-5 h-5 text-[#00d9ff]" />
                  Brand Logo
                </h2>
                <input
                  ref={logoInputRef}
                  type="file"
                  accept="image/*"
                  onChange={(event) => setLogoFile(event.target.files?.[0] || null)}
                  className="hidden"
                />
                <button
                  onClick={() => logoInputRef.current?.click()}
                  className="interactive-element w-full h-44 border-2 border-dashed border-white/20 rounded-xl flex flex-col items-center justify-center gap-3 hover:border-[#00d9ff]/50 transition-colors"
                >
                  {logoPreview ? (
                    <img src={logoPreview} alt="Logo preview" className="h-24 object-contain" />
                  ) : (
                    <>
                      <Upload className="w-10 h-10 text-gray-400" />
                      <p className="text-gray-400">Upload logo (PNG/SVG)</p>
                    </>
                  )}
                </button>
              </div>

              <div className="glass rounded-2xl p-8 space-y-4">
                <h2 className="text-xl font-semibold text-white flex items-center gap-2">
                  <FileText className="w-5 h-5 text-[#00d9ff]" />
                  Captions & CTA
                </h2>
                <label className="flex items-center gap-3 text-sm text-gray-300">
                  <input
                    type="checkbox"
                    checked={useCaptions}
                    onChange={(event) => setUseCaptions(event.target.checked)}
                    className="h-4 w-4"
                  />
                  Burn in captions (auto-timed)
                </label>
                <textarea
                  value={captionText}
                  onChange={(event) => setCaptionText(event.target.value)}
                  placeholder="Paste the spoken script for captions"
                  rows={4}
                  className="w-full px-4 py-3 bg-black/40 border border-white/10 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-[#fbbf24]/50 transition-colors resize-none"
                />
                <input
                  value={ctaText}
                  onChange={(event) => setCtaText(event.target.value)}
                  placeholder="CTA text (e.g., Shop Now)"
                  className="w-full px-4 py-3 bg-black/40 border border-white/10 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-[#fbbf24]/50 transition-colors"
                />
              </div>

              <div className="glass rounded-2xl p-8 space-y-4">
                <h2 className="text-xl font-semibold text-white">Output Formats</h2>
                <label className="flex items-center gap-3 text-sm text-gray-300">
                  <input
                    type="checkbox"
                    checked={format916}
                    onChange={(event) => setFormat916(event.target.checked)}
                    className="h-4 w-4"
                  />
                  9:16 (TikTok / Reels)
                </label>
                <label className="flex items-center gap-3 text-sm text-gray-300">
                  <input
                    type="checkbox"
                    checked={format169}
                    onChange={(event) => setFormat169(event.target.checked)}
                    className="h-4 w-4"
                  />
                  16:9 (YouTube)
                </label>
                <button
                  type="button"
                  onClick={handlePackaging}
                  disabled={isPackaging}
                  className="interactive-element w-full px-6 py-3 bg-gradient-to-r from-[#fbbf24] to-[#f59e0b] text-black font-semibold rounded-xl transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {isPackaging ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      Packaging...
                    </>
                  ) : (
                    <>
                      <BadgeCheck className="w-5 h-5" />
                      Build Campaign Assets
                    </>
                  )}
                </button>
                {errorMessage && (
                  <div className="text-sm text-red-300 border border-red-500/30 bg-red-500/10 rounded-lg px-3 py-2">
                    {errorMessage}
                  </div>
                )}
              </div>
            </div>

            <div className="glass rounded-2xl p-8">
              <h2 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
                <Video className="w-5 h-5 text-[#fbbf24]" />
                Ready-to-Post Outputs
              </h2>
              {Object.keys(outputs).length === 0 ? (
                <div className="w-full h-[520px] border-2 border-dashed border-white/20 rounded-xl flex items-center justify-center bg-black/30">
                  <div className="text-center text-gray-500">
                    <Video className="w-16 h-16 mx-auto mb-4 text-white/40" />
                    <p>Package a raw video to see final outputs.</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-6">
                  {Object.entries(outputs).map(([format, url]) => (
                    <div key={format} className="space-y-3">
                      <p className="text-sm text-gray-300">{format}</p>
                      <video src={url} controls className="w-full rounded-lg border border-white/10" />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
