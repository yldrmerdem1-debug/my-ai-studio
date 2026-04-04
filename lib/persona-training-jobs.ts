const FAL_TRAINING_JOB_PREFIX = 'fal_';

const safeTrim = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

export const encodeFalTrainingJobId = (requestId: string) => {
  const safeRequestId = safeTrim(requestId);
  return safeRequestId ? `${FAL_TRAINING_JOB_PREFIX}${safeRequestId}` : '';
};

export const isFalTrainingJobId = (value: unknown) =>
  safeTrim(value).startsWith(FAL_TRAINING_JOB_PREFIX);

export const decodeFalTrainingJobId = (value: unknown) => {
  const safeValue = safeTrim(value);
  return isFalTrainingJobId(safeValue)
    ? safeValue.slice(FAL_TRAINING_JOB_PREFIX.length)
    : safeValue;
};
