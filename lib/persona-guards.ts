import type { User } from '@/lib/subscription';
import { canUsePersona, canTrainVisualPersona, canTrainVoicePersona } from '@/lib/subscription';
import { findPersonaById, type PersonaRecord, type PersonaStatus } from '@/lib/persona-registry';

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
}): Promise<GuardResult> {
  const { user, personaId, requireReady } = options;
  const userCheck = requireUserId(user);
  if (!userCheck.ok) return userCheck;

  if (!personaId) {
    return {
      ok: false,
      status: 400,
      body: { error: 'Persona id is required', code: 'PERSONA_ID_REQUIRED' },
    };
  }

  const persona = await findPersonaById(personaId);
  if (!persona) {
    return {
      ok: false,
      status: 404,
      body: { error: 'Persona not found', code: 'PERSONA_NOT_FOUND' },
    };
  }

  if (persona.userId !== userCheck.userId) {
    return {
      ok: false,
      status: 403,
      body: { error: 'Persona ownership mismatch', code: 'PERSONA_NOT_OWNED' },
    };
  }

  if (requireReady) {
    const status: PersonaStatus | undefined =
      requireReady === 'visual' ? persona.visualStatus : persona.voiceStatus;
    if (status !== 'ready') {
      return {
        ok: false,
        status: 409,
        body: { error: 'Persona is not ready', code: 'PERSONA_NOT_READY' },
      };
    }
  }

  return { ok: true, userId: userCheck.userId, persona };
}
