import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

async function getGeminiPrompt(userInput: string, triggerWord: string): Promise<string> {
  const modelId = process.env.GEMINI_MODEL_ID || 'gemini-2.5-flash';
  const model = genAI.getGenerativeModel({ model: modelId });

  const outputFormat = triggerWord
    ? `${triggerWord}, [Action Description], [Lighting & Atmosphere], [Camera Details]`
    : '[Action Description], [Lighting & Atmosphere], [Camera Details]';
  const systemPrompt = `
      You are a World-Class Commercial & Film Director AI.
      
      YOUR MISSION:
      Analyze the user's simple Turkish input and generate a specific, high-end visual prompt for Flux.
      You must determine the "Genre" (Action, Commercial, Portrait, Lifestyle) and apply the correct visual style.

      INPUT: "${userInput}"
      TRIGGER WORD: "${triggerWord}"

      STEP 1: ANALYZE THE INTENT
      - Is it a product interaction (e.g., holding a camera, drinking coffee)? -> Treat as HIGH-END COMMERCIAL.
      - Is it high energy (e.g., running, fighting)? -> Treat as ACTION MOVIE.
      - Is it posing/standing? -> Treat as FASHION/EDITORIAL.

      STEP 2: APPLY VISUAL RULES (STRICT)
      - **Commercial/Product:** Use "studio lighting, softbox, sharp focus on subject, commercial aesthetic, ultra-clean, 8k, advertising photography style".
      - **Action:** Use "dynamic motion blur, dutch angle, dramatic contrast, cinematic color grading, gritty texture".
      - **Fashion/Cool:** Use "depth of field, bokeh, golden hour, rim lighting, confident expression, editorial look".

      STEP 3: TRANSLATE ACTION
      - "Kamera tanıtıyor" -> "holding a professional camera closer to lens, focus on camera and face, studio product shot lighting"
      - "Yürüyor" -> "walking confidently like a runway model, street fashion style"
      - NO "a person" or "a man".${triggerWord ? ` The subject IS "${triggerWord}".` : ''}

      OUTPUT FORMAT:
      ${outputFormat}
    `;

  const result = await model.generateContent(systemPrompt);
  const response = await result.response;
  let enhancedPrompt = response.text().replace(/^"|"$/g, '').trim();

  if (triggerWord && !enhancedPrompt.includes(triggerWord)) {
    enhancedPrompt = `${triggerWord}, ${enhancedPrompt}`;
  }

  return enhancedPrompt;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const userInput = typeof body?.userInput === 'string' ? body.userInput : '';
    const triggerWord = typeof body?.triggerWord === 'string' ? body.triggerWord : '';
    if (!userInput.trim()) {
      return NextResponse.json({ error: 'userInput is required' }, { status: 400 });
    }
    const prompt = await getGeminiPrompt(userInput, triggerWord);
    return NextResponse.json({ prompt });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Gemini test failed' },
      { status: 500 }
    );
  }
}
