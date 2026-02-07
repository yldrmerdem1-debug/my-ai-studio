import { NextResponse } from 'next/server';
import { VIDEO_QUALITY_CONFIG } from '@/lib/video-quality';

export async function GET() {
  const qualities = Object.entries(VIDEO_QUALITY_CONFIG).map(([id, value]) => ({
    id,
    label: value.label,
    creditCost: value.creditCost,
  }));
  return NextResponse.json({ qualities });
}
