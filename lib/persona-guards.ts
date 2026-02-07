import type { User } from '@/lib/subscription';
import { canUsePersona, canTrainVisualPersona, canTrainVoicePersona } from '@/lib/subscription';
import { findPersonaById, readPersonas, type PersonaRecord, type PersonaStatus, type PersonaTrainingStatus } from '@/lib/persona-registry';

type GuardFailure = { ok: false; status: number; body: { error: string; code: string } };
type GuardSuccess = { ok: true; userId: string; persona?: PersonaRecord };
export type GuardResult = GuardFailure | GuardSuccess;

export function requireUserId(user?: User | null): GuardResult {
  if (!user?.id) {
    return {
      ok: false,
      status: 401,
      body: { error: 'User id is required', code: 'USER_REQUIRED' },
    };
  }
  return { ok: true, userId: user.id };
}

export function requirePremium(user?: User | null): GuardResult {
  if (!canUsePersona(user)) {
    return {
      ok: false,
      status: 403,
      body: { error: 'Premium subscription required', code: 'SUBSCRIPTION_REQUIRED' },
    };
  }
  return { ok: true, userId: user?.id ?? '' };
}

export function requireVisualTrainingAccess(user?: User | null): GuardResult {
  if (!canTrainVisualPersona(user)) {
    return {
      ok: false,
      status: 403,
      body: { error: 'Premium subscription required for visual personas', code: 'SUBSCRIPTION_REQUIRED' },
    };
  }
  return { ok: true, userId: user?.id ?? '' };
}

export function requireVoiceTrainingAccess(user?: User | null): GuardResult {
  if (!canTrainVoicePersona(user)) {
    return {
      ok: false,
      status: 403,
      body: { error: 'Premium subscription required for voice personas', code: 'SUBSCRIPTION_REQUIRED' },
    };
  }
  return { ok: true, userId: user?.id ?? '' };
}

export async function requirePersonaAccess(options: {
  user?: User | null;
  personaId?: string;
  requireReady?: 'visual' | 'voice';
  allowCrossUser?: boolean;
}): Promise<GuardResult> {
  const { user, personaId, requireReady, allowCrossUser } = options;
  const userCheck = requireUserId(user);
  if (!userCheck.ok) return userCheck;

  if (!personaId) {
    return {
      ok: false,
      status: 400,
      body: { error: 'Persona id is required', code: 'PERSONA_ID_REQUIRED' },
    };
  }

  let persona = await findPersonaById(personaId);
  let allPersonas: PersonaRecord[] | null = null;
  if (!persona) {
    allPersonas = await readPersonas();
    persona = allPersonas.find(record => (
      record.modelId === personaId
      || (record as any).model_id === personaId
      || record.destinationModel === personaId
      || record.trainingId === personaId
    ));
  }
  if (!persona) {
    const personas = allPersonas ?? await readPersonas();
    const availableIds = personas.map(record => record.personaId);
    const availableModelIds = personas
      .map(record => record.modelId || (record as any).model_id || record.destinationModel || record.trainingId)
      .filter(Boolean);
    console.warn('Persona not found for id:', personaId, {
      availablePersonaIds: availableIds.slice(0, 50),
      availableModelIds: availableModelIds.slice(0, 50),
      totalPersonas: personas.length,
    });
    return {
      ok: false,
      status: 404,
      body: { error: 'Persona not found', code: 'PERSONA_NOT_FOUND' },
    };
  }

  if (!allowCrossUser && persona.userId !== userCheck.userId) {
    return {
      ok: false,
      status: 403,
      body: { error: 'Persona ownership mismatch', code: 'PERSONA_NOT_OWNED' },
    };
  }

  if (requireReady) {
    if (requireReady === 'visual') {
      const trainingStatus: PersonaTrainingStatus | undefined = persona.status;
      const fallbackVisual: PersonaStatus | undefined = persona.visualStatus;
      const isActive = trainingStatus
        ? trainingStatus === 'completed'
        : fallbackVisual === 'ready';
      if (!isActive) {
        return {
          ok: false,
          status: 409,
          body: { error: 'Persona is not ready', code: 'PERSONA_NOT_READY' },
        };
      }
    } else {
      const status: PersonaStatus | undefined = persona.voiceStatus;
      if (status !== 'ready') {
        return {
          ok: false,
          status: 409,
          body: { error: 'Persona is not ready', code: 'PERSONA_NOT_READY' },
        };
      }
    }
  }

  return { ok: true, userId: userCheck.userId, persona };
}
