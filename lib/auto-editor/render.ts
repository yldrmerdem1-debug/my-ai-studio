import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { getFfmpeg } from '@/lib/ffmpeg-client';
import { persistGeneratedBuffer } from '@/lib/generated-assets';
import type {
  AutoEditorComposerResponse,
  CaptionCue,
  CTAPlan,
  OutputVariant,
  TimelineSegment,
  TimelineSpec,
} from '@/lib/ad-director';
import type { ResolvedEditorAsset } from '@/lib/auto-editor/assets';
import { buildCueDrivenSrt, escapeSubtitlePath } from '@/lib/auto-editor/captions';

const escapeDrawtext = (text: string) => {
  return text.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'");
};

const createTempPath = (suffix: string) => path.join(os.tmpdir(), `auto-editor-${crypto.randomUUID()}${suffix}`);

const formatFfmpegError = (error: unknown, stdout?: unknown, stderr?: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  return `${message}\n${String(stderr || stdout || '')}`;
};

const cleanupTempFiles = async (paths: string[]) => {
  await Promise.all(
    Array.from(new Set(paths))
      .filter(Boolean)
      .map((filePath) => fsPromises.rm(filePath, { force: true }).catch(() => undefined))
  );
};

const buildScaleCropFilter = (variant: OutputVariant) => {
  return `scale=${variant.width}:${variant.height}:force_original_aspect_ratio=increase,crop=${variant.width}:${variant.height},fps=30,format=yuv420p`;
};

const buildImageMotionFilter = (segment: TimelineSegment, variant: OutputVariant) => {
  const baseScale = `scale=${Math.round(variant.width * 1.18)}:${Math.round(variant.height * 1.18)}:force_original_aspect_ratio=increase`;
  if (segment.motion === 'slow-zoom') {
    const frames = Math.max(1, Math.round(segment.targetDurationSec * 30));
    return `${baseScale},zoompan=z='min(zoom+0.0015,1.08)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${variant.width}x${variant.height}:fps=30,format=yuv420p`;
  }
  return `${baseScale},crop=${variant.width}:${variant.height},fps=30,format=yuv420p`;
};

const renderVideoSegment = async (
  asset: ResolvedEditorAsset,
  segment: TimelineSegment,
  variant: OutputVariant
) => {
  const ffmpeg = await getFfmpeg();
  const outputPath = createTempPath('.mp4');
  const segmentDuration = Math.max(0.6, segment.targetDurationSec);

  await new Promise<void>((resolve, reject) => {
    const command = ffmpeg().input(asset.localPath);
    if (!asset.hasAudio) {
      command
        .input('anullsrc=channel_layout=stereo:sample_rate=44100')
        .inputOptions(['-f', 'lavfi']);
    }

    command
      .setStartTime(segment.startSec || 0)
      .duration(segmentDuration)
      .videoFilters(buildScaleCropFilter(variant))
      .outputOptions([
        '-y',
        '-map',
        '0:v:0',
        '-map',
        asset.hasAudio ? '0:a:0?' : '1:a:0',
        '-shortest',
        '-movflags +faststart',
        '-c:v libx264',
        '-profile:v high',
        '-preset medium',
        '-r 30',
        '-pix_fmt yuv420p',
        '-c:a aac',
        '-ar 44100',
        '-ac 2',
        '-b:v 6M',
        '-maxrate 8M',
        '-bufsize 12M',
      ])
      .on('end', () => resolve())
      .on('error', (error: unknown, stdout?: unknown, stderr?: unknown) => {
        reject(new Error(`Video segment render failed: ${formatFfmpegError(error, stdout, stderr)}`));
      })
      .save(outputPath);
  });

  return outputPath;
};

const renderImageSegment = async (
  asset: ResolvedEditorAsset,
  segment: TimelineSegment,
  variant: OutputVariant
) => {
  const ffmpeg = await getFfmpeg();
  const outputPath = createTempPath('.mp4');
  const segmentDuration = Math.max(0.6, segment.targetDurationSec);

  await new Promise<void>((resolve, reject) => {
    ffmpeg()
      .input(asset.localPath)
      .inputOptions(['-loop', '1'])
      .input('anullsrc=channel_layout=stereo:sample_rate=44100')
      .inputOptions(['-f', 'lavfi'])
      .duration(segmentDuration)
      .videoFilters(buildImageMotionFilter(segment, variant))
      .outputOptions([
        '-y',
        '-map',
        '0:v:0',
        '-map',
        '1:a:0',
        '-shortest',
        '-movflags +faststart',
        '-c:v libx264',
        '-profile:v high',
        '-preset medium',
        '-r 30',
        '-pix_fmt yuv420p',
        '-c:a aac',
        '-ar 44100',
        '-ac 2',
        '-b:v 6M',
        '-maxrate 8M',
        '-bufsize 12M',
      ])
      .on('end', () => resolve())
      .on('error', (error: unknown, stdout?: unknown, stderr?: unknown) => {
        reject(new Error(`Image segment render failed: ${formatFfmpegError(error, stdout, stderr)}`));
      })
      .save(outputPath);
  });

  return outputPath;
};

const renderSegment = async (
  segment: TimelineSegment,
  variant: OutputVariant,
  assetMap: Map<string, ResolvedEditorAsset>
) => {
  const asset = assetMap.get(segment.assetId);
  if (!asset) {
    throw new Error(`Timeline segment references missing asset: ${segment.assetId}`);
  }
  return asset.kind === 'video'
    ? renderVideoSegment(asset, segment, variant)
    : renderImageSegment(asset, segment, variant);
};

const concatSegmentFiles = async (segmentFiles: string[]) => {
  const ffmpeg = await getFfmpeg();
  const listPath = createTempPath('.txt');
  const outputPath = createTempPath('.mp4');
  const listContent = segmentFiles
    .map((filePath) => `file '${filePath.replace(/'/g, "'\\''")}'`)
    .join('\n');
  await fsPromises.writeFile(listPath, listContent, 'utf8');

  try {
    await new Promise<void>((resolve, reject) => {
      ffmpeg()
        .input(listPath)
        .inputOptions(['-f', 'concat', '-safe', '0'])
        .outputOptions(['-y', '-c', 'copy', '-movflags +faststart'])
        .on('end', () => resolve())
        .on('error', (error: unknown, stdout?: unknown, stderr?: unknown) => {
          reject(new Error(`Concat failed: ${formatFfmpegError(error, stdout, stderr)}`));
        })
        .save(outputPath);
    });
  } finally {
    await cleanupTempFiles([listPath]);
  }

  return outputPath;
};

const resolveCtaWindow = (timeline: TimelineSpec, ctaPlan: CTAPlan) => {
  const ctaCue = [...timeline.captions].reverse().find((cue) => cue.style === 'cta');
  const ctaSegment = [...timeline.segments].reverse().find((segment) => segment.purpose === 'cta');
  const totalDuration = timeline.totalDurationSec;
  const startSec = ctaCue?.startSec
    ?? (ctaSegment
      ? timeline.segments
        .slice(0, timeline.segments.findIndex((item) => item.id === ctaSegment.id))
        .reduce((sum, item) => sum + item.targetDurationSec, 0)
      : Math.max(0, totalDuration - ctaPlan.durationSec));

  return {
    endSec: Math.min(totalDuration, startSec + Math.max(1.6, ctaPlan.durationSec)),
    startSec,
  };
};

const applyFinishingPass = async (params: {
  ctaPlan: CTAPlan;
  cues: CaptionCue[];
  includeTextOverlays?: boolean;
  logoPath?: string;
  sourcePath: string;
  timeline: TimelineSpec;
  variant: OutputVariant;
}) => {
  const ffmpeg = await getFfmpeg();
  const outputPath = createTempPath('.mp4');
  const includeTextOverlays = params.includeTextOverlays !== false;
  const srtContent = includeTextOverlays ? buildCueDrivenSrt(params.cues) : '';
  const srtPath = srtContent
    ? createTempPath('.srt')
    : null;

  if (srtPath) {
    await fsPromises.writeFile(srtPath, srtContent, 'utf8');
  }

  const ctaWindow = resolveCtaWindow(params.timeline, params.ctaPlan);

  let filter = '[0:v]format=yuv420p[base]';
  let currentLabel = 'base';

  if (params.logoPath) {
    filter += ';[1:v]scale=160:-1[logo]';
    filter += `;[${currentLabel}][logo]overlay=W-w-40:40[withlogo]`;
    currentLabel = 'withlogo';
  }

  if (srtPath) {
    const escapedSrt = escapeSubtitlePath(srtPath);
    filter += `;[${currentLabel}]subtitles='${escapedSrt}'[captioned]`;
    currentLabel = 'captioned';
  }

  let finalLabel = currentLabel;
  if (includeTextOverlays && params.ctaPlan.enabled && params.ctaPlan.text.trim()) {
    const escapedCta = escapeDrawtext(params.ctaPlan.text.trim());
    const boxHeight = params.variant.aspectRatio === '16:9' ? 180 : 220;
    const textSize = params.variant.aspectRatio === '16:9' ? 48 : 56;
    const boxY = Math.max(0, params.variant.height - (boxHeight + 40));
    const textY = Math.max(0, params.variant.height - boxHeight);
    filter += `;[${currentLabel}]drawbox=x=0:y=${boxY}:w=${params.variant.width}:h=${boxHeight}:color=black@0.65:t=fill:enable='between(t,${ctaWindow.startSec},${ctaWindow.endSec})'`;
    filter += `,drawtext=text='${escapedCta}':fontcolor=white:fontsize=${textSize}:x=(${params.variant.width}-text_w)/2:y=${textY}:enable='between(t,${ctaWindow.startSec},${ctaWindow.endSec})'[outv]`;
    finalLabel = 'outv';
  }

  try {
    await new Promise<void>((resolve, reject) => {
      const command = ffmpeg().input(params.sourcePath);
      if (params.logoPath) {
        command.input(params.logoPath);
      }
      command
        .complexFilter(filter)
        .outputOptions([
          '-y',
          '-map',
          `[${finalLabel}]`,
          '-map',
          '0:a:0?',
          '-shortest',
          '-movflags +faststart',
          '-c:v libx264',
          '-profile:v high',
          '-preset medium',
          '-pix_fmt yuv420p',
          '-c:a aac',
        ])
        .on('end', () => resolve())
        .on('error', (error: unknown, stdout?: unknown, stderr?: unknown) => {
          reject(new Error(`Finishing pass failed: ${formatFfmpegError(error, stdout, stderr)}`));
        })
        .save(outputPath);
    });
  } finally {
    if (srtPath) await cleanupTempFiles([srtPath]);
  }

  return outputPath;
};

export const renderEditorTimeline = async (params: {
  assets: ResolvedEditorAsset[];
  outputVariants: OutputVariant[];
  session: AutoEditorComposerResponse['session'];
  timeline: TimelineSpec;
}) => {
  const assetMap = new Map(params.assets.map((asset) => [asset.id, asset]));
  const logoAsset = params.assets.find((asset) => asset.role === 'logo');
  const outputs: Record<string, string> = {};
  const tempFiles: string[] = [];

  try {
    for (const variant of params.outputVariants) {
      const segmentFiles: string[] = [];
      for (const segment of params.timeline.segments) {
        const segmentPath = await renderSegment(segment, variant, assetMap);
        segmentFiles.push(segmentPath);
        tempFiles.push(segmentPath);
      }

      const concatPath = await concatSegmentFiles(segmentFiles);
      tempFiles.push(concatPath);
      const cleanPath = await applyFinishingPass({
        ctaPlan: params.session.ctaPlan,
        cues: [],
        includeTextOverlays: false,
        logoPath: logoAsset?.localPath,
        sourcePath: concatPath,
        timeline: params.timeline,
        variant,
      });
      tempFiles.push(cleanPath);
      const cleanBuffer = await fsPromises.readFile(cleanPath);
      outputs[`${variant.aspectRatio} - Clean / No Text`] = await persistGeneratedBuffer(cleanBuffer, {
        prefix: 'generated/videos',
        suggestedName: `ad-${variant.aspectRatio.replace(':', 'x')}-clean-${crypto.randomUUID()}.mp4`,
        contentType: 'video/mp4',
      });

      const captionedPath = await applyFinishingPass({
        ctaPlan: params.session.ctaPlan,
        cues: params.timeline.captions,
        includeTextOverlays: true,
        logoPath: logoAsset?.localPath,
        sourcePath: concatPath,
        timeline: params.timeline,
        variant,
      });
      tempFiles.push(captionedPath);
      const captionedBuffer = await fsPromises.readFile(captionedPath);
      outputs[`${variant.aspectRatio} - With Captions & CTA`] = await persistGeneratedBuffer(captionedBuffer, {
        prefix: 'generated/videos',
        suggestedName: `ad-${variant.aspectRatio.replace(':', 'x')}-captioned-${crypto.randomUUID()}.mp4`,
        contentType: 'video/mp4',
      });
    }
  } finally {
    await cleanupTempFiles(tempFiles);
  }

  return outputs;
};
