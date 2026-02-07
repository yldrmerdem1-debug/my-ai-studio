import { NextRequest, NextResponse } from 'next/server';
import Replicate from 'replicate';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export async function POST(request: NextRequest) {
  try {
    const apiToken = process.env.REPLICATE_API_TOKEN;

    if (!apiToken || apiToken.trim() === '') {
      return NextResponse.json(
        {
          error: 'API token not configured',
          details: 'Please set REPLICATE_API_TOKEN in your .env.local file and restart your dev server',
        },
        { status: 500 }
      );
    }

    if (!apiToken.startsWith('r8_')) {
      return NextResponse.json(
        { error: 'Invalid API token format. Token must start with "r8_".' },
        { status: 500 }
      );
    }

    const { videoUrl, audioUrl } = await request.json();

    if (!videoUrl || !audioUrl) {
      return NextResponse.json(
        { error: 'videoUrl and audioUrl are required' },
        { status: 400 }
      );
    }

    const replicate = new Replicate({
      auth: apiToken.trim(),
    });

    const uploadBufferToReplicate = async (buffer: Buffer, contentType: string, filename: string) => {
      const form = new FormData();
      form.append('content', new Blob([buffer], { type: contentType }), filename);
      const upload = await fetch('https://api.replicate.com/v1/files', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiToken.trim()}` },
        body: form,
      });
      const text = await upload.text();
      if (!upload.ok) {
        throw new Error(`Replicate upload failed: ${upload.status} ${text}`);
      }
      const payload = text ? JSON.parse(text) : null;
      return payload?.urls?.get || payload?.urls?.original || payload?.serving_url || payload?.url;
    };

    const resolveInputUrl = async (inputUrl: string, fallbackName: string) => {
      if (inputUrl.startsWith('data:')) {
        const match = inputUrl.match(/^data:([^;]+);base64,(.+)$/);
        if (!match) {
          throw new Error('Invalid data URL');
        }
        const contentType = match[1];
        const buffer = Buffer.from(match[2], 'base64');
        return await uploadBufferToReplicate(buffer, contentType, fallbackName);
      }
      if (inputUrl.startsWith('/')) {
        const filePath = path.join(process.cwd(), 'public', inputUrl.replace(/^\//, ''));
        const buffer = await readFile(filePath);
        const contentType = inputUrl.endsWith('.mp4') ? 'video/mp4' : inputUrl.endsWith('.wav') ? 'audio/wav' : 'audio/mpeg';
        return await uploadBufferToReplicate(buffer, contentType, path.basename(filePath));
      }
      return inputUrl;
    };

    const resolvedVideoUrl = await resolveInputUrl(videoUrl, 'video.mp4');
    const resolvedAudioUrl = await resolveInputUrl(audioUrl, 'audio.mp3');

    const defaultVersion = '8d65e3f4f4298520e079198b493c25adfc43c058ffec924f2aefc8010ed25eef';
    let modelVersion = (process.env.REPLICATE_LIPSYNC_MODEL || defaultVersion).trim();
    if (modelVersion === 'devxpy/cog-wav2lip') {
      modelVersion = defaultVersion;
    }
    const isVersionHash = /^[a-f0-9]{64}$/i.test(modelVersion);

    const prediction = await replicate.predictions.create({
      ...(isVersionHash ? { version: modelVersion } : { model: modelVersion }),
      input: {
        face: resolvedVideoUrl,
        audio: resolvedAudioUrl,
      },
    });

    return NextResponse.json({
      predictionId: prediction.id,
      status: prediction.status,
    });
  } catch (error: any) {
    console.error('Lip sync error:', error);
    return NextResponse.json(
      {
        error: error.message || 'Failed to start lip sync',
        details: error.toString(),
      },
      { status: 500 }
    );
  }
}
