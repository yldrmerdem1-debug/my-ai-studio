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
    const prompt = (formData.get('prompt') as string) || 'professional studio background';

    if (!imageFile) {
      return NextResponse.json(
        { error: 'Image is required' },
        { status: 400 }
      );
    }

    // First, remove background using lucataco/remove-bg
    const imageBuffer = Buffer.from(await imageFile.arrayBuffer());
    const imageBase64 = `data:image/jpeg;base64,${imageBuffer.toString('base64')}`;

    // Remove background
    const removeBgPrediction = await replicate.predictions.create({
      version: 'lucataco/remove-bg',
      input: {
        image: imageBase64,
      },
    });

    // Poll for background removal completion
    let removeBgResult = removeBgPrediction;
    let attempts = 0;
    while (attempts < 30 && removeBgResult.status !== 'succeeded' && removeBgResult.status !== 'failed') {
      await new Promise(resolve => setTimeout(resolve, 1000));
      removeBgResult = await replicate.predictions.get(removeBgPrediction.id);
      attempts++;
    }

    if (removeBgResult.status !== 'succeeded' || !removeBgResult.output) {
      return NextResponse.json(
        { error: 'Failed to remove background' },
        { status: 500 }
      );
    }

    const transparentImageUrl = Array.isArray(removeBgResult.output) ? removeBgResult.output[0] : removeBgResult.output;

    // For background change, we can use inpainting or compositing
    // For now, return the transparent image and let the frontend handle compositing
    // Or use a background generation model
    
    return NextResponse.json({ imageUrl: transparentImageUrl });
  } catch (error: any) {
    console.error('Background change error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to change background' },
      { status: 500 }
    );
  }
}
