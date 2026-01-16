'use client';

import { memo } from 'react';

const ENABLE_GENERATION = false;

const VideoStudioPreview = memo(function VideoStudioPreview() {
  return (
    <div className="relative h-full w-full overflow-hidden">
      <img
        src="/images/video-studio-poster.jpg"
        alt="Video Studio preview"
        className="absolute inset-0 z-[1] h-full w-full object-cover"
        loading="eager"
        decoding="async"
        onError={(e) => {
          e.currentTarget.src = '/images/video-studio-poster.jpg';
        }}
      />
      {!ENABLE_GENERATION ? null : (
        <div className="absolute inset-0 z-[2]" />
      )}
      <div className="pointer-events-none absolute inset-0 z-[3] bg-gradient-to-t from-black/40 via-black/10 to-transparent" />
    </div>
  );
});

const ViralPreview = memo(function ViralPreview() {
  return (
    <div className="relative h-full w-full overflow-hidden">
      <img
        src="/images/viral-preview-poster.jpg"
        alt="Viral preview"
        className="absolute inset-0 z-[1] h-full w-full object-cover"
        loading="eager"
        decoding="async"
        onError={(e) => {
          e.currentTarget.src = '/images/video-studio-poster.jpg';
        }}
      />
      {!ENABLE_GENERATION ? null : (
        <div className="absolute inset-0 z-[2]" />
      )}
      <div className="pointer-events-none absolute inset-0 z-[3] bg-gradient-to-t from-black/40 via-black/10 to-transparent" />
    </div>
  );
});

const AdScriptPreview = memo(function AdScriptPreview() {
  return (
    <div className="relative h-full w-full overflow-hidden">
      <img
        src="/images/ad-script-preview-poster.jpg"
        alt="Ad Script preview"
        className="absolute inset-0 z-[1] h-full w-full object-cover"
        loading="eager"
        decoding="async"
        onError={(e) => {
          e.currentTarget.src = '/images/video-studio-poster.jpg';
        }}
      />
      {!ENABLE_GENERATION ? null : (
        <div className="absolute inset-0 z-[2]" />
      )}
      <div className="pointer-events-none absolute inset-0 z-[3] bg-gradient-to-t from-black/40 via-black/10 to-transparent" />
    </div>
  );
});

export { VideoStudioPreview, ViralPreview, AdScriptPreview };
