import crypto from 'node:crypto';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { getStorageProvider, makeStorageObjectKey } from '@/lib/storage';
import { isLocalAssetFallbackEnabled } from '@/lib/site-url';

type PersistGeneratedAssetOptions = {
  prefix: string;
  suggestedName: string;
  contentType: string;
  expiresSec?: number;
};

const LOCAL_GENERATED_DIR = path.join(process.cwd(), 'public', 'generated');

const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'text/plain': 'txt',
};

const resolveExtension = (contentType: string, suggestedName: string) => {
  const normalized = String(contentType || '').split(';')[0].trim().toLowerCase();
  if (EXT_BY_MIME[normalized]) return EXT_BY_MIME[normalized];
  const fromName = path.extname(suggestedName).replace(/^\./, '').toLowerCase();
  return fromName || 'bin';
};

const resolveUploadedAssetUrl = async ({
  key,
  expiresSec,
}: {
  key: string;
  expiresSec: number;
}) => {
  const provider = getStorageProvider();
  if (provider.getPublicUrl) {
    try {
      return await provider.getPublicUrl(key);
    } catch {
      // Fall back to a signed URL when the bucket is private.
    }
  }
  return provider.getSignedUrl(key, expiresSec);
};

const saveLocalFallback = async ({
  buffer,
  extension,
}: {
  buffer: Buffer;
  extension: string;
}) => {
  await mkdir(LOCAL_GENERATED_DIR, { recursive: true });
  const fileName = `${crypto.randomUUID()}.${extension}`;
  const filePath = path.join(LOCAL_GENERATED_DIR, fileName);
  await writeFile(filePath, buffer);
  return `/generated/${fileName}`;
};

export const persistGeneratedBuffer = async (
  buffer: Buffer,
  options: PersistGeneratedAssetOptions
): Promise<string> => {
  const expiresSec = Math.max(60, Math.round(options.expiresSec ?? 60 * 60 * 24 * 7));
  const extension = resolveExtension(options.contentType, options.suggestedName);

  try {
    const provider = getStorageProvider();
    const key = makeStorageObjectKey(
      options.prefix,
      options.contentType,
      options.suggestedName || `asset.${extension}`
    );
    await provider.upload(buffer, options.contentType, key);
    return await resolveUploadedAssetUrl({ key, expiresSec });
  } catch (error) {
    if (!isLocalAssetFallbackEnabled()) {
      throw new Error(
        `[generated-assets] Storage upload failed in production: ${(error as Error)?.message || error}`
      );
    }
    console.warn('[generated-assets] Storage upload failed, using local fallback:', (error as Error)?.message || error);
    return saveLocalFallback({ buffer, extension });
  }
};

export const persistGeneratedStream = async (
  stream: ReadableStream,
  options: PersistGeneratedAssetOptions
): Promise<string> => {
  const nodeStream = Readable.fromWeb(stream as any);
  const chunks: Buffer[] = [];
  for await (const chunk of nodeStream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return persistGeneratedBuffer(Buffer.concat(chunks), options);
};
