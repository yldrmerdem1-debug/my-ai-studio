export const isFaceSwapEnabled = (): boolean => {
  const raw =
    process.env.ENABLE_FACE_SWAP
    || process.env.FEATURE_FACE_SWAP
    || '';
  return String(raw).toLowerCase() === 'true';
};

export const isPublicFaceSwapEnabled = (): boolean => {
  return String(process.env.NEXT_PUBLIC_ENABLE_FACE_SWAP || '').toLowerCase() === 'true';
};

