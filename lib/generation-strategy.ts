import { normalizePersonaSubjectType, type PersonaSubjectType } from '@/lib/persona-subject';

export type GenerationMode = 'fast' | 'standard' | 'premium' | 'cinematic';
export type GenerationTarget = 'image' | 'video-anchor' | 'auto-editor-scene';

type ResolveGenerationModeParams = {
  requestedMode?: unknown;
  qualityPreset?: unknown;
  target?: GenerationTarget;
  hasPersona?: boolean;
  isAction?: boolean;
};

type CreativeRebuildPromptParams = {
  subjectType?: unknown;
  creativeBrief: string;
  mode?: GenerationMode;
  target?: GenerationTarget;
  isAction?: boolean;
  strictIdentity?: boolean;
  retry?: boolean;
  isRefinePass?: boolean;
};

/** One real photograph — never a layout mockup unless the user explicitly asked for one. */
export const SINGLE_PHOTOGRAPH_RULES = [
  'OUTPUT FORMAT: exactly ONE single real photograph from one camera at one moment.',
  'Never output a collage, grid, contact sheet, mood board, carousel, split-screen, multi-panel ad layout, storyboard, or duplicate views of the subject in one image.',
  'Never bake marketing copy, slogans, headlines, captions, logos-as-typography, watermarks, or UI text into the image unless the user explicitly requested visible in-image text.',
  'If the user mentions ad copy or taglines, treat them as creative direction for mood/lighting only — not text to render inside the frame.',
].join(' ');

const MULTI_PANEL_LAYOUT_RE = /\b(collage|contact[\s-]?sheet|mood[\s-]?board|multi[\s-]?panel|split[\s-]?screen|grid[\s-]?layout|storyboard|carousel)\b/i;
const IN_IMAGE_TEXT_RE = /\b(text (on|in) (image|photo)|visible text|typography|headline|slogan|caption|watermark|write\b.+\bon\b.+\bimage)\b/i;

export const userRequestedMultiPanelLayout = (prompt: string) =>
  MULTI_PANEL_LAYOUT_RE.test(clean(prompt));

export const userRequestedInImageText = (prompt: string) =>
  IN_IMAGE_TEXT_RE.test(clean(prompt));

export const buildSinglePhotographRules = (creativeBrief: string) => {
  const parts = [SINGLE_PHOTOGRAPH_RULES];
  if (!userRequestedMultiPanelLayout(creativeBrief)) {
    parts.push('Do not invent a multi-shot layout even for advertisement or campaign briefs — describe one hero photograph instead.');
  }
  if (!userRequestedInImageText(creativeBrief)) {
    parts.push('Do not add any words, letters, or typography inside the photograph.');
  }
  return parts.join(' ');
};

/** Strip ad slogans / taglines that Nano tends to paint into the frame. */
const AD_SLOGAN_FRAGMENT_RE =
  /\b(milliseconds matter|precision wins|control the game|don't just play|do not just play|dominate the game|shop now|buy now|limited time offer|game changer|level up|unleash|be unstoppable)\b/gi;

export const sanitizeBriefForNanoImage = (prompt: string) => {
  let text = clean(prompt);
  if (!text) return '';

  text = text.replace(AD_SLOGAN_FRAGMENT_RE, ' ');
  text = text.replace(/["“”']([^"“”']{4,90})["“”']/g, (match, inner) => {
    const fragment = String(inner || '').trim();
    if (!fragment) return match;
    const wordCount = fragment.split(/\s+/).filter(Boolean).length;
    const capsRatio = (fragment.match(/[A-Z]/g) || []).length / Math.max(fragment.length, 1);
    if (wordCount <= 8 && capsRatio > 0.45) return ' ';
    if (AD_SLOGAN_FRAGMENT_RE.test(fragment)) return ' ';
    return match;
  });

  text = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => {
      if (!line) return false;
      if (line.length <= 72) {
        const capsRatio = (line.match(/[A-Z]/g) || []).length / line.length;
        const wordCount = line.split(/\s+/).filter(Boolean).length;
        if (wordCount <= 7 && capsRatio > 0.55) return false;
      }
      return true;
    })
    .join(', ');

  return text.replace(/\s{2,}/g, ' ').replace(/,\s*,+/g, ', ').replace(/^,\s*|\s*,$/g, '').trim();
};

type NanoBananaPromptParams = {
  subjectType?: unknown;
  creativeBrief: string;
  mode?: GenerationMode;
  isRefinePass?: boolean;
  isAction?: boolean;
  strictIdentity?: boolean;
};

const buildCompactNanoGuards = ({
  subjectType,
  brief,
  mode = 'premium',
  isRefinePass = false,
  isAction = false,
}: {
  subjectType: NonNullable<ReturnType<typeof normalizePersonaSubjectType>> | 'human';
  brief: string;
  mode?: GenerationMode;
  isRefinePass?: boolean;
  isAction?: boolean;
}) => {
  const singlePhoto = buildSinglePhotographRules(brief);
  const parts: string[] = [singlePhoto];

  if (subjectType === 'product') {
    parts.push(
      'Match the exact product identity from the reference image: silhouette, logo/brand placement, colors, materials, buttons, ports, proportions, and surface details.',
      isRefinePass
        ? 'Polish pass only: same single hero angle and framing as the reference. Upgrade lighting, reflections, materials, and environment realism. No hands, no people, no macro inserts, no duplicate angles, no ad layout.'
        : 'One premium hero product photograph. Product sharp, centered, fully visible, unobstructed. No generic substitute product.'
    );
  } else if (subjectType === 'animal') {
    parts.push(
      'Match the exact animal from the reference: species, markings, fur pattern, eye color, anatomy, and proportions.',
      isRefinePass
        ? 'Polish pass only: keep the same animal and framing while improving realism and environment.'
        : 'One clear animal portrait or hero shot with readable identity.'
    );
  } else {
    parts.push(
      'Match the exact person from the reference: face structure, eyes, skin character, hair, and age impression.',
      isRefinePass
        ? 'Polish pass only: keep the same face readable and large in frame while improving lighting, styling, and environment.'
        : 'One photoreal portrait or medium shot with a clearly readable face and natural anatomy.'
    );
    if (isAction) {
      parts.push('Freeze one decisive action instant; face must stay sharp and recognizable.');
    }
  }

  if (isRefinePass) {
    parts.push('Use the provided reference image as the composition anchor. Output exactly one finished photograph.');
  } else {
    parts.push(buildQualityDirectives(mode));
  }

  return parts.join(' ');
};

/**
 * Final prompt sent to Nano Banana.
 * Visual description first; compact guardrails second. No duplicated brief blocks.
 */
export const buildNanoBananaPrompt = ({
  subjectType,
  creativeBrief,
  mode = 'premium',
  isRefinePass = false,
  isAction = false,
}: NanoBananaPromptParams): string => {
  const normalizedSubject = normalizePersonaSubjectType(subjectType) || 'human';
  const visualBrief = sanitizeBriefForNanoImage(creativeBrief) || clean(creativeBrief);
  const guards = buildCompactNanoGuards({
    subjectType: normalizedSubject,
    brief: visualBrief,
    mode,
    isRefinePass,
    isAction,
  });

  if (isRefinePass) {
    return `${visualBrief}\n\n${guards}`.trim();
  }
  return `${visualBrief} ${guards}`.trim();
};

export type RefinementDecision = {
  useRefined: boolean;
  reason: string;
  shouldRetry: boolean;
};

const clean = (value: unknown) => String(value || '').trim();

export const resolveGenerationMode = ({
  requestedMode,
  qualityPreset,
  target = 'image',
  hasPersona = false,
  isAction = false,
}: ResolveGenerationModeParams): GenerationMode => {
  const rawMode = clean(requestedMode).toLowerCase();
  if (rawMode === 'fast' || rawMode === 'standard' || rawMode === 'premium' || rawMode === 'cinematic') {
    return rawMode;
  }

  const quality = clean(qualityPreset).toLowerCase();
  if (target === 'video-anchor' && (quality === '1080p' || quality === '1584x672' || isAction)) {
    return 'cinematic';
  }
  if (hasPersona && (quality === 'hq' || quality === '1080p' || quality === '1584x672')) {
    return 'premium';
  }
  if (quality === '720p' || quality === 'standard') return 'standard';
  if (quality === 'fast' || quality === '480p') return 'fast';
  return hasPersona ? 'standard' : 'fast';
};

export const shouldUseCreativeRefinement = (mode: GenerationMode, hasPersona: boolean) =>
  hasPersona && mode !== 'fast';

export const getNanoRefinerResolution = (
  mode: GenerationMode,
  subjectType?: unknown,
  isRefinePass = false
) => {
  const normalizedSubject = normalizePersonaSubjectType(subjectType);
  // Product refine at 4K often hallucinates collage layouts and baked-in ad copy.
  if (isRefinePass && normalizedSubject === 'product') {
    return mode === 'fast' ? '1K' : '2K';
  }
  return mode === 'cinematic' || mode === 'premium' ? '4K' : mode === 'standard' ? '2K' : '1K';
};

export const buildQualityDirectives = (mode: GenerationMode) => {
  if (mode === 'cinematic') {
    return 'Render as a finished cinematic campaign frame: ultra-realistic, razor-sharp facial/product detail, premium production design, motivated lighting, natural skin/material texture, controlled depth of field, filmic color grade, high dynamic range, clean anatomy, no artifacts, no low-effort background.';
  }
  if (mode === 'premium') {
    return 'Render at premium commercial quality: realistic, sharp, detailed, natural texture, strong lighting design, polished styling, believable environment, clean hands/anatomy, high-end editorial color grade, no blur, no artifacts, no plastic skin, no weak background.';
  }
  if (mode === 'standard') {
    return 'Render in high quality: realistic, sharp focus, clean detail, natural color, professional lighting, coherent environment, no artifacts or distortion.';
  }
  return 'Render cleanly and realistically with recognizable identity, coherent lighting, and no obvious artifacts.';
};

export const buildCreativeRebuildPrompt = ({
  subjectType,
  creativeBrief,
  mode = 'premium',
  target = 'image',
  isAction = false,
  strictIdentity = true,
  retry = false,
  isRefinePass = false,
}: CreativeRebuildPromptParams) => {
  const normalizedSubject = normalizePersonaSubjectType(subjectType) || 'human';
  const singlePhotoRules = buildSinglePhotographRules(creativeBrief);
  const targetContext =
    target === 'video-anchor'
      ? 'This image is the starting anchor for image-to-video. It must already look like a final premium campaign frame before motion is generated.'
      : target === 'auto-editor-scene'
        ? 'This is part of a chained editor scene. Evolve the world and action while preserving identity continuity.'
        : isRefinePass
          ? 'This is a polish pass on an existing LoRA render. Keep the same subject, camera geography, and single-product/single-subject framing unless the brief clearly demands a new angle.'
          : 'This is a final image generation/refinement pass.';
  const actionRule = isAction
    ? 'Action and motion are allowed, but identity readability is non-negotiable: face/product must remain visible, sharp, and not motion-blurred.'
    : 'Use identity-safe close-up, medium, or product-hero framing when needed; do not hide the face/product for composition drama.';
  const retryRule = retry
    ? 'This is a stricter retry because a previous refinement may have weakened identity or quality. Increase identity lock and reduce risky changes while still upgrading the shot.'
    : '';
  const productRefineRule = normalizedSubject === 'product' && isRefinePass
    ? 'Treat the provided base image as the composition anchor: same single product, same hero angle, same framing logic. Only polish lighting, materials, reflections, depth, and environment realism. Do not add hands, people, extra product angles, macro inserts, or a marketing layout.'
    : '';
  const conservativeRefineRule = isRefinePass && normalizedSubject === 'product'
    ? 'Upgrade subtly. If the base image already looks premium, change as little as possible while improving realism.'
    : isRefinePass
      ? 'Preserve the base shot structure; improve polish, lighting, and realism without inventing a new layout.'
      : '';

  const sharedShotUpgrade = [
    singlePhotoRules,
    'Core rule: Identity is sacred. Composition is negotiable. Protect the subject. Upgrade the shot.',
    targetContext,
    conservativeRefineRule,
    productRefineRule,
    isRefinePass
      ? 'Use the provided base image as the primary identity and composition reference.'
      : 'Use the provided image(s) as identity references, not as rigid composition locks.',
    isRefinePass
      ? 'Improve lighting, materials, atmosphere, and production polish while keeping one coherent photograph.'
      : 'If the base LoRA/reference image is ugly, awkward, generic, poorly lit, low quality, or does not fully satisfy the creative brief, rebuild the shot into a stronger premium result.',
    isRefinePass
      ? 'You may refine environment, background, lens character, depth, styling, material detail, and realism — but never turn one photo into a layout or add new subjects that hide the hero product/face.'
      : 'You may improve the surrounding world aggressively: environment, background, supporting people when requested, camera angle, lens language, depth, lighting, styling, wardrobe, atmosphere, anatomy cleanup, material detail, realism, and production design.',
    'Do not make the result feel like the same face/product pasted into a random AI background. Make it feel like the same identity belongs naturally inside a better world.',
    actionRule,
    buildQualityDirectives(mode),
    retryRule,
    `Creative brief to fulfill: ${creativeBrief}`,
  ].filter(Boolean);

  if (normalizedSubject === 'product') {
    return [
      'Preserve the exact same product identity: silhouette, proportions, logo/text placement, label geometry, color blocking, materials, controls/buttons, ports, seams, stitching, hardware, markings, texture, packaging shape, and all identifying details.',
      'Do not replace the product with a generic object, redesign it, simplify it, hide its logo/strongest identifying marks, crop it badly, or let hands/environment dominate it.',
      'Prefer a clean standalone hero product photograph. Do not add hands, grips, or usage scenes unless the creative brief explicitly requires natural product handling.',
      ...sharedShotUpgrade,
      'The product must remain sharp, dominant, unobstructed, commercially desirable, and unmistakably the same item in one photograph.',
    ].join(' ');
  }

  if (normalizedSubject === 'animal') {
    return [
      'Preserve the exact same animal identity: species, face shape, markings, fur/skin pattern, eye color, body proportions, and distinctive features.',
      'Do not change species, markings, anatomy, age impression, or defining character.',
      ...sharedShotUpgrade,
    ].join(' ');
  }

  return [
    strictIdentity
      ? 'Preserve the exact same real person: facial structure, eyes, nose, mouth, jawline, skin character, age impression, hair identity, expression logic, and overall recognizability.'
      : 'Preserve the same subject identity and defining features.',
    'Do not output a generic substitute face, face drift, age/gender change, plastic skin, warped anatomy, duplicated limbs, bad hands, heavy face occlusion, or a low-effort dead background.',
    ...sharedShotUpgrade,
    'The face must remain large enough, sharp enough, natural enough, and faithful enough that this reads as the same digital twin in a better shot.',
  ].join(' ');
};

export const buildSceneDirectorGuidance = (subjectType?: unknown, target: GenerationTarget = 'image') => {
  const normalizedSubject = normalizePersonaSubjectType(subjectType) || 'human';
  const identityRule =
    normalizedSubject === 'product'
      ? 'For product personas, product identity is mandatory: preserve silhouette, logo/text placement, materials, colors, labels, controls, seams, and identifying marks.'
      : normalizedSubject === 'animal'
        ? 'For animal personas, preserve species, markings, anatomy, eye color, and distinctive features.'
        : 'For human personas, preserve recognizability: face visibility, facial proportions, eye/nose/mouth/jaw structure, hair identity, and natural skin character.';

  return [
    'Act as a premium creative director, cinematographer, and production designer.',
    'Do not merely restate the user prompt. Infer the strongest setting, camera language, framing, lighting, styling, environment, atmosphere, and commercial/editorial/cinematic aesthetic.',
    SINGLE_PHOTOGRAPH_RULES,
    normalizedSubject === 'product'
      ? 'For product ads, translate campaign language into ONE hero product photograph — not a collage, grid, or layout with multiple panels. Marketing slogans belong in voiceover/post-production, not painted into the image unless the user explicitly asked for visible text.'
      : '',
    'LoRA/reference identity is the source of truth for the subject only; composition and world-building may be improved.',
    identityRule,
    target === 'video-anchor'
      ? 'The image prompt must produce a polished video starting frame that already looks production-ready before motion begins.'
      : target === 'auto-editor-scene'
        ? 'Each scene should evolve the campaign while preserving identity continuity and avoiding repetitive composition.'
        : 'The image prompt should produce a finished premium still, not a raw model test.',
    'Identity is sacred. Composition is negotiable. Protect the subject. Upgrade the shot.',
  ].filter(Boolean).join(' ');
};

export const buildAutoEditorContinuityRule = (subjectType?: unknown) => {
  const normalizedSubject = normalizePersonaSubjectType(subjectType) || 'human';
  const lock =
    normalizedSubject === 'product'
      ? 'Preserve the exact same product; evolve the scene, action, lighting, and camera without redesigning or replacing it.'
      : 'Preserve the exact same digital twin/persona; evolve the scene, action, lighting, styling, and camera without face drift.';
  return [
    lock,
    'Do not rigidly freeze the previous frame composition. Continue from it as continuity context, then upgrade the next shot into a stronger campaign moment.',
    'Avoid low-quality chained-frame degradation: no generic background, weak staging, identity drift, broken anatomy, bad hands, warped product, or muddy lighting.',
  ].join(' ');
};

export const decideRefinementOutput = ({
  baseUrl,
  refinedUrl,
  hadRuntimeError = false,
}: {
  baseUrl?: string;
  refinedUrl?: string;
  hadRuntimeError?: boolean;
}): RefinementDecision => {
  if (!refinedUrl) {
    return {
      useRefined: false,
      shouldRetry: !hadRuntimeError,
      reason: hadRuntimeError ? 'refiner_failed' : 'refiner_returned_no_image',
    };
  }
  if (!baseUrl) {
    return { useRefined: true, shouldRetry: false, reason: 'no_base_comparison_available' };
  }
  if (refinedUrl === baseUrl) {
    return { useRefined: false, shouldRetry: true, reason: 'refiner_returned_base_image' };
  }
  return { useRefined: true, shouldRetry: false, reason: 'refined_candidate_available' };
};
