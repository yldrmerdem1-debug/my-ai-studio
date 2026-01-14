'use client';

import { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { Film, Sparkles, Video, FileText, Folder, Gem, Box, User, Image as ImageIcon, Zap } from 'lucide-react';

const navItems = [
  { name: 'Studio', href: '/', icon: Film },
  { name: 'AI Persona Lab', href: '/persona', icon: Sparkles, isPremium: true },
  { name: 'Face Identify', href: '/face-identify', icon: User },
  { name: 'AI Video', href: '/video', icon: Video },
  { name: 'Background Change', href: '/background-change', icon: ImageIcon },
  { name: 'Ad Creation', href: '/ad-creation', icon: FileText },
  { name: '3D Character Lab', href: '/3d', icon: Box },
  { name: 'AI Ad Script', href: '/ad-script', icon: FileText },
  { name: 'Viral / Entertainment', href: '/viral-entertainment', icon: Zap },
  { name: 'My Assets', href: '/my-assets', icon: Folder },
  { name: 'Subscription', href: '#', icon: Gem, isModal: true },
];

interface SidebarProps {
  onSubscriptionClick?: () => void;
}

export default function Sidebar({ onSubscriptionClick }: SidebarProps) {
  const pathname = usePathname();
  const [activeIndicatorStyle, setActiveIndicatorStyle] = useState({ top: 0, height: 0 });

  // Find active item and calculate indicator position
  useEffect(() => {
    const activeIndex = navItems.findIndex(item => {
      if (item.isModal) return false;
      if (item.href === '/') return pathname === '/';
      return pathname?.startsWith(item.href);
    });

    if (activeIndex !== -1 && !navItems[activeIndex].isModal) {
      const itemHeight = 56; // Height of each nav item (px-4 py-3 = ~56px)
      const topPosition = activeIndex * itemHeight;
      setActiveIndicatorStyle({ top: topPosition, height: itemHeight });
    }
  }, [pathname]);

  return (
    <aside className="glass-strong fixed left-0 top-0 z-20 h-screen w-64 border-r border-white/10 p-6 shadow-2xl">
      <div className="mb-12">
        <h1 className="text-2xl font-bold text-white">
          <span className="text-[#00d9ff]">AI</span> Media
        </h1>
        <p className="mt-1 text-sm text-gray-400">SaaS Platform</p>
      </div>
      
      <nav className="space-y-2 relative">
        {/* Animated Active Indicator */}
        <div
          className="absolute left-0 w-1 bg-gradient-to-b from-[#00d9ff] to-[#0099ff] rounded-r-full transition-all duration-500 ease-[cubic-bezier(0.34,1.56,0.64,1)]"
          style={{
            top: `${activeIndicatorStyle.top}px`,
            height: `${activeIndicatorStyle.height}px`,
          }}
        />

        {navItems.map((item) => {
          const IconComponent = item.icon;
          const isActive = item.isModal 
            ? false 
            : (item.href === '/' ? pathname === '/' : pathname?.startsWith(item.href));

          const className = `interactive-element flex w-full items-center gap-3 rounded-lg px-4 py-3 text-left text-sm font-medium transition-all relative ${
            isActive
              ? 'bg-[#00d9ff]/20 text-[#00d9ff] border border-[#00d9ff]/30 backdrop-blur-sm'
              : 'text-gray-300 hover:bg-white/5 hover:text-white backdrop-blur-sm'
          }`;

          if (item.isModal) {
            return (
              <button
                key={item.name}
                onClick={() => onSubscriptionClick?.()}
                className={className}
              >
                <div className="flex items-center justify-center" style={{ color: 'inherit' }}>
                  <IconComponent className="w-5 h-5" />
                </div>
                <span>{item.name}</span>
                {item.isPremium && (
                  <span className="ml-auto px-2 py-0.5 text-xs font-semibold bg-gradient-to-r from-yellow-500 to-orange-500 text-black rounded">
                    PREMIUM
                  </span>
                )}
              </button>
            );
          }

          return (
            <Link
              key={item.name}
              href={item.href}
              className={className}
            >
              <div className="flex items-center justify-center" style={{ color: 'inherit' }}>
                <IconComponent className="w-5 h-5" />
              </div>
              <span>{item.name}</span>
              {item.isPremium && (
                <span className="ml-auto px-2 py-0.5 text-xs font-semibold bg-gradient-to-r from-yellow-500 to-orange-500 text-black rounded">
                  PREMIUM
                </span>
              )}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
