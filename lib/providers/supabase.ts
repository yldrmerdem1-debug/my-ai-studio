import { getSupabaseAdminClient } from '@/lib/supabase/admin';
import type { StorageProvider } from '@/lib/storage';

const getBucketName = () =>
  process.env.SUPABASE_STORAGE_BUCKET
  || process.env.SUPABASE_IMAGE_BUCKET
  || 'personas';

const isBucketMissingError = (message: string) =>
  /bucket not found|not found/i.test(message);

export const createSupabaseStorageProvider = (): StorageProvider => {
  const { client, error } = getSupabaseAdminClient();
  if (!client || error) {
    throw new Error(`Storage provider is not configured: ${error || 'Supabase not configured'}`);
  }
  const bucket = getBucketName();
  let bucketEnsured = false;

  const ensureBucket = async () => {
    if (bucketEnsured) return;
    const { error: getBucketError } = await client.storage.getBucket(bucket);
    if (getBucketError && isBucketMissingError(getBucketError.message || '')) {
      const { error: createError } = await client.storage.createBucket(bucket, { public: false });
      if (createError && !/already exists/i.test(createError.message || '')) {
        throw new Error(`Supabase bucket create failed: ${createError.message}`);
      }
    } else if (getBucketError) {
      throw new Error(`Supabase bucket check failed: ${getBucketError.message}`);
    }
    bucketEnsured = true;
  };

  return {
    upload: async (buffer, contentType, key) => {
      await ensureBucket();
      let { error: uploadError } = await client.storage.from(bucket).upload(key, buffer, {
        contentType,
        upsert: true,
      });
      if (uploadError && isBucketMissingError(uploadError.message || '')) {
        bucketEnsured = false;
        await ensureBucket();
        ({ error: uploadError } = await client.storage.from(bucket).upload(key, buffer, {
          contentType,
          upsert: true,
        }));
      }
      if (uploadError) {
        throw new Error(`Supabase upload failed: ${uploadError.message}`);
      }
      return { key };
    },
    getSignedUrl: async (key, expiresSec) => {
      await ensureBucket();
      const { data, error: signedError } = await client.storage.from(bucket).createSignedUrl(key, expiresSec);
      if (signedError || !data?.signedUrl) {
        throw new Error(`Supabase signed URL failed: ${signedError?.message || 'Missing signed URL'}`);
      }
      return data.signedUrl;
    },
    getPublicUrl: async (key) => {
      const { data } = client.storage.from(bucket).getPublicUrl(key);
      if (!data?.publicUrl) {
        throw new Error('Supabase public URL is unavailable');
      }
      return data.publicUrl;
    },
  };
};
