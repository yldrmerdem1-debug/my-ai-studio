type Counter = { count: number; resetAt: number };

export class AdmissionError extends Error {
  code: 'RATE_LIMITED' | 'CONCURRENCY_LIMIT';
  retryAfterMs: number;
  constructor(code: AdmissionError['code'], message: string, retryAfterMs: number) {
    super(message);
    this.name = 'AdmissionError';
    this.code = code;
    this.retryAfterMs = retryAfterMs;
  }
}

const minuteCounters = new Map<string, Counter>();
const runningByUser = new Map<string, number>();
let globalRunning = 0;

const MAX_PER_MINUTE = Math.max(1, Number(process.env.VIDEO_RATE_LIMIT_PER_MIN || 12));
const MAX_PER_USER_CONCURRENT = Math.max(1, Number(process.env.VIDEO_MAX_PER_USER_CONCURRENT || 2));
const MAX_GLOBAL_CONCURRENT = Math.max(1, Number(process.env.VIDEO_MAX_GLOBAL_CONCURRENT || 40));

const now = () => Date.now();

const touchCounter = (key: string): Counter => {
  const existing = minuteCounters.get(key);
  const t = now();
  if (!existing || existing.resetAt <= t) {
    const next = { count: 0, resetAt: t + 60_000 };
    minuteCounters.set(key, next);
    return next;
  }
  return existing;
};

const keyFor = (userId: string, ip: string) => `${userId || 'anon'}:${ip || 'unknown'}`;

export type AdmissionHandle = { release: () => void };

export function enterVideoAdmission(input: { userId?: string | null; ip?: string | null }): AdmissionHandle {
  const userId = String(input.userId || '').trim();
  const ip = String(input.ip || '').trim();
  const identity = keyFor(userId, ip);

  // Rate limit (per minute).
  const counter = touchCounter(identity);
  if (counter.count >= MAX_PER_MINUTE) {
    throw new AdmissionError('RATE_LIMITED', 'Too many requests, please retry shortly.', Math.max(1000, counter.resetAt - now()));
  }
  counter.count += 1;

  // Concurrency.
  const userRunning = runningByUser.get(identity) || 0;
  if (userRunning >= MAX_PER_USER_CONCURRENT) {
    throw new AdmissionError('CONCURRENCY_LIMIT', 'Too many concurrent video generations for this user.', 10_000);
  }
  if (globalRunning >= MAX_GLOBAL_CONCURRENT) {
    throw new AdmissionError('CONCURRENCY_LIMIT', 'System is busy, please retry shortly.', 10_000);
  }
  runningByUser.set(identity, userRunning + 1);
  globalRunning += 1;

  let released = false;
  return {
    release: () => {
      if (released) return;
      released = true;
      const cur = runningByUser.get(identity) || 0;
      if (cur <= 1) runningByUser.delete(identity);
      else runningByUser.set(identity, cur - 1);
      globalRunning = Math.max(0, globalRunning - 1);
    },
  };
}
