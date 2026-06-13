import Replicate from 'replicate';
import { translate } from '@vitalets/google-translate-api';
import { downloadMediaWithValidation, extractOutputUrlByKind } from '@/lib/replicate-media';
import { persistGeneratedBuffer } from '@/lib/generated-assets';

const BRIA_GENERATE_BACKGROUND_VERSION =
  'ba437a62603f1205b253fd7bad0d0b5c326d7857242d11753c0cbcd2c5008602';
const DEFAULT_STUDIO_PROMPT =
  'premium photo studio, smooth seamless cyclorama wall, wrinkle-free backdrop, soft editorial lighting, polished commercial photography environment';
const STUDIO_NEGATIVE_PROMPT =
  'duplicate person, extra subject, deformed body, broken anatomy, blurred face, distorted foreground, cropped subject, low quality, watermark, text, wrinkled fabric, curtain, draped cloth, hanging sheet, visible backdrop folds, visible seams, cluttered background';
const POLL_INTERVAL_MS = 1000;
const MAX_POLL_ATTEMPTS = 60;

type PredictionLike = {
  id: string;
  status?: string | null;
  error?: string | null;
  output?: unknown;
};

export type RebuildStudioBackgroundResult = {
  engine: 'bria/generate-background';
  imageUrl: string;
  providerImageUrl?: string;
};

type RebuildStudioBackgroundParams = {
  apiToken: string;
  image: string;
  prompt?: string;
  triggerWord?: string;
};

const safeTrim = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const extractImageUrl = (output: unknown) => extractOutputUrlByKind(output, 'image');

const translateToEnglish = async (text: string) => {
  const trimmed = safeTrim(text);
  if (!trimmed) return DEFAULT_STUDIO_PROMPT;

  const englishPattern = /^[a-zA-Z0-9\s.,!?'"()\-:;/&]+$/;
  if (englishPattern.test(trimmed)) {
    return trimmed;
  }

  try {
    const result = await translate(trimmed, { to: 'en' });
    return safeTrim(result.text) || trimmed;
  } catch (error) {
    console.warn('[background-rebuild] Prompt translation failed, using original text:', error);
    return trimmed;
  }
};

const buildBackgroundOnlyPrompt = async (prompt: string, triggerWord?: string) => {
  const translatedPrompt = await translateToEnglish(prompt || DEFAULT_STUDIO_PROMPT);
  const prefix = safeTrim(triggerWord);

  return [
    prefix,
    translatedPrompt,
    'background swap only',
    'preserve the original foreground subject exactly',
    'smooth seamless cyclorama studio wall',
    'wrinkle-free premium backdrop',
    'clean edge preservation',
    'no duplicate people',
    'no extra subject',
    'premium commercial photography',
    'clean seamless compositing',
  ]
    .filter(Boolean)
    .join(', ');
};

const waitForPredictionImage = async (
  replicate: Replicate,
  predictionId: string,
  label: string
) => {
  let prediction = await replicate.predictions.get(predictionId) as PredictionLike;

  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt += 1) {
    const status = safeTrim(prediction.status).toLowerCase();
    const imageUrl = extractImageUrl(prediction.output);

    if (status === 'succeeded' && imageUrl) {
      return imageUrl;
    }

    if (status === 'failed' || status === 'canceled') {
      throw new Error(`${label} failed: ${safeTrim(prediction.error) || 'Unknown error'}`);
    }

    await sleep(POLL_INTERVAL_MS);
    prediction = await replicate.predictions.get(predictionId) as PredictionLike;
  }

  throw new Error(`${label} timed out`);
};

export const rebuildStudioBackground = async ({
  apiToken,
  image,
  prompt,
  triggerWord,
}: RebuildStudioBackgroundParams): Promise<RebuildStudioBackgroundResult> => {
  const authToken = safeTrim(apiToken);
  const imageDataUrl = safeTrim(image);

  if (!authToken) {
    throw new Error('API token not configured');
  }

  if (!imageDataUrl) {
    throw new Error('Image is required');
  }

  const replicate = new Replicate({ auth: authToken });
  const studioPrompt = await buildBackgroundOnlyPrompt(prompt || DEFAULT_STUDIO_PROMPT, triggerWord);
  const backgroundPrediction = await replicate.predictions.create({
    version: BRIA_GENERATE_BACKGROUND_VERSION,
    input: {
      image: imageDataUrl,
      bg_prompt: studioPrompt,
      negative_prompt: STUDIO_NEGATIVE_PROMPT,
      refine_prompt: true,
      enhance_ref_image: true,
      force_rmbg: true,
    },
  });

  const providerImageUrl = await waitForPredictionImage(
    replicate,
    backgroundPrediction.id,
    'Studio background rebuild'
  );

  let imageUrl = providerImageUrl;
  try {
    const finalMedia = await downloadMediaWithValidation(providerImageUrl, {
      token: authToken,
      expectedKind: 'image',
      strictExpectedKind: true,
    });
    imageUrl = await persistGeneratedBuffer(finalMedia.buffer, {
      prefix: 'generated/images',
      suggestedName: 'image-studio-rebuild.png',
      contentType: finalMedia.contentType || 'image/png',
    });
  } catch (persistError) {
    console.warn(
      '[background-rebuild] Could not persist generated image, returning provider URL instead:',
      persistError
    );
  }

  return {
    engine: 'bria/generate-background',
    imageUrl,
    providerImageUrl: imageUrl !== providerImageUrl ? providerImageUrl : undefined,
  };
};
