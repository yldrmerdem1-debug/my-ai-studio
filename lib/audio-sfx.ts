import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

type SoundEffectRequest = {
  text: string;
  durationSeconds?: number;
  promptInfluence?: number;
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

export const generateSoundEffect = async ({
  text,
  durationSeconds = 12,
  promptInfluence = 0.5,
}: SoundEffectRequest): Promise<string> => {
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
      duration_seconds: durationSeconds,
      prompt_influence: promptInfluence,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`ElevenLabs SFX error: ${response.status} ${errorText}`);
  }

  const audioBlob = await response.blob();
  const dir = path.join(process.cwd(), 'public', 'sfx');
  await mkdir(dir, { recursive: true });
  const fileName = `${crypto.randomUUID()}.mp3`;
  const filePath = path.join(dir, fileName);
  await pipeline(Readable.fromWeb(audioBlob.stream() as any), createWriteStream(filePath));

  return `/sfx/${fileName}`;
};
