import { NextRequest, NextResponse } from 'next/server';

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

  const apiUrl = `https://api.replicate.com/v1/files/${fileId}`;
  const range = request.headers.get('range');
  const upstreamHeaders: Record<string, string> = {
    Authorization: `Bearer ${apiToken.trim()}`,
  };
  if (range) {
    upstreamHeaders.Range = range;
  }

  const fileResponse = await fetch(apiUrl, {
    headers: upstreamHeaders,
  });

  if (!fileResponse.ok) {
    const errorText = await fileResponse.text();
    return NextResponse.json(
      { error: `Replicate file fetch failed: ${fileResponse.status} ${errorText}` },
      { status: fileResponse.status }
    );
  }

  const headers = new Headers();
  const contentType = fileResponse.headers.get('content-type');
  const contentLength = fileResponse.headers.get('content-length');
  if (contentType) headers.set('Content-Type', contentType);
  if (contentLength) headers.set('Content-Length', contentLength);
  headers.set('Cache-Control', 'private, max-age=300');

  return new NextResponse(fileResponse.body, {
    status: fileResponse.status,
    headers,
  });
}
