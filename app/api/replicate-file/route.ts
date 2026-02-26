import { NextRequest, NextResponse } from 'next/server';
import { downloadMediaWithValidation } from '@/lib/replicate-media';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const fileId = searchParams.get('id');
  if (!fileId) {
    return NextResponse.json({ error: 'File id is required' }, { status: 400 });
  }

  const apiToken = process.env.REPLICATE_API_TOKEN;
  if (!apiToken || !apiToken.trim()) {
    return NextResponse.json({ error: 'API token not configured' }, { status: 500 });
  }

  try {
    const apiUrl = `https://api.replicate.com/v1/files/${fileId}`;
    const media = await downloadMediaWithValidation(apiUrl, {
      token: apiToken.trim(),
      strictExpectedKind: false,
      logger: {
        info: (...args) => console.log(...args),
        warn: (...args) => console.warn(...args),
      },
    });
    const headers = new Headers();
    headers.set('Content-Type', media.contentType || 'application/octet-stream');
    headers.set('Content-Length', String(media.buffer.byteLength));
    headers.set('Cache-Control', 'private, max-age=300');
    return new NextResponse(new Uint8Array(media.buffer), {
      status: 200,
      headers,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Replicate file fetch failed' },
      { status: 502 }
    );
  }
}
