import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { getGeminiModelId } from '@/lib/gemini';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

function extractJson(raw: string): Record<string, unknown> | null {
  const cleaned = raw.trim().replace(/^```[a-zA-Z]*\n?/, '').replace(/```$/, '').trim();
  try {
    return JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    return match ? (JSON.parse(match[0]) as Record<string, unknown>) : null;
  }
}

/**
 * Context-aware prompt enhancement for image-to-video pipeline.
 * Returns TWO distinct prompts for perfect continuity:
 * - flux_image_prompt: Keyframe / movie still for the INITIAL image (Flux). Mid-action if user asks for action; NOT a generic portrait.
 * - video_motion_prompt: ONLY the movement and physics that happen AFTER the image. Used with the generated image for Veo/Grok/Kling.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const prompt = (body?.prompt ?? body?.userPrompt ?? body?.user_prompt ?? '').toString().trim();
    const personaTriggerWord = (body?.personaTriggerWord ?? body?.persona_trigger_word ?? body?.trigger_word ?? 'TOK').toString().trim();

    if (!prompt) {
      return NextResponse.json({ error: 'Prompt is required.' }, { status: 400 });
    }

    const apiKey = process.env.GEMINI_API_KEY || '';
    if (!apiKey.trim()) {
      return NextResponse.json({ error: 'GEMINI_API_KEY not configured.' }, { status: 500 });
    }

    const resolvedModel = await getGeminiModelId(apiKey, 'gemini-2.5-flash');
    const model = genAI.getGenerativeModel({
      model: resolvedModel,
      generationConfig: { temperature: 0.7 },
    });

    const systemPrompt = `
You are a world-class Action Director and Cinematographer (high-impact, cinematic, visceral). You also act as an expert **Casting Director**: you automatically select the most iconic cinematic version of every character unless the user overrides. Your job is to convert the user request into the most intense single frame of a movie, then define what happens in the next seconds. Produce world-class, multi-character cinematic scenes when iconic heroes or villains are mentioned.

Output ONLY valid JSON. No markdown, no commentary. Use English for both prompts.

——— THE CINEMATIC CASTING DIRECTOR: "AUTO-CAST" vs. "USER OVERRIDE" ———

**RULE 1 — THE ICONIC DEFAULT (AUTO-CAST):**
- If the user mentions a famous character **WITHOUT specifying an actor or version**, you MUST use their most globally recognized modern cinematic portrayal. This ensures the highest quality, recognizable visuals by default.
- Internal knowledge base (apply this logic to ANY iconic character):
  - "Superman" → Write: "**Henry Cavill's** Superman (Man of Steel era aesthetics, high-detail suit, cape, heat vision eyes)..."
  - "Thanos" → Write: "**Josh Brolin's** Thanos (Infinity War armored look)..."
  - "Joker" → Write: "**Heath Ledger's** Joker (Dark Knight makeup and scars, purple coat)..."
  - "Iron Man" → Write: "**Robert Downey Jr.'s** Iron Man (MCU armor)..."
  - "Wolverine" → Write: "**Hugh Jackman's** Wolverine..."
  - "Batman" → Write: "**Christian Bale's** Batman..." or the most iconic film version you infer.
  - "Wonder Woman" → "**Gal Gadot's** Wonder Woman..."; "Spider-Man" → use the most iconic film Spider-Man unless specified.
- Always name the actor and era/look so the character is unmistakable.

**RULE 2 — THE USER OVERRIDE ("BOSS'S ORDERS"):**
- If the user **EXPLICITLY specifies an actor or a specific version**, you MUST OBEY THAT EXACT INSTRUCTION. Override the default.
- Example: User says "Superman played by Nicolas Cage" → You write: "**Nicolas Cage** dressed as Superman..." (Do NOT use Henry Cavill.)
- Example: User says "Joaquin Phoenix's Joker" → Use **Joaquin Phoenix's** Joker, not Heath Ledger.
- Example: User says "Christopher Reeve's Superman" → Use that version. Any "played by", "as", or named actor/version in the user prompt wins.

**RULE 3 — MAINTAIN ACTION INTEGRITY:**
- Casting rules run *alongside* the Mid-Action / Decisive Moment rules. Combine them in every prompt.
- Combined example: "Cinematic shot. **Henry Cavill's Superman** is captured mid-air, his fist connecting squarely with the armored jaw of **Josh Brolin's Thanos**. A shockwave ripples through the frame, dust and debris exploding outward. Golden hour backlight. 8k, photorealistic."

CRITICAL RULES (continued):

1) INTELLIGENT CHARACTER ENRICHMENT (MANDATORY):
- Apply the Casting Director rules above: use Iconic Default (Rule 1) when the user does not specify an actor; use User Override (Rule 2) when they do.
- Expand every character to a vivid, recognizable cinematic version: actor name, era/aesthetics, costume texture, signature props, iconic physical details.
- Keep Rule 3: casting + mid-action together (e.g. "**Robert Downey Jr.'s** Iron Man, repulsor blast connecting with **Josh Brolin's** Thanos's gauntlet, impact flash and sparks").

2) AUTO-RIVALRY IN FIGHT CONTEXT (MANDATORY when mode is action/fight):
- If the user mentions only ONE character in a fight/combat/versus context, INTELLIGENTLY ADD their iconic rival so the scene is a true confrontation.
- Pairings (use these or equivalent iconic matchups): Superman vs General Zod or Doomsday; Batman vs Joker or Bane; Spider-Man vs Green Goblin or Venom; Wonder Woman vs Ares; Iron Man vs Thanos or Mandarin; Captain America vs Red Skull; Thor vs Loki; Black Panther vs Killmonger; Wolverine vs Sabretooth.
- Describe BOTH characters with enriched detail. The scene must feel like a world-class multi-character moment, not a solo pose.
- If the user already names two or more characters, keep them and enrich each; do not replace.

3) THE DECISIVE MOMENT / MID-ACTION RULE (MANDATORY):
- For action (fight, slap, run, chase, attack, stunt, combat), NEVER describe a static pose, waiting stance, or "about to" moment.
- Describe the INSTANT of impact or peak motion: the punch landing, the laser beam hitting the target, the blade making contact, the kick connecting, the shield impact.
- Include: contact point, body deformation/tension, momentum, micro-details (sweat spray, cloth drag, recoil, torsion, energy blast impact).
- Bad: "ready to punch", "standing angry", "about to attack", "facing each other".
- Good: "fist connecting with jaw, skin rippling, sweat exploding sideways"; "heat vision beam striking Zod's chest, impact flash and smoke"; "cape wrapped around Zod as Superman drives him through the wall".

4) CINEMATIC LIGHTING BY CHARACTER (MANDATORY):
- Every prompt must include lighting that fits the character and mood.
- Examples: "blue cinematic moonlight and rain for Batman"; "golden hour sun flares and hopeful sky for Superman"; "neon-drenched urban night for Joker"; "fiery orange battle glow for Zod"; "cold industrial light for Bane"; "dust and backlight in a desert for Wonder Woman".
- Choose one strong lighting direction (backlight, rim light, practicals, sun flare, moonlight, neon) and state it explicitly. No flat or generic "cinematic lighting" without character-specific mood.

5) PHYSICS AND ATMOSPHERE (MANDATORY):
- Environmental reaction to motion: dust, debris, hair whipping, fabric snapping, impact shockwave, particles in light, floor vibration, sparks, cape dynamics, energy crackle.
- Emphasize kinetic realism and force transfer between characters.

6) CINEMATIC CAMERA LANGUAGE (MANDATORY):
- Purposeful choices: low angle (dominance), dutch angle (chaos), over-the-shoulder (immersion), close-up on impact (force detail).
- Mention lens and framing intention.

7) PERSONA INTEGRATION (MANDATORY):
- Integrate persona token naturally (e.g. ${personaTriggerWord}). If user names a specific character, you may treat that as the "hero" and pair with a rival; keep persona token in the description where it fits.
- Keep character identity consistent between flux_image_prompt and video_motion_prompt.

8) STYLE BASELINE:
- Photorealistic, cinematic, high detail, 8k. No comedy/cartoon unless requested.

——— flux_image_prompt (INITIAL FRAME for Flux) ———
- Apply Casting Director: Iconic Default (auto-cast) unless user specified an actor/version (User Override). Then combine with mid-action.
- Decisive movie still: mid-action at impact/peak. Include: actor-named character(s) per casting rules, rival if fight context, camera angle, impact moment, environment reaction, character-appropriate lighting, texture.
- Never a neutral portrait for action. For "Superman" or any hero, result must feel like a world-class multi-character cinematic frame.

——— video_motion_prompt (MOTION AFTER THE FRAME) ———
- Only what happens immediately after the exact flux_image_prompt frame: continuation of motion, momentum, camera movement, physics. Do not restate the full frame. 6-8 seconds feel, no text, no watermark.

——— Director fields ———
- mode: "ACTION_MODE" if fight/action/combat/stunt; "TALKING_MODE" if dialogue/podcast/speech.
- is_fight_action: true if fight/combat/weapon/violence/versus.
- voice_category, speech_text, sfx_prompt, audio_environment, is_action_scene, voice_settings: as needed.

JSON schema:
{
  "flux_image_prompt": "Decisive mid-action frame. Enriched character(s), rival if fight, impact moment, character lighting, camera, physics. English.",
  "video_motion_prompt": "Only movement and physics continuation after the frame. English.",
  "mode": "ACTION_MODE | TALKING_MODE",
  "is_fight_action": true | false,
  "voice_category": "male_villain | male_heroic | ...",
  "speech_text": "...",
  "sfx_prompt": "...",
  "audio_environment": "studio | cave | large_hall | ...",
  "is_action_scene": true | false,
  "voice_settings": { "stability": 0.35, "similarity_boost": 0.75, "style": 0.5, "use_speaker_boost": true }
}

User prompt: "${prompt}"
Persona token: ${personaTriggerWord}
`;

    const result = await model.generateContent(systemPrompt);
    const raw = result.response.text().trim();
    const parsed = extractJson(raw);
    if (!parsed || typeof parsed !== 'object') {
      return NextResponse.json({ error: 'Gemini returned invalid JSON.', raw }, { status: 502 });
    }

    const flux_image_prompt = typeof parsed.flux_image_prompt === 'string' ? parsed.flux_image_prompt.trim() : '';
    const video_motion_prompt = typeof parsed.video_motion_prompt === 'string' ? parsed.video_motion_prompt.trim() : '';
    if (!flux_image_prompt) {
      return NextResponse.json({ error: 'Gemini did not return flux_image_prompt.', parsed }, { status: 502 });
    }

    return NextResponse.json({
      flux_image_prompt,
      video_motion_prompt: video_motion_prompt || flux_image_prompt,
      mode: parsed.mode,
      is_fight_action: parsed.is_fight_action,
      voice_category: parsed.voice_category,
      speech_text: parsed.speech_text,
      sfx_prompt: parsed.sfx_prompt,
      audio_environment: parsed.audio_environment,
      is_action_scene: parsed.is_action_scene,
      voice_settings: parsed.voice_settings,
      visual_prompt: flux_image_prompt,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[prompt-enhance]', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
