type FfmpegLike = ((input?: string) => any) & {
  ffprobe: (
    filePath: string,
    callback: (error: Error | null, metadata: { format?: { duration?: number } }) => void
  ) => void;
};

let ffmpegPromise: Promise<unknown> | null = null;

export const getFfmpeg = async (): Promise<FfmpegLike> => {
  if (!ffmpegPromise) {
    ffmpegPromise = import('fluent-ffmpeg');
  }
  const ffmpegModule = await ffmpegPromise as { default?: FfmpegLike } | FfmpegLike;
  return ('default' in ffmpegModule ? ffmpegModule.default : ffmpegModule) as FfmpegLike;
};
