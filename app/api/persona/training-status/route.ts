import { NextRequest, NextResponse } from 'next/server';
import Replicate from 'replicate';
import { createClient } from '@supabase/supabase-js';

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

const normalizeProgress = (value: unknown): number | null => {
  if (typeof value !== 'number' || Number.isNaN(value)) return null;
  if (value <= 1) return Math.max(0, Math.min(100, Math.round(value * 100)));
  if (value <= 100) return Math.max(0, Math.min(100, Math.round(value)));
  return null;
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

  const isUuid = (value: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
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

  if (!persona?.training_id) {
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
    const training = await replicate.trainings.get(persona.training_id);
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
          await cancelTraining(persona.training_id, replicateToken.trim());
          trainingStatus = 'failed';
        }
      }
    }
  } catch (error) {
    await cancelTraining(persona.training_id, replicateToken.trim());
    return NextResponse.json({ status: 'failed', progress: null });
  }

  if (trainingStatus === 'succeeded') {
    await supabase
      .from('personas')
      .update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('id', persona.id);
  }

  if (trainingStatus === 'failed' || trainingStatus === 'canceled') {
    await cancelTraining(persona.training_id, replicateToken.trim());
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

  const { data: persona, error } = await supabase
    .from('personas')
    .select('id, training_id, model_id')
    .or(`training_id.eq.${personaId},model_id.eq.${personaId}`)
    .maybeSingle();

  if (error || !persona?.training_id) {
    return NextResponse.json({ error: 'Training not found' }, { status: 404 });
  }

  await cancelTraining(persona.training_id, replicateToken.trim());
  await supabase
    .from('personas')
    .update({ status: 'failed' })
    .eq('id', persona.id);

  return NextResponse.json({ status: 'failed' });
}
