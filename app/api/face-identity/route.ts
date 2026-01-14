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

    if (!apiToken.startsWith('r8_')) {
      return NextResponse.json(
        { error: 'Invalid API token format' },
        { status: 500 }
      );
    }

    const replicate = new Replicate({ auth: apiToken.trim() });
    const formData = await request.formData();
    
    const sourceImage = formData.get('image') as File;
    const targetImage = formData.get('targetImage') as File;
    const model = (formData.get('model') as string) || 'instantid';

    if (!sourceImage || !targetImage) {
      return NextResponse.json(
        { error: 'Both images are required' },
        { status: 400 }
      );
    }

    // Convert files to base64 data URLs
    const sourceBuffer = Buffer.from(await sourceImage.arrayBuffer());
    const targetBuffer = Buffer.from(await targetImage.arrayBuffer());
    const sourceBase64 = `data:image/jpeg;base64,${sourceBuffer.toString('base64')}`;
    const targetBase64 = `data:image/jpeg;base64,${targetBuffer.toString('base64')}`;

    const modelMap: Record<string, string> = {
      instantid: 'subhash/instantid',
      faceswap: 'lucataco/faceswap',
    };

    const modelName = modelMap[model] || modelMap['instantid'];

    const prediction = await replicate.predictions.create({
      version: modelName,
      input: {
        image: sourceBase64,
        target_image: targetBase64,
      },
    });

    return NextResponse.json({ predictionId: prediction.id });
  } catch (error: any) {
    console.error('Face identity error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to process faces' },
      { status: 500 }
    );
  }
}
