import type Replicate from 'replicate';

export const parseRetryAfterMs = (error: any): number => {
  const retryAfter = error?.headers?.['retry-after'] || error?.response?.headers?.['retry-after'];
  if (retryAfter) {
    const seconds = Number.parseInt(String(retryAfter), 10);
    if (!Number.isNaN(seconds)) return seconds * 1000;
  }
  return 5000;
};

const isRetryableReplicateError = (error: any) => {
  const status = error?.status || error?.response?.status;
  const message = String(error?.message || '');
  const lower = message.toLowerCase();
  const isRateLimit = status === 429 || message.includes('429') || lower.includes('too many requests');
  const isQueueFull =
    lower.includes('queue is full') ||
    lower.includes('try again later') ||
    (lower.includes('queue') && lower.includes('full'));
  return { isRateLimit, isQueueFull, isRetryable: isRateLimit || isQueueFull };
};

export const runReplicateModelWithRetry = async (
  replicate: Replicate,
  model: string,
  input: Record<string, any>,
  options?: {
    maxAttempts?: number;
    onRetry?: (context: { attempt: number; maxAttempts: number; delayMs: number; isQueueFull: boolean }) => void;
  }
) => {
  const maxAttempts = Math.max(1, options?.maxAttempts ?? 5);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await replicate.run(model as any, { input });
    } catch (error: any) {
      const retryState = isRetryableReplicateError(error);
      if (!retryState.isRetryable || attempt >= maxAttempts) {
        throw error;
      }

      const delayMs = retryState.isQueueFull
        ? Math.max(20000, parseRetryAfterMs(error))
        : parseRetryAfterMs(error);
      options?.onRetry?.({
        attempt,
        maxAttempts,
        delayMs,
        isQueueFull: retryState.isQueueFull,
      });
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw new Error('Replicate retry attempts exhausted.');
};
