/**
 * Async video job store.
 *
 * Priority:
 * 1) Supabase table `video_jobs` (durable, multi-instance safe)
 * 2) In-memory fallback (dev/single-instance)
 */
import { getSupabaseAdminClient } from '@/lib/supabase/admin';

export type JobStatus = 'pending' | 'succeeded' | 'failed';

export type AsyncJobState = {
  status: JobStatus;
  result?: Record<string, unknown>;
  error?: string;
  userId?: string;
  createdAt?: string;
  updatedAt?: string;
};

const memoryStore = new Map<string, AsyncJobState>();

const toMemory = (state: AsyncJobState): AsyncJobState => ({
  ...state,
  createdAt: state.createdAt || new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

export async function setJob(jobId: string, state: AsyncJobState): Promise<void> {
  const withTimestamps = toMemory(state);
  memoryStore.set(jobId, withTimestamps);

  const { client } = getSupabaseAdminClient();
  if (!client) return;

  try {
    const payload = {
      id: jobId,
      status: withTimestamps.status,
      result: withTimestamps.result ?? null,
      error: withTimestamps.error ?? null,
      user_id: withTimestamps.userId ?? null,
      created_at: withTimestamps.createdAt ?? new Date().toISOString(),
      updated_at: withTimestamps.updatedAt ?? new Date().toISOString(),
    };
    const { error } = await client.from('video_jobs').upsert(payload);
    if (error) {
      // Keep app functional even if table is missing.
      console.warn('[async-video-jobs] Supabase upsert failed, using memory fallback:', error.message);
    }
  } catch (error: any) {
    console.warn('[async-video-jobs] Durable store unavailable, using memory fallback:', error?.message || error);
  }
}

export async function getJob(jobId: string): Promise<AsyncJobState | undefined> {
  const fromMemory = memoryStore.get(jobId);

  const { client } = getSupabaseAdminClient();
  if (!client) return fromMemory;

  try {
    const { data, error } = await client
      .from('video_jobs')
      .select('status, result, error, user_id, created_at, updated_at')
      .eq('id', jobId)
      .maybeSingle();
    if (error) {
      console.warn('[async-video-jobs] Supabase read failed, using memory fallback:', error.message);
      return fromMemory;
    }
    if (!data) return fromMemory;
    return {
      status: data.status as JobStatus,
      result: (data.result as Record<string, unknown> | null) ?? undefined,
      error: data.error ?? undefined,
      userId: data.user_id ?? undefined,
      createdAt: data.created_at ?? undefined,
      updatedAt: data.updated_at ?? undefined,
    };
  } catch (error: any) {
    console.warn('[async-video-jobs] Durable read unavailable, using memory fallback:', error?.message || error);
    return fromMemory;
  }
}
