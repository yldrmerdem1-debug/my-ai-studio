import { NextResponse } from 'next/server';
import { VIDEO_QUALITY_CONFIG, type VideoQuality } from '@/lib/video-quality';

export async function GET() {
  const order: VideoQuality[] = ['standard', 'premium'];
  const qualities = order.map((id) => {
    const value = VIDEO_QUALITY_CONFIG[id];
    return { id, label: value.label, creditCost: value.creditCost };
  });
  return NextResponse.json({ qualities });
}
