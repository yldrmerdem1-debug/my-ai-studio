import type {
  CaptionCue,
  EditorAsset,
  EditorShotPlan,
  EditorSegmentPurpose,
  EditorSession,
  TimelineSegment,
  TimelineSpec,
} from '@/lib/ad-director';

const DEFAULT_SEGMENT_DURATIONS: Record<EditorSegmentPurpose, number> = {
  hook: 2.5,
  'intro-card': 1.8,
  product: 2.8,
  demo: 3.2,
  proof: 2.6,
  cta: 2.4,
};

const createId = (prefix: string, index: number) => `${prefix}-${index + 1}`;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const splitCaptionText = (text: string, maxWords = 6) => {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return [];

  const sentenceParts = normalized
    .split(/(?<=[.!?])\s+/)
    .map((item) => item.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  for (const sentence of sentenceParts) {
    const words = sentence.split(' ').filter(Boolean);
    if (words.length <= maxWords) {
      chunks.push(sentence);
      continue;
    }
    for (let index = 0; index < words.length; index += maxWords) {
      chunks.push(words.slice(index, index + maxWords).join(' '));
    }
  }
  return chunks;
};

const getEstimatedDuration = (asset: EditorAsset) => {
  if (typeof asset.durationSec === 'number' && asset.durationSec > 0) {
    return asset.durationSec;
  }
  return asset.kind === 'video' ? 12 : 2.8;
};

const getTimelineAssets = (session: EditorSession) => {
  const assets = session.assets.filter((asset) => asset.role !== 'logo');
  const heroAssets = assets.filter((asset) => asset.role === 'hero');
  const referenceAssets = assets.filter((asset) => asset.role === 'reference');
  const productAssets = assets.filter((asset) => asset.role === 'product' || asset.role === 'cover');
  const brollAssets = assets.filter((asset) => asset.role === 'broll');

  if (session.timelineStrategy === 'testimonial-first' && referenceAssets.length > 0) {
    return [...referenceAssets, ...heroAssets, ...productAssets, ...brollAssets];
  }
  if (session.timelineStrategy === 'demo-first' && productAssets.length > 0) {
    return [...productAssets, ...heroAssets, ...brollAssets, ...referenceAssets];
  }
  return [...heroAssets, ...productAssets, ...brollAssets, ...referenceAssets];
};

const pickAssetForShot = (
  shot: EditorShotPlan,
  assets: EditorAsset[],
  fallbackIndex: number
) => {
  const nonLogoAssets = assets.filter((asset) => asset.role !== 'logo');
  const exactAsset = shot.assetId
    ? nonLogoAssets.find((asset) => asset.id === shot.assetId)
    : null;
  if (exactAsset) return exactAsset;

  const preferred = nonLogoAssets.find((asset) => asset.role === shot.assetRoleHint);
  if (preferred) return preferred;

  if (shot.purpose === 'hook') {
    return nonLogoAssets.find((asset) => asset.role === 'hero')
      || nonLogoAssets.find((asset) => asset.role === 'reference')
      || nonLogoAssets[0];
  }

  if (shot.purpose === 'product' || shot.purpose === 'cta') {
    return nonLogoAssets.find((asset) => asset.role === 'product')
      || nonLogoAssets.find((asset) => asset.role === 'cover')
      || nonLogoAssets.find((asset) => asset.role === 'hero')
      || nonLogoAssets[0];
  }

  return nonLogoAssets[fallbackIndex % Math.max(1, nonLogoAssets.length)] || nonLogoAssets[0];
};

const normalizeShotDurations = (shots: EditorShotPlan[], targetDurationSec: number) => {
  const total = shots.reduce((sum, shot) => sum + Math.max(0.5, shot.durationSec), 0);
  if (!Number.isFinite(total) || total <= 0) return shots;

  const scale = targetDurationSec / total;
  let consumed = 0;
  return shots.map((shot, index) => {
    const isLast = index === shots.length - 1;
    const durationSec = isLast
      ? Math.max(1.5, Number((targetDurationSec - consumed).toFixed(2)))
      : Math.max(1.5, Number((shot.durationSec * scale).toFixed(2)));
    consumed += durationSec;
    return {
      ...shot,
      durationSec,
    };
  });
};

const buildShotPlanSegments = (session: EditorSession) => {
  const nonLogoAssets = session.assets.filter((asset) => asset.role !== 'logo');
  if (!session.shotPlan?.length || nonLogoAssets.length === 0) return null;

  const targetDurationSec = session.targetDurationSec || session.shotPlan.reduce<number>((sum, shot) => sum + shot.durationSec, 0);
  const normalizedShots = normalizeShotDurations(session.shotPlan, targetDurationSec);

  return normalizedShots.map((shot, index): TimelineSegment => {
    const asset = pickAssetForShot(shot, nonLogoAssets, index);
    const estimated = getEstimatedDuration(asset);
    const duration = Math.max(1.5, shot.durationSec);
    const reusableStart = asset.kind === 'video'
      ? (index * 1.7) % Math.max(0.1, Math.max(estimated - duration, 0.1))
      : undefined;

    return {
      assetId: asset.id,
      endSec: asset.kind === 'video'
        ? Math.min(estimated, (reusableStart || 0) + Math.min(duration, estimated))
        : undefined,
      id: createId('shot-segment', index),
      motion: asset.kind === 'image' ? 'slow-zoom' : 'cover',
      overlayText: shot.purpose === 'hook'
        ? session.hookPlan.text
        : shot.purpose === 'cta' && session.ctaPlan.enabled
          ? session.ctaPlan.text
          : undefined,
      purpose: shot.purpose,
      sequence: index,
      startSec: asset.kind === 'video' ? reusableStart || 0 : undefined,
      targetDurationSec: duration,
    };
  });
};

const buildSingleAssetSegments = (asset: EditorAsset, session: EditorSession) => {
  const estimated = getEstimatedDuration(asset);
  const hookDuration = clamp(
    session.hookPlan.preferredDurationSec || DEFAULT_SEGMENT_DURATIONS.hook,
    1.8,
    Math.max(2, Math.min(estimated, 4))
  );
  const remaining = Math.max(estimated - hookDuration, DEFAULT_SEGMENT_DURATIONS.demo + DEFAULT_SEGMENT_DURATIONS.cta);
  const demoDuration = clamp(remaining * 0.45, 2.4, 4.5);
  const proofDuration = clamp(remaining * 0.28, 2, 3.6);
  const ctaDuration = clamp(
    session.ctaPlan.durationSec || DEFAULT_SEGMENT_DURATIONS.cta,
    1.8,
    Math.max(2, estimated * 0.22)
  );
  const ctaStart = Math.max(0, estimated - ctaDuration);
  const demoStart = clamp(estimated * 0.18, 0, Math.max(0, estimated - demoDuration - ctaDuration));
  const proofStart = clamp(estimated * 0.55, 0, Math.max(0, ctaStart - proofDuration));

  return [
    {
      assetId: asset.id,
      endSec: clamp(hookDuration, 0.1, estimated),
      id: createId('segment', 0),
      motion: asset.kind === 'image' ? 'slow-zoom' : 'cover',
      overlayText: session.hookPlan.text || undefined,
      purpose: 'hook' as const,
      sequence: 0,
      startSec: 0,
      targetDurationSec: hookDuration,
    },
    {
      assetId: asset.id,
      endSec: clamp(demoStart + demoDuration, demoStart + 0.5, Math.max(demoStart + 0.5, ctaStart)),
      id: createId('segment', 1),
      motion: asset.kind === 'image' ? 'slow-zoom' : 'cover',
      purpose: 'demo' as const,
      sequence: 1,
      startSec: demoStart,
      targetDurationSec: demoDuration,
    },
    {
      assetId: asset.id,
      endSec: clamp(proofStart + proofDuration, proofStart + 0.5, Math.max(proofStart + 0.5, ctaStart)),
      id: createId('segment', 2),
      motion: asset.kind === 'image' ? 'slow-zoom' : 'cover',
      purpose: 'proof' as const,
      sequence: 2,
      startSec: proofStart,
      targetDurationSec: proofDuration,
    },
    {
      assetId: asset.id,
      endSec: estimated,
      id: createId('segment', 3),
      motion: asset.kind === 'image' ? 'slow-zoom' : 'cover',
      overlayText: session.ctaPlan.enabled ? session.ctaPlan.text : undefined,
      purpose: 'cta' as const,
      sequence: 3,
      startSec: ctaStart,
      targetDurationSec: ctaDuration,
    },
  ] satisfies TimelineSegment[];
};

const buildMultiAssetSegments = (assets: EditorAsset[], session: EditorSession) => {
  const hookAsset = assets[0];
  const demoAssets = assets.slice(1);
  const segments: TimelineSegment[] = [
    {
      assetId: hookAsset.id,
      endSec: hookAsset.kind === 'video' ? clamp(session.hookPlan.preferredDurationSec, 0.5, getEstimatedDuration(hookAsset)) : undefined,
      id: createId('segment', 0),
      motion: hookAsset.kind === 'image' ? 'slow-zoom' : 'cover',
      overlayText: session.hookPlan.text || undefined,
      purpose: 'hook',
      sequence: 0,
      startSec: hookAsset.kind === 'video' ? 0 : undefined,
      targetDurationSec: clamp(session.hookPlan.preferredDurationSec, 1.8, 3.5),
    },
  ];

  demoAssets.forEach((asset, index) => {
    const purpose = index === demoAssets.length - 1 ? 'proof' : asset.role === 'product' ? 'product' : 'demo';
    const estimated = getEstimatedDuration(asset);
    const targetDurationSec = clamp(
      asset.kind === 'video' ? Math.min(estimated, 3.4) : 2.4,
      1.8,
      4
    );
    segments.push({
      assetId: asset.id,
      endSec: asset.kind === 'video' ? clamp(targetDurationSec, 0.5, estimated) : undefined,
      id: createId('segment', segments.length),
      motion: asset.kind === 'image' ? 'slow-zoom' : 'cover',
      purpose,
      sequence: segments.length,
      startSec: asset.kind === 'video' ? 0 : undefined,
      targetDurationSec,
    });
  });

  const ctaAsset = demoAssets[demoAssets.length - 1] || hookAsset;
  segments.push({
    assetId: ctaAsset.id,
    endSec: ctaAsset.kind === 'video' ? clamp(getEstimatedDuration(ctaAsset), 0.5, getEstimatedDuration(ctaAsset)) : undefined,
    id: createId('segment', segments.length),
    motion: ctaAsset.kind === 'image' ? 'slow-zoom' : 'cover',
    overlayText: session.ctaPlan.enabled ? session.ctaPlan.text : undefined,
    purpose: 'cta',
    sequence: segments.length,
    startSec: ctaAsset.kind === 'video'
      ? Math.max(0, getEstimatedDuration(ctaAsset) - clamp(session.ctaPlan.durationSec, 1.8, 3))
      : undefined,
    targetDurationSec: clamp(session.ctaPlan.durationSec, 1.8, 3),
  });

  return segments;
};

const buildCaptionCues = (session: EditorSession, segments: TimelineSegment[]) => {
  if (session.captionMode === 'none') return [];

  const cues: CaptionCue[] = [];
  let cursor = 0;

  segments.forEach((segment) => {
    const startSec = cursor;
    const endSec = cursor + segment.targetDurationSec;
    if (segment.purpose === 'hook' && session.hookPlan.text) {
      cues.push({
        assetId: segment.assetId,
        endSec,
        id: createId('cue-hook', cues.length),
        startSec,
        style: 'hook',
        text: session.hookPlan.text,
      });
    }
    cursor = endSec;
  });

  const bodySegments = segments.filter((segment) => segment.purpose !== 'hook' && segment.purpose !== 'cta');
  const chunks = splitCaptionText(session.captionText);
  const usableSegments = bodySegments.length > 0 ? bodySegments : segments.filter((segment) => segment.purpose !== 'cta');

  if (chunks.length > 0 && usableSegments.length > 0) {
    let chunkIndex = 0;
    usableSegments.forEach((segment, segmentIndex) => {
      const segmentStart = segments
        .slice(0, segments.findIndex((item) => item.id === segment.id))
        .reduce((sum, item) => sum + item.targetDurationSec, 0);
      const segmentEnd = segmentStart + segment.targetDurationSec;
      const remainingSegments = usableSegments.length - segmentIndex;
      const remainingChunks = chunks.length - chunkIndex;
      const chunkCount = Math.max(1, Math.ceil(remainingChunks / remainingSegments));
      const localChunks = chunks.slice(chunkIndex, chunkIndex + chunkCount);
      chunkIndex += localChunks.length;

      const cueDuration = segment.targetDurationSec / localChunks.length;
      localChunks.forEach((chunk, localIndex) => {
        cues.push({
          assetId: segment.assetId,
          endSec: localIndex === localChunks.length - 1 ? segmentEnd : segmentStart + cueDuration * (localIndex + 1),
          id: createId('cue-body', cues.length),
          startSec: segmentStart + cueDuration * localIndex,
          style: 'body',
          text: chunk,
        });
      });
    });
  }

  if (session.ctaPlan.enabled && session.ctaPlan.text) {
    const ctaSegment = segments[segments.length - 1];
    const ctaStart = Math.max(0, segments.reduce((sum, item) => sum + item.targetDurationSec, 0) - ctaSegment.targetDurationSec);
    cues.push({
      assetId: ctaSegment.assetId,
      endSec: ctaStart + ctaSegment.targetDurationSec,
      id: createId('cue-cta', cues.length),
      startSec: ctaStart,
      style: 'cta',
      text: session.ctaPlan.text,
    });
  }

  return cues;
};

export const planEditorTimeline = (session: EditorSession): TimelineSpec => {
  const timelineAssets = getTimelineAssets(session);
  const segments = buildShotPlanSegments(session)
    || (timelineAssets.length <= 1
      ? buildSingleAssetSegments(
        timelineAssets[0] || {
          id: 'missing-asset',
          kind: 'image',
          label: 'Fallback Card',
          role: 'cover',
          source: 'manual',
          url: '',
        },
        session
      )
      : buildMultiAssetSegments(timelineAssets, session));

  const captions = buildCaptionCues(session, segments);
  const totalDurationSec = Number(
    segments.reduce((sum, segment) => sum + segment.targetDurationSec, 0).toFixed(2)
  );

  return {
    captions,
    segments,
    totalDurationSec,
  };
};
