export const isTruthy = (value: unknown) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'string') return value.trim().toLowerCase() === 'true' || value.trim() === '1' || value.trim().toLowerCase() === 'yes';
  return false;
};

