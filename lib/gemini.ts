import { GoogleGenerativeAI } from '@google/generative-ai';

export const GEMINI_MODEL_ID = process.env.GEMINI_MODEL_ID || 'gemini-3-pro-preview';

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
let cachedModelId: string | null = null;
let cachedAt = 0;

export const getGeminiModelId = async (apiKey: string, preferred: string) => {
  const now = Date.now();
  if (cachedModelId && now - cachedAt < MODEL_CACHE_TTL_MS) {
    return cachedModelId;
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
    .map(model => model.name.replace(/^models\//, ''));

  if (available.includes(preferred)) {
    cachedModelId = preferred;
    cachedAt = now;
    return preferred;
  }

  const fallbackOrder = [
    'gemini-3-pro-preview',
    'gemini-3.0-pro-preview-02-05',
    'gemini-3-pro',
    'gemini-3-flash',
    'gemini-2.5-flash',
    'gemini-1.5-flash',
    'gemini-1.5-pro',
    'gemini-1.0-pro',
  ];
  const fallback = fallbackOrder.find(modelId => available.includes(modelId));
  if (fallback) {
    cachedModelId = fallback;
    cachedAt = now;
    return fallback;
  }

  if (available.length > 0) {
    cachedModelId = available[0];
    cachedAt = now;
    return available[0];
  }

  throw new Error('No Gemini models available for generateContent');
};

export const createGeminiModel = (apiKey: string, modelId: string) => {
  const genAI = new GoogleGenerativeAI(apiKey.trim());
  return genAI.getGenerativeModel(
    { model: modelId, generationConfig: { temperature: 0.7 } },
    { apiVersion: 'v1beta' } as any
  );
};
