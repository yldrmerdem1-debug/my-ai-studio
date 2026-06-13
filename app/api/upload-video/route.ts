import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { getStorageProvider, makeStorageObjectKey, resolveStorageProviderName } from '@/lib/storage';
import { isLocalAssetFallbackEnabled } from '@/lib/site-url';

export const runtime = 'nodejs';
export const maxDuration = 120;

const LOCAL_UPLOAD_DIR = path.join(process.cwd(), 'public', 'generated', 'uploads');
const MAX_UPLOAD_BYTES = Math.max(
  1,
  Number(process.env.AUTO_EDITOR_MAX_UPLOAD_MB || '') || 250
) * 1024 * 1024;
const ALLOWED_VIDEO_TYPES = new Set([
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'video/x-matroska',
]);

const parseDataUrl = (dataUrl: string) => {
  const match = dataUrl.match(/^data:(.+?);base64,(.+)$/);
  if (!match) return null;
  return { contentType: match[1], base64: match[2] };
};

const sanitizePrefix = (value: string) =>
  value.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/-+/g, '-').replace(/^[-_]+|[-_]+$/g, '') || 'anonymous';

const getExtensionForContentType = (contentType: string, fallback = 'mp4') => {
  const normalized = String(contentType || '').toLowerCase().split(';')[0].trim();
  const extMap: Record<string, string> = {
    'video/mp4': 'mp4',
    'video/quicktime': 'mov',
    'video/webm': 'webm',
    'video/x-matroska': 'mkv',
  };
  return extMap[normalized] || fallback;
};

const normalizeContentType = (contentType: string) =>
  String(contentType || '').toLowerCase().split(';')[0].trim();

const validateUpload = (buffer: Buffer, contentType: string) => {
  const normalizedType = normalizeContentType(contentType);
  if (!ALLOWED_VIDEO_TYPES.has(normalizedType)) {
    return { error: 'Only mp4, mov, webm, or mkv video uploads are supported', status: 400 as const };
  }
  if (!buffer.length) {
    return { error: 'Invalid video payload', status: 400 as const };
  }
  if (buffer.byteLength > MAX_UPLOAD_BYTES) {
    return {
      error: `Video upload is too large. Maximum allowed size is ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB.`,
      status: 413 as const,
    };
  }
  return null;
};

const saveVideoLocally = async ({
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
    const fileEntry = formData.get('file') || formData.get('video');
    if (!(fileEntry instanceof File)) {
      return { error: 'Video file is required', status: 400 as const };
    }
    const arrayBuffer = await fileEntry.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const contentType = fileEntry.type || 'video/mp4';
    const validationError = validateUpload(buffer, contentType);
    if (validationError) return validationError;
    return {
      buffer,
      contentType,
      originalName: fileEntry.name || 'upload.mp4',
      userPrefix: typeof formData.get('userId') === 'string' ? String(formData.get('userId')) : 'anonymous',
    };
  }

  const body = await request.json().catch(() => ({}));
  const dataUrl = typeof body?.dataUrl === 'string' ? body.dataUrl.trim() : '';
  if (!dataUrl) {
    return { error: 'Video data is required', status: 400 as const };
  }

  const parsed = parseDataUrl(dataUrl);
  if (!parsed) {
    return { error: 'Invalid video data URL', status: 400 as const };
  }
  const buffer = Buffer.from(parsed.base64, 'base64');
  const validationError = validateUpload(buffer, parsed.contentType);
  if (validationError) return validationError;

  return {
    buffer,
    contentType: parsed.contentType || 'video/mp4',
    originalName: 'upload.mp4',
    userPrefix: typeof body?.userId === 'string' ? body.userId : 'anonymous',
  };
};

export async function POST(request: Request) {
  try {
    const payload = await extractUploadPayload(request);
    if ('error' in payload) {
      return NextResponse.json({ error: payload.error }, { status: payload.status });
    }

    const { buffer, contentType, originalName, userPrefix } = payload;
    try {
      const provider = getStorageProvider();
      const storagePath = makeStorageObjectKey(
        `uploads/${sanitizePrefix(userPrefix)}`,
        contentType,
        originalName || `upload.${getExtensionForContentType(contentType)}`
      );
      await provider.upload(buffer, contentType, storagePath);
      const publicUrl = await resolveStorageUploadUrl(provider, storagePath);
      const storage = resolveStorageProviderName();
      return NextResponse.json({ publicUrl, storage, storagePath });
    } catch (storageUploadError: unknown) {
      if (!isLocalAssetFallbackEnabled()) {
        return NextResponse.json(
          {
            error: 'Storage upload failed',
            details: storageUploadError instanceof Error ? storageUploadError.message : String(storageUploadError),
          },
          { status: 502 }
        );
      }
      console.warn(
        '[upload-video] Storage upload failed, falling back to local storage:',
        storageUploadError instanceof Error ? storageUploadError.message : storageUploadError
      );
    }

    const localUrl = await saveVideoLocally({ buffer, contentType, userPrefix });
    return NextResponse.json({ publicUrl: localUrl, storage: 'local', storagePath: null });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: 'Upload failed', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
