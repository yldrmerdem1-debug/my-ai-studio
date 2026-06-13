import { GoogleGenerativeAI } from '@google/generative-ai';

export const GEMINI_MODEL_ID = process.env.GEMINI_MODEL_ID || 'gemini-2.5-flash';

const DEPRECATED_GEMINI_MODELS = new Set([
  'gemini-3-pro-preview',
  'gemini-3.0-pro-preview-02-05',
]);

export const resolveGeminiModelId = (raw: string | undefined, fallback: string) => {
  const value = (raw ?? '').trim() || fallback;
  if (value.endsWith('-latest')) {
    return value.replace(/-latest$/, '');
  }
  if (value.startsWith('gemini-')) {
    return value;
  }
  return value;
};

type GeminiModelListResponse = {
  models?: Array<{
    name: string;
    supportedGenerationMethods?: string[];
  }>;
};

const MODEL_CACHE_TTL_MS = 10 * 60 * 1000;
const modelCache = new Map<string, { modelId: string; cachedAt: number }>();

export const getGeminiModelId = async (apiKey: string, preferred: string) => {
  const now = Date.now();
  const cacheKey = preferred.trim();
  const cached = modelCache.get(cacheKey);
  if (cached && now - cached.cachedAt < MODEL_CACHE_TTL_MS) {
    return cached.modelId;
  }

  const trimmedKey = apiKey.trim();
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${trimmedKey}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Gemini model list failed with status ${response.status}`);
  }

  const data = (await response.json()) as GeminiModelListResponse;
  const models = Array.isArray(data.models) ? data.models : [];
  const available = models
    .filter(model => model.supportedGenerationMethods?.includes('generateContent'))
    .map(model => model.name.replace(/^models\//, ''))
    .filter(modelId => !DEPRECATED_GEMINI_MODELS.has(modelId));

  const normalizedPreferred = DEPRECATED_GEMINI_MODELS.has(preferred)
    ? ''
    : preferred;

  if (normalizedPreferred && available.includes(normalizedPreferred)) {
    modelCache.set(cacheKey, { modelId: normalizedPreferred, cachedAt: now });
    return normalizedPreferred;
  }

  const fallbackOrder = [
    'gemini-2.5-flash',
    'gemini-2.5-pro',
    'gemini-2.0-flash',
    'gemini-1.5-flash',
    'gemini-3-flash',
    'gemini-3-pro',
    'gemini-1.5-pro',
    'gemini-1.0-pro',
  ];
  const fallback = fallbackOrder.find(modelId => available.includes(modelId));
  if (fallback) {
    modelCache.set(cacheKey, { modelId: fallback, cachedAt: now });
    return fallback;
  }

  if (available.length > 0) {
    modelCache.set(cacheKey, { modelId: available[0], cachedAt: now });
    return available[0];
  }

  throw new Error('No Gemini models available for generateContent');
};

export const createGeminiModel = (
  apiKey: string,
  modelId: string,
  generationConfig?: Record<string, unknown>
) => {
  const genAI = new GoogleGenerativeAI(apiKey.trim());
  return genAI.getGenerativeModel(
    {
      model: modelId,
      generationConfig: {
        temperature: 0.7,
        ...(generationConfig || {}),
      },
    },
    { apiVersion: 'v1beta' } as any
  );
};
