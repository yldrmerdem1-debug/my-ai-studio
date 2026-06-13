import { GoogleGenerativeAI } from '@google/generative-ai';
import { translate } from '@vitalets/google-translate-api';

import { getGeminiModelId, GEMINI_MODEL_ID } from '@/lib/gemini';

export const KLING_HOLLYWOOD_SYSTEM_PROMPT = [
  "You are an elite Hollywood cinematographer. Your job is to enhance the user's prompt into a highly detailed, cinematic English prompt for an AI video generator.",
  '',
  'CRITICAL RULES:',
  "1. RESPECT THE SETTING: DO NOT invent massive or epic backgrounds if the user asked for a small, intimate, or specific setting (e.g., a cafe, an elevator, a simple room). Enhance the VIBE, LIGHTING, and TEXTURE of the user's exact concept, do not change the scale of their environment.",
  '2. CINEMATOGRAPHY: Always inject high-end camera and lighting terms appropriate for the scene (e.g., volumetric lighting, 35mm lens, photorealistic, 8k resolution, cinematic color grading, cinematic film still).',
  '',
  'ANTI-CGI & PURE LIVE-ACTION RULE:',
  "ANTI-CGI RULE: Whenever the user asks for action, fighting, or fantasy elements, you MUST explicitly enforce a 'Live-Action Movie' aesthetic.",
  "- EXPLICITLY FORBID terms like 'CGI, 3D render, Unreal Engine, comic book, illustration, animated, cartoon, plastic skin'.",
  "- FORCE terms like 'Raw live-action photography, shot on ARRI Alexa 65, photorealistic skin texture, visible microscopic pores, actual human skin, cinematic film still, ultra-realistic'.",
  "This ensures the persona's face remains 100% human and realistic, not like a video game character.",
  '',
  "CRITICAL GENDER RULE: You will be provided with the user's gender. You MUST explicitly use gender-specific nouns and pronouns throughout the entire enhanced prompt.",
  "- If gender is 'male', you MUST use words like 'a man', 'a male character', 'he', 'his'. DO NOT use gender-neutral terms like 'a person' or 'a character'.",
  "- If gender is 'female', you MUST use words like 'a woman', 'a female character', 'she', 'her'.",
  "This is absolutely critical to prevent the image generation model from altering the user's actual gender.",
  '',
  'IF HAS_PERSONA IS TRUE:',
  "CRITICAL IDENTITY LOCK: The user's persona face MUST be the primary focal point of the image and the resemblance to the trained persona MUST be 100% identical. The facial structure, unique features, bone structure, and eyes must be a perfect match. Prioritize perfect likeness above all other artistic or cinematic details. If the likeness is not perfect, the image is a failure.",
  'CRITICAL CINEMATIC FACE PRIORITY RULE (FLUX OPTIMIZED): These rules override all other stylistic instructions when persona is active.',
  '',
  'STRUCTURAL PRIORITY TRICK (MANDATORY ORDER): FLUX uses the first paragraph as the composition reference.',
  '- You MUST NOT start the prompt with the environment, setting, or scene description. NEVER open with “A businessman walking…”, “In a city…”, etc.',
  '- The FIRST paragraph MUST start with the PERSONA + FACE DOMINANCE statement (portrait-first).',
  '- Then follow this strict order: Persona description → Face dominance rule → Camera rule → Environment → Mood.',
  '- Use directive language heavily (MUST, STRICTLY, OVERRIDE, MANDATORY) to enforce composition.',
  '',
  '1. FRAMING (MANDATORY):',
  '- The shot MUST be a medium close-up or chest-up framing.',
  '- The subject MUST be centered.',
  '- The face MUST clearly occupy approximately 35–45% of the frame.',
  '- NO wide shots. NO full body framing. NO distant subject composition.',
  '',
  '2. LENS & DEPTH:',
  '- Simulate an 85mm portrait lens with f/1.8 aperture.',
  '- Use shallow depth of field.',
  '- The background MUST remain recognizable but softly blurred.',
  '- The face MUST be tack sharp and dominant.',
  '',
  '3. FACE DOMINANCE:',
  '- The face is the absolute primary subject of the image.',
  '- Facial details MUST be extremely sharp and highly realistic.',
  '- Natural skin texture MUST be visible (pores, micro-texture).',
  '- Eyes MUST be crisp and clearly defined.',
  '- Strong but natural jawline definition.',
  '',
  '4. VIDEO STABILITY OPTIMIZATION:',
  '- Lighting MUST be symmetrical and balanced across the face.',
  '- NO heavy shadows covering key facial features.',
  '- Ultra clean render quality.',
  '- NO motion blur. NO distortion. NO exaggerated perspective.',
  '- Add: consistent facial structure, stable facial geometry, clean facial edges, controlled lighting gradients, minimal background detail noise.',
  '',
  '5. PROFESSIONAL CINEMATIC STANDARD:',
  '- Eye-level camera ONLY.',
  '- NO extreme angles.',
  '- Natural proportions.',
  '- High-end editorial photography aesthetic.',
  '- Golden hour or soft directional lighting preferred.',
  '',
  "- The character's face MUST be the focal point.",
  "- Use terms like 'Medium Close-Up', 'Chest-up framing', or 'Cowboy shot' to ensure the face, microscopic skin texture, and expressions are crystal clear. Do not use wide shots that make the face tiny.",
  "- CRITICAL: The environmental lighting MUST realistically reflect on the character's face (e.g., if they are in a neon room, cast neon rim-light on their skin; if by a fire, cast warm orange light).",
  '',
  'CRITICAL REALISM RULES:',
  "1. RAW PHOTOGRAPHY: In the FIRST paragraph (which must start with the persona face), you MUST include terms like 'A candid, raw photograph shot on 35mm film...' or 'Unretouched analog photo...'.",
  "2. TEXTURE & VIBE: Explicitly demand 'visible film grain, Kodak Portra 400, natural lighting, microscopic skin pores, subtle sweat, imperfect realism'. Absolutely NO plastic, airbrushed, or 3D-rendered looking skin.",
  "3. LIGHTING INTEGRATION: The environment's lighting MUST interact with the persona's skin (e.g., neon rim light, warm fire glow) to ground them in the scene.",
  '',
  'CRITICAL VFX RULES FOR PERSONA INTEGRATION:',
  "1. LIGHTING BAKE: The environment's specific lighting MUST realistically hit the persona. (e.g., if it's a neon cyberpunk city, cast dramatic blue/purple neon rim light and key light on their face and clothes. If it's sunset, cast warm orange light. Their skin must reflect the scene's colors).",
  "2. PHYSICAL INTERACTION: The persona's hair and clothing MUST interact with the scene's physics (wind, rain, snow, gravity). They must cast realistic shadows and be rooted in the ground, not floating.",
  "3. TEXTURE BLENDING: The persona's skin and face texture MUST be microscopic, raw, and realistic (sweat, pores, dirt, rain droplets) to match the high-fidelity 8k texture of the environment. No fake airbrushed skin.",
  '',
  'IF HAS_PERSONA IS FALSE:',
  "- You have total freedom over the camera distance (wide shots, extreme wide shots are allowed) as long as it fits the user's requested setting.",
  '',
  'Output ONLY the enhanced English prompt. No explanations, no markdown, no quotes.',
].join('\n');

export const KLING_PREACTION_IMAGE_SYSTEM_PROMPT = [
  'You are an elite Hollywood cinematographer and AI Image Prompt Expert setting up the PERFECT FIRST FRAME for an AI Video.',
  'The user will give you an action (e.g., "a man diving into water").',
  'Your CRITICAL rule: Do NOT describe the action already happening. Describe the moment RIGHT BEFORE the action (Anticipation).',
  'Example: If user says "jumping", describe the character crouched, muscles tense, ready to leap. If "diving", describe them on the edge of the board, leaning forward.',
  '',
  'You MUST include:',
  '1. The PRE-ACTION pose (tense, ready, anticipation).',
  '2. Hollywood Camera angle (e.g., Low angle, extreme close-up, Dutch angle).',
  '3. Lens & Depth (e.g., 35mm anamorphic, f/1.8 shallow depth of field, bokeh).',
  '4. Lighting (e.g., Volumetric fog, rim lighting, cinematic shadows).',
  '5. High fidelity keywords (8k, hyper-realistic, highly detailed).',
  '',
  'Output ONLY the English prompt for the image generator (like Flux). No explanations.',
].join('\n');

const PERSONA_IDENTITY_LOCK_BLOCK =
  'identity preservation priority, identical facial structure across all scenes, stable bone structure, consistent facial geometry, no age shift, no alteration of identity, ultra high facial clarity.';

const PERSONA_FACE_DOMINANCE_BLOCK =
  "The face is the absolute primary focus of the image. The viewer's attention must be instantly drawn to the face. Extremely sharp facial details, crisp detailed eyes, strong natural jawline definition, realistic skin micro-texture, high-end editorial portrait quality, dominant presence.";

const PERSONA_CINEMATIC_CAMERA_LOCK_BLOCK =
  'Medium close-up shot, chest-up framing, face occupies approximately 40% of the frame, eye-level camera, 85mm lens, f/1.8 aperture, shallow depth of field, symmetrical face lighting, ultra clean render, natural proportions, no distortion, no extreme angles, no heavy shadows over the face.';

const KLING_PERSONA_SCENE_ONLY_SYSTEM_PROMPT = [
  "You are an elite Hollywood cinematographer. Your job is to enhance the user's SCENE description into a highly detailed, cinematic English SCENE description for an AI image/video generator.",
  '',
  'CRITICAL:',
  '- Output ONLY the enhanced SCENE description in English. No headings, no labels, no quotes, no markdown.',
  '- DO NOT include any persona token or any identity/face/camera lock blocks. Those are added separately.',
  '- DO NOT use mathematical weighting syntax like (face:1.4).',
  '- DO NOT output a negative prompt.',
  '',
  'RESPECT THE SETTING: Do not change the scale of the environment. Enhance vibe, lighting, texture, and cinematic detail while preserving the user’s exact setting and concept.',
  '',
  "CRITICAL GENDER RULE: You will be provided with the user's gender. You MUST explicitly use gender-specific nouns and pronouns throughout the entire SCENE description.",
  "- If gender is 'male', use 'a man', 'he', 'his' (avoid gender-neutral terms).",
  "- If gender is 'female', use 'a woman', 'she', 'her'.",
  '',
  'CINEMATOGRAPHY: Add high-end lighting/camera language that fits the scene (photorealistic, cinematic color grading, naturalistic lighting, shallow depth of field where appropriate).',
].join('\n');

const ANSI = {
  reset: '\x1b[0m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  dim: '\x1b[2m',
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const extractPersonaTokenAndScene = (rawPrompt: string): { token: string; scene: string } => {
  const input = String(rawPrompt || '').trim();
  if (!input) return { token: '', scene: '' };

  const bracketMatch = input.match(/<[^>\n]{3,}>/);
  if (bracketMatch?.[0]) {
    const token = bracketMatch[0].trim();
    const scene = input.replace(token, '').trim();
    return { token, scene };
  }

  const parts = input.split(/\s+/);
  const first = parts[0] || '';
  const token = first.replace(/^[('"`]+|[)"'`,.;:]+$/g, '').trim() || first.trim();
  const scene = input.slice(first.length).trim();
  return { token, scene };
};

const cleanLlmText = (raw: unknown): string => {
  let text = String(raw ?? '').trim();
  // Strip code fences
  text = text.replace(/^```[a-zA-Z0-9_-]*\s*/g, '').replace(/```$/g, '').trim();
  // Strip wrapping quotes (single or double) only if they wrap the whole output
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    text = text.slice(1, -1).trim();
  }
  // Some models might prefix with "Prompt:"; strip a single leading label.
  text = text.replace(/^(prompt|enhanced prompt)\s*:\s*/i, '').trim();
  return text;
};

// --- xAI / Grok helpers ---
type XaiResponsesApi = {
  output_text?: string;
  output?: Array<{
    content?: Array<{ type?: string; text?: string }>;
  }>;
};

type XaiChatCompletionsApi = {
  choices?: Array<{ message?: { content?: string } }>;
};

const extractXaiText = (payload: any): string => {
  const direct = String(payload?.output_text || '').trim();
  if (direct) return direct;

  const output = payload?.output;
  if (Array.isArray(output)) {
    for (const item of output) {
      const content = item?.content;
      if (Array.isArray(content)) {
        for (const c of content) {
          if ((c?.type === 'output_text' || c?.type === 'text') && typeof c?.text === 'string' && c.text.trim()) {
            return c.text.trim();
          }
        }
      }
    }
  }

  const chat = payload as XaiChatCompletionsApi;
  const chatText = String(chat?.choices?.[0]?.message?.content || '').trim();
  if (chatText) return chatText;

  return '';
};

async function callGrokWithTimeout(systemPrompt: string, userPrompt: string, timeoutMs: number): Promise<string> {
  const key = String(process.env.GROK_API_KEY || process.env.XAI_API_KEY || '').trim();
  if (!key) throw new Error('GROK_API_KEY or XAI_API_KEY missing');

  const baseUrl = String(process.env.GROK_API_BASE_URL || process.env.XAI_API_BASE_URL || 'https://api.x.ai/v1').trim().replace(/\/+$/, '');
  const model = String(process.env.GROK_MODEL || 'grok-4-1-fast-non-reasoning').trim();

  const controller = new AbortController();
  const to = setTimeout(() => controller.abort(), timeoutMs);

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${key}`,
  };

  // Prefer Responses API; if it errors in a way that suggests unsupported endpoint, fall back to chat completions.
  const tryResponses = async () => {
    const res = await fetch(`${baseUrl}/responses`, {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        model,
        input: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
    });
    const text = await res.text().catch(() => '');
    if (!res.ok) {
      throw new Error(`xAI /responses failed (${res.status}). ${text.slice(0, 200)}`);
    }
    const json = (text ? JSON.parse(text) : {}) as XaiResponsesApi;
    return extractXaiText(json);
  };

  const tryChatCompletions = async () => {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.7,
      }),
    });
    const text = await res.text().catch(() => '');
    if (!res.ok) {
      throw new Error(`xAI /chat/completions failed (${res.status}). ${text.slice(0, 200)}`);
    }
    const json = (text ? JSON.parse(text) : {}) as XaiChatCompletionsApi;
    return extractXaiText(json);
  };

  try {
    const out = await Promise.race([
      (async () => {
        try {
          return await tryResponses();
        } catch (e: any) {
          const msg = String(e?.message || e || '');
          // If endpoint is not supported or returns 404, try legacy chat completions.
          if (msg.includes('404') || msg.toLowerCase().includes('not found') || msg.includes('/responses')) {
            return await tryChatCompletions();
          }
          // Otherwise still try chat completions as a backup once.
          return await tryChatCompletions();
        }
      })(),
      (async () => {
        await sleep(timeoutMs);
        throw new Error(`Grok timeout after ${Math.round(timeoutMs / 1000)}s`);
      })(),
    ]);
    return cleanLlmText(out);
  } finally {
    clearTimeout(to);
  }
}

// --- Gemini fallback ---
async function callGemini(systemPrompt: string, userPrompt: string): Promise<string> {
  const apiKey = String(process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) throw new Error('GEMINI_API_KEY missing');

  const preferred = String(process.env.GEMINI_MODEL_ID || GEMINI_MODEL_ID || 'gemini-2.5-flash').trim();
  const resolvedModel = await getGeminiModelId(apiKey, preferred);
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: resolvedModel, generationConfig: { temperature: 0.7 } });

  const prompt = [
    'SYSTEM:',
    systemPrompt,
    '',
    'USER:',
    userPrompt,
  ].join('\n');

  const result = await model.generateContent(prompt);
  const text = result.response.text();
  return cleanLlmText(text);
}

async function translateToEnglishBestEffort(text: string): Promise<string> {
  const raw = String(text || '').trim();
  if (!raw) return raw;
  try {
    const translationPromise = translate(raw, { to: 'en' }) as any;
    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Translation timeout')), 3500));
    const result = (await Promise.race([translationPromise, timeoutPromise])) as any;
    const out = String(result?.text || raw).trim();
    return out || raw;
  } catch {
    return raw;
  }
}

/**
 * Grok -> Gemini fallback prompt enhancer for Kling 3.0 Pro.
 */
export async function enhancePromptForVideo(userPrompt: string): Promise<string> {
  return enhancePrompt(userPrompt, false);
}

export async function enhancePrompt(userPrompt: string, hasPersona: boolean, gender?: 'male' | 'female'): Promise<string> {
  const input = String(userPrompt || '').trim();
  if (!input) return '';

  if (hasPersona) {
    const { token, scene } = extractPersonaTokenAndScene(input);
    const safeToken = token || 'TOK';
    const sceneText = scene || input;

    const sceneUserContent = [
      ...(gender ? [`GENDER: ${gender}`] : []),
      sceneText,
    ].join('\n\n');

    // 1) Try Grok (xAI) first for SCENE ONLY
    try {
      console.log(`${ANSI.cyan}🎬 Persona scene zenginleştiriliyor (Grok)...${ANSI.reset}`);
      const out = await callGrokWithTimeout(KLING_PERSONA_SCENE_ONLY_SYSTEM_PROMPT, sceneUserContent, 8_000);
      if (out) {
        console.log(`${ANSI.green}✅ Persona scene hazır (Grok).${ANSI.reset}`);
        return [
          safeToken,
          PERSONA_IDENTITY_LOCK_BLOCK,
          PERSONA_FACE_DOMINANCE_BLOCK,
          PERSONA_CINEMATIC_CAMERA_LOCK_BLOCK,
          out,
        ].filter(Boolean).join('\n\n');
      }
      throw new Error('Empty Grok output');
    } catch (err: any) {
      console.warn(`${ANSI.yellow}⚠️ Grok tıkandı, Gemini devreye giriyor!${ANSI.reset}`, String(err?.message || err));
    }

    // 2) Gemini fallback for SCENE ONLY
    try {
      console.log(`${ANSI.cyan}🎬 Persona scene zenginleştiriliyor (Gemini)...${ANSI.reset}`);
      const out = await callGemini(KLING_PERSONA_SCENE_ONLY_SYSTEM_PROMPT, sceneUserContent);
      if (out) {
        console.log(`${ANSI.green}✅ Persona scene hazır (Gemini).${ANSI.reset}`);
        return [
          safeToken,
          PERSONA_IDENTITY_LOCK_BLOCK,
          PERSONA_FACE_DOMINANCE_BLOCK,
          PERSONA_CINEMATIC_CAMERA_LOCK_BLOCK,
          out,
        ].filter(Boolean).join('\n\n');
      }
      throw new Error('Empty Gemini output');
    } catch (err: any) {
      console.error(`${ANSI.red}❌ Gemini de başarısız oldu.${ANSI.reset}`, String(err?.message || err));
    }

    // 3) Absolute safety: best-effort English translation for SCENE ONLY
    const safeScene = await translateToEnglishBestEffort(sceneText);
    return [
      safeToken,
      PERSONA_IDENTITY_LOCK_BLOCK,
      PERSONA_FACE_DOMINANCE_BLOCK,
      PERSONA_CINEMATIC_CAMERA_LOCK_BLOCK,
      safeScene || sceneText,
    ].filter(Boolean).join('\n\n');
  }

  const userContent = [
    `HAS_PERSONA: ${hasPersona ? 'true' : 'false'}`,
    ...(gender ? [`GENDER: ${gender}`] : []),
    input,
  ].join('\n\n');

  // 1) Try Grok (xAI) first
  try {
    console.log(`${ANSI.cyan}🎬 Prompt zenginleştiriliyor (Grok)...${ANSI.reset}`);
    const out = await callGrokWithTimeout(KLING_HOLLYWOOD_SYSTEM_PROMPT, userContent, 8_000);
    if (out) {
      console.log(`${ANSI.green}✅ Prompt hazır (Grok).${ANSI.reset}`);
      return out;
    }
    throw new Error('Empty Grok output');
  } catch (err: any) {
    console.warn(`${ANSI.yellow}⚠️ Grok tıkandı, Gemini devreye giriyor!${ANSI.reset}`, String(err?.message || err));
  }

  // 2) Gemini fallback
  try {
    console.log(`${ANSI.cyan}🎬 Prompt zenginleştiriliyor (Gemini)...${ANSI.reset}`);
    const out = await callGemini(KLING_HOLLYWOOD_SYSTEM_PROMPT, userContent);
    if (out) {
      console.log(`${ANSI.green}✅ Prompt hazır (Gemini).${ANSI.reset}`);
      return out;
    }
    throw new Error('Empty Gemini output');
  } catch (err: any) {
    console.error(`${ANSI.red}❌ Gemini de başarısız oldu.${ANSI.reset}`, String(err?.message || err));
  }

  // 3) Absolute safety: best-effort English translation, else original
  const safe = await translateToEnglishBestEffort(input);
  return safe || input;
}

/**
 * Grok -> Gemini fallback prompt enhancer for the PERFECT FIRST FRAME (pre-action / anticipation).
 */
export async function enhancePromptForImage(userPrompt: string): Promise<string> {
  const input = String(userPrompt || '').trim();
  if (!input) return '';

  // 1) Try Grok (xAI) first
  try {
    console.log(`${ANSI.cyan}🎬 Image prompt hazırlanıyor (Grok)...${ANSI.reset}`);
    const out = await callGrokWithTimeout(KLING_PREACTION_IMAGE_SYSTEM_PROMPT, input, 8_000);
    if (out) {
      console.log(`${ANSI.green}✅ Image prompt hazır (Grok).${ANSI.reset}`);
      return out;
    }
    throw new Error('Empty Grok output');
  } catch (err: any) {
    console.warn(`${ANSI.yellow}⚠️ Grok tıkandı, Gemini devreye giriyor!${ANSI.reset}`, String(err?.message || err));
  }

  // 2) Gemini fallback
  try {
    console.log(`${ANSI.cyan}🎬 Image prompt hazırlanıyor (Gemini)...${ANSI.reset}`);
    const out = await callGemini(KLING_PREACTION_IMAGE_SYSTEM_PROMPT, input);
    if (out) {
      console.log(`${ANSI.green}✅ Image prompt hazır (Gemini).${ANSI.reset}`);
      return out;
    }
    throw new Error('Empty Gemini output');
  } catch (err: any) {
    console.error(`${ANSI.red}❌ Gemini de başarısız oldu.${ANSI.reset}`, String(err?.message || err));
  }

  // 3) Absolute safety: best-effort English translation, else original
  const safe = await translateToEnglishBestEffort(input);
  return safe || input;
}

