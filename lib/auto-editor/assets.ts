import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { getConfiguredSiteUrl } from '@/lib/site-url';
import { getFfmpeg } from '@/lib/ffmpeg-client';
import type { EditorAsset } from '@/lib/ad-director';

export type ResolvedEditorAsset = EditorAsset & {
  contentType?: string;
  durationSec: number;
  hasAudio?: boolean;
  height: number;
  localPath: string;
  width: number;
};

const EXT_BY_MIME: Record<string, string> = {
  'image/gif': 'gif',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
};

const isDataUrl = (value: string) => value.startsWith('data:');

const resolveBaseUrl = () => getConfiguredSiteUrl();
const MAX_ASSET_BYTES = Math.max(
  1,
  Number(process.env.AUTO_EDITOR_MAX_ASSET_MB || '') || 250
) * 1024 * 1024;
const ASSET_FETCH_TIMEOUT_MS = Math.max(
  5000,
  Number(process.env.AUTO_EDITOR_ASSET_FETCH_TIMEOUT_MS || '') || 30000
);

const isPrivateHostname = (hostname: string) => {
  const normalized = hostname.toLowerCase();
  if (
    normalized === 'localhost'
    || normalized.endsWith('.localhost')
    || normalized.endsWith('.local')
    || normalized === '::1'
    || normalized === '[::1]'
  ) {
    return true;
  }
  const ipv4 = normalized.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ipv4) return false;
  const [a, b] = ipv4.slice(1).map(Number);
  return a === 10
    || a === 127
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || a === 0;
};

const assertAllowedRemoteAssetUrl = (url: string) => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Invalid asset URL');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('Asset URL must use http or https');
  }
  const baseUrl = new URL(resolveBaseUrl());
  if (parsed.hostname !== baseUrl.hostname && isPrivateHostname(parsed.hostname)) {
    throw new Error('Private or local network asset URLs are not allowed');
  }
};

const assertAssetSize = (size: number) => {
  if (size > MAX_ASSET_BYTES) {
    throw new Error(`Auto-editor asset is too large. Maximum allowed size is ${Math.round(MAX_ASSET_BYTES / 1024 / 1024)} MB.`);
  }
};

const fetchWithTimeout = async (url: string) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ASSET_FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
};

const bufferFromDataUrl = (dataUrl: string) => {
  const commaIndex = dataUrl.indexOf(',');
  if (commaIndex === -1) {
    throw new Error('Invalid data URL');
  }
  const meta = dataUrl.slice(0, commaIndex);
  const contentType = meta.match(/^data:(.+?);base64$/)?.[1] || 'application/octet-stream';
  const buffer = Buffer.from(dataUrl.slice(commaIndex + 1), 'base64');
  assertAssetSize(buffer.byteLength);
  return {
    buffer,
    contentType,
  };
};

const fetchAssetSource = async (url: string) => {
  if (isDataUrl(url)) {
    return bufferFromDataUrl(url);
  }

  if (url.startsWith('/api/')) {
    const response = await fetchWithTimeout(`${resolveBaseUrl()}${url}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch api asset: ${response.status}`);
    }
    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength) assertAssetSize(contentLength);
    const buffer = Buffer.from(await response.arrayBuffer());
    assertAssetSize(buffer.byteLength);
    return {
      buffer,
      contentType: response.headers.get('content-type') || 'application/octet-stream',
    };
  }

  if (url.startsWith('/')) {
    const publicDir = path.join(process.cwd(), 'public');
    const filePath = path.resolve(publicDir, url.replace(/^\//, ''));
    if (filePath !== publicDir && !filePath.startsWith(`${publicDir}${path.sep}`)) {
      throw new Error('Asset path must stay inside the public directory');
    }
    const stats = await fsPromises.stat(filePath);
    assertAssetSize(stats.size);
    return {
      buffer: await fsPromises.readFile(filePath),
      contentType: '',
    };
  }

  assertAllowedRemoteAssetUrl(url);
  const response = await fetchWithTimeout(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch asset: ${response.status}`);
  }
  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength) assertAssetSize(contentLength);
  const buffer = Buffer.from(await response.arrayBuffer());
  assertAssetSize(buffer.byteLength);
  return {
    buffer,
    contentType: response.headers.get('content-type') || 'application/octet-stream',
  };
};

const resolveExtension = (url: string, contentType: string, kind: EditorAsset['kind']) => {
  const normalizedType = String(contentType || '').split(';')[0].trim().toLowerCase();
  if (EXT_BY_MIME[normalizedType]) return EXT_BY_MIME[normalizedType];
  const ext = path.extname(url.split('?')[0]).replace('.', '').toLowerCase();
  if (ext) return ext;
  return kind === 'video' ? 'mp4' : 'png';
};

const writeTempFile = async (buffer: Buffer, extension: string) => {
  const tempDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'auto-editor-asset-'));
  const filePath = path.join(tempDir, `${crypto.randomUUID()}.${extension}`);
  await fsPromises.writeFile(filePath, buffer);
  return filePath;
};

const probeMedia = async (filePath: string, fallbackDurationSec: number) => {
  const ffmpeg = await getFfmpeg();
  return new Promise<{ durationSec: number; hasAudio: boolean; width: number; height: number }>((resolve) => {
    ffmpeg.ffprobe(filePath, (error: Error | null, metadata: { format?: { duration?: number }; streams?: Array<{ codec_type?: string; width?: number; height?: number }> }) => {
      if (error) {
        console.warn('[auto-editor] ffprobe unavailable, using fallback metadata:', error.message);
        resolve({
          durationSec: fallbackDurationSec,
          hasAudio: true,
          height: 0,
          width: 0,
        });
        return;
      }
      const videoStream = Array.isArray(metadata.streams)
        ? metadata.streams.find((stream) => stream.codec_type === 'video')
        : undefined;
      const hasAudio = Array.isArray(metadata.streams)
        ? metadata.streams.some((stream) => stream.codec_type === 'audio')
        : false;
      resolve({
        durationSec: Number.isFinite(Number(metadata.format?.duration))
          ? Number(metadata.format?.duration)
          : fallbackDurationSec,
        hasAudio,
        height: Number(videoStream?.height || 0),
        width: Number(videoStream?.width || 0),
      });
    });
  });
};

export const resolveEditorAssets = async (assets: EditorAsset[]) => {
  return Promise.all(assets.map(async (asset): Promise<ResolvedEditorAsset> => {
    const { buffer, contentType } = await fetchAssetSource(asset.url);
    const extension = resolveExtension(asset.url, contentType, asset.kind);
    const localPath = await writeTempFile(buffer, extension);
    const probed = await probeMedia(localPath, asset.durationSec || (asset.kind === 'video' ? 12 : 2.5));
    return {
      ...asset,
      contentType,
      durationSec: asset.kind === 'image'
        ? (asset.durationSec || 2.5)
        : (probed.durationSec || asset.durationSec || 12),
      hasAudio: probed.hasAudio,
      height: asset.height || probed.height || 0,
      localPath,
      width: asset.width || probed.width || 0,
    };
  }));
};

export const cleanupResolvedEditorAssets = async (assets: ResolvedEditorAsset[]) => {
  const tempDirs = Array.from(new Set(
    assets
      .map((asset) => path.dirname(asset.localPath))
      .filter((dir) => path.basename(dir).startsWith('auto-editor-asset-'))
  ));
  await Promise.all(tempDirs.map((dir) => fsPromises.rm(dir, { force: true, recursive: true }).catch(() => undefined)));
};
