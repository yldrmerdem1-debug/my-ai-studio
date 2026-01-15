'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { SplineScene } from '@/components/ui/splite';

interface HeroSectionProps {
  onScrollProgress?: (progress: number) => void;
}

export default function HeroSection({ onScrollProgress }: HeroSectionProps) {
  const router = useRouter();
  const heroRef = useRef<HTMLElement>(null);
  const [scrollProgress, setScrollProgress] = useState(0);
  
  // Intro sequence states
  const [introStage, setIntroStage] = useState<'initial' | 'robot-move' | 'headline' | 'subtext-1' | 'subtext-2' | 'cta' | 'complete'>('initial');
  const [robotScale, setRobotScale] = useState(0.8); // Start smaller for scale-up animation
  const [robotOpacity, setRobotOpacity] = useState(0); // Start invisible for fade-in
  const [robotTranslateX, setRobotTranslateX] = useState(0);
  const [textOpacity, setTextOpacity] = useState(0);
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

  // Scroll-based animations (only after intro completes)
  useEffect(() => {
    if (introStage !== 'complete') return;

    const handleScroll = () => {
      if (!heroRef.current) return;
      
      const rect = heroRef.current.getBoundingClientRect();
      const windowHeight = window.innerHeight;
      const heroHeight = heroRef.current.offsetHeight;
      
      const progress = Math.max(0, Math.min(1, (windowHeight - rect.top) / heroHeight));
      setScrollProgress(progress);
      onScrollProgress?.(progress);

      // Apply scroll-based transforms
      const scrollScale = Math.max(0.7, 1 - progress * 0.3);
      const scrollTranslateX = progress * 100;
      setRobotScale(Math.max(0.7, 0.85 - progress * 0.15));
      setRobotTranslateX(80 + scrollTranslateX * 0.5);
      // Keep text high contrast - no fade to gray
      setTextOpacity(Math.max(0.8, 1 - progress * 0.2));
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();

    return () => window.removeEventListener('scroll', handleScroll);
  }, [introStage, onScrollProgress]);

                    return (
    <section 
      ref={heroRef}
      className="relative h-screen w-screen flex items-center justify-center overflow-hidden"
      style={{ margin: 0, padding: 0 }}
    >
      {/* Animated Gradient Background - Full-bleed with ambient motion */}
      <div className="absolute inset-0 z-0 overflow-hidden">
        {/* Base gradient - fills entire viewport */}
        <div className="absolute inset-0 bg-gradient-to-r from-gray-950 via-black to-gray-950" />
        
        {/* Animated left side gradient - stronger cyan glow with motion */}
        <div 
          className="absolute left-0 top-0 bottom-0 w-1/2 bg-gradient-to-r from-[#00d9ff]/25 via-[#00d9ff]/12 to-transparent"
          style={{
            animation: 'gradient-pulse 6s ease-in-out infinite',
            willChange: 'transform',
          }}
        />
        
        {/* Animated right side gradient - stronger blue glow with motion */}
        <div 
          className="absolute right-0 top-0 bottom-0 w-1/2 bg-gradient-to-l from-[#0099ff]/25 via-[#0099ff]/12 to-transparent"
          style={{
            animation: 'gradient-pulse 8s ease-in-out infinite',
            animationDelay: '2s',
            willChange: 'transform',
          }}
        />
        
        {/* Center dominant glow - matches robot position */}
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              'radial-gradient(circle at 50% 50%, rgba(0, 217, 255, 0.16), transparent 55%), radial-gradient(circle at 75% 70%, rgba(0, 153, 255, 0.12), transparent 60%)',
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
          willChange: 'transform',
        }}
      >
        <SplineScene 
          scene="https://prod.spline.design/kZDDjO5HuC9GJUM2/scene.splinecode"
          className="!border-0 !bg-transparent !rounded-none !min-h-0 w-full h-full"
          showControls={false}
        />
        {/* Robot glow overlay */}
        <div 
          className="absolute inset-0 pointer-events-none"
          style={{
            background: 'radial-gradient(circle at center, transparent 30%, rgba(0, 217, 255, 0.1) 70%, transparent 100%)',
            mixBlendMode: 'screen',
            animation: 'glow-drift 5s ease-in-out infinite',
            willChange: 'transform',
          }}
        />
      </div>

      {/* Text Content - Left side, appears after robot moves */}
      <div 
        className="absolute left-4 lg:left-20 top-1/2 -translate-y-1/2 z-30 text-left space-y-6 lg:space-y-8 max-w-[90%] lg:max-w-2xl pointer-events-auto"
        style={{
          opacity: textOpacity || (introStage !== 'initial' ? 1 : 0),
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
              <span className="text-white drop-shadow-[0_0_30px_rgba(255,255,255,0.5)]">Your</span>{' '}
              <span className="relative inline-block">
                <span 
                  className="relative z-10 bg-gradient-to-r from-[#00d9ff] via-[#00d9ff] to-[#0099ff] bg-clip-text text-transparent"
                  style={{
                    textShadow: '0 0 40px rgba(0, 217, 255, 0.8), 0 0 80px rgba(0, 217, 255, 0.4)',
                    filter: 'drop-shadow(0 0 20px rgba(0, 217, 255, 0.9))',
                  }}
                >
                  AI
                </span>
                <span 
                  className="absolute inset-0 bg-[#00d9ff] blur-3xl opacity-80 -z-10"
                  style={{
                    filter: 'blur(30px)',
                    animation: 'glow-pulse 3s ease-in-out infinite',
                  }}
                />
              </span>
              {' '}<span className="text-white drop-shadow-[0_0_30px_rgba(255,255,255,0.5)]">Persona</span>
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
                textShadow: '0 2px 40px rgba(0, 0, 0, 0.95), 0 0 20px rgba(255, 255, 255, 0.1), 0 0 40px rgba(0, 217, 255, 0.2)',
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
                textShadow: '0 2px 40px rgba(0, 0, 0, 0.95), 0 0 20px rgba(255, 255, 255, 0.15)',
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
            onClick={(e) => {
              e.stopPropagation();
            }}
          >
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (e.nativeEvent) {
                  e.nativeEvent.stopImmediatePropagation();
                }
                router.push('/persona');
              }}
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              className="group relative inline-flex items-center gap-3 px-8 py-4 lg:px-10 lg:py-5 bg-gradient-to-r from-[#00d9ff] to-[#0099ff] text-white font-semibold text-base lg:text-lg rounded-xl overflow-hidden transition-all duration-300 hover:scale-105 cursor-pointer"
              style={{
                boxShadow: '0 0 50px rgba(0, 217, 255, 0.7), 0 0 100px rgba(0, 153, 255, 0.4), inset 0 0 30px rgba(255, 255, 255, 0.1)',
                animation: ctaOpacity ? 'cta-glow 2.5s ease-in-out infinite' : 'none',
                filter: 'brightness(1.1)',
                pointerEvents: 'auto',
                zIndex: 10000,
                position: 'relative',
              }}
            >
              {/* Button Background Glow */}
              <div 
                className="absolute inset-0 bg-gradient-to-r from-[#00d9ff] to-[#0099ff] opacity-50 blur-2xl -z-10 pointer-events-none"
                    style={{
                  animation: 'glow-pulse 2s ease-in-out infinite',
                }}
              />
              
              {/* Button Hover Glow Effect */}
              <div className="absolute inset-0 bg-gradient-to-r from-[#00d9ff] to-[#0099ff] opacity-0 group-hover:opacity-100 blur-xl transition-opacity pointer-events-none" />
              
              {/* Button Content with inner glow */}
              <span 
                className="relative z-10 flex items-center gap-3 pointer-events-none"
                style={{
                  textShadow: '0 0 20px rgba(255, 255, 255, 0.5)',
                }}
              >
                Start Training
                <ArrowRight className="w-5 h-5 transition-transform group-hover:translate-x-1" />
              </span>
            </button>
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
