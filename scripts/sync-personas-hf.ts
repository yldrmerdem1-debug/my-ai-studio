import path from 'node:path';
import fs from 'node:fs/promises';
import dotenv from 'dotenv';
import HuggingFaceService from '@/lib/huggingface-service';
import {
  readPersonas,
  writePersonas,
  type PersonaRecord,
} from '@/lib/persona-registry';
import { getSupabaseAdminClient } from '@/lib/supabase/admin';
import { downloadMediaWithValidation, resolveReplicateDownloadUrl } from '@/lib/replicate-media';
import { normalizeLoraWeightsBuffer } from '@/lib/lora-weights';

type SyncResult = {
  processed: number;
  uploaded: number;
  skipped: number;
  failed: number;
};

const HF_REPO_ID = 'shah1112/seedance-loras';

const loadEnv = () => {
  // Scripts (tsx/node) don't automatically load Next's .env.local.
  // Load in priority order; later calls won't override existing env values.
  dotenv.config({ path: '.env' });
  dotenv.config({ path: '.env.local' });
};

const isAbsoluteLocalPath = (value: string) => {
  const v = value.trim();
  if (!v) return false;
  // Windows absolute: C:\...
  if (/^[a-zA-Z]:[\\/]/.test(v)) return true;
  // POSIX absolute: /...
  if (v.startsWith('/')) return true;
  return false;
};

const looksLikeObjectKey = (value: string) => {
  // Supabase storage keys in this project look like: personas/<userId>/<timestamp-uuid>.jpg
  // Keep it permissive; we mainly want to avoid treating these as local files.
  const v = value.trim();
  return v.includes('/') && !isAbsoluteLocalPath(v) && !v.startsWith('http');
};

const fileExists = async (p: string) => {
  try {
    const st = await fs.stat(p);
    return st.isFile() && st.size > 0;
  } catch {
    return false;
  }
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const isMissingColumn = (error: any, column: string) => {
  const message = String(error?.message || error || '');
  return message.toLowerCase().includes(`column "${column}"`) && message.toLowerCase().includes('does not exist');
};

const normalizeTrainingStatus = (raw?: string) => {
  const s = String(raw || '').toLowerCase();
  if (!s) return 'unknown';
  if (s === 'succeeded' || s === 'completed' || s === 'active' || s === 'ready') return 'succeeded';
  if (s === 'failed' || s === 'canceled') return 'failed';
  if (s === 'starting' || s === 'processing' || s === 'running' || s === 'queued' || s === 'training') return 'training';
  return s;
};

async function resolveWeightsUrlFromReplicate(trainingId: string, token: string) {
  const id = String(trainingId || '').trim();
  if (!id) return { status: 'unknown', weightsUrl: '' };
  if (!token?.trim()) return { status: 'unknown', weightsUrl: '' };

  const response = await fetch(`https://api.replicate.com/v1/trainings/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Token ${token.trim()}` },
  });
  const text = await response.text();
  if (!response.ok) {
    return { status: 'failed', weightsUrl: '' };
  }
  let payload: any = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }
  const status = normalizeTrainingStatus(payload?.status);
  const out = payload?.output ?? {};
  const weightsUrl =
    (typeof out?.weights_url === 'string' ? out.weights_url : '')
    || (typeof out?.weights === 'string' ? out.weights : '')
    || '';
  return { status, weightsUrl: String(weightsUrl || '').trim() };
}

async function syncPersonaToSupabase(persona: PersonaRecord) {
  const { client: supabase, error } = getSupabaseAdminClient();
  if (!supabase || error) {
    console.log('[supabase] skipped (not configured)');
    return;
  }

  const payload: Record<string, any> = {
    id: persona.personaId,
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

  // Try update first
  let updateResult = await supabase
    .from('personas')
    .update(payload)
    .eq('id', persona.personaId);

  if (updateResult.error && (isMissingColumn(updateResult.error, 'weights_url') || isMissingColumn(updateResult.error, 'huggingface_url'))) {
    const stripped = Object.fromEntries(Object.entries(payload).filter(([k]) => k !== 'weights_url' && k !== 'huggingface_url'));
    updateResult = await supabase
      .from('personas')
      .update(stripped)
      .eq('id', persona.personaId);
  }

  // If update didn't match anything, insert as best-effort.
  // Note: Supabase-js doesn't expose affected row count reliably across all configs,
  // so we do a lightweight existence check when update succeeded with no error.
  if (!updateResult.error) {
    const { data: row, error: selErr } = await supabase
      .from('personas')
      .select('id')
      .eq('id', persona.personaId)
      .maybeSingle();
    if (selErr) {
      console.log('[supabase] update ok, but verify failed:', selErr.message);
      return;
    }
    if (row?.id) {
      console.log('[supabase] updated:', persona.personaId);
      return;
    }
  }

  let insertResult = await supabase
    .from('personas')
    .insert(payload);

  if (insertResult.error && (isMissingColumn(insertResult.error, 'weights_url') || isMissingColumn(insertResult.error, 'huggingface_url'))) {
    const stripped = Object.fromEntries(Object.entries(payload).filter(([k]) => k !== 'weights_url' && k !== 'huggingface_url'));
    insertResult = await supabase
      .from('personas')
      .insert(stripped);
  }

  if (insertResult.error) {
    console.log('[supabase] insert failed:', insertResult.error.message);
    return;
  }
  console.log('[supabase] inserted:', persona.personaId);
}

async function main() {
  console.log('=== sync-personas-hf ===');
  console.log('HF repo:', HF_REPO_ID);

  loadEnv();

  const hf = new HuggingFaceService(); // uses HF_TOKEN
  const replicateToken = String(process.env.REPLICATE_API_TOKEN || '').trim();
  if (!replicateToken) {
    console.log('[warn] REPLICATE_API_TOKEN is not set. Only local-file uploads can be migrated.');
  }

  const personas = await readPersonas();
  console.log('Loaded personas:', personas.length);

  const result: SyncResult = { processed: 0, uploaded: 0, skipped: 0, failed: 0 };
  let changed = false;

  for (const persona of personas) {
    result.processed += 1;
    const id = persona.personaId;
    const sp = (persona.storagePath || '').trim();

    console.log(`\n[persona ${result.processed}/${personas.length}] id=${id}`);
    console.log('storagePath:', sp || '(empty)');
    console.log('huggingFaceUrl:', persona.huggingFaceUrl || '(empty)');
    console.log('trainingId:', persona.trainingId || '(empty)');
    console.log('status:', persona.status || '(empty)');

    if (!sp) {
      // No local file path; try Replicate training migration.
      if (!persona.huggingFaceUrl && persona.trainingId && replicateToken) {
        console.log('-> no storagePath; attempting Replicate weights migration...');
        try {
          const { status, weightsUrl } = await resolveWeightsUrlFromReplicate(persona.trainingId, replicateToken);
          console.log('-> Replicate training status:', status);
          if (status !== 'succeeded' || !weightsUrl) {
            console.log('-> skip: weights not available yet');
            result.skipped += 1;
            continue;
          }

          // Resolve Replicate file metadata URLs to a downloadable URL if needed.
          const downloadUrl = weightsUrl.includes('api.replicate.com/v1/files/')
            ? await resolveReplicateDownloadUrl(weightsUrl, { token: replicateToken })
            : weightsUrl;
          console.log('-> weights download url:', downloadUrl);

          const media = await downloadMediaWithValidation(downloadUrl, {
            token: replicateToken,
            strictExpectedKind: false,
            logger: {
              info: (...args) => console.log(...args),
              warn: (...args) => console.warn(...args),
            },
          });
          const normalizedWeights = normalizeLoraWeightsBuffer(media.buffer, downloadUrl);
          if (normalizedWeights.kind !== 'safetensors') {
            throw new Error('Downloaded weights could not be normalized to safetensors.');
          }

          const tempPath = path.join(process.cwd(), 'public', 'temp', `lora-${id}.safetensors`);
          await fs.mkdir(path.dirname(tempPath), { recursive: true });
          await fs.writeFile(tempPath, normalizedWeights.buffer);

          console.log('-> uploading weights to Hugging Face...');
          const remotePath = `personas/${id}/lora.safetensors`;
          const url = await hf.uploadLoRA(tempPath, HF_REPO_ID, {
            repoType: 'dataset',
            branch: 'main',
            remotePath,
          });
          console.log('-> upload OK:', url);

          // cleanup temp file
          try {
            await fs.unlink(tempPath);
          } catch {
            // ignore
          }

          persona.huggingFaceUrl = url;
          persona.weightsUrl = url;
          changed = true;
          result.uploaded += 1;

          console.log('-> syncing to Supabase...');
          await syncPersonaToSupabase(persona);
          // small delay to be nice to APIs
          await sleep(250);
          continue;
        } catch (err: any) {
          console.log('-> fail:', err?.message || String(err));
          result.failed += 1;
          continue;
        }
      }

      console.log('-> skip: no storagePath and no replicatable training weights');
      result.skipped += 1;
      continue;
    }

    if (persona.huggingFaceUrl && persona.huggingFaceUrl.startsWith('https://huggingface.co/')) {
      console.log('-> skip: already has huggingFaceUrl');
      result.skipped += 1;
      continue;
    }

    if (looksLikeObjectKey(sp)) {
      console.log('-> skip: storagePath looks like storage object key (not a local file)');
      result.skipped += 1;
      continue;
    }

    if (!isAbsoluteLocalPath(sp)) {
      console.log('-> skip: storagePath is not an absolute local path');
      result.skipped += 1;
      continue;
    }

    const absolute = path.resolve(sp);
    const exists = await fileExists(absolute);
    if (!exists) {
      console.log('-> fail: local file not found:', absolute);
      result.failed += 1;
      continue;
    }

    try {
      console.log('-> uploading to Hugging Face...');
      const remotePath = `personas/${id}/${path.basename(absolute)}`;
      const url = await hf.uploadLoRA(absolute, HF_REPO_ID, {
        repoType: 'dataset',
        branch: 'main',
        remotePath,
      });
      console.log('-> upload OK:', url);

      persona.huggingFaceUrl = url;
      // Keep compatibility: weightsUrl is what generation code commonly reads.
      persona.weightsUrl = url;
      changed = true;
      result.uploaded += 1;

      console.log('-> syncing to Supabase...');
      await syncPersonaToSupabase(persona);
    } catch (err: any) {
      console.log('-> fail:', err?.message || String(err));
      result.failed += 1;
      continue;
    }
  }

  if (changed) {
    console.log('\nWriting updated personas.json ...');
    await writePersonas(personas);
    console.log('personas.json updated.');
  } else {
    console.log('\nNo local changes to personas.json.');
  }

  console.log('\n=== done ===');
  console.log(result);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});

