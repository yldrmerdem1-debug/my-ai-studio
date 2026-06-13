'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Sparkles } from 'lucide-react';
import Link from 'next/link';

interface HeroSectionProps {
  onScrollProgress?: (progress: number) => void;
}

export default function HeroSection({ onScrollProgress }: HeroSectionProps) {
  const heroRef = useRef<HTMLElement>(null);

  // Staged intro: text reveals first, then the real-output showcase animates in.
  const [introStage, setIntroStage] = useState<
    'initial' | 'headline' | 'subtext' | 'cta' | 'complete'
  >('initial');
  const [showcaseVisible, setShowcaseVisible] = useState(false);

  useEffect(() => {
    const timers: NodeJS.Timeout[] = [];
    timers.push(setTimeout(() => setShowcaseVisible(true), 150));
    timers.push(setTimeout(() => setIntroStage('headline'), 300));
    timers.push(setTimeout(() => setIntroStage('subtext'), 1000));
    timers.push(setTimeout(() => setIntroStage('cta'), 1700));
    timers.push(setTimeout(() => setIntroStage('complete'), 2300));
    return () => timers.forEach((timer) => clearTimeout(timer));
  }, []);

  useEffect(() => {
    if (introStage === 'complete') {
      onScrollProgress?.(0);
    }
  }, [introStage, onScrollProgress]);

  const headlineVisible = introStage !== 'initial';
  const subtextVisible = introStage === 'subtext' || introStage === 'cta' || introStage === 'complete';
  const ctaVisible = introStage === 'cta' || introStage === 'complete';

  const fade = (visible: boolean, y = 16) => ({
    opacity: visible ? 1 : 0,
    transform: visible ? 'translateY(0)' : `translateY(${y}px)`,
    transition: 'opacity 0.7s ease-out, transform 0.7s cubic-bezier(0.4, 0, 0.2, 1)',
  });

  return (
    <section
      ref={heroRef}
      className="relative min-h-screen w-full overflow-hidden"
      style={{ contain: 'layout paint' }}
    >
      {/* Ambient background */}
      <div className="absolute inset-0 z-0 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-gray-950 via-black to-gray-950" />
        <div className="absolute left-0 top-0 h-full w-1/2 bg-gradient-to-r from-[#00d9ff]/12 via-[#00d9ff]/5 to-transparent" />
        <div className="absolute right-0 top-0 h-full w-1/2 bg-gradient-to-l from-[#8b5cf6]/12 via-[#0099ff]/5 to-transparent" />
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              'radial-gradient(circle at 70% 45%, rgba(0, 217, 255, 0.10), transparent 55%)',
          }}
        />
      </div>

      <div className="relative z-10 mx-auto flex min-h-screen max-w-7xl flex-col items-center gap-10 px-6 py-24 lg:flex-row lg:gap-12 lg:px-10 lg:py-0">
        {/* Left: sales-focused copy */}
        <div className="w-full max-w-xl text-center lg:w-[44%] lg:text-left">
          <div
            className="mb-6 inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-300/10 px-4 py-1.5 text-xs font-medium text-cyan-100"
            style={fade(headlineVisible)}
          >
            <Sparkles className="h-3.5 w-3.5" />
            Train your AI persona once
          </div>

          <h1
            className="text-4xl font-bold leading-[1.08] sm:text-5xl lg:text-6xl"
            style={fade(headlineVisible)}
          >
            <span className="text-white">Turn yourself into</span>{' '}
            <span className="bg-gradient-to-r from-[#00d9ff] via-[#22d3ee] to-[#0099ff] bg-clip-text text-transparent">
              scroll-stopping ads
            </span>
          </h1>

          <p
            className="mt-6 text-lg leading-relaxed text-gray-300 sm:text-xl"
            style={fade(subtextVisible)}
          >
            Upload 20 photos. Get studio images, product ads, and cinematic videos
            that keep <span className="font-semibold text-white">your exact face</span> — no shoots, no agencies, no prompts.
          </p>

          <div
            className="mt-8 flex flex-col items-center gap-4 sm:flex-row lg:items-start"
            style={fade(ctaVisible, 20)}
          >
            <Link
              href="/persona"
              className="group relative inline-flex items-center gap-3 rounded-xl bg-gradient-to-r from-[#00d9ff] to-[#0099ff] px-8 py-4 text-base font-semibold text-black shadow-[0_0_24px_rgba(0,217,255,0.35)] transition-transform hover:scale-[1.03]"
            >
              <span className="flex items-center gap-2">
                Create your AI persona
                <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
              </span>
            </Link>
            <Link
              href="/background-change"
              className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-6 py-4 text-base font-medium text-white transition-colors hover:border-cyan-300/30 hover:bg-white/10"
            >
              See it on a product
            </Link>
          </div>

          <div
            className="mt-8 flex items-center justify-center gap-5 text-xs text-gray-400 lg:justify-start"
            style={fade(ctaVisible, 20)}
          >
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              Identity-locked output
            </span>
            <span className="hidden h-3 w-px bg-white/15 sm:block" />
            <span>Images · Videos · Product ads</span>
          </div>
        </div>

        {/* Right: REAL output showcase (replaces the generic 3D robot) */}
        <div className="w-full lg:w-[56%]">
          <div
            className="relative mx-auto grid h-[360px] w-full max-w-xl grid-cols-2 grid-rows-2 gap-4 sm:h-[440px] lg:h-[520px] lg:max-w-none"
            style={{
              opacity: showcaseVisible ? 1 : 0,
              transform: showcaseVisible ? 'translateY(0) scale(1)' : 'translateY(24px) scale(0.97)',
              transition: 'opacity 0.9s ease-out, transform 1s cubic-bezier(0.34, 1.56, 0.64, 1)',
            }}
          >
            {/* Main cinematic video tile (vertical, fills both rows) */}
            <div className="hero-float-a relative row-span-2 overflow-hidden rounded-2xl border border-white/10 bg-[#0a0a0a] shadow-[0_20px_70px_rgba(0,0,0,0.45)]">
              <video
                src="/videos/video-studio-preview.mp4"
                poster="/images/video-studio-poster.jpg"
                muted
                loop
                playsInline
                autoPlay
                preload="auto"
                className="absolute inset-0 h-full w-full object-cover"
              />
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
              <span className="absolute bottom-3 left-3 rounded-full bg-black/55 px-3 py-1 text-[11px] font-medium text-white backdrop-blur">
                AI Video
              </span>
            </div>

            {/* Before/after image tile (same identity, new scene) */}
            <div className="hero-float-b relative overflow-hidden rounded-2xl border border-white/10 bg-[#0a0a0a] shadow-[0_20px_70px_rgba(0,0,0,0.45)]">
              <img
                src="/images/image-studio-after.jpg"
                alt="AI-generated scene with preserved identity"
                className="absolute inset-0 h-full w-full object-cover"
                loading="eager"
                decoding="async"
              />
              <img
                src="/images/image-studio-before.jpg"
                alt="Original uploaded photo"
                className="hero-beforeafter-top absolute inset-0 h-full w-full object-cover"
                loading="eager"
                decoding="async"
              />
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-transparent" />
              <span className="absolute bottom-3 left-3 rounded-full bg-black/55 px-3 py-1 text-[11px] font-medium text-white backdrop-blur">
                Before → After
              </span>
            </div>

            {/* Viral / product video tile */}
            <div className="hero-float-c relative overflow-hidden rounded-2xl border border-white/10 bg-[#0a0a0a] shadow-[0_20px_70px_rgba(0,0,0,0.45)]">
              <video
                src="/videos/viral-preview.mp4"
                poster="/images/viral-preview-poster.jpg"
                muted
                loop
                playsInline
                autoPlay
                preload="auto"
                className="absolute inset-0 h-full w-full object-cover"
              />
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-transparent" />
              <span className="absolute bottom-3 left-3 rounded-full bg-black/55 px-3 py-1 text-[11px] font-medium text-white backdrop-blur">
                Viral Ad
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Scroll indicator */}
      {introStage === 'complete' && (
        <div className="absolute bottom-6 left-1/2 z-20 -translate-x-1/2">
          <div className="flex flex-col items-center gap-2 text-gray-400">
            <span className="text-xs">Scroll to explore</span>
            <div className="flex h-9 w-6 items-start justify-center rounded-full border-2 border-gray-400/30 p-2">
              <div
                className="h-1.5 w-1.5 rounded-full bg-[#00d9ff] animate-bounce"
                style={{ animationDuration: '1.5s' }}
              />
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
