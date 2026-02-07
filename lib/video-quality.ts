import { MODEL_REGISTRY, type ModelAlias } from '@/lib/model-registry';

export type VideoQuality = 'standard' | 'cinematic';

const CREDIT_COST_BY_TIER = {
  low: 1,
  high: 4,
} as const;

export const VIDEO_QUALITY_CONFIG: Record<
  VideoQuality,
  { modelAlias: ModelAlias; creditCost: number; label: string }
> = {
  standard: {
    modelAlias: 'STANDARD_VIDEO_MODEL',
    creditCost: CREDIT_COST_BY_TIER[MODEL_REGISTRY.STANDARD_VIDEO_MODEL.tier],
    label: 'Standard',
  },
  cinematic: {
    modelAlias: 'CINEMATIC_VIDEO_MODEL',
    creditCost: CREDIT_COST_BY_TIER[MODEL_REGISTRY.CINEMATIC_VIDEO_MODEL.tier],
    label: 'Cinematic',
  },
};
