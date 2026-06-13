import { normalizePersonaSubjectType, type PersonaSubjectType } from '@/lib/persona-subject';

export type PersonaTrainingProvider = 'fal' | 'replicate';

export type PersonaTrainingEngineId =
  | 'flux-lora-portrait-trainer'
  | 'flux-lora-fast-training'
  | 'flux-dev-lora-trainer';

export type PersonaImageEngineId =
  | 'auto'
  | 'flux-dev-lora'
  | 'flux-kontext-lora'
  | 'flux-kontext-pro'
  | 'flux-2-max'
  | 'nano-banana'
  | 'nano-banana-2'
  | 'nano-banana-pro';

export type PersonaGenerationMode = 'creative' | 'exact';

export type PersonaTrainingProfile = {
  subjectType: PersonaSubjectType;
  subjectLabel: string;
  engineId: PersonaTrainingEngineId;
  engineLabel: string;
  engineDescription: string;
  provider: PersonaTrainingProvider;
  modelId: string;
  minImages: number;
  recommendedMinImages: number;
  recommendedMaxImages: number;
  maxImages: number;
  referenceImagesMax: number;
  referenceImagesRecommended: boolean;
  defaultSteps: number;
};

export type PersonaImageEngineOption = {
  id: Exclude<PersonaImageEngineId, 'auto'>;
  label: string;
  description: string;
  supportsReferenceImages: boolean;
  recommendedMode: PersonaGenerationMode;
};

export const FAL_PORTRAIT_TRAINING_MODEL = 'fal-ai/flux-lora-portrait-trainer';
export const FAL_PORTRAIT_TRAINING_ENGINE_LABEL = 'FLUX LoRA Portrait Trainer';
export const FAL_FAST_TRAINING_MODEL = 'fal-ai/flux-lora-fast-training';
export const FAL_FAST_TRAINING_ENGINE_LABEL = 'FLUX LoRA Fast Training';
export const REPLICATE_FLUX_TRAINING_MODEL = 'ostris/flux-dev-lora-trainer';
export const REPLICATE_FLUX_TRAINING_ENGINE_LABEL = 'Replicate FLUX Dev LoRA Trainer';

const TRAINING_PROFILES: Record<PersonaSubjectType, PersonaTrainingProfile> = {
  human: {
    subjectType: 'human',
    subjectLabel: 'Human',
    engineId: 'flux-lora-portrait-trainer',
    engineLabel: FAL_PORTRAIT_TRAINING_ENGINE_LABEL,
    engineDescription: 'Recommended portrait training for strong human identity with a shorter production wait.',
    provider: 'fal',
    modelId: FAL_PORTRAIT_TRAINING_MODEL,
    minImages: 10,
    recommendedMinImages: 15,
    recommendedMaxImages: 25,
    maxImages: 25,
    referenceImagesMax: 4,
    referenceImagesRecommended: true,
    defaultSteps: 1800,
  },
  animal: {
    subjectType: 'animal',
    subjectLabel: 'Animal',
    engineId: 'flux-lora-fast-training',
    engineLabel: FAL_FAST_TRAINING_ENGINE_LABEL,
    engineDescription: 'Fast FLUX LoRA training for recognizable animal identity with Replicate fallback.',
    provider: 'fal',
    modelId: FAL_FAST_TRAINING_MODEL,
    minImages: 12,
    recommendedMinImages: 18,
    recommendedMaxImages: 30,
    maxImages: 30,
    referenceImagesMax: 4,
    referenceImagesRecommended: true,
    defaultSteps: 1000,
  },
  product: {
    subjectType: 'product',
    subjectLabel: 'Product / Object',
    engineId: 'flux-lora-fast-training',
    engineLabel: FAL_FAST_TRAINING_ENGINE_LABEL,
    engineDescription: 'Fast FLUX LoRA training for products and objects with Replicate fallback.',
    provider: 'fal',
    modelId: FAL_FAST_TRAINING_MODEL,
    minImages: 12,
    recommendedMinImages: 20,
    recommendedMaxImages: 40,
    maxImages: 40,
    referenceImagesMax: 6,
    referenceImagesRecommended: true,
    defaultSteps: 1000,
  },
  other: {
    subjectType: 'other',
    subjectLabel: 'Other',
    engineId: 'flux-lora-fast-training',
    engineLabel: FAL_FAST_TRAINING_ENGINE_LABEL,
    engineDescription: 'Fast FLUX LoRA training for custom subjects with Replicate fallback.',
    provider: 'fal',
    modelId: FAL_FAST_TRAINING_MODEL,
    minImages: 10,
    recommendedMinImages: 15,
    recommendedMaxImages: 30,
    maxImages: 30,
    referenceImagesMax: 4,
    referenceImagesRecommended: true,
    defaultSteps: 1000,
  },
};

const IMAGE_ENGINES: Record<Exclude<PersonaImageEngineId, 'auto'>, PersonaImageEngineOption> = {
  'flux-dev-lora': {
    id: 'flux-dev-lora',
    label: 'FLUX Dev LoRA',
    description: 'Creative generation from your trained persona for fresh scenes and compositions.',
    supportsReferenceImages: false,
    recommendedMode: 'creative',
  },
  'flux-kontext-lora': {
    id: 'flux-kontext-lora',
    label: 'FLUX Kontext LoRA',
    description: 'Best exact-mode engine when you want LoRA identity plus a guiding reference image.',
    supportsReferenceImages: true,
    recommendedMode: 'exact',
  },
  'flux-kontext-pro': {
    id: 'flux-kontext-pro',
    label: 'FLUX Kontext Pro',
    description: 'Reference-first editing when you want to transform an image while preserving the source.',
    supportsReferenceImages: true,
    recommendedMode: 'exact',
  },
  'flux-2-max': {
    id: 'flux-2-max',
    label: 'FLUX 2 Max',
    description: 'Best prompt-only fallback when no persona or LoRA is involved.',
    supportsReferenceImages: false,
    recommendedMode: 'creative',
  },
  'nano-banana': {
    id: 'nano-banana',
    label: 'Nano Banana',
    description: 'Google Gemini image model. Keeps product/character identity consistent across angles and scenes — no training needed. Great with your own reference photos.',
    supportsReferenceImages: true,
    recommendedMode: 'creative',
  },
  'nano-banana-2': {
    id: 'nano-banana-2',
    label: 'Nano Banana 2',
    description: 'Latest Gemini image model with up to 4K detail, sharper textures, and stronger prompt following. Best quality for product and brand visuals.',
    supportsReferenceImages: true,
    recommendedMode: 'creative',
  },
  'nano-banana-pro': {
    id: 'nano-banana-pro',
    label: 'Nano Banana Pro',
    description: 'Gemini 3 Pro Image — studio-grade reasoning model with the strongest character/identity consistency available. Ideal as the final refiner for a digital twin: keeps the exact face while rebuilding scene, lighting, and styling at up to 4K.',
    supportsReferenceImages: true,
    recommendedMode: 'creative',
  },
};

const IMAGE_ENGINE_ALIASES: Record<string, PersonaImageEngineId> = {
  auto: 'auto',
  creative: 'flux-dev-lora',
  'flux-dev-lora': 'flux-dev-lora',
  'flux dev lora': 'flux-dev-lora',
  'flux-kontext-lora': 'flux-kontext-lora',
  'flux kontext lora': 'flux-kontext-lora',
  'kontext-lora': 'flux-kontext-lora',
  'flux-kontext-pro': 'flux-kontext-pro',
  'flux kontext pro': 'flux-kontext-pro',
  kontext: 'flux-kontext-pro',
  'flux-2-max': 'flux-2-max',
  'flux 2 max': 'flux-2-max',
  'nano-banana': 'nano-banana',
  'nano banana': 'nano-banana',
  nanobanana: 'nano-banana',
  'gemini-2.5-flash-image': 'nano-banana',
  'nano-banana-2': 'nano-banana-2',
  'nano banana 2': 'nano-banana-2',
  nanobanana2: 'nano-banana-2',
  'gemini-3.1-flash-image': 'nano-banana-2',
  'nano-banana-pro': 'nano-banana-pro',
  'nano banana pro': 'nano-banana-pro',
  nanobananapro: 'nano-banana-pro',
  'gemini-3-pro-image': 'nano-banana-pro',
};

const MODE_ALIASES: Record<string, PersonaGenerationMode> = {
  creative: 'creative',
  exact: 'exact',
};

export const getPersonaTrainingProfile = (subjectType: unknown): PersonaTrainingProfile => {
  const normalized = normalizePersonaSubjectType(subjectType) || 'human';
  return TRAINING_PROFILES[normalized];
};

export const getPersonaImageEngineOptions = (hasPersona: boolean) => {
  const personaEngines: PersonaImageEngineOption[] = [
    IMAGE_ENGINES['flux-dev-lora'],
    IMAGE_ENGINES['flux-kontext-lora'],
    IMAGE_ENGINES['nano-banana-pro'],
    IMAGE_ENGINES['nano-banana-2'],
    IMAGE_ENGINES['nano-banana'],
  ];
  const genericEngines: PersonaImageEngineOption[] = [
    IMAGE_ENGINES['flux-2-max'],
    IMAGE_ENGINES['flux-kontext-pro'],
    IMAGE_ENGINES['nano-banana-pro'],
    IMAGE_ENGINES['nano-banana-2'],
    IMAGE_ENGINES['nano-banana'],
  ];
  return hasPersona ? personaEngines : genericEngines;
};

export const getPersonaImageEngineOption = (engineId: Exclude<PersonaImageEngineId, 'auto'>) =>
  IMAGE_ENGINES[engineId];

export const normalizePersonaImageEngine = (value: unknown): PersonaImageEngineId | undefined => {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return undefined;
  return IMAGE_ENGINE_ALIASES[raw];
};

export const normalizePersonaGenerationMode = (value: unknown): PersonaGenerationMode | undefined => {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return undefined;
  return MODE_ALIASES[raw];
};

export const resolvePersonaImageEngine = ({
  requestedEngine,
  hasPersona,
  hasReferenceImage,
  generationMode,
}: {
  requestedEngine?: unknown;
  hasPersona: boolean;
  hasReferenceImage: boolean;
  generationMode?: unknown;
}): Exclude<PersonaImageEngineId, 'auto'> => {
  const normalizedEngine = normalizePersonaImageEngine(requestedEngine);
  if (normalizedEngine && normalizedEngine !== 'auto') {
    // Nano Banana handles both prompt-only and reference-driven generation, with or without a persona.
    if (
      normalizedEngine === 'nano-banana'
      || normalizedEngine === 'nano-banana-2'
      || normalizedEngine === 'nano-banana-pro'
    ) {
      return normalizedEngine;
    }
    if (
      (normalizedEngine === 'flux-kontext-lora' || normalizedEngine === 'flux-kontext-pro')
      && !hasReferenceImage
    ) {
      return hasPersona ? 'flux-dev-lora' : 'flux-2-max';
    }
    if (normalizedEngine === 'flux-kontext-lora' && !hasPersona) {
      return hasReferenceImage ? 'flux-kontext-pro' : 'flux-2-max';
    }
    if (normalizedEngine === 'flux-dev-lora' && !hasPersona) {
      return hasReferenceImage ? 'flux-kontext-pro' : 'flux-2-max';
    }
    if (normalizedEngine === 'flux-kontext-pro' && hasPersona && hasReferenceImage) {
      return 'flux-kontext-lora';
    }
    return normalizedEngine;
  }

  const mode = normalizePersonaGenerationMode(generationMode) || 'creative';
  if (hasPersona) {
    return hasReferenceImage && mode === 'exact'
      ? 'flux-kontext-lora'
      : 'flux-dev-lora';
  }
  return hasReferenceImage ? 'flux-kontext-pro' : 'flux-2-max';
};

export const getTrainingEngineLabel = (value: unknown) => {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return 'Unknown trainer';
  if (raw.includes('flux-lora-portrait-trainer')) return 'FLUX LoRA Portrait Trainer';
  if (raw.includes('flux-lora-fast-training')) return 'FLUX LoRA Fast Training';
  if (raw.includes('flux-dev-lora-trainer')) return REPLICATE_FLUX_TRAINING_ENGINE_LABEL;
  return String(value);
};
