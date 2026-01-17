import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { requirePremium, requirePersonaAccess } from '@/lib/persona-guards';
import type { User } from '@/lib/subscription';

type AdScriptRequest = {
  productDescription: string;
  triggerWord?: string;
  personaMode?: 'generic' | 'persona';
  personaId?: string;
  user?: unknown;
};

const parseUser = (input: unknown): User | null => {
  if (!input || typeof input !== 'object') return null;
  const data = input as Partial<User>;
  return {
    id: typeof data.id === 'string' ? data.id : undefined,
    plan: data.plan === 'free' || data.plan === 'premium' ? data.plan : undefined,
    isPremium: typeof data.isPremium === 'boolean' ? data.isPremium : undefined,
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

    const body = (await request.json()) as AdScriptRequest;
    const productDescription = body?.productDescription?.trim();
    const triggerWord = body?.triggerWord?.trim();
    const personaMode = body?.personaMode === 'persona' || !!triggerWord;
    const personaId = body?.personaId;
    const user = parseUser(body?.user);

    console.log('Ad script request received', { productDescription });

    if (personaMode) {
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

    if (!productDescription) {
      return NextResponse.json({ error: 'productDescription is required' }, { status: 400 });
    }

    const genAI = new GoogleGenerativeAI(apiKey.trim());
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-pro' });

    const personaLine = triggerWord ? `Persona reference: ${triggerWord}` : '';
    const prompt = `You are an expert ad copywriter. Generate a marketing-ready ad script based on the user's request.
Follow the user's instructions exactly, including any requested length, tone, structure, or audience. Do not impose a fixed length.
Do not mention AI.

User request:
${productDescription}
${personaLine}`.trim();

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const script = response.text().trim();

    console.log('Ad script response generated', { script });

    return NextResponse.json({ script });
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
