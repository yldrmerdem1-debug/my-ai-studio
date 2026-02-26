/**
 * Flux image prompt logic for ACTION_MODE / HARDCORE_MODE.
 * Ensures reference images are wide, dynamic, and interaction-focused (not static portraits).
 * Flux does not support negative prompts; we use positive phrasing to steer away from portrait/close-up.
 */

/** Prefix to force wide shot for action scenes. */
export const FLUX_ACTION_WIDE_PREFIX =
  'Wide angle full body shot, ';

/**
 * Suffix to ban portrait/close-up/static (Flux has no negative_prompt; we describe desired look).
 * Result: image should look like a movie screenshot with interaction visible.
 */
export const FLUX_ACTION_NO_PORTRAIT_SUFFIX =
  ', cinematic action frame, dynamic composition, interaction visible in frame, no close-up, no portrait, no headshot, no static pose, like a screenshot from a movie';

const ACTION_KEYWORDS = /\b(fight|fighting|punch|punching|attack|attacking|blood|combat|stab|stabbing|hit|hitting|weapon|kick|kicking|action|battle|war|dövüş|savaş|yumruk|kan|silah|vuruş|aksiyon)\b/i;

/** Returns true if the prompt suggests action/violence (so we should use wide shot + no portrait). */
export function isActionLikePrompt(text: string): boolean {
  return ACTION_KEYWORDS.test(text || '');
}

/**
 * Builds the Flux prompt for action mode: wide shot prefix + prompt + opponent/context + no-portrait suffix.
 * Use when ACTION_MODE or HARDCORE_MODE is active or when isActionLikePrompt(prompt) is true.
 */
export function buildFluxActionPrompt(
  prompt: string,
  options?: { triggerWord?: string; opponentOrContext?: string }
): string {
  const base = prompt.trim();
  const withPrefix = base.toLowerCase().startsWith('wide angle') || base.toLowerCase().startsWith('wide shot')
    ? base
    : `${FLUX_ACTION_WIDE_PREFIX}${base}`;
  const withContext = options?.opponentOrContext
    ? `${withPrefix}, ${options.opponentOrContext} visible in frame`
    : withPrefix;
  return `${withContext}${FLUX_ACTION_NO_PORTRAIT_SUFFIX}`.trim();
}
