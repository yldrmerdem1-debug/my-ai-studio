/**
 * In-memory store for async video generation jobs (job_xxx).
 * Status endpoint reads from here when id starts with job_
 */

export type JobStatus = 'pending' | 'succeeded' | 'failed';

export type AsyncJobState = {
  status: JobStatus;
  result?: Record<string, unknown>;
  error?: string;
};

const store = new Map<string, AsyncJobState>();

export function setJob(jobId: string, state: AsyncJobState): void {
  store.set(jobId, state);
}

export function getJob(jobId: string): AsyncJobState | undefined {
  return store.get(jobId);
}
