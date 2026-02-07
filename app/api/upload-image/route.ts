import { NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase/admin';

const DEFAULT_BUCKET = 'persona-images';

const parseDataUrl = (dataUrl: string) => {
  const match = dataUrl.match(/^data:(.+?);base64,(.+)$/);
  if (!match) return null;
  return { contentType: match[1], base64: match[2] };
};

export async function POST(request: Request) {
  try {
    const { client: supabase, error: supabaseError } = getSupabaseAdminClient();
    if (!supabase || supabaseError) {
      return NextResponse.json(
        { error: supabaseError || 'Supabase not configured' },
        { status: 500 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const dataUrl = typeof body?.dataUrl === 'string' ? body.dataUrl.trim() : '';
    if (!dataUrl) {
      return NextResponse.json({ error: 'Image data is required' }, { status: 400 });
    }

    const parsed = parseDataUrl(dataUrl);
    if (!parsed) {
      return NextResponse.json({ error: 'Invalid image data URL' }, { status: 400 });
    }

    const buffer = Buffer.from(parsed.base64, 'base64');
    if (!buffer.length) {
      return NextResponse.json({ error: 'Invalid image payload' }, { status: 400 });
    }

    const bucket = process.env.SUPABASE_IMAGE_BUCKET || DEFAULT_BUCKET;
    const userPrefix = typeof body?.userId === 'string' ? body.userId : 'anonymous';
    const filename = `${userPrefix}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.png`;

    const uploadResult = await supabase.storage.from(bucket).upload(filename, buffer, {
      contentType: parsed.contentType || 'image/png',
      upsert: true,
    });

    if (uploadResult.error) {
      return NextResponse.json(
        { error: 'Failed to upload image', details: uploadResult.error.message },
        { status: 500 }
      );
    }

    const { data } = supabase.storage.from(bucket).getPublicUrl(filename);
    if (!data?.publicUrl) {
      return NextResponse.json(
        { error: 'Upload succeeded but public URL is missing' },
        { status: 500 }
      );
    }

    return NextResponse.json({ publicUrl: data.publicUrl });
  } catch (error: any) {
    return NextResponse.json(
      { error: 'Upload failed', details: error?.message || String(error) },
      { status: 500 }
    );
  }
}
