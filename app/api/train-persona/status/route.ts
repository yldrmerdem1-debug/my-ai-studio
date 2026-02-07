import { NextRequest, NextResponse } from 'next/server';

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

    const { searchParams } = new URL(request.url);
    const trainingId = searchParams.get('id');

    if (!trainingId) {
      return NextResponse.json(
        { error: 'Training ID is required' },
        { status: 400 }
      );
    }

    const response = await fetch(`https://api.replicate.com/v1/trainings/${trainingId}`, {
      headers: {
        Authorization: `Token ${apiToken.trim()}`,
      },
    });

    const responseText = await response.text();
    let payload: any = null;
    try {
      payload = responseText ? JSON.parse(responseText) : null;
    } catch {
      payload = responseText;
    }

    if (!response.ok) {
      console.error('Training status error:', {
        trainingId,
        status: response.status,
        response: payload,
      });
      return NextResponse.json(
        { error: 'Failed to check training status', status: 'error' },
        { status: 502 }
      );
    }

    // Calculate progress based on status
    let progress = 0;
    let statusMessage = '';

    let modelId: string | null = null;

    switch (payload?.status) {
      case 'starting':
        progress = 10;
        statusMessage = 'Initializing training...';
        break;
      case 'running':
        progress = 50;
        statusMessage = 'Training in progress...';
        break;
      case 'succeeded':
        progress = 100;
        statusMessage = 'Training complete!';
        
        // Extract model ID from output
        // The model ID could be in various formats depending on the training model
        if (payload?.output) {
          if (typeof payload.output === 'string') {
            // If output is a string, it might be the model ID or a URL
            if (payload.output.startsWith('http') || payload.output.includes('model') || payload.output.includes('lora')) {
              modelId = payload.output;
            } else {
              modelId = payload.output;
            }
          } else if (Array.isArray(payload.output)) {
            // If it's an array, take the first element
            modelId = payload.output[0] || null;
            // If first element is an object, try to extract model ID from it
            if (typeof modelId === 'object' && modelId !== null) {
              const obj = modelId as any;
              modelId = obj.model_id || obj.modelId || obj.model || obj.url || obj.lora_url || null;
            }
          } else if (typeof payload.output === 'object' && payload.output !== null) {
            const output = payload.output as any;
            // Try various possible field names for model ID
            modelId = output.model_id || 
                     output.modelId || 
                     output.model || 
                     output.lora_url ||
                     output.lora_model ||
                     output.output_url ||
                     output.url ||
                     output.file ||
                     null;
            
            // If still no model ID, search recursively
            if (!modelId) {
              const searchForModelId = (obj: any): string | null => {
                if (typeof obj === 'string' && (obj.includes('model') || obj.includes('lora') || obj.startsWith('http'))) {
                  return obj;
                }
                if (Array.isArray(obj)) {
                  for (const item of obj) {
                    const found = searchForModelId(item);
                    if (found) return found;
                  }
                }
                if (typeof obj === 'object' && obj !== null) {
                  for (const value of Object.values(obj)) {
                    const found = searchForModelId(value);
                    if (found) return found;
                  }
                }
                return null;
              };
              modelId = searchForModelId(output);
            }
          }
        }
        
        console.log('Training succeeded, extracted model ID:', modelId);
        break;
      case 'failed':
        progress = 0;
        statusMessage = `Training failed: ${payload?.error || 'Unknown error'}`;
        break;
      case 'canceled':
        progress = 0;
        statusMessage = 'Training canceled';
        break;
      default:
        progress = 25;
        statusMessage = 'Waiting for training to start...';
    }

    return NextResponse.json({
      status: payload?.status,
      progress: progress / 100,
      statusMessage,
      error: payload?.error || null,
    });

  } catch (error: any) {
    console.error('Status check error:', error);
    return NextResponse.json(
      { 
        error: error.message || 'Failed to check training status',
        status: 'error'
      },
      { status: 500 }
    );
  }
}
