'use client';

import { useState } from 'react';
import { SiOpenai, SiFlux, SiElevenlabs } from 'react-icons/si';
import { Sparkles, Film, PlayCircle, Zap, Atom, User, Video, Wand2, FileText, Folder, ArrowRight } from 'lucide-react';
import Sidebar from '@/components/Sidebar';
import PricingModal from '@/components/PricingModal';
import HeroSection from '@/components/HeroSection';
import Link from 'next/link';

export default function Home() {
  const [isPricingModalOpen, setIsPricingModalOpen] = useState(false);

  const mainRoutes = [
    {
      title: "Video Studio",
      description: "Cinematic video and 3D motion generation",
      linkHref: "/video",
      icon: Video,
      iconColor: '#ff3f3f',
      gradient: 'from-red-500 to-pink-500',
    },
    {
      title: "Image Studio",
      description: "Background removal, studio shots, and face identity",
      linkHref: "/studio",
      icon: Wand2,
      iconColor: '#00d9ff',
      gradient: 'from-cyan-500 to-blue-500',
    },
    {
      title: "Ad Script",
      description: "AI ad script generation with voiceover",
      linkHref: "/ad-script",
      icon: FileText,
      iconColor: '#f59e0b',
      gradient: 'from-amber-500 to-orange-500',
    },
  ];

  const otherFeatures = [
    {
      title: "AI Persona Lab",
      description: "Train your AI once. Use it everywhere.",
      linkHref: "/persona",
      icon: Atom,
      iconColor: '#00d9ff',
    },
    {
      title: "3D Character Lab",
      description: "Turn yourself into 3D",
      linkHref: "/3d",
      icon: Sparkles,
      iconColor: '#06b6d4',
    },
    {
      title: "Ad Creation",
      description: "Create ads in seconds",
      linkHref: "/ad-creation",
      icon: Sparkles,
      iconColor: '#fbbf24',
    },
    {
      title: "Viral / Entertainment",
      description: "Your imagination. Powered by AI.",
      linkHref: "/viral-entertainment",
      icon: Zap,
      iconColor: '#ec4899',
    },
    {
      title: "My Assets",
      description: "Access all your created content in one place.",
      linkHref: "/my-assets",
      icon: Folder,
      iconColor: '#6366f1',
    },
  ];

  return (
    <div className="relative min-h-screen bg-black overflow-x-hidden">
      {/* Animated Background - Subtle Neon Smoke & Gradient Glows */}
      <div className="fixed inset-0 z-0 overflow-hidden">
        <div className="absolute inset-0 bg-black" />
        {/* Neon smoke effects */}
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-[#00d9ff]/5 rounded-full blur-3xl animate-pulse" style={{ animationDuration: '8s' }} />
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-[#0099ff]/5 rounded-full blur-3xl animate-pulse" style={{ animationDuration: '10s', animationDelay: '2s' }} />
        <div className="absolute top-1/2 left-1/2 w-96 h-96 bg-purple-500/5 rounded-full blur-3xl animate-pulse" style={{ animationDuration: '12s', animationDelay: '4s' }} />
      </div>

      <Sidebar onSubscriptionClick={() => setIsPricingModalOpen(true)} />
      
      <main className="relative z-10 ml-64">
        {/* Hero Section - Full Screen */}
        <HeroSection />

        {/* Main Routes - Large Cards */}
        <div className="container mx-auto px-8 py-16">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-16">
            {mainRoutes.map((route) => {
              const Icon = route.icon;
              return (
                <Link
                  key={route.linkHref}
                  href={route.linkHref}
                  className="group relative glass rounded-2xl p-8 border border-white/10 hover:border-[#00d9ff]/50 transition-all hover:scale-105 overflow-hidden"
                >
                  <div className="absolute inset-0 bg-gradient-to-br opacity-0 group-hover:opacity-10 transition-opacity"
                    style={{
                      background: `linear-gradient(135deg, ${route.iconColor}20, ${route.iconColor}40)`
                    }}
                  />
                  <div className="relative z-10">
                    <div
                      className="flex items-center justify-center w-16 h-16 rounded-lg bg-black/30 border border-white/10 mb-6"
                      style={{ filter: `drop-shadow(0 0 8px ${route.iconColor})` }}
                    >
                      <Icon className="w-8 h-8" style={{ color: route.iconColor }} />
                    </div>
                    <h3 className="text-2xl font-bold text-white mb-2">{route.title}</h3>
                    <p className="text-gray-400 mb-4">{route.description}</p>
                    <div className="flex items-center gap-2 text-[#00d9ff] group-hover:gap-4 transition-all">
                      <span className="font-medium">Get Started</span>
                      <ArrowRight className="w-5 h-5" />
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>

          {/* Other Features */}
          <div className="mb-8">
            <h2 className="text-2xl font-bold text-white mb-6">More Tools</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {otherFeatures.map((feature) => {
                const Icon = feature.icon;
                return (
                  <Link
                    key={feature.linkHref}
                    href={feature.linkHref}
                    className="glass rounded-xl p-6 border border-white/10 hover:border-[#00d9ff]/50 transition-all hover:bg-[#00d9ff]/5 group"
                  >
                    <div className="flex items-center gap-4">
                      <div
                        className="flex items-center justify-center w-12 h-12 rounded-lg bg-black/30 border border-white/10 flex-shrink-0"
                        style={{ filter: `drop-shadow(0 0 6px ${feature.iconColor})` }}
                      >
                        <Icon className="w-6 h-6" style={{ color: feature.iconColor }} />
                      </div>
                      <div className="flex-1">
                        <h4 className="text-lg font-semibold text-white mb-1">{feature.title}</h4>
                        <p className="text-sm text-gray-400">{feature.description}</p>
                      </div>
                      <ArrowRight className="w-5 h-5 text-gray-400 group-hover:text-[#00d9ff] transition-colors" />
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        </div>

        {/* Professional AI Engine Footer Grid */}
        <div className="container mx-auto px-8 py-16">
          {/* Dynamic Section Header */}
          <div className="flex items-center justify-center gap-3 mb-6">
            <h2 className="text-sm font-medium bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">
              Powered by Industry-Leading AI Models
            </h2>
            <div className="relative">
              <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" style={{ boxShadow: '0 0 8px rgba(74, 222, 128, 0.8)' }} />
              <div className="absolute inset-0 w-2 h-2 rounded-full bg-green-400 animate-ping opacity-75" />
            </div>
          </div>
          
          <div className="grid grid-cols-7 gap-4 w-full">
              {[
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
              ].map((engine) => {
                // Memoize color conversion for performance
                const hexToRgba = (hex: string, alpha: number) => {
                  const r = parseInt(hex.slice(1, 3), 16);
                  const g = parseInt(hex.slice(3, 5), 16);
                  const b = parseInt(hex.slice(5, 7), 16);
                  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
                };

                const brandGlow = hexToRgba(engine.brandColor, 0.8);
                const brandGlowSoft = hexToRgba(engine.brandColor, 0.4);

                return (
                  <div 
                    key={engine.name} 
                    className="engine-logo-card flex flex-col items-center justify-center p-4 bg-white/5 rounded-xl border-2 border-black/20 hover:scale-105 transition-all duration-300 ease-in-out cursor-pointer group overflow-hidden relative"
                    style={{
                      '--brand-color': engine.brandColor,
                      '--brand-glow': brandGlow,
                      '--brand-glow-soft': brandGlowSoft,
                    } as React.CSSProperties & { '--brand-color': string; '--brand-glow': string; '--brand-glow-soft': string }}
                  >
                    {/* LED Border Animation */}
                    <div className="led-border absolute inset-0 rounded-xl pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                    
                    {/* Info Tag - Shows on Hover */}
                    {engine.techInfo && (
                      <div className="info-tag absolute top-2 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity duration-300 z-10">
                        <div className="bg-black/80 backdrop-blur-md px-2 py-1 rounded-lg border border-white/20 text-[9px] text-white whitespace-nowrap">
                          {engine.techInfo}
                        </div>
                      </div>
                    )}
                    
                    <div
                      className="engine-icon mb-2 flex items-center justify-center transition-all duration-300 ease-in-out"
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
