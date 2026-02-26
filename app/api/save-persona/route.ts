import { NextRequest, NextResponse } from 'next/server';
import { requireUserId, requireVisualTrainingAccess, requirePersonaAccess } from '@/lib/persona-guards';
import { readPersonas, upsertPersona, type PersonaRecord } from '@/lib/persona-registry';
import { getSupabaseAdminClient } from '@/lib/supabase/admin';
import { downloadMediaWithValidation } from '@/lib/replicate-media';
import { resolveReplicateDownloadUrl } from '@/lib/replicate-media';
import { getStorageProvider, makeStorageObjectKey } from '@/lib/storage';
import HuggingFaceService from '@/lib/huggingface-service';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const isMissingColumn = (error: any, column: string) => {
  const message = String(error?.message || error || '');
  const lower = message.toLowerCase();
  const colLower = String(column || '').toLowerCase();
  // PostgREST can report missing columns in multiple formats.
  return (
    (lower.includes(`column "${colLower}"`) && lower.includes('does not exist'))
    || lower.includes(`could not find the '${colLower}' column`)
    || lower.includes(`could not find the "${colLower}" column`)
  );
};

const isLocalLikeUrl = (value: string) =>
  value.startsWith('/')
  || value.includes('localhost')
  || value.includes('127.0.0.1')
  || value.includes('0.0.0.0');

const isProbablySafetensorsPath = (value: string) =>
  typeof value === 'string' && value.trim().toLowerCase().endsWith('.safetensors');

const safeTrim = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
const isGender = (value: unknown): value is 'male' | 'female' => value === 'male' || value === 'female';

const resolveWeightsSource = (personaData: any) => {
  const weightsUrl =
    safeTrim(personaData?.weightsUrl)
    || safeTrim(personaData?.weights_url)
    || safeTrim(personaData?.weightsURL)
    || safeTrim(personaData?.loraWeightsUrl)
    || safeTrim(personaData?.lora_weights_url)
    || safeTrim(personaData?.lora_weights);

  const localWeightsPath =
    safeTrim(personaData?.localWeightsPath)
    || safeTrim(personaData?.weightsPath)
    || safeTrim(personaData?.safetensorsPath)
    || safeTrim(personaData?.safetensors_path)
    || safeTrim(personaData?.localSafetensorsPath);

  return { weightsUrl, localWeightsPath };
};

const resolveWeightsUrlFromReplicateTraining = async (trainingId: string, token: string) => {
  const id = safeTrim(trainingId);
  if (!id) return '';
  if (!token?.trim()) return '';
  const response = await fetch(`https://api.replicate.com/v1/trainings/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Token ${token.trim()}` },
  });
  const text = await response.text();
  if (!response.ok) {
    console.warn('[save-persona] replicate training lookup failed', response.status, text.slice(0, 300));
    return '';
  }
  let payload: any = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }
  const output = payload?.output ?? {};
  const weights =
    (typeof output?.weights === 'string' ? output.weights : '')
    || (typeof output?.weights_url === 'string' ? output.weights_url : '')
    || '';
  return safeTrim(weights);
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

    // --- Optional: Upload LoRA weights to Hugging Face and persist the resolve URL ---
    // Supports:
    // - Replicate file URLs (https://api.replicate.com/v1/files/...)
    // - Public HTTP(S) URLs to .safetensors
    // - Local server file paths to .safetensors
    let { weightsUrl: weightsUrlInput, localWeightsPath } = resolveWeightsSource(personaData);
    const existingHuggingFaceUrl = safeTrim(personaData?.huggingFaceUrl) || safeTrim(personaData?.huggingface_url);

    // If caller didn't provide a direct weights URL but we have a Replicate training id, try to resolve weights_url.
    if (!weightsUrlInput && !localWeightsPath) {
      const replicateToken = process.env.REPLICATE_API_TOKEN || '';
      const trainingId = safeTrim(personaData?.trainingId) || safeTrim(personaData?.training_id);
      if (trainingId) {
        weightsUrlInput = await resolveWeightsUrlFromReplicateTraining(trainingId, replicateToken);
      }
    }

    const shouldUploadWeights = Boolean((weightsUrlInput || localWeightsPath) && !existingHuggingFaceUrl);

    let huggingFaceUrlToPersist = existingHuggingFaceUrl;
    let tempWeightsPath: string | null = null;
    if (shouldUploadWeights) {
      const repoId = 'shah1112/seedance-loras';
      const hf = new HuggingFaceService();

      // Resolve weights to a local file path (download if needed).
      let uploadPath = localWeightsPath;
      if (!uploadPath && weightsUrlInput) {
        const token = process.env.REPLICATE_API_TOKEN || '';
        const media = await downloadMediaWithValidation(weightsUrlInput, {
          token,
          strictExpectedKind: false,
          logger: {
            info: (...args) => console.log(...args),
            warn: (...args) => console.warn(...args),
          },
        });
        const ext = isProbablySafetensorsPath(weightsUrlInput)
          ? 'safetensors'
          : 'safetensors';
        tempWeightsPath = path.join(os.tmpdir(), `lora-${personaData.personaId}-${Date.now()}.${ext}`);
        await fs.writeFile(tempWeightsPath, media.buffer);
        uploadPath = tempWeightsPath;
      }

      if (!uploadPath) {
        return NextResponse.json(
          { error: 'Missing LoRA weights source (weightsUrl or localWeightsPath).', code: 'LORA_SOURCE_MISSING' },
          { status: 400 }
        );
      }

      // Upload into a deterministic repo subpath so multiple personas can coexist.
      const remoteFileName = path.basename(uploadPath);
      const remotePath = `personas/${personaData.personaId}/${remoteFileName}`;

      try {
        huggingFaceUrlToPersist = await hf.uploadLoRA(uploadPath, repoId, {
          repoType: 'dataset',
          branch: 'main',
          remotePath,
        });
      } catch (error: any) {
        console.error('Hugging Face LoRA upload failed:', error);
        return NextResponse.json(
          { error: error?.message || 'Hugging Face upload failed', code: 'HF_UPLOAD_FAILED' },
          { status: 502 }
        );
      } finally {
        // Cleanup temporary local files we created (never delete arbitrary user paths).
        if (tempWeightsPath) {
          try {
            await fs.unlink(tempWeightsPath);
          } catch {
            // ignore
          }
        }
      }
    }

    const imageUrl = typeof personaData.image_url === 'string'
      ? personaData.image_url.trim()
      : typeof personaData.imageUrl === 'string'
        ? personaData.imageUrl.trim()
        : '';
    let storagePath = typeof personaData.storage_path === 'string'
      ? personaData.storage_path.trim()
      : typeof personaData.storagePath === 'string'
        ? personaData.storagePath.trim()
        : '';
    // Do not hard-fail on missing image URL: persona should still be persisted (at least locally)
    // and appear in lists, even if preview image upload failed.

    let persistedImageUrl = imageUrl;
    if (!storagePath && (imageUrl.includes('api.replicate.com/v1/files/') || isLocalLikeUrl(imageUrl))) {
      try {
        const token = process.env.REPLICATE_API_TOKEN || '';
        const absoluteImageUrl = imageUrl.startsWith('/')
          ? new URL(imageUrl, request.nextUrl.origin).toString()
          : imageUrl;
        // Replicate files endpoints sometimes return JSON metadata for non-image assets (e.g. ZIP).
        // Resolve to a direct downloadable URL before attempting validation.
        const resolvedUrl = absoluteImageUrl.includes('api.replicate.com/v1/files/')
          ? await resolveReplicateDownloadUrl(absoluteImageUrl, {
            token,
            logger: {
              info: (...args) => console.log(...args),
              warn: (...args) => console.warn(...args),
            },
          })
          : absoluteImageUrl;
        const media = await downloadMediaWithValidation(resolvedUrl, {
          token,
          expectedKind: 'image',
          strictExpectedKind: true,
          logger: {
            info: (...args) => console.log(...args),
            warn: (...args) => console.warn(...args),
          },
        });
        const provider = getStorageProvider();
        storagePath = makeStorageObjectKey(`personas/${userCheck.userId}`, media.contentType, 'persona.jpg');
        await provider.upload(media.buffer, media.contentType, storagePath);
        persistedImageUrl = await provider.getSignedUrl(storagePath, 60 * 60 * 6);
      } catch (error) {
        console.warn('Persona image storage copy skipped:', error);
      }
    } else if (storagePath) {
      try {
        const provider = getStorageProvider();
        persistedImageUrl = await provider.getSignedUrl(storagePath, 60 * 60 * 6);
      } catch (error) {
        console.warn('Persona storage_path signed URL resolve failed:', error);
      }
    }

    const record: PersonaRecord = {
      personaId: personaData.personaId,
      userId: userCheck.userId,
      name: personaData.name,
      triggerWord: personaData.triggerWord,
      gender: isGender(personaData.gender) ? personaData.gender : (isGender(personaData?.persona_gender) ? personaData.persona_gender : undefined),
      modelId: personaData.modelId,
      trainingId: personaData.trainingId,
      createdAt: personaData.createdAt,
      imageCount: personaData.imageCount,
      imageUrl: persistedImageUrl || undefined,
      storagePath: storagePath || undefined,
      status: personaData.status ?? 'training',
      visualStatus: personaData.visualStatus ?? 'ready',
      // Persist HF URL in both fields for compatibility.
      huggingFaceUrl: huggingFaceUrlToPersist || undefined,
      weightsUrl: huggingFaceUrlToPersist || personaData.weightsUrl || personaData.weights_url || undefined,
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
    const statusStr = record.status as string | undefined;
    const normalizedStatus =
      statusStr === 'active' ? 'completed' : (record.status ?? 'training');
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

    const basePayload: Record<string, any> = {
      user_id: record.userId,
      model_id: record.modelId,
      name: record.name,
      trigger_word: record.triggerWord,
      gender: record.gender,
      status: normalizedStatus,
      created_at: record.createdAt ?? new Date().toISOString(),
      ...(record.imageUrl ? { image_url: record.imageUrl } : {}),
      storage_path: record.storagePath,
      // Optional HF weights link fields. These columns might not exist; we handle that below.
      weights_url: record.weightsUrl,
      huggingface_url: record.huggingFaceUrl,
      // Alternate camelCase column names for some setups (best-effort).
      weightsUrl: record.weightsUrl,
      huggingFaceUrl: record.huggingFaceUrl,
    };
    const payloadWithTrainingId = record.trainingId
      ? { ...basePayload, training_id: record.trainingId }
      : basePayload;
    const payloadWithoutStoragePath = Object.fromEntries(
      Object.entries(payloadWithTrainingId).filter(([key]) => key !== 'storage_path')
    );
    const payloadWithoutGender = Object.fromEntries(
      Object.entries(payloadWithTrainingId).filter(([key]) => key !== 'gender')
    );

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
      if (updateResult.error && isMissingColumn(updateResult.error, 'storage_path')) {
        updateResult = await supabase
          .from('personas')
          .update(payloadWithoutStoragePath)
          .eq('id', existingQuery.data.id);
      }
      if (updateResult.error && (isMissingColumn(updateResult.error, 'weights_url') || isMissingColumn(updateResult.error, 'huggingface_url'))) {
        const payloadWithoutWeights = Object.fromEntries(
          Object.entries(payloadWithTrainingId).filter(([key]) =>
            key !== 'weights_url' && key !== 'huggingface_url' && key !== 'weightsUrl' && key !== 'huggingFaceUrl'
          )
        );
        updateResult = await supabase
          .from('personas')
          .update(payloadWithoutWeights)
          .eq('id', existingQuery.data.id);
      }
      if (updateResult.error && isMissingColumn(updateResult.error, 'gender')) {
        updateResult = await supabase
          .from('personas')
          .update(payloadWithoutGender)
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
      if (insertResult.error && isMissingColumn(insertResult.error, 'storage_path')) {
        insertResult = await supabase
          .from('personas')
          .insert(payloadWithoutStoragePath);
      }
      if (insertResult.error && (isMissingColumn(insertResult.error, 'weights_url') || isMissingColumn(insertResult.error, 'huggingface_url'))) {
        const payloadWithoutWeights = Object.fromEntries(
          Object.entries(payloadWithTrainingId).filter(([key]) =>
            key !== 'weights_url' && key !== 'huggingface_url' && key !== 'weightsUrl' && key !== 'huggingFaceUrl'
          )
        );
        insertResult = await supabase
          .from('personas')
          .insert(payloadWithoutWeights);
      }
      if (insertResult.error && isMissingColumn(insertResult.error, 'gender')) {
        insertResult = await supabase
          .from('personas')
          .insert(payloadWithoutGender);
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

    const storagePath = (p: any) => p.storagePath ?? p.storage_path;
    const rawImageUrl = (p: any) => p.imageUrl ?? p.image_url;

    const normalizedSupabase = await Promise.all((data ?? []).map(async (persona: any) => {
      let imageUrl = rawImageUrl(persona);
      const path = storagePath(persona);
      if (path && typeof path === 'string') {
        try {
          const provider = getStorageProvider();
          const signed = await provider.getSignedUrl(path, 60 * 60 * 24);
          if (signed) imageUrl = signed;
        } catch (e) {
          console.warn('Persona signed URL failed for', persona.id, (e as Error)?.message);
        }
      }
      return {
        ...persona,
        id: persona.id ?? persona.personaId ?? persona.persona_id,
        name: persona.name ?? persona.persona_name ?? persona.display_name,
        triggerWord: persona.triggerWord ?? persona.trigger_word,
        trigger_word: persona.trigger_word ?? persona.triggerWord,
        imageUrl: imageUrl ?? persona.imageUrl ?? persona.image_url,
        image_url: imageUrl ?? persona.image_url ?? persona.imageUrl,
        storagePath: persona.storagePath ?? persona.storage_path,
        storage_path: persona.storage_path ?? persona.storagePath,
        status: persona.status === 'active' ? 'completed' : persona.status,
      };
    }));

    // Merge local personas so newly trained personas always appear even if Supabase insert fails.
    const local = await readPersonas().catch(() => []);
    const localFiltered = (userId ? local.filter(p => p.userId === userId) : local)
      .filter((p) => p.status !== 'failed');
    const localNormalized = localFiltered.map((p) => ({
      id: p.personaId,
      user_id: p.userId,
      model_id: p.modelId ?? p.trainingId ?? p.personaId,
      training_id: p.trainingId ?? null,
      name: p.name ?? null,
      trigger_word: p.triggerWord ?? null,
      triggerWord: p.triggerWord ?? null,
      image_url: p.imageUrl ?? null,
      imageUrl: p.imageUrl ?? null,
      storage_path: p.storagePath ?? null,
      storagePath: p.storagePath ?? null,
      status: p.status ?? 'training',
      type: 'visual',
      created_at: p.createdAt ?? null,
    }));

    const byKey = (row: any) => row?.training_id ?? row?.model_id ?? row?.id;
    const map = new Map<string, any>();
    for (const row of localNormalized) {
      const key = String(byKey(row) || row.id || '');
      if (key) map.set(key, row);
    }
    for (const row of normalizedSupabase) {
      if (String(row?.status || '').toLowerCase() === 'failed') continue;
      const key = String(byKey(row) || row.id || '');
      if (!key) continue;
      const prev = map.get(key);
      map.set(key, prev ? { ...prev, ...row } : row);
    }

    return NextResponse.json({ personas: Array.from(map.values()) });
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
