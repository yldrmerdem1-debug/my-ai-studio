'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, Volume2, VolumeX } from 'lucide-react';

type VideoPlayerWithAudioProps = {
  videoUrl: string;
  poster?: string;
  hasAudio?: boolean;
  className?: string;
};

const waveformDefaults = [10, 18, 12, 22, 14, 26, 16, 24, 12, 20, 14, 28, 16, 22];

export default function VideoPlayerWithAudio({
  videoUrl,
  poster,
  hasAudio = true,
  className,
}: VideoPlayerWithAudioProps) {
  const [muted, setMuted] = useState(!hasAudio);
  const videoRef = useRef<HTMLVideoElement>(null);
  const waveformHeights = useMemo(() => waveformDefaults, []);

  const handleDownload = async () => {
    try {
      const response = await fetch(videoUrl);
      if (!response.ok) {
        throw new Error('Download failed');
      }
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = `video-${Date.now()}.mp4`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
    } catch {
      window.open(videoUrl, '_blank', 'noopener,noreferrer');
    }
  };

  useEffect(() => {
    if (!hasAudio) {
      setMuted(true);
    }
  }, [hasAudio]);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.muted = muted;
    }
  }, [muted]);

  return (
    <div className={`flex flex-col gap-3 ${className ?? ''}`}>
      <div className="aspect-video w-full overflow-hidden rounded-xl">
        <video
          ref={videoRef}
          className="h-full w-full object-cover"
          src={videoUrl}
          poster={poster}
          muted={muted}
          controls
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 px-1 pb-1">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setMuted(prev => !prev)}
            disabled={!hasAudio}
            aria-pressed={!muted}
            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            {muted ? 'Unmute' : 'Mute'}
          </button>
          <button
            type="button"
            onClick={handleDownload}
            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold text-white transition hover:bg-white/10"
          >
            <Download className="h-4 w-4" />
            İndir
          </button>
        </div>
        <div className={`flex items-end gap-1 ${hasAudio ? '' : 'opacity-50'}`}>
          {waveformHeights.map((height, index) => (
            <span
              key={`${height}-${index}`}
              className="h-2 w-2 rounded-full bg-[#00d9ff]/70 animate-pulse"
              style={{ height: `${height}px`, animationDelay: `${index * 0.1}s` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
