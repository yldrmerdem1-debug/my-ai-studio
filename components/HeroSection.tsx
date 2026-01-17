'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { SplineScene } from '@/components/ui/splite';

interface HeroSectionProps {
  onScrollProgress?: (progress: number) => void;
}

export default function HeroSection({ onScrollProgress }: HeroSectionProps) {
  const heroRef = useRef<HTMLElement>(null);
  
  // Intro sequence states
  const [introStage, setIntroStage] = useState<'initial' | 'robot-move' | 'headline' | 'subtext-1' | 'subtext-2' | 'cta' | 'complete'>('initial');
  const [robotScale, setRobotScale] = useState(0.8); // Start smaller for scale-up animation
  const [robotOpacity, setRobotOpacity] = useState(0); // Start invisible for fade-in
  const [robotTranslateX, setRobotTranslateX] = useState(0);
  const [headlineOpacity, setHeadlineOpacity] = useState(0);
  const [subtext1Opacity, setSubtext1Opacity] = useState(0);
  const [subtext2Opacity, setSubtext2Opacity] = useState(0);
  const [ctaOpacity, setCtaOpacity] = useState(0);

  // Intro sequence animation - Faster, more impactful (within 5 seconds)
  useEffect(() => {
    const timers: NodeJS.Timeout[] = [];

    // Stage 1: Robot fades in and scales up (0ms - immediate)
    timers.push(setTimeout(() => {
      setRobotOpacity(1);
      setRobotScale(1.9); // Scale up to fill screen
    }, 100));

    // Stage 2: Robot moves and scales down (600ms - faster)
    timers.push(setTimeout(() => {
      setIntroStage('robot-move');
      setRobotScale(0.9);
      setRobotTranslateX(100);
    }, 600));

    // Stage 3: Headline appears (1000ms - faster)
    timers.push(setTimeout(() => {
      setIntroStage('headline');
      setHeadlineOpacity(1);
    }, 1000));

    // Stage 4: First line of subtext (1800ms)
    timers.push(setTimeout(() => {
      setIntroStage('subtext-1');
      setSubtext1Opacity(1);
    }, 1800));

    // Stage 5: Second line of subtext (2600ms)
    timers.push(setTimeout(() => {
      setIntroStage('subtext-2');
      setSubtext2Opacity(1);
    }, 2600));

    // Stage 6: CTA appears (3400ms - completes within 5 seconds)
    timers.push(setTimeout(() => {
      setIntroStage('cta');
      setCtaOpacity(1);
      setIntroStage('complete');
    }, 3400));

    return () => {
      timers.forEach(timer => clearTimeout(timer));
    };
  }, []);

  useEffect(() => {
    if (introStage === 'complete') {
      onScrollProgress?.(0);
    }
  }, [introStage, onScrollProgress]);
                    return (
    <section 
      ref={heroRef}
      className="relative h-screen w-screen flex items-center justify-center overflow-hidden"
      style={{ margin: 0, padding: 0, contain: 'layout paint' }}
    >
      {/* Animated Gradient Background - Full-bleed with ambient motion */}
      <div className="absolute inset-0 z-0 overflow-hidden">
        {/* Base gradient - fills entire viewport */}
        <div className="absolute inset-0 bg-gradient-to-r from-gray-950 via-black to-gray-950" />
        
        {/* Animated left side gradient - stronger cyan glow with motion */}
        <div className="absolute left-0 top-0 bottom-0 w-1/2 bg-gradient-to-r from-[#00d9ff]/12 via-[#00d9ff]/6 to-transparent" />
        
        {/* Animated right side gradient - stronger blue glow with motion */}
        <div className="absolute right-0 top-0 bottom-0 w-1/2 bg-gradient-to-l from-[#0099ff]/12 via-[#0099ff]/6 to-transparent" />
        
        {/* Center dominant glow - matches robot position */}
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              'radial-gradient(circle at 50% 50%, rgba(0, 217, 255, 0.08), transparent 60%)',
          }}
        />
                </div>

      {/* Spline 3D Scene - Full-scene centerpiece with scale-up + fade-in */}
      <div 
        className="absolute -inset-x-10 inset-y-0 z-10"
        style={{
          transform: `scale(${robotScale}) translateX(${robotTranslateX}px)`,
          opacity: robotOpacity,
          transition: introStage === 'initial' 
            ? 'opacity 0.8s ease-out, transform 0.8s cubic-bezier(0.34, 1.56, 0.64, 1)' 
            : 'transform 1.2s cubic-bezier(0.4, 0, 0.2, 1)',
          objectFit: 'cover',
        }}
      >
        <SplineScene 
          scene="https://prod.spline.design/kZDDjO5HuC9GJUM2/scene.splinecode"
          className="!border-0 !bg-transparent !rounded-none !min-h-0 w-full h-full"
          showControls={false}
        />
      </div>

      {/* Text Content - Left side, appears after robot moves */}
      <div 
        className="absolute left-4 lg:left-20 top-1/2 -translate-y-1/2 z-30 text-left space-y-6 lg:space-y-8 max-w-[90%] lg:max-w-2xl pointer-events-auto"
        style={{
          opacity: introStage !== 'initial' ? 1 : 0,
          transition: 'opacity 0.6s ease-out',
        }}
      >
          {/* Headline - High contrast with soft glow */}
          <div
            style={{
              opacity: headlineOpacity,
              transition: 'opacity 0.8s ease-out',
            }}
          >
            <h1 className="text-4xl sm:text-5xl lg:text-7xl font-bold leading-tight">
              <span className="text-white">Your</span>{' '}
              <span className="relative inline-block">
                <span 
                  className="relative z-10 bg-gradient-to-r from-[#00d9ff] via-[#00d9ff] to-[#0099ff] bg-clip-text text-transparent"
                >
                  AI
                </span>
              </span>
              {' '}<span className="text-white">Persona</span>
            </h1>
          </div>

          {/* Subtext - Line by line, high contrast */}
          <div className="space-y-3 lg:space-y-4">
            <p
              className="text-lg sm:text-xl lg:text-2xl font-medium leading-relaxed"
              style={{
                opacity: subtext1Opacity,
                transition: 'opacity 0.8s ease-out',
                color: '#ffffff',
                textShadow: '0 2px 20px rgba(0, 0, 0, 0.7)',
              }}
            >
              Train once. Create everywhere.
            </p>
            <p
              className="text-lg sm:text-xl lg:text-2xl leading-relaxed"
              style={{
                opacity: subtext2Opacity,
                transition: 'opacity 0.8s ease-out',
                color: '#ffffff',
                textShadow: '0 2px 20px rgba(0, 0, 0, 0.7)',
              }}
            >
              Upload 20 photos. Generate videos, ads, and images that look like you.
            </p>
              </div>

          {/* CTA Button - Appears last */}
          <div
            className="pt-2 lg:pt-4"
            style={{
              opacity: ctaOpacity,
              transform: ctaOpacity ? 'translateY(0)' : 'translateY(20px)',
              transition: 'opacity 0.8s ease-out, transform 0.8s ease-out',
              pointerEvents: 'auto',
              zIndex: 9999,
              position: 'relative',
            }}
          >
            <Link
              href="/persona"
              className="relative inline-flex items-center gap-3 px-8 py-4 lg:px-10 lg:py-5 bg-gradient-to-r from-[#00d9ff] to-[#0099ff] text-white font-semibold text-base lg:text-lg rounded-xl overflow-hidden cursor-pointer"
              style={{
                boxShadow: '0 0 12px rgba(0, 217, 255, 0.3)',
                pointerEvents: 'auto',
                zIndex: 10000,
                position: 'relative',
              }}
            >
              {/* Button Content with inner glow */}
              <span 
                className="relative z-10 flex items-center gap-3 pointer-events-none"
              >
                Start Training
                <ArrowRight className="w-5 h-5" />
              </span>
            </Link>
          </div>
      </div>

      {/* Scroll Indicator - Only show after intro completes */}
      {introStage === 'complete' && (
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-30">
          <div className="flex flex-col items-center gap-2 text-gray-400">
            <span className="text-sm">Scroll to explore</span>
            <div className="w-6 h-10 border-2 border-gray-400/30 rounded-full flex items-start justify-center p-2">
              <div 
                className="w-1.5 h-1.5 bg-[#00d9ff] rounded-full animate-bounce"
                style={{ animationDuration: '1.5s' }}
              />
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
