import { NextRequest, NextResponse } from 'next/server';
import Replicate from 'replicate';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { ensureFalConfigured } from '@/lib/fal';
import { findPersonaById, updatePersonasById, type PersonaRecord } from '@/lib/persona-registry';
import { decodeFalTrainingJobId, isFalTrainingJobId } from '@/lib/persona-training-jobs';

const isUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

const cancelTraining = async (trainingId: string, token: string) => {
  try {
    const response = await fetch(`https://api.replicate.com/v1/trainings/${trainingId}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Token ${token}` },
    });
    const text = await response.text();
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: text || `Replicate cancel request failed with status ${response.status}.`,
      };
    }
    return { ok: true, status: response.status, error: '' };
  } catch (error) {
    console.error('Failed to cancel training:', error);
    return {
      ok: false,
      status: 0,
      error: error instanceof Error ? error.message : 'Failed to cancel training.',
    };
  }
};
const STALE_TRAINING_MINUTES = 60;

const normalizeProgress = (value: unknown): number | null => {
  if (typeof value !== 'number' || Number.isNaN(value)) return null;
  if (value <= 1) return Math.max(0, Math.min(100, Math.round(value * 100)));
  if (value <= 100) return Math.max(0, Math.min(100, Math.round(value)));
  return null;
};

const mapReplicateStatus = (status?: string) => {
  switch (String(status || '').toLowerCase()) {
    case 'completed':
    case 'succeeded':
    case 'active':
      return 'completed';
    case 'failed':
      return 'failed';
    case 'canceled':
      return 'canceled';
    default:
      return 'training';
  }
};

const mapFalTrainingStatus = (status?: string) => {
  switch (String(status || '').trim().toUpperCase()) {
    case 'COMPLETED':
      return 'completed';
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

type ProviderTrainingTerminalStatus = 'training' | 'completed' | 'failed' | 'canceled';
type ProviderTrainingSuccessState = {
  ok: true;
  status: ProviderTrainingTerminalStatus;
  rawStatus: string;
  error: string;
};
type ProviderTrainingErrorState = {
  ok: false;
  status: number;
  error: string;
};
type ProviderTrainingState = ProviderTrainingSuccessState | ProviderTrainingErrorState;

const readReplicateTraining = async (
  trainingId: string,
  token: string
): Promise<ProviderTrainingState> => {
  try {
    const response = await fetch(`https://api.replicate.com/v1/trainings/${trainingId}`, {
      headers: { Authorization: `Token ${token}` },
    });
    const text = await response.text();
    let payload: any = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = null;
    }
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: payload?.detail || payload?.error || text || `Replicate training lookup failed with status ${response.status}.`,
      };
    }
    return {
      ok: true,
      status: mapReplicateStatus(payload?.status),
      rawStatus: String(payload?.status || '').trim(),
      error: String(payload?.error || '').trim() || '',
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error: error instanceof Error ? error.message : 'Unable to reach training provider.',
    };
  }
};

const buildTerminalLocalPatch = (
  status: 'completed' | 'failed' | 'canceled',
  errorMessage?: string
): Partial<PersonaRecord> => {
  if (status === 'completed') {
    return {
      status,
      visualStatus: 'ready',
      completedAt: new Date().toISOString(),
      errorMessage: undefined,
    };
  }

  return {
    status,
    visualStatus: 'none',
    errorMessage: errorMessage || (status === 'canceled' ? 'Training canceled by user.' : 'Training failed.'),
  };
};

const resolveSupabasePersona = async (
  supabase: SupabaseClient,
  personaId: string,
  dbId?: string
) => {
  const tryIds = [
    dbId && isUuid(dbId) ? `id.eq.${dbId}` : '',
    `training_id.eq.${personaId}`,
    `model_id.eq.${personaId}`,
    isUuid(personaId) ? `id.eq.${personaId}` : '',
  ].filter(Boolean);

  let query = await supabase
    .from('personas')
    .select('id, training_id, model_id, status, training_base_model')
    .or(tryIds.join(','))
    .limit(1)
    .maybeSingle();

  if (query.error && String(query.error?.message || '').toLowerCase().includes('training_id')) {
    const fallbackIds = [
      dbId && isUuid(dbId) ? `id.eq.${dbId}` : '',
      `model_id.eq.${personaId}`,
      isUuid(personaId) ? `id.eq.${personaId}` : '',
    ].filter(Boolean);
    query = await supabase
      .from('personas')
      .select('id, model_id, status, training_base_model')
      .or(fallbackIds.join(','))
      .limit(1)
      .maybeSingle();
  }

  return query;
};

export async function GET(req: NextRequest) {
  const personaId = req.nextUrl.searchParams.get('id');

  if (!personaId) {
    return NextResponse.json({ error: 'Missing persona id' }, { status: 400 });
  }

  const replicateToken = process.env.REPLICATE_API_TOKEN;
  if (!replicateToken || !replicateToken.trim()) {
    return NextResponse.json({ error: 'REPLICATE_API_TOKEN not configured' }, { status: 500 });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  const matchParts = [
    `training_id.eq.${personaId}`,
    `model_id.eq.${personaId}`,
  ];
  if (isUuid(personaId)) {
    matchParts.push(`id.eq.${personaId}`);
  }
  const { data: persona, error } = await supabase
    .from('personas')
    .select('id, training_id, status, model_id')
    .or(matchParts.join(','))
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: 'Failed to fetch persona' }, { status: 500 });
  }

  if (!persona) {
    return NextResponse.json({ error: 'Persona not found' }, { status: 404 });
  }

  const trainingId = persona.training_id ?? persona.model_id ?? null;
  if (!trainingId) {
    return NextResponse.json({ error: 'Training not started' }, { status: 404 });
  }

  const normalizedStatus = persona.status === 'active' ? 'completed' : persona.status;
  if (normalizedStatus && normalizedStatus !== 'training') {
    return NextResponse.json({ status: normalizedStatus, progress: null });
  }

  const replicate = new Replicate({ auth: replicateToken.trim() });
  let trainingStatus = 'training';
  let progress: number | null = null;
  try {
    const training = await replicate.trainings.get(trainingId);
    trainingStatus = training.status;
    progress = normalizeProgress((training as any)?.progress ?? (training as any)?.metrics?.progress ?? (training as any)?.metrics?.percent);
    if (
      trainingStatus === 'starting'
      || trainingStatus === 'processing'
      || trainingStatus === 'queued'
    ) {
      const startedAt = training?.started_at ?? training?.created_at;
      if (startedAt) {
        const elapsedMs = Date.now() - new Date(startedAt).getTime();
        if (elapsedMs > STALE_TRAINING_MINUTES * 60 * 1000) {
          await cancelTraining(trainingId, replicateToken.trim());
          trainingStatus = 'failed';
        }
      }
    }
  } catch {
    // If we cannot reach Replicate (DNS/network/etc.), force-stop the "training" state in DB
    // so the UI doesn't stay stuck forever.
    await cancelTraining(trainingId, replicateToken.trim());
    await supabase
      .from('personas')
      .update({ status: 'failed' })
      .eq('id', persona.id);
    return NextResponse.json({ status: 'failed', progress: null });
  }

  if (trainingStatus === 'succeeded') {
    await supabase
      .from('personas')
      .update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('id', persona.id);
  }

  if (trainingStatus === 'failed' || trainingStatus === 'canceled') {
    await cancelTraining(trainingId, replicateToken.trim());
    await supabase
      .from('personas')
      .update({ status: 'failed' })
      .eq('id', persona.id);
  }

  const { data: latest, error: latestError } = await supabase
    .from('personas')
    .select('status')
    .eq('id', persona.id)
    .maybeSingle();
  if (latestError) {
    return NextResponse.json({ status: normalizedStatus ?? 'training', progress });
  }

  const latestStatus = latest?.status === 'active' ? 'completed' : latest?.status;
  return NextResponse.json({ status: latestStatus ?? 'training', progress });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const personaId = String(
    req.nextUrl.searchParams.get('id')
    || body?.personaId
    || body?.trainingId
    || body?.id
    || ''
  ).trim();
  const dbId = String(body?.dbId || '').trim();

  if (!personaId) {
    return NextResponse.json({ error: 'Missing persona id' }, { status: 400 });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const local = await findPersonaById(personaId);
  const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;
  const supabaseMatch = supabase
    ? await resolveSupabasePersona(supabase, personaId, dbId)
    : { data: null, error: null };
  const supabasePersona = !supabaseMatch.error ? supabaseMatch.data : null;

  const trainingId =
    supabasePersona?.training_id
    ?? supabasePersona?.model_id
    ?? local?.trainingId
    ?? local?.modelId
    ?? null;
  const trainingBaseModel =
    (supabasePersona as any)?.training_base_model
    ?? local?.trainingBaseModel
    ?? null;

  if (!trainingId) {
    return NextResponse.json({ error: 'Training not found' }, { status: 404 });
  }

  const usesFalTraining = isFalTrainingJobId(trainingId);
  const replicateToken = String(process.env.REPLICATE_API_TOKEN || '').trim();
  let providerState: ProviderTrainingState;

  if (usesFalTraining) {
    if (!trainingBaseModel) {
      return NextResponse.json({ error: 'Training engine metadata is missing.' }, { status: 500 });
    }
    try {
      const fal = ensureFalConfigured();
      const statusResult = await fal.queue.status(String(trainingBaseModel), {
        requestId: decodeFalTrainingJobId(trainingId),
        logs: true,
      } as any);
      providerState = {
        ok: true,
        status: mapFalTrainingStatus((statusResult as any)?.status) as 'training' | 'completed' | 'failed' | 'canceled',
        rawStatus: String((statusResult as any)?.status || ''),
        error: String((statusResult as any)?.error || (statusResult as any)?.detail || '').trim(),
      };
    } catch (error) {
      providerState = {
        ok: false,
        status: 0,
        error: error instanceof Error ? error.message : 'Unable to reach training provider.',
      };
    }
  } else {
    if (!replicateToken) {
      return NextResponse.json({ error: 'REPLICATE_API_TOKEN not configured' }, { status: 500 });
    }
    providerState = await readReplicateTraining(trainingId, replicateToken);
  }

  if (providerState.ok && providerState.status !== 'training') {
    const terminalStatus = providerState.status as 'completed' | 'failed' | 'canceled';
    const terminalMessage =
      terminalStatus === 'completed'
        ? ''
        : providerState.error || (terminalStatus === 'canceled' ? 'Training canceled by user.' : 'Training failed.');

    if (supabase && supabasePersona?.id) {
      await supabase
        .from('personas')
        .update({
          status: terminalStatus,
          error_message: terminalStatus === 'completed' ? null : terminalMessage,
          ...(terminalStatus === 'completed' ? { completed_at: new Date().toISOString() } : {}),
        })
        .eq('id', supabasePersona.id);
    }

    await updatePersonasById(trainingId, buildTerminalLocalPatch(terminalStatus, terminalMessage)).catch(() => undefined);

    return NextResponse.json({
      status: terminalStatus,
      source: supabasePersona?.id ? 'supabase' : 'local',
      error: terminalStatus === 'completed' ? null : terminalMessage,
    });
  }

  if (usesFalTraining) {
    try {
      const fal = ensureFalConfigured();
      await fal.queue.cancel(String(trainingBaseModel), {
        requestId: decodeFalTrainingJobId(trainingId),
      } as any);
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Training could not be canceled.' },
        { status: 502 }
      );
    }

    if (supabase && supabasePersona?.id) {
      await supabase
        .from('personas')
        .update({ status: 'canceled', error_message: 'Training canceled by user.' })
        .eq('id', supabasePersona.id);
    }

    await updatePersonasById(trainingId, buildTerminalLocalPatch('canceled', 'Training canceled by user.')).catch(() => undefined);

    return NextResponse.json({
      status: 'canceled',
      source: supabasePersona?.id ? 'supabase' : 'local',
    });
  }

  const cancelResult = await cancelTraining(trainingId, replicateToken);
  if (!cancelResult.ok) {
    const afterCancelState = await readReplicateTraining(trainingId, replicateToken.trim());
    if (afterCancelState.ok && afterCancelState.status !== 'training') {
      const terminalStatus = afterCancelState.status as 'completed' | 'failed' | 'canceled';
      const terminalMessage =
        terminalStatus === 'completed'
          ? ''
          : afterCancelState.error || (terminalStatus === 'canceled' ? 'Training canceled by user.' : 'Training failed.');

      if (supabase && supabasePersona?.id) {
        await supabase
          .from('personas')
          .update({
            status: terminalStatus,
            error_message: terminalStatus === 'completed' ? null : terminalMessage,
            ...(terminalStatus === 'completed' ? { completed_at: new Date().toISOString() } : {}),
          })
          .eq('id', supabasePersona.id);
      }

      await updatePersonasById(trainingId, buildTerminalLocalPatch(terminalStatus, terminalMessage)).catch(() => undefined);

      return NextResponse.json({
        status: terminalStatus,
        source: supabasePersona?.id ? 'supabase' : 'local',
        error: terminalStatus === 'completed' ? null : terminalMessage,
      });
    }

    return NextResponse.json(
      { error: cancelResult.error || 'Training could not be canceled.' },
      { status: 502 }
    );
  }

  if (supabase && supabasePersona?.id) {
    await supabase
      .from('personas')
      .update({ status: 'canceled', error_message: 'Training canceled by user.' })
      .eq('id', supabasePersona.id);
  }

  await updatePersonasById(trainingId, buildTerminalLocalPatch('canceled', 'Training canceled by user.')).catch(() => undefined);

  return NextResponse.json({
    status: 'canceled',
    source: supabasePersona?.id ? 'supabase' : 'local',
  });
}
