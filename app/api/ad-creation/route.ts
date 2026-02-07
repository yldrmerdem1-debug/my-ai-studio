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
    const formData = await request.formData();
    
    const imageFile = formData.get('image') as File;
    const prompt = formData.get('prompt') as string;

    if (!imageFile || !prompt) {
      return NextResponse.json(
        { error: 'Image and prompt are required' },
        { status: 400 }
      );
    }

    // Convert image to base64
    const imageBuffer = Buffer.from(await imageFile.arrayBuffer());
    const imageBase64 = `data:image/jpeg;base64,${imageBuffer.toString('base64')}`;

    // Use fofr/luma-dream-machine or kling v2.5 for video generation
    const modelOptions = ['fofr/luma-dream-machine', 'kwaivgi/kling-v2.5-turbo-pro'];
    let prediction;
    let lastError;

    for (const model of modelOptions) {
      try {
        prediction = await replicate.predictions.create({
          version: model,
          input: {
            image: imageBase64,
            prompt: prompt,
          },
        });
        break;
      } catch (error: any) {
        lastError = error;
        continue;
      }
    }

    if (!prediction) {
      throw lastError || new Error('Failed to create prediction');
    }

    return NextResponse.json({ predictionId: prediction.id });
  } catch (error: any) {
    console.error('Ad creation error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to create ad' },
      { status: 500 }
    );
  }
}
