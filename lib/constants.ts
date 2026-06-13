export const CINEMATIC_VISUAL_SUFFIX =
  ', shot on Arri Alexa LF, 35mm film grain, anamorphic lens flares, hyper-detailed skin texture, volumetric lighting, 8k resolution, color graded, --ar 16:9 --stylize 500';

export type VideoEngineKey =
  | 'grok'
  | 'seedance_2_0'
  | 'veo'
  | 'runway'
  | 'kling_3_pro'
  | 'kling_turbo'
  | 'kling_2_6'
  | 'kling_avatar_v2';

export type VideoQualityPreset = '480p' | '720p' | '1080p' | '1584x672';

export const VIDEO_QUALITY_PRESET_LABELS: Record<
  VideoQualityPreset,
  { title: string; hint: string }
> = {
  '480p': {
    title: '480p',
    hint: 'Fast',
  },
  '720p': {
    title: '720p',
    hint: 'Standard HD',
  },
  '1080p': {
    title: '1080p',
    hint: 'High quality',
  },
  '1584x672': {
    title: '1584x672',
    hint: 'Runway max',
  },
};

export const VIDEO_ENGINES_CONFIG: Record<
  VideoEngineKey,
  {
    supportedDurations: number[];
    defaultDuration: number;
    mode?: 'select' | 'auto';
    note?: string;
    supportedQualities: VideoQualityPreset[];
    defaultQuality: VideoQualityPreset;
  }
> = {
  grok: {
    supportedDurations: [5, 10, 15],
    defaultDuration: 5,
    mode: 'select',
    supportedQualities: ['480p', '720p', '1080p'],
    defaultQuality: '720p',
  },
  seedance_2_0: {
    // ByteDance Seedance 2.0 supports 4-15 seconds; keep the UX presets aligned with ad clip lengths.
    supportedDurations: [5, 10, 15],
    defaultDuration: 10,
    mode: 'select',
    supportedQualities: ['480p', '720p', '1080p'],
    defaultQuality: '720p',
  },
  veo: {
    // Replicate Veo 3.1 supports 4/6/8-second clips.
    supportedDurations: [4, 6, 8],
    defaultDuration: 8,
    mode: 'select',
    supportedQualities: ['720p', '1080p'],
    defaultQuality: '720p',
  },
  runway: {
    // Runway I2V supports 2-10 seconds; keep a tight UX set.
    supportedDurations: [5, 8, 10],
    defaultDuration: 5,
    mode: 'select',
    supportedQualities: ['720p', '1584x672'],
    defaultQuality: '720p',
  },
  kling_3_pro: {
    supportedDurations: [5, 10, 15],
    defaultDuration: 5,
    mode: 'select',
    supportedQualities: ['720p', '1080p'],
    defaultQuality: '720p',
  },
  kling_turbo: {
    supportedDurations: [5, 10],
    defaultDuration: 5,
    mode: 'select',
    supportedQualities: ['720p'],
    defaultQuality: '720p',
  },
  kling_2_6: {
    supportedDurations: [5, 10],
    defaultDuration: 5,
    mode: 'select',
    supportedQualities: ['720p', '1080p'],
    defaultQuality: '720p',
  },
  kling_avatar_v2: {
    supportedDurations: [],
    defaultDuration: 0,
    mode: 'auto',
    note: 'Lip-sync duration is driven by audio length.',
    supportedQualities: ['720p'],
    defaultQuality: '720p',
  },
};

export const VIDEO_ENGINES_WITH_DIRECT_POLLING = new Set<VideoEngineKey>([
  'runway',
  'kling_3_pro',
  'kling_turbo',
  'kling_2_6',
]);

export const supportsDirectVideoPolling = (engine: unknown): boolean =>
  VIDEO_ENGINES_WITH_DIRECT_POLLING.has(String(engine || '').trim().toLowerCase() as VideoEngineKey);
