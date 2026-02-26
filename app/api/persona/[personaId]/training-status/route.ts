import { NextRequest, NextResponse } from 'next/server';
import Replicate from 'replicate';
import { getSupabaseAdminClient } from '@/lib/supabase/admin';
import { deletePersona, findPersonaById, upsertPersona } from '@/lib/persona-registry';
import { downloadMediaWithValidation, resolveReplicateDownloadUrl } from '@/lib/replicate-media';
import HuggingFaceService from '@/lib/huggingface-service';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

const isMissingColumn = (error: any, column: string) => {
  const message = String(error?.message || error || '');
  return message.toLowerCase().includes(`column "${column}"`) && message.toLowerCase().includes('does not exist');
};

const cancelTraining = async (trainingId: string, token: string) => {
  try {
    await fetch(`https://api.replicate.com/v1/trainings/${trainingId}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Token ${token}` },
    });
  } catch (error) {
    console.error('Failed to cancel training:', error);
  }
};
const STALE_TRAINING_MINUTES = 60;
const isUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

const normalizeProgress = (value: unknown): number | null => {
  if (typeof value !== 'number' || Number.isNaN(value)) return null;
  if (value <= 1) return Math.max(0, Math.min(100, Math.round(value * 100)));
  if (value <= 100) return Math.max(0, Math.min(100, Math.round(value)));
  return null;
};

const mapTrainingStatus = (status?: string) => {
  switch (status) {
    case 'completed':
    case 'training':
    case 'failed':
    case 'idle':
      return status;
    case 'starting':
    case 'processing':
    case 'running':
      return 'training';
    case 'succeeded':
      return 'completed';
    case 'failed':
    case 'canceled':
      return 'failed';
    default:
      return 'training';
  }
};

const safeTrim = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

const extractWeightsUrlFromTraining = (training: any): string => {
  const output = training?.output ?? {};
  return safeTrim(
    output?.weights_url
    || output?.weights
    || output?.weightsUrl
    || output?.lora_weights_url
    || output?.lora_weights
    || output?.lora
  );
};

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const parts = url.pathname.split('/');
    const personaId = parts[parts.length - 2];
    if (!personaId) {
      return NextResponse.json({ error: 'Persona id is required' }, { status: 400 });
    }

    const { client: supabase, error: supabaseError } = getSupabaseAdminClient();
    let persona: any = null;
    let source: 'supabase' | 'local' = 'local';
    let localUserId: string | null = null;

    if (supabase && !supabaseError) {
      const matchParts = [
        `training_id.eq.${personaId}`,
        `model_id.eq.${personaId}`,
      ];
      if (isUuid(personaId)) {
        matchParts.push(`id.eq.${personaId}`);
      }
      let supaQuery = await supabase
        .from('personas')
        .select('id, training_id, status, model_id')
        .or(matchParts.join(','))
        .maybeSingle();
      if (supaQuery.error && isMissingColumn(supaQuery.error, 'training_id')) {
        const fallbackParts = [
          `model_id.eq.${personaId}`,
        ];
        if (isUuid(personaId)) {
          fallbackParts.push(`id.eq.${personaId}`);
        }
        supaQuery = await supabase
          .from('personas')
          .select('id, status, model_id')
          .or(fallbackParts.join(','))
          .maybeSingle();
      }
      if (!supaQuery.error && supaQuery.data) {
        persona = supaQuery.data;
        source = 'supabase';
      }
    }

    if (!persona) {
      const localPersona = await findPersonaById(personaId);
      if (localPersona) {
        persona = {
          id: localPersona.personaId,
          training_id: localPersona.trainingId,
          status: localPersona.status,
          model_id: localPersona.modelId,
        };
        source = 'local';
        localUserId = localPersona.userId;
      }
    }

    if (!persona) {
      return NextResponse.json(
        { error: 'Persona not found' },
        { status: 404 }
      );
    }

    if (!persona.training_id && !persona.model_id) {
      return NextResponse.json(
        { error: 'Training not started' },
        { status: 404 }
      );
    }

    const apiToken = process.env.REPLICATE_API_TOKEN;
    if (!apiToken || apiToken.trim() === '') {
      return NextResponse.json(
        { error: 'REPLICATE_API_TOKEN not configured' },
        { status: 500 }
      );
    }

    const replicate = new Replicate({ auth: apiToken.trim() });
    const trainingId = persona.training_id ?? persona.model_id;
    const dbStatus = mapTrainingStatus(persona.status);
    // If DB already considers this persona failed, delete it immediately to avoid clutter.
    if (dbStatus === 'failed') {
      if (supabase && !supabaseError && persona?.id) {
        await supabase.from('personas').delete().eq('id', persona.id);
      }
      if (source === 'local') {
        await deletePersona(String(persona.id || personaId));
      }
      return NextResponse.json({ status: 'failed', source, progress: null });
    }

    let mappedStatus = 'training';
    let progress: number | null = null;
    let weightsUrlFromTraining = '';
    try {
      const training = await replicate.trainings.get(trainingId);
      const rawStatus = training?.status;
      mappedStatus = mapTrainingStatus(rawStatus);
      progress = normalizeProgress((training as any)?.progress ?? (training as any)?.metrics?.progress ?? (training as any)?.metrics?.percent);
      if (mappedStatus === 'completed') {
        weightsUrlFromTraining = extractWeightsUrlFromTraining(training);
      }
      const statusStr = rawStatus as string | undefined;
      if (
        statusStr === 'starting'
        || statusStr === 'processing'
        || statusStr === 'queued'
      ) {
        const startedAt = training?.started_at ?? training?.created_at;
        if (startedAt) {
          const elapsedMs = Date.now() - new Date(startedAt).getTime();
          if (elapsedMs > STALE_TRAINING_MINUTES * 60 * 1000) {
            await cancelTraining(trainingId, apiToken.trim());
            mappedStatus = 'failed';
          }
        }
      }
    } catch (error) {
      await cancelTraining(trainingId, apiToken.trim());
      if (supabase && !supabaseError && persona?.id) {
        await supabase
          .from('personas')
          .update({ status: 'failed' })
          .eq('id', persona.id);
      }
      if (source === 'local' && localUserId) {
        await upsertPersona({
          personaId: persona.id,
          userId: localUserId,
          status: 'failed',
          visualStatus: 'none',
        });
      }
      return NextResponse.json({ status: 'failed', source, progress: null });
    }

    if (mappedStatus === 'completed' && supabase && !supabaseError) {
      await supabase
        .from('personas')
        .update({ status: 'completed', completed_at: new Date().toISOString() })
        .eq('id', persona.id);
    }

    // Best-effort: when training completes, upload weights to Hugging Face and persist the URL in local storage.
    // Never fail the status endpoint if HF is unavailable.
    if (mappedStatus === 'completed') {
      try {
        const localForTrainingId = await findPersonaById(trainingId);
        const alreadyHasHf =
          Boolean(localForTrainingId?.huggingFaceUrl && String(localForTrainingId.huggingFaceUrl).includes('huggingface.co'))
          || Boolean(localForTrainingId?.weightsUrl && String(localForTrainingId.weightsUrl).includes('huggingface.co'));

        if (!alreadyHasHf) {
          const weightsUrl = weightsUrlFromTraining;
          if (weightsUrl) {
            const replicateToken = process.env.REPLICATE_API_TOKEN || '';
            const resolvedWeightsUrl = weightsUrl.includes('api.replicate.com/v1/files/')
              ? await resolveReplicateDownloadUrl(weightsUrl, { token: replicateToken })
              : weightsUrl;

            const media = await downloadMediaWithValidation(resolvedWeightsUrl, {
              token: replicateToken,
              strictExpectedKind: false,
            });

            const fileName = `${trainingId}_weights.safetensors`;
            const tempPath = path.join(os.tmpdir(), fileName);
            await fs.writeFile(tempPath, media.buffer);
            try {
              const repoId = 'shah1112/seedance-loras';
              const hf = new HuggingFaceService();
              const remotePath = `personas/${trainingId}/${fileName}`;
              const hfUrl = await hf.uploadLoRA(tempPath, repoId, {
                repoType: 'dataset',
                branch: 'main',
                remotePath,
              });

              await upsertPersona({
                personaId: trainingId,
                userId: localForTrainingId?.userId || localUserId || 'unknown',
                trainingId,
                modelId: trainingId,
                status: 'completed',
                visualStatus: 'ready',
                huggingFaceUrl: hfUrl,
                weightsUrl: hfUrl,
              });

              // Best-effort persist to Supabase if columns exist.
              if (supabase && !supabaseError && persona?.id) {
                await supabase
                  .from('personas')
                  .update({ huggingface_url: hfUrl, weights_url: hfUrl })
                  .eq('id', persona.id);
              }
            } finally {
              await fs.unlink(tempPath).catch(() => undefined);
            }
          }
        }
      } catch (e) {
        console.warn('[persona-training-status] HF upload skipped:', (e as any)?.message || e);
      }
    }

    if (mappedStatus === 'failed' && supabase && !supabaseError) {
      await cancelTraining(trainingId, apiToken.trim());
      // Delete failed personas to avoid cluttering storage/UI.
      await supabase
        .from('personas')
        .delete()
        .eq('id', persona.id);
    }

    if (source === 'local' && localUserId) {
      if (mappedStatus === 'completed') {
        await upsertPersona({
          personaId: persona.id,
          userId: localUserId,
          status: 'completed',
          visualStatus: 'ready',
          completedAt: new Date().toISOString(),
        });
      } else if (mappedStatus === 'failed') {
        await deletePersona(persona.id);
      }
    }

    // Only re-check Supabase if this persona actually came from Supabase.
    // Otherwise `latest` may be null and we'd incorrectly map it to "training".
    if (supabase && !supabaseError && source === 'supabase') {
      const { data: latest, error: latestError } = await supabase
        .from('personas')
        .select('status')
        .eq('id', persona.id)
        .maybeSingle();
      if (!latestError && typeof latest?.status === 'string' && latest.status.trim() !== '') {
        return NextResponse.json({ status: mapTrainingStatus(latest?.status), source: 'supabase', progress });
      }
    }

    return NextResponse.json({ status: mappedStatus, source, progress });
  } catch (error: any) {
    console.error('Training status error:', {
      error: error?.message ?? error,
      response: error?.response?.data ?? error,
    });
    return NextResponse.json(
      { error: 'Unable to fetch training status' },
      { status: 500 }
    );
  }
}
