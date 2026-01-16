import { NextRequest, NextResponse } from 'next/server';
import { requireUserId, requireVisualTrainingAccess, requirePersonaAccess } from '@/lib/persona-guards';
import { upsertPersona, type PersonaRecord } from '@/lib/persona-registry';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const personaData = body.persona ?? body;
    const user = body.user;

    const userCheck = requireUserId(user);
    if (!userCheck.ok) {
      return NextResponse.json(userCheck.body, { status: userCheck.status });
    }

    const premiumCheck = requireVisualTrainingAccess(user);
    if (!premiumCheck.ok) {
      return NextResponse.json(premiumCheck.body, { status: premiumCheck.status });
    }

    if (!personaData.personaId) {
      return NextResponse.json(
        { error: 'Persona id is required', code: 'PERSONA_ID_REQUIRED' },
        { status: 400 }
      );
    }

    const ownershipCheck = await requirePersonaAccess({ user, personaId: personaData.personaId });
    if (!ownershipCheck.ok && ownershipCheck.body.code !== 'PERSONA_NOT_FOUND') {
      return NextResponse.json(ownershipCheck.body, { status: ownershipCheck.status });
    }

    if (!personaData.triggerWord || !personaData.modelId) {
      return NextResponse.json(
        { error: 'Trigger word and model ID are required', code: 'PERSONA_DATA_REQUIRED' },
        { status: 400 }
      );
    }

    const record: PersonaRecord = {
      personaId: personaData.personaId,
      userId: userCheck.userId,
      triggerWord: personaData.triggerWord,
      modelId: personaData.modelId,
      trainingId: personaData.trainingId,
      createdAt: personaData.createdAt,
      imageCount: personaData.imageCount,
      visualStatus: 'ready',
    };

    await upsertPersona(record);

    return NextResponse.json({
      success: true,
      message: 'Persona saved successfully',
      persona: record,
    });

  } catch (error: any) {
    console.error('Save persona error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to save persona' },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const { readPersonas } = await import('@/lib/persona-registry');
    const personas = await readPersonas();
    return NextResponse.json({ personas });
  } catch (error: any) {
    console.error('Get personas error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to get personas' },
      { status: 500 }
    );
  }
}
