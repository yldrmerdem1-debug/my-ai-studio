import { NextRequest, NextResponse } from 'next/server';
import Replicate from 'replicate';
import { translate } from '@vitalets/google-translate-api';

/**
 * Helper function to extract retry_after duration from 429 error responses
 * Returns the retry_after value in milliseconds, or defaults to 5 seconds
 * Replicate API may return retry_after in headers, response body, or error object
 */
function getRetryAfterDuration(error: any): number {
  // Check for retry_after in error response headers
  if (error.headers?.get?.('retry-after')) {
    const retryAfter = parseInt(error.headers.get('retry-after'), 10);
    if (!isNaN(retryAfter) && retryAfter > 0) {
      return retryAfter * 1000; // Convert to milliseconds
    }
  }
  
  // Check for retry_after in error response object (direct property)
  if (error.response?.headers?.get?.('retry-after')) {
    const retryAfter = parseInt(error.response.headers.get('retry-after'), 10);
    if (!isNaN(retryAfter) && retryAfter > 0) {
      return retryAfter * 1000;
    }
  }
  
  // Check for retry_after in error body
  if (error.body?.retry_after) {
    const retryAfter = parseInt(error.body.retry_after, 10);
    if (!isNaN(retryAfter) && retryAfter > 0) {
      return retryAfter * 1000;
    }
  }
  
  // Check for retry_after in error data
  if (error.data?.retry_after) {
    const retryAfter = parseInt(error.data.retry_after, 10);
    if (!isNaN(retryAfter) && retryAfter > 0) {
      return retryAfter * 1000;
    }
  }
  
  // Check for retry_after in error message (sometimes included as text)
  const retryAfterMatch = error.message?.match(/retry[_\s-]?after[:\s]+(\d+)/i);
  if (retryAfterMatch) {
    const retryAfter = parseInt(retryAfterMatch[1], 10);
    if (!isNaN(retryAfter) && retryAfter > 0) {
      return retryAfter * 1000;
    }
  }
  
  // Default to 5 seconds if not specified
  return 5000;
}

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

    // Initialize Replicate client with API token
    // The SDK automatically handles Authorization header: Token ${apiToken}
    const replicate = new Replicate({
      auth: apiToken.trim(),
    });
    
    console.log('Replicate client initialized with token:', apiToken.substring(0, 10) + '...');

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
      
      // TEXT-TO-VIDEO MODE: Use official video model slugs (no version hashes)
      // Using model slug format for stability
      const textToVideoModels = [
        'minimax/video-01', // Primary: Video model
        'lucataco/luma-dream-machine', // Secondary: Official Luma model
        'kling-ai/kling-v1', // Tertiary: Official Kling model
      ];
      
      let lastError: any = null;
      
      for (const modelOption of textToVideoModels) {
        try {
          console.log(`Attempting text-to-video with model: ${modelOption}`);
          
          // Build input parameters - all video models use prompt field
          const videoInput: any = {
            prompt: translatedPrompt, // Send prompt to video model's prompt field
          };
          
          // Add model-specific parameters if needed
          if (modelOption.includes('minimax/video-01')) {
            // Minimax video-01 uses prompt field
            videoInput.prompt = translatedPrompt;
          } else if (modelOption.includes('luma-dream-machine')) {
            // Luma Dream Machine uses prompt field
            videoInput.prompt = translatedPrompt;
          } else if (modelOption.includes('kling')) {
            // Kling uses prompt field
            videoInput.prompt = translatedPrompt;
          }
          
          console.log(`Attempting text-to-video with model: ${modelOption}`);
          console.log('Input parameters:', JSON.stringify(videoInput, null, 2));
          console.log('Using model identifier format: owner/model-name');
          
          // Retry logic for 429 errors
          let retryCount = 0;
          let predictionSuccess = false;
          
          while (retryCount <= 1 && !predictionSuccess) {
            try {
              // Use model name directly in version field (Replicate SDK accepts this)
              videoPrediction = await replicate.predictions.create({
                version: modelOption, // Format: owner/model-name (e.g., lucataco/luma-dream-machine)
                input: videoInput,
              });
              
              predictionSuccess = true;
              console.log(`✓ Successfully started text-to-video with ${modelOption}`);
              console.log('Prediction ID:', videoPrediction.id);
              console.log('Prediction Status:', videoPrediction.status);
              break;
            } catch (createError: any) {
              // Check if it's a 429 error
              if ((createError.status === 429 || createError.message?.includes('429') || createError.message?.includes('rate limit')) && retryCount < 1) {
                const retryAfter = getRetryAfterDuration(createError);
                console.log(`429 error from Replicate, waiting ${retryAfter / 1000} seconds before retry ${retryCount + 1}...`);
                await new Promise(resolve => setTimeout(resolve, retryAfter));
                retryCount++;
                continue;
              }
              // If not 429 or we've already retried, throw the error
              throw createError;
            }
          }
          
          if (predictionSuccess) {
            break;
          }
        } catch (modelError: any) {
          console.error(`Model ${modelOption} failed:`, modelError.message);
          console.error('Error details:', modelError);
          lastError = modelError;
          
          // Try with minimal parameters (just prompt) - with retry logic
          try {
            console.log(`Retrying ${modelOption} with minimal parameters...`);
            const altInput: any = {
              prompt: translatedPrompt,
            };
            
            let retryCount = 0;
            let predictionSuccess = false;
            
            while (retryCount <= 1 && !predictionSuccess) {
              try {
                videoPrediction = await replicate.predictions.create({
                  version: modelOption,
                  input: altInput,
                });
                predictionSuccess = true;
                console.log(`✓ Successfully started text-to-video with ${modelOption} (minimal params)`);
                console.log('Prediction ID:', videoPrediction.id);
                break;
              } catch (createError: any) {
                // Check if it's a 429 error
                if ((createError.status === 429 || createError.message?.includes('429') || createError.message?.includes('rate limit')) && retryCount < 1) {
                  const retryAfter = getRetryAfterDuration(createError);
                  console.log(`429 error from Replicate (minimal params), waiting ${retryAfter / 1000} seconds before retry ${retryCount + 1}...`);
                  await new Promise(resolve => setTimeout(resolve, retryAfter));
                  retryCount++;
                  continue;
                }
                throw createError;
              }
            }
            
            if (predictionSuccess) {
              break;
            }
          } catch (altError: any) {
            console.error(`Alt params also failed for ${modelOption}:`, altError.message);
            console.error('Alt error details:', altError);
            continue;
          }
        }
      }
      
      if (!videoPrediction) {
        // All text-to-video models failed
        throw new Error('All text-to-video models failed. Please try again or check your prompt.');
      }
      
    } else if (isMultiImageMode) {
      // MULTI-IMAGE MODE: Generate video sequence from multiple images
      console.log(`Processing ${images.length} images for video sequence...`);

        // Use video model for image-to-video conversion
      const videoModel = 'minimax/video-01'; // Use video model (slug format, no version hash)
      
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

      // Retry logic for 429 errors
      let multiImageRetryCount = 0;
      let multiImagePredictionSuccess = false;
      
      while (multiImageRetryCount <= 1 && !multiImagePredictionSuccess) {
        try {
          videoPrediction = await replicate.predictions.create({
            version: videoModel,
            input: videoInput,
          });
          multiImagePredictionSuccess = true;
          console.log('Multi-image prediction created:', videoPrediction.id);
        } catch (createError: any) {
          // Check if it's a 429 error
          if ((createError.status === 429 || createError.message?.includes('429') || createError.message?.includes('rate limit')) && multiImageRetryCount < 1) {
            const retryAfter = getRetryAfterDuration(createError);
            console.log(`429 error from Replicate, waiting ${retryAfter / 1000} seconds before retry ${multiImageRetryCount + 1}...`);
            await new Promise(resolve => setTimeout(resolve, retryAfter));
            multiImageRetryCount++;
            continue;
          }
          throw createError;
        }
      }

      console.log('Multi-image video generation started with first frame');
      
    } else {
      // SINGLE-IMAGE MODE: Use uploaded image or generate video directly from text prompt
      // If no image uploaded, use text-to-video models directly
      let videoInputImage: string | null = null;

      // If we have an uploaded image, use it for image-to-video
      if (images && images.length > 0) {
        videoInputImage = images[0];
        console.log('Using uploaded image for video generation');
        
        // Use image-to-video model
        const videoModel = 'minimax/video-01'; // Use video model (slug format, no version hash)
        
        const videoInput: any = {
          image: videoInputImage,
        };
        
        // Add optional parameters if model supports them
        // Some models may not support all parameters
        console.log('Single-image video input with image URL');
        console.log('Using model:', videoModel);
        
        // Retry logic for 429 errors
        let singleVideoRetryCount = 0;
        let singleVideoPredictionSuccess = false;
        
        while (singleVideoRetryCount <= 1 && !singleVideoPredictionSuccess) {
          try {
            videoPrediction = await replicate.predictions.create({
              version: videoModel,
              input: videoInput,
            });
            singleVideoPredictionSuccess = true;
            console.log('Single-image prediction created:', videoPrediction.id);
            break;
          } catch (createError: any) {
            // Check if it's a 429 error
            if ((createError.status === 429 || createError.message?.includes('429') || createError.message?.includes('rate limit')) && singleVideoRetryCount < 1) {
              const retryAfter = getRetryAfterDuration(createError);
              console.log(`429 error from Replicate, waiting ${retryAfter / 1000} seconds before retry ${singleVideoRetryCount + 1}...`);
              await new Promise(resolve => setTimeout(resolve, retryAfter));
              singleVideoRetryCount++;
              continue;
            }
            throw createError;
          }
        }
      } else {
        // No image uploaded - use text-to-video models directly
        // This handles persona/trigger word scenarios
        console.log('No image uploaded, using text-to-video models directly');
        console.log('Prompt includes trigger word:', triggerWord || 'None');
        
        // Use the same text-to-video models as text-only mode
        const textToVideoModels = [
          'minimax/video-01', // Primary: Video model
          'lucataco/luma-dream-machine', // Secondary: Official Luma model
          'kling-ai/kling-v1', // Tertiary: Official Kling model
        ];
        
        let lastError: any = null;
        
        for (const modelOption of textToVideoModels) {
          try {
            console.log(`Attempting text-to-video with model: ${modelOption}`);
            
            const videoInput: any = {
              prompt: translatedPrompt, // Prompt already includes trigger word if provided
            };
            
            console.log('Input parameters:', JSON.stringify(videoInput, null, 2));
            
            // Retry logic for 429 errors
            let retryCount = 0;
            let predictionSuccess = false;
            
            while (retryCount <= 1 && !predictionSuccess) {
              try {
                videoPrediction = await replicate.predictions.create({
                  version: modelOption,
                  input: videoInput,
                });
                
                predictionSuccess = true;
                console.log(`✓ Successfully started text-to-video with ${modelOption}`);
                console.log('Prediction ID:', videoPrediction.id);
                break;
              } catch (createError: any) {
                // Check if it's a 429 error
                if ((createError.status === 429 || createError.message?.includes('429') || createError.message?.includes('rate limit')) && retryCount < 1) {
                  const retryAfter = getRetryAfterDuration(createError);
                  console.log(`429 error from Replicate, waiting ${retryAfter / 1000} seconds before retry ${retryCount + 1}...`);
                  await new Promise(resolve => setTimeout(resolve, retryAfter));
                  retryCount++;
                  continue;
                }
                throw createError;
              }
            }
            
            if (predictionSuccess) {
              break;
            }
          } catch (modelError: any) {
            console.error(`Model ${modelOption} failed:`, modelError.message);
            lastError = modelError;
            continue;
          }
        }
        
        if (!videoPrediction) {
          throw new Error('All text-to-video models failed. Please try again or check your prompt.');
        }
      }

    }

    if (!videoPrediction) {
      throw new Error('Failed to create video prediction after all retries');
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
      console.error('Error details:', JSON.stringify(error, null, 2));
      console.error('This usually means:');
      console.error('1. Model name/version is incorrect or invalid');
      console.error('2. Input parameters don\'t match model requirements');
      console.error('3. Image format is invalid');
      console.error('4. Missing required parameters');
      console.error('5. Model name format should be: owner/model-name (e.g., lucataco/luma-dream-machine)');
      
      // Return more detailed error for 422
      const errorMessage = error.message || 'Invalid model version or request format';
      const errorDetails = error.detail || error.toString();
      
      return NextResponse.json(
        { 
          error: errorMessage,
          details: errorDetails,
          statusCode: 422,
          suggestion: 'Please verify the model name is correct. Use format: owner/model-name (e.g., lucataco/luma-dream-machine or kling-ai/kling-v1). Check Replicate documentation for available models.'
        },
        { status: 422 }
      );
    }

    // Preserve 429 status code for frontend retry logic
    const statusCode = error.status || 500;
    
    return NextResponse.json(
      { 
        error: error.message || 'Failed to start video generation',
        details: error.toString(),
        statusCode: statusCode,
      },
      { status: statusCode }
    );
  }
}
