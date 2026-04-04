import { downloadMediaWithValidation } from '@/lib/replicate-media';
import { getStorageProvider, makeStorageObjectKey } from '@/lib/storage';

export const storeRunwayVideoBestEffort = async (url: string): Promise<string> => {
  try {
    const media = await downloadMediaWithValidation(url, {
      expectedKind: 'video',
      strictExpectedKind: true,
      logger: {
        info: (...args) => console.log(...args),
        warn: (...args) => console.warn(...args),
      },
    });
    const provider = getStorageProvider();
    const key = makeStorageObjectKey('generated/runway', media.contentType || 'video/mp4', 'runway.mp4');
    await provider.upload(media.buffer, media.contentType || 'video/mp4', key);
    return await provider.getSignedUrl(key, 60 * 60 * 24);
  } catch (error) {
    console.warn('Runway output store failed; falling back to ephemeral URL.', (error as any)?.message || error);
    return url;
  }
};
