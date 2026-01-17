'use client';

import { memo } from 'react';

const AdScriptPreview = memo(function AdScriptPreview() {
  return (
    <div className="relative h-full w-full overflow-hidden bg-[#0a0f16]">
      <div className="relative h-full w-full p-6">
        <div className="h-full rounded-2xl border border-white/10 p-5">
          <div className="mb-4">
            <p className="text-xs font-semibold tracking-[0.2em] text-white/60">SCRIPT PREVIEW</p>
          </div>
          <div className="space-y-3 text-sm text-white/60">
            <div className="flex items-start gap-3">
              <span className="text-xs font-semibold text-white/80">HOOK</span>
              <span className="flex-1 text-white/70">
                “Imagine your next launch stopping the scroll.”
              </span>
            </div>
            <div className="flex items-start gap-3">
              <span className="text-xs font-semibold text-white/50">BODY</span>
              <span className="flex-1 text-white/50">
                “We turn one idea into a ready-to-play ad script.”
              </span>
            </div>
            <div className="flex items-start gap-3">
              <span className="text-xs font-semibold text-white/40">CTA</span>
              <span className="flex-1 text-white/40">
                “Generate. Listen. Launch.”
              </span>
            </div>
          </div>
          <div className="mt-6">
            <div className="text-[11px] text-white/50">Write the script. Turn it into voice.</div>
            <div className="mt-3 flex items-end gap-1">
              {[10, 18, 12, 22, 14, 26, 16, 24, 12, 20, 14].map((height, index) => (
                <span
                  key={`wave-${index}`}
                  className="w-2 rounded-full bg-[#3b82f6]/50"
                  style={{ height: `${height}px` }}
                />
              ))}
            </div>
            <div className="mt-2 text-[10px] uppercase tracking-[0.3em] text-white/40">
              ▶ AI Voice Preview
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});

export { AdScriptPreview };
