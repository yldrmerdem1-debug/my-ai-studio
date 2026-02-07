import { NextRequest, NextResponse } from 'next/server';
import archiver from 'archiver';
import path from 'path';
import { PassThrough } from 'stream';

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
    console.log('Request received');
    const apiToken = process.env.REPLICATE_API_TOKEN;
    if (!apiToken || apiToken.trim() === '') {
      return NextResponse.json(
        { error: 'REPLICATE_API_TOKEN not configured' },
        { status: 500 }
      );
    }

    const formData = await request.formData();
    const files = formData
      .getAll('images')
      .filter((entry): entry is File => entry instanceof File);
    const personaName = String(formData.get('personaName') ?? '').trim();

    if (files.length === 0) {
      return NextResponse.json(
        { error: 'No images provided' },
        { status: 400 }
      );
    }

    if (!personaName) {
      return NextResponse.json(
        { error: 'Persona name is required' },
        { status: 400 }
      );
    }

    const zipBuffer = await zipImagesToBuffer(files);
    console.log('Zip size (bytes):', zipBuffer.length);
    if (zipBuffer.length === 0) {
      throw new Error('Zip buffer is empty');
    }

    const sanitizeFilename = (value: string) => {
      const cleaned = value.replace(/[^a-zA-Z0-9-_]+/g, '-').replace(/-+/g, '-').replace(/^[-_]+|[-_]+$/g, '');
      return cleaned || 'persona';
    };
    const filename = `${sanitizeFilename(personaName)}.zip`;
    const uploadForm = new FormData();
    const zipBlob = new Blob([zipBuffer], { type: 'application/zip' });
    uploadForm.append('content', zipBlob, filename);

    const zipResponse = await fetch('https://api.replicate.com/v1/files', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiToken.trim()}`,
      },
      body: uploadForm,
    });

    console.log('Replicate upload status:', zipResponse.status);
    const zipText = await zipResponse.text();
    if (!zipResponse.ok) {
      console.error('Replicate upload failed:', zipText);
      throw new Error(`Replicate upload failed: ${zipResponse.status}`);
    }

    let zipPayload: any = null;
    try {
      zipPayload = zipText ? JSON.parse(zipText) : null;
    } catch {
      zipPayload = null;
    }

    const inputImagesUrl = zipPayload?.serving_url ?? zipPayload?.urls?.get;
    if (!inputImagesUrl) {
      throw new Error('Replicate file URL missing');
    }

    const trainingEndpoint =
      'https://api.replicate.com/v1/models/replicate/fast-flux-trainer/versions/8b10794665aed907bb98a1a5324cd1d3a8bea0e9b31e65210967fb9c9e2e08ed/trainings';
    const destination = 'yldrmerdem1-debug/persona-model';

    const trainingResponse = await fetch(trainingEndpoint, {
      method: 'POST',
      headers: {
        Authorization: `Token ${apiToken.trim()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        destination,
        input: {
          input_images: inputImagesUrl,
          trigger_word: 'TOK',
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
      throw new Error(`Replicate training failed: ${trainingResponse.status}`);
    }

    return NextResponse.json({
      trainingId: trainingPayload?.id,
      status: trainingPayload?.status,
      inputImagesUrl,
    });
  } catch (error: any) {
    console.error('TRAIN API ERROR:', error);
    return NextResponse.json(
      { error: error?.message, details: error?.toString() },
      { status: 500 }
    );
  }
}
