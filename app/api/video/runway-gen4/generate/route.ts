import { NextResponse } from 'next/server';
import { createRunwayImageToVideoTask, type RunwayI2VModel, type RunwayI2VRatio } from '@/lib/runway';
import { ensurePublicAssetUrl } from '@/lib/public-asset-url';

export const runtime = 'nodejs';

const resolveBaseUrl = () => {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return 'http://localhost:3000';
};

const ensureAbsoluteUrl = (url: string) => {
  if (!url) return url;
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  if (url.startsWith('/')) return `${resolveBaseUrl()}${url}`;
  return url;
};

const toModel = (raw: unknown): RunwayI2VModel => {
  const v = String(raw || 'gen4.5').trim();
  const allowed: RunwayI2VModel[] = ['gen4.5', 'gen4_turbo', 'gen3a_turbo', 'veo3', 'veo3.1', 'veo3.1_fast'];
  return (allowed.includes(v as any) ? v : 'gen4.5') as RunwayI2VModel;
};

const toRatio = (raw: unknown): RunwayI2VRatio => {
  const v = String(raw || '1280:720').trim();
  const allowed: RunwayI2VRatio[] = ['1280:720', '720:1280', '1104:832', '960:960', '832:1104', '1584:672'];
  return (allowed.includes(v as any) ? v : '1280:720') as RunwayI2VRatio;
};

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const imagePrompt = String(body?.image_prompt || body?.imagePrompt || body?.promptImage || '').trim();
    const promptText = String(body?.prompt || body?.promptText || body?.text_prompt || '').trim();
    const model = toModel(body?.model);
    const ratio = toRatio(body?.ratio);
    const duration = Number(body?.duration ?? body?.duration_seconds ?? 5);
    const seed = body?.seed != null ? Number(body.seed) : undefined;

    if (!imagePrompt) {
      return NextResponse.json({ error: 'image_prompt is required.' }, { status: 400 });
    }
    if (!promptText) {
      return NextResponse.json({ error: 'prompt is required.' }, { status: 400 });
    }

    // Runway requires a fetchable HTTPS image URL (or data/runway://). Convert local/Replicate-auth URLs to a public signed URL.
    const promptImage = await ensurePublicAssetUrl(
      { url: imagePrompt },
      {
        token: process.env.REPLICATE_API_TOKEN || '',
        resolveAbsoluteUrl: ensureAbsoluteUrl,
        bypassReplicateFileApi: false,
        logger: {
          info: (...args) => console.log(...args),
          warn: (...args) => console.warn(...args),
        },
      }
    );

    const task = await createRunwayImageToVideoTask({
      model,
      promptImage,
      promptText,
      ratio,
      duration: Number.isFinite(duration) ? duration : 5,
      ...(Number.isFinite(seed as number) ? { seed: seed as number } : {}),
    });

    return NextResponse.json({
      success: true,
      task_id: task.id,
      id: task.id,
      model,
    });
  } catch (error: any) {
    const message = String(error?.message || 'Unknown error');
    console.error('Runway generate error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

