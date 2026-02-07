import { NextRequest, NextResponse } from 'next/server';
import Replicate from 'replicate';
import { getSupabaseAdminClient } from '@/lib/supabase/admin';
import { findPersonaById } from '@/lib/persona-registry';

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
const STALE_TRAINING_MINUTES = 1;
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
      }
    }

    if (!persona) {
      return NextResponse.json(
        { error: 'Persona not found' },
        { status: 404 }
      );
    }

    const dbStatus = mapTrainingStatus(persona.status);
    if (dbStatus !== 'training') {
      return NextResponse.json({ status: dbStatus, source, progress: null });
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
    let mappedStatus = 'training';
    let progress: number | null = null;
    try {
      const training = await replicate.trainings.get(trainingId);
      const rawStatus = training?.status;
      mappedStatus = mapTrainingStatus(rawStatus);
      progress = normalizeProgress((training as any)?.progress ?? (training as any)?.metrics?.progress ?? (training as any)?.metrics?.percent);
      if (
        rawStatus === 'starting'
        || rawStatus === 'processing'
        || rawStatus === 'queued'
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
      return NextResponse.json({ status: 'failed', source, progress: null });
    }

    if (mappedStatus === 'completed' && supabase && !supabaseError) {
      await supabase
        .from('personas')
        .update({ status: 'completed', completed_at: new Date().toISOString() })
        .eq('id', persona.id);
    }

    if (mappedStatus === 'failed' && supabase && !supabaseError) {
      await cancelTraining(trainingId, apiToken.trim());
      await supabase
        .from('personas')
        .update({ status: 'failed' })
        .eq('id', persona.id);
    }

    if (supabase && !supabaseError) {
      const { data: latest, error: latestError } = await supabase
        .from('personas')
        .select('status')
        .eq('id', persona.id)
        .maybeSingle();
      if (!latestError) {
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
