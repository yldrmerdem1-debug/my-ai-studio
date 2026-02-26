type XaiVideoStatus = 'pending' | 'done' | 'expired';

export class XaiVideoError extends Error {
  code:
    | 'XAI_API_KEY_MISSING'
    | 'XAI_REQUEST_FAILED'
    | 'XAI_INVALID_RESPONSE'
    | 'XAI_EXPIRED'
    | 'XAI_TIMEOUT';
  status?: number;

  constructor(code: XaiVideoError['code'], message: string, status?: number, cause?: unknown) {
    super(message);
    this.name = 'XaiVideoError';
    this.code = code;
    this.status = status;
    (this as any).cause = cause;
  }
}

export type GenerateXaiVideoParams = {
  prompt: string;
  imageUrl?: string | null; // public URL or data URI
  duration?: number; // seconds, 1-15
  aspectRatio?: string; // e.g. "16:9"
  resolution?: '480p' | '720p' | string;
  model?: string; // default: grok-imagine-video
  timeoutMs?: number; // default: 10 minutes
  pollIntervalMs?: number; // default: 2 seconds
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const getXaiKey = () =>
  String(
    process.env.XAI_API_KEY
    || process.env.XAI_KEY
    || process.env.XAI_TOKEN
    || ''
  ).trim();

const getBaseUrl = () => {
  const raw = String(process.env.XAI_API_BASE_URL || 'https://api.x.ai/v1').trim();
  return raw.replace(/\/+$/, '');
};

async function xaiFetchJson<T>(
  url: string,
  init: RequestInit & { expectedStatus?: number | number[] } = {}
): Promise<T> {
  const key = getXaiKey();
  if (!key) {
    throw new XaiVideoError(
      'XAI_API_KEY_MISSING',
      'XAI_API_KEY is not configured. Set process.env.XAI_API_KEY in .env.local (do not commit it).'
    );
  }

  const expected = init.expectedStatus;
  const expectedSet = Array.isArray(expected) ? expected : typeof expected === 'number' ? [expected] : null;

  const res = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
      ...(init.headers || {}),
    },
  });

  const text = await res.text().catch(() => '');
  const status = res.status;

  if (!res.ok || (expectedSet && !expectedSet.includes(status))) {
    const snippet = text.slice(0, 500);
    throw new XaiVideoError(
      'XAI_REQUEST_FAILED',
      `xAI request failed (${status}) for ${url}. Body: ${snippet}`,
      status
    );
  }

  try {
    return (text ? JSON.parse(text) : {}) as T;
  } catch (e) {
    throw new XaiVideoError(
      'XAI_INVALID_RESPONSE',
      `xAI returned non-JSON response (${status}) for ${url}. Body: ${text.slice(0, 300)}`,
      status,
      e
    );
  }
}

async function startVideoGeneration(params: GenerateXaiVideoParams): Promise<{ request_id?: string; video?: { url?: string } }> {
  const base = getBaseUrl();
  const model = (params.model || process.env.XAI_VIDEO_MODEL || 'grok-imagine-video').trim() || 'grok-imagine-video';

  const prompt = String(params.prompt || '').trim();
  if (!prompt) {
    throw new XaiVideoError('XAI_INVALID_RESPONSE', 'xAI video generation requires a non-empty prompt.');
  }

  const durationRaw = typeof params.duration === 'number' ? params.duration : undefined;
  const duration = durationRaw ? Math.max(1, Math.min(15, Math.round(durationRaw))) : undefined;

  const aspect_ratio = (params.aspectRatio || process.env.XAI_VIDEO_ASPECT_RATIO || '16:9').trim();
  const resolution = (params.resolution || process.env.XAI_VIDEO_RESOLUTION || '480p') as string;

  const imageUrl = String(params.imageUrl || '').trim();

  const body: Record<string, any> = {
    model,
    prompt,
  };
  if (duration) body.duration = duration;
  if (aspect_ratio) body.aspect_ratio = aspect_ratio;
  if (resolution) body.resolution = resolution;
  if (imageUrl) body.image = { url: imageUrl };

  return await xaiFetchJson(`${base}/videos/generations`, {
    method: 'POST',
    body: JSON.stringify(body),
    expectedStatus: [200, 201, 202],
  });
}

async function getVideoStatus(requestId: string): Promise<{ status?: XaiVideoStatus; video?: { url?: string; duration?: number; respect_moderation?: boolean }; model?: string }> {
  const base = getBaseUrl();
  return await xaiFetchJson(`${base}/videos/${encodeURIComponent(requestId)}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
    // xAI may return 202 with { status: "pending" } while the video is still generating.
    expectedStatus: [200, 202],
  });
}

export async function generateXaiVideo(params: GenerateXaiVideoParams): Promise<{ url: string; requestId: string; model: string }> {
  const timeoutMs = typeof params.timeoutMs === 'number' ? params.timeoutMs : 10 * 60 * 1000;
  const pollIntervalMs = typeof params.pollIntervalMs === 'number' ? params.pollIntervalMs : 2000;

  const started = await startVideoGeneration(params);
  const directUrl = String(started?.video?.url || '').trim();
  if (directUrl) {
    return {
      url: directUrl,
      requestId: String(started?.request_id || 'direct').trim() || 'direct',
      model: (params.model || process.env.XAI_VIDEO_MODEL || 'grok-imagine-video').trim() || 'grok-imagine-video',
    };
  }

  const requestId = String((started as any)?.request_id || '').trim();
  if (!requestId) {
    throw new XaiVideoError('XAI_INVALID_RESPONSE', `xAI did not return request_id. Response keys: ${Object.keys(started || {}).join(', ') || '(none)'}`);
  }

  const startedAt = Date.now();
  while (true) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new XaiVideoError('XAI_TIMEOUT', `xAI video generation timed out after ${Math.round(timeoutMs / 1000)}s. request_id=${requestId}`);
    }

    const status = await getVideoStatus(requestId);
    // Some xAI responses return 200 with a ready `video.url` but no `status` field.
    const readyUrl = String(status?.video?.url || '').trim();
    if (readyUrl) {
      return { url: readyUrl, requestId, model: String(status?.model || params.model || 'grok-imagine-video') };
    }
    const st = String(status?.status || '').toLowerCase() as XaiVideoStatus;
    if (st === 'done') {
      const url = String(status?.video?.url || '').trim();
      if (!url) {
        throw new XaiVideoError('XAI_INVALID_RESPONSE', `xAI status=done but missing video.url. request_id=${requestId}`);
      }
      return { url, requestId, model: String(status?.model || params.model || 'grok-imagine-video') };
    }
    if (st === 'expired') {
      throw new XaiVideoError('XAI_EXPIRED', `xAI request expired. request_id=${requestId}`);
    }

    // pending or unknown
    await sleep(pollIntervalMs);
  }
}

