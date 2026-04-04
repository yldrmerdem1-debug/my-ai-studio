import { NextRequest, NextResponse } from 'next/server';
import { requireUserId, requireVisualTrainingAccess, requirePersonaAccess } from '@/lib/persona-guards';
import { readPersonas, upsertPersona, type PersonaRecord } from '@/lib/persona-registry';
import { getSupabaseAdminClient } from '@/lib/supabase/admin';
import { downloadMediaWithValidation } from '@/lib/replicate-media';
import { resolveReplicateDownloadUrl } from '@/lib/replicate-media';
import { getStorageProvider, makeStorageObjectKey } from '@/lib/storage';
import { normalizePersonaSubjectType } from '@/lib/persona-subject';
import HuggingFaceService from '@/lib/huggingface-service';
import { normalizeLoraWeightsBuffer } from '@/lib/lora-weights';
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
const isModelFamily = (value: unknown): value is 'flux-lora' =>
  value === 'flux-lora';
const isFluxModelRef = (value: unknown) => {
  const normalized = safeTrim(value).toLowerCase();
  return !normalized || normalized.includes('flux');
};
const isUnsupportedLegacyPersona = (value: any) => {
  const modelFamily = safeTrim(value?.modelFamily ?? value?.model_family).toLowerCase();
  const trainingBaseModel = safeTrim(value?.trainingBaseModel ?? value?.training_base_model).toLowerCase();
  const destinationModel = safeTrim(value?.destinationModel ?? value?.destination_model).toLowerCase();
  return (modelFamily && modelFamily !== 'flux-lora')
    || !isFluxModelRef(trainingBaseModel)
    || !isFluxModelRef(destinationModel);
};

const normalizeReferenceImages = (
  value: unknown
): NonNullable<PersonaRecord['referenceImages']> => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item): NonNullable<PersonaRecord['referenceImages']>[number] | null => {
      if (!item || typeof item !== 'object') return null;
      const url = safeTrim((item as any).url);
      if (!url) return null;
      const storagePath = safeTrim((item as any).storagePath || (item as any).storage_path) || undefined;
      const name = safeTrim((item as any).name || (item as any).fileName || (item as any).file_name) || undefined;
      return {
        url,
        ...(storagePath ? { storagePath } : {}),
        ...(name ? { name } : {}),
      };
    })
    .filter((item): item is NonNullable<PersonaRecord['referenceImages']>[number] => Boolean(item));
};

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
    const resolvedWeightsSource = resolveWeightsSource(personaData);
    const { localWeightsPath } = resolvedWeightsSource;
    let { weightsUrl: weightsUrlInput } = resolvedWeightsSource;
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
        const normalizedWeights = normalizeLoraWeightsBuffer(media.buffer, weightsUrlInput);
        if (normalizedWeights.kind !== 'safetensors') {
          return NextResponse.json(
            { error: 'LoRA weights are not a valid safetensors file.', code: 'LORA_FORMAT_INVALID' },
            { status: 400 }
          );
        }
        const ext = normalizedWeights.extension;
        tempWeightsPath = path.join(os.tmpdir(), `lora-${personaData.personaId}-${Date.now()}.${ext}`);
        await fs.writeFile(tempWeightsPath, normalizedWeights.buffer);
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
    const resolvedSubjectType = normalizePersonaSubjectType(
      personaData.subjectType ?? personaData.subject_type
    );
    const referenceImages = normalizeReferenceImages(
      personaData.referenceImages ?? personaData.reference_images
    );
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
      gender:
        resolvedSubjectType === 'human'
          ? (isGender(personaData.gender) ? personaData.gender : (isGender(personaData?.persona_gender) ? personaData.persona_gender : undefined))
          : undefined,
      subjectType: resolvedSubjectType,
      modelId: personaData.modelId,
      trainingId: personaData.trainingId,
      createdAt: personaData.createdAt,
      imageCount: personaData.imageCount,
      imageUrl: persistedImageUrl || undefined,
      storagePath: storagePath || undefined,
      ...(referenceImages.length > 0 ? { referenceImages } : {}),
      ...(referenceImages.length > 0
        ? { referenceImageCount: referenceImages.length }
        : typeof personaData.referenceImageCount === 'number'
          ? { referenceImageCount: personaData.referenceImageCount }
          : typeof personaData.reference_image_count === 'number'
            ? { referenceImageCount: personaData.reference_image_count }
            : {}),
      status: personaData.status ?? 'training',
      visualStatus: personaData.visualStatus ?? 'ready',
      // Persist HF URL in both fields for compatibility.
      huggingFaceUrl: huggingFaceUrlToPersist || undefined,
      weightsUrl: huggingFaceUrlToPersist || personaData.weightsUrl || personaData.weights_url || undefined,
      ...(safeTrim(personaData.destinationModel || personaData.destination_model)
        ? { destinationModel: safeTrim(personaData.destinationModel || personaData.destination_model) }
        : {}),
      ...(safeTrim(personaData.trainingBaseModel || personaData.training_base_model)
        ? { trainingBaseModel: safeTrim(personaData.trainingBaseModel || personaData.training_base_model) }
        : {}),
      ...(isModelFamily(personaData.modelFamily) || isModelFamily(personaData.model_family)
        ? { modelFamily: (personaData.modelFamily || personaData.model_family) as 'flux-lora' }
        : {}),
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
      subject_type: record.subjectType,
      status: normalizedStatus,
      created_at: record.createdAt ?? new Date().toISOString(),
      ...(record.imageUrl ? { image_url: record.imageUrl } : {}),
      storage_path: record.storagePath,
      // Optional HF weights link fields. These columns might not exist; we handle that below.
      weights_url: record.weightsUrl,
      huggingface_url: record.huggingFaceUrl,
      destination_model: record.destinationModel,
      training_base_model: record.trainingBaseModel,
      model_family: record.modelFamily,
      // Alternate camelCase column names for some setups (best-effort).
      weightsUrl: record.weightsUrl,
      huggingFaceUrl: record.huggingFaceUrl,
      destinationModel: record.destinationModel,
      trainingBaseModel: record.trainingBaseModel,
      modelFamily: record.modelFamily,
      subjectType: record.subjectType,
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
    const payloadWithoutSubjectType = Object.fromEntries(
      Object.entries(payloadWithTrainingId).filter(([key]) => key !== 'subject_type' && key !== 'subjectType')
    );
    const payloadWithoutModelMeta = Object.fromEntries(
      Object.entries(payloadWithTrainingId).filter(([key]) =>
        key !== 'destination_model'
        && key !== 'training_base_model'
        && key !== 'model_family'
        && key !== 'destinationModel'
        && key !== 'trainingBaseModel'
        && key !== 'modelFamily'
      )
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
      if (updateResult.error && (
        isMissingColumn(updateResult.error, 'subject_type')
        || isMissingColumn(updateResult.error, 'subjectType')
      )) {
        updateResult = await supabase
          .from('personas')
          .update(payloadWithoutSubjectType)
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
      if (updateResult.error && (
        isMissingColumn(updateResult.error, 'destination_model')
        || isMissingColumn(updateResult.error, 'training_base_model')
        || isMissingColumn(updateResult.error, 'model_family')
      )) {
        updateResult = await supabase
          .from('personas')
          .update(payloadWithoutModelMeta)
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
      if (insertResult.error && (
        isMissingColumn(insertResult.error, 'subject_type')
        || isMissingColumn(insertResult.error, 'subjectType')
      )) {
        insertResult = await supabase
          .from('personas')
          .insert(payloadWithoutSubjectType);
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
      if (insertResult.error && (
        isMissingColumn(insertResult.error, 'destination_model')
        || isMissingColumn(insertResult.error, 'training_base_model')
        || isMissingColumn(insertResult.error, 'model_family')
      )) {
        insertResult = await supabase
          .from('personas')
          .insert(payloadWithoutModelMeta);
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

    const userId = request.nextUrl.searchParams.get('userId');
    const personaId = request.nextUrl.searchParams.get('personaId')
      || request.nextUrl.searchParams.get('id');

    let data: any[] = [];
    if (supabase && !supabaseError) {
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

      let supabaseResult = await query;
      if (supabaseResult.error && isMissingColumn(supabaseResult.error, 'created_at')) {
        let fallbackQuery = supabase
          .from('personas')
          .select('*');
        if (userId) {
          fallbackQuery = fallbackQuery.eq('user_id', userId);
        }
        if (personaId) {
          fallbackQuery = fallbackQuery.or(`id.eq.${personaId},training_id.eq.${personaId},model_id.eq.${personaId}`);
        }
        supabaseResult = await fallbackQuery;
      }

      if (supabaseResult.error) {
        console.warn('Supabase personas read failed, falling back to local registry:', supabaseResult.error);
      } else {
        data = Array.isArray(supabaseResult.data) ? supabaseResult.data : [];
        console.log('📦 API FETCHED PERSONAS (Sample):', data[0]);
      }
    } else {
      console.warn('Supabase unavailable for persona list, using local registry only:', supabaseError || 'not configured');
    }

    const storagePath = (p: any) => p.storagePath ?? p.storage_path;
    const rawImageUrl = (p: any) => p.imageUrl ?? p.image_url;

    const normalizedSupabase = await Promise.all((data ?? []).filter((persona: any) => !isUnsupportedLegacyPersona(persona)).map(async (persona: any) => {
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
        destinationModel: persona.destinationModel ?? persona.destination_model,
        destination_model: persona.destination_model ?? persona.destinationModel,
        weightsUrl: persona.weightsUrl ?? persona.weights_url ?? persona.huggingFaceUrl ?? persona.huggingface_url ?? null,
        weights_url: persona.weights_url ?? persona.weightsUrl ?? persona.huggingFaceUrl ?? persona.huggingface_url ?? null,
        huggingFaceUrl: persona.huggingFaceUrl ?? persona.huggingface_url ?? null,
        huggingface_url: persona.huggingface_url ?? persona.huggingFaceUrl ?? null,
        trainingBaseModel: persona.trainingBaseModel ?? persona.training_base_model,
        training_base_model: persona.training_base_model ?? persona.trainingBaseModel,
        modelFamily: persona.modelFamily ?? persona.model_family,
        model_family: persona.model_family ?? persona.modelFamily,
        subjectType: persona.subjectType ?? persona.subject_type,
        subject_type: persona.subject_type ?? persona.subjectType,
        referenceImages: normalizeReferenceImages(persona.referenceImages ?? persona.reference_images),
        reference_images: normalizeReferenceImages(persona.reference_images ?? persona.referenceImages),
        referenceImageCount: persona.referenceImageCount ?? persona.reference_image_count ?? null,
        reference_image_count: persona.reference_image_count ?? persona.referenceImageCount ?? null,
        completed_at: persona.completed_at ?? persona.completedAt ?? null,
        error_message: persona.error_message ?? persona.errorMessage ?? null,
        status: persona.status === 'active' ? 'completed' : persona.status,
      };
    }));

    // Merge local personas so newly trained personas always appear even if Supabase insert fails.
    const local = await readPersonas().catch(() => []);
    const localFiltered = (userId ? local.filter(p => p.userId === userId) : local)
      .filter((persona) => !isUnsupportedLegacyPersona(persona));
    const localNormalized = localFiltered.map((p) => ({
      id: p.personaId,
      user_id: p.userId,
      model_id: p.modelId ?? null,
      training_id: p.trainingId ?? null,
      name: p.name ?? null,
      trigger_word: p.triggerWord ?? null,
      triggerWord: p.triggerWord ?? null,
      image_url: p.imageUrl ?? null,
      imageUrl: p.imageUrl ?? null,
      storage_path: p.storagePath ?? null,
      storagePath: p.storagePath ?? null,
      destination_model: p.destinationModel ?? null,
      destinationModel: p.destinationModel ?? null,
      weights_url: p.weightsUrl ?? null,
      weightsUrl: p.weightsUrl ?? null,
      huggingface_url: p.huggingFaceUrl ?? null,
      huggingFaceUrl: p.huggingFaceUrl ?? null,
      training_base_model: p.trainingBaseModel ?? null,
      trainingBaseModel: p.trainingBaseModel ?? null,
      model_family: p.modelFamily ?? null,
      modelFamily: p.modelFamily ?? null,
      subject_type: p.subjectType ?? null,
      subjectType: p.subjectType ?? null,
      imageCount: p.imageCount ?? null,
      image_count: p.imageCount ?? null,
      referenceImages: p.referenceImages ?? [],
      reference_images: p.referenceImages ?? [],
      referenceImageCount: p.referenceImageCount ?? null,
      reference_image_count: p.referenceImageCount ?? null,
      status:
        (p.status === 'training' && !p.trainingId && !p.modelId)
          ? 'failed'
          : (p.status ?? 'training'),
      type: 'visual',
      created_at: p.createdAt ?? null,
      completed_at: p.completedAt ?? null,
      error_message:
        p.errorMessage
        ?? ((p.status === 'training' && !p.trainingId && !p.modelId)
          ? 'Training record is missing a valid training id.'
          : null),
    }));

    const byKey = (row: any) => row?.training_id ?? row?.model_id ?? row?.id;
    const statusRank = (status: any) => {
      const s = String(status || '').toLowerCase();
      if (s === 'completed' || s === 'active') return 4;
      if (s === 'failed' || s === 'canceled') return 3;
      if (s === 'training' || s === 'processing' || s === 'running') return 2;
      return 1;
    };
    const lifecycleTimestamp = (row: any) => {
      const raw = row?.completed_at ?? row?.completedAt ?? row?.created_at ?? row?.createdAt ?? '';
      const value = raw ? new Date(raw).getTime() : 0;
      return Number.isNaN(value) ? 0 : value;
    };
    const completenessScore = (row: any) => {
      let score = 0;
      if (row?.error_message || row?.errorMessage) score += 1;
      if (row?.completed_at || row?.completedAt) score += 1;
      if (row?.image_url || row?.imageUrl) score += 1;
      if (row?.huggingface_url || row?.huggingFaceUrl || row?.weights_url || row?.weightsUrl) score += 1;
      return score;
    };
    const mergePersonaRows = (current: any, incoming: any) => {
      const currentRank = statusRank(current?.status);
      const incomingRank = statusRank(incoming?.status);
      if (incomingRank > currentRank) {
        return { ...current, ...incoming };
      }
      if (incomingRank < currentRank) {
        return { ...incoming, ...current };
      }

      const incomingCompleteness = completenessScore(incoming);
      const currentCompleteness = completenessScore(current);
      if (incomingCompleteness > currentCompleteness) {
        return { ...current, ...incoming };
      }
      if (incomingCompleteness < currentCompleteness) {
        return { ...incoming, ...current };
      }

      if (lifecycleTimestamp(incoming) >= lifecycleTimestamp(current)) {
        return { ...current, ...incoming };
      }
      return { ...incoming, ...current };
    };
    const map = new Map<string, any>();
    for (const row of localNormalized) {
      const key = String(byKey(row) || row.id || '');
      if (!key) continue;
      const prev = map.get(key);
      if (!prev) {
        map.set(key, row);
        continue;
      }
      map.set(key, mergePersonaRows(prev, row));
    }
    for (const row of normalizedSupabase) {
      const key = String(byKey(row) || row.id || '');
      if (!key) continue;
      const prev = map.get(key);
      if (!prev) {
        map.set(key, row);
        continue;
      }
      // Prefer terminal lifecycle states so stale local "training" rows never win.
      map.set(key, mergePersonaRows(prev, row));
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
