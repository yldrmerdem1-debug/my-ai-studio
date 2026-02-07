import { NextRequest } from 'next/server';
import { requireUserId, requireVisualTrainingAccess, requirePersonaAccess } from '@/lib/persona-guards';
import { upsertPersona } from '@/lib/persona-registry';
import archiver from 'archiver';
import { createWriteStream } from 'fs';
import os from 'os';
import path from 'path';

export async function POST(request: NextRequest) {
  try {

    const formData = await request.formData();
    const personaId = String(formData.get('personaId') ?? '');
    const triggerWord = String(formData.get('triggerWord') ?? '');
    const userRaw = formData.get('user');
    const files = formData
      .getAll('files')
      .filter((entry): entry is File => entry instanceof File);
    const imageCount = files.length;

    let user: any = null;
    try {
      user = userRaw ? JSON.parse(String(userRaw)) : null;
    } catch (error) {
      console.error('Invalid user payload:', error);
    }

    const userCheck = requireUserId(user);
    if (!userCheck.ok) {
      return Response.json(
        { error: `Prepare training failed: ${userCheck.body?.error ?? 'Missing user credentials'}` },
        { status: 500 }
      );
    }

    const premiumCheck = requireVisualTrainingAccess(user);
    if (!premiumCheck.ok) {
      return Response.json(
        { error: `Prepare training failed: ${premiumCheck.body?.error ?? 'Premium required'}` },
        { status: 500 }
      );
    }

    if (!personaId) {
      return Response.json(
        { error: 'Prepare training failed: Persona id is required' },
        { status: 500 }
      );
    }

    const ownershipCheck = await requirePersonaAccess({ user, personaId });
    if (!ownershipCheck.ok && ownershipCheck.body.code !== 'PERSONA_NOT_FOUND') {
      return Response.json(
        { error: `Prepare training failed: ${ownershipCheck.body?.error ?? 'Persona access denied'}` },
        { status: 500 }
      );
    }

    if (files.length === 0) {
      return Response.json(
        { error: 'Prepare training failed: Images are required' },
        { status: 500 }
      );
    }

    if (imageCount !== 20) {
      return Response.json(
        { error: 'Prepare training failed: Exactly 20 images are required' },
        { status: 500 }
      );
    }

    if (!triggerWord) {
      return Response.json(
        { error: 'Prepare training failed: Trigger word is required' },
        { status: 500 }
      );
    }

    const filename = `persona-${personaId}-${Date.now()}.zip`;
    const tempZipPath = path.join(os.tmpdir(), filename);
    const output = createWriteStream(tempZipPath);
    const archive = archiver('zip', { zlib: { level: 6 } });
    const archivePromise = new Promise<void>((resolve, reject) => {
      output.on('close', () => resolve());
      output.on('error', reject);
      archive.on('error', reject);
    });
    archive.pipe(output);

    for (let i = 0; i < files.length; i += 1) {
      const file = files[i];
      const arrayBuffer = await file.arrayBuffer();
      const extension = path.extname(file.name) || (file.type ? `.${file.type.split('/')[1]}` : '.jpg');
      const filename = `image_${String(i + 1).padStart(3, '0')}${extension}`;
      archive.append(Buffer.from(arrayBuffer), { name: filename });
    }

    await archive.finalize();
    await archivePromise;

    const zipUrl = new URL(`/api/persona/zip/${personaId}`, request.nextUrl.origin).toString();

    await upsertPersona({
      personaId,
      userId: userCheck.userId,
      triggerWord,
      imageCount,
      trainingZipUrl: zipUrl,
      trainingZipPath: tempZipPath,
      status: 'training',
      createdAt: new Date().toISOString(),
    });

    return Response.json({
      success: true,
      message: 'Training inputs prepared',
      trainingZipUrl: zipUrl,
    });
  } catch (error: any) {
    console.error('PREPARE TRAINING ERROR:', error);
    return Response.json(
      { error: `Prepare training failed: ${error?.message ?? 'Unexpected error'}` },
      { status: 500 }
    );
  }
}
