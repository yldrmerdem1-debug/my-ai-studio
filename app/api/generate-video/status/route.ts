import { NextRequest, NextResponse } from 'next/server';
import Replicate from 'replicate';

export async function GET(request: NextRequest) {
  try {
    // Get API token from environment
    const apiToken = process.env.REPLICATE_API_TOKEN;
    
    // Validate token exists
    if (!apiToken || apiToken.trim() === '') {
      console.error('REPLICATE_API_TOKEN not found in environment');
      return NextResponse.json(
        {
          error: 'API token not configured',
          details: 'Please set REPLICATE_API_TOKEN in your .env.local file and restart your dev server'
        },
        { status: 500 }
      );
    }

    // Validate token format
    if (!apiToken.startsWith('r8_')) {
      return NextResponse.json(
        { error: 'Invalid API token format' },
        { status: 500 }
      );
    }

    // Initialize Replicate client
    const replicate = new Replicate({
      auth: apiToken.trim(),
    });

    const { searchParams } = new URL(request.url);
    const videoId = searchParams.get('id');

    if (!videoId) {
      return NextResponse.json(
        { error: 'Video ID is required' },
        { status: 400 }
      );
    }

    // Get video generation status
    const prediction = await replicate.predictions.get(videoId);

    // Calculate progress based on status
    let progress = 0;
    let statusMessage = '';
    let videoUrl: string | null = null;

    switch (prediction.status) {
      case 'starting':
        progress = 10;
        statusMessage = 'Initializing video generation...';
        break;
      case 'processing':
        progress = 50;
        statusMessage = 'Generating video frames...';
        break;
      case 'succeeded':
        progress = 100;
        statusMessage = 'Video generation complete!';
        // Extract video URL from output
        if (prediction.output) {
          if (Array.isArray(prediction.output)) {
            videoUrl = prediction.output[0] || null;
          } else if (typeof prediction.output === 'string') {
            videoUrl = prediction.output;
          } else if (typeof prediction.output === 'object' && prediction.output !== null) {
            // Try to find video URL in object
            const output = prediction.output as any;
            videoUrl = output.video || output.url || output.mp4 || null;
            
            // If still no URL, search for any string starting with http
            if (!videoUrl) {
              const searchForUrl = (obj: any): string | null => {
                if (typeof obj === 'string' && obj.startsWith('http')) {
                  return obj;
                }
                if (Array.isArray(obj)) {
                  for (const item of obj) {
                    const found = searchForUrl(item);
                    if (found) return found;
                  }
                }
                if (typeof obj === 'object' && obj !== null) {
                  for (const value of Object.values(obj)) {
                    const found = searchForUrl(value);
                    if (found) return found;
                  }
                }
                return null;
              };
              videoUrl = searchForUrl(output);
            }
          }
        }
        break;
      case 'failed':
        progress = 0;
        statusMessage = `Video generation failed: ${prediction.error || 'Unknown error'}`;
        break;
      case 'canceled':
        progress = 0;
        statusMessage = 'Video generation canceled';
        break;
      default:
        progress = 25;
        statusMessage = 'Waiting for video generation to start...';
    }

    return NextResponse.json({
      status: prediction.status,
      progress: progress / 100, // Normalize to 0-1
      statusMessage: statusMessage,
      error: prediction.error || null,
      videoUrl: videoUrl,
      output: prediction.output || null,
    });

  } catch (error: any) {
    console.error('Status check error:', error);
    return NextResponse.json(
      { 
        error: error.message || 'Failed to check video generation status',
        status: 'error'
      },
      { status: 500 }
    );
  }
}
