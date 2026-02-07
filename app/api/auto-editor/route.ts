import { NextResponse } from 'next/server';
import ffmpeg from 'fluent-ffmpeg';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

export const runtime = 'nodejs';

type AutoEditorRequest = {
  videoUrl: string;
  logoDataUrl?: string;
  ctaText?: string;
  captionsText?: string;
  addCaptions?: boolean;
  outputFormats?: string[];
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
  const tempDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'auto-editor-'));
  const filePath = path.join(tempDir, filename);
  await fsPromises.writeFile(filePath, buffer);
  return filePath;
};

const writePublicVideo = async (buffer: Buffer) => {
  const dir = path.join(process.cwd(), 'public', 'generated');
  await fsPromises.mkdir(dir, { recursive: true });
  const fileName = `ad-${crypto.randomUUID()}.mp4`;
  const filePath = path.join(dir, fileName);
  await fsPromises.writeFile(filePath, buffer);
  return `/generated/${fileName}`;
};

const formatSrtTime = (seconds: number) => {
  const totalMs = Math.max(0, Math.floor(seconds * 1000));
  const ms = totalMs % 1000;
  const totalSeconds = Math.floor(totalMs / 1000);
  const s = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const m = totalMinutes % 60;
  const h = Math.floor(totalMinutes / 60);
  const pad = (value: number, size = 2) => String(value).padStart(size, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`;
};

const buildSrt = (text: string, durationSeconds: number) => {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';
  const words = cleaned.split(' ');
  const chunkSize = 3;
  const chunks: string[] = [];
  for (let i = 0; i < words.length; i += chunkSize) {
    chunks.push(words.slice(i, i + chunkSize).join(' '));
  }
  const totalWords = words.length;
  let cursor = 0;
  const lines: string[] = [];
  chunks.forEach((chunk, index) => {
    const wordCount = chunk.split(' ').length;
    const duration = (wordCount / totalWords) * durationSeconds;
    const start = cursor;
    const end = index === chunks.length - 1
      ? durationSeconds
      : Math.min(durationSeconds, cursor + duration);
    cursor = end;
    lines.push(`${index + 1}`);
    lines.push(`${formatSrtTime(start)} --> ${formatSrtTime(end)}`);
    lines.push(chunk);
    lines.push('');
  });
  return lines.join('\n');
};

const escapeDrawtext = (text: string) => {
  return text.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'");
};

const escapeSubtitlePath = (filePath: string) => {
  return filePath.replace(/\\/g, '/').replace(/:/g, '\\:');
};

const getVideoDuration = (filePath: string) => {
  return new Promise<number>((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (error, metadata) => {
      if (error) {
        reject(error);
        return;
      }
      const duration = Number(metadata.format?.duration || 0);
      resolve(Number.isFinite(duration) && duration > 0 ? duration : 12);
    });
  });
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as AutoEditorRequest;
    const videoUrl = body?.videoUrl?.trim();
    if (!videoUrl) {
      return NextResponse.json({ error: 'videoUrl is required' }, { status: 400 });
    }

    const videoBuffer = await fetchToBuffer(videoUrl);
    const videoPath = await writeTempFile(videoBuffer, 'source.mp4');
    const durationSeconds = await getVideoDuration(videoPath);

    const logoDataUrl = body?.logoDataUrl;
    const logoPath = logoDataUrl ? await writeTempFile(bufferFromDataUrl(logoDataUrl), 'logo.png') : null;
    const addCaptions = Boolean(body?.addCaptions);
    const captionsText = body?.captionsText?.trim() || '';
    const ctaText = body?.ctaText?.trim() || '';
    const outputFormats = Array.isArray(body?.outputFormats) && body.outputFormats.length > 0
      ? body.outputFormats
      : ['9:16'];

    let srtPath: string | null = null;
    if (addCaptions && captionsText) {
      const srtContent = buildSrt(captionsText, durationSeconds);
      if (srtContent) {
        srtPath = await writeTempFile(Buffer.from(srtContent, 'utf-8'), 'captions.srt');
      }
    }

    const outputs: Record<string, string> = {};
    for (const format of outputFormats) {
      const outputPath = path.join(os.tmpdir(), `auto-${crypto.randomUUID()}.mp4`);
      const scaleFilter = format === '16:9'
        ? 'scale=1920:1080:force_original_aspect_ratio=cover,crop=1920:1080'
        : 'scale=1080:1920:force_original_aspect_ratio=cover,crop=1080:1920';
      let filter = `[0:v]${scaleFilter},format=yuv420p[base]`;
      let currentLabel = 'base';
      if (logoPath) {
        filter += `;[1:v]scale=160:-1[logo]`;
        filter += `;[${currentLabel}][logo]overlay=W-w-40:40[withlogo]`;
        currentLabel = 'withlogo';
      }
      if (srtPath) {
        const escapedSrt = escapeSubtitlePath(srtPath);
        filter += `;[${currentLabel}]subtitles='${escapedSrt}'[captioned]`;
        currentLabel = 'captioned';
      }
      let finalLabel = currentLabel;
      if (ctaText) {
        const escapedCta = escapeDrawtext(ctaText);
        const ctaStart = Math.max(0, durationSeconds - 2.5);
        filter += `;[${currentLabel}]drawbox=x=0:y=h-260:w=w:h=220:color=black@0.65:t=fill:enable='between(t,${ctaStart},${durationSeconds})'`;
        filter += `,drawtext=text='${escapedCta}':fontcolor=white:fontsize=56:x=(w-text_w)/2:y=h-200:box=1:boxcolor=black@0.0:enable='between(t,${ctaStart},${durationSeconds})'[outv]`;
        finalLabel = 'outv';
      }

      const command = ffmpeg().input(videoPath);
      if (logoPath) {
        command.input(logoPath);
      }
      await new Promise<void>((resolve, reject) => {
        command
          .outputOptions([
            '-y',
            '-map',
            finalLabel,
            '-map',
            '0:a?',
            '-shortest',
            '-movflags +faststart',
            '-c:v libx264',
            '-profile:v high',
            '-preset medium',
            '-b:v 6M',
            '-maxrate 8M',
            '-bufsize 12M',
            '-c:a aac',
          ])
          .complexFilter(filter)
          .on('end', () => resolve())
          .on('error', (err, stdout, stderr) => {
            reject(new Error(`FFmpeg packaging failed: ${err?.message || err}\n${stderr || stdout || ''}`));
          })
          .save(outputPath);
      });

      const outputBuffer = await fsPromises.readFile(outputPath);
      const publicUrl = await writePublicVideo(outputBuffer);
      outputs[format] = publicUrl;
    }

    return NextResponse.json({ outputs });
  } catch (error: any) {
    console.error('Auto-editor error:', error);
    return NextResponse.json({ error: error.message || 'Failed to package video' }, { status: 500 });
  }
}
