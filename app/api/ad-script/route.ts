import { NextRequest, NextResponse } from 'next/server';
import type {
  DirectorAnalysis,
  DirectorInputPayload,
  DirectorPersonaAnalysis,
  DirectorRecommendations,
  DirectorResponse,
  DirectorScenario,
} from '@/lib/ad-director';
import { VIDEO_ENGINES_CONFIG, type VideoEngineKey, type VideoQualityPreset } from '@/lib/constants';
import {
  fetchDirectorProductSnapshot,
  resolveDirectorInlineImage,
  resolveDirectorInlineImageCandidates,
} from '@/lib/ad-director-source';
import { createGeminiModel, getGeminiModelId, resolveGeminiModelId } from '@/lib/gemini';

const geminiModelId = resolveGeminiModelId(
  process.env.GEMINI_AD_MODEL_ID || process.env.GEMINI_MODEL_ID,
  'gemini-2.5-flash'
);

const ENGINE_OPTIONS = Object.keys(VIDEO_ENGINES_CONFIG) as VideoEngineKey[];
const DEFAULT_PLAN = {
  audio_script: '',
  camera_movement: '',
  sfx_prompt: '',
  visual_prompt: '',
  voice_emotion: '',
};
const safeTrim = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
const pickFirst = (...values: unknown[]) => values.map(value => safeTrim(value)).find(Boolean) || '';
const safeArray = (value: unknown) =>
  Array.isArray(value)
    ? value.map(item => safeTrim(item)).filter(Boolean)
    : [];
const toRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
const normalizeBoolean = (value: unknown) => {
  if (typeof value === 'boolean') return value;
  const normalized = safeTrim(value).toLowerCase();
  return normalized === 'true' || normalized === 'yes' || normalized === '1';
};

const normalizeAspectRatio = (value: unknown): '9:16' | '16:9' | '1:1' => {
  const normalized = safeTrim(value).toLowerCase();
  if (normalized === 'portrait' || normalized === '9:16') return '9:16';
  if (normalized === 'square' || normalized === '1:1') return '1:1';
  return '16:9';
};

const normalizeEngine = (value: unknown): VideoEngineKey => {
  const normalized = safeTrim(value).toLowerCase();
  if (!normalized) return 'runway';
  if (ENGINE_OPTIONS.includes(normalized as VideoEngineKey)) return normalized as VideoEngineKey;
  if (normalized.includes('seedance') || normalized.includes('seed dance')) return 'seedance_2_0';
  if (normalized.includes('avatar') || normalized.includes('lip')) return 'kling_avatar_v2';
  if (normalized.includes('runway')) return 'runway';
  if (normalized.includes('veo')) return 'veo';
  if (normalized.includes('grok') || normalized.includes('xai')) return 'grok';
  if (normalized.includes('kling') && normalized.includes('turbo')) return 'kling_turbo';
  if (normalized.includes('kling') && (normalized.includes('2.6') || normalized.includes('2_6'))) return 'kling_2_6';
  if (normalized.includes('kling')) return 'kling_3_pro';
  return 'runway';
};

const normalizeQuality = (engine: VideoEngineKey, value: unknown): VideoQualityPreset => {
  const cfg = VIDEO_ENGINES_CONFIG[engine];
  const normalized = safeTrim(value);
  return cfg.supportedQualities.includes(normalized as VideoQualityPreset)
    ? normalized as VideoQualityPreset
    : cfg.defaultQuality;
};

const normalizeDuration = (engine: VideoEngineKey, value: unknown) => {
  const cfg = VIDEO_ENGINES_CONFIG[engine];
  if (cfg.mode === 'auto' || cfg.supportedDurations.length === 0) return 0;
  const parsed = Number.parseInt(safeTrim(value), 10);
  return cfg.supportedDurations.includes(parsed)
    ? parsed
    : cfg.defaultDuration;
};

const resolvePreferredDuration = (engine: VideoEngineKey, preferredDuration?: number | null) => {
  const cfg = VIDEO_ENGINES_CONFIG[engine];
  if (cfg.mode === 'auto' || cfg.supportedDurations.length === 0) return 0;
  if (!preferredDuration || Number.isNaN(preferredDuration)) return null;
  return cfg.supportedDurations.reduce((closest, current) => {
    return Math.abs(current - preferredDuration) < Math.abs(closest - preferredDuration)
      ? current
      : closest;
  }, cfg.defaultDuration);
};

const extractRequestedDuration = (value: string) => {
  const match = value.match(/\d+/);
  if (!match) return null;
  const parsed = Number.parseInt(match[0], 10);
  return Number.isNaN(parsed) ? null : parsed;
};

const stripJsonFences = (raw: string) => {
  const trimmed = raw.trim();
  if (trimmed.startsWith('```')) {
    return trimmed.replace(/^```[a-zA-Z]*\n?/, '').replace(/```$/, '').trim();
  }
  return trimmed;
};

const extractDirectorJson = (raw: string) => {
  const cleaned = stripJsonFences(raw);
  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : null;
  }
};

const normalizeScenario = (value: unknown, index: number): DirectorScenario => {
  const record = toRecord(value);
  const planRecord = toRecord(record.plan);
  return {
    title: pickFirst(record.title, `Scenario ${index + 1}`),
    hook: pickFirst(record.hook, 'Open with a fast product-first attention hook.'),
    angle: pickFirst(record.angle, 'Show the offer clearly and make the benefit immediate.'),
    plan: {
      visual_prompt: pickFirst(planRecord.visual_prompt, DEFAULT_PLAN.visual_prompt),
      audio_script: pickFirst(planRecord.audio_script, DEFAULT_PLAN.audio_script),
      voice_emotion: pickFirst(planRecord.voice_emotion, DEFAULT_PLAN.voice_emotion),
      sfx_prompt: pickFirst(planRecord.sfx_prompt, DEFAULT_PLAN.sfx_prompt),
      camera_movement: pickFirst(planRecord.camera_movement, DEFAULT_PLAN.camera_movement),
    },
  };
};

const normalizeDirectorResponse = (
  parsed: unknown,
  options: {
    fallbackFeatures: string[];
    preferredDuration?: number | null;
    personaName?: string;
    resolvedProductImageUrl?: string;
  }
): Omit<DirectorResponse, 'sourceContext'> => {
  const record = toRecord(parsed);
  const analysisRecord = toRecord(record.analysis);
  const personaRecord = toRecord(record.personaAnalysis);
  const recommendationsRecord = toRecord(record.recommendations);
  const recommendedEngine = normalizeEngine(
    pickFirst(
      recommendationsRecord.recommendedEngine,
      recommendationsRecord.recommended_engine,
      recommendationsRecord.engine
    )
  );
  const scenarios = (Array.isArray(record.scenarios) ? record.scenarios : [])
    .map((scenario, index) => normalizeScenario(scenario, index))
    .slice(0, 3);

  const analysis: DirectorAnalysis = {
    audienceInsights: safeArray(
      analysisRecord.audienceInsights ?? analysisRecord.audience_insights
    ).slice(0, 6),
    keyFeatures: safeArray(
      analysisRecord.keyFeatures ?? analysisRecord.key_features
    ).slice(0, 8),
    offerHighlights: safeArray(
      analysisRecord.offerHighlights ?? analysisRecord.offer_highlights
    ).slice(0, 6),
    platformFit: safeArray(
      analysisRecord.platformFit ?? analysisRecord.platform_fit
    ).slice(0, 6),
    summary: pickFirst(analysisRecord.summary),
    visualObservations: safeArray(
      analysisRecord.visualObservations ?? analysisRecord.visual_observations
    ).slice(0, 6),
  };

  if (analysis.keyFeatures.length === 0) {
    analysis.keyFeatures = options.fallbackFeatures.slice(0, 8);
  }

  const recommendations: DirectorRecommendations = {
    engineReason: pickFirst(
      recommendationsRecord.engineReason,
      recommendationsRecord.engine_reason,
      'Chosen to balance visual fidelity, controllability, and the current campaign goal.'
    ),
    needsPersona: normalizeBoolean(recommendationsRecord.needsPersona ?? recommendationsRecord.needs_persona),
    needsReferenceImage: normalizeBoolean(
      recommendationsRecord.needsReferenceImage ?? recommendationsRecord.needs_reference_image
    ),
    productionNotes: safeArray(
      recommendationsRecord.productionNotes ?? recommendationsRecord.production_notes
    ).slice(0, 6),
    recommendedAspectRatio: normalizeAspectRatio(
      recommendationsRecord.recommendedAspectRatio ?? recommendationsRecord.recommended_aspect_ratio
    ),
    recommendedDuration:
      resolvePreferredDuration(recommendedEngine, options.preferredDuration)
      ?? normalizeDuration(
        recommendedEngine,
        pickFirst(
          recommendationsRecord.recommendedDuration,
          recommendationsRecord.recommended_duration,
          recommendationsRecord.duration
        )
      ),
    recommendedEngine,
    recommendedQuality: normalizeQuality(
      recommendedEngine,
      pickFirst(
        recommendationsRecord.recommendedQuality,
        recommendationsRecord.recommended_quality,
        recommendationsRecord.quality
      )
    ),
    referenceImageUrl: pickFirst(
      recommendationsRecord.referenceImageUrl,
      recommendationsRecord.reference_image_url,
      options.resolvedProductImageUrl
    ) || undefined,
    riskNotes: safeArray(recommendationsRecord.riskNotes ?? recommendationsRecord.risk_notes).slice(0, 6),
  };

  if (recommendations.productionNotes.length === 0) {
    recommendations.productionNotes = [
      recommendations.needsReferenceImage
        ? 'Keep the product image as the primary visual anchor during generation.'
        : 'Lead with one clear hero shot before moving into supporting motion.',
    ];
  }

  const personaAnalysis = options.personaName || Object.keys(personaRecord).length > 0
    ? {
        cautions: safeArray(personaRecord.cautions).slice(0, 5),
        fitSummary: pickFirst(
          personaRecord.fitSummary,
          personaRecord.fit_summary,
          options.personaName ? `${options.personaName} can be used when a presenter-driven ad improves trust.` : ''
        ),
        selectedPersonaName: pickFirst(
          personaRecord.selectedPersonaName,
          personaRecord.selected_persona_name,
          options.personaName
        ) || undefined,
        usageRecommendation: pickFirst(
          personaRecord.usageRecommendation,
          personaRecord.usage_recommendation,
          options.personaName
            ? 'Use the persona for presenter-led hooks, testimonials, or demo talk-throughs.'
            : ''
        ),
      } satisfies DirectorPersonaAnalysis
    : null;

  return {
    analysis,
    personaAnalysis,
    recommendation: pickFirst(record.recommendation, 'Start with the strongest scenario and iterate from its hook.'),
    recommendations,
    scenarios: scenarios.length > 0
      ? scenarios
      : [normalizeScenario({}, 0), normalizeScenario({}, 1), normalizeScenario({}, 2)],
  };
};

export async function POST(request: NextRequest) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey || !apiKey.trim()) {
      console.error('GEMINI_API_KEY not found in environment');
      return NextResponse.json(
        {
          error: 'API token not configured',
          details: 'Please set GEMINI_API_KEY in your .env.local file and restart your dev server',
        },
        { status: 500 },
      );
    }

    const body = (await request.json()) as DirectorInputPayload;
    const productUrl = safeTrim(body?.productUrl);
    const productBrief = safeTrim(body?.productBrief);
    const productImageUrl = safeTrim(body?.productImageUrl);
    const platform = safeTrim(body?.platform);
    const tone = safeTrim(body?.tone);
    const duration = safeTrim(body?.duration);
    const objective = safeTrim(body?.objective);
    const audience = safeTrim(body?.audience);
    const persona = body?.persona && typeof body.persona === 'object'
      ? {
          id: safeTrim(body.persona.id),
          imageUrl: safeTrim(body.persona.imageUrl),
          modelFamily: safeTrim(body.persona.modelFamily),
          name: safeTrim(body.persona.name),
          referenceImageUrls: Array.isArray(body.persona.referenceImageUrls)
            ? body.persona.referenceImageUrls.map(item => safeTrim(item)).filter(Boolean)
            : [],
          trainingBaseModel: safeTrim(body.persona.trainingBaseModel),
          triggerWord: safeTrim(body.persona.triggerWord),
        }
      : null;

    if (!productBrief && !productUrl && !productImageUrl) {
      return NextResponse.json(
        { error: 'productBrief, productUrl, or productImageUrl is required' },
        { status: 400 }
      );
    }

    const resolvedModelId = await getGeminiModelId(apiKey, geminiModelId);
    const model = createGeminiModel(apiKey, resolvedModelId, {
      responseMimeType: 'application/json',
      temperature: 0.35,
    });
    const replicateToken = safeTrim(process.env.REPLICATE_API_TOKEN);
    const productSnapshot = await fetchDirectorProductSnapshot(productUrl);
    const resolvedProductImageUrl = pickFirst(
      productImageUrl,
      productSnapshot?.imageUrl,
      productSnapshot?.usedDirectImageUrl ? productSnapshot?.url : ''
    );
    const sourceSignals = [...(productSnapshot?.extractedSignals || [])];
    let productInlineImage = null;
    let personaInlineImage = null;

    if (resolvedProductImageUrl) {
      try {
        productInlineImage = await resolveDirectorInlineImage(resolvedProductImageUrl, replicateToken);
        sourceSignals.push('product-vision-ready');
      } catch (error) {
        console.warn('[ad-script] Product image analysis skipped:', error);
        sourceSignals.push('product-vision-skipped');
      }
    }

    const personaImageCandidates = [
      persona?.imageUrl || '',
      ...(persona?.referenceImageUrls || []),
    ].filter(Boolean);

    if (personaImageCandidates.length > 0) {
      try {
        const resolvedPersonaImage = await resolveDirectorInlineImageCandidates(personaImageCandidates, replicateToken);
        personaInlineImage = resolvedPersonaImage?.image ?? null;
        if (resolvedPersonaImage?.image) {
          sourceSignals.push('persona-vision-ready');
        }
        if (resolvedPersonaImage?.usedFallback) {
          sourceSignals.push('persona-vision-fallback-used');
        }
      } catch (error) {
        console.warn('[ad-script] Persona image analysis skipped:', error);
        sourceSignals.push('persona-vision-skipped');
      }
    }

    const briefParts = [
      productBrief ? `User brief: ${productBrief}` : null,
      platform ? `Platform: ${platform}` : null,
      tone ? `Tone: ${tone}` : null,
      duration ? `Target duration: ${duration}` : null,
      objective ? `Objective: ${objective}` : null,
      audience ? `Audience: ${audience}` : null,
    ].filter(Boolean) as string[];
    const urlContext = productSnapshot?.fetchedPage
      ? [
          `Product URL context:`,
          `URL: ${productSnapshot.url}`,
          productSnapshot.title ? `Title: ${productSnapshot.title}` : null,
          productSnapshot.description ? `Description: ${productSnapshot.description}` : null,
          productSnapshot.brand ? `Brand: ${productSnapshot.brand}` : null,
          productSnapshot.category ? `Category: ${productSnapshot.category}` : null,
          productSnapshot.price ? `Price: ${productSnapshot.price}` : null,
          productSnapshot.rating ? `Rating: ${productSnapshot.rating}` : null,
          productSnapshot.reviewCount ? `Review count: ${productSnapshot.reviewCount}` : null,
          productSnapshot.merchant ? `Merchant: ${productSnapshot.merchant}` : null,
          productSnapshot.campaigns.length > 0 ? `Campaigns:\n- ${productSnapshot.campaigns.join('\n- ')}` : null,
          productSnapshot.features.length > 0 ? `Extracted features:\n- ${productSnapshot.features.join('\n- ')}` : null,
          productSnapshot.snippet ? `Snapshot:\n${productSnapshot.snippet}` : null,
        ]
          .filter(Boolean)
          .join('\n')
      : productUrl
        ? `Product URL provided: ${productUrl} (unable to fetch detailed page text)`
        : '';
    const personaContext = persona
      ? [
          `Selected persona: ${persona.name || 'Unnamed persona'}`,
          persona.triggerWord ? `Persona trigger word: ${persona.triggerWord}` : null,
          persona.trainingBaseModel ? `Persona training model: ${persona.trainingBaseModel}` : null,
          persona.modelFamily ? `Persona model family: ${persona.modelFamily}` : null,
          personaInlineImage
            ? 'A visual persona reference is attached. Use it only to assess fit and presentation style.'
            : 'No reliable persona image could be resolved. Do not invent exact facial or styling details.',
          'If the persona is not a strong fit, say so clearly and recommend a product-only approach.',
        ]
          .filter(Boolean)
          .join('\n')
      : 'No persona selected. Recommend whether a persona would help or if the ad should stay product-only.';

    const directorPrompt = `
You are an elite AI creative director and campaign planner.
Use the structured text context, optional product image, and optional persona image to produce a grounded ad plan.

Return ONLY valid JSON with this exact shape:
{
  "analysis": {
    "summary": "1-2 sentence summary",
    "keyFeatures": ["3-8 concrete product features or selling points"],
    "visualObservations": ["3-6 visual observations from the product image or page imagery"],
    "audienceInsights": ["2-5 audience or positioning insights"],
    "offerHighlights": ["2-5 strongest commercial hooks"],
    "platformFit": ["2-5 platform-specific adaptation notes"]
  },
  "recommendations": {
    "recommendedEngine": "one of: grok, seedance_2_0, veo, runway, kling_3_pro, kling_turbo, kling_2_6, kling_avatar_v2",
    "engineReason": "why this engine is the best fit",
    "recommendedDuration": 5,
    "recommendedQuality": "720p",
    "recommendedAspectRatio": "16:9",
    "needsPersona": false,
    "needsReferenceImage": true,
    "referenceImageUrl": "${resolvedProductImageUrl || ''}",
    "riskNotes": ["2-5 risks or failure modes"],
    "productionNotes": ["2-5 practical production recommendations"]
  },
  "personaAnalysis": {
    "selectedPersonaName": "persona name if provided",
    "fitSummary": "short evaluation of persona fit",
    "usageRecommendation": "how to use or avoid the persona",
    "cautions": ["2-5 cautions"]
  },
  "scenarios": [
    {
      "title": "Short scenario name",
      "hook": "1 sentence hook",
      "angle": "What makes this angle work",
      "plan": {
        "visual_prompt": "English visual prompt for the chosen engine. Do NOT include persona trigger words because persona injection happens later.",
        "audio_script": "Spoken script in the same language as the user's brief or page language",
        "voice_emotion": "voice direction",
        "sfx_prompt": "sound design prompt",
        "camera_movement": "camera direction"
      }
    }
  ],
  "recommendation": "Which scenario is best and why"
}

Engine guide:
- grok: fastest iteration, strong for quick creative testing.
- seedance_2_0: best for cinematic motion with native synced audio/SFX and strong multimodal reference handling.
- veo: strongest for premium realism and polished product hero motion.
- runway: best when a reference image should strongly guide composition and motion.
- kling_3_pro: best for premium character-heavy or energetic cinematic ads.
- kling_turbo: use when speed matters more than max fidelity.
- kling_2_6: balanced quality/speed fallback.
- kling_avatar_v2: only for direct-to-camera, dialogue-led, presenter-style videos.

Hard rules:
- Ground the plan in real product details from the URL snapshot when available.
- If a product image is present, mention visual specifics like materials, color, silhouette, packaging, finish, and scene context.
- If persona is selected, evaluate whether the product should actually be presented by that persona.
- recommendedDuration must fit the chosen engine's supported durations:
  grok = 5/10/15
  seedance_2_0 = 5/10/15
  veo = 4/6/8
  runway = 5/8/10
  kling_3_pro = 5/10/15
  kling_turbo = 5/10
  kling_2_6 = 5/10
  kling_avatar_v2 = 0
- recommendedQuality must fit the chosen engine:
  grok = 480p/720p/1080p
  seedance_2_0 = 480p/720p/1080p
  veo = 720p/1080p
  runway = 720p/1584x672
  kling_3_pro = 720p/1080p
  kling_turbo = 720p
  kling_2_6 = 720p/1080p
  kling_avatar_v2 = 720p
- recommendedAspectRatio must be one of 9:16, 16:9, 1:1.
- Build 3 genuinely different scenarios.
- Avoid generic fluff. Prefer concrete product language over ad jargon.

Input context:
${briefParts.join('\n')}
${urlContext}
${personaContext}
    `.trim();

    const promptParts: Array<
      | { text: string }
      | { inlineData: { mimeType: string; data: string } }
    > = [{ text: directorPrompt }];

    if (productInlineImage) {
      promptParts.push({ text: 'Primary product reference image.' });
      promptParts.push({
        inlineData: {
          mimeType: productInlineImage.mimeType,
          data: productInlineImage.data,
        },
      });
    }

    if (personaInlineImage) {
      promptParts.push({ text: `Selected persona reference image for ${persona?.name || 'the persona'}.` });
      promptParts.push({
        inlineData: {
          mimeType: personaInlineImage.mimeType,
          data: personaInlineImage.data,
        },
      });
    }

    const result = await model.generateContent(promptParts);
    const response = await result.response;
    const raw = response.text().trim();
    const parsed = extractDirectorJson(raw);
    if (!parsed) {
      return NextResponse.json({ error: 'Failed to parse director plan' }, { status: 500 });
    }

    const normalized = normalizeDirectorResponse(parsed, {
      fallbackFeatures: productSnapshot?.features || [],
      preferredDuration: extractRequestedDuration(duration),
      personaName: persona?.name,
      resolvedProductImageUrl,
    });

    return NextResponse.json({
      ...normalized,
      sourceContext: {
        extractedSignals: Array.from(new Set(sourceSignals.filter(Boolean))),
        fetchedPage: Boolean(productSnapshot?.fetchedPage),
        hostname: productSnapshot?.hostname || '',
        productBrand: productSnapshot?.brand || '',
        productCategory: productSnapshot?.category || '',
        productDescription: productSnapshot?.description || '',
        productPrice: productSnapshot?.price || '',
        productTitle: productSnapshot?.title || '',
        resolvedProductImageUrl: resolvedProductImageUrl || undefined,
        usedDirectImageUrl: Boolean(productImageUrl || productSnapshot?.usedDirectImageUrl),
      },
    } satisfies DirectorResponse);
  } catch (error: unknown) {
    console.error('Ad script generation error:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to generate ad script',
        details: error instanceof Error ? error.toString() : String(error),
      },
      { status: 500 },
    );
  }
}
