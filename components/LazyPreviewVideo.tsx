'use client';

import { useEffect, useRef, useState } from 'react';

interface LazyPreviewVideoProps {
  srcMp4: string;
  srcWebm?: string;
  poster?: string;
  videoClassName?: string;
  containerClassName?: string;
}

const DEFAULT_POSTER = '/images/video-studio-poster.jpg';
const ENABLE_GENERATION = false;

export default function LazyPreviewVideo({
  srcMp4,
  srcWebm,
  poster = DEFAULT_POSTER,
  videoClassName = '',
  containerClassName = '',
}: LazyPreviewVideoProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [shouldLoad, setShouldLoad] = useState(false);

  useEffect(() => {
    if (!ENABLE_GENERATION) return;
    const node = containerRef.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setShouldLoad(true);
            setIsVisible(true);
          } else {
            setIsVisible(false);
          }
        });
      },
      { rootMargin: '200px 0px', threshold: 0.25 }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!ENABLE_GENERATION) return;
    const video = videoRef.current;
    if (!video) return;

    let rafId: number | null = null;

    if (isVisible && shouldLoad) {
      rafId = window.requestAnimationFrame(() => {
        const playPromise = video.play();
        if (playPromise && typeof playPromise.then === 'function') {
          playPromise.catch(() => undefined);
        }
      });
    } else {
      video.pause();
    }

    return () => {
      if (rafId) {
        window.cancelAnimationFrame(rafId);
      }
    };
  }, [isVisible, shouldLoad]);

  return (
    <div
      ref={containerRef}
      className={`relative h-full w-full overflow-hidden ${containerClassName}`}
      style={{ willChange: 'transform', transform: 'translateZ(0)' }}
    >
      {!ENABLE_GENERATION ? (
        <img
          src={poster}
          alt="Video preview"
          className={videoClassName}
          loading="eager"
          decoding="async"
          onError={(e) => {
            e.currentTarget.src = DEFAULT_POSTER;
          }}
        />
      ) : (
        <video
          ref={videoRef}
          className={videoClassName}
          muted
          loop
          playsInline
          preload="none"
          poster={poster}
          style={{ willChange: 'transform', transform: 'translateZ(0)' }}
        >
          {shouldLoad && srcWebm && <source src={srcWebm} type="video/webm" />}
          {shouldLoad && <source src={srcMp4} type="video/mp4" />}
        </video>
      )}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/40 via-black/10 to-transparent" />
    </div>
  );
}
