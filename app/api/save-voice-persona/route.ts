import { NextRequest, NextResponse } from 'next/server';
import { requireUserId, requireVoiceTrainingAccess, requirePersonaAccess } from '@/lib/persona-guards';
import { upsertPersona } from '@/lib/persona-registry';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { personaId, user, voiceStatus } = body ?? {};

    const userCheck = requireUserId(user);
    if (!userCheck.ok) {
      return NextResponse.json(userCheck.body, { status: userCheck.status });
    }

    const premiumCheck = requireVoiceTrainingAccess(user);
    if (!premiumCheck.ok) {
      return NextResponse.json(premiumCheck.body, { status: premiumCheck.status });
    }

    if (!personaId) {
      return NextResponse.json(
        { error: 'Persona id is required', code: 'PERSONA_ID_REQUIRED' },
        { status: 400 }
      );
    }

    const ownershipCheck = await requirePersonaAccess({ user, personaId });
    if (!ownershipCheck.ok) {
      return NextResponse.json(ownershipCheck.body, { status: ownershipCheck.status });
    }

    if (voiceStatus !== 'ready' && voiceStatus !== 'training') {
      return NextResponse.json(
        { error: 'Invalid voice status', code: 'VOICE_STATUS_INVALID' },
        { status: 400 }
      );
    }

    await upsertPersona({
      personaId,
      userId: userCheck.userId,
      voiceStatus,
    });

    return NextResponse.json({ success: true, status: voiceStatus });
  } catch (error: any) {
    console.error('Save voice persona error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to save voice persona', code: 'VOICE_SAVE_FAILED' },
      { status: 500 }
    );
  }
}
