import ffmpeg from 'fluent-ffmpeg';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { generateSoundEffectBuffer, generateVoiceBuffer } from '@/lib/voice';

type VideoProcessorInput = {
  videoUrl: string;
  dialogue: string;
  audioCategory?: 'speech' | 'sfx' | 'none';
  targetDuration?: number;
  voiceId?: string;
  format?: 'mp3' | 'wav';
};

export type VideoProcessorResult = {
  videoUrl: string;
  audioMerged: boolean;
  audioUrl?: string;
};

const isDataUrl = (value: string) => value.startsWith('data:');

const bufferFromDataUrl = (dataUrl: string) => {
  const commaIndex = dataUrl.indexOf(',');
  if (commaIndex === -1) {
    throw new Error('Invalid data URL');
  }
  const base64 = dataUrl.slice(commaIndex + 1);
  return Buffer.from(base64, 'base64');
};

const resolveBaseUrl = () => {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return 'http://localhost:3000';
};

const requestAudioBuffer = async (
  audioCategory: 'speech' | 'sfx' | 'none',
  text: string,
  voiceId?: string,
  format: 'mp3' | 'wav' = 'mp3',
  targetDuration = 6
) => {
  if (audioCategory === 'none') {
    return null;
  }
  if (audioCategory === 'sfx') {
    const voice = await generateSoundEffectBuffer({ text, targetDuration });
    return {
      buffer: voice.buffer,
      extension: voice.extension,
      publicUrl: voice.publicUrl,
    };
  }

  const payload = { text, voiceId, format };
  try {
    const response = await fetch(`${resolveBaseUrl()}/api/voice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (response.ok) {
      const buffer = Buffer.from(await response.arrayBuffer());
      const audioUrl = response.headers.get('x-audio-file') || undefined;
      return {
        buffer,
        extension: format,
        publicUrl: audioUrl,
      };
    }
  } catch (error) {
    console.warn('Voice API call failed, falling back to direct ElevenLabs.', error);
  }

  const voice = await generateVoiceBuffer({ text, voiceId, format });
  return {
    buffer: voice.buffer,
    extension: voice.extension,
    publicUrl: voice.publicUrl,
  };
};

const fetchToBuffer = async (url: string) => {
  if (isDataUrl(url)) {
    return bufferFromDataUrl(url);
  }

  if (url.startsWith('/api/')) {
    const response = await fetch(`${resolveBaseUrl()}${url}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch api asset: ${response.status}`);
    }
    return Buffer.from(await response.arrayBuffer());
  }

  if (url.startsWith('/')) {
    const filePath = path.join(process.cwd(), 'public', url.replace(/^\//, ''));
    return await fsPromises.readFile(filePath);
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch asset: ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
};

const writeTempFile = async (buffer: Buffer, filename: string) => {
  const tempDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'video-processor-'));
  const filePath = path.join(tempDir, filename);
  await fsPromises.writeFile(filePath, buffer);
  return filePath;
};

const writePublicVideo = async (buffer: Buffer) => {
  const dir = path.join(process.cwd(), 'public', 'generated');
  await fsPromises.mkdir(dir, { recursive: true });
  const fileName = `voice-${crypto.randomUUID()}.mp4`;
  const filePath = path.join(dir, fileName);
  await fsPromises.writeFile(filePath, buffer);
  return `/generated/${fileName}`;
};

const assertNonEmptyFile = (filePath: string, label: string) => {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`${label} file missing at ${resolved}`);
  }
  const stats = fs.statSync(resolved);
  if (!stats || stats.size <= 0) {
    throw new Error(`${label} file is empty at ${resolved}`);
  }
  return resolved;
};

const mergeVideoAndAudio = async (videoPath: string, audioPath: string) => {
  const outputPath = path.resolve(os.tmpdir(), `merged-${crypto.randomUUID()}.mp4`);
  await new Promise<void>((resolve, reject) => {
    ffmpeg()
      .input(videoPath)
      .input(audioPath)
      .outputOptions([
        '-y',
        '-map 0:v:0',
        '-map 1:a:0',
        '-shortest',
        '-movflags +faststart',
        '-c:v copy',
        '-c:a aac',
      ])
      .on('end', () => resolve())
      .on('error', (error, stdout, stderr) => {
        const details = stderr || stdout || '';
        reject(new Error(`FFmpeg merge failed: ${error?.message || error}\n${details}`));
      })
      .save(outputPath);
  });
  return await fsPromises.readFile(outputPath);
};

export const mixVideoWithVoiceAndSfx = async ({
  videoUrl,
  voiceUrl,
  sfxUrl,
  voiceVolume = 1.0,
  sfxVolume = 0.25,
}: {
  videoUrl: string;
  voiceUrl: string;
  sfxUrl: string;
  voiceVolume?: number;
  sfxVolume?: number;
}): Promise<VideoProcessorResult> => {
  const [videoBuffer, voiceBuffer, sfxBuffer] = await Promise.all([
    fetchToBuffer(videoUrl),
    fetchToBuffer(voiceUrl),
    fetchToBuffer(sfxUrl),
  ]);

  const [videoPath, voicePath, sfxPath] = await Promise.all([
    writeTempFile(videoBuffer, 'source.mp4'),
    writeTempFile(voiceBuffer, 'voice.mp3'),
    writeTempFile(sfxBuffer, 'sfx.mp3'),
  ]);

  const resolvedVideoPath = assertNonEmptyFile(videoPath, 'Video');
  const resolvedVoicePath = assertNonEmptyFile(voicePath, 'Voice');
  const resolvedSfxPath = assertNonEmptyFile(sfxPath, 'SFX');

  const outputPath = path.resolve(os.tmpdir(), `mix-${crypto.randomUUID()}.mp4`);
  await new Promise<void>((resolve, reject) => {
    ffmpeg()
      .input(resolvedVideoPath)
      .input(resolvedVoicePath)
      .input(resolvedSfxPath)
      .outputOptions([
        '-y',
        '-map 0:v:0',
        '-map [aout]',
        '-shortest',
        '-movflags +faststart',
        '-c:v copy',
        '-c:a aac',
      ])
      .complexFilter([
        `[1:a]volume=${voiceVolume}[voice]`,
        `[2:a]volume=${sfxVolume}[sfx]`,
        '[voice][sfx]amix=inputs=2:normalize=0[aout]',
      ])
      .on('end', () => resolve())
      .on('error', (error, stdout, stderr) => {
        const details = stderr || stdout || '';
        reject(new Error(`FFmpeg mix failed: ${error?.message || error}\n${details}`));
      })
      .save(outputPath);
  });

  const mixedBuffer = await fsPromises.readFile(outputPath);
  const mixedUrl = await writePublicVideo(mixedBuffer);
  return {
    videoUrl: mixedUrl,
    audioMerged: true,
  };
};

export const mixVideoWithDucking = async ({
  videoUrl,
  voiceUrl,
  sfxUrl,
  voiceVolume = 1.0,
  sfxBedVolume = 0.6,
  duckedSfxVolume = 0.2,
}: {
  videoUrl: string;
  voiceUrl: string;
  sfxUrl: string;
  voiceVolume?: number;
  sfxBedVolume?: number;
  duckedSfxVolume?: number;
}): Promise<VideoProcessorResult> => {
  const [videoBuffer, voiceBuffer, sfxBuffer] = await Promise.all([
    fetchToBuffer(videoUrl),
    fetchToBuffer(voiceUrl),
    fetchToBuffer(sfxUrl),
  ]);

  const [videoPath, voicePath, sfxPath] = await Promise.all([
    writeTempFile(videoBuffer, 'source.mp4'),
    writeTempFile(voiceBuffer, 'voice.mp3'),
    writeTempFile(sfxBuffer, 'sfx.mp3'),
  ]);

  const resolvedVideoPath = assertNonEmptyFile(videoPath, 'Video');
  const resolvedVoicePath = assertNonEmptyFile(voicePath, 'Voice');
  const resolvedSfxPath = assertNonEmptyFile(sfxPath, 'SFX');

  const outputPath = path.resolve(os.tmpdir(), `duck-${crypto.randomUUID()}.mp4`);
  await new Promise<void>((resolve, reject) => {
    ffmpeg()
      .input(resolvedVideoPath)
      .input(resolvedVoicePath)
      .input(resolvedSfxPath)
      .outputOptions([
        '-y',
        '-map [outv]',
        '-map [aout]',
        '-shortest',
        '-movflags +faststart',
        '-c:v libx264',
        '-profile:v high',
        '-preset slow',
        '-b:v 6M',
        '-maxrate 8M',
        '-bufsize 12M',
        '-c:a aac',
      ])
      .complexFilter([
        `[0:v]noise=alls=10:allf=t+u,vignette=PI/4[outv]`,
        `[1:a]volume=${voiceVolume},acompressor=threshold=0.1:ratio=3:attack=20:release=250[voice]`,
        `[2:a]volume=${sfxBedVolume}[sfxbed]`,
        `[sfxbed][voice]sidechaincompress=threshold=0.05:ratio=6:attack=20:release=250[sfxduck]`,
        `[sfxduck]volume=${duckedSfxVolume / Math.max(sfxBedVolume, 0.01)}[sfx]`,
        '[voice][sfx]amix=inputs=2:normalize=0[aout]',
      ])
      .on('end', () => resolve())
      .on('error', (error, stdout, stderr) => {
        const details = stderr || stdout || '';
        reject(new Error(`FFmpeg ducking mix failed: ${error?.message || error}\n${details}`));
      })
      .save(outputPath);
  });

  const mixedBuffer = await fsPromises.readFile(outputPath);
  const mixedUrl = await writePublicVideo(mixedBuffer);
  return {
    videoUrl: mixedUrl,
    audioMerged: true,
  };
};

export const mergeVideoWithAudioUrl = async ({
  videoUrl,
  audioUrl,
  audioVolume = 1.0,
}: {
  videoUrl: string;
  audioUrl: string;
  audioVolume?: number;
}): Promise<VideoProcessorResult> => {
  const [videoBuffer, audioBuffer] = await Promise.all([
    fetchToBuffer(videoUrl),
    fetchToBuffer(audioUrl),
  ]);

  const [videoPath, audioPath] = await Promise.all([
    writeTempFile(videoBuffer, 'source.mp4'),
    writeTempFile(audioBuffer, 'audio.mp3'),
  ]);

  const resolvedVideoPath = assertNonEmptyFile(videoPath, 'Video');
  const resolvedAudioPath = assertNonEmptyFile(audioPath, 'Audio');

  const outputPath = path.resolve(os.tmpdir(), `merge-${crypto.randomUUID()}.mp4`);
  await new Promise<void>((resolve, reject) => {
    ffmpeg()
      .input(resolvedVideoPath)
      .input(resolvedAudioPath)
      .outputOptions([
        '-y',
        '-map [outv]',
        '-map [aout]',
        '-shortest',
        '-movflags +faststart',
        '-c:v libx264',
        '-profile:v high',
        '-preset slow',
        '-b:v 6M',
        '-maxrate 8M',
        '-bufsize 12M',
        '-c:a aac',
      ])
      .complexFilter([
        `[0:v]noise=alls=10:allf=t+u,vignette=PI/4[outv]`,
        `[1:a]volume=${audioVolume},acompressor=threshold=0.1:ratio=3:attack=20:release=250[aout]`,
      ])
      .on('end', () => resolve())
      .on('error', (error, stdout, stderr) => {
        const details = stderr || stdout || '';
        reject(new Error(`FFmpeg merge failed: ${error?.message || error}\n${details}`));
      })
      .save(outputPath);
  });

  const mergedBuffer = await fsPromises.readFile(outputPath);
  const mergedUrl = await writePublicVideo(mergedBuffer);
  return {
    videoUrl: mergedUrl,
    audioMerged: true,
  };
};

export const processVideoWithAudio = async ({
  videoUrl,
  dialogue,
  audioCategory = 'speech',
  targetDuration = 6,
  voiceId,
  format = 'mp3',
}: VideoProcessorInput): Promise<VideoProcessorResult> => {
  if (audioCategory !== 'sfx' && !dialogue.trim()) {
    return { videoUrl, audioMerged: false };
  }

  const [videoBuffer, voice] = await Promise.all([
    fetchToBuffer(videoUrl),
    requestAudioBuffer(audioCategory, dialogue, voiceId, format, targetDuration),
  ]);

  if (!voice || !voice.buffer.length) {
    throw new Error('Audio generation failed: empty buffer.');
  }

  const [videoPath, audioPath] = await Promise.all([
    writeTempFile(videoBuffer, 'source.mp4'),
    writeTempFile(voice.buffer, `voice.${voice.extension}`),
  ]);

  const resolvedVideoPath = assertNonEmptyFile(videoPath, 'Video');
  const resolvedAudioPath = assertNonEmptyFile(audioPath, 'Audio');
  const mergedBuffer = await mergeVideoAndAudio(resolvedVideoPath, resolvedAudioPath);
  const mergedUrl = await writePublicVideo(mergedBuffer);

  return {
    videoUrl: mergedUrl,
    audioMerged: true,
    audioUrl: voice.publicUrl,
  };
};
