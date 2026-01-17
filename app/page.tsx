'use client';
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ComponentType } from 'react';
import { SiOpenai, SiFlux, SiElevenlabs } from 'react-icons/si';
import { Sparkles, Film, PlayCircle, Zap, Video, FileText, Upload, BrainCircuit, Image } from 'lucide-react';
import Sidebar from '@/components/Sidebar';
import PricingModal from '@/components/PricingModal';
import HeroSection from '@/components/HeroSection';
import { AdScriptPreview } from '@/components/PreviewVideos';

const FLOW_STEPS = [
  {
    title: "Upload 20 Photos",
    label: "Upload once",
    icon: Upload,
  },
  {
    title: "AI Training",
    label: "Your AI learns your face & style",
    icon: BrainCircuit,
  },
  {
    title: "Use Everywhere",
    label: "Works across all tools",
    icons: [Video, Image, FileText],
  },
];

type VideoFeature = {
  kind: 'video';
  title: string;
  description: string;
  poster: string;
  src: string;
};

type BeforeAfterFeature = {
  kind: 'before-after';
  title: string;
  description: string;
  beforeImage: string;
  afterImage: string;
};

type CustomFeature = {
  kind: 'custom';
  title: string;
  description: string;
  preview: ComponentType;
};

const FEATURE_PREVIEWS: Array<VideoFeature | BeforeAfterFeature | CustomFeature> = [
  {
    kind: "video",
    title: "Video Studio",
    description: "Cinematic AI-generated video loop",
    poster: "/images/video-studio-poster.jpg",
    src: "/videos/video-studio-preview.mp4",
  },
  {
    kind: "before-after",
    title: "Image Studio",
    description: "Before/after studio-grade transformation",
    beforeImage: "/images/image-studio-before.jpg",
    afterImage: "/images/image-studio-after.jpg",
  },
  {
    kind: "video",
    title: "Viral / Entertainment",
    description: "Final viral-style clip",
    poster: "/images/viral-preview-poster.jpg",
    src: "/videos/viral-preview.mp4",
  },
  {
    kind: "custom",
    title: "Ad Script",
    description: "Visual paired with a subtle voice waveform",
    preview: AdScriptPreview,
  },
];

const hexToRgba = (hex: string, alpha: number) => {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

type HoverPlayVideoProps = {
  src: string;
  poster: string;
};

const HoverPlayVideo = ({ src, poster }: HoverPlayVideoProps) => {
  return (
    <div className="relative h-full w-full overflow-hidden">
      <img
        src={poster}
        alt="Preview poster"
        className="absolute inset-0 h-full w-full object-cover opacity-100 group-hover:opacity-0"
        loading="eager"
        decoding="async"
      />
      <video
        src={src}
        muted
        loop
        playsInline
        preload="auto"
        autoPlay
        className="absolute inset-0 h-full w-full object-cover opacity-0 group-hover:opacity-100"
      />
    </div>
  );
};

type Feature = VideoFeature | BeforeAfterFeature | CustomFeature;

type FeatureCardProps = {
  feature: Feature;
};

const FeatureCard = ({ feature }: FeatureCardProps) => {
  return (
    <div
      className="group perf-card rounded-2xl border border-white/10 bg-white/5 overflow-hidden"
    >
      <div className="relative aspect-video">
        {feature.kind === "before-after" ? (
          <div className="grid h-full grid-cols-2">
            <div className="relative">
              <img
                src={feature.beforeImage}
                alt="Before - raw photo"
                className="h-full w-full object-cover"
              />
              <div className="absolute left-3 top-3 rounded-full bg-black/50 px-3 py-1 text-xs font-semibold text-white">
                BEFORE
              </div>
            </div>
            <div className="relative">
              <img
                src={feature.afterImage}
                alt="After - studio image"
                className="h-full w-full object-cover"
              />
              <div className="absolute left-3 top-3 rounded-full bg-black/50 px-3 py-1 text-xs font-semibold text-white">
                AFTER
              </div>
            </div>
          </div>
        ) : feature.kind === "custom" ? (
          <feature.preview />
        ) : (
          <HoverPlayVideo
            src={feature.src}
            poster={feature.poster}
          />
        )}
      </div>
      <div className="p-6 space-y-2">
        <h3 className="text-xl font-semibold text-white">{feature.title}</h3>
        <p className="text-white">{feature.description}</p>
      </div>
    </div>
  );
};

const AI_ENGINES = [
  { 
    name: 'Sora', 
    icon: <SiOpenai className="w-8 h-8" />,
    tag: 'High-End Video',
    brandColor: '#FF3F3F',
    techInfo: 'Diffusion Transformer'
  },
  { 
    name: 'Gemini', 
    icon: <Sparkles className="w-8 h-8" strokeWidth={2.5} />,
    tag: 'Multimodal AI',
    brandColor: '#4285F4',
    techInfo: 'Multimodal LLM'
  },
  { 
    name: 'Veo', 
    icon: <PlayCircle className="w-8 h-8" strokeWidth={2.5} />,
    tag: 'Cinematic Video',
    brandColor: '#FF8C00',
    techInfo: 'Video Generation AI'
  },
  { 
    name: 'Flux', 
    icon: <SiFlux className="w-8 h-8" />,
    tag: 'Image Specialist',
    brandColor: '#7C3AED',
    techInfo: 'Diffusion Model'
  },
  { 
    name: 'Kling AI', 
    icon: <Film className="w-8 h-8" strokeWidth={2.5} />,
    tag: 'Real-to-Video',
    brandColor: '#A855F7',
    techInfo: 'Video Synthesis AI'
  },
  { 
    name: 'Luma', 
    icon: <Zap className="w-8 h-8" strokeWidth={2.5} />,
    tag: 'Dream Machine',
    brandColor: '#00D9FF',
    techInfo: 'Cinematic Video AI'
  },
  { 
    name: 'ElevenLabs', 
    icon: <SiElevenlabs className="w-8 h-8" />,
    tag: 'Professional Voice',
    brandColor: '#FF6B35',
    techInfo: 'Voice Synthesis AI'
  }
].map((engine) => ({
  ...engine,
  brandGlow: hexToRgba(engine.brandColor, 0.8),
  brandGlowSoft: hexToRgba(engine.brandColor, 0.4),
}));

export default function Home() {
  const [isPricingModalOpen, setIsPricingModalOpen] = useState(false);
  const [showSidebar, setShowSidebar] = useState(false);
  const heroEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Show sidebar after hero section is scrolled past
    const handleScroll = () => {
      if (heroEndRef.current) {
        const rect = heroEndRef.current.getBoundingClientRect();
        // Show sidebar when hero section is mostly out of view
        setShowSidebar(rect.top < -100);
      }
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll(); // Initial check

    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <div className="relative min-h-screen bg-black overflow-x-hidden">
      {/* Animated Background - Subtle Neon Smoke & Gradient Glows */}
      <div className="fixed inset-0 z-0 overflow-hidden perf-fixed-bg">
        <div className="absolute inset-0 bg-black" />
        {/* Lightweight gradient fog */}
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              'radial-gradient(circle at 20% 20%, rgba(0, 217, 255, 0.08), transparent 45%), radial-gradient(circle at 80% 70%, rgba(0, 153, 255, 0.08), transparent 50%), radial-gradient(circle at 50% 50%, rgba(139, 92, 246, 0.06), transparent 55%)',
          }}
        />
      </div>

      {/* Sidebar - Hidden initially, appears after hero */}
      <div 
        className={`fixed left-0 top-0 z-20 transition-all duration-500 ease-out ${
          showSidebar ? 'translate-x-0 opacity-100' : '-translate-x-full opacity-0'
        }`}
      >
        <Sidebar onSubscriptionClick={() => setIsPricingModalOpen(true)} />
      </div>
      
      <main className={`relative z-10 transition-all duration-500 ease-out ${
        showSidebar ? 'lg:ml-64' : 'ml-0'
      }`}>
        {/* Hero Section - Full Screen */}
        <HeroSection />
        
        {/* Hero End Marker - Used to detect when to show sidebar */}
        <div ref={heroEndRef} className="h-0" />

        {/* Section 2 - What Happens Next */}
        {/* perf-section keeps offscreen content from painting during scroll */}
        <section className="relative py-24 px-8 perf-section">
          <div className="container mx-auto max-w-6xl">
            <div className="text-center mb-12">
              <h2 className="text-3xl lg:text-4xl font-bold text-white mb-4">
                What Happens Next
              </h2>
              <p className="text-lg text-white max-w-2xl mx-auto">
                A simple flow that turns you into a reusable AI persona.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {FLOW_STEPS.map((step) => (
                <div
                  key={step.title}
                  className="rounded-2xl border border-white/10 bg-white/5 p-8 text-center space-y-4"
                >
                  <div className="flex items-center justify-center">
                    {step.icon ? (
                      <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-white/10 border border-white/10">
                        <step.icon className="w-6 h-6 text-white" />
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        {step.icons?.map((Icon, iconIndex) => (
                          <div
                            key={`${step.title}-${iconIndex}`}
                            className="flex items-center justify-center w-10 h-10 rounded-lg bg-white/10 border border-white/10"
                          >
                            <Icon className="w-5 h-5 text-white" />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <h3 className="text-xl font-semibold text-white">{step.title}</h3>
                  <p className="text-white">{step.label}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Section 3 - Feature Previews */}
        {/* perf-section keeps offscreen content from painting during scroll */}
        <section className="relative py-24 px-8 perf-section">
          <div className="container mx-auto max-w-6xl">
            <div className="text-center mb-14">
              <h2 className="text-3xl lg:text-4xl font-bold text-white mb-4">
                Output-First Results
              </h2>
              <p className="text-lg text-white">
                Final results only — no UI walkthroughs, no screen recordings.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {FEATURE_PREVIEWS.map((feature) => (
                <FeatureCard
                  key={feature.title}
                  feature={feature}
                />
              ))}
            </div>
          </div>
        </section>

        {/* Section 4 - Differentiation */}
        {/* perf-section keeps offscreen content from painting during scroll */}
        <section className="relative py-20 px-8 perf-section">
          <div className="container mx-auto max-w-5xl">
            <div className="text-center mb-10">
              <h2 className="text-3xl lg:text-4xl font-bold text-white mb-4">
                Why It&apos;s Different
              </h2>
              <p className="text-lg text-white">
                Focus on creative output, not complexity.
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-white">
              {[
                'No prompts. Just results.',
                'One AI persona, trained once, used everywhere.',
                'Consistent face, style, and identity',
                'Built for creators, not engineers',
              ].map((item) => (
                <div
                  key={item}
                  className="rounded-2xl border border-white/10 bg-white/5 p-6 text-lg"
                >
                  {item}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Section 5 - AI Model Logos */}
        {/* perf-section keeps offscreen content from painting during scroll */}
        <div className="container mx-auto px-8 py-16 perf-section">
          <p className="text-center text-sm text-white mb-3">
            Your AI persona works seamlessly across industry-leading AI models.
          </p>
          {/* Dynamic Section Header */}
          <div className="flex items-center justify-center gap-3 mb-6">
            <h2 className="text-sm font-medium bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">
              Powered by Industry-Leading AI Models
            </h2>
            <div className="relative">
              <div className="w-2 h-2 rounded-full bg-green-400" style={{ boxShadow: '0 0 6px rgba(74, 222, 128, 0.6)' }} />
            </div>
          </div>
          
          <div className="grid grid-cols-7 gap-4 w-full">
              {AI_ENGINES.map((engine) => {
                // Precomputed glow colors prevent per-render work during scroll
                return (
                  <div 
                    key={engine.name} 
                    className="engine-logo-card perf-card flex flex-col items-center justify-center p-4 bg-white/5 rounded-xl border-2 border-black/20 hover:scale-105 transition-transform transition-shadow transition-colors duration-300 ease-in-out cursor-pointer group overflow-hidden relative"
                    style={{
                      '--brand-color': engine.brandColor,
                      '--brand-glow': engine.brandGlow,
                      '--brand-glow-soft': engine.brandGlowSoft,
                    } as CSSProperties & { '--brand-color': string; '--brand-glow': string; '--brand-glow-soft': string }}
                  >
                    {/* LED Border Animation */}
                    <div className="led-border absolute inset-0 rounded-xl pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                    
                    {/* Info Tag - Shows on Hover */}
                    {engine.techInfo && (
                    <div className="info-tag absolute top-2 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity duration-300 z-10">
                      <div className="bg-black/80 px-2 py-1 rounded-lg border border-white/20 text-[9px] text-white whitespace-nowrap">
                          {engine.techInfo}
                        </div>
                      </div>
                    )}
                    
                    <div
                      className="engine-icon mb-2 flex items-center justify-center transition-transform transition-opacity duration-300 ease-in-out"
                      style={{
                        opacity: 0.7,
                      }}
                    >
                      <div style={{ color: 'white' }}>
                        {engine.icon}
                      </div>
                    </div>
                    <h4 className="text-xs font-bold text-white mb-1">{engine.name}</h4>
                    <p className="text-[10px] text-gray-400 text-center">{engine.tag}</p>
                  </div>
                );
              })}

          </div>
        </div>

      </main>

      {/* Pricing Modal */}
      <PricingModal
        isOpen={isPricingModalOpen}
        onClose={() => setIsPricingModalOpen(false)}
      />
    </div>
  );
}
