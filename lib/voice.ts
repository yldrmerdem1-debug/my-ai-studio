import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

type VoiceFormat = 'mp3' | 'wav';

type VoiceRequest = {
  text: string;
  voiceId?: string;
  format?: VoiceFormat;
  voiceSettings?: {
    stability?: number;
    similarity_boost?: number;
    style?: number;
  };
};

export type VoiceGenerationResult = {
  buffer: Buffer;
  mimeType: string;
  extension: VoiceFormat;
  fileName: string;
  filePath: string;
  publicUrl: string;
};

type SoundEffectRequest = {
  text: string;
  targetDuration?: number;
};

const smartShortenSfxText = (input: string, maxChars: number) => {
  const cleaned = input
    .replace(/\s+/g, ' ')
    .replace(/(?:continuous sound of|suddenly|followed by|is heard|there is|there are)\s+/gi, '')
    .trim();
  const qualityTag = 'high fidelity, cinematic mix, stereo imaging, no vocals';
  const needsTag = !cleaned.toLowerCase().includes('high fidelity');
  const suffix = needsTag ? ` ${qualityTag}` : '';
  if (cleaned.length + suffix.length <= maxChars) {
    return `${cleaned}${suffix}`.trim();
  }
  const budget = Math.max(0, maxChars - suffix.length - 1);
  const trimmed = cleaned.slice(0, budget).trim().replace(/[.,;:]+$/g, '');
  return `${trimmed}…${suffix}`.trim();
};

export const generateVoiceBuffer = async ({
  text,
  voiceId,
  format = 'mp3',
  voiceSettings,
}: VoiceRequest): Promise<VoiceGenerationResult> => {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey || !apiKey.trim()) {
    throw new Error('ELEVENLABS_API_KEY not configured');
  }

  const cleanText = text.trim();
  if (!cleanText) {
    throw new Error('Text is required');
  }

  const resolvedVoiceId = voiceId || '21m00Tcm4TlvDq8ikWAM';
  const acceptHeader = format === 'wav' ? 'audio/wav' : 'audio/mpeg';

  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${resolvedVoiceId}`, {
    method: 'POST',
    headers: {
      Accept: acceptHeader,
      'Content-Type': 'application/json',
      'xi-api-key': apiKey.trim(),
    },
    body: JSON.stringify({
      text: cleanText,
      model_id: 'eleven_multilingual_v2',
      voice_settings: {
        stability: voiceSettings?.stability ?? 0.5,
        similarity_boost: voiceSettings?.similarity_boost ?? 0.5,
        ...(typeof voiceSettings?.style === 'number' ? { style: voiceSettings.style } : {}),
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`ElevenLabs API error: ${response.status} ${errorText}`);
  }

  const audioBlob = await response.blob();
  const buffer = Buffer.from(await audioBlob.arrayBuffer());

  const mimeType = format === 'wav' ? 'audio/wav' : 'audio/mpeg';
  const extension = format === 'wav' ? 'wav' : 'mp3';
  const dir = path.join(process.cwd(), 'public', 'tts');
  await mkdir(dir, { recursive: true });
  const fileName = `${crypto.randomUUID()}.${extension}`;
  const filePath = path.join(dir, fileName);
  await pipeline(Readable.fromWeb(audioBlob.stream() as any), createWriteStream(filePath));

  return {
    buffer,
    mimeType,
    extension,
    fileName,
    filePath,
    publicUrl: `/tts/${fileName}`,
  };
};

export const generateSoundEffectBuffer = async ({
  text,
  targetDuration = 6,
}: SoundEffectRequest): Promise<VoiceGenerationResult> => {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey || !apiKey.trim()) {
    throw new Error('ELEVENLABS_API_KEY not configured');
  }

  const cleanText = text.trim();
  if (!cleanText) {
    throw new Error('Sound effect text is required');
  }
  const maxChars = 400;
  const normalizedText = smartShortenSfxText(cleanText, maxChars);

  const response = await fetch('https://api.elevenlabs.io/v1/sound-generation', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'xi-api-key': apiKey.trim(),
    },
    body: JSON.stringify({
      text: normalizedText,
      duration_seconds: targetDuration,
      prompt_influence: 0.6,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`ElevenLabs SFX error: ${response.status} ${errorText}`);
  }

  const audioBlob = await response.blob();
  const buffer = Buffer.from(await audioBlob.arrayBuffer());
  const mimeType = 'audio/mpeg';
  const extension: VoiceFormat = 'mp3';
  const dir = path.join(process.cwd(), 'public', 'tts');
  await mkdir(dir, { recursive: true });
  const fileName = `${crypto.randomUUID()}.${extension}`;
  const filePath = path.join(dir, fileName);
  await pipeline(Readable.fromWeb(audioBlob.stream() as any), createWriteStream(filePath));

  return {
    buffer,
    mimeType,
    extension,
    fileName,
    filePath,
    publicUrl: `/tts/${fileName}`,
  };
};

export const generateSpeechAudioUrl = async ({
  text,
  voiceId,
  format = 'mp3',
  voiceSettings,
}: VoiceRequest): Promise<string> => {
  const result = await generateVoiceBuffer({ text, voiceId, format, voiceSettings });
  return result.publicUrl;
};
