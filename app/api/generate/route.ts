import { NextRequest, NextResponse } from 'next/server';
import Replicate from 'replicate';
import { translate } from '@vitalets/google-translate-api';
import { rebuildStudioBackground } from '@/lib/background-rebuild';
import { requirePremium, requirePersonaAccess } from '@/lib/persona-guards';
import { getSupabaseAdminClient } from '@/lib/supabase/admin';

// Map action types to Replicate models
// Updated to use the specific models requested by the user
const MODEL_MAP: Record<string, string> = {
  'remove-background': 'lucataco/remove-bg:95fcc2a26d3899cd6c2691c900465aaeff466285a65c14638cc5f36f34befaf1',
  'studio-background': 'bria/generate-background:ba437a62603f1205b253fd7bad0d0b5c326d7857242d11753c0cbcd2c5008602',
  'mask-generation': 'lucataco/remove-bg:95fcc2a26d3899cd6c2691c900465aaeff466285a65c14638cc5f36f34befaf1',
  'background-removal': 'lucataco/remove-bg:95fcc2a26d3899cd6c2691c900465aaeff466285a65c14638cc5f36f34befaf1',
  '3d-motion': 'stability-ai/stable-video-diffusion:3f0457e4619daac51203dedb472816fd4af51f3149fa7a9e0b5ffcf1b8172438',
  'ad-script': 'meta/llama-3.1-8b-instruct:af1c688b4a10d836358128ace4b7821950d6cbcd3d4532511146196b3b7c5c2b',
  'generate-image': 'black-forest-labs/flux-2-klein-9b-base-lora',
};

type PredictionState = {
  error?: unknown;
  id: string;
  output?: unknown;
  status?: string | null;
};

type ApiErrorLike = {
  message?: string;
  response?: {
    data?: unknown;
  };
  status?: number;
  statusText?: string;
};

const extractUrl = (output: unknown): string | null => {
  if (!output) return null;
  if (typeof output === 'string' && output.startsWith('http')) return output;
  if (Array.isArray(output)) {
    const urlString = output.find((x) => typeof x === 'string' && x.startsWith('http'));
    if (urlString) return urlString;
  }
  if (typeof output === 'object' && output !== null) {
    for (const v of Object.values(output)) {
      if (typeof v === 'string' && v.startsWith('http')) return v;
      if (Array.isArray(v)) {
        const nestedUrl = v.find((x) => typeof x === 'string' && x.startsWith('http'));
        if (nestedUrl) return nestedUrl;
      }
      if (typeof v === 'object' && v !== null) {
        for (const nestedV of Object.values(v)) {
          if (typeof nestedV === 'string' && nestedV.startsWith('http')) return nestedV;
        }
      }
    }
  }
  return null;
};

const normalizeAspectRatio = (value: unknown): string => {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '9:16';
  if (raw === 'portrait') return '9:16';
  if (raw === 'landscape') return '16:9';
  if (raw === 'square') return '1:1';
  if (raw === 'match_input_image') return 'match_input_image';
  return raw;
};

const stableSeedFromParts = (...parts: unknown[]) => {
  const input = parts.map((part) => String(part ?? '')).join('|');
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const toImageArray = (value: unknown): string[] => {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((v) => String(v || '').trim()).filter(Boolean);
  }
  const one = String(value).trim();
  return one ? [one] : [];
};

const resolvePersonaLoraWeightUrl = async ({
  userId,
  personaId,
}: {
  userId?: string;
  personaId?: string;
}): Promise<string> => {
  const { client } = getSupabaseAdminClient();
  if (!client) return '';

  const candidates: string[] = [];
  const extractFromRow = (row: Record<string, unknown> | null | undefined) => {
    if (!row) return;
    const value = String(
      row.lora_weight_url
      || row.loraWeightUrl
      || row.persona_lora_weight_url
      || row.personaLoraWeightUrl
      || ''
    ).trim();
    if (value) candidates.push(value);
  };

  const safeUserId = String(userId || '').trim();
  const safePersonaId = String(personaId || '').trim();

  const probes: Array<{ table: 'users' | 'subscriptions'; key: string; value: string }> = [];
  if (safeUserId) {
    probes.push({ table: 'users', key: 'id', value: safeUserId });
    probes.push({ table: 'subscriptions', key: 'user_id', value: safeUserId });
  }
  if (safePersonaId) {
    probes.push({ table: 'subscriptions', key: 'persona_id', value: safePersonaId });
    probes.push({ table: 'users', key: 'persona_id', value: safePersonaId });
  }

  for (const probe of probes) {
    try {
      const query = client.from(probe.table).select('*').eq(probe.key, probe.value);
      const { data, error } = probe.table === 'subscriptions'
        ? await query.order('created_at', { ascending: false }).limit(1)
        : await query.limit(1);
      if (error || !Array.isArray(data) || data.length === 0) continue;
      extractFromRow(data[0] as Record<string, unknown>);
    } catch {
      // Ignore missing table/column mismatch to keep backward compatibility.
    }
  }

  return candidates[0] || '';
};

export async function GET(request: NextRequest) {
  try {
    const apiToken = process.env.REPLICATE_API_TOKEN;
    if (!apiToken?.trim()) {
      return NextResponse.json({ error: 'REPLICATE_API_TOKEN not configured' }, { status: 500 });
    }
    const predictionId = String(request.nextUrl.searchParams.get('predictionId') || '').trim();
    if (!predictionId) {
      return NextResponse.json({ error: 'predictionId is required' }, { status: 400 });
    }

    const replicate = new Replicate({ auth: apiToken.trim() });
    const prediction = await replicate.predictions.get(predictionId) as PredictionState;
    const url = extractUrl(prediction.output);

    return NextResponse.json({
      predictionId,
      status: prediction.status || 'starting',
      output: url || null,
      error: prediction.error || null,
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch prediction status' },
      { status: 500 }
    );
  }
}

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
      
      const result = await Promise.race([translationPromise, timeoutPromise]) as { text?: string };
      const translatedText = result.text || text;
      
      console.log('Translated:', translatedText);
      return translatedText;
    }
    
    // Default: return original text if we can't determine
    return text;
  } catch (error: unknown) {
    // If translation fails (service down, rate limit, etc.), use original text
    // This ensures the app continues to work even if translation service is unavailable
    console.warn(
      'Translation service unavailable, using original text:',
      error instanceof Error ? error.message : error
    );
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

    const {
      action,
      image,
      images,
      prompt,
      triggerWord,
      user,
      personaMode,
      personaId,
      aspectRatio,
      waitForResult,
    } = await request.json();

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

    if (!image && action !== 'ad-script' && action !== 'generate-image') {
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
    let prediction: PredictionState | null = null;
    
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
      // NOTE: Keep the same Replicate key and ensure it has access to this new model.
      // If access is missing, Replicate will return 401/403 from create prediction.
      let imagePrompt = prompt || 'high quality portrait photo, studio lighting';
      imagePrompt = await translateToEnglish(imagePrompt);

      const requestImages = [...toImageArray(images), ...toImageArray(image)];
      const userId = typeof user === 'object' && user && 'id' in user
        ? String((user as { id?: unknown }).id || '').trim()
        : '';
      const loraWeightUrl = await resolvePersonaLoraWeightUrl({
        userId,
        personaId: String(personaId || '').trim(),
      });

      if (!loraWeightUrl) {
        return NextResponse.json(
          { error: 'Lutfen Persona egitin', code: 'PERSONA_LORA_REQUIRED' },
          { status: 400 }
        );
      }

      const modelInput: Record<string, unknown> = {
        prompt: imagePrompt,
        lora_weights: [loraWeightUrl],
        aspect_ratio: normalizeAspectRatio(aspectRatio) || (requestImages.length > 0 ? 'match_input_image' : '9:16'),
        output_megapixels: 2,
        output_format: 'jpg',
        output_quality: 95,
        seed: stableSeedFromParts(imagePrompt, personaId, userId, normalizeAspectRatio(aspectRatio), loraWeightUrl, requestImages.join(',')),
      };
      if (requestImages.length > 0) {
        modelInput.images = requestImages;
      }

      prediction = await replicate.predictions.create({
        model,
        input: modelInput,
      });

      const wantsSyncResult =
        waitForResult === true
        || waitForResult === 'true'
        || waitForResult === 1
        || waitForResult === '1';
      if (!wantsSyncResult) {
        const pollUrl = `/api/generate?predictionId=${encodeURIComponent(prediction.id)}`;
        return NextResponse.json(
          {
            success: true,
            async: true,
            status: prediction.status || 'starting',
            predictionId: prediction.id,
            pollUrl,
          },
          { status: 202 }
        );
      }
    } else if (action === 'studio-background') {
      const result = await rebuildStudioBackground({
        apiToken: apiToken.trim(),
        image: String(image || ''),
        prompt: typeof prompt === 'string' ? prompt : '',
        triggerWord: typeof triggerWord === 'string' ? triggerWord : '',
      });
      return NextResponse.json({
        output: result.imageUrl,
        imageUrl: result.imageUrl,
        engine: result.engine,
        providerImageUrl: result.providerImageUrl,
      });
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
          prediction = await replicate.predictions.get(prediction.id) as PredictionState;
        }
        continue;
      }

      // If not succeeded yet, wait and poll again
      attempts++;
      if (attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, pollInterval));
        prediction = await replicate.predictions.get(prediction.id) as PredictionState;
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

  } catch (error: unknown) {
    const apiError = (error || {}) as ApiErrorLike;
    console.error('Replicate API error:', error);
    console.error('Error details:', {
      message: apiError.message,
      status: apiError.status,
      statusText: apiError.statusText,
      response: apiError.response?.data,
    });
    
    // Check if it's an authentication error
    if (
      apiError.message?.includes('401')
      || apiError.message?.includes('Unauthorized')
      || apiError.message?.includes('Unauthenticated')
    ) {
      return NextResponse.json(
        { 
          error: 'Authentication failed. Please ensure REPLICATE_API_TOKEN is set in your .env.local file and restart your dev server.',
          details: 'The Replicate API token may not be loaded. Try restarting your Next.js dev server.'
        },
        { status: 401 }
      );
    }
    
    return NextResponse.json(
      { error: apiError.message || 'Failed to process request' },
      { status: 500 }
    );
  }
}

