import { NextRequest, NextResponse } from 'next/server';
import Replicate from 'replicate';
import { translate } from '@vitalets/google-translate-api';

/**
 * Translates text to English if it's not already in English
 * Ensures Replicate models receive English prompts for best results
 */
async function translateToEnglish(text: string): Promise<string> {
  try {
    if (!text || text.trim().length === 0) {
      return text;
    }

    const englishPattern = /^[a-zA-Z0-9\s.,!?'"()-]+$/;
    const isAsciiOnly = englishPattern.test(text);
    
    const commonEnglishWords = [
      'camera', 'lighting', 'transition', 'movement', 'cinematic', 'video', 'scene',
      'character', 'action', 'mood', 'music', 'dramatic', 'smooth', 'pan', 'zoom'
    ];
    
    const lowerText = text.toLowerCase();
    const hasEnglishWords = commonEnglishWords.some(word => lowerText.includes(word));
    
    if (isAsciiOnly && hasEnglishWords) {
      return text;
    }
    
    if (!isAsciiOnly || !hasEnglishWords) {
      console.log('Translating video prompt to English...');
      const translationPromise = translate(text, { to: 'en' });
      const timeoutPromise = new Promise<string>((_, reject) => 
        setTimeout(() => reject(new Error('Translation timeout')), 5000)
      );
      
      const result = await Promise.race([translationPromise, timeoutPromise]) as any;
      return result.text || text;
    }
    
    return text;
  } catch (error: any) {
    console.warn('Translation unavailable, using original text:', error.message);
    return text;
  }
}

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
      console.error('Invalid API token format detected');
      return NextResponse.json(
        { error: 'Invalid API token format. Token must start with "r8_"' },
        { status: 500 }
      );
    }

    // Initialize Replicate client
    const replicate = new Replicate({
      auth: apiToken.trim(),
    });

    // Parse and log request body
    const requestBody = await request.json();
    console.log('=== VIDEO API REQUEST ===');
    console.log('Request Payload:', JSON.stringify(requestBody, null, 2));

    const { images, descriptions, narrative, prompt, triggerWord, isTextOnly, mode } = requestBody;

    // Determine generation mode
    const isMultiImageMode = images && Array.isArray(images) && images.length > 0;
    const isTextToVideoMode = isTextOnly === true || (!isMultiImageMode && (!images || images.length === 0));

    if (!prompt || !prompt.trim()) {
      console.error('Missing prompt in request');
      return NextResponse.json(
        { error: 'Video prompt is required' },
        { status: 400 }
      );
    }

    console.log('=== VIDEO GENERATION PARAMETERS ===');
    console.log('Prompt:', prompt);
    console.log('Is Text Only:', isTextOnly);
    console.log('Mode:', mode);
    console.log('Has Images:', images && images.length > 0);
    console.log('Image Count:', images?.length || 0);
    console.log('Trigger Word:', triggerWord || 'None');

    // Translate prompt to English for better AI interpretation
    let translatedPrompt = prompt;
    console.log('Original prompt (any language):', translatedPrompt);
    translatedPrompt = await translateToEnglish(translatedPrompt);
    console.log('Translated prompt (English):', translatedPrompt);

    console.log('Starting video generation...');
    console.log('Mode:', isTextToVideoMode ? 'Text-to-Video' : isMultiImageMode ? `Multi-image (${images.length} images)` : 'Image-to-Video');
    console.log('Final prompt:', translatedPrompt);
    console.log('Trigger word:', triggerWord);
    if (isMultiImageMode) {
      console.log('Image descriptions:', descriptions);
      console.log('Narrative:', narrative);
    }

    let videoPrediction;

    if (isTextToVideoMode) {
      // TEXT-TO-VIDEO MODE: Generate video purely from text prompt
      console.log('TEXT-TO-VIDEO MODE: Generating video from text prompt only');
      
      // TEXT-TO-VIDEO MODE: Use a text-to-video model
      // Try models in order of preference
      const textToVideoModels = [
        'anotherjesse/zeroscope-v2-xl', // Latest version (most reliable)
        'stability-ai/stable-video-diffusion:3f0457e4619daac51203dedb472816fd4af51f3149fa7a9e0b5ffcf1b8172438', // Fallback: SVD (requires image, but we'll generate one)
      ];
      
      let lastError: any = null;
      
      for (const modelOption of textToVideoModels) {
        try {
          console.log(`Attempting text-to-video with model: ${modelOption}`);
          
          // Zeroscope-v2-xl parameters
          // This model accepts prompt for text-to-video generation
          const videoInput: any = {
            prompt: translatedPrompt, // Use translated prompt
          };
          
          // Only add optional parameters if model supports them
          // Some versions don't support width/height/num_frames
          console.log(`Attempting text-to-video with model: ${modelOption}`);
          console.log('Input parameters:', JSON.stringify(videoInput, null, 2));
          
          videoPrediction = await replicate.predictions.create({
            version: modelOption,
            input: videoInput,
          });
          
          console.log(`✓ Successfully started text-to-video with ${modelOption}`);
          console.log('Prediction ID:', videoPrediction.id);
          console.log('Prediction Status:', videoPrediction.status);
          break;
        } catch (modelError: any) {
          console.error(`Model ${modelOption} failed:`, modelError.message);
          console.error('Error details:', modelError);
          lastError = modelError;
          
          // Try with minimal parameters (just prompt)
          try {
            console.log(`Retrying ${modelOption} with minimal parameters...`);
            const altInput: any = {
              prompt: translatedPrompt,
            };
            videoPrediction = await replicate.predictions.create({
              version: modelOption,
              input: altInput,
            });
            console.log(`✓ Successfully started text-to-video with ${modelOption} (minimal params)`);
            console.log('Prediction ID:', videoPrediction.id);
            break;
          } catch (altError: any) {
            console.error(`Alt params also failed for ${modelOption}:`, altError.message);
            console.error('Alt error details:', altError);
            continue;
          }
        }
      }
      
      if (!videoPrediction) {
        // Final fallback: Generate image first, then convert to video
        console.log('Text-to-video models failed, using image-to-video fallback...');
        console.log('Generating image from prompt first, then converting to video...');
        
        const imageModel = 'stability-ai/sdxl:39ed52f2a78e934b3ba6e2a89f5b1c712de7dfea535525255b1aa35c5565e08b';
        const imagePrediction = await replicate.predictions.create({
          version: imageModel,
          input: {
            prompt: translatedPrompt,
            num_outputs: 1,
            guidance_scale: 7.5,
            num_inference_steps: 30,
          },
        });

        let imageResult: any = null;
        let imageAttempts = 0;
        const maxImageAttempts = 30;

        while (imageAttempts < maxImageAttempts) {
          await new Promise(resolve => setTimeout(resolve, 2000));
          imageResult = await replicate.predictions.get(imagePrediction.id);

          if (imageResult.status === 'succeeded' && imageResult.output) {
            break;
          }
          if (imageResult.status === 'failed' || imageResult.status === 'canceled') {
            throw new Error(`Image generation failed: ${imageResult.error || 'Unknown error'}`);
          }
          imageAttempts++;
        }

        if (!imageResult || imageResult.status !== 'succeeded' || !imageResult.output) {
          throw new Error('Failed to generate image for text-to-video fallback');
        }

        const finalProcessingUrl = Array.isArray(imageResult.output) ? imageResult.output[0] : imageResult.output;
        console.log('Image generated for video:', finalProcessingUrl);

        // Now generate video from the image (fallback for text-to-video)
        const videoModel = 'stability-ai/stable-video-diffusion:3f0457e4619daac51203dedb472816fd4af51f3149fa7a9e0b5ffcf1b8172438';
        videoPrediction = await replicate.predictions.create({
          version: videoModel,
          input: {
            image: finalProcessingUrl, // Use generated image
            motion_bucket_id: 127,
            cond_aug: 0.02,
            decoding_t: 14,
            num_frames: 25,
          },
        });
        
        console.log('✓ Using image-to-video fallback for text-to-video mode');
      }
      
    } else if (isMultiImageMode) {
      // MULTI-IMAGE MODE: Generate video sequence from multiple images
      console.log(`Processing ${images.length} images for video sequence...`);

      const videoModel = 'stability-ai/stable-video-diffusion:3f0457e4619daac51203dedb472816fd4af51f3149fa7a9e0b5ffcf1b8172438';
      
      // Strategy: Use the first image as the starting frame
      // The prompt describes the full sequence including image references
      const firstImage = images[0];
      // Prompt is already translated above

      console.log('Using first image as starting frame, generating video sequence...');
      console.log('Full narrative prompt:', translatedPrompt);

      // Build video input with first image and narrative prompt
      const videoInput: any = {
        image: firstImage, // First image as starting frame
        motion_bucket_id: 127, // Motion intensity
        cond_aug: 0.02,
        decoding_t: 14,
        num_frames: Math.max(25, images.length * 10), // More frames for longer sequences
      };

      console.log('Multi-image video input:', JSON.stringify({
        ...videoInput,
        image: '[BASE64_IMAGE_DATA]', // Don't log full base64
      }, null, 2));

      videoPrediction = await replicate.predictions.create({
        version: videoModel,
        input: videoInput,
      });

      console.log('Multi-image prediction created:', videoPrediction.id);

      console.log('Multi-image video generation started with first frame');
      
    } else {
      // SINGLE-IMAGE MODE: Generate image first if trigger word provided, then video
      let videoInputImage: string | null = null;

      if (triggerWord) {
        console.log('Generating image with persona first...');
        
        const imageModel = 'stability-ai/sdxl:39ed52f2a78e934b3ba6e2a89f5b1c712de7dfea535525255b1aa35c5565e08b';
        
        const imagePrediction = await replicate.predictions.create({
          version: imageModel,
          input: {
            prompt: translatedPrompt,
            num_outputs: 1,
            guidance_scale: 7.5,
            num_inference_steps: 30,
          },
        });

        let imageResult: any = null;
        let imageAttempts = 0;
        const maxImageAttempts = 30;

        while (imageAttempts < maxImageAttempts) {
          await new Promise(resolve => setTimeout(resolve, 2000));
          imageResult = await replicate.predictions.get(imagePrediction.id);

          if (imageResult.status === 'succeeded' && imageResult.output) {
            break;
          }
          if (imageResult.status === 'failed' || imageResult.status === 'canceled') {
            throw new Error(`Image generation failed: ${imageResult.error || 'Unknown error'}`);
          }
          imageAttempts++;
        }

        if (!imageResult || imageResult.status !== 'succeeded' || !imageResult.output) {
          throw new Error('Failed to generate image with persona');
        }

        videoInputImage = Array.isArray(imageResult.output) ? imageResult.output[0] : imageResult.output;
        console.log('Image generated:', videoInputImage);
      }

      // SINGLE-IMAGE MODE: Use uploaded image or generated image with persona
      const videoModel = 'stability-ai/stable-video-diffusion:3f0457e4619daac51203dedb472816fd4af51f3149fa7a9e0b5ffcf1b8172438';
      
      // If we have an uploaded image, use it directly (override persona-generated image if both exist)
      if (images && images.length > 0) {
        videoInputImage = images[0];
        console.log('Using uploaded image for video generation');
      }

      const videoInput: any = {
        motion_bucket_id: 127,
        cond_aug: 0.02,
        decoding_t: 14,
        num_frames: 25,
      };

      if (videoInputImage) {
        videoInput.image = videoInputImage;
        console.log('Single-image video input with image URL');
      } else {
        // This shouldn't happen in single-image mode, but handle it
        console.warn('No image URL in single-image mode, using prompt fallback');
        videoInput.prompt = translatedPrompt;
      }

      console.log('Single-image video input:', JSON.stringify({
        ...videoInput,
        image: videoInput.image ? '[IMAGE_URL]' : undefined,
      }, null, 2));

      videoPrediction = await replicate.predictions.create({
        version: videoModel,
        input: videoInput,
      });

      console.log('Single-image prediction created:', videoPrediction.id);
    }

    console.log('=== VIDEO GENERATION SUCCESS ===');
    console.log('Video generation started, ID:', videoPrediction.id);
    console.log('Status:', videoPrediction.status);
    console.log('Mode:', isTextToVideoMode ? 'Text-to-Video' : isMultiImageMode ? 'Multi-Image' : 'Image-to-Video');
    console.log('Full prediction object:', JSON.stringify(videoPrediction, null, 2));

    const responseData = {
      videoId: videoPrediction.id,
      status: videoPrediction.status,
      message: 'Video generation started successfully',
      isMultiImageMode: isMultiImageMode,
      isTextToVideo: isTextToVideoMode,
      imageCount: isMultiImageMode ? images.length : 0,
    };

    console.log('API Response:', JSON.stringify(responseData, null, 2));

    return NextResponse.json(responseData);

  } catch (error: any) {
    console.error('=== VIDEO GENERATION ERROR ===');
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    console.error('Error details:', error);
    console.error('Error type:', error.constructor.name);
    
    // Check if it's a 422 error from Replicate
    if (error.status === 422 || error.message?.includes('422')) {
      console.error('422 Unprocessable Entity - Request format issue');
      console.error('This usually means:');
      console.error('1. Model version string is incorrect');
      console.error('2. Input parameters don\'t match model requirements');
      console.error('3. Image format is invalid');
      console.error('4. Missing required parameters');
    }

    return NextResponse.json(
      { 
        error: error.message || 'Failed to start video generation',
        details: error.toString(),
        statusCode: error.status || 500,
      },
      { status: error.status || 500 }
    );
  }
}
