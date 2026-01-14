'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { 
  Atom, 
  User, 
  Video, 
  Sparkles, 
  Eraser, 
  Image as ImageIcon, 
  Box, 
  FileText, 
  Zap,
  type LucideIcon 
} from 'lucide-react';

interface FeatureBlockProps {
  title: string;
  description: string;
  videoDescription: string;
  linkHref?: string;
  hasSpecialControls?: boolean;
  index: number;
  isReversed?: boolean;
  icon?: LucideIcon;
  iconColor?: string;
  animationType?: string;
}

export default function FeatureBlock({ 
  title, 
  description, 
  videoDescription, 
  linkHref = '#',
  hasSpecialControls = false,
  index,
  isReversed = false,
  icon: IconComponent,
  iconColor = '#00d9ff',
  animationType = 'default'
}: FeatureBlockProps) {
  const [isVisible, setIsVisible] = useState(false);
  const blockRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
        }
      },
      { threshold: 0.1 }
    );

    if (blockRef.current) {
      observer.observe(blockRef.current);
    }

    return () => {
      if (blockRef.current) {
        observer.unobserve(blockRef.current);
      }
    };
  }, []);

  return (
    <div 
      ref={blockRef}
      className={`feature-block ${isReversed ? 'scroll-reveal-right' : 'scroll-reveal-left'} ${isVisible ? 'visible' : ''}`}
    >
      <div className="glass-strong rounded-3xl border border-white/10 overflow-hidden p-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          {/* Text and Button Section */}
          <div 
            className="flex flex-col justify-center"
            style={{ order: isReversed ? 2 : 1 }}
          >
            <div className="mb-8">
              <div className="flex items-center gap-4 mb-4">
                {IconComponent && (
                  <div 
                    className="feature-icon-container"
                    style={{ '--icon-color': iconColor } as React.CSSProperties & { '--icon-color': string }}
                  >
                    <IconComponent className="w-10 h-10" style={{ color: iconColor }} />
                  </div>
                )}
                <h3 className="text-3xl font-bold text-white">{title}</h3>
              </div>
              <p className="text-gray-300 text-xl leading-relaxed">{description}</p>
            </div>
            
            {/* Try Now Button */}
            <div className="flex flex-col gap-4">
              <Link href={linkHref}>
                <button className="try-now-button-modern interactive-element px-10 py-4 bg-gradient-to-r from-[#00d9ff] to-[#0099ff] text-white font-semibold text-lg rounded-xl transition-all duration-300 relative overflow-hidden group">
                  <span className="relative z-10">Try Now</span>
                  <div className="absolute inset-0 bg-gradient-to-r from-[#00d9ff] to-[#0099ff] opacity-0 group-hover:opacity-100 transition-opacity duration-300 blur-2xl" />
                </button>
              </Link>

              {/* Special Controls for AI Video Block */}
              {hasSpecialControls && (
                <div className="space-y-3 mt-2">
                  <input
                    type="text"
                    placeholder="Enter your prompt..."
                    className="w-full px-4 py-3 bg-black/40 border border-white/10 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-[#00d9ff]/50 transition-colors text-sm"
                  />
                  <button className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-lg text-white text-sm hover:bg-white/20 transition-colors">
                    Upload Photo
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Video Showcase Card */}
          <div 
            className="flex items-center justify-center"
            style={{ order: isReversed ? 1 : 2 }}
          >
            <div className="video-showcase-card w-full h-full min-h-[350px] glass rounded-2xl border border-white/20 overflow-hidden relative group">
              {/* Animated Video Placeholder */}
              <div className="absolute inset-0">
                <VideoPlaceholder animationType={animationType} description={videoDescription} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Video Placeholder Component with Animations
function VideoPlaceholder({ animationType, description }: { animationType: string; description: string }) {
  return (
    <div className="w-full h-full flex items-center justify-center relative overflow-hidden">
      {animationType === 'persona-grid' && <PersonaGridAnimation />}
      {animationType === 'face-flash' && <FaceFlashAnimation />}
      {animationType === 'photo-motion' && <PhotoMotionAnimation />}
      {animationType === 'ad-creation' && <AdCreationAnimation />}
      {animationType === 'background-remove' && <BackgroundRemoveAnimation />}
      {animationType === 'background-change' && <BackgroundChangeAnimation />}
      {animationType === '3d-rotate' && <Rotate3DAnimation />}
      {animationType === 'script-typing' && <ScriptTypingAnimation />}
      {animationType === 'viral-transition' && <ViralTransitionAnimation />}
      {animationType === 'assets-grid' && <AssetsGridAnimation />}
      {animationType === 'default' && <DefaultVideoPlaceholder description={description} />}
    </div>
  );
}

function DefaultVideoPlaceholder({ description }: { description: string }) {
  return (
    <div className="text-center p-8 max-w-md">
      <div className="w-24 h-24 mx-auto mb-6 rounded-full bg-gradient-to-br from-[#00d9ff]/20 to-[#0099ff]/20 backdrop-blur-md flex items-center justify-center border border-white/10 group-hover:scale-110 transition-transform duration-300">
        <svg className="w-12 h-12 text-[#00d9ff]" fill="currentColor" viewBox="0 0 24 24">
          <path d="M8 5v14l11-7z" />
        </svg>
      </div>
      <p className="text-gray-300 text-sm leading-relaxed mb-3">{description}</p>
      <p className="text-gray-500 text-xs">Micro-video: 3-4 seconds</p>
    </div>
  );
}

function PersonaGridAnimation() {
  return (
    <div className="w-full h-full p-8 flex flex-col items-center justify-center">
      <div className="grid grid-cols-4 gap-2 mb-6 w-64">
        {Array.from({ length: 20 }).map((_, i) => (
          <div
            key={i}
            className="aspect-square bg-gradient-to-br from-[#00d9ff]/30 to-[#0099ff]/30 rounded border border-white/20 animate-fall-in"
            style={{ animationDelay: `${i * 0.05}s` }}
          />
        ))}
      </div>
      <div className="w-64 h-2 bg-black/40 rounded-full overflow-hidden border border-white/10">
        <div className="h-full bg-gradient-to-r from-[#00d9ff] to-[#0099ff] rounded-full animate-progress-bar" />
      </div>
    </div>
  );
}

function FaceFlashAnimation() {
  return (
    <div className="w-full h-full flex items-center justify-center">
      <div className="relative w-48 h-48">
        <div className="absolute inset-0 rounded-full bg-gradient-to-br from-purple-500/20 to-pink-500/20 animate-pulse" />
        <div className="absolute inset-4 rounded-full bg-gradient-to-br from-[#00d9ff]/20 to-[#0099ff]/20 animate-flash" />
        <div className="absolute inset-0 flex items-center justify-center">
          <User className="w-24 h-24 text-white/40" />
        </div>
      </div>
    </div>
  );
}

function PhotoMotionAnimation() {
  return (
    <div className="w-full h-full flex items-center justify-center">
      <div className="relative w-64 h-48">
        <div className="absolute inset-0 bg-gradient-to-br from-gray-700/40 to-gray-900/40 rounded-xl border border-white/20" />
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-32 h-32 bg-gradient-to-br from-[#00d9ff]/20 to-purple-500/20 rounded-lg animate-wave-motion" />
        </div>
      </div>
    </div>
  );
}

function AdCreationAnimation() {
  return (
    <div className="w-full h-full flex flex-col items-center justify-center gap-4">
      <div className="text-2xl font-bold text-white/60 animate-fade-in-out">No camera</div>
      <div className="text-2xl font-bold text-white/60 animate-fade-in-out" style={{ animationDelay: '1s' }}>No actors</div>
      <div className="text-xl text-[#00d9ff] mt-4 animate-fade-in" style={{ animationDelay: '2s' }}>AI Generated</div>
    </div>
  );
}

function BackgroundRemoveAnimation() {
  return (
    <div className="w-full h-full flex items-center justify-center">
      <div className="relative w-64 h-48">
        <div className="absolute inset-0 bg-gradient-to-br from-orange-500/20 to-red-500/20 rounded-xl border border-white/20 animate-fade-out" />
        <div className="absolute inset-0 bg-gradient-to-br from-gray-900/60 to-black/60 rounded-xl border border-white/20 animate-fade-in" style={{ animationDelay: '1s' }} />
      </div>
    </div>
  );
}

function BackgroundChangeAnimation() {
  return (
    <div className="w-full h-full flex items-center justify-center">
      <div className="relative w-64 h-48">
        <div className="absolute inset-0 bg-gradient-to-br from-blue-500/30 to-cyan-500/30 rounded-xl animate-bg-change-1" />
        <div className="absolute inset-0 bg-gradient-to-br from-purple-500/30 to-pink-500/30 rounded-xl animate-bg-change-2" />
        <div className="absolute inset-0 bg-gradient-to-br from-orange-500/30 to-red-500/30 rounded-xl animate-bg-change-3" />
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-20 h-20 rounded-full bg-white/20 backdrop-blur-sm border border-white/30" />
        </div>
      </div>
    </div>
  );
}

function Rotate3DAnimation() {
  return (
    <div className="w-full h-full flex items-center justify-center">
      <div className="relative w-48 h-48">
        <div className="absolute inset-0 border-2 border-[#00d9ff]/40 rounded-lg animate-rotate-3d" style={{ transformStyle: 'preserve-3d' }}>
          <div className="absolute inset-2 border border-[#00d9ff]/60 rounded" />
        </div>
        <div className="absolute inset-0 flex items-center justify-center">
          <Box className="w-16 h-16 text-[#00d9ff]/60" />
        </div>
      </div>
    </div>
  );
}

function ScriptTypingAnimation() {
  return (
    <div className="w-full h-full flex flex-col items-center justify-center gap-4 p-8">
      <div className="text-left w-full max-w-xs">
        <div className="text-white/80 text-sm font-mono animate-typing overflow-hidden whitespace-nowrap border-r-2 border-[#00d9ff]">
          Creating script...
        </div>
      </div>
      <div className="w-full h-32 bg-gradient-to-br from-[#00d9ff]/10 to-purple-500/10 rounded-lg border border-white/20 animate-fade-in" style={{ animationDelay: '1s' }} />
    </div>
  );
}

function ViralTransitionAnimation() {
  return (
    <div className="w-full h-full flex items-center justify-center">
      <div className="relative w-64 h-48">
        <div className="absolute inset-0 bg-gradient-to-br from-purple-500/30 to-pink-500/30 rounded-xl animate-slide-in-out-1" />
        <div className="absolute inset-0 bg-gradient-to-br from-blue-500/30 to-cyan-500/30 rounded-xl animate-slide-in-out-2" />
        <div className="absolute inset-0 bg-gradient-to-br from-orange-500/30 to-yellow-500/30 rounded-xl animate-slide-in-out-3" />
      </div>
    </div>
  );
}

function AssetsGridAnimation() {
  return (
    <div className="w-full h-full p-8 flex items-center justify-center">
      <div className="grid grid-cols-3 gap-3 w-full max-w-xs">
        {Array.from({ length: 9 }).map((_, i) => (
          <div
            key={i}
            className="aspect-square bg-gradient-to-br from-indigo-500/30 to-purple-500/30 rounded-lg border border-white/20 animate-fade-in"
            style={{ animationDelay: `${i * 0.1}s` }}
          />
        ))}
      </div>
    </div>
  );
}
