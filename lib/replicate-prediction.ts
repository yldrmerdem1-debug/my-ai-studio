import { createReplicateClient } from '@/lib/replicate-client';

export const readReplicatePrediction = async (predictionId: string) => {
  const replicate = createReplicateClient();
  const prediction = await replicate.predictions.get(predictionId);
  return {
    status: prediction.status,
    output: prediction.output,
    error: prediction.error,
  };
};
