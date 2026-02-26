import { downloadMediaWithValidation } from '@/lib/replicate-media';
import { getStorageProvider, makeStorageObjectKey, type StorageProvider } from '@/lib/storage';

type EnsurePublicAssetUrlInput = {
  url?: string;
  storagePath?: string;
  buffer?: Buffer;
  contentType?: string;
  suggestedName?: string;
};

type EnsurePublicAssetUrlOptions = {
  token?: string;
  provider?: StorageProvider;
  expiresSec?: number;
  resolveAbsoluteUrl?: (url: string) => string;
  bypassReplicateFileApi?: boolean;
  logger?: {
    info?: (...args: unknown[]) => void;
    warn?: (...args: unknown[]) => void;
  };
};

const isLocalLikeUrl = (url: string) => {
  if (!url) return false;
  if (url.startsWith('/')) return true;
  try {
    const parsed = new URL(url);
    return ['localhost', '127.0.0.1', '0.0.0.0'].includes(parsed.hostname);
  } catch {
    return true;
  }
};

const isReplicateFileApiUrl = (url: string) =>
  url.toLowerCase().includes('api.replicate.com/v1/files/');

const isPublicHttpsUrl = (url: string) => {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && !isLocalLikeUrl(url);
  } catch {
    return false;
  }
};

const pickImageContentType = (candidate?: string) => {
  const normalized = String(candidate || '').split(';')[0].trim().toLowerCase();
  if (normalized.startsWith('image/')) return normalized;
  return 'image/jpeg';
};

const isInvalidUrlInput = (value?: string) => {
  const normalized = String(value || '').trim().toLowerCase();
  return !normalized || normalized === 'undefined' || normalized === 'null';
};

export const ensurePublicAssetUrl = async (
  input: EnsurePublicAssetUrlInput,
  options: EnsurePublicAssetUrlOptions = {}
): Promise<string> => {
  const token = options.token || '';
  const expiresSec = options.expiresSec ?? 60 * 60 * 6;
  const provider = options.provider || getStorageProvider();
  const bypassReplicateFileApi = options.bypassReplicateFileApi ?? true;
  const logger = options.logger;

  const rawUrl = typeof input.url === 'string' ? input.url.trim() : '';
  if (bypassReplicateFileApi && rawUrl && isReplicateFileApiUrl(rawUrl)) {
    logger?.warn?.('Skipping public asset conversion for Replicate File URL:', rawUrl);
    return rawUrl;
  }

  if (input.storagePath) {
    const signed = await provider.getSignedUrl(input.storagePath, expiresSec);
    logger?.info?.('ensurePublicAssetUrl: signed from storagePath', input.storagePath);
    return signed;
  }

  if (rawUrl && isPublicHttpsUrl(rawUrl) && !isReplicateFileApiUrl(rawUrl)) {
    const media = await downloadMediaWithValidation(rawUrl, {
      token,
      expectedKind: 'image',
      strictExpectedKind: true,
      logger,
    });
    return media.finalUrl;
  }

  if (input.buffer && input.buffer.length > 0) {
    const contentType = pickImageContentType(input.contentType);
    const key = makeStorageObjectKey('personas/grok-inputs', contentType, input.suggestedName);
    await provider.upload(input.buffer, contentType, key);
    const signed = await provider.getSignedUrl(key, expiresSec);
    logger?.info?.('ensurePublicAssetUrl: uploaded from buffer', { key, contentType });
    return signed;
  }

  if (rawUrl) {
    if (isInvalidUrlInput(rawUrl)) {
      throw new Error(`ensurePublicAssetUrl received invalid url input: ${String(rawUrl)}`);
    }
    const absolute = options.resolveAbsoluteUrl ? options.resolveAbsoluteUrl(rawUrl) : rawUrl;
    if (isInvalidUrlInput(absolute)) {
      throw new Error(`ensurePublicAssetUrl resolveAbsoluteUrl produced invalid url: ${String(absolute)}`);
    }
    if (bypassReplicateFileApi && isReplicateFileApiUrl(absolute)) {
      logger?.warn?.('Skipping public asset conversion for resolved Replicate File URL:', absolute);
      return absolute;
    }
    if (isLocalLikeUrl(absolute) && !options.resolveAbsoluteUrl) {
      throw new Error('storage provider ayarlanmadi veya local URL cozulmedi: resolveAbsoluteUrl gerekli');
    }
    const media = await downloadMediaWithValidation(absolute, {
      token,
      expectedKind: 'image',
      strictExpectedKind: true,
      logger,
    });
    const contentType = pickImageContentType(media.contentType);
    const key = makeStorageObjectKey('personas/grok-inputs', contentType, input.suggestedName);
    await provider.upload(media.buffer, contentType, key);
    const signed = await provider.getSignedUrl(key, expiresSec);
    logger?.info?.('ensurePublicAssetUrl: downloaded and re-uploaded', { source: absolute, key, contentType });
    return signed;
  }

  throw new Error('storage provider ayarlanmadi veya public image URL uretilemedi: url/storagePath/buffer gerekli');
};

