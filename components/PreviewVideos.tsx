'use client';

import { memo, useRef, useState } from 'react';

function useHoverPlayback() {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  return { containerRef, videoRef };
}

const VideoStudioPreview = memo(function VideoStudioPreview() {
  const { containerRef, videoRef } = useHoverPlayback();
  const [isHovered, setIsHovered] = useState(false);
  const [isReady, setIsReady] = useState(false);

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden"
      onMouseEnter={() => {
        setIsHovered(true);
        const video = videoRef.current;
        if (video) {
          const playPromise = video.play();
          if (playPromise && typeof playPromise.catch === 'function') {
            playPromise.catch(() => undefined);
          }
        }
      }}
      onMouseLeave={() => {
        setIsHovered(false);
        const video = videoRef.current;
        if (video) {
          video.pause();
          video.currentTime = 0;
        }
      }}
    >
      <img
        src="/images/video-studio-poster.jpg"
        alt="Video Studio preview"
        className={`absolute inset-0 z-[1] h-full w-full object-cover transition-opacity duration-300 ${isHovered && isReady ? 'opacity-0' : 'opacity-100'}`}
        loading="eager"
        decoding="async"
        onError={(e) => {
          e.currentTarget.src = '/images/video-preview-poster.svg';
        }}
      />
      <video
        ref={videoRef}
        className={`video-preview absolute inset-0 z-[2] h-full w-full object-cover transition-opacity duration-300 ${isHovered && isReady ? 'opacity-100' : 'opacity-0'} transition-transform duration-500 group-hover:scale-[1.02]`}
        muted
        loop
        playsInline
        preload="metadata"
        poster="/images/video-studio-poster.jpg"
        style={{ pointerEvents: 'none' }}
        onCanPlay={() => setIsReady(true)}
        onPlay={() => setIsReady(true)}
      >
        <source src="/videos/video-studio-preview.mp4" type="video/mp4" />
      </video>
      <div className="pointer-events-none absolute inset-0 z-[3] bg-gradient-to-t from-black/40 via-black/10 to-transparent" />
    </div>
  );
});

const ViralPreview = memo(function ViralPreview() {
  const { containerRef, videoRef } = useHoverPlayback();
  const [isHovered, setIsHovered] = useState(false);
  const [isReady, setIsReady] = useState(false);

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden"
      onMouseEnter={() => {
        setIsHovered(true);
        const video = videoRef.current;
        if (video) {
          const playPromise = video.play();
          if (playPromise && typeof playPromise.catch === 'function') {
            playPromise.catch(() => undefined);
          }
        }
      }}
      onMouseLeave={() => {
        setIsHovered(false);
        const video = videoRef.current;
        if (video) {
          video.pause();
          video.currentTime = 0;
        }
      }}
    >
      <img
        src="/images/viral-preview-poster.jpg"
        alt="Viral preview"
        className={`absolute inset-0 z-[1] h-full w-full object-cover transition-opacity duration-300 ${isHovered && isReady ? 'opacity-0' : 'opacity-100'}`}
        loading="eager"
        decoding="async"
        onError={(e) => {
          e.currentTarget.src = '/images/video-preview-poster.svg';
        }}
      />
      <video
        ref={videoRef}
        className={`video-preview absolute inset-0 z-[2] h-full w-full object-cover transition-opacity duration-300 ${isHovered && isReady ? 'opacity-100' : 'opacity-0'} transition-transform duration-500 group-hover:scale-[1.02]`}
        muted
        loop
        playsInline
        preload="metadata"
        poster="/images/viral-preview-poster.jpg"
        style={{ pointerEvents: 'none' }}
        onCanPlay={() => setIsReady(true)}
        onPlay={() => setIsReady(true)}
      >
        <source src="/videos/viral-preview.webm" type="video/webm" />
        <source src="/videos/viral-preview.mp4" type="video/mp4" />
      </video>
      <div className="pointer-events-none absolute inset-0 z-[3] bg-gradient-to-t from-black/40 via-black/10 to-transparent" />
    </div>
  );
});

const AdScriptPreview = memo(function AdScriptPreview() {
  const { containerRef, videoRef } = useHoverPlayback();
  const [isHovered, setIsHovered] = useState(false);
  const [isReady, setIsReady] = useState(false);

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden"
      onMouseEnter={() => {
        setIsHovered(true);
        const video = videoRef.current;
        if (video) {
          const playPromise = video.play();
          if (playPromise && typeof playPromise.catch === 'function') {
            playPromise.catch(() => undefined);
          }
        }
      }}
      onMouseLeave={() => {
        setIsHovered(false);
        const video = videoRef.current;
        if (video) {
          video.pause();
          video.currentTime = 0;
        }
      }}
    >
      <img
        src="/images/ad-script-preview-poster.jpg"
        alt="Ad Script preview"
        className={`absolute inset-0 z-[1] h-full w-full object-cover transition-opacity duration-300 ${isHovered && isReady ? 'opacity-0' : 'opacity-100'}`}
        loading="eager"
        decoding="async"
        onError={(e) => {
          e.currentTarget.src = '/images/video-preview-poster.svg';
        }}
      />
      <video
        ref={videoRef}
        className={`video-preview absolute inset-0 z-[2] h-full w-full object-cover transition-opacity duration-300 ${isHovered && isReady ? 'opacity-100' : 'opacity-0'} transition-transform duration-500 group-hover:scale-[1.02]`}
        muted
        loop
        playsInline
        preload="metadata"
        poster="/images/ad-script-preview-poster.jpg"
        style={{ pointerEvents: 'none' }}
        onCanPlay={() => setIsReady(true)}
        onPlay={() => setIsReady(true)}
      >
        <source src="/videos/ad-script-preview.webm" type="video/webm" />
        <source src="/videos/ad-script-preview.mp4" type="video/mp4" />
      </video>
      <div className="pointer-events-none absolute inset-0 z-[3] bg-gradient-to-t from-black/40 via-black/10 to-transparent" />
    </div>
  );
});

export { VideoStudioPreview, ViralPreview, AdScriptPreview };
