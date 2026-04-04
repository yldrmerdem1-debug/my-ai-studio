import crypto from 'node:crypto';
import path from 'node:path';
import { createR2StorageProvider } from '@/lib/providers/r2';
import { createSupabaseStorageProvider } from '@/lib/providers/supabase';

export type StorageProviderName = 'supabase' | 's3' | 'cloudinary' | 'r2';

export type StorageUploadResult = {
  key: string;
  url?: string;
};

export interface StorageProvider {
  upload: (buffer: Buffer, contentType: string, key: string) => Promise<StorageUploadResult>;
  getSignedUrl: (key: string, expiresSec: number) => Promise<string>;
  getPublicUrl?: (key: string) => Promise<string>;
}

const safeTrim = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

const hasR2Config = () =>
  Boolean(
    safeTrim(process.env.R2_BUCKET)
    && safeTrim(process.env.R2_ACCESS_KEY_ID)
    && safeTrim(process.env.R2_SECRET_ACCESS_KEY)
    && (safeTrim(process.env.R2_S3_API_URL) || safeTrim(process.env.R2_ACCOUNT_ID))
  );

const toStorageProviderName = (raw: string | undefined): StorageProviderName => {
  const normalized = String(raw || '').trim().toLowerCase();
  if (!normalized) {
    return hasR2Config() ? 'r2' : 'supabase';
  }
  if (normalized === 'supabase' || normalized === 's3' || normalized === 'cloudinary' || normalized === 'r2') {
    return normalized;
  }
  return hasR2Config() ? 'r2' : 'supabase';
};

export const resolveStorageProviderName = (): StorageProviderName =>
  toStorageProviderName(process.env.STORAGE_PROVIDER);

export const getStorageProvider = (): StorageProvider => {
  const provider = resolveStorageProviderName();
  switch (provider) {
    case 'supabase':
      return createSupabaseStorageProvider();
    case 'r2':
      return createR2StorageProvider();
    case 's3':
    case 'cloudinary':
      throw new Error(`Storage provider "${provider}" is not implemented yet. Set STORAGE_PROVIDER=supabase.`);
    default:
      throw new Error(`Unsupported storage provider: ${provider}`);
  }
};

export const makeStorageObjectKey = (prefix: string, contentType: string, suggestedName?: string) => {
  const extByMime: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'video/mp4': 'mp4',
  };
  const fallbackFromName = suggestedName
    ? path.extname(suggestedName).replace('.', '').toLowerCase()
    : '';
  const ext = extByMime[contentType.toLowerCase()] || fallbackFromName || 'bin';
  return `${prefix.replace(/\/+$/, '')}/${Date.now()}-${crypto.randomUUID()}.${ext}`;
};
