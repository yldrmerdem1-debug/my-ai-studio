import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { SFX_QUALITY_SUFFIX, VOICE_CAST } from '@/lib/voice-constants';

const appendSfxQualityTag = (input: string) => {
  const trimmed = input.trim();
  if (!trimmed) return SFX_QUALITY_SUFFIX.trim();
  if (trimmed.toLowerCase().includes('high fidelity')) return trimmed;
  return `${trimmed}${SFX_QUALITY_SUFFIX}`;
};

const smartShortenSfxText = (input: string, maxChars: number) => {
  const cleaned = input
    .replace(/\s+/g, ' ')
    .replace(/(?:continuous sound of|suddenly|followed by|is heard|there is|there are)\s+/gi, '')
    .trim();
  if (cleaned.length <= maxChars) return cleaned;
  const trimmed = cleaned.slice(0, maxChars - 1).trim().replace(/[.,;:]+$/g, '');
  return `${trimmed}…`;
};

const requestWithRetry = async (url: string, options: RequestInit, maxAttempts = 2) => {
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(url, options);
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Request failed: ${response.status} ${errorText}`);
      }
      return response;
    } catch (error: any) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt >= maxAttempts) break;
    }
  }
  throw lastError ?? new Error('Request failed');
};

export const generateSpeech = async (
  text: string,
  voiceId?: string,
  voiceSettings?: {
    stability?: number;
    similarity_boost?: number;
    style?: number;
    use_speaker_boost?: boolean;
  }
): Promise<string> => {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey || !apiKey.trim()) {
    throw new Error('ELEVENLABS_API_KEY not configured');
  }

  const cleanText = text.trim();
  if (!cleanText) {
    throw new Error('Speech text is required');
  }

  const defaultVoiceId =
    process.env.ELEVENLABS_DEFAULT_VOICE_ID
    || VOICE_CAST.male_heroic
    || '21m00Tcm4TlvDq8ikWAM';
  const resolvedVoiceId = voiceId || defaultVoiceId;
  const defaultStability = Number(process.env.ELEVENLABS_STABILITY ?? 0.35);
  const defaultSimilarity = Number(process.env.ELEVENLABS_SIMILARITY_BOOST ?? 0.75);
  const defaultStyle = Number(process.env.ELEVENLABS_STYLE ?? 0.25);
  const defaultSpeakerBoost = process.env.ELEVENLABS_SPEAKER_BOOST !== 'false';
  const requestBody = {
    text: cleanText,
    model_id: 'eleven_multilingual_v2',
    output_format: 'mp3_44100_192',
    voice_settings: {
      stability: voiceSettings?.stability ?? defaultStability,
      similarity_boost: voiceSettings?.similarity_boost ?? defaultSimilarity,
      style: voiceSettings?.style ?? defaultStyle,
      use_speaker_boost: voiceSettings?.use_speaker_boost ?? defaultSpeakerBoost,
    },
  };

  let response: Response;
  try {
    response = await requestWithRetry(
      `https://api.elevenlabs.io/v1/text-to-speech/${resolvedVoiceId}`,
      {
        method: 'POST',
        headers: {
          Accept: 'audio/mpeg',
          'Content-Type': 'application/json',
          'xi-api-key': apiKey.trim(),
        },
        body: JSON.stringify(requestBody),
      }
    );
  } catch (error: any) {
    const message = String(error?.message || '');
    if (message.includes('voice_not_found') && resolvedVoiceId !== defaultVoiceId) {
      response = await requestWithRetry(
        `https://api.elevenlabs.io/v1/text-to-speech/${defaultVoiceId}`,
        {
          method: 'POST',
          headers: {
            Accept: 'audio/mpeg',
            'Content-Type': 'application/json',
            'xi-api-key': apiKey.trim(),
          },
          body: JSON.stringify(requestBody),
        }
      );
    } else {
      throw error;
    }
  }

  const audioBlob = await response.blob();
  const dir = path.join(process.cwd(), 'public', 'temp');
  await mkdir(dir, { recursive: true });
  const fileName = `${crypto.randomUUID()}.mp3`;
  const filePath = path.join(dir, fileName);
  await pipeline(Readable.fromWeb(audioBlob.stream() as any), createWriteStream(filePath));

  return `/temp/${fileName}`;
};

export const generateAtmosphere = async (prompt: string, durationSeconds = 10): Promise<string> => {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey || !apiKey.trim()) {
    throw new Error('ELEVENLABS_API_KEY not configured');
  }

  const cleanText = prompt.trim();
  if (!cleanText) {
    throw new Error('Atmosphere prompt is required');
  }

  const withTag = appendSfxQualityTag(cleanText);
  const normalizedText = smartShortenSfxText(withTag, 400);

  const response = await requestWithRetry('https://api.elevenlabs.io/v1/sound-generation', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'xi-api-key': apiKey.trim(),
    },
    body: JSON.stringify({
      text: normalizedText,
      duration_seconds: durationSeconds,
      prompt_influence: 0.5,
    }),
  });

  const audioBlob = await response.blob();
  const dir = path.join(process.cwd(), 'public', 'temp');
  await mkdir(dir, { recursive: true });
  const fileName = `${crypto.randomUUID()}.mp3`;
  const filePath = path.join(dir, fileName);
  await pipeline(Readable.fromWeb(audioBlob.stream() as any), createWriteStream(filePath));

  return `/temp/${fileName}`;
};
