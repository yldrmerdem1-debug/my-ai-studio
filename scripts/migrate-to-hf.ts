import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';

import dotenv from 'dotenv';
import * as hub from '@huggingface/hub';
import type { RepoId, RepoType } from '@huggingface/hub';
import { createClient } from '@supabase/supabase-js';

import { downloadMediaWithValidation, resolveReplicateDownloadUrl } from '@/lib/replicate-media';
import { withDownloadTrue } from '@/lib/lora-utils';

type Persona = Record<string, any> & {
  personaId?: string;
  userId?: string;
  name?: string;
  triggerWord?: string;
  modelId?: string;
  trainingId?: string;
  status?: string;
  weightsUrl?: string;
  huggingFaceUrl?: string;
  trainingZipUrl?: string;
  trainingZipPath?: string;
  storagePath?: string;
  imageUrl?: string;
};

type AssetKind = 'weights' | 'trainingZip' | 'image' | 'storagePathFile';

type AssetSource = {
  kind: AssetKind;
  source: string;
  suggestedExt: string;
  contentType: string;
  remotePath: string;
};

const loadEnv = () => {
  dotenv.config({ path: '.env' });
  dotenv.config({ path: '.env.local' });
};

const HF_REPO_NAME = 'shah1112/seedance-loras';
const HF_REPO_TYPE: RepoType = 'model'; // user requested "Private model"
const HF_BRANCH = 'main';

const PERSONAS_PATH = path.join(process.cwd(), 'data', 'personas.json');
const CLEAN_PATH = path.join(process.cwd(), 'data', 'personas_clean.json');

const isAbsoluteLocalPath = (value: string) => {
  const v = value.trim();
  if (!v) return false;
  if (/^[a-zA-Z]:[\\/]/.test(v)) return true; // Windows
  if (v.startsWith('/')) return true; // POSIX
  return false;
};

const looksLikeUrl = (value: string) => /^https?:\/\//i.test(value.trim());

const isReplicateFilesUrl = (value: string) => value.includes('api.replicate.com/v1/files/');

const isDataUri = (value: string) => value.trim().toLowerCase().startsWith('data:') && value.includes('base64,');

const safeTrim = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

const decodeDataUri = (dataUri: string): { buffer: Buffer; contentType: string; ext: string } => {
  const trimmed = dataUri.trim();
  const match = trimmed.match(/^data:([^;]+);base64,(.*)$/i);
  if (!match) {
    throw new Error('Invalid data URI format (expected data:<mime>;base64,...)');
  }
  const contentType = match[1] || 'application/octet-stream';
  const b64 = match[2] || '';
  const buffer = Buffer.from(b64, 'base64');
  const extByMime: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/webp': 'webp',
    'application/zip': 'zip',
  };
  const ext = extByMime[contentType.toLowerCase()] || 'bin';
  return { buffer, contentType, ext };
};

const ensureDir = async (p: string) => {
  await fs.mkdir(p, { recursive: true });
};

const createTempFilePath = (personaId: string, kind: AssetKind, ext: string) => {
  const safeId = personaId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(os.tmpdir(), `persona-${safeId}-${kind}-${Date.now()}.${ext}`);
};

const guessExtFromPathOrUrl = (value: string, fallback: string) => {
  const clean = value.split('?')[0].split('#')[0];
  const ext = path.extname(clean).replace('.', '').toLowerCase();
  return ext || fallback;
};

async function fetchAsBuffer(url: string, replicateToken?: string): Promise<{ buffer: Buffer; contentType: string }> {
  const headers: Record<string, string> = {};
  // Replicate files endpoints require auth.
  if (replicateToken?.trim() && url.includes('api.replicate.com/')) {
    headers.Authorization = `Bearer ${replicateToken.trim()}`;
  }
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Fetch failed (${res.status}) for ${url}. Body: ${text.slice(0, 300)}`);
  }
  const ab = await res.arrayBuffer();
  const contentType = (res.headers.get('content-type') || 'application/octet-stream').split(';')[0].trim();
  return { buffer: Buffer.from(ab), contentType };
}

async function resolveReplicateTrainingWeightsUrl(trainingId: string, replicateToken: string): Promise<{ status: string; weightsUrl: string }> {
  const id = safeTrim(trainingId);
  if (!id) return { status: 'unknown', weightsUrl: '' };
  const res = await fetch(`https://api.replicate.com/v1/trainings/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Token ${replicateToken.trim()}` },
  });
  const text = await res.text();
  if (!res.ok) {
    return { status: 'failed', weightsUrl: '' };
  }
  let payload: any = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }
  const status = String(payload?.status || '').toLowerCase() || 'unknown';
  const out = payload?.output ?? {};
  const weightsUrl =
    safeTrim(out?.weights_url)
    || safeTrim(out?.weights)
    || '';
  return { status, weightsUrl };
}

async function ensureHfRepo(accessToken: string) {
  const repo: RepoId = { type: HF_REPO_TYPE, name: HF_REPO_NAME };
  try {
    await hub.createRepo({
      repo,
      accessToken,
      private: true,
    });
    console.log('[hf] repo created:', `${HF_REPO_TYPE}:${HF_REPO_NAME}`);
  } catch (e: any) {
    const msg = String(e?.message || e || '');
    const status = Number(e?.statusCode || e?.status || 0);
    const apiError = String(e?.data?.error || '');
    const ok =
      msg.toLowerCase().includes('already exists')
      || msg.toLowerCase().includes('already created')
      || msg.toLowerCase().includes('409')
      || msg.toLowerCase().includes('conflict');
    const okByStatus = status === 409;
    const okByPayload = apiError.toLowerCase().includes('already') && apiError.toLowerCase().includes('repo');
    if (!(ok || okByStatus || okByPayload)) throw e;
    console.log('[hf] repo exists:', `${HF_REPO_TYPE}:${HF_REPO_NAME}`);
  }
}

async function uploadToHf(accessToken: string, localPath: string, remotePath: string) {
  const repo: RepoId = { type: HF_REPO_TYPE, name: HF_REPO_NAME };
  await hub.uploadFile({
    repo,
    accessToken,
    branch: HF_BRANCH,
    file: {
      path: remotePath,
      content: pathToFileURL(localPath),
    },
    commitTitle: `migrate ${path.basename(remotePath)}`,
    commitDescription: `migrate-to-hf.ts upload ${remotePath}`,
  });
  const base = `https://huggingface.co/${HF_REPO_NAME}`;
  const encodedPath = remotePath.split('/').map(encodeURIComponent).join('/');
  return withDownloadTrue(`${base}/resolve/${encodeURIComponent(HF_BRANCH)}/${encodedPath}`);
}

const isMissingColumn = (error: any, column: string) => {
  const message = String(error?.message || error || '');
  return message.toLowerCase().includes(`column \"${column}\"`) && message.toLowerCase().includes('does not exist');
};

async function upsertSupabasePersona(supabase: any, persona: Persona) {
  const id = safeTrim(persona.personaId) || safeTrim((persona as any).id);
  if (!id) return;
  const payload: Record<string, any> = {
    id,
    user_id: persona.userId,
    name: persona.name,
    trigger_word: persona.triggerWord,
    model_id: persona.modelId,
    training_id: persona.trainingId,
    status: persona.status,
    image_url: persona.imageUrl,
    storage_path: persona.storagePath,
    weights_url: persona.weightsUrl,
    huggingface_url: persona.huggingFaceUrl,
  };

  const tryUpsert = async (data: Record<string, any>) => {
    // Supabase client is untyped in this repo; cast to any to avoid `never` inference.
    return await supabase.from('personas').upsert(data as any, { onConflict: 'id' });
  };

  let res = await tryUpsert(payload);
  if (res.error && (isMissingColumn(res.error, 'weights_url') || isMissingColumn(res.error, 'huggingface_url'))) {
    const stripped = Object.fromEntries(Object.entries(payload).filter(([k]) => k !== 'weights_url' && k !== 'huggingface_url'));
    res = await tryUpsert(stripped);
  }
  if (res.error && isMissingColumn(res.error, 'training_id')) {
    const stripped = Object.fromEntries(Object.entries(payload).filter(([k]) => k !== 'training_id'));
    res = await tryUpsert(stripped);
  }
  if (res.error && isMissingColumn(res.error, 'storage_path')) {
    const stripped = Object.fromEntries(Object.entries(payload).filter(([k]) => k !== 'storage_path'));
    res = await tryUpsert(stripped);
  }
  if (res.error) {
    throw new Error(`[supabase] upsert failed for ${id}: ${res.error.message}`);
  }
}

function collectAssets(persona: Persona): AssetSource[] {
  const id = safeTrim(persona.personaId);
  const assets: AssetSource[] = [];

  const weightsUrl = safeTrim(persona.weightsUrl);
  if (weightsUrl) {
    assets.push({
      kind: 'weights',
      source: weightsUrl,
      suggestedExt: guessExtFromPathOrUrl(weightsUrl, 'safetensors'),
      contentType: 'application/octet-stream',
      remotePath: `personas/${id}/${id}_weights.safetensors`,
    });
  }

  const trainingZipUrl = safeTrim(persona.trainingZipUrl);
  if (trainingZipUrl) {
    assets.push({
      kind: 'trainingZip',
      source: trainingZipUrl,
      suggestedExt: guessExtFromPathOrUrl(trainingZipUrl, 'zip'),
      contentType: 'application/zip',
      remotePath: `personas/${id}/${id}_training.zip`,
    });
  }

  const trainingZipPath = safeTrim(persona.trainingZipPath);
  if (trainingZipPath) {
    assets.push({
      kind: 'trainingZip',
      source: trainingZipPath,
      suggestedExt: guessExtFromPathOrUrl(trainingZipPath, 'zip'),
      contentType: 'application/zip',
      remotePath: `personas/${id}/${id}_training.zip`,
    });
  }

  const imageUrl = safeTrim(persona.imageUrl);
  if (imageUrl) {
    const ext = isDataUri(imageUrl) ? decodeDataUri(imageUrl).ext : guessExtFromPathOrUrl(imageUrl, 'jpg');
    assets.push({
      kind: 'image',
      source: imageUrl,
      suggestedExt: ext,
      contentType: ext === 'png' ? 'image/png' : 'image/jpeg',
      remotePath: `personas/${id}/${id}_image.${ext}`,
    });
  }

  const storagePath = safeTrim(persona.storagePath);
  if (storagePath && isAbsoluteLocalPath(storagePath)) {
    assets.push({
      kind: 'storagePathFile',
      source: storagePath,
      suggestedExt: guessExtFromPathOrUrl(storagePath, 'bin'),
      contentType: 'application/octet-stream',
      remotePath: `personas/${id}/${id}_storage${path.extname(storagePath) || '.bin'}`,
    });
  }

  return assets;
}

async function materializeAssetToLocalFile(asset: AssetSource, personaId: string, replicateToken: string) {
  const src = asset.source.trim();
  if (!src) throw new Error('Empty asset source');

  if (isDataUri(src)) {
    const decoded = decodeDataUri(src);
    const temp = createTempFilePath(personaId, asset.kind, decoded.ext);
    await fs.writeFile(temp, decoded.buffer);
    return { tempPath: temp, cleanup: true };
  }

  if (isAbsoluteLocalPath(src)) {
    // Use local file directly
    return { tempPath: path.resolve(src), cleanup: false };
  }

  if (looksLikeUrl(src)) {
    // Handle Replicate file URLs
    let downloadUrl = src;
    if (isReplicateFilesUrl(src) && replicateToken) {
      downloadUrl = await resolveReplicateDownloadUrl(src, { token: replicateToken });
    }

    // Prefer replicate-media for tricky cases (metadata, redirects)
    if (isReplicateFilesUrl(src) || downloadUrl.includes('api.replicate.com/')) {
      const media = await downloadMediaWithValidation(downloadUrl, {
        token: replicateToken,
        strictExpectedKind: false,
        logger: {
          info: (...args) => console.log('[replicate-media]', ...args),
          warn: (...args) => console.warn('[replicate-media]', ...args),
        },
      });
      const ext = guessExtFromPathOrUrl(downloadUrl, asset.suggestedExt);
      const temp = createTempFilePath(personaId, asset.kind, ext);
      await fs.writeFile(temp, media.buffer);
      return { tempPath: temp, cleanup: true };
    }

    const fetched = await fetchAsBuffer(downloadUrl, replicateToken);
    const ext = guessExtFromPathOrUrl(downloadUrl, asset.suggestedExt);
    const temp = createTempFilePath(personaId, asset.kind, ext);
    await fs.writeFile(temp, fetched.buffer);
    return { tempPath: temp, cleanup: true };
  }

  throw new Error(`Unsupported asset source: ${src.slice(0, 40)}...`);
}

function cleanPersonaForOutput(persona: Persona): Persona {
  // Keep minimal metadata + HF links only
  return {
    personaId: persona.personaId,
    userId: persona.userId,
    name: persona.name,
    triggerWord: persona.triggerWord,
    modelId: persona.modelId,
    trainingId: persona.trainingId,
    status: persona.status,
    imageUrl: persona.imageUrl && !isDataUri(persona.imageUrl) ? persona.imageUrl : '',
    huggingFaceUrl: persona.huggingFaceUrl,
    weightsUrl: persona.weightsUrl,
    trainingZipUrl: persona.trainingZipUrl && !isDataUri(persona.trainingZipUrl) ? persona.trainingZipUrl : '',
  };
}

async function main() {
  loadEnv();

  const hfToken = String(
    process.env.HF_TOKEN
    || process.env.HUGGINGFACEHUB_API_TOKEN
    || process.env.HUGGINGFACE_TOKEN
    || ''
  ).trim();
  if (!hfToken) {
    throw new Error('HF token is missing. Set HF_TOKEN (or HUGGINGFACEHUB_API_TOKEN) in your environment/.env.local');
  }

  const supabaseUrl = String(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
  const supabaseKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Supabase env missing. Need SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY.');
  }

  const replicateToken = String(process.env.REPLICATE_API_TOKEN || '').trim();
  if (!replicateToken) {
    console.warn('[warn] REPLICATE_API_TOKEN is missing. Replicate file URLs / training weights resolution may fail.');
  }

  const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false, autoRefreshToken: false } });

  console.log('=== migrate-to-hf ===');
  console.log('HF repo:', `${HF_REPO_TYPE}:${HF_REPO_NAME} (private)`);
  console.log('Supabase:', supabaseUrl);
  console.log('Local personas path:', PERSONAS_PATH);

  await ensureHfRepo(hfToken);

  // Read personas from BOTH sources:
  // - local data/personas.json
  // - Supabase personas table
  const personasById = new Map<string, Persona>();

  // Local personas.json (may be big)
  try {
    const raw = await fs.readFile(PERSONAS_PATH, 'utf-8');
    const sizeMb = (Buffer.byteLength(raw, 'utf8') / 1024 / 1024).toFixed(2);
    console.log(`Loaded personas.json (${sizeMb} MB)`);
    const parsed = raw ? JSON.parse(raw) : [];
    const localPersonas: Persona[] = Array.isArray(parsed) ? parsed : [];
    console.log('Local persona count:', localPersonas.length);
    for (const p of localPersonas) {
      const id = safeTrim(p?.personaId) || safeTrim((p as any)?.id);
      if (!id) continue;
      personasById.set(id, { ...p, personaId: id });
    }
  } catch (e: any) {
    console.warn('Failed to read/parse local personas.json; continuing with Supabase only.', e?.message || e);
  }

  // Supabase personas
  try {
    const { data, error } = await (supabase as any)
      .from('personas')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(10000);
    if (error) {
      console.warn('Supabase personas fetch failed:', error.message);
    } else {
      const supaPersonas: any[] = Array.isArray(data) ? data : [];
      console.log('Supabase persona count:', supaPersonas.length);
      for (const row of supaPersonas) {
        const id = safeTrim(row?.id) || safeTrim(row?.personaId) || safeTrim(row?.persona_id);
        if (!id) continue;
        const merged = personasById.get(id) || { personaId: id };
        personasById.set(id, {
          ...merged,
          personaId: id,
          userId: row?.user_id ?? merged.userId,
          name: row?.name ?? merged.name,
          triggerWord: row?.trigger_word ?? row?.triggerWord ?? merged.triggerWord,
          modelId: row?.model_id ?? row?.modelId ?? merged.modelId,
          trainingId: row?.training_id ?? row?.trainingId ?? merged.trainingId,
          status: row?.status ?? merged.status,
          imageUrl: row?.image_url ?? row?.imageUrl ?? merged.imageUrl,
          storagePath: row?.storage_path ?? row?.storagePath ?? merged.storagePath,
          weightsUrl: row?.weights_url ?? row?.weightsUrl ?? merged.weightsUrl,
          huggingFaceUrl: row?.huggingface_url ?? row?.huggingFaceUrl ?? merged.huggingFaceUrl,
          trainingZipUrl: row?.training_zip_url ?? row?.trainingZipUrl ?? merged.trainingZipUrl,
          trainingZipPath: row?.training_zip_path ?? row?.trainingZipPath ?? merged.trainingZipPath,
        });
      }
    }
  } catch (e: any) {
    console.warn('Supabase personas fetch crashed:', e?.message || e);
  }

  const personas: Persona[] = Array.from(personasById.values());
  console.log('Merged persona count:', personas.length);

  const cleanedOut: Persona[] = [];
  let migratedCount = 0;

  for (let idx = 0; idx < personas.length; idx += 1) {
    const persona = personas[idx];
    const personaId = safeTrim(persona?.personaId) || safeTrim((persona as any)?.id) || `row_${idx}`;
    const pct = Math.round(((idx + 1) / Math.max(1, personas.length)) * 100);

    console.log(`\n[${idx + 1}/${personas.length}] (${pct}%) personaId=${personaId} name=${persona?.name || ''} status=${persona?.status || ''}`);

    // If we only have trainingId and no weightsUrl, try to resolve weights from Replicate and treat as weightsUrl.
    if (!safeTrim(persona.weightsUrl) && safeTrim(persona.trainingId) && replicateToken) {
      const { status, weightsUrl } = await resolveReplicateTrainingWeightsUrl(safeTrim(persona.trainingId), replicateToken);
      console.log('Replicate training status:', status, 'weightsUrl:', weightsUrl ? '[found]' : '[missing]');
      if (weightsUrl) persona.weightsUrl = weightsUrl;
    }

    const assets = collectAssets(persona);
    console.log('assets detected:', assets.map((a) => `${a.kind}:${a.source.slice(0, 50)}`).join(' | ') || '(none)');

    let uploadedAny = false;

    for (const asset of assets) {
      try {
        console.log(`-> materialize ${asset.kind} ...`);
        const materialized = await materializeAssetToLocalFile(asset, personaId, replicateToken);
        console.log('-> local path:', materialized.tempPath);

        // Upload to HF, with personaId-based remote pathing
        console.log(`-> upload to HF: ${asset.remotePath}`);
        const hfUrl = await uploadToHf(hfToken, materialized.tempPath, asset.remotePath);
        console.log('-> HF URL:', hfUrl);

        // Persist back into persona fields (metadata-only).
        if (asset.kind === 'weights') {
          persona.huggingFaceUrl = hfUrl;
          persona.weightsUrl = hfUrl;
        } else if (asset.kind === 'trainingZip') {
          persona.trainingZipUrl = hfUrl;
        } else if (asset.kind === 'image') {
          persona.imageUrl = hfUrl;
        }

        uploadedAny = true;

        // Cleanup temp file if we created it
        if (materialized.cleanup) {
          try {
            await fs.unlink(materialized.tempPath);
          } catch {
            // ignore
          }
        }
      } catch (err: any) {
        console.warn(`!! asset migration failed (${asset.kind}):`, err?.message || String(err));
      }
    }

    // Update Supabase row (best-effort)
    try {
      console.log('-> syncing Supabase...');
      await upsertSupabasePersona(supabase, persona);
      console.log('-> Supabase sync OK');
    } catch (e: any) {
      console.warn('!! Supabase sync failed:', e?.message || String(e));
    }

    if (uploadedAny) migratedCount += 1;
    cleanedOut.push(cleanPersonaForOutput(persona));
  }

  await ensureDir(path.dirname(CLEAN_PATH));
  await fs.writeFile(CLEAN_PATH, JSON.stringify(cleanedOut, null, 2), 'utf-8');
  console.log('\nWrote clean personas file:', CLEAN_PATH);
  console.log('Migrated personas (uploaded any asset):', migratedCount, '/', personas.length);
  console.log('Done.');
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});

