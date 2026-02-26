import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { getGeminiModelId } from '@/lib/gemini';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { prompt } = body;

    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      return NextResponse.json(
        { error: 'Prompt is required' },
        { status: 400 }
      );
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || !apiKey.trim()) {
      return NextResponse.json(
        { error: 'GEMINI_API_KEY not configured' },
        { status: 500 }
      );
    }

    const resolvedModelId = await getGeminiModelId(apiKey, 'gemini-2.5-flash');
    const model = genAI.getGenerativeModel({
      model: resolvedModelId,
      generationConfig: { temperature: 0.3 },
    });

    const detectionPrompt = `
Analyze the following video prompt and extract ALL character names mentioned.

Rules:
1. Extract character names (superheroes, fictional characters, real people, etc.)
2. If characters are fighting or interacting (e.g., "Superman vs Thor", "Batman fights Joker"), extract both
3. Include character names even if they're mentioned indirectly (e.g., "Man of Steel" → "Superman")
4. Return ONLY a JSON array of character names in English
5. Use proper capitalization (e.g., "Superman", "Iron Man", "Wonder Woman")
6. If no characters are detected, return an empty array []

Examples:
- "Superman vs Thor" → ["Superman", "Thor"]
- "Batman fights Joker in Gotham" → ["Batman", "Joker"]
- "Henry Cavill as Superman" → ["Superman"]
- "A man walks in the city" → []

Prompt: "${prompt.trim()}"

Return ONLY valid JSON array:
`;

    const result = await model.generateContent(detectionPrompt);
    const raw = result.response.text().trim();
    
    // Extract JSON from response (handle markdown code blocks)
    let jsonStr = raw;
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      jsonStr = jsonMatch[0];
    }
    
    // Remove markdown code blocks if present
    jsonStr = jsonStr.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

    let characters: string[] = [];
    try {
      characters = JSON.parse(jsonStr);
      if (!Array.isArray(characters)) {
        characters = [];
      }
    } catch (error) {
      console.warn('Failed to parse Gemini character detection response:', error);
      // Fallback to empty array
      characters = [];
    }

    // Clean and validate character names
    characters = characters
      .filter((char): char is string => typeof char === 'string' && char.trim().length > 0)
      .map(char => char.trim())
      .filter((char, index, self) => self.indexOf(char) === index); // Remove duplicates

    return NextResponse.json({
      characters,
    });
  } catch (error: any) {
    console.error('Character detection error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to detect characters', characters: [] },
      { status: 500 }
    );
  }
}
