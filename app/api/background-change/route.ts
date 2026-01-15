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
    const prompt = (formData.get('prompt') as string) || 'studio lighting, professional environment, commercial-quality image';

    if (!imageFile) {
      return NextResponse.json(
        { error: 'Image is required' },
        { status: 400 }
      );
    }

    // Image Studio uses Replicate for image synthesis and AI Persona for identity consistency.
    // This endpoint preserves the current pipeline while the studio synthesis layer is refined.
    // First, extract the subject using lucataco/remove-bg
    const imageBuffer = Buffer.from(await imageFile.arrayBuffer());
    const imageBase64 = `data:image/jpeg;base64,${imageBuffer.toString('base64')}`;

    // Extract subject
    const removeBgPrediction = await replicate.predictions.create({
      version: 'lucataco/remove-bg',
      input: {
        image: imageBase64,
      },
    });

    // Poll for subject extraction completion
    let removeBgResult = removeBgPrediction;
    let attempts = 0;
    while (attempts < 30 && removeBgResult.status !== 'succeeded' && removeBgResult.status !== 'failed') {
      await new Promise(resolve => setTimeout(resolve, 1000));
      removeBgResult = await replicate.predictions.get(removeBgPrediction.id);
      attempts++;
    }

    if (removeBgResult.status !== 'succeeded' || !removeBgResult.output) {
      return NextResponse.json(
        { error: 'Failed to prepare image for studio rendering' },
        { status: 500 }
      );
    }

    const transparentImageUrl = Array.isArray(removeBgResult.output) ? removeBgResult.output[0] : removeBgResult.output;

    // In future: use image-to-image diffusion for studio synthesis and compositing.
    // For now, return the extracted subject to keep the pipeline stable.
    
    return NextResponse.json({ imageUrl: transparentImageUrl });
  } catch (error: any) {
    console.error('Image Studio error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to generate studio image' },
      { status: 500 }
    );
  }
}
