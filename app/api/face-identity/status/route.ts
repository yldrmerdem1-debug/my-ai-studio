import { NextRequest, NextResponse } from 'next/server';
import { isFaceSwapEnabled } from '@/lib/feature-flags';
import { readReplicatePrediction } from '@/lib/replicate-prediction';

export async function GET(request: NextRequest) {
  try {
    if (!isFaceSwapEnabled()) {
      return NextResponse.json(
        { error: 'Face swap is disabled' },
        { status: 403 }
      );
    }

    const apiToken = String(process.env.REPLICATE_API_TOKEN || '').trim();
    if (!apiToken) {
      return NextResponse.json(
        { error: 'API token not configured' },
        { status: 500 }
      );
    }
    const searchParams = request.nextUrl.searchParams;
    const predictionId = searchParams.get('predictionId');

    if (!predictionId) {
      return NextResponse.json(
        { error: 'Prediction ID is required' },
        { status: 400 }
      );
    }

    const prediction = await readReplicatePrediction(predictionId);
    
    return NextResponse.json({
      status: prediction.status,
      output: prediction.output,
      error: prediction.error,
    });
  } catch (error: any) {
    console.error('Prediction status error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to get prediction status' },
      { status: 500 }
    );
  }
}
