export const CINEMATIC_VISUAL_SUFFIX =
  ', shot on Arri Alexa LF, 35mm film grain, anamorphic lens flares, hyper-detailed skin texture, volumetric lighting, 8k resolution, color graded, --ar 16:9 --stylize 500';

export type VideoEngineKey =
  | 'grok'
  | 'veo'
  | 'runway'
  | 'kling_3_pro'
  | 'kling_turbo'
  | 'kling_2_6'
  | 'kling_avatar_v2';

export const VIDEO_ENGINES_CONFIG: Record<
  VideoEngineKey,
  {
    supportedDurations: number[];
    defaultDuration: number;
    mode?: 'select' | 'auto';
    note?: string;
  }
> = {
  grok: {
    supportedDurations: [5, 10, 15],
    defaultDuration: 5,
    mode: 'select',
  },
  veo: {
    // Replicate Veo 3.1 supports 4/6/8-second clips.
    supportedDurations: [4, 6, 8],
    defaultDuration: 8,
    mode: 'select',
  },
  runway: {
    // Runway I2V supports 2-10 seconds; keep a tight UX set.
    supportedDurations: [5, 8, 10],
    defaultDuration: 5,
    mode: 'select',
  },
  kling_3_pro: {
    supportedDurations: [5, 10, 15],
    defaultDuration: 5,
    mode: 'select',
  },
  kling_turbo: {
    supportedDurations: [5, 10],
    defaultDuration: 5,
    mode: 'select',
  },
  kling_2_6: {
    supportedDurations: [5, 10],
    defaultDuration: 5,
    mode: 'select',
  },
  kling_avatar_v2: {
    supportedDurations: [],
    defaultDuration: 0,
    mode: 'auto',
    note: 'Lip-sync duration is driven by audio length.',
  },
};
