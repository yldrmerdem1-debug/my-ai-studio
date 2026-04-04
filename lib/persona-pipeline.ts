import { normalizePersonaSubjectType, type PersonaSubjectType } from '@/lib/persona-subject';

export type PersonaTrainingProvider = 'fal' | 'replicate';

export type PersonaTrainingEngineId =
  | 'flux-lora-portrait-trainer'
  | 'flux-dev-lora-trainer';

export type PersonaImageEngineId =
  | 'auto'
  | 'flux-dev-lora'
  | 'flux-kontext-lora'
  | 'flux-kontext-pro'
  | 'flux-2-max';

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
export const REPLICATE_FLUX_TRAINING_MODEL = 'ostris/flux-dev-lora-trainer';
export const REPLICATE_FLUX_TRAINING_ENGINE_LABEL = 'Replicate FLUX Dev LoRA Trainer';

const TRAINING_PROFILES: Record<PersonaSubjectType, PersonaTrainingProfile> = {
  human: {
    subjectType: 'human',
    subjectLabel: 'Human',
    engineId: 'flux-lora-portrait-trainer',
    engineLabel: FAL_PORTRAIT_TRAINING_ENGINE_LABEL,
    engineDescription: 'Best identity retention for real people and close-up portrait work.',
    provider: 'fal',
    modelId: FAL_PORTRAIT_TRAINING_MODEL,
    minImages: 10,
    recommendedMinImages: 15,
    recommendedMaxImages: 25,
    maxImages: 25,
    referenceImagesMax: 4,
    referenceImagesRecommended: true,
    defaultSteps: 2200,
  },
  animal: {
    subjectType: 'animal',
    subjectLabel: 'Animal',
    engineId: 'flux-dev-lora-trainer',
    engineLabel: REPLICATE_FLUX_TRAINING_ENGINE_LABEL,
    engineDescription: 'Quality-first FLUX trainer for animals when identity fidelity matters more than speed.',
    provider: 'replicate',
    modelId: REPLICATE_FLUX_TRAINING_MODEL,
    minImages: 12,
    recommendedMinImages: 18,
    recommendedMaxImages: 30,
    maxImages: 30,
    referenceImagesMax: 4,
    referenceImagesRecommended: true,
    defaultSteps: 1400,
  },
  product: {
    subjectType: 'product',
    subjectLabel: 'Product / Object',
    engineId: 'flux-dev-lora-trainer',
    engineLabel: REPLICATE_FLUX_TRAINING_ENGINE_LABEL,
    engineDescription: 'Quality-first FLUX trainer for products, packaging, and objects when exact detail matters most.',
    provider: 'replicate',
    modelId: REPLICATE_FLUX_TRAINING_MODEL,
    minImages: 12,
    recommendedMinImages: 20,
    recommendedMaxImages: 40,
    maxImages: 40,
    referenceImagesMax: 6,
    referenceImagesRecommended: true,
    defaultSteps: 1600,
  },
  other: {
    subjectType: 'other',
    subjectLabel: 'Other',
    engineId: 'flux-dev-lora-trainer',
    engineLabel: REPLICATE_FLUX_TRAINING_ENGINE_LABEL,
    engineDescription: 'Quality-first FLUX trainer for non-standard subjects when consistency matters more than speed.',
    provider: 'replicate',
    modelId: REPLICATE_FLUX_TRAINING_MODEL,
    minImages: 10,
    recommendedMinImages: 15,
    recommendedMaxImages: 30,
    maxImages: 30,
    referenceImagesMax: 4,
    referenceImagesRecommended: true,
    defaultSteps: 1400,
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
  ];
  const genericEngines: PersonaImageEngineOption[] = [
    IMAGE_ENGINES['flux-2-max'],
    IMAGE_ENGINES['flux-kontext-pro'],
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
