import { NextRequest, NextResponse } from 'next/server';
import { requireUserId, requireVisualTrainingAccess, requirePersonaAccess } from '@/lib/persona-guards';
import { upsertPersona, type PersonaRecord } from '@/lib/persona-registry';
import { getSupabaseAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const isMissingColumn = (error: any, column: string) => {
  const message = String(error?.message || error || '');
  return message.toLowerCase().includes(`column "${column}"`) && message.toLowerCase().includes('does not exist');
};

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
    const imageUrl = typeof personaData.image_url === 'string'
      ? personaData.image_url.trim()
      : typeof personaData.imageUrl === 'string'
        ? personaData.imageUrl.trim()
        : '';
    if (!imageUrl) {
      return NextResponse.json(
        { error: 'Image upload failed. Please try again.' },
        { status: 400 }
      );
    }

    const record: PersonaRecord = {
      personaId: personaData.personaId,
      userId: userCheck.userId,
      name: personaData.name,
      triggerWord: personaData.triggerWord,
      modelId: personaData.modelId,
      trainingId: personaData.trainingId,
      createdAt: personaData.createdAt,
      imageCount: personaData.imageCount,
      imageUrl,
      status: personaData.status ?? 'training',
      visualStatus: personaData.visualStatus ?? 'ready',
    };

    await upsertPersona(record);

    const { client: supabase, error: supabaseError } = getSupabaseAdminClient();
    if (!supabase || supabaseError) {
      console.error('Supabase unavailable, saved locally only.', supabaseError);
      return NextResponse.json({
        success: true,
        message: 'Persona saved locally only',
        warning: supabaseError || 'Supabase not configured',
        persona: record,
      });
    }
    const normalizedStatus =
      record.status === 'active' ? 'completed' : record.status ?? 'training';
    const buildMatchParts = (includeTrainingId: boolean) => {
      const parts: string[] = [];
      if (includeTrainingId && record.trainingId) parts.push(`training_id.eq.${record.trainingId}`);
      if (record.modelId) parts.push(`model_id.eq.${record.modelId}`);
      parts.push(`id.eq.${record.personaId}`);
      return parts;
    };

    const isUuid = (value: string) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

    const matchParts = buildMatchParts(true).filter(part => {
      if (!part.startsWith('id.eq.')) return true;
      const idValue = part.replace('id.eq.', '');
      return isUuid(idValue);
    });

    let existingQuery = matchParts.length === 0
      ? { data: null, error: null }
      : await supabase
        .from('personas')
        .select('id')
        .or(matchParts.join(','))
        .maybeSingle();

    if (existingQuery.error && isMissingColumn(existingQuery.error, 'training_id')) {
      const fallbackParts = buildMatchParts(false).filter(part => {
        if (!part.startsWith('id.eq.')) return true;
        const idValue = part.replace('id.eq.', '');
        return isUuid(idValue);
      });
      existingQuery = fallbackParts.length === 0
        ? { data: null, error: null }
        : await supabase
          .from('personas')
          .select('id')
          .or(fallbackParts.join(','))
          .maybeSingle();
    }

    if (existingQuery.error) {
      console.error('Failed to query persona in Supabase:', existingQuery.error);
      return NextResponse.json({
        success: true,
        message: 'Persona saved locally only',
        warning: 'PERSONA_LOOKUP_FAILED',
        persona: record,
      });
    }

    const basePayload = {
      user_id: record.userId,
      model_id: record.modelId,
      name: record.name,
      trigger_word: record.triggerWord,
      status: normalizedStatus,
      created_at: record.createdAt ?? new Date().toISOString(),
      image_url: imageUrl,
    };
    const payloadWithTrainingId = record.trainingId
      ? { ...basePayload, training_id: record.trainingId }
      : basePayload;

    if (existingQuery.data?.id) {
      let updateResult = await supabase
        .from('personas')
        .update(payloadWithTrainingId)
        .eq('id', existingQuery.data.id);
      if (updateResult.error && isMissingColumn(updateResult.error, 'training_id')) {
        updateResult = await supabase
          .from('personas')
          .update(basePayload)
          .eq('id', existingQuery.data.id);
      }
      const updateError = updateResult.error;
      if (updateError) {
        console.error('Failed to update persona in Supabase:', updateError);
        return NextResponse.json({
          success: true,
          message: 'Persona saved locally only',
          warning: 'PERSONA_UPDATE_FAILED',
          persona: record,
        });
      }
    } else {
      let insertResult = await supabase
        .from('personas')
        .insert(payloadWithTrainingId);
      if (insertResult.error && isMissingColumn(insertResult.error, 'training_id')) {
        insertResult = await supabase
          .from('personas')
          .insert(basePayload);
      }
      const insertError = insertResult.error;
      if (insertError) {
        console.error('Failed to insert persona in Supabase:', insertError);
        return NextResponse.json({
          success: true,
          message: 'Persona saved locally only',
          warning: 'PERSONA_INSERT_FAILED',
          persona: record,
        });
      }
    }

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
    const { client: supabase, error: supabaseError } = getSupabaseAdminClient();
    if (!supabase || supabaseError) {
      return NextResponse.json(
        { error: supabaseError || 'Supabase not configured' },
        { status: 500 }
      );
    }

    const userId = request.nextUrl.searchParams.get('userId');
    const personaId = request.nextUrl.searchParams.get('personaId')
      || request.nextUrl.searchParams.get('id');

    let query = supabase
      .from('personas')
      .select('*')
      .order('created_at', { ascending: false });
    if (userId) {
      query = query.eq('user_id', userId);
    }
    if (personaId) {
      query = query.or(`id.eq.${personaId},training_id.eq.${personaId},model_id.eq.${personaId}`);
    }

    const { data, error } = await query;
    if (error) {
      return NextResponse.json(
        { error: 'Failed to get personas' },
        { status: 500 }
      );
    }
    console.log('📦 API FETCHED PERSONAS (Sample):', (data ?? [])[0]);

    const normalized = (data ?? []).map((persona: any) => ({
      ...persona,
      id: persona.id ?? persona.personaId ?? persona.persona_id,
      name: persona.name ?? persona.persona_name ?? persona.display_name,
      triggerWord: persona.triggerWord ?? persona.trigger_word,
      trigger_word: persona.trigger_word ?? persona.triggerWord,
      imageUrl: persona.imageUrl ?? persona.image_url,
      image_url: persona.image_url ?? persona.imageUrl,
      status: persona.status === 'active' ? 'completed' : persona.status,
    }));

    return NextResponse.json({ personas: normalized });
  } catch (error: any) {
    console.error('Get personas error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to get personas' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const { personaId, user } = body ?? {};

    const userCheck = requireUserId(user);
    if (!userCheck.ok) {
      return NextResponse.json(userCheck.body, { status: userCheck.status });
    }

    if (!personaId) {
      return NextResponse.json(
        { error: 'Persona id is required', code: 'PERSONA_ID_REQUIRED' },
        { status: 400 }
      );
    }

    const { client: supabase, error: supabaseError } = getSupabaseAdminClient();
    if (!supabase || supabaseError) {
      return NextResponse.json(
        { error: supabaseError || 'Supabase not configured', code: 'SUPABASE_MISSING' },
        { status: 500 }
      );
    }

    let deleteResult = await supabase
      .from('personas')
      .delete()
      .or(`id.eq.${personaId},training_id.eq.${personaId},model_id.eq.${personaId}`);

    if (deleteResult.error && isMissingColumn(deleteResult.error, 'training_id')) {
      deleteResult = await supabase
        .from('personas')
        .delete()
        .or(`id.eq.${personaId},model_id.eq.${personaId}`);
    }
    const deleteError = deleteResult.error;

    if (deleteError) {
      return NextResponse.json(
        { error: 'Failed to delete persona', code: 'PERSONA_DELETE_FAILED' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Delete persona error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to delete persona' },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { personaId, name, user } = body ?? {};

    const userCheck = requireUserId(user);
    if (!userCheck.ok) {
      return NextResponse.json(userCheck.body, { status: userCheck.status });
    }

    if (!personaId) {
      return NextResponse.json(
        { error: 'Persona id is required', code: 'PERSONA_ID_REQUIRED' },
        { status: 400 }
      );
    }

    if (!name || !String(name).trim()) {
      return NextResponse.json(
        { error: 'Persona name is required', code: 'PERSONA_NAME_REQUIRED' },
        { status: 400 }
      );
    }

    const ownershipCheck = await requirePersonaAccess({ user, personaId });
    if (!ownershipCheck.ok) {
      return NextResponse.json(ownershipCheck.body, { status: ownershipCheck.status });
    }

    await upsertPersona({
      personaId,
      userId: userCheck.userId,
      name: String(name).trim(),
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Rename persona error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to rename persona' },
      { status: 500 }
    );
  }
}
