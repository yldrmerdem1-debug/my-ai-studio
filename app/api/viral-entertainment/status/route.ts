import { NextRequest, NextResponse } from 'next/server';
import Replicate from 'replicate';

export async function GET(request: NextRequest) {
  try {
    const apiToken = process.env.REPLICATE_API_TOKEN;
    
    if (!apiToken || !apiToken.trim()) {
      return NextResponse.json(
        { error: 'API token not configured' },
        { status: 500 }
      );
    }

    const replicate = new Replicate({ auth: apiToken.trim() });
    const searchParams = request.nextUrl.searchParams;
    const predictionId = searchParams.get('predictionId');

    if (!predictionId) {
      return NextResponse.json(
        { error: 'Prediction ID is required' },
        { status: 400 }
      );
    }

    const prediction = await replicate.predictions.get(predictionId);
    
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
