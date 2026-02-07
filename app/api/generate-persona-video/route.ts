import { NextRequest, NextResponse } from 'next/server';
import Replicate from 'replicate';
import { findPersonaById } from '@/lib/persona-registry';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { createGeminiModel, getGeminiModelId, resolveGeminiModelId } from '@/lib/gemini';

export const runtime = 'nodejs';

const GEMINI_SYSTEM_INSTRUCTION = `You are a creative director. Convert the user input into a JSON object with two fields: 'script' (a natural, 1st-person monologue based on the input, ready for TTS) and 'visual_prompt' (a high-fidelity, cinematic image description including the trigger word). Do not include markdown formatting, return raw JSON.`;
const geminiModelId = resolveGeminiModelId(
  process.env.GEMINI_MODEL_ID,
  'gemini-3-pro-preview'
);

type GeneratePersonaVideoRequest = {
  userPrompt: string;
  personaModelId: string;
  personaTriggerWord: string;
  mode?: 'studio' | 'ad';
  script?: string;
  productImageUrl?: string;
  waitForCompletion?: boolean;
};

const isLikelyUrl = (value: string) => /^https?:\/\//i.test(value) || value.startsWith('data:image/');
const isDataUrl = (value: string) => value.startsWith('data:');
const execFileAsync = promisify(execFile);

const extractJson = (raw: string) => {
  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      return JSON.parse(match[0]);
    }
    throw new Error('Gemini response did not contain valid JSON');
  }
};

const resolveSourceImage = async (personaModelId: string) => {
  if (isLikelyUrl(personaModelId)) {
    return personaModelId;
  }

  const persona = await findPersonaById(personaModelId);
  if (!persona) {
    throw new Error('Persona metadata not found for source image');
  }

  if (persona.trainingZipUrl?.startsWith('data:image/')) {
    return persona.trainingZipUrl;
  }

  throw new Error('Persona source image is missing. Provide a valid image URL.');
};

const ensureFfmpeg = async () => {
  try {
    await execFileAsync('ffmpeg', ['-version']);
  } catch {
    throw new Error('ffmpeg is not available on the server.');
  }
};

const bufferFromDataUrl = (dataUrl: string) => {
  const commaIndex = dataUrl.indexOf(',');
  if (commaIndex === -1) {
    throw new Error('Invalid data URL');
  }
  const base64 = dataUrl.slice(commaIndex + 1);
  return Buffer.from(base64, 'base64');
};

const fetchToBuffer = async (url: string) => {
  if (isDataUrl(url)) {
    return bufferFromDataUrl(url);
  }
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch asset: ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
};

const writeTempFile = async (buffer: Buffer, filename: string) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'persona-video-'));
  const filePath = path.join(tempDir, filename);
  await fs.writeFile(filePath, buffer);
  return filePath;
};

const extractVideoUrl = (output: any): string | null => {
  if (!output) return null;
  if (Array.isArray(output)) return output[0] || null;
  if (typeof output === 'string') return output;
  if (typeof output === 'object') {
    const candidates = [output.video, output.url, output.mp4];
    for (const candidate of candidates) {
      if (typeof candidate === 'string') return candidate;
    }
    for (const value of Object.values(output)) {
      const found = extractVideoUrl(value);
      if (found) return found;
    }
  }
  return null;
};

const waitForPrediction = async (replicate: Replicate, predictionId: string) => {
  const started = Date.now();
  while (Date.now() - started < 240000) {
    const prediction = await replicate.predictions.get(predictionId);
    if (prediction.status === 'succeeded') {
      const videoUrl = extractVideoUrl(prediction.output);
      if (!videoUrl) {
        throw new Error('Replicate succeeded but video URL missing');
      }
      return videoUrl;
    }
    if (prediction.status === 'failed' || prediction.status === 'canceled') {
      throw new Error(prediction.error || 'Replicate prediction failed');
    }
    await new Promise(resolve => setTimeout(resolve, 4000));
  }
  throw new Error('Video generation timed out');
};

const escapeDrawtext = (value: string) =>
  value.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'").replace(/\n/g, '\\n');

const composeAdVideo = async (videoUrl: string, productImageUrl: string, script: string) => {
  await ensureFfmpeg();
  const [videoBuffer, imageBuffer] = await Promise.all([
    fetchToBuffer(videoUrl),
    fetchToBuffer(productImageUrl),
  ]);

  const videoPath = await writeTempFile(videoBuffer, 'base.mp4');
  const imagePath = await writeTempFile(imageBuffer, 'product.png');
  const outputPath = await writeTempFile(Buffer.alloc(0), 'ad.mp4');

  const safeText = escapeDrawtext(script);
  const filter = [
    '[1:v]scale=iw*0.35:ih*0.35[img]',
    '[0:v][img]overlay=W-w-40:H-h-40',
    `drawtext=text='${safeText}':x=(w-text_w)/2:y=h-120:fontcolor=white:fontsize=28:box=1:boxcolor=black@0.5`,
  ].join(',');

  await execFileAsync('ffmpeg', [
    '-y',
    '-i', videoPath,
    '-i', imagePath,
    '-filter_complex', filter,
    '-c:a', 'copy',
    outputPath,
  ]);

  const outputBuffer = await fs.readFile(outputPath);
  return `data:video/mp4;base64,${outputBuffer.toString('base64')}`;
};

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as GeneratePersonaVideoRequest;
    const userPrompt = body?.userPrompt?.trim();
    const personaModelId = body?.personaModelId?.trim();
    const personaTriggerWord = body?.personaTriggerWord?.trim();
    const mode = body?.mode === 'ad' ? 'ad' : 'studio';
    const scriptOverride = body?.script?.trim();
    const productImageUrl = body?.productImageUrl?.trim();
    const waitForCompletion = body?.waitForCompletion ?? mode === 'ad';

    if (!userPrompt || !personaModelId || !personaTriggerWord) {
      return NextResponse.json(
        { error: 'userPrompt, personaModelId, and personaTriggerWord are required' },
        { status: 400 }
      );
    }

    const geminiKey = process.env.GEMINI_API_KEY;
    const elevenLabsKey = process.env.ELEVENLABS_API_KEY;
    const replicateToken = process.env.REPLICATE_API_TOKEN;

    if (!geminiKey || !geminiKey.trim()) {
      return NextResponse.json(
        { error: 'GEMINI_API_KEY not configured' },
        { status: 500 }
      );
    }

    if (!elevenLabsKey || !elevenLabsKey.trim()) {
      return NextResponse.json(
        { error: 'ELEVENLABS_API_KEY not configured' },
        { status: 500 }
      );
    }

    if (!replicateToken || !replicateToken.trim()) {
      return NextResponse.json(
        { error: 'REPLICATE_API_TOKEN not configured' },
        { status: 500 }
      );
    }

    const sourceImage = await resolveSourceImage(personaModelId);

    // Step 1: Gemini (script + visual prompt)
    const resolvedModelId = await getGeminiModelId(geminiKey, geminiModelId);
    const model = createGeminiModel(geminiKey, resolvedModelId);

    let script = scriptOverride || '';
    let visualPrompt = '';
    let attempt = 0;
    while (attempt < 2) {
      attempt += 1;
      const promptSource = scriptOverride || userPrompt;
      const prompt = `${GEMINI_SYSTEM_INSTRUCTION}\n\n${promptSource}\n\nTrigger word: ${personaTriggerWord}`;
      const result = await model.generateContent(prompt);
      const response = await result.response;
      const raw = response.text();
      try {
        const parsed = extractJson(raw);
        if (!scriptOverride) {
          script = String(parsed.script ?? '').trim();
        }
        visualPrompt = String(parsed.visual_prompt ?? '').trim();
        if (!script || !visualPrompt) {
          throw new Error('Gemini JSON missing script or visual_prompt');
        }
        break;
      } catch (error: any) {
        if (attempt >= 2) {
          throw new Error(error.message || 'Failed to parse Gemini JSON response');
        }
      }
    }

    // Step 2: ElevenLabs TTS
    const ttsResponse = await fetch('https://api.elevenlabs.io/v1/text-to-speech/21m00Tcm4TlvDq8ikWAM', {
      method: 'POST',
      headers: {
        Accept: 'audio/mpeg',
        'Content-Type': 'application/json',
        'xi-api-key': elevenLabsKey.trim(),
      },
      body: JSON.stringify({
        text: script,
        model_id: 'eleven_monolingual_v1',
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.5,
        },
      }),
    });

    if (!ttsResponse.ok) {
      const ttsError = await ttsResponse.text();
      throw new Error(`ElevenLabs error: ${ttsResponse.status} ${ttsError}`);
    }

    const audioBuffer = Buffer.from(await ttsResponse.arrayBuffer());
    const audioUrl = `data:audio/mpeg;base64,${audioBuffer.toString('base64')}`;

    // Step 3: Replicate lip-sync
    const replicate = new Replicate({ auth: replicateToken.trim() });
    const lipSyncModel = process.env.REPLICATE_LIPSYNC_MODEL || 'sadtalker';

    const prediction = await replicate.predictions.create({
      version: lipSyncModel,
      input: {
        source_image: sourceImage,
        driven_audio: audioUrl,
        prompt: visualPrompt,
      },
    });

    if (mode === 'ad') {
      if (!productImageUrl) {
        return NextResponse.json(
          { error: 'productImageUrl is required for ad mode' },
          { status: 400 }
        );
      }
      if (waitForCompletion) {
        const baseVideoUrl = await waitForPrediction(replicate, prediction.id);
        const compositedVideoUrl = await composeAdVideo(baseVideoUrl, productImageUrl, script);
        return NextResponse.json({
          predictionId: prediction.id,
          status: 'succeeded',
          videoUrl: compositedVideoUrl,
        });
      }
    }

    return NextResponse.json({
      predictionId: prediction.id,
      status: prediction.status,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        error: error.message || 'Failed to generate persona video',
        details: error.toString(),
      },
      { status: 500 }
    );
  }
}
