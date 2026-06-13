import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

type FfmpegCommandLike = {
  complexFilter: (filter: string) => FfmpegCommandLike;
  duration: (seconds: number) => FfmpegCommandLike;
  input: (source: string) => FfmpegCommandLike;
  inputOptions: (options: string[]) => FfmpegCommandLike;
  on: (event: string, handler: (...args: unknown[]) => void) => FfmpegCommandLike;
  outputOptions: (options: string[]) => FfmpegCommandLike;
  save: (path: string) => void;
  setStartTime: (seconds: number) => FfmpegCommandLike;
  videoFilters: (filters: string) => FfmpegCommandLike;
};

type FfmpegLike = ((input?: string) => FfmpegCommandLike) & {
  ffprobe: (
    filePath: string,
    callback: (error: Error | null, metadata: { format?: { duration?: number } }) => void
  ) => void;
  setFfmpegPath?: (path: string) => void;
  setFfprobePath?: (path: string) => void;
};

let ffmpegPromise: Promise<unknown> | null = null;
const require = createRequire(import.meta.url);

const resolveStaticBinaryPath = (packageName: 'ffmpeg-static' | 'ffprobe-static') => {
  const rootPath = process.cwd();
  if (packageName === 'ffmpeg-static') {
    const executableName = os.platform() === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
    const candidate = path.join(rootPath, 'node_modules', 'ffmpeg-static', executableName);
    if (fs.existsSync(candidate)) return candidate;
    return require('ffmpeg-static') as string | null;
  }

  const executableName = os.platform() === 'win32' ? 'ffprobe.exe' : 'ffprobe';
  const candidate = path.join(rootPath, 'node_modules', 'ffprobe-static', 'bin', os.platform(), os.arch(), executableName);
  if (fs.existsSync(candidate)) return candidate;
  return (require('ffprobe-static') as { path?: string } | undefined)?.path || '';
};

export const getFfmpeg = async (): Promise<FfmpegLike> => {
  if (!ffmpegPromise) {
    ffmpegPromise = (async () => {
      const ffmpegModule = await import('fluent-ffmpeg');
      const fluent = ('default' in ffmpegModule ? ffmpegModule.default : ffmpegModule) as FfmpegLike;
      const ffmpegPath = resolveStaticBinaryPath('ffmpeg-static');
      const ffprobePath = resolveStaticBinaryPath('ffprobe-static');

      if (ffmpegPath && fluent.setFfmpegPath) {
        fluent.setFfmpegPath(ffmpegPath);
      }
      if (ffprobePath && fluent.setFfprobePath) {
        fluent.setFfprobePath(ffprobePath);
      }

      return fluent;
    })();
  }
  const ffmpegModule = await ffmpegPromise as FfmpegLike;
  return ffmpegModule;
};
