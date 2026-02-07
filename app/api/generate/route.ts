import { NextRequest, NextResponse } from 'next/server';
import Replicate from 'replicate';
import { translate } from '@vitalets/google-translate-api';
import sharp from 'sharp';
import { requirePremium, requirePersonaAccess } from '@/lib/persona-guards';

// Map action types to Replicate models
// Updated to use the specific models requested by the user
const MODEL_MAP: Record<string, string> = {
  'remove-background': 'lucataco/remove-bg', // Updated: Use lucataco/remove-bg
  'studio-background': 'runwayml/stable-diffusion-inpainting:95b7223104132405a9ae91cc677285bc5eb997834bd2349c2b5a1ae1b1717942', // Inpainting model with mask support
  'mask-generation': 'lucataco/remove-bg', // Updated: Use lucataco/remove-bg for mask generation
  'background-removal': 'lucataco/remove-bg', // Updated: Use lucataco/remove-bg
  '3d-motion': 'stability-ai/stable-video-diffusion:3f0457e4619daac51203dedb472816fd4af51f3149fa7a9e0b5ffcf1b8172438',
  'ad-script': 'meta/llama-3.1-8b-instruct:af1c688b4a10d836358128ace4b7821950d6cbcd3d4532511146196b3b7c5c2b',
  'generate-image': 'black-forest-labs/flux-dev',
};

/**
 * Translates text to English if it's not already in English
 * This ensures Replicate models receive English prompts for best results
 * The translation is invisible to the user - they can type in any language
 */
async function translateToEnglish(text: string): Promise<string> {
  try {
    // Skip translation for empty or very short text
    if (!text || text.trim().length === 0) {
      return text;
    }

    // Simple heuristic: Check if text looks like English
    // English typically uses ASCII characters and common English words
    const englishPattern = /^[a-zA-Z0-9\s.,!?'"()-]+$/;
    const isAsciiOnly = englishPattern.test(text);
    
    // Common English words that appear in prompts
    const commonEnglishWords = [
      'professional', 'studio', 'background', 'clean', 'white', 'luxury', 'office',
      'lighting', 'photography', 'high', 'quality', 'modern', 'minimalist', 'cyberpunk',
      'city', 'streets', 'soft', 'bright', 'dark', 'colorful', 'minimal', 'elegant'
    ];
    
    const lowerText = text.toLowerCase();
    const hasEnglishWords = commonEnglishWords.some(word => lowerText.includes(word));
    
    // If text is ASCII-only and contains English words, assume it's English
    if (isAsciiOnly && hasEnglishWords) {
      console.log('Text appears to be in English, skipping translation');
      return text;
    }
    
    // If text contains non-ASCII characters (like Turkish, German, Japanese, etc.), translate it
    // Also translate if it's ASCII but doesn't contain common English words
    if (!isAsciiOnly || !hasEnglishWords) {
      console.log('Detected non-English text, translating to English...');
      console.log('Original:', text);
      
      // Translate to English with timeout protection
      const translationPromise = translate(text, { to: 'en' });
      const timeoutPromise = new Promise<string>((_, reject) => 
        setTimeout(() => reject(new Error('Translation timeout')), 5000)
      );
      
      const result = await Promise.race([translationPromise, timeoutPromise]) as any;
      const translatedText = result.text || text;
      
      console.log('Translated:', translatedText);
      return translatedText;
    }
    
    // Default: return original text if we can't determine
    return text;
  } catch (error: any) {
    // If translation fails (service down, rate limit, etc.), use original text
    // This ensures the app continues to work even if translation service is unavailable
    console.warn('Translation service unavailable, using original text:', error.message);
    console.warn('Original text will be sent to Replicate (may work if it\'s already English)');
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

    // Validate token format (Replicate tokens typically start with 'r8_')
    if (!apiToken.startsWith('r8_')) {
      console.error('REPLICATE_API_TOKEN has invalid format');
      return NextResponse.json(
        { 
          error: 'Invalid API token format.',
          details: 'Replicate API tokens should start with "r8_". Please verify your token in .env.local'
        },
        { status: 500 }
      );
    }

    // Initialize Replicate client with token
    const replicate = new Replicate({
      auth: apiToken.trim(),
    });

    const { action, image, prompt, triggerWord, user, personaMode, personaId, trainingId } = await request.json();

    const wantsPersona = personaMode === 'persona' || !!triggerWord;
    if (wantsPersona) {
      const premiumCheck = requirePremium(user);
      if (!premiumCheck.ok) {
        return NextResponse.json(premiumCheck.body, { status: premiumCheck.status });
      }

      const personaCheck = await requirePersonaAccess({
        user,
        personaId,
        requireReady: 'visual',
      });
      if (!personaCheck.ok) {
        return NextResponse.json(personaCheck.body, { status: personaCheck.status });
      }
    }

    if (!action) {
      return NextResponse.json(
        { error: 'Action is required' },
        { status: 400 }
      );
    }

    if (!image && action !== 'ad-script') {
      return NextResponse.json(
        { error: 'Image is required for this action' },
        { status: 400 }
      );
    }

    const model = MODEL_MAP[action];
    if (!model) {
      return NextResponse.json(
        { error: 'Invalid action type' },
        { status: 400 }
      );
    }

    // Create prediction
    console.log('Creating Replicate prediction...');
    let prediction: any;
    
    if (action === 'ad-script') {
      // Translate user prompt to English if provided, otherwise use default
      let adPrompt = prompt || 'Generate a compelling ad script for a product. Make it engaging, clear, and persuasive.';
      console.log('Original ad-script prompt (any language):', adPrompt);
      adPrompt = await translateToEnglish(adPrompt);
      console.log('Translated ad-script prompt (English):', adPrompt);
      
      prediction = await replicate.predictions.create({
        version: model,
        input: {
          prompt: adPrompt,
          max_tokens: 500,
        },
      });
    } else if (action === 'remove-background') {
      prediction = await replicate.predictions.create({
        version: model,
        input: {
          image: image,
        },
      });
    } else if (action === 'generate-image') {
      let imagePrompt = prompt || 'high quality portrait photo, studio lighting';
      imagePrompt = await translateToEnglish(imagePrompt);

      let loraWeights: string | null = null;
      if (trainingId) {
        const training = await replicate.trainings.get(trainingId);
        const output = training?.output ?? {};
        loraWeights = output?.weights ?? output?.weights_url ?? null;
        if (!loraWeights) {
          return NextResponse.json(
            { error: 'Training weights not available yet' },
            { status: 400 }
          );
        }
      }

      prediction = await replicate.predictions.create({
        version: model,
        input: {
          prompt: imagePrompt,
          ...(loraWeights ? { lora_weights: loraWeights, lora_scale: 0.8 } : {}),
        },
      });
    } else if (action === 'studio-background') {
      // PROPER INPAINTING APPROACH: Use mask-based inpainting for 100% subject preservation
      // Step 1: Extract subject mask using background removal (rembg)
      // Step 2: Generate proper mask from transparent image (white = inpaint background, black = preserve subject)
      // Step 3: Use inpainting model with image + mask to replace ONLY the background
      
      console.log('Step 1: Extracting subject mask using background removal...');
      
      // Extract the subject with transparent background using rembg
      const maskPrediction = await replicate.predictions.create({
        version: MODEL_MAP['background-removal'],
        input: {
          image: image,
        },
      });
      
      // Poll for mask extraction
      let maskResult: any = null;
      let maskAttempts = 0;
      const maxMaskAttempts = 30;
      
      while (maskAttempts < maxMaskAttempts) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        maskResult = await replicate.predictions.get(maskPrediction.id);
        
        if (maskResult.status === 'succeeded' && maskResult.output) {
          break;
        }
        if (maskResult.status === 'failed' || maskResult.status === 'canceled') {
          throw new Error(`Mask extraction failed: ${maskResult.error || 'Unknown error'}`);
        }
        maskAttempts++;
      }
      
      if (!maskResult || maskResult.status !== 'succeeded' || !maskResult.output) {
        throw new Error('Failed to extract subject mask');
      }
      
      const subjectImageWithTransparency = Array.isArray(maskResult.output) ? maskResult.output[0] : maskResult.output;
      console.log('✓ Step 1 complete: Subject extracted with transparent background');
      
      // Step 2: Convert transparent PNG to proper black/white mask
      // The mask format for inpainting: white = area to inpaint (background), black = area to preserve (subject)
      // We'll convert the transparent subject image to a mask where:
      // - Transparent areas (background) = WHITE (inpaint these)
      // - Opaque areas (subject) = BLACK (preserve these)
      
      console.log('Step 2: Converting transparent image to proper inpainting mask...');
      
      try {
        // Fetch the transparent image and convert it to a mask
        const transparentImageResponse = await fetch(subjectImageWithTransparency);
        if (!transparentImageResponse.ok) {
          throw new Error(`Failed to fetch transparent image: ${transparentImageResponse.statusText}`);
        }
        
        const transparentImageBuffer = Buffer.from(await transparentImageResponse.arrayBuffer());
        
        // Convert transparent PNG to black/white mask for inpainting
        // Logic:
        // - Extract alpha channel: transparent (alpha=0) = black, opaque (alpha=255) = white
        // - Negate: black (0) → white (255), white (255) → black (0)
        // Result: Background (transparent) = white (inpaint), Subject (opaque) = black (preserve)
        const maskBuffer = await sharp(transparentImageBuffer)
          .ensureAlpha() // Ensure alpha channel exists (adds alpha if missing)
          .extractChannel(3) // Extract alpha channel (channel 3 in RGBA = alpha)
          .negate({ alpha: false }) // Invert brightness: 0→255, 255→0 (don't invert alpha channel itself)
          .greyscale() // Ensure it's greyscale
          .png()
          .toBuffer();
        
        // Convert mask buffer to base64 data URL for Replicate
        const maskBase64 = `data:image/png;base64,${maskBuffer.toString('base64')}`;
        console.log('✓ Step 2 complete: Proper inpainting mask generated');
        console.log('  - White areas = background (will be inpainted/replaced)');
        console.log('  - Black areas = subject (will be preserved 100%)');
        
        // Step 3: Translate prompt to English
        let backgroundPrompt = prompt || 'professional studio background, clean white background, professional photography, high quality, studio lighting, seamless background';
        console.log('Original prompt (any language):', backgroundPrompt);
        backgroundPrompt = await translateToEnglish(backgroundPrompt);
        console.log('Translated prompt (English):', backgroundPrompt);
        
        // Build prompt that STRICTLY describes ONLY the background
        // Important: Don't mention the subject at all - only describe the background
        let backgroundOnlyPrompt = `${backgroundPrompt}, high quality, professional photography, empty background, no subjects, no people, no objects, just the background environment`;
        
        // Prepend trigger word if provided (for persona consistency in background style)
        if (triggerWord && triggerWord.trim()) {
          backgroundOnlyPrompt = `${triggerWord} ${backgroundOnlyPrompt}`;
          console.log('Using trigger word for persona:', triggerWord);
        }
        
        console.log('Step 3: Using mask-based inpainting to replace background only...');
        console.log('Using inpainting model:', model);
        console.log('Background prompt (subject-free):', backgroundOnlyPrompt);
        console.log('Mask format: White = background to replace, Black = subject to preserve');
        
        // Use runwayml/stable-diffusion-inpainting with proper mask
        // The mask we generated has:
        // - White pixels = background area (will be inpainted)
        // - Black pixels = subject area (will be preserved 100%)
        prediction = await replicate.predictions.create({
          version: model, // runwayml/stable-diffusion-inpainting
          input: {
            image: image, // Original full image
            mask: maskBase64, // Proper black/white mask (white = inpaint background, black = preserve subject)
            prompt: backgroundOnlyPrompt, // What to generate in the white masked area (background only)
            num_inference_steps: 50, // More steps for better quality and subject preservation
            guidance_scale: 7.5, // Standard guidance
            num_outputs: 1,
          },
        });
        
        console.log('✓ Mask-based inpainting started with proper mask');
        console.log('✓ Subject will be 100% preserved (black mask areas)');
        console.log('✓ Only background will be replaced (white mask areas)');
        
      } catch (maskError: any) {
        console.error('Error generating mask:', maskError);
        throw new Error(`Failed to generate inpainting mask: ${maskError.message}`);
      }
      
    } else if (action === '3d-motion') {
      // Translate any user prompt to English for better AI interpretation
      let videoPrompt = prompt || '3D motion effect with depth and movement, cinematic, smooth transitions';
      console.log('Original 3d-motion prompt (any language):', videoPrompt);
      videoPrompt = await translateToEnglish(videoPrompt);
      console.log('Translated 3d-motion prompt (English):', videoPrompt);
      
      // Use Stable Video Diffusion for video generation
      // This model generates video from a single image
      prediction = await replicate.predictions.create({
        version: model,
        input: {
          image: image,
          motion_bucket_id: 127, // Motion intensity (1-255, higher = more motion)
          cond_aug: 0.02, // Conditional augmentation
          decoding_t: 14, // Decoding timesteps
          num_frames: 25, // Number of frames in the video
        },
      });
    } else {
      // This should never happen due to earlier validation, but TypeScript needs this
      return NextResponse.json(
        { error: 'Invalid action type' },
        { status: 400 }
      );
    }

    // Ensure prediction is defined (TypeScript safety check)
    if (!prediction) {
      return NextResponse.json(
        { error: 'Failed to create prediction' },
        { status: 500 }
      );
    }

    console.log('Prediction created, ID:', prediction.id);
    console.log('Initial status:', prediction.status);
    console.log('Initial output (raw):', JSON.stringify(prediction.output, null, 2));

    // URL extraction helper - supports string, array of strings, or object with URL fields
    const extractUrl = (output: any): string | null => {
      if (!output) return null;
      
      // Case 1: Direct string URL
      if (typeof output === 'string' && output.startsWith('http')) {
        return output;
      }
      
      // Case 2: Array of strings - find first URL string
      if (Array.isArray(output)) {
        const urlString = output.find(x => typeof x === 'string' && x.startsWith('http'));
        if (urlString) return urlString;
      }
      
      // Case 3: Object - search all values for URL strings
      if (typeof output === 'object' && output !== null) {
        for (const v of Object.values(output)) {
          if (typeof v === 'string' && v.startsWith('http')) {
            return v;
          }
          // Also check nested arrays/objects recursively (one level deep)
          if (Array.isArray(v)) {
            const nestedUrl = v.find(x => typeof x === 'string' && x.startsWith('http'));
            if (nestedUrl) return nestedUrl;
          }
          if (typeof v === 'object' && v !== null) {
            for (const nestedV of Object.values(v)) {
              if (typeof nestedV === 'string' && nestedV.startsWith('http')) {
                return nestedV;
              }
            }
          }
        }
      }
      
      return null;
    };

    // Poll for completion - check every 2 seconds, max 60 seconds (30 attempts)
    const pollInterval = 2000; // 2 seconds
    const maxDuration = 60000; // 60 seconds
    const maxAttempts = Math.floor(maxDuration / pollInterval); // 30 attempts
    let attempts = 0;
    const startTime = Date.now();

    while (attempts < maxAttempts) {
      const elapsed = Date.now() - startTime;
      
      // Log current state
      console.log(`Poll attempt ${attempts + 1}/${maxAttempts} (${elapsed}ms elapsed)`);
      console.log(`Status: ${prediction.status}`);
      console.log(`Raw output:`, JSON.stringify(prediction.output, null, 2));
      
      // Extract URL from current output
      const url = extractUrl(prediction.output);
      
      // Success condition: status is 'succeeded' AND we have a valid URL
      if (prediction.status === 'succeeded' && url) {
        console.log(`✓ Prediction succeeded with valid URL after ${attempts + 1} attempt(s) (${elapsed}ms)`);
        console.log(`Extracted URL: ${url}`);
        // Return the extracted URL as output - NEVER return empty object
        return NextResponse.json({ output: url });
      }

      // Check for failed/canceled status
      if (prediction.status === 'failed' || prediction.status === 'canceled') {
        console.error(`Prediction ${prediction.status}:`, prediction.error);
        throw new Error(`Prediction ${prediction.status}: ${prediction.error || 'Unknown error'}`);
      }

      // If status is 'succeeded' but no URL found, wait a bit more (might be still processing)
      if (prediction.status === 'succeeded' && !url) {
        console.warn('Status is succeeded but no URL found, waiting a bit more...');
        attempts++;
        if (attempts < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, pollInterval));
          prediction = await replicate.predictions.get(prediction.id);
        }
        continue;
      }

      // If not succeeded yet, wait and poll again
      attempts++;
      if (attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, pollInterval));
        prediction = await replicate.predictions.get(prediction.id);
      }
    }

    // Timeout - max attempts reached without success
    const finalElapsed = Date.now() - startTime;
    console.error(`✗ Polling timeout after ${maxAttempts} attempts (${finalElapsed}ms)`);
    console.error(`Final status: ${prediction.status}`);
    console.error(`Final output (raw):`, JSON.stringify(prediction.output, null, 2));
    
    // NEVER return empty object - return error instead
    return NextResponse.json(
      { error: 'Timed out waiting for image URL' },
      { status: 504 }
    );

  } catch (error: any) {
    console.error('Replicate API error:', error);
    console.error('Error details:', {
      message: error.message,
      status: error.status,
      statusText: error.statusText,
      response: error.response?.data,
    });
    
    // Check if it's an authentication error
    if (error.message?.includes('401') || error.message?.includes('Unauthorized') || error.message?.includes('Unauthenticated')) {
      return NextResponse.json(
        { 
          error: 'Authentication failed. Please ensure REPLICATE_API_TOKEN is set in your .env.local file and restart your dev server.',
          details: 'The Replicate API token may not be loaded. Try restarting your Next.js dev server.'
        },
        { status: 401 }
      );
    }
    
    return NextResponse.json(
      { error: error.message || 'Failed to process request' },
      { status: 500 }
    );
  }
}

