import { NextRequest, NextResponse } from 'next/server';
import { createGeminiModel, getGeminiModelId, resolveGeminiModelId } from '@/lib/gemini';

const geminiModelId = resolveGeminiModelId(
  process.env.GEMINI_MODEL_ID,
  'gemini-3-pro-preview'
);

const parseDataUrl = (value: string) => {
  const match = value.match(/^data:(.+?);base64,(.+)$/);
  if (!match) return null;
  return { mime: match[1], data: match[2] };
};

const toBase64 = async (imageUrl: string) => {
  if (imageUrl.startsWith('data:')) {
    const parsed = parseDataUrl(imageUrl);
    if (!parsed) {
      throw new Error('Invalid data URL');
    }
    return { mime: parsed.mime, data: parsed.data };
  }
  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch image (${response.status})`);
  }
  const mime = response.headers.get('content-type') || 'image/png';
  const buffer = Buffer.from(await response.arrayBuffer());
  return { mime, data: buffer.toString('base64') };
};

const normalizeCategory = (value: string) => {
  const text = value.toLowerCase();
  if (text.includes('anime') || text.includes('cartoon')) return 'Anime/Cartoon';
  if (text.includes('3d')) return '3D Render';
  return 'Realistic/Film';
};

export async function POST(request: NextRequest) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || !apiKey.trim()) {
      return NextResponse.json(
        { error: 'GEMINI_API_KEY not configured' },
        { status: 500 }
      );
    }

    const { imageUrl } = await request.json();
    if (!imageUrl || typeof imageUrl !== 'string') {
      return NextResponse.json(
        { error: 'imageUrl is required' },
        { status: 400 }
      );
    }

    const resolvedModelId = await getGeminiModelId(apiKey, geminiModelId);
    const model = createGeminiModel(apiKey, resolvedModelId);
    const { mime, data } = await toBase64(imageUrl);

    const result = await model.generateContent([
      {
        text: "Analyze the visual style of this image. Respond with exactly one label: Photorealistic, Anime/Cartoon, or 3D Render.",
      },
      {
        inlineData: {
          mimeType: mime,
          data,
        },
      },
    ]);
    const response = await result.response;
    const output = response.text().trim();
    const category = normalizeCategory(output);

    return NextResponse.json({
      category,
      raw: output,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        error: error?.message || 'Failed to detect style',
        details: error?.toString?.() ?? String(error),
      },
      { status: 500 }
    );
  }
}
