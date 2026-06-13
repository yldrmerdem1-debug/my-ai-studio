import type { CaptionCue } from '@/lib/ad-director';

export const formatSrtTime = (seconds: number) => {
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

export const buildCueDrivenSrt = (cues: CaptionCue[]) => {
  if (!Array.isArray(cues) || cues.length === 0) return '';

  return cues
    .filter((cue) => cue.text.trim() && cue.endSec > cue.startSec)
    .map((cue, index) => [
      String(index + 1),
      `${formatSrtTime(cue.startSec)} --> ${formatSrtTime(cue.endSec)}`,
      cue.text.trim(),
      '',
    ].join('\n'))
    .join('\n');
};

export const escapeSubtitlePath = (filePath: string) => {
  return filePath.replace(/\\/g, '/').replace(/:/g, '\\:');
};
