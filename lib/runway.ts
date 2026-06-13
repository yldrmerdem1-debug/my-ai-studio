const RUNWAY_API_VERSION = '2024-11-06' as const;

export type RunwayI2VModel =
  | 'gen4.5'
  | 'gen4_turbo'
  | 'gen3a_turbo'
  | 'veo3'
  | 'veo3.1'
  | 'veo3.1_fast';

export type RunwayI2VRatio =
  | '1280:720'
  | '720:1280'
  | '1104:832'
  | '960:960'
  | '832:1104'
  | '1584:672';

export type RunwayTaskStatus = 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';

export type CreateRunwayImageToVideoTaskInput = {
  model: RunwayI2VModel;
  promptImage: string;
  promptText: string;
  ratio?: RunwayI2VRatio;
  duration?: number;
  seed?: number;
};

export type RunwayTask = {
  id: string;
  status?: string;
  createdAt?: string;
  output?: unknown;
  error?: unknown;
};

const getRunwaySecret = () => {
  const secret = String(
    process.env.RUNWAY_API_KEY
      || process.env.RUNWAYML_API_SECRET
      || process.env.RUNWAY_API_SECRET
      || ''
  ).trim();
  if (!secret) {
    throw new Error('RUNWAY_API_KEY (or RUNWAYML_API_SECRET) is not configured.');
  }
  return secret;
};

const getRunwayBaseUrl = () => {
  const raw = String(process.env.RUNWAY_API_BASE_URL || 'https://api.dev.runwayml.com').trim();
  return raw.replace(/\/+$/, '');
};

const fetchWithTimeout = async (url: string, init: RequestInit, timeoutMs: number) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
};

const parseJsonSafe = async (res: Response) => {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return text || null;
  }
};

const RUNWAY_PROMPT_TEXT_MAX_CHARS = 1000;

export const normalizeRunwayPromptText = (value: string): string => {
  const collapsed = String(value || '').replace(/\s+/g, ' ').trim();
  if (collapsed.length <= RUNWAY_PROMPT_TEXT_MAX_CHARS) {
    return collapsed;
  }

  const hardLimit = RUNWAY_PROMPT_TEXT_MAX_CHARS - 3;
  const truncated = collapsed.slice(0, hardLimit);
  const preferredCut =
    Math.max(
      truncated.lastIndexOf('. '),
      truncated.lastIndexOf(', '),
      truncated.lastIndexOf('; '),
      truncated.lastIndexOf(': '),
      truncated.lastIndexOf(' ')
    );
  const cutIndex = preferredCut >= Math.floor(hardLimit * 0.7) ? preferredCut : hardLimit;
  return `${truncated.slice(0, cutIndex).trim()}...`;
};

export const normalizeRunwayTaskStatus = (raw: unknown): RunwayTaskStatus => {
  const st = String(raw || '').trim().toUpperCase();
  if (st === 'SUCCEEDED' || st === 'SUCCESS') return 'SUCCEEDED';
  if (st === 'RUNNING' || st === 'IN_PROGRESS' || st === 'PROCESSING') return 'RUNNING';
  if (st === 'PENDING' || st === 'CREATED' || st === 'QUEUED' || st === 'STARTING') return 'PENDING';
  return 'FAILED';
};

export const extractFirstOutputUrl = (output: unknown): string | null => {
  if (!output) return null;
  if (typeof output === 'string') return output.startsWith('http') ? output : null;
  if (Array.isArray(output)) {
    for (const item of output) {
      const found = extractFirstOutputUrl(item);
      if (found) return found;
    }
    return null;
  }
  if (typeof output === 'object') {
    for (const value of Object.values(output as Record<string, unknown>)) {
      const found = extractFirstOutputUrl(value);
      if (found) return found;
    }
  }
  return null;
};

export async function createRunwayImageToVideoTask(input: CreateRunwayImageToVideoTaskInput): Promise<{ id: string }> {
  const secret = getRunwaySecret();
  const baseUrl = getRunwayBaseUrl();
  const promptText = normalizeRunwayPromptText(input.promptText);

  const body = {
    model: input.model,
    promptImage: input.promptImage,
    promptText,
    ratio: input.ratio || '1280:720',
    duration: Math.max(2, Math.min(10, Math.round(Number(input.duration ?? 5)))),
    ...(Number.isFinite(input.seed) ? { seed: Math.max(0, Math.floor(Number(input.seed))) } : {}),
  };

  const res = await fetchWithTimeout(`${baseUrl}/v1/image_to_video`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${secret}`,
      'X-Runway-Version': RUNWAY_API_VERSION,
    },
    body: JSON.stringify(body),
  }, 15000);

  const payload = await parseJsonSafe(res);
  if (!res.ok) {
    throw new Error(`Runway create task failed: ${res.status} ${typeof payload === 'string' ? payload : JSON.stringify(payload)}`);
  }
  const id = String((payload as any)?.id || (payload as any)?.task_id || '').trim();
  if (!id) {
    throw new Error(`Runway create task returned no id. Payload: ${typeof payload === 'string' ? payload : JSON.stringify(payload)}`);
  }
  return { id };
}

export async function getRunwayTask(taskId: string): Promise<RunwayTask> {
  const secret = getRunwaySecret();
  const baseUrl = getRunwayBaseUrl();
  const id = String(taskId || '').trim();
  if (!id) throw new Error('taskId is required.');

  const res = await fetchWithTimeout(`${baseUrl}/v1/tasks/${encodeURIComponent(id)}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${secret}`,
      'X-Runway-Version': RUNWAY_API_VERSION,
    },
  }, 15000);

  const payload = await parseJsonSafe(res);
  if (!res.ok) {
    throw new Error(`Runway task status failed: ${res.status} ${typeof payload === 'string' ? payload : JSON.stringify(payload)}`);
  }
  return payload as RunwayTask;
}

