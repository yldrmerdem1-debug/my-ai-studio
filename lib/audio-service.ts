import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

type SpeechRequest = {
  text: string;
  voiceId?: string;
  emotion_level?: number;
  emotion_prompt?: string;
};

type SfxRequest = {
  text: string;
  durationSeconds?: number;
  promptInfluence?: number;
};

const normalizeEmotionLevel = (value?: number) => {
  if (typeof value !== 'number' || Number.isNaN(value)) return 0.5;
  return Math.min(1, Math.max(0, value));
};

const appendSfxQualityTag = (input: string) => {
  const tag = 'high fidelity, cinematic atmosphere, stereo, clear audio';
  const trimmed = input.trim();
  if (!trimmed) return tag;
  if (trimmed.toLowerCase().includes('high fidelity')) return trimmed;
  return `${trimmed}, ${tag}`;
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

export const generateSpeech = async ({
  text,
  voiceId,
  emotion_level,
  emotion_prompt,
}: SpeechRequest): Promise<string> => {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey || !apiKey.trim()) {
    throw new Error('ELEVENLABS_API_KEY not configured');
  }

  const cleanText = text.trim();
  if (!cleanText) {
    throw new Error('Speech text is required');
  }

  const resolvedVoiceId = voiceId || '21m00Tcm4TlvDq8ikWAM';
  const derivedEmotion = typeof emotion_level === 'number'
    ? emotion_level
    : emotion_prompt && emotion_prompt.trim()
      ? 0.6
      : 0.5;
  const emotion = normalizeEmotionLevel(derivedEmotion);
  const stability = emotion >= 0.6 ? 0.35 : 0.5;

  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${resolvedVoiceId}`, {
    method: 'POST',
    headers: {
      Accept: 'audio/mpeg',
      'Content-Type': 'application/json',
      'xi-api-key': apiKey.trim(),
    },
    body: JSON.stringify({
      text: cleanText,
      model_id: 'eleven_multilingual_v2',
      output_format: 'mp3_44100_192',
      voice_settings: {
        stability,
        similarity_boost: 0.75,
        style: 0.25,
        use_speaker_boost: true,
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`ElevenLabs TTS error: ${response.status} ${errorText}`);
  }

  const audioBlob = await response.blob();
  const dir = path.join(process.cwd(), 'public', 'tts');
  await mkdir(dir, { recursive: true });
  const fileName = `${crypto.randomUUID()}.mp3`;
  const filePath = path.join(dir, fileName);
  await pipeline(Readable.fromWeb(audioBlob.stream() as any), createWriteStream(filePath));

  return `/tts/${fileName}`;
};

export const generateSFX = async ({
  text,
  durationSeconds = 10,
  promptInfluence = 0.5,
}: SfxRequest): Promise<string> => {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey || !apiKey.trim()) {
    throw new Error('ELEVENLABS_API_KEY not configured');
  }

  const cleanText = text.trim();
  if (!cleanText) {
    throw new Error('SFX text is required');
  }

  const withTag = appendSfxQualityTag(cleanText);
  const normalizedText = smartShortenSfxText(withTag, 400);

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
