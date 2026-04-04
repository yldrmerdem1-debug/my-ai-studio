import { fal } from '@fal-ai/client';

const readFalKey = () => String(process.env.FAL_KEY || '').trim();

export const hasFalKey = () => Boolean(readFalKey());

export const ensureFalConfigured = () => {
  const key = readFalKey();
  if (!key) {
    throw new Error('FAL_KEY is not configured');
  }
  fal.config({ credentials: key });
  return fal;
};
