export type ModelTier = 'low' | 'high';
export type ModelAlias = 'STANDARD_VIDEO_MODEL' | 'CINEMATIC_VIDEO_MODEL';

export const MODEL_REGISTRY: Record<ModelAlias, { activeModel: string; tier: ModelTier }> = {
  STANDARD_VIDEO_MODEL: {
    activeModel: 'luma/ray-2-720p',
    tier: 'low',
  },
  CINEMATIC_VIDEO_MODEL: {
    activeModel: 'luma/ray-2-720p',
    tier: 'high',
  },
};
