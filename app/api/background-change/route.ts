import { NextRequest, NextResponse } from 'next/server';
import { rebuildStudioBackground } from '@/lib/background-rebuild';

const safeTrim = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

const normalizeImageContentType = (value: string | null | undefined) => {
  const normalized = String(value || '').split(';')[0].trim().toLowerCase();
  return normalized.startsWith('image/') ? normalized : 'image/jpeg';
};

const toDataUrl = (buffer: Buffer, contentType: string) =>
  `data:${normalizeImageContentType(contentType)};base64,${buffer.toString('base64')}`;

export async function POST(request: NextRequest) {
  try {
    const apiToken = safeTrim(process.env.REPLICATE_API_TOKEN);

    if (!apiToken) {
      return NextResponse.json(
        { error: 'API token not configured' },
        { status: 500 }
      );
    }

    const formData = await request.formData();
    const imageEntry = formData.get('image');
    const prompt = safeTrim(formData.get('prompt'));

    if (!(imageEntry instanceof File)) {
      return NextResponse.json(
        { error: 'Image is required' },
        { status: 400 }
      );
    }

    const imageBuffer = Buffer.from(await imageEntry.arrayBuffer());
    const sourceContentType = normalizeImageContentType(imageEntry.type);
    const sourceImageDataUrl = toDataUrl(imageBuffer, sourceContentType);
    return NextResponse.json(
      await rebuildStudioBackground({
        apiToken,
        image: sourceImageDataUrl,
        prompt,
      })
    );
  } catch (error: unknown) {
    console.error('Image Studio error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to generate studio image' },
      { status: 500 }
    );
  }
}
