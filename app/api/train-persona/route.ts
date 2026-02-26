import { NextRequest, NextResponse } from 'next/server';
import { requireUserId, requireVisualTrainingAccess, requirePersonaAccess } from '@/lib/persona-guards';
import { upsertPersona } from '@/lib/persona-registry';
import archiver from 'archiver';
import path from 'node:path';
import { PassThrough } from 'node:stream';

const isGender = (value: unknown): value is 'male' | 'female' => value === 'male' || value === 'female';

const zipImagesToBuffer = async (files: File[]): Promise<Buffer> => {
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

  for (let i = 0; i < files.length; i += 1) {
    const file = files[i];
    const arrayBuffer = await file.arrayBuffer();
    const extension =
      path.extname(file.name) || (file.type ? `.${file.type.split('/')[1]}` : '.jpg');
    const filename = `image_${String(i + 1).padStart(3, '0')}${extension}`;
    archive.append(Buffer.from(arrayBuffer), { name: filename });
  }

  await archive.finalize();
  return done;
};

export async function POST(request: NextRequest) {
  try {
    // Get API token from environment
    const apiToken = process.env.REPLICATE_API_TOKEN;
    
    // Validate token exists
    if (!apiToken || apiToken.trim() === '') {
      console.error('REPLICATE_API_TOKEN not found in environment');
      return NextResponse.json(
        {
          error: 'API token not configured',
          details: 'Please set REPLICATE_API_TOKEN in your .env.local file and restart your dev server'
        },
        { status: 500 }
      );
    }

    // Validate token format
    if (!apiToken.startsWith('r8_')) {
      return NextResponse.json(
        { error: 'Invalid API token format' },
        { status: 500 }
      );
    }

    const contentType = request.headers.get('content-type') || '';

    // Accept BOTH:
    // - JSON payload (legacy): { zipFile, triggerWord, imageCount, user, personaId, gender }
    // - multipart/form-data (UI upload): images[], personaName, triggerWord, personaId, gender, user (JSON string)
    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      const files = formData
        .getAll('images')
        .filter((entry): entry is File => entry instanceof File);
      const personaName = String(formData.get('personaName') ?? '').trim();
      const triggerWord = String(formData.get('triggerWord') ?? '').trim();
      const personaId = String(formData.get('personaId') ?? '').trim();
      const genderRaw = String(formData.get('gender') ?? '').trim();
      const userRaw = String(formData.get('user') ?? '').trim();
      const gender = isGender(genderRaw) ? genderRaw : undefined;

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

      if (!personaId) {
        return NextResponse.json({ error: 'Persona id is required', code: 'PERSONA_ID_REQUIRED' }, { status: 400 });
      }

      const ownershipCheck = await requirePersonaAccess({ user, personaId });
      if (!ownershipCheck.ok && ownershipCheck.body.code !== 'PERSONA_NOT_FOUND') {
        return NextResponse.json(ownershipCheck.body, { status: ownershipCheck.status });
      }

      if (!personaName) {
        return NextResponse.json({ error: 'Persona name is required', code: 'PERSONA_NAME_REQUIRED' }, { status: 400 });
      }

      if (files.length !== 20) {
        return NextResponse.json({ error: 'Exactly 20 images are required', code: 'IMAGE_COUNT_INVALID' }, { status: 400 });
      }

      if (!triggerWord) {
        return NextResponse.json({ error: 'Trigger word is required', code: 'TRIGGER_REQUIRED' }, { status: 400 });
      }

      if (!gender) {
        return NextResponse.json({ error: 'Gender is required', code: 'GENDER_REQUIRED' }, { status: 400 });
      }

      await upsertPersona({
        personaId,
        userId: userCheck.userId,
        name: personaName,
        triggerWord,
        gender,
        imageCount: files.length,
        visualStatus: 'training',
        status: 'training',
        createdAt: new Date().toISOString(),
      });

      const zipBuffer = await zipImagesToBuffer(files);
      if (!zipBuffer.length) {
        return NextResponse.json({ error: 'ZIP buffer is empty', code: 'ZIP_EMPTY' }, { status: 500 });
      }

      const sanitizeFilename = (value: string) => {
        const cleaned = value.replace(/[^a-zA-Z0-9-_]+/g, '-').replace(/-+/g, '-').replace(/^[-_]+|[-_]+$/g, '');
        return cleaned || 'persona';
      };
      const filename = `${sanitizeFilename(personaName)}.zip`;
      const uploadForm = new FormData();
      const zipPart: BlobPart = Buffer.isBuffer(zipBuffer) ? new Uint8Array(zipBuffer) : zipBuffer;
      const zipBlob = new Blob([zipPart], { type: 'application/zip' });
      uploadForm.append('content', zipBlob, filename);

      const zipResponse = await fetch('https://api.replicate.com/v1/files', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiToken.trim()}`,
        },
        body: uploadForm,
      });
      const zipText = await zipResponse.text();
      if (!zipResponse.ok) {
        console.error('Replicate upload failed:', zipText);
        return NextResponse.json({ error: 'Replicate upload failed', code: 'REPLICATE_UPLOAD_FAILED' }, { status: 502 });
      }
      let zipPayload: any = null;
      try {
        zipPayload = zipText ? JSON.parse(zipText) : null;
      } catch {
        zipPayload = null;
      }
      const inputImagesUrl = zipPayload?.serving_url ?? zipPayload?.urls?.get;
      if (!inputImagesUrl) {
        return NextResponse.json({ error: 'Replicate file URL missing', code: 'REPLICATE_FILE_URL_MISSING' }, { status: 502 });
      }

      const trainingBaseModel = 'replicate/fast-flux-trainer';
      const fallbackTrainingVersion = '8b10794665aed907bb98a1a5324cd1d3a8bea0e9b31e65210967fb9c9e2e08ed';
      const fallbackTrainingDestination = 'yldrmerdem1-debug/persona-model';
      const trainingVersion =
        (process.env.REPLICATE_TRAINING_VERSION && /^[0-9a-fA-F-]{36}$/.test(process.env.REPLICATE_TRAINING_VERSION))
          ? process.env.REPLICATE_TRAINING_VERSION
          : fallbackTrainingVersion;
      const trainingDestination =
        (process.env.REPLICATE_TRAINING_MODEL && /^[^/]+\/[^/]+$/.test(process.env.REPLICATE_TRAINING_MODEL))
          ? process.env.REPLICATE_TRAINING_MODEL
          : fallbackTrainingDestination;

      const [owner, name] = trainingBaseModel.split('/');
      const trainingEndpoint = `https://api.replicate.com/v1/models/${owner}/${name}/versions/${trainingVersion}/trainings`;
      const trainingResponse = await fetch(trainingEndpoint, {
        method: 'POST',
        headers: {
          Authorization: `Token ${apiToken.trim()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          destination: trainingDestination,
          input: {
            input_images: inputImagesUrl,
            trigger_word: triggerWord,
            lora_type: 'subject',
          },
        }),
      });
      const trainingText = await trainingResponse.text();
      let trainingPayload: any = null;
      try {
        trainingPayload = trainingText ? JSON.parse(trainingText) : null;
      } catch {
        trainingPayload = null;
      }
      if (!trainingResponse.ok) {
        console.error('Replicate training error:', trainingText);
        return NextResponse.json({ error: 'Replicate training failed', code: 'REPLICATE_TRAINING_FAILED' }, { status: 502 });
      }

      const trainingId = String(trainingPayload?.id || '').trim();
      if (trainingId) {
        await upsertPersona({
          personaId,
          userId: userCheck.userId,
          trainingId,
          status: 'training',
          visualStatus: 'training',
          gender,
        });
      }

      return NextResponse.json({
        trainingId: trainingPayload?.id,
        status: trainingPayload?.status,
        inputImagesUrl,
      });
    }

    const { zipFile, triggerWord, imageCount, user, personaId, gender: genderRaw } = await request.json();
    const gender = isGender(genderRaw) ? genderRaw : undefined;

    const userCheck = requireUserId(user);
    if (!userCheck.ok) {
      return NextResponse.json(userCheck.body, { status: userCheck.status });
    }

    const premiumCheck = requireVisualTrainingAccess(user);
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
    if (!ownershipCheck.ok && ownershipCheck.body.code !== 'PERSONA_NOT_FOUND') {
      return NextResponse.json(ownershipCheck.body, { status: ownershipCheck.status });
    }

    if (!zipFile) {
      return NextResponse.json(
        { error: 'ZIP file is required' },
        { status: 400 }
      );
    }

    if (!imageCount || imageCount < 20) {
      return NextResponse.json(
        { error: 'Exactly 20 images are required', code: 'IMAGE_COUNT_INVALID' },
        { status: 400 }
      );
    }

    if (imageCount > 20) {
      return NextResponse.json(
        { error: 'Exactly 20 images are required', code: 'IMAGE_COUNT_INVALID' },
        { status: 400 }
      );
    }

    if (!triggerWord) {
      return NextResponse.json(
        { error: 'Trigger word is required', code: 'TRIGGER_REQUIRED' },
        { status: 400 }
      );
    }

    if (!gender) {
      return NextResponse.json(
        { error: 'Gender is required', code: 'GENDER_REQUIRED' },
        { status: 400 }
      );
    }

    await upsertPersona({
      personaId,
      userId: userCheck.userId,
      triggerWord,
      gender,
      imageCount,
      visualStatus: 'training',
      status: 'training',
      createdAt: new Date().toISOString(),
    });

    console.log(`Starting training with ${imageCount} images, trigger word: ${triggerWord}`);

    const trainingBaseModel = 'replicate/fast-flux-trainer';
    const trainingVersion = process.env.REPLICATE_TRAINING_VERSION;
    const trainingDestination = process.env.REPLICATE_TRAINING_MODEL;

    if (!trainingVersion) {
      return NextResponse.json(
        {
          error: 'Training model not configured',
          details: 'Missing REPLICATE_TRAINING_VERSION. Set a valid model version id in .env.local.',
        },
        { status: 400 }
      );
    }

    if (!/^[0-9a-fA-F-]{36}$/.test(trainingVersion)) {
      return NextResponse.json(
        {
          error: 'Invalid training model version',
          details: 'REPLICATE_TRAINING_VERSION must be a Replicate version UUID.',
        },
        { status: 400 }
      );
    }

    if (!trainingDestination) {
      return NextResponse.json(
        {
          error: 'Training destination not configured',
          details: 'Missing REPLICATE_TRAINING_MODEL. Set it to "username/model-name".',
        },
        { status: 400 }
      );
    }

    if (!/^[^/]+\/[^/]+$/.test(trainingDestination)) {
      return NextResponse.json(
        {
          error: 'Invalid training destination',
          details: 'REPLICATE_TRAINING_MODEL must be in the format "username/model-name".',
        },
        { status: 400 }
      );
    }
    
    // Replicate's fast-flux-trainer accepts data URLs (data:application/zip;base64,...)
    // The ZIP file is already in base64 format from the frontend
    // We'll use it directly as a data URL
    let zipUrl = zipFile;
    
    // Ensure it's a proper data URL format
    if (!zipFile.startsWith('data:')) {
      // If it's raw base64, wrap it in data URL format
      zipUrl = `data:application/zip;base64,${zipFile}`;
    }
    
    console.log('Training base model:', trainingBaseModel);
    console.log('Training version id:', trainingVersion);
    console.log('Training destination:', trainingDestination);
    console.log('ZIP file format:', zipUrl.substring(0, 50) + '...');
    console.log('ZIP file size:', Math.round(zipUrl.length / 1024), 'KB (base64)');
    
    const trainingInput: any = {
      input_images: zipUrl, // ZIP file (data URL or URL)
      trigger_word: triggerWord, // Unique trigger word for this persona
      lora_type: 'subject',
    };
    
    // Try alternative parameter names if the above doesn't work
    // Some models use: input_images_zip, images_zip, training_images_zip
    
    console.log('Training input prepared:', {
      imageCount: imageCount,
      triggerWord: trainingInput.trigger_word,
      hasZip: !!zipUrl,
      zipType: zipUrl.substring(0, 20), // First 20 chars to see format
    });

    const [owner, name] = trainingBaseModel.split('/');
    if (!owner || !name) {
      return NextResponse.json(
        {
          error: 'Invalid training model name',
          details: 'REPLICATE_TRAINING_MODEL must be in the format "owner/name".',
        },
        { status: 400 }
      );
    }

    const trainingEndpoint = `https://api.replicate.com/v1/models/${owner}/${name}/versions/${trainingVersion}/trainings`;
    let responsePayload: any = null;

    const trainingResponse = await fetch(trainingEndpoint, {
      method: 'POST',
      headers: {
        Authorization: `Token ${apiToken.trim()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        destination: trainingDestination,
        input: trainingInput,
      }),
    });

    const responseText = await trainingResponse.text();
    try {
      responsePayload = responseText ? JSON.parse(responseText) : null;
    } catch {
      responsePayload = responseText;
    }

    if (!trainingResponse.ok) {
      console.error('Replicate training error:', {
        model: trainingBaseModel,
        version: trainingVersion,
        destination: trainingDestination,
        status: trainingResponse.status,
        response: responsePayload,
      });
      return NextResponse.json(
        {
          error: 'Training could not be started',
          details: 'The selected model version is invalid or does not support training.',
        },
        { status: 422 }
      );
    }

    console.log('Training started successfully!');
    console.log('Training ID:', responsePayload?.id);
    console.log('Status:', responsePayload?.status);
    console.log('Model used:', trainingBaseModel);
    console.log('Parameters used:', 'input_images');

    await upsertPersona({
      personaId,
      userId: userCheck.userId,
      trainingId: responsePayload?.id,
      status: 'training',
      destinationModel: responsePayload?.destination,
      visualStatus: 'training',
      gender,
    });

    return NextResponse.json({
      trainingId: responsePayload?.id,
      status: responsePayload?.status,
      triggerWord: triggerWord,
      message: 'Training started successfully',
    });

  } catch (error: any) {
    console.error('Training error:', {
      error: error?.message ?? error,
      response: error?.response?.data ?? error,
    });
    return NextResponse.json(
      { 
        error: error.message || 'Failed to start training',
        details: error.toString()
      },
      { status: 500 }
    );
  }
}
