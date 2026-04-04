import { NextRequest, NextResponse } from 'next/server';
import archiver from 'archiver';
import os from 'node:os';
import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { PassThrough } from 'node:stream';

import { ensureFalConfigured, hasFalKey } from '@/lib/fal';
import {
  FAL_PORTRAIT_TRAINING_ENGINE_LABEL,
  FAL_PORTRAIT_TRAINING_MODEL,
  getPersonaTrainingProfile,
  REPLICATE_FLUX_TRAINING_ENGINE_LABEL,
  REPLICATE_FLUX_TRAINING_MODEL,
  type PersonaTrainingProfile,
} from '@/lib/persona-pipeline';
import { requireUserId, requireVisualTrainingAccess, requirePersonaAccess } from '@/lib/persona-guards';
import {
  encodeFalTrainingJobId,
} from '@/lib/persona-training-jobs';
import {
  upsertPersona,
  type PersonaReferenceImage,
} from '@/lib/persona-registry';
import {
  normalizePersonaSubjectType,
  type PersonaSubjectType,
} from '@/lib/persona-subject';
import { isLocalAssetFallbackEnabled } from '@/lib/site-url';
import { getStorageProvider, makeStorageObjectKey } from '@/lib/storage';

const isGender = (value: unknown): value is 'male' | 'female' => value === 'male' || value === 'female';

const DEFAULT_REPLICATE_FLUX_TRAINING_VERSION = '26dce37af90b9d997eeb970d92e47de3064d46c300504ae376c75bef6a9022d2';
const DEFAULT_REPLICATE_FLUX_TRAINING_DESTINATION = 'yldrmerdem1-debug/persona-flux';
const REPLICATE_FLUX_TRAINING_ENGINE_DESCRIPTION =
  'Quality-first Replicate FLUX LoRA trainer used as the only non-human training path and the fallback path for human portraits.';

type TrainingStartResult = {
  provider: 'fal' | 'replicate';
  trainingId: string;
  status: string;
  modelFamily: 'flux-lora';
  trainingBaseModel: string;
  destinationModel: string;
  trainingEngineLabel: string;
  trainingEngineDescription: string;
};

type TrainingStrategy = 'fal' | 'replicate-flux';

type FalTrainingConfig = {
  engineLabel: string;
  engineDescription: string;
  modelId: string;
};

const safeTrim = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

const resolveReplicateFluxTrainingConfig = () => {
  const trainingBaseModel = String(
    process.env.REPLICATE_FLUX_TRAINING_BASE_MODEL
    || REPLICATE_FLUX_TRAINING_MODEL
  ).trim();
  const trainingVersion = String(
    process.env.REPLICATE_FLUX_TRAINING_VERSION
    || DEFAULT_REPLICATE_FLUX_TRAINING_VERSION
  ).trim();
  const trainingDestination = String(
    process.env.REPLICATE_FLUX_TRAINING_DESTINATION_MODEL
    || process.env.REPLICATE_FLUX_TRAINING_DESTINATION
    || DEFAULT_REPLICATE_FLUX_TRAINING_DESTINATION
  ).trim();

  return {
    trainingBaseModel,
    trainingVersion,
    trainingDestination,
  };
};

const resolveFalTrainingConfig = (): FalTrainingConfig => {
  return {
    engineLabel: FAL_PORTRAIT_TRAINING_ENGINE_LABEL,
    engineDescription: 'Best identity retention for real people and close-up portrait work.',
    modelId: FAL_PORTRAIT_TRAINING_MODEL,
  };
};

const buildReplicateFluxTrainingInput = ({
  inputImages,
  triggerWord,
  subjectType,
  profile,
}: {
  inputImages: string;
  triggerWord: string;
  subjectType: PersonaSubjectType;
  profile: PersonaTrainingProfile;
}) => ({
  input_images: inputImages,
  trigger_word: triggerWord,
  steps: Math.max(1000, Math.min(3000, profile.defaultSteps)),
  lora_rank:
    subjectType === 'human'
      ? 32
      : subjectType === 'product'
        ? 32
        : 24,
});

const sanitizeFilename = (value: string) => {
  const cleaned = value.replace(/[^a-zA-Z0-9-_]+/g, '-').replace(/-+/g, '-').replace(/^[-_]+|[-_]+$/g, '');
  return cleaned || 'persona';
};

const sanitizeArchiveFilename = (value: string) => {
  const cleaned = value
    .replace(/[<>:"/\\|?*\x00-\x1F]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.slice(0, 110) || 'persona';
};

const buildReplicateFluxCaptionBase = (
  triggerWord: string,
  subjectType: PersonaSubjectType
) => (
  subjectType === 'product'
    ? `product photo of ${triggerWord}`
    : subjectType === 'animal'
      ? `photo of ${triggerWord} animal`
      : subjectType === 'other'
        ? `photo of ${triggerWord} subject`
        : `photo of ${triggerWord}`
);

const isRemoteTrainingUrl = (value: string) => {
  const lower = String(value || '').trim().toLowerCase();
  if (!lower.startsWith('http://') && !lower.startsWith('https://')) return false;
  return !lower.includes('localhost') && !lower.includes('127.0.0.1') && !lower.includes('0.0.0.0');
};

const toZipDataUrl = (zipBuffer: Buffer) => `data:application/zip;base64,${zipBuffer.toString('base64')}`;

const zipImagesToBuffer = async (
  files: File[],
  options: { filenameBase?: string } = {}
): Promise<Buffer> => {
  const archive = archiver('zip', { zlib: { level: 6 } });
  const stream = new PassThrough();
  const chunks: Buffer[] = [];

  const done = new Promise<Buffer>((resolve, reject) => {
    stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
    archive.on('error', reject);
  });

  archive.pipe(stream);

  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    const arrayBuffer = await file.arrayBuffer();
    const extension =
      path.extname(file.name) || (file.type ? `.${file.type.split('/')[1]}` : '.jpg');
    const labelBase = safeTrim(options.filenameBase);
    const filename = labelBase
      ? `${sanitizeArchiveFilename(`${labelBase} ${String(index + 1).padStart(3, '0')}`)}${extension}`
      : `image_${String(index + 1).padStart(3, '0')}${extension}`;
    archive.append(Buffer.from(arrayBuffer), { name: filename });
  }

  await archive.finalize();
  return done;
};

const uploadZipToStorage = async ({
  personaId,
  request,
  zipBuffer,
}: {
  personaId: string;
  request: NextRequest;
  zipBuffer: Buffer;
}) => {
  const fallbackZipUrl = new URL(`/api/persona/zip/${personaId}`, request.nextUrl.origin).toString();
  let trainingZipUrl = fallbackZipUrl;
  let trainingZipPath: string | undefined;
  let trainingZipStoragePath: string | undefined;

  try {
    const provider = getStorageProvider();
    trainingZipStoragePath = makeStorageObjectKey(
      `personas/${personaId}/training-zips`,
      'application/zip',
      'images.zip'
    );
    await provider.upload(zipBuffer, 'application/zip', trainingZipStoragePath);
    if (provider.getPublicUrl) {
      try {
        trainingZipUrl = await provider.getPublicUrl(trainingZipStoragePath);
      } catch {
        trainingZipUrl = await provider.getSignedUrl(trainingZipStoragePath, 60 * 60 * 24 * 7);
      }
    } else {
      trainingZipUrl = await provider.getSignedUrl(trainingZipStoragePath, 60 * 60 * 24 * 7);
    }
  } catch (storageError) {
    if (isLocalAssetFallbackEnabled()) {
      const filename = `persona-${personaId}-${Date.now()}.zip`;
      trainingZipPath = path.join(os.tmpdir(), filename);
      await writeFile(trainingZipPath, zipBuffer);
    } else {
      console.warn('[train-persona] Training ZIP storage failed, falling back to inline data URL.', storageError);
    }
  }

  return { trainingZipUrl, trainingZipPath, trainingZipStoragePath };
};

const uploadReferenceImages = async ({
  personaId,
  files,
}: {
  personaId: string;
  files: File[];
}): Promise<PersonaReferenceImage[]> => {
  if (files.length === 0) return [];

  try {
    const provider = getStorageProvider();
    const uploaded = await Promise.all(files.map(async (file, index) => {
      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const contentType = file.type || 'image/jpeg';
      const key = makeStorageObjectKey(
        `personas/${personaId}/references`,
        contentType,
        `${String(index + 1).padStart(2, '0')}-${sanitizeFilename(file.name || 'reference')}`
      );
      await provider.upload(buffer, contentType, key);
      const url = provider.getPublicUrl
        ? await provider.getPublicUrl(key).catch(() => provider.getSignedUrl(key, 60 * 60 * 24 * 30))
        : await provider.getSignedUrl(key, 60 * 60 * 24 * 30);
      return {
        url,
        storagePath: key,
        name: file.name || `Reference ${index + 1}`,
      };
    }));
    return uploaded.filter((item) => Boolean(item.url));
  } catch (error) {
    console.warn('[train-persona] Reference image upload skipped:', error);
    return [];
  }
};

const buildFalTrainingInput = ({
  defaultSteps,
  inputImages,
  triggerWord,
}: {
  defaultSteps: number;
  inputImages: string;
  triggerWord: string;
}) => ({
  images_data_url: inputImages,
  trigger_phrase: triggerWord,
  steps: defaultSteps,
  multiresolution_training: true,
  subject_crop: true,
  create_masks: false,
});

const buildTrainingInputSource = ({
  zipBuffer,
  zipUrl,
}: {
  zipBuffer: Buffer;
  zipUrl: string;
}) => {
  const safeZipUrl = safeTrim(zipUrl);
  return safeZipUrl.startsWith('data:')
    ? safeZipUrl
    : isRemoteTrainingUrl(safeZipUrl)
      ? safeZipUrl
      : toZipDataUrl(zipBuffer);
};

const resolveTrainingStrategyOrder = (profile: PersonaTrainingProfile): TrainingStrategy[] => {
  const raw = safeTrim(process.env.PERSONA_TRAINING_PROVIDER_ORDER).toLowerCase();
  const aliases: Record<string, TrainingStrategy> = {
    fal: 'fal',
    replicate: 'replicate-flux',
    'replicate-flux': 'replicate-flux',
    flux: 'replicate-flux',
  };
  const allowedStrategies: TrainingStrategy[] =
    profile.provider === 'fal'
      ? ['fal', 'replicate-flux']
      : ['replicate-flux'];
  const defaultOrder: TrainingStrategy[] =
    profile.provider === 'fal'
      ? ['fal', 'replicate-flux']
      : ['replicate-flux'];
  const configured = raw
    ? raw
      .split(',')
      .map((item) => aliases[item.trim()])
      .filter((item): item is TrainingStrategy => Boolean(item) && allowedStrategies.includes(item))
    : [];

  return [...configured, ...defaultOrder].filter((item, index, list) => list.indexOf(item) === index);
};

const startFalTraining = async ({
  profile,
  subjectType,
  inputImages,
  triggerWord,
}: {
  profile: PersonaTrainingProfile;
  subjectType: PersonaSubjectType;
  inputImages: string;
  triggerWord: string;
}): Promise<TrainingStartResult> => {
  const fal = ensureFalConfigured();
  if (subjectType !== 'human') {
    throw new Error('fal.ai portrait trainer is only supported for human personas.');
  }
  const falTrainingConfig = resolveFalTrainingConfig();
  const submitted = await fal.queue.submit(falTrainingConfig.modelId, {
    input: buildFalTrainingInput({
      defaultSteps: profile.defaultSteps,
      inputImages,
      triggerWord,
    }) as any,
  } as any);

  const requestId = safeTrim((submitted as any)?.request_id || (submitted as any)?.requestId);
  if (!requestId) {
    throw new Error('fal.ai training request id is missing');
  }

  return {
    provider: 'fal' as const,
    trainingId: encodeFalTrainingJobId(requestId),
    status: safeTrim((submitted as any)?.status) || 'IN_QUEUE',
    modelFamily: 'flux-lora' as const,
    trainingBaseModel: falTrainingConfig.modelId,
    destinationModel: process.env.REPLICATE_FLUX_LORA_MODEL || 'black-forest-labs/flux-dev-lora',
    trainingEngineLabel: falTrainingConfig.engineLabel,
    trainingEngineDescription: falTrainingConfig.engineDescription,
  };
};

const startReplicateFluxTraining = async ({
  apiToken,
  inputImages,
  subjectType,
  triggerWord,
  profile,
}: {
  apiToken: string;
  inputImages: string;
  subjectType: PersonaSubjectType;
  triggerWord: string;
  profile: PersonaTrainingProfile;
}): Promise<TrainingStartResult> => {
  const { trainingBaseModel, trainingVersion, trainingDestination } = resolveReplicateFluxTrainingConfig();

  if (!trainingVersion) {
    throw new Error('REPLICATE_FLUX_TRAINING_VERSION is missing');
  }
  if (!trainingDestination || !/^[^/]+\/[^/]+$/.test(trainingDestination)) {
    throw new Error('REPLICATE_FLUX_TRAINING_DESTINATION_MODEL must be in the format "owner/model-name"');
  }

  const [owner, name] = trainingBaseModel.split('/');
  if (!owner || !name) {
    throw new Error('REPLICATE_FLUX_TRAINING_BASE_MODEL must be in the format "owner/model-name"');
  }

  const trainingEndpoint = `https://api.replicate.com/v1/models/${owner}/${name}/versions/${trainingVersion}/trainings`;
  const response = await fetch(trainingEndpoint, {
    method: 'POST',
    headers: {
      Authorization: `Token ${apiToken.trim()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      destination: trainingDestination,
      input: buildReplicateFluxTrainingInput({
        inputImages,
        triggerWord,
        subjectType,
        profile,
      }),
    }),
  });

  const responseText = await response.text();
  let payload: any = null;
  try {
    payload = responseText ? JSON.parse(responseText) : null;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw new Error(payload?.detail || payload?.error || 'Replicate FLUX training failed to start');
  }

  const trainingId = safeTrim(payload?.id);
  if (!trainingId) {
    throw new Error('Replicate training id is missing');
  }

  return {
    provider: 'replicate' as const,
    trainingId,
    status: safeTrim(payload?.status) || 'starting',
    modelFamily: 'flux-lora' as const,
    trainingBaseModel,
    destinationModel: safeTrim(payload?.destination) || trainingDestination,
    trainingEngineLabel: REPLICATE_FLUX_TRAINING_ENGINE_LABEL,
    trainingEngineDescription: REPLICATE_FLUX_TRAINING_ENGINE_DESCRIPTION,
  };
};

const resolveTrainingStart = async ({
  profile,
  subjectType,
  triggerWord,
  zipBuffer,
  zipUrl,
  files,
}: {
  profile: PersonaTrainingProfile;
  subjectType: PersonaSubjectType;
  triggerWord: string;
  zipBuffer: Buffer;
  zipUrl: string;
  files?: File[];
}) => {
  const inputImages = buildTrainingInputSource({ zipBuffer, zipUrl });
  const replicateToken = safeTrim(process.env.REPLICATE_API_TOKEN);
  const strategyOrder = resolveTrainingStrategyOrder(profile);
  let lastError: unknown = null;

  for (const strategy of strategyOrder) {
    if (strategy === 'fal') {
      if (!hasFalKey()) continue;
      try {
        return await startFalTraining({
          profile,
          subjectType,
          inputImages,
          triggerWord,
        });
      } catch (error) {
        lastError = error;
        console.warn('[train-persona] fal.ai training failed, trying next provider.', error);
      }
      continue;
    }

    if (strategy === 'replicate-flux') {
      if (!replicateToken) continue;
      try {
        const replicateFluxZipBuffer = files && files.length > 0
          ? await zipImagesToBuffer(files, {
              filenameBase: buildReplicateFluxCaptionBase(triggerWord, subjectType),
            })
          : zipBuffer;
        const replicateFluxInputImages = files && files.length > 0
          ? toZipDataUrl(replicateFluxZipBuffer)
          : inputImages;
        return await startReplicateFluxTraining({
          apiToken: replicateToken,
          inputImages: replicateFluxInputImages,
          subjectType,
          triggerWord,
          profile,
        });
      } catch (error) {
        lastError = error;
        console.warn('[train-persona] Replicate FLUX training failed, trying next provider.', error);
      }
    }
  }

  if (lastError instanceof Error) {
    throw lastError;
  }
  if (lastError) {
    throw new Error(String(lastError));
  }
  if (profile.provider === 'replicate') {
    throw new Error('Quality-first non-human persona training requires REPLICATE_API_TOKEN.');
  }
  throw new Error('No training provider is configured. Add FAL_KEY or REPLICATE_API_TOKEN.');
};

const buildDryRunPayload = ({
  profile,
  subjectType,
  triggerWord,
  imageCount,
  referenceImageCount,
}: {
  profile: PersonaTrainingProfile;
  subjectType: PersonaSubjectType;
  triggerWord: string;
  imageCount: number;
  referenceImageCount: number;
}) => {
  const strategyOrder = resolveTrainingStrategyOrder(profile);
  const replicateToken = safeTrim(process.env.REPLICATE_API_TOKEN);
  const falTrainingConfig = profile.provider === 'fal'
    ? resolveFalTrainingConfig()
    : null;
  const fallbackChain: Array<{
    strategy: TrainingStrategy;
    available: boolean;
    trainingBaseModel: string;
  }> = strategyOrder.map((strategy) => (
    strategy === 'fal'
      ? {
          strategy,
          available: hasFalKey(),
          trainingBaseModel: falTrainingConfig?.modelId || FAL_PORTRAIT_TRAINING_MODEL,
        }
      : {
          strategy,
          available: Boolean(replicateToken),
          trainingBaseModel: resolveReplicateFluxTrainingConfig().trainingBaseModel,
        }
  ));
  const selectedStrategy = fallbackChain.find((item) => item.available)?.strategy || strategyOrder[0];

  const input = selectedStrategy === 'fal'
    ? buildFalTrainingInput({
        defaultSteps: profile.defaultSteps,
        inputImages: 'data:application/zip;base64,...',
        triggerWord,
      })
    : buildReplicateFluxTrainingInput({
        inputImages: 'data:application/zip;base64,...',
        triggerWord,
        subjectType,
        profile,
      });

  const trainingBaseModel = selectedStrategy === 'fal'
    ? (falTrainingConfig?.modelId || FAL_PORTRAIT_TRAINING_MODEL)
    : resolveReplicateFluxTrainingConfig().trainingBaseModel;

  const trainingEngineLabel = selectedStrategy === 'fal'
    ? (falTrainingConfig?.engineLabel || FAL_PORTRAIT_TRAINING_ENGINE_LABEL)
    : REPLICATE_FLUX_TRAINING_ENGINE_LABEL;

  const trainingEngineDescription = selectedStrategy === 'fal'
    ? (falTrainingConfig?.engineDescription || 'Best identity retention for real people and close-up portrait work.')
    : REPLICATE_FLUX_TRAINING_ENGINE_DESCRIPTION;

  return {
    ok: true,
    dryRun: true,
    subjectType,
    imageCount,
    referenceImageCount,
    modelFamily: 'flux-lora',
    trainingProvider: selectedStrategy === 'fal' ? 'fal' : 'replicate',
    trainingStrategy: selectedStrategy,
    trainingBaseModel,
    trainingEngineLabel,
    trainingEngineDescription,
    supportedImages: {
      min: profile.minImages,
      recommendedMin: profile.recommendedMinImages,
      recommendedMax: profile.recommendedMaxImages,
      max: profile.maxImages,
    },
    supportedReferenceImages: {
      max: profile.referenceImagesMax,
      recommended: profile.referenceImagesRecommended,
    },
    providerOrder: fallbackChain,
    input,
  };
};

const validateTrainingRequest = ({
  imageCount,
  personaName,
  personaId,
  triggerWord,
  subjectType,
  gender,
  profile,
}: {
  imageCount: number;
  personaName: string;
  personaId: string;
  triggerWord: string;
  subjectType: PersonaSubjectType;
  gender?: 'male' | 'female';
  profile: PersonaTrainingProfile;
}) => {
  if (!personaId) {
    return { ok: false, body: { error: 'Persona id is required', code: 'PERSONA_ID_REQUIRED' }, status: 400 };
  }
  if (!personaName) {
    return { ok: false, body: { error: 'Persona name is required', code: 'PERSONA_NAME_REQUIRED' }, status: 400 };
  }
  if (!triggerWord) {
    return { ok: false, body: { error: 'Trigger word is required', code: 'TRIGGER_REQUIRED' }, status: 400 };
  }
  if (imageCount < profile.minImages) {
    return {
      ok: false,
      body: {
        error: `At least ${profile.minImages} training images are required for ${profile.subjectLabel.toLowerCase()} personas`,
        code: 'IMAGE_COUNT_TOO_LOW',
      },
      status: 400,
    };
  }
  if (imageCount > profile.maxImages) {
    return {
      ok: false,
      body: {
        error: `A maximum of ${profile.maxImages} training images is supported for ${profile.subjectLabel.toLowerCase()} personas`,
        code: 'IMAGE_COUNT_TOO_HIGH',
      },
      status: 400,
    };
  }
  if (subjectType === 'human' && !gender) {
    return { ok: false, body: { error: 'Gender is required', code: 'GENDER_REQUIRED' }, status: 400 };
  }
  return { ok: true as const };
};

export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get('content-type') || '';
    if (!contentType.includes('multipart/form-data')) {
      const body = await request.json().catch(() => ({}));
      const {
        zipFile,
        triggerWord: triggerWordRaw,
        imageCount,
        user,
        personaId,
        gender: genderRaw,
        subjectType: subjectTypeRaw,
        dryRun,
      } = body;

      const triggerWord = safeTrim(triggerWordRaw);
      const gender = isGender(genderRaw) ? genderRaw : undefined;
      const subjectType = normalizePersonaSubjectType(subjectTypeRaw) || 'human';
      const profile = getPersonaTrainingProfile(subjectType);

      const userCheck = requireUserId(user);
      if (!userCheck.ok) return NextResponse.json(userCheck.body, { status: userCheck.status });

      const premiumCheck = requireVisualTrainingAccess(user);
      if (!premiumCheck.ok) return NextResponse.json(premiumCheck.body, { status: premiumCheck.status });

      const personaIdValue = safeTrim(personaId);
      const ownershipCheck = await requirePersonaAccess({ user, personaId: personaIdValue });
      if (!ownershipCheck.ok && ownershipCheck.body.code !== 'PERSONA_NOT_FOUND') {
        return NextResponse.json(ownershipCheck.body, { status: ownershipCheck.status });
      }

      if (dryRun) {
        return NextResponse.json(buildDryRunPayload({
          profile,
          subjectType,
          triggerWord,
          imageCount: Number(imageCount) || 0,
          referenceImageCount: 0,
        }));
      }

      const normalizedZipFile = safeTrim(zipFile);
      if (!normalizedZipFile) {
        return NextResponse.json({ error: 'ZIP file is required', code: 'ZIP_REQUIRED' }, { status: 400 });
      }

      const validation = validateTrainingRequest({
        imageCount: Number(imageCount) || 0,
        personaName: safeTrim(body.personaName) || 'Persona',
        personaId: personaIdValue,
        triggerWord,
        subjectType,
        gender,
        profile,
      });
      if (!validation.ok) {
        return NextResponse.json(validation.body, { status: validation.status });
      }

      const trainingStart = await resolveTrainingStart({
        profile,
        subjectType,
        triggerWord,
        zipBuffer: Buffer.from([]),
        zipUrl: normalizedZipFile.startsWith('data:')
          || isRemoteTrainingUrl(normalizedZipFile)
            ? normalizedZipFile
            : `data:application/zip;base64,${normalizedZipFile}`,
      });

      await upsertPersona({
        personaId: personaIdValue,
        userId: userCheck.userId,
        triggerWord,
        gender: subjectType === 'human' ? gender : undefined,
        subjectType,
        imageCount: Number(imageCount) || undefined,
        visualStatus: 'training',
        status: 'training',
        createdAt: new Date().toISOString(),
        trainingId: trainingStart.trainingId,
        modelId: trainingStart.trainingId,
        destinationModel: trainingStart.destinationModel,
        trainingBaseModel: trainingStart.trainingBaseModel,
        modelFamily: trainingStart.modelFamily,
      });

      return NextResponse.json({
        trainingId: trainingStart.trainingId,
        status: trainingStart.status,
        trainingProvider: trainingStart.provider,
        triggerWord,
        destinationModel: trainingStart.destinationModel,
        modelFamily: trainingStart.modelFamily,
        trainingBaseModel: trainingStart.trainingBaseModel,
        trainingEngineLabel: trainingStart.trainingEngineLabel,
        trainingEngineDescription: trainingStart.trainingEngineDescription,
        subjectType,
        imageCount: Number(imageCount) || 0,
      });
    }

    const formData = await request.formData();
    const files = formData
      .getAll('images')
      .filter((entry): entry is File => entry instanceof File);
    const referenceFiles = formData
      .getAll('referenceImages')
      .filter((entry): entry is File => entry instanceof File);
    const personaName = safeTrim(formData.get('personaName'));
    const triggerWord = safeTrim(formData.get('triggerWord'));
    const personaId = safeTrim(formData.get('personaId'));
    const genderRaw = safeTrim(formData.get('gender'));
    const subjectTypeRaw = safeTrim(formData.get('subjectType'));
    const dryRun = safeTrim(formData.get('dryRun')).toLowerCase() === 'true';
    const userRaw = safeTrim(formData.get('user'));
    const gender = isGender(genderRaw) ? genderRaw : undefined;
    const subjectType = normalizePersonaSubjectType(subjectTypeRaw) || 'human';
    const profile = getPersonaTrainingProfile(subjectType);

    let user: any = null;
    try {
      user = userRaw ? JSON.parse(userRaw) : null;
    } catch {
      user = null;
    }

    const userCheck = requireUserId(user);
    if (!userCheck.ok) return NextResponse.json(userCheck.body, { status: userCheck.status });

    const premiumCheck = requireVisualTrainingAccess(user);
    if (!premiumCheck.ok) return NextResponse.json(premiumCheck.body, { status: premiumCheck.status });

    const ownershipCheck = await requirePersonaAccess({ user, personaId });
    if (!ownershipCheck.ok && ownershipCheck.body.code !== 'PERSONA_NOT_FOUND') {
      return NextResponse.json(ownershipCheck.body, { status: ownershipCheck.status });
    }

    const validation = validateTrainingRequest({
      imageCount: files.length,
      personaName,
      personaId,
      triggerWord,
      subjectType,
      gender,
      profile,
    });
    if (!validation.ok) {
      return NextResponse.json(validation.body, { status: validation.status });
    }

    if (referenceFiles.length > profile.referenceImagesMax) {
      return NextResponse.json(
        {
          error: `A maximum of ${profile.referenceImagesMax} reference images is supported for ${profile.subjectLabel.toLowerCase()} personas`,
          code: 'REFERENCE_IMAGE_COUNT_TOO_HIGH',
        },
        { status: 400 }
      );
    }

    if (dryRun) {
      return NextResponse.json(buildDryRunPayload({
        profile,
        subjectType,
        triggerWord,
        imageCount: files.length,
        referenceImageCount: referenceFiles.length,
      }));
    }

    await upsertPersona({
      personaId,
      userId: userCheck.userId,
      name: personaName,
      triggerWord,
      gender: subjectType === 'human' ? gender : undefined,
      subjectType,
      imageCount: files.length,
      visualStatus: 'training',
      status: 'training',
      createdAt: new Date().toISOString(),
      trainingBaseModel: profile.modelId,
      modelFamily: 'flux-lora',
      referenceImageCount: referenceFiles.length || undefined,
    });

    const [zipBuffer, referenceImages] = await Promise.all([
      zipImagesToBuffer(files),
      uploadReferenceImages({
        personaId,
        files: referenceFiles,
      }),
    ]);

    const {
      trainingZipUrl,
      trainingZipPath,
      trainingZipStoragePath,
    } = await uploadZipToStorage({
      personaId,
      request,
      zipBuffer,
    });

    const trainingStart = await resolveTrainingStart({
      profile,
      subjectType,
      triggerWord,
      zipBuffer,
      zipUrl: trainingZipUrl,
      files,
    });

    await upsertPersona({
      personaId,
      userId: userCheck.userId,
      name: personaName,
      triggerWord,
      gender: subjectType === 'human' ? gender : undefined,
      subjectType,
      imageCount: files.length,
      trainingId: trainingStart.trainingId,
      modelId: trainingStart.trainingId,
      trainingZipUrl,
      trainingZipPath,
      trainingZipStoragePath,
      destinationModel: trainingStart.destinationModel,
      trainingBaseModel: trainingStart.trainingBaseModel,
      modelFamily: trainingStart.modelFamily,
      visualStatus: 'training',
      status: 'training',
      createdAt: new Date().toISOString(),
      ...(referenceImages.length > 0 ? { referenceImages, referenceImageCount: referenceImages.length } : {}),
    });

    return NextResponse.json({
      trainingId: trainingStart.trainingId,
      status: trainingStart.status,
      trainingProvider: trainingStart.provider,
      triggerWord,
      destinationModel: trainingStart.destinationModel,
      modelFamily: trainingStart.modelFamily,
      trainingBaseModel: trainingStart.trainingBaseModel,
      trainingEngineLabel: trainingStart.trainingEngineLabel,
      trainingEngineDescription: trainingStart.trainingEngineDescription,
      subjectType,
      imageCount: files.length,
      referenceImages,
      referenceImageCount: referenceImages.length,
      supportedImages: {
        min: profile.minImages,
        recommendedMin: profile.recommendedMinImages,
        recommendedMax: profile.recommendedMaxImages,
        max: profile.maxImages,
      },
      supportedReferenceImages: {
        max: profile.referenceImagesMax,
        recommended: profile.referenceImagesRecommended,
      },
      message: 'Training started successfully',
    });
  } catch (error: any) {
    console.error('[train-persona]', error);
    return NextResponse.json(
      { error: error?.message || 'Training could not be started' },
      { status: 500 }
    );
  }
}
