'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Film, Sparkles, Video, FileText, Folder, Gem, Box } from 'lucide-react';

const navItems = [
  { name: 'Studio', href: '/', icon: <Film className="w-5 h-5" /> },
  { name: 'AI Persona Lab', href: '/persona', icon: <Sparkles className="w-5 h-5" />, isPremium: true },
  { name: 'AI Video', href: '/video', icon: <Video className="w-5 h-5" /> },
  { name: '3D Character Lab', href: '/3d', icon: <Box className="w-5 h-5" /> },
  { name: 'AI Ad Script', href: '/ad-script', icon: <FileText className="w-5 h-5" /> },
  { name: 'My Assets', href: '/assets', icon: <Folder className="w-5 h-5" /> },
  { name: 'Subscription', href: '#', icon: <Gem className="w-5 h-5" />, isModal: true },
];

interface SidebarProps {
  onSubscriptionClick?: () => void;
}

export default function Sidebar({ onSubscriptionClick }: SidebarProps) {
  const [activeItem, setActiveItem] = useState('Studio');

  return (
    <aside className="glass-strong fixed left-0 top-0 z-20 h-screen w-64 border-r border-white/10 p-6 shadow-2xl">
      <div className="mb-12">
        <h1 className="text-2xl font-bold text-white">
          <span className="text-[#00d9ff]">AI</span> Media
        </h1>
        <p className="mt-1 text-sm text-gray-400">SaaS Platform</p>
      </div>
      
      <nav className="space-y-2">
        {navItems.map((item) => {
          const className = `flex w-full items-center gap-3 rounded-lg px-4 py-3 text-left text-sm font-medium transition-all ${
            activeItem === item.name
              ? 'bg-[#00d9ff]/20 text-[#00d9ff] border border-[#00d9ff]/30 backdrop-blur-sm'
              : 'text-gray-300 hover:bg-white/5 hover:text-white backdrop-blur-sm'
          }`;

          if (item.isModal) {
            return (
              <button
                key={item.name}
                onClick={() => {
                  setActiveItem(item.name);
                  onSubscriptionClick?.();
                }}
                className={className}
              >
                <div className="flex items-center justify-center" style={{ color: 'inherit' }}>
                  {item.icon}
                </div>
                <span>{item.name}</span>
              </button>
            );
          }

          return (
            <Link
              key={item.name}
              href={item.href}
              onClick={() => setActiveItem(item.name)}
              className={className}
            >
              <div className="flex items-center justify-center" style={{ color: 'inherit' }}>
                {item.icon}
              </div>
              <span>{item.name}</span>
              {item.isPremium && (
                <span className="ml-auto text-[10px] font-bold bg-gradient-to-r from-yellow-500 to-orange-500 text-black px-1.5 py-0.5 rounded">
                  PRO
                </span>
              )}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}

