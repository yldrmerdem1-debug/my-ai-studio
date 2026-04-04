export enum ModelKey {
  /**
   * Kling 3.x "Pro" concept (latest quality tier).
   */
  KLING_PRO = 'KLING_PRO',
  /**
   * Kling "ProTurbo" concept (speed/price optimized).
   */
  KLING_TURBO = 'KLING_TURBO',
  /**
   * Kling 2.6 "standard" concept (stable baseline).
   */
  KLING_STANDARD = 'KLING_STANDARD',
  /**
   * Persona (LoRA) training.
   */
  PERSONA_TRAINING = 'PERSONA_TRAINING',
  /**
   * Persona (LoRA) inference (apply LoRA for image generation).
   */
  PERSONA_INFERENCE = 'PERSONA_INFERENCE',
}

export type Provider = 'replicate' | 'fal';

export type ReplicateEndpointRef = {
  /**
   * Replicate model identifier in the form "owner/name".
   * Example: "kwaivgi/kling-v2.6"
   */
  model: `${string}/${string}`;
  /**
   * Optional model version hash. When null/undefined, callers should use the provider default/latest.
   */
  version?: string | null;
};

export type FalEndpointRef = {
  /**
   * fal.ai model identifier (the part after https://fal.run/).
   * Example: "fal-ai/kling-video/v2.6/pro/image-to-video"
   */
  model: string;
};

export type ModelKind = 'video' | 'persona_training' | 'persona_inference';

export type ModelProviderMapping = {
  replicate: ReplicateEndpointRef;
  fal: FalEndpointRef;
};

export type ModelConfig = ModelProviderMapping & {
  kind: ModelKind;
  /**
   * Human-friendly description for UI/debugging.
   */
  label: string;
};

/**
 * Central model registry for fallback routing (Replicate ↔ fal.ai).
 *
 * Notes:
 * - Replicate `version` is optional. If omitted/null, use the provider default/latest version.
 * - fal.ai endpoints are referenced by their model id (as used by `@fal-ai/client`).
 */
export const MODELS = {
  [ModelKey.KLING_PRO]: {
    kind: 'video',
    label: 'Kling 3.x Pro (latest)',
    replicate: {
      // Replicate model page: https://replicate.com/kwaivgi/kling-v3-video
      model: 'kwaivgi/kling-v3-video',
      version: null,
    },
    fal: {
      // fal.ai API page: https://fal.ai/models/fal-ai/kling-video/v3/pro/image-to-video/api
      model: 'fal-ai/kling-video/v3/pro/image-to-video',
    },
  },

  [ModelKey.KLING_TURBO]: {
    kind: 'video',
    label: 'Kling 2.5 Turbo Pro (ProTurbo)',
    replicate: {
      // Replicate model page: https://replicate.com/kwaivgi/kling-v2.5-turbo-pro
      model: 'kwaivgi/kling-v2.5-turbo-pro',
      // Example version observed on Replicate (may change as the publisher updates).
      version: '939cd1851c5b112f284681b57ee9b0f36d0f913ba97de5845a7eef92d52837df',
    },
    fal: {
      // fal.ai API page: https://fal.ai/models/fal-ai/kling-video/v2.5-turbo/pro/image-to-video/api
      model: 'fal-ai/kling-video/v2.5-turbo/pro/image-to-video',
    },
  },

  [ModelKey.KLING_STANDARD]: {
    kind: 'video',
    label: 'Kling 2.6 (baseline)',
    replicate: {
      // Replicate model page: https://replicate.com/kwaivgi/kling-v2.6
      model: 'kwaivgi/kling-v2.6',
      version: null,
    },
    fal: {
      // fal.ai API page: https://fal.ai/models/fal-ai/kling-video/v2.6/pro/image-to-video/api
      model: 'fal-ai/kling-video/v2.6/pro/image-to-video',
    },
  },

  [ModelKey.PERSONA_TRAINING]: {
    kind: 'persona_training',
    label: 'Flux LoRA training (persona)',
    replicate: {
      model: 'ostris/flux-dev-lora-trainer',
      version: null,
    },
    fal: {
      model: 'fal-ai/flux-lora-portrait-trainer',
    },
  },

  [ModelKey.PERSONA_INFERENCE]: {
    kind: 'persona_inference',
    label: 'Flux LoRA inference (persona)',
    replicate: {
      model: 'black-forest-labs/flux-dev-lora',
      version: null,
    },
    fal: {
      model: 'fal-ai/flux-lora',
    },
  },
} as const satisfies Record<ModelKey, ModelConfig>;

export type ModelKeyType = keyof typeof MODELS;

export const getModelConfig = (key: ModelKey): ModelConfig => MODELS[key];

