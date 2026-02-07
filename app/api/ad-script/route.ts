import { NextRequest, NextResponse } from 'next/server';
import { createGeminiModel, getGeminiModelId, resolveGeminiModelId } from '@/lib/gemini';

type AdScriptRequest = {
  productUrl?: string;
  productBrief?: string;
  platform?: string;
  tone?: string;
  duration?: string;
  objective?: string;
  audience?: string;
};

const geminiModelId = resolveGeminiModelId(
  process.env.GEMINI_AD_MODEL_ID || process.env.GEMINI_MODEL_ID,
  'gemini-3-pro-preview'
);

const stripHtml = (html: string) => {
  return html.replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

const extractMeta = (html: string) => {
  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  const descriptionMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["'][^>]*>/i)
    || html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["'][^>]*>/i);
  const title = titleMatch ? titleMatch[1].trim() : '';
  const description = descriptionMatch ? descriptionMatch[1].trim() : '';
  return { title, description };
};

const fetchProductSnapshot = async (productUrl?: string) => {
  if (!productUrl || !/^https?:\/\//i.test(productUrl)) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);
  try {
    const response = await fetch(productUrl, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (AI Director Bot)' },
    });
    if (!response.ok) return null;
    const html = await response.text();
    const meta = extractMeta(html);
    const plain = stripHtml(html).slice(0, 1600);
    return {
      url: productUrl,
      title: meta.title,
      description: meta.description,
      snippet: plain,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
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

    const body = (await request.json()) as AdScriptRequest;
    const productUrl = body?.productUrl?.trim();
    const productBrief = body?.productBrief?.trim();
    const platform = body?.platform?.trim();
    const tone = body?.tone?.trim();
    const duration = body?.duration?.trim();
    const objective = body?.objective?.trim();
    const audience = body?.audience?.trim();

    if (!productBrief && !productUrl) {
      return NextResponse.json({ error: 'productBrief or productUrl is required' }, { status: 400 });
    }

    const resolvedModelId = await getGeminiModelId(apiKey, geminiModelId);
    const model = createGeminiModel(apiKey, resolvedModelId);
    const productSnapshot = await fetchProductSnapshot(productUrl);
    const briefParts = [
      productBrief ? `User brief: ${productBrief}` : null,
      platform ? `Platform: ${platform}` : null,
      tone ? `Tone: ${tone}` : null,
      duration ? `Target duration: ${duration}` : null,
      objective ? `Objective: ${objective}` : null,
      audience ? `Audience: ${audience}` : null,
    ].filter(Boolean) as string[];
    const urlContext = productSnapshot
      ? `Product URL context:\nTitle: ${productSnapshot.title}\nDescription: ${productSnapshot.description}\nSnippet: ${productSnapshot.snippet}`
      : productUrl
        ? `Product URL provided: ${productUrl} (unable to fetch details)`
        : '';

    const directorPrompt = `
You are an AI creative director. Build 3 distinct ad scenarios based on the input.
Each scenario must include a short hook, a strategic angle, and a production plan.
Return ONLY valid JSON with this shape:
{
  "scenarios": [
    {
      "title": "Short scenario name",
      "hook": "1 sentence hook",
      "angle": "What makes this angle work",
      "plan": {
        "visual_prompt": "English prompt for Flux/Kling",
        "audio_script": "Spoken script in the same language as the user brief",
        "voice_emotion": "ElevenLabs emotion notes",
        "sfx_prompt": "AudioLDM SFX prompt",
        "camera_movement": "Camera movement notes"
      }
    }
  ],
  "recommendation": "Which scenario is best and why"
}
Rules:
- 3 scenarios, each with a different angle (social proof, problem-solution, product demo, etc.).
- Visual prompts must be in English and cinematic.
- Audio script should match the user's language (if Turkish, respond in Turkish).
- Avoid mentioning AI or system details.
Input:
${briefParts.join('\n')}
${urlContext}
    `.trim();

    const result = await model.generateContent(directorPrompt);
    const response = await result.response;
    const raw = response.text().trim();
    const parsed = extractDirectorJson(raw);
    if (!parsed) {
      return NextResponse.json({ error: 'Failed to parse director plan' }, { status: 500 });
    }

    return NextResponse.json(parsed);
  } catch (error: any) {
    console.error('Ad script generation error:', error);
    return NextResponse.json(
      {
        error: error.message || 'Failed to generate ad script',
        details: error.toString(),
      },
      { status: 500 },
    );
  }
}
