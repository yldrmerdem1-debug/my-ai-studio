import crypto from 'node:crypto';
import path from 'node:path';
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

const toStorageProviderName = (raw: string | undefined): StorageProviderName => {
  const normalized = String(raw || 'supabase').trim().toLowerCase();
  if (normalized === 'supabase' || normalized === 's3' || normalized === 'cloudinary' || normalized === 'r2') {
    return normalized;
  }
  return 'supabase';
};

export const getStorageProvider = (): StorageProvider => {
  const provider = toStorageProviderName(process.env.STORAGE_PROVIDER);
  switch (provider) {
    case 'supabase':
      return createSupabaseStorageProvider();
    case 's3':
    case 'cloudinary':
    case 'r2':
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
