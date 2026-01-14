'use server';

import Replicate from 'replicate';

// Initialize Replicate client
function getReplicateClient() {
  const apiToken = process.env.REPLICATE_API_TOKEN;
  
  if (!apiToken || !apiToken.trim()) {
    throw new Error('REPLICATE_API_TOKEN is not configured');
  }

  if (!apiToken.startsWith('r8_')) {
    throw new Error('Invalid REPLICATE_API_TOKEN format');
  }

  return new Replicate({ auth: apiToken.trim() });
}

// Face Identity - Use subhash/instantid or lucataco/faceswap
export async function faceIdentitySwap(formData: FormData) {
  try {
    const replicate = getReplicateClient();
    
    const imageFile = formData.get('image') as File;
    const targetImageFile = formData.get('targetImage') as File;
    const model = (formData.get('model') as string) || 'instantid';

    if (!imageFile || !targetImageFile) {
      return { success: false, error: 'Both images are required' };
    }

    // Convert files to data URLs (Replicate accepts data URLs or URLs)
    const imageBuffer = Buffer.from(await imageFile.arrayBuffer());
    const targetImageBuffer = Buffer.from(await targetImageFile.arrayBuffer());
    const imageBase64 = `data:image/jpeg;base64,${imageBuffer.toString('base64')}`;
    const targetImageBase64 = `data:image/jpeg;base64,${targetImageBuffer.toString('base64')}`;

    const modelMap: Record<string, string> = {
      instantid: 'subhash/instantid',
      faceswap: 'lucataco/faceswap',
    };

    const modelName = modelMap[model] || modelMap['instantid'];

    const prediction = await replicate.predictions.create({
      version: modelName,
      input: {
        image: imageBase64,
        target_image: targetImageBase64,
      },
    });

    return { success: true, predictionId: prediction.id };
  } catch (error: any) {
    console.error('Face identity error:', error);
    return { success: false, error: error.message || 'Failed to swap faces' };
  }
}

// AI Persona Lab - Use ostris/flux-dev-lora-trainer
export async function trainPersonaLora(formData: FormData) {
  try {
    const replicate = getReplicateClient();
    
    const zipFile = formData.get('zipFile') as File;
    const triggerWord = formData.get('triggerWord') as string;
    const imageCount = parseInt(formData.get('imageCount') as string || '0');

    if (!zipFile || !triggerWord || imageCount < 10) {
      return { success: false, error: 'Invalid input: ZIP file, trigger word, and at least 10 images are required' };
    }

    // Convert ZIP to data URL
    const zipBuffer = Buffer.from(await zipFile.arrayBuffer());
    const zipBase64 = `data:application/zip;base64,${zipBuffer.toString('base64')}`;

    const prediction = await replicate.predictions.create({
      version: 'ostris/flux-dev-lora-trainer',
      input: {
        input_images: zipBase64,
        trigger_word: triggerWord,
        steps: 1000,
      },
    });

    return { success: true, predictionId: prediction.id };
  } catch (error: any) {
    console.error('Persona training error:', error);
    return { success: false, error: error.message || 'Failed to train persona' };
  }
}

// AI Video - Use fofr/luma-dream-machine or kling-ai
export async function generateVideo(formData: FormData) {
  try {
    const replicate = getReplicateClient();

    const prompt = formData.get('prompt') as string;
    const imageFile = formData.get('image') as File | null;
    const model = (formData.get('model') as string) || 'luma';

    if (!prompt) {
      return { success: false, error: 'Prompt is required' };
    }

    const modelMap: Record<string, string> = {
      luma: 'fofr/luma-dream-machine',
      kling: 'kling-ai/kling-ai',
    };

    const modelName = modelMap[model] || modelMap['luma'];

    const input: any = {
      prompt,
    };

    if (imageFile) {
      const imageBuffer = Buffer.from(await imageFile.arrayBuffer());
      const imageBase64 = `data:image/jpeg;base64,${imageBuffer.toString('base64')}`;
      input.image = imageBase64;
    }

    const prediction = await replicate.predictions.create({
      version: modelName,
      input,
    });

    return { success: true, predictionId: prediction.id };
  } catch (error: any) {
    console.error('Video generation error:', error);
    return { success: false, error: error.message || 'Failed to generate video' };
  }
}

// Background Tools - Use lucataco/remove-bg
export async function removeBackground(formData: FormData) {
  try {
    const replicate = getReplicateClient();
    
    const imageFile = formData.get('image') as File;

    if (!imageFile) {
      return { success: false, error: 'Image is required' };
    }

    const imageBuffer = Buffer.from(await imageFile.arrayBuffer());
    const imageBase64 = `data:image/jpeg;base64,${imageBuffer.toString('base64')}`;

    const prediction = await replicate.predictions.create({
      version: 'lucataco/remove-bg',
      input: {
        image: imageBase64,
      },
    });

    // Poll for completion
    let result = prediction;
    let attempts = 0;
    const maxAttempts = 30;

    while (attempts < maxAttempts && result.status !== 'succeeded' && result.status !== 'failed') {
      await new Promise(resolve => setTimeout(resolve, 1000));
      result = await replicate.predictions.get(prediction.id);
      attempts++;
    }

    if (result.status === 'succeeded' && result.output) {
      const outputUrl = Array.isArray(result.output) ? result.output[0] : result.output;
      return { success: true, imageUrl: outputUrl };
    }

    return { success: false, error: result.error || 'Background removal failed' };
  } catch (error: any) {
    console.error('Background removal error:', error);
    return { success: false, error: error.message || 'Failed to remove background' };
  }
}

// 3D Character - Use cjwbw/shap-e
export async function generate3DCharacter(formData: FormData) {
  try {
    const replicate = getReplicateClient();
    
    const imageFile = formData.get('image') as File;

    if (!imageFile) {
      return { success: false, error: 'Image is required' };
    }

    const imageBuffer = Buffer.from(await imageFile.arrayBuffer());
    const imageBase64 = `data:image/jpeg;base64,${imageBuffer.toString('base64')}`;

    const prediction = await replicate.predictions.create({
      version: 'cjwbw/shap-e',
      input: {
        image: imageBase64,
      },
    });

    // Poll for completion
    let result = prediction;
    let attempts = 0;
    const maxAttempts = 60;

    while (attempts < maxAttempts && result.status !== 'succeeded' && result.status !== 'failed') {
      await new Promise(resolve => setTimeout(resolve, 2000));
      result = await replicate.predictions.get(prediction.id);
      attempts++;
    }

    if (result.status === 'succeeded' && result.output) {
      const outputUrl = Array.isArray(result.output) ? result.output[0] : result.output;
      return { success: true, modelUrl: outputUrl };
    }

    return { success: false, error: result.error || '3D generation failed' };
  } catch (error: any) {
    console.error('3D generation error:', error);
    return { success: false, error: error.message || 'Failed to generate 3D character' };
  }
}

// Helper function to check prediction status
export async function checkPredictionStatus(predictionId: string) {
  try {
    const replicate = getReplicateClient();
    const prediction = await replicate.predictions.get(predictionId);
    
    return {
      status: prediction.status,
      output: prediction.output,
      error: prediction.error,
      logs: prediction.logs,
    };
  } catch (error: any) {
    console.error('Prediction status error:', error);
    return { status: 'error', error: error.message };
  }
}
