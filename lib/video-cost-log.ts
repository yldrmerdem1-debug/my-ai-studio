/**
 * Video provider cost/usage logging for Kling, Grok, Veo.
 * Log one line per usage; grep [VIDEO_COST] or read data/video-usage.jsonl for monthly review.
 */

import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

export type VideoCostEntry = {
  ts: string;
  engine: string;
  mode?: string;
  [key: string]: unknown;
};

const LOG_DIR = path.join(process.cwd(), 'data');
const LOG_FILE = path.join(LOG_DIR, 'video-usage.jsonl');

export function logVideoCost(engine: string, extra: Record<string, unknown> = {}): void {
  const entry: VideoCostEntry = {
    ts: new Date().toISOString(),
    engine,
    ...extra,
  };
  const line = JSON.stringify(entry) + '\n';
  console.log('[VIDEO_COST]', line.trim());
  mkdir(LOG_DIR, { recursive: true })
    .then(() => appendFile(LOG_FILE, line))
    .catch((err) => console.error('[VIDEO_COST] write failed:', err));
}
