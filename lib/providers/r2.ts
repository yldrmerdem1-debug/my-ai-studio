import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl as presignS3Url } from '@aws-sdk/s3-request-presigner';
import type { StorageProvider } from '@/lib/storage';

type R2Config = {
  bucket: string;
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicBaseUrl?: string;
};

let cachedClient: S3Client | null = null;
let cachedClientKey = '';

const safeTrim = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

const encodeObjectKey = (key: string) =>
  key
    .split('/')
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join('/');

const resolveR2Config = (): R2Config => {
  const accountId = safeTrim(process.env.R2_ACCOUNT_ID);
  const endpoint = safeTrim(process.env.R2_S3_API_URL)
    || (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : '');
  const accessKeyId = safeTrim(process.env.R2_ACCESS_KEY_ID);
  const secretAccessKey = safeTrim(process.env.R2_SECRET_ACCESS_KEY);
  const bucket = safeTrim(process.env.R2_BUCKET);
  const region = safeTrim(process.env.R2_REGION) || 'auto';
  const publicBaseUrl = safeTrim(process.env.R2_PUBLIC_BASE_URL);

  const missing: string[] = [];
  if (!bucket) missing.push('R2_BUCKET');
  if (!accessKeyId) missing.push('R2_ACCESS_KEY_ID');
  if (!secretAccessKey) missing.push('R2_SECRET_ACCESS_KEY');
  if (!endpoint) missing.push('R2_S3_API_URL or R2_ACCOUNT_ID');

  if (missing.length > 0) {
    throw new Error(`R2 storage is not configured: missing ${missing.join(', ')}`);
  }

  return {
    bucket,
    endpoint,
    region,
    accessKeyId,
    secretAccessKey,
    publicBaseUrl: publicBaseUrl || undefined,
  };
};

const getR2Client = (config: R2Config) => {
  const nextKey = [
    config.endpoint,
    config.region,
    config.bucket,
    config.accessKeyId,
  ].join('|');

  if (!cachedClient || cachedClientKey !== nextKey) {
    cachedClient = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
    cachedClientKey = nextKey;
  }

  return cachedClient;
};

export const createR2StorageProvider = (): StorageProvider => {
  const config = resolveR2Config();
  const client = getR2Client(config);
  const buildPublicUrl = config.publicBaseUrl
    ? (key: string) => `${config.publicBaseUrl!.replace(/\/+$/, '')}/${encodeObjectKey(key)}`
    : null;

  const provider: StorageProvider = {
    upload: async (buffer, contentType, key) => {
      await client.send(new PutObjectCommand({
        Bucket: config.bucket,
        Key: key,
        Body: buffer,
        ContentType: contentType,
      }));

      return {
        key,
        url: buildPublicUrl ? buildPublicUrl(key) : undefined,
      };
    },
    getSignedUrl: async (key, expiresSec) => {
      const expiresIn = Math.max(1, Math.min(60 * 60 * 24 * 7, Math.round(expiresSec)));
      return presignS3Url(
        client,
        new GetObjectCommand({
          Bucket: config.bucket,
          Key: key,
        }),
        { expiresIn }
      );
    },
  };

  if (buildPublicUrl) {
    provider.getPublicUrl = async (key) => buildPublicUrl(key);
  }

  return provider;
};
