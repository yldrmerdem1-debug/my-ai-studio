import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { getStorageProvider, makeStorageObjectKey, resolveStorageProviderName } from '@/lib/storage';
import { isLocalAssetFallbackEnabled } from '@/lib/site-url';

export const runtime = 'nodejs';

const LOCAL_UPLOAD_DIR = path.join(process.cwd(), 'public', 'generated', 'uploads');

const parseDataUrl = (dataUrl: string) => {
  const match = dataUrl.match(/^data:(.+?);base64,(.+)$/);
  if (!match) return null;
  return { contentType: match[1], base64: match[2] };
};

const sanitizePrefix = (value: string) =>
  value.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/-+/g, '-').replace(/^[-_]+|[-_]+$/g, '') || 'anonymous';

const getExtensionForContentType = (contentType: string, fallback = 'png') => {
  const normalized = String(contentType || '').toLowerCase().split(';')[0].trim();
  const extMap: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
  };
  return extMap[normalized] || fallback;
};

const saveImageLocally = async ({
  buffer,
  contentType,
  userPrefix,
}: {
  buffer: Buffer;
  contentType: string;
  userPrefix: string;
}) => {
  await mkdir(LOCAL_UPLOAD_DIR, { recursive: true });
  const safePrefix = sanitizePrefix(userPrefix);
  const extension = getExtensionForContentType(contentType);
  const fileName = `${safePrefix}-${Date.now()}-${crypto.randomUUID()}.${extension}`;
  const filePath = path.join(LOCAL_UPLOAD_DIR, fileName);
  await writeFile(filePath, buffer);
  return `/generated/uploads/${fileName}`;
};

const resolveStorageUploadUrl = async (provider: ReturnType<typeof getStorageProvider>, key: string) => {
  if (provider.getPublicUrl) {
    try {
      return await provider.getPublicUrl(key);
    } catch {
      // Fall back to a signed URL when the bucket is private.
    }
  }
  return provider.getSignedUrl(key, 60 * 60 * 24 * 7);
};

const extractUploadPayload = async (request: Request) => {
  const requestContentType = request.headers.get('content-type') || '';

  if (requestContentType.includes('multipart/form-data')) {
    const formData = await request.formData();
    const fileEntry = formData.get('file') || formData.get('image');
    if (!(fileEntry instanceof File)) {
      return { error: 'Image file is required', status: 400 as const };
    }
    const arrayBuffer = await fileEntry.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    if (!buffer.length) {
      return { error: 'Invalid image payload', status: 400 as const };
    }
    return {
      buffer,
      contentType: fileEntry.type || 'image/png',
      userPrefix: typeof formData.get('userId') === 'string' ? String(formData.get('userId')) : 'anonymous',
    };
  }

  const body = await request.json().catch(() => ({}));
  const dataUrl = typeof body?.dataUrl === 'string' ? body.dataUrl.trim() : '';
  if (!dataUrl) {
    return { error: 'Image data is required', status: 400 as const };
  }

  const parsed = parseDataUrl(dataUrl);
  if (!parsed) {
    return { error: 'Invalid image data URL', status: 400 as const };
  }

  const buffer = Buffer.from(parsed.base64, 'base64');
  if (!buffer.length) {
    return { error: 'Invalid image payload', status: 400 as const };
  }

  return {
    buffer,
    contentType: parsed.contentType || 'image/png',
    userPrefix: typeof body?.userId === 'string' ? body.userId : 'anonymous',
  };
};

export async function POST(request: Request) {
  try {
    const payload = await extractUploadPayload(request);
    if ('error' in payload) {
      return NextResponse.json({ error: payload.error }, { status: payload.status });
    }

    const { buffer, contentType, userPrefix } = payload;
    try {
      const provider = getStorageProvider();
      const storagePath = makeStorageObjectKey(
        `uploads/${sanitizePrefix(userPrefix)}`,
        contentType,
        `upload.${getExtensionForContentType(contentType)}`
      );
      await provider.upload(buffer, contentType, storagePath);
      const publicUrl = await resolveStorageUploadUrl(provider, storagePath);
      const storage = resolveStorageProviderName();
      return NextResponse.json({ publicUrl, storage, storagePath });
    } catch (storageUploadError: any) {
      if (!isLocalAssetFallbackEnabled()) {
        return NextResponse.json(
          {
            error: 'Storage upload failed',
            details: storageUploadError?.message || String(storageUploadError),
          },
          { status: 502 }
        );
      }
      console.warn('[upload-image] Storage upload failed, falling back to local storage:', storageUploadError?.message || storageUploadError);
    }

    const localUrl = await saveImageLocally({ buffer, contentType, userPrefix });
    return NextResponse.json({ publicUrl: localUrl, storage: 'local', storagePath: null });
  } catch (error: any) {
    return NextResponse.json(
      { error: 'Upload failed', details: error?.message || String(error) },
      { status: 500 }
    );
  }
}
