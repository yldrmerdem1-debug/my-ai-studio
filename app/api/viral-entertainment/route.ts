import { NextRequest, NextResponse } from 'next/server';
import Replicate from 'replicate';

export async function POST(request: NextRequest) {
  try {
    const apiToken = process.env.REPLICATE_API_TOKEN;
    
    if (!apiToken || !apiToken.trim()) {
      return NextResponse.json(
        { error: 'API token not configured' },
        { status: 500 }
      );
    }

    const replicate = new Replicate({ auth: apiToken.trim() });
    
    // Check if request is JSON or FormData
    const contentType = request.headers.get('content-type') || '';
    let prompt: string;
    let imageBase64: string | null = null;

    if (contentType.includes('application/json')) {
      // Handle JSON request
      const body = await request.json();
      prompt = body.prompt;
      
      if (!prompt || !prompt.trim()) {
        return NextResponse.json(
          { error: 'Prompt is required' },
          { status: 400 }
        );
      }
    } else {
      // Handle FormData request (for backward compatibility)
      const formData = await request.formData();
      const imageFile = formData.get('image') as File | null;
      prompt = formData.get('prompt') as string;

      if (!prompt || !prompt.trim()) {
        return NextResponse.json(
          { error: 'Prompt is required' },
          { status: 400 }
        );
      }

      // Image is optional for text-to-video
      if (imageFile) {
        const imageBuffer = Buffer.from(await imageFile.arrayBuffer());
        imageBase64 = `data:image/jpeg;base64,${imageBuffer.toString('base64')}`;
      }
    }

    // Use fofr/luma-dream-machine or kling v2.5
    const modelOptions = ['fofr/luma-dream-machine', 'kwaivgi/kling-v2.5-turbo-pro'];
    let prediction;
    let lastError;

    for (const model of modelOptions) {
      try {
        // Build input - image is optional for text-to-video models
        const input: any = { prompt: prompt };
        if (imageBase64) {
          input.image = imageBase64;
        }

        prediction = await replicate.predictions.create({
          version: model,
          input: input,
        });
        break;
      } catch (error: any) {
        lastError = error;
        // Try with minimal parameters (just prompt)
        try {
          prediction = await replicate.predictions.create({
            version: model,
            input: { prompt: prompt },
          });
          break;
        } catch (altError: any) {
          continue;
        }
      }
    }

    if (!prediction) {
      throw lastError || new Error('Failed to create prediction');
    }

    return NextResponse.json({ predictionId: prediction.id });
  } catch (error: any) {
    console.error('Viral entertainment error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to generate video' },
      { status: 500 }
    );
  }
}
