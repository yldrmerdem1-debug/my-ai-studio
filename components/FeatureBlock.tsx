'use client';

import Link from 'next/link';
import { Video, type LucideIcon } from 'lucide-react';

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
}: FeatureBlockProps) {
  return (
    <div>
      <div className="rounded-3xl border border-white/10 overflow-hidden p-8 bg-black/40">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
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

            <div className="flex flex-col gap-4">
              <Link href={linkHref}>
                <button className="interactive-element px-10 py-4 bg-gradient-to-r from-[#00d9ff] to-[#0099ff] text-white font-semibold text-lg rounded-xl">
                  <span>Try Now</span>
                </button>
              </Link>

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

          <div
            className="flex items-center justify-center"
            style={{ order: isReversed ? 1 : 2 }}
          >
            <div className="w-full h-full min-h-[350px] rounded-2xl border border-white/20 overflow-hidden bg-black/30">
              <div className="w-full h-full flex items-center justify-center p-8">
                <div className="text-center max-w-md">
                  <div className="w-24 h-24 mx-auto mb-6 rounded-full bg-white/5 flex items-center justify-center border border-white/10">
                    <Video className="w-12 h-12 text-[#00d9ff]" />
                  </div>
                  <p className="text-gray-300 text-sm leading-relaxed mb-3">{videoDescription}</p>
                  <p className="text-gray-500 text-xs">Preview clip</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
