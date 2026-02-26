import { NextRequest, NextResponse } from 'next/server';
import { downloadMediaWithValidation } from '@/lib/replicate-media';

/**
 * Proxy for Grok: Replicate only accepts image URLs that end with .png, .jpg, .jpeg, .webp.
 * This route serves a Replicate file at a path that ends with the extension (e.g. /api/grok-image/image.jpg?id=xxx).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ filename: string }> }
) {
  const { filename } = await params;
  const fileId = request.nextUrl.searchParams.get('id');
  if (!fileId) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 });
  }

  const apiToken = process.env.REPLICATE_API_TOKEN;
  if (!apiToken?.trim()) {
    return NextResponse.json({ error: 'API token not configured' }, { status: 500 });
  }

  const ext = filename.split('.').pop()?.toLowerCase();
  const contentType =
    ext === 'png'
      ? 'image/png'
      : ext === 'webp'
        ? 'image/webp'
        : 'image/jpeg';

  try {
    const apiUrl = `https://api.replicate.com/v1/files/${fileId}`;
    const media = await downloadMediaWithValidation(apiUrl, {
      token: apiToken.trim(),
      expectedKind: 'image',
      strictExpectedKind: true,
      logger: {
        info: (...args) => console.log(...args),
        warn: (...args) => console.warn(...args),
      },
    });
    const headers = new Headers();
    headers.set('Content-Type', media.contentType.startsWith('image/') ? media.contentType : contentType);
    headers.set('Cache-Control', 'public, max-age=3600');
    const body = Buffer.isBuffer(media.buffer) ? new Uint8Array(media.buffer) : media.buffer;
    return new NextResponse(body, {
      status: 200,
      headers,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Failed to load image from Replicate' },
      { status: 502 }
    );
  }
}
