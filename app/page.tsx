'use client';
import { useState, useEffect, useRef } from 'react';
import { SiOpenai, SiFlux, SiElevenlabs } from 'react-icons/si';
import { Sparkles, Film, PlayCircle, Zap, Atom, User, Video, Wand2, FileText, Folder, ArrowRight, Upload } from 'lucide-react';
import Sidebar from '@/components/Sidebar';
import PricingModal from '@/components/PricingModal';
import HeroSection from '@/components/HeroSection';
import Link from 'next/link';

export default function Home() {
  const [isPricingModalOpen, setIsPricingModalOpen] = useState(false);
  const [showSidebar, setShowSidebar] = useState(false);
  const [heroScrollProgress, setHeroScrollProgress] = useState(0);
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
        <HeroSection onScrollProgress={setHeroScrollProgress} />
        
        {/* Hero End Marker - Used to detect when to show sidebar */}
        <div ref={heroEndRef} className="h-0" />

        {/* Main Product Section - Upload 20 Photos */}
        <section className="relative min-h-screen flex items-center justify-center py-32 px-8">
          <div className="container mx-auto max-w-6xl">
            <div 
              className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center"
              style={{
                opacity: Math.max(0, Math.min(1, (heroScrollProgress - 0.3) * 2)),
                transform: `translateY(${Math.max(0, (1 - heroScrollProgress) * 50)}px)`,
                transition: 'opacity 0.3s ease-out, transform 0.3s ease-out',
              }}
            >
              {/* Left: Visual/Icon */}
              <div className="flex items-center justify-center lg:justify-start">
                <div className="relative">
                  <div className="inline-flex items-center justify-center w-32 h-32 lg:w-40 lg:h-40 rounded-full bg-gradient-to-br from-[#00d9ff]/20 to-[#0099ff]/20 border-2 border-[#00d9ff]/40 backdrop-blur-sm">
                    <Upload className="w-16 h-16 lg:w-20 lg:h-20 text-[#00d9ff]" />
                  </div>
                  {/* Glow effect */}
                  <div className="absolute inset-0 bg-[#00d9ff]/20 blur-3xl rounded-full -z-10 animate-pulse" style={{ animationDuration: '3s' }} />
                </div>
              </div>

              {/* Right: Content */}
              <div className="text-center lg:text-left space-y-8">
                <div className="space-y-6">
                  <h2 className="text-4xl lg:text-6xl font-bold text-white leading-tight">
                    Upload 20 Photos
                  </h2>
                  <p className="text-xl lg:text-2xl text-gray-300 leading-relaxed">
                    Simply upload 20 photos of yourself or your subject. Our AI learns your unique features, expressions, and style.
                  </p>
                  <p className="text-lg lg:text-xl text-gray-400 leading-relaxed">
                    Once trained, your AI persona works across all our creative tools—video generation, image editing, ad creation, and more. One training session, infinite creative possibilities.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Feature Preview Section - Subtle, Secondary */}
        <section className="relative py-24 px-8">
          <div className="container mx-auto max-w-7xl">
            <div className="text-center mb-16">
              <h2 className="text-3xl lg:text-4xl font-bold text-white mb-4">
                Powerful Tools at Your Fingertips
              </h2>
              <p className="text-lg text-gray-400 max-w-2xl mx-auto">
                Your trained AI persona works seamlessly across our entire suite of creative tools
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-12">
              {mainRoutes.map((route, index) => {
                const Icon = route.icon;
                return (
                  <Link
                    key={route.linkHref}
                    href={route.linkHref}
                    className="group relative glass rounded-xl p-6 border border-white/5 hover:border-[#00d9ff]/30 transition-all hover:bg-white/5"
                    style={{
                      opacity: 0.7,
                      animationDelay: `${index * 0.1}s`,
                    }}
                  >
                    <div className="flex items-center gap-4">
                      <div
                        className="flex items-center justify-center w-12 h-12 rounded-lg bg-black/30 border border-white/10 flex-shrink-0"
                        style={{ filter: `drop-shadow(0 0 6px ${route.iconColor})` }}
                      >
                        <Icon className="w-6 h-6" style={{ color: route.iconColor }} />
                      </div>
                      <div className="flex-1 text-left">
                        <h4 className="text-lg font-semibold text-white mb-1">{route.title}</h4>
                        <p className="text-sm text-gray-400">{route.description}</p>
                      </div>
                      <ArrowRight className="w-5 h-5 text-gray-400 group-hover:text-[#00d9ff] transition-colors opacity-0 group-hover:opacity-100" />
                    </div>
                  </Link>
                );
              })}
            </div>

            {/* Other Features - Even More Subtle */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
              {otherFeatures.map((feature, index) => {
                const Icon = feature.icon;
                return (
                  <Link
                    key={feature.linkHref}
                    href={feature.linkHref}
                    className="group glass rounded-lg p-4 border border-white/5 hover:border-[#00d9ff]/20 transition-all hover:bg-white/5"
                    style={{
                      opacity: 0.5,
                    }}
                  >
                    <div className="flex flex-col items-center text-center gap-2">
                      <div
                        className="flex items-center justify-center w-10 h-10 rounded-lg bg-black/30 border border-white/10"
                        style={{ filter: `drop-shadow(0 0 4px ${feature.iconColor})` }}
                      >
                        <Icon className="w-5 h-5" style={{ color: feature.iconColor }} />
                      </div>
                      <h4 className="text-sm font-medium text-white">{feature.title}</h4>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        </section>

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
