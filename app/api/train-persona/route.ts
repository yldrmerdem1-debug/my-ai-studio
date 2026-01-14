import { NextRequest, NextResponse } from 'next/server';
import Replicate from 'replicate';

export async function POST(request: NextRequest) {
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

    const { zipFile, triggerWord, imageCount } = await request.json();

    if (!zipFile) {
      return NextResponse.json(
        { error: 'ZIP file is required' },
        { status: 400 }
      );
    }

    if (!imageCount || imageCount < 10) {
      return NextResponse.json(
        { error: 'At least 10 images are required' },
        { status: 400 }
      );
    }

    if (imageCount > 20) {
      return NextResponse.json(
        { error: 'Maximum 20 images allowed' },
        { status: 400 }
      );
    }

    if (!triggerWord) {
      return NextResponse.json(
        { error: 'Trigger word is required' },
        { status: 400 }
      );
    }

    console.log(`Starting training with ${imageCount} images, trigger word: ${triggerWord}`);

    // Use ostris/flux-dev-lora-trainer as specified by user
    const trainingModelOptions = [
      'ostris/flux-dev-lora-trainer', // Primary: User-specified model
      'replicate/fast-flux-trainer:latest', // Fallback option
      'lucataco/flux-dev-lora-trainer:latest', // Alternative fallback
    ];
    
    let trainingModel = trainingModelOptions[0]; // Start with replicate/fast-flux-trainer
    
    // Replicate's fast-flux-trainer accepts data URLs (data:application/zip;base64,...)
    // The ZIP file is already in base64 format from the frontend
    // We'll use it directly as a data URL
    let zipUrl = zipFile;
    
    // Ensure it's a proper data URL format
    if (!zipFile.startsWith('data:')) {
      // If it's raw base64, wrap it in data URL format
      zipUrl = `data:application/zip;base64,${zipFile}`;
    }
    
    console.log('ZIP file format:', zipUrl.substring(0, 50) + '...');
    console.log('ZIP file size:', Math.round(zipUrl.length / 1024), 'KB (base64)');
    
    // Prepare training input for fast-flux-trainer
    // Common parameter names: input_images, input_images_zip, images_zip, training_images
    const trainingInput: any = {
      input_images: zipUrl, // ZIP file (data URL or URL)
      trigger_word: triggerWord, // Unique trigger word for this persona
      steps: 1000, // Number of training steps
      learning_rate: 1e-4, // Learning rate
      batch_size: 1, // Batch size
      resolution: 512, // Training resolution
    };
    
    // Try alternative parameter names if the above doesn't work
    // Some models use: input_images_zip, images_zip, training_images_zip
    
    console.log('Training input prepared:', {
      imageCount: imageCount,
      triggerWord: trainingInput.trigger_word,
      steps: trainingInput.steps,
      hasZip: !!zipUrl,
      zipType: zipUrl.substring(0, 20), // First 20 chars to see format
    });

    // Start training with fast-flux-trainer
    // Try replicate/fast-flux-trainer first, then fallback to alternatives if needed
    // Try multiple parameter name variations as different model versions may use different names
    let prediction;
    let usedModel = trainingModel;
    let usedParameters = 'input_images';
    let lastError: any = null;
    
    // Try each model option
    for (const modelOption of trainingModelOptions) {
      try {
        console.log(`Attempting to use model: ${modelOption}`);
        trainingModel = modelOption;
        
        // Try primary parameter name first
        try {
          prediction = await replicate.predictions.create({
            version: trainingModel,
            input: trainingInput,
          });
          usedModel = trainingModel;
          usedParameters = 'input_images';
          console.log(`✓ Successfully started training with ${trainingModel} using input_images parameter`);
          break;
        } catch (paramError: any) {
          console.log(`Parameter 'input_images' failed for ${trainingModel}, trying alternatives...`);
          lastError = paramError;
          
          // Try alternative parameter names
          const altInputs = [
            { name: 'input_images_zip', input: { input_images_zip: zipUrl, trigger_word: triggerWord, steps: 1000, learning_rate: 1e-4, batch_size: 1, resolution: 512 } },
            { name: 'images_zip', input: { images_zip: zipUrl, trigger_word: triggerWord, steps: 1000, learning_rate: 1e-4, batch_size: 1, resolution: 512 } },
            { name: 'training_images', input: { training_images: zipUrl, trigger_word: triggerWord, steps: 1000, learning_rate: 1e-4, batch_size: 1, resolution: 512 } },
          ];
          
          for (const alt of altInputs) {
            try {
              prediction = await replicate.predictions.create({
                version: trainingModel,
                input: alt.input,
              });
              usedModel = trainingModel;
              usedParameters = alt.name;
              console.log(`✓ Successfully started training with ${trainingModel} using ${alt.name} parameter`);
              break;
            } catch (altError: any) {
              lastError = altError;
              continue;
            }
          }
          
          if (prediction) break; // If we got a prediction, break out of model loop
        }
      } catch (modelError: any) {
        console.log(`Model ${modelOption} failed:`, modelError.message);
        lastError = modelError;
        continue; // Try next model
      }
    }
    
    // If all models failed, throw error
    if (!prediction) {
      throw new Error(`Failed to start training with any available model. Last error: ${lastError?.message || 'Unknown error'}`);
    }

    console.log('Training started successfully!');
    console.log('Training ID:', prediction.id);
    console.log('Status:', prediction.status);
    console.log('Model used:', usedModel);
    console.log('Parameters used:', usedParameters);
    console.log('Initial output:', prediction.output);

    // Extract model ID from prediction output (if available immediately)
    let modelId: string | null = null;
    
    if (prediction.output) {
      if (typeof prediction.output === 'string') {
        modelId = prediction.output;
      } else if (Array.isArray(prediction.output) && prediction.output.length > 0) {
        modelId = prediction.output[0];
      } else if (typeof prediction.output === 'object' && prediction.output !== null) {
        const output = prediction.output as any;
        modelId = output.model_id || output.modelId || output.model || output.lora_url || null;
      }
    }
    
    // Model ID will typically be available after training completes
    // We'll poll for it in the status endpoint

    return NextResponse.json({
      trainingId: prediction.id,
      status: prediction.status,
      triggerWord: triggerWord,
      modelId: modelId, // May be null initially, will be updated via status polling
      message: 'Training started successfully',
      usedModel: usedModel, // Model that was successfully used
      usedParameters: usedParameters, // Parameters that worked
    });

  } catch (error: any) {
    console.error('Training error:', error);
    return NextResponse.json(
      { 
        error: error.message || 'Failed to start training',
        details: error.toString()
      },
      { status: 500 }
    );
  }
}
