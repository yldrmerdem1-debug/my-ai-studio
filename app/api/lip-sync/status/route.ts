import { NextRequest, NextResponse } from 'next/server';
import Replicate from 'replicate';

function extractVideoUrl(output: any): string | null {
  if (!output) return null;
  if (Array.isArray(output)) {
    return output[0] || null;
  }
  if (typeof output === 'string') {
    return output;
  }
  if (typeof output === 'object') {
    const candidates = [output.video, output.url, output.mp4];
    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.startsWith('http')) {
        return candidate;
      }
    }
    for (const value of Object.values(output)) {
      const found = extractVideoUrl(value);
      if (found) return found;
    }
  }
  return null;
}

export async function GET(request: NextRequest) {
  try {
    const apiToken = process.env.REPLICATE_API_TOKEN;

    if (!apiToken || apiToken.trim() === '') {
      return NextResponse.json(
        { error: 'REPLICATE_API_TOKEN not configured' },
        { status: 500 }
      );
    }

    if (!apiToken.startsWith('r8_')) {
      return NextResponse.json(
        { error: 'Invalid API token format' },
        { status: 500 }
      );
    }

    const { searchParams } = new URL(request.url);
    const predictionId = searchParams.get('id');

    if (!predictionId) {
      return NextResponse.json(
        { error: 'Prediction id is required' },
        { status: 400 }
      );
    }

    const replicate = new Replicate({ auth: apiToken.trim() });
    const prediction = await replicate.predictions.get(predictionId);

    const videoUrl = prediction.status === 'succeeded' ? extractVideoUrl(prediction.output) : null;

    return NextResponse.json({
      status: prediction.status,
      videoUrl,
      error: prediction.error || null,
      output: prediction.output || null,
    });
  } catch (error: any) {
    console.error('Lip sync status error:', error);
    return NextResponse.json(
      {
        error: error.message || 'Failed to check lip sync status',
        status: 'error',
      },
      { status: 500 }
    );
  }
}
