// ROUTING ANAYASA (FINAL)
// 1) voice_id varsa -> KLING + ELEVENLABS
// 2) voice_id yoksa ve fight/action varsa -> GROK
// 3) aksi -> VEO 3.1
// Not: Veo fail -> soften retry + optional REPLICATE_VEO_FALLBACK_MODEL (mevcut kalsın)

export type Provider = 'KLING_ELEVEN' | 'VEO' | 'GROK';

const FIGHT_ACTION_PATTERNS: RegExp[] = [
  /\b(fight|fighting|brawl|combat|duel|battle|boxing|mma|wrestling|sparring)\b/i,
  /\b(punch|punching|kick|kicking|strike|striking|hit|hitting|slam|smash|knockout)\b/i,
  /\b(stunt|choreography|martial arts|karate|taekwondo|judo|muay thai)\b/i,
  /\b(attack|counterattack|finisher|takedown|uppercut|roundhouse)\b/i,
  /\b(explosion|impact|kinetic|motion blur|high contrast action)\b/i,
  // TR keywords
  /\b(kavga|dövüş|dovus|vuruş|vurmak|yumruk|tekme|saldırı|çatışma|mücadele|mucadele)\b/i,
];

export function containsFightAction(text: string): boolean {
  return FIGHT_ACTION_PATTERNS.some((r) => r.test(text));
}

export function routeRequest(input: {
  prompt: string;
  voice_id?: string | null;
}): { provider: Provider; prompt: string; reason: string } {
  const { prompt, voice_id } = input;

  if (voice_id) {
    return { provider: 'KLING_ELEVEN', prompt, reason: 'voice_id gate' };
  }

  if (containsFightAction(prompt)) {
    return { provider: 'GROK', prompt, reason: 'fight/action detected → Grok' };
  }

  return { provider: 'VEO', prompt, reason: 'default → Veo 3.1' };
}
