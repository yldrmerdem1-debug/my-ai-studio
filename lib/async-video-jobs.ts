/**
 * Async video job store.
 *
 * Priority:
 * 1) In-memory (fast path within a single dev-server process)
 * 2) Local file `data/video-jobs.json` (survives Next.js HMR / dev reloads)
 * 3) Supabase table `video_jobs` (durable, multi-instance / production)
 */
import fs from 'fs/promises';
import path from 'path';
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
const JOBS_FILE_PATH = path.join(process.cwd(), 'data', 'video-jobs.json');
const JOB_TTL_MS = 24 * 60 * 60 * 1000;
/** When Supabase has no `video_jobs` table, skip remote calls entirely (local file is enough). */
let supabaseVideoJobsEnabled: boolean | null = null;

type FileJobStore = Record<string, AsyncJobState>;

const isMissingVideoJobsTable = (message: string) => {
  const lower = String(message || '').toLowerCase();
  return lower.includes('video_jobs')
    && (
      lower.includes('does not exist')
      || lower.includes('could not find the table')
      || lower.includes('schema cache')
    );
};

const shouldSkipSupabase = () => supabaseVideoJobsEnabled === false;

const toMemory = (state: AsyncJobState): AsyncJobState => ({
  ...state,
  createdAt: state.createdAt || new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

const parseTimestamp = (value?: string) => {
  if (!value) return 0;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? 0 : ms;
};

const pruneExpiredJobs = (store: FileJobStore): FileJobStore => {
  const now = Date.now();
  const next: FileJobStore = {};
  for (const [jobId, state] of Object.entries(store)) {
    const anchor = parseTimestamp(state.updatedAt || state.createdAt);
    if (!anchor || now - anchor <= JOB_TTL_MS) {
      next[jobId] = state;
    }
  }
  return next;
};

async function ensureDataDir() {
  const dataDir = path.join(process.cwd(), 'data');
  try {
    await fs.access(dataDir);
  } catch {
    await fs.mkdir(dataDir, { recursive: true });
  }
}

async function readFileStore(): Promise<FileJobStore> {
  try {
    const raw = await fs.readFile(JOBS_FILE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return pruneExpiredJobs(parsed as FileJobStore);
  } catch {
    return {};
  }
}

async function writeFileStore(store: FileJobStore): Promise<void> {
  try {
    await ensureDataDir();
    const pruned = pruneExpiredJobs(store);
    await fs.writeFile(JOBS_FILE_PATH, `${JSON.stringify(pruned, null, 2)}\n`, 'utf8');
  } catch (error: any) {
    console.warn('[async-video-jobs] Local file write failed:', error?.message || error);
  }
}

async function persistFileJob(jobId: string, state: AsyncJobState): Promise<void> {
  const store = await readFileStore();
  store[jobId] = state;
  await writeFileStore(store);
}

async function readFileJob(jobId: string): Promise<AsyncJobState | undefined> {
  const store = await readFileStore();
  return store[jobId];
}

export async function setJob(jobId: string, state: AsyncJobState): Promise<void> {
  const withTimestamps = toMemory(state);
  memoryStore.set(jobId, withTimestamps);
  await persistFileJob(jobId, withTimestamps);

  const { client } = getSupabaseAdminClient();
  if (!client || shouldSkipSupabase()) return;

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
      if (isMissingVideoJobsTable(error.message)) {
        supabaseVideoJobsEnabled = false;
        return;
      }
      console.warn('[async-video-jobs] Supabase upsert failed:', error.message);
    } else {
      supabaseVideoJobsEnabled = true;
    }
  } catch (error: any) {
    const message = String(error?.message || error || '');
    if (isMissingVideoJobsTable(message)) {
      supabaseVideoJobsEnabled = false;
      return;
    }
    console.warn('[async-video-jobs] Supabase upsert error:', message);
  }
}

export async function getJob(jobId: string): Promise<AsyncJobState | undefined> {
  const fromMemory = memoryStore.get(jobId);
  const fromFile = await readFileJob(jobId);

  const { client } = getSupabaseAdminClient();
  if (!client || shouldSkipSupabase()) {
    return fromMemory || fromFile;
  }

  try {
    const { data, error } = await client
      .from('video_jobs')
      .select('status, result, error, user_id, created_at, updated_at')
      .eq('id', jobId)
      .maybeSingle();
    if (error) {
      if (isMissingVideoJobsTable(error.message)) {
        supabaseVideoJobsEnabled = false;
        return fromMemory || fromFile;
      }
      console.warn('[async-video-jobs] Supabase read failed:', error.message);
      return fromMemory || fromFile;
    }
    if (!data) {
      return fromMemory || fromFile;
    }
    supabaseVideoJobsEnabled = true;
    const fromSupabase: AsyncJobState = {
      status: data.status as JobStatus,
      result: (data.result as Record<string, unknown> | null) ?? undefined,
      error: data.error ?? undefined,
      userId: data.user_id ?? undefined,
      createdAt: data.created_at ?? undefined,
      updatedAt: data.updated_at ?? undefined,
    };
    memoryStore.set(jobId, fromSupabase);
    return fromSupabase;
  } catch (error: any) {
    const message = String(error?.message || error || '');
    if (isMissingVideoJobsTable(message)) {
      supabaseVideoJobsEnabled = false;
      return fromMemory || fromFile;
    }
    console.warn('[async-video-jobs] Supabase read error:', message);
    return fromMemory || fromFile;
  }
}
