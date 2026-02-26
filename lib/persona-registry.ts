import fs from 'fs/promises';
import path from 'path';

export type PersonaTrainingStatus = 'training' | 'completed' | 'failed';
export type PersonaStatus = 'none' | 'training' | 'ready';

export type PersonaRecord = {
  personaId: string;
  userId: string;
  name?: string;
  triggerWord?: string;
  gender?: 'male' | 'female';
  /**
   * Optional Hugging Face URL for LoRA weights (e.g. a .safetensors file or repo reference).
   * Keep this as a URL/path string; never store base64 blobs here.
   */
  huggingFaceUrl?: string;
  /**
   * Whether the Hugging Face weights are private (may require a signed/proxied URL at runtime).
   */
  isPrivate?: boolean;
  modelId?: string;
  trainingId?: string;
  trainingZipUrl?: string;
  trainingZipPath?: string;
  imageUrl?: string;
  storagePath?: string;
  status?: PersonaTrainingStatus;
  weightsUrl?: string;
  destinationModel?: string;
  errorMessage?: string;
  createdAt?: string;
  completedAt?: string;
  imageCount?: number;
  visualStatus?: PersonaStatus;
  voiceStatus?: PersonaStatus;
};

const PERSONAS_DB_PATH = path.join(process.cwd(), 'data', 'personas.json');

const BLOATED_PERSONAS_BYTES = 45 * 1024 * 1024; // 45MB+
const DATA_URI_BASE64_RE = /^data:[^,]+;base64,/i;

async function ensureDataDir() {
  const dataDir = path.join(process.cwd(), 'data');
  try {
    await fs.access(dataDir);
  } catch {
    await fs.mkdir(dataDir, { recursive: true });
  }
}

type CleanupResult = {
  didCleanup: boolean;
  reason: string;
  bytesBefore?: number;
  bytesAfter?: number;
  removedCount?: number;
};

const looksLikeUrl = (value: string) =>
  /^https?:\/\//i.test(value)
  || value.startsWith('/')
  || value.startsWith('ipfs://');

const sanitizeUnknown = (value: unknown, counters: { removed: number; changed: boolean }): unknown => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return value;
    if (DATA_URI_BASE64_RE.test(trimmed) || trimmed.includes('base64,')) {
      counters.removed += 1;
      counters.changed = true;
      return undefined;
    }
    // Very large non-URL strings are almost certainly accidental blobs.
    if (trimmed.length > 10_000 && !looksLikeUrl(trimmed)) {
      counters.removed += 1;
      counters.changed = true;
      return undefined;
    }
    return value;
  }
  if (Array.isArray(value)) {
    let changed = false;
    const out: unknown[] = [];
    for (const item of value) {
      const sanitized = sanitizeUnknown(item, counters);
      if (sanitized === undefined) {
        changed = true;
        continue;
      }
      out.push(sanitized);
    }
    if (changed) counters.changed = true;
    return out;
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      const sanitized = sanitizeUnknown(v, counters);
      if (sanitized === undefined) {
        counters.changed = true;
        continue;
      }
      out[k] = sanitized;
    }
    return out;
  }
  return value;
};

/**
 * If `data/personas.json` becomes huge due to accidental base64/data URI blobs
 * (e.g. `trainingZipUrl: "data:application/zip;base64,..."`), strip those values
 * and persist only URL-like strings.
 */
export async function cleanupBloatedJson(options: { force?: boolean } = {}): Promise<CleanupResult> {
  await ensureDataDir();
  let stat: { size: number } | null = null;
  try {
    stat = await fs.stat(PERSONAS_DB_PATH);
  } catch (error: any) {
    if (error?.code === 'ENOENT') return { didCleanup: false, reason: 'missing' };
    throw error;
  }

  const bytesBefore = stat.size;
  const raw = await fs.readFile(PERSONAS_DB_PATH, 'utf-8');
  const containsBlobMarkers = raw.includes('base64,') || raw.includes('data:image') || raw.includes('data:application/zip');
  const shouldCleanup = options.force || bytesBefore >= BLOATED_PERSONAS_BYTES || containsBlobMarkers;
  if (!shouldCleanup) {
    return { didCleanup: false, reason: 'not_bloated', bytesBefore };
  }

  let parsed: unknown = null;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return { didCleanup: false, reason: 'invalid_json', bytesBefore };
  }

  if (!Array.isArray(parsed)) {
    return { didCleanup: false, reason: 'unexpected_shape', bytesBefore };
  }

  const counters = { removed: 0, changed: false };
  const cleaned = (parsed as unknown[]).map((item) => sanitizeUnknown(item, counters));
  const cleanedArray = cleaned.filter((x) => x && typeof x === 'object') as PersonaRecord[];

  if (!counters.changed) {
    return { didCleanup: false, reason: 'no_blobs_found', bytesBefore };
  }

  await writePersonas(cleanedArray);
  const bytesAfter = (await fs.stat(PERSONAS_DB_PATH)).size;
  return {
    didCleanup: true,
    reason: 'cleaned',
    bytesBefore,
    bytesAfter,
    removedCount: counters.removed,
  };
}

export async function readPersonas(): Promise<PersonaRecord[]> {
  try {
    await ensureDataDir();
    // Auto-cleanup if the local personas DB gets bloated with base64/data URIs.
    try {
      await cleanupBloatedJson();
    } catch (cleanupError) {
      console.warn('[persona-registry] cleanupBloatedJson failed, continuing without cleanup.', cleanupError);
    }
    const data = await fs.readFile(PERSONAS_DB_PATH, 'utf-8');
    return JSON.parse(data) as PersonaRecord[];
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return [];
    }
    if (error instanceof SyntaxError) {
      const corruptPath = PERSONAS_DB_PATH.replace(
        /\.json$/,
        `.corrupt-${Date.now()}.json`
      );
      try {
        await fs.rename(PERSONAS_DB_PATH, corruptPath);
      } catch (renameError) {
        console.error('Failed to move corrupt personas file:', renameError);
      }
      return [];
    }
    throw error;
  }
}

export async function writePersonas(personas: PersonaRecord[]) {
  await ensureDataDir();
  const tempPath = PERSONAS_DB_PATH.replace(/\.json$/, `.tmp-${Date.now()}.json`);
  await fs.writeFile(tempPath, JSON.stringify(personas, null, 2));
  await fs.rename(tempPath, PERSONAS_DB_PATH);
}

export async function findPersonaById(personaId: string): Promise<PersonaRecord | undefined> {
  const personas = await readPersonas();
  return personas.find(persona => persona.personaId === personaId);
}

export async function upsertPersona(record: PersonaRecord) {
  const personas = await readPersonas();
  const existingIndex = personas.findIndex(persona => persona.personaId === record.personaId);
  if (existingIndex >= 0) {
    personas[existingIndex] = { ...personas[existingIndex], ...record };
  } else {
    personas.push(record);
  }
  await writePersonas(personas);
}

export async function deletePersona(personaId: string): Promise<boolean> {
  const id = String(personaId || '').trim();
  if (!id) return false;
  const personas = await readPersonas();
  const next = personas.filter((persona) => persona.personaId !== id);
  if (next.length === personas.length) return false;
  await writePersonas(next);
  return true;
}
