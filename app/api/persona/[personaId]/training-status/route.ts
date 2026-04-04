import { NextRequest, NextResponse } from 'next/server';
import Replicate from 'replicate';
import { ensureFalConfigured } from '@/lib/fal';
import { getSupabaseAdminClient } from '@/lib/supabase/admin';
import { findPersonaById, updatePersonasById } from '@/lib/persona-registry';
import { decodeFalTrainingJobId, isFalTrainingJobId } from '@/lib/persona-training-jobs';
import { downloadMediaWithValidation, resolveReplicateDownloadUrl } from '@/lib/replicate-media';
import HuggingFaceService from '@/lib/huggingface-service';
import { normalizeLoraWeightsBuffer } from '@/lib/lora-weights';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

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
    case 'canceled':
    case 'idle':
      return status;
    case 'starting':
    case 'processing':
    case 'running':
      return 'training';
    case 'succeeded':
      return 'completed';
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

const mapFalTrainingStatus = (status?: string) => {
  switch (String(status || '').trim().toUpperCase()) {
    case 'COMPLETED':
      return 'completed';
    case 'IN_QUEUE':
    case 'IN_PROGRESS':
      return 'training';
    case 'CANCELLED':
    case 'CANCELED':
      return 'canceled';
    case 'FAILED':
    case 'ERROR':
      return 'failed';
    default:
      return 'training';
  }
};

const extractFalWeightsUrl = (result: any) =>
  safeTrim(
    result?.data?.diffusers_lora_file?.url
    || result?.diffusers_lora_file?.url
    || result?.data?.lora?.url
    || result?.lora?.url
  );

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
        .select('id, training_id, status, model_id, error_message, completed_at, training_base_model')
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
          .select('id, status, model_id, error_message, completed_at, training_base_model')
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
          error_message: localPersona.errorMessage ?? null,
          completed_at: localPersona.completedAt ?? null,
          training_base_model: localPersona.trainingBaseModel ?? null,
        };
        source = 'local';
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

    const apiToken = safeTrim(process.env.REPLICATE_API_TOKEN);
    const trainingId = persona.training_id ?? persona.model_id;
    const trainingBaseModel = safeTrim(persona.training_base_model ?? persona.trainingBaseModel);
    const usesFalTraining = isFalTrainingJobId(trainingId);
    const dbStatus = mapTrainingStatus(persona.status);
    if (dbStatus === 'failed' || dbStatus === 'canceled') {
      return NextResponse.json({
        status: dbStatus,
        source,
        progress: null,
        error:
          persona?.error_message
          || (dbStatus === 'canceled' ? 'Training canceled by user.' : 'Training failed.'),
      });
    }

    let mappedStatus = 'training';
    let progress: number | null = null;
    let weightsUrlFromTraining = '';
    let trainingError: string | null = null;
    try {
      if (usesFalTraining) {
        if (!trainingBaseModel) {
          throw new Error('Training engine metadata is missing.');
        }
        const fal = ensureFalConfigured();
        const requestId = decodeFalTrainingJobId(trainingId);
        const queueStatus = await fal.queue.status(trainingBaseModel, {
          requestId,
          logs: true,
        } as any);
        mappedStatus = mapFalTrainingStatus((queueStatus as any)?.status);
        trainingError = safeTrim((queueStatus as any)?.error || (queueStatus as any)?.detail) || null;
        if (mappedStatus === 'completed') {
          const result = await fal.queue.result(trainingBaseModel, { requestId } as any);
          weightsUrlFromTraining = extractFalWeightsUrl(result);
          trainingError = null;
        }
      } else {
        if (!apiToken) {
          return NextResponse.json(
            { error: 'REPLICATE_API_TOKEN not configured' },
            { status: 500 }
          );
        }
        const replicate = new Replicate({ auth: apiToken });
        const training = await replicate.trainings.get(trainingId);
        const rawStatus = training?.status;
        mappedStatus = mapTrainingStatus(rawStatus);
        progress = normalizeProgress((training as any)?.progress ?? (training as any)?.metrics?.progress ?? (training as any)?.metrics?.percent);
        trainingError = safeTrim(training?.error) || null;
        if (mappedStatus === 'completed') {
          weightsUrlFromTraining = extractWeightsUrlFromTraining(training);
          trainingError = null;
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
              await cancelTraining(trainingId, apiToken);
              mappedStatus = 'failed';
            }
          }
        }
      }
    } catch {
      if (!usesFalTraining && apiToken) {
        await cancelTraining(trainingId, apiToken);
      }
      if (supabase && !supabaseError && persona?.id) {
        await supabase
          .from('personas')
          .update({ status: 'failed', error_message: 'Unable to reach training provider.' })
          .eq('id', persona.id);
      }
      await updatePersonasById(trainingId, {
        status: 'failed',
        visualStatus: 'none',
        errorMessage: 'Unable to reach training provider.',
      }).catch(() => undefined);
      return NextResponse.json({ status: 'failed', source, progress: null, error: 'Unable to reach training provider.' });
    }

    const completedAt = new Date().toISOString();
    const localForTrainingId = mappedStatus === 'completed'
      ? await findPersonaById(trainingId)
      : null;
    const persistedWeightsUrl = mappedStatus === 'completed'
      ? safeTrim(weightsUrlFromTraining || localForTrainingId?.weightsUrl || localForTrainingId?.huggingFaceUrl)
      : '';

    if (mappedStatus === 'completed' && supabase && !supabaseError) {
      const completedPayload = {
        status: 'completed',
        completed_at: completedAt,
        error_message: null,
        ...(persistedWeightsUrl ? { weights_url: persistedWeightsUrl } : {}),
      };
      let updateResult = await supabase
        .from('personas')
        .update(completedPayload)
        .eq('id', persona.id);
      if (updateResult.error && isMissingColumn(updateResult.error, 'weights_url')) {
        updateResult = await supabase
          .from('personas')
          .update({ status: 'completed', completed_at: completedAt, error_message: null })
          .eq('id', persona.id);
      }
      if (updateResult.error) {
        console.warn('[persona-training-status] Failed to persist completed status to Supabase:', updateResult.error);
      }
    }

    if (mappedStatus === 'completed') {
      await updatePersonasById(trainingId, {
        status: 'completed',
        visualStatus: 'ready',
        completedAt,
        errorMessage: undefined,
        ...(persistedWeightsUrl ? { weightsUrl: persistedWeightsUrl } : {}),
        ...(localForTrainingId?.modelFamily ? { modelFamily: localForTrainingId.modelFamily } : {}),
        ...(localForTrainingId?.destinationModel ? { destinationModel: localForTrainingId.destinationModel } : {}),
        ...(localForTrainingId?.trainingBaseModel ? { trainingBaseModel: localForTrainingId.trainingBaseModel } : {}),
      }).catch(() => undefined);
    }

    // Best-effort: when training completes, upload weights to Hugging Face and persist the URL in local storage.
    // Never fail the status endpoint if HF is unavailable.
    if (mappedStatus === 'completed') {
      void (async () => {
        try {
          const refreshedLocal = await findPersonaById(trainingId);
          const modelFamily = String(refreshedLocal?.modelFamily || '').trim().toLowerCase();
          const isFluxModelFamily = !modelFamily || modelFamily === 'flux-lora';
          const alreadyHasHf =
            Boolean(refreshedLocal?.huggingFaceUrl && String(refreshedLocal.huggingFaceUrl).includes('huggingface.co'))
            || Boolean(refreshedLocal?.weightsUrl && String(refreshedLocal.weightsUrl).includes('huggingface.co'));

          if (isFluxModelFamily && !alreadyHasHf && persistedWeightsUrl) {
            const resolvedWeightsUrl = persistedWeightsUrl.includes('api.replicate.com/v1/files/')
              ? await resolveReplicateDownloadUrl(persistedWeightsUrl, { token: apiToken })
              : persistedWeightsUrl;

            const media = await downloadMediaWithValidation(resolvedWeightsUrl, {
              token: apiToken,
              strictExpectedKind: false,
            });
            const normalizedWeights = normalizeLoraWeightsBuffer(media.buffer, resolvedWeightsUrl);
            if (normalizedWeights.kind !== 'safetensors') {
              throw new Error('Training weights could not be normalized to a safetensors file.');
            }

            const fileName = `${trainingId}_weights.${normalizedWeights.extension}`;
            const tempPath = path.join(os.tmpdir(), fileName);
            await fs.writeFile(tempPath, normalizedWeights.buffer);
            try {
              const repoId = 'shah1112/seedance-loras';
              const hf = new HuggingFaceService();
              const remotePath = `personas/${trainingId}/${fileName}`;
              const hfUrl = await hf.uploadLoRA(tempPath, repoId, {
                repoType: 'dataset',
                branch: 'main',
                remotePath,
              });

              await updatePersonasById(trainingId, {
                status: 'completed',
                visualStatus: 'ready',
                huggingFaceUrl: hfUrl,
                weightsUrl: hfUrl,
                ...(refreshedLocal?.modelFamily ? { modelFamily: refreshedLocal.modelFamily } : {}),
                ...(refreshedLocal?.destinationModel ? { destinationModel: refreshedLocal.destinationModel } : {}),
                ...(refreshedLocal?.trainingBaseModel ? { trainingBaseModel: refreshedLocal.trainingBaseModel } : {}),
              }).catch(() => undefined);

              if (supabase && !supabaseError && persona?.id) {
                const hfUpdate = await supabase
                  .from('personas')
                  .update({ huggingface_url: hfUrl, weights_url: hfUrl })
                  .eq('id', persona.id);
                if (
                  hfUpdate.error
                  && !isMissingColumn(hfUpdate.error, 'weights_url')
                  && !isMissingColumn(hfUpdate.error, 'huggingface_url')
                ) {
                  console.warn('[persona-training-status] HF URL persistence skipped:', hfUpdate.error);
                }
              }
            } finally {
              await fs.unlink(tempPath).catch(() => undefined);
            }
          }
        } catch (e) {
          console.warn('[persona-training-status] HF upload skipped:', (e as any)?.message || e);
        }
      })();
    }

    if ((mappedStatus === 'failed' || mappedStatus === 'canceled') && supabase && !supabaseError) {
      await supabase
        .from('personas')
        .update({
          status: mappedStatus,
          error_message: trainingError || (mappedStatus === 'canceled' ? 'Training canceled by user.' : 'Training failed.'),
        })
        .eq('id', persona.id);
    }

    if (mappedStatus === 'failed' || mappedStatus === 'canceled') {
      const localForTrainingId = await findPersonaById(trainingId);
      await updatePersonasById(trainingId, {
        status: mappedStatus as 'failed' | 'canceled',
        visualStatus: 'none',
        errorMessage: trainingError || (mappedStatus === 'canceled' ? 'Training canceled by user.' : 'Training failed.'),
        ...(localForTrainingId?.modelFamily ? { modelFamily: localForTrainingId.modelFamily } : {}),
        ...(localForTrainingId?.destinationModel ? { destinationModel: localForTrainingId.destinationModel } : {}),
        ...(localForTrainingId?.trainingBaseModel ? { trainingBaseModel: localForTrainingId.trainingBaseModel } : {}),
      }).catch(() => undefined);
    }

    // Only re-check Supabase if this persona actually came from Supabase.
    // Otherwise `latest` may be null and we'd incorrectly map it to "training".
    if (supabase && !supabaseError && source === 'supabase') {
      const { data: latest, error: latestError } = await supabase
        .from('personas')
        .select('status, error_message')
        .eq('id', persona.id)
        .maybeSingle();
      if (!latestError && typeof latest?.status === 'string' && latest.status.trim() !== '') {
        return NextResponse.json({
          status: mapTrainingStatus(latest?.status),
          source: 'supabase',
          progress,
          error: latest?.error_message ?? trainingError,
        });
      }
    }

    return NextResponse.json({ status: mappedStatus, source, progress, error: trainingError });
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
