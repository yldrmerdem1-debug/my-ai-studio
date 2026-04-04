import Replicate from 'replicate';

export const getRequiredReplicateToken = () => {
  const token = String(process.env.REPLICATE_API_TOKEN || '').trim();
  if (!token) {
    throw new Error('REPLICATE_API_TOKEN is not configured');
  }
  return token;
};

export const createReplicateClient = (options?: { timeoutMs?: number }) => {
  const token = getRequiredReplicateToken();
  if (options?.timeoutMs) {
    return new Replicate({
      auth: token,
      fetch: (url, init) => fetch(url, { ...(init as RequestInit), timeout: options.timeoutMs } as any),
    });
  }
  return new Replicate({ auth: token });
};
