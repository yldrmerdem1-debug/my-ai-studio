import { NextRequest, NextResponse } from 'next/server';
import { generateVoiceBuffer } from '@/lib/voice';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const text = typeof body?.text === 'string' ? body.text : '';
    const voiceId = typeof body?.voiceId === 'string' ? body.voiceId : undefined;
    const format = body?.format === 'wav' ? 'wav' : 'mp3';

    if (!text.trim()) {
      return NextResponse.json({ error: 'Text is required' }, { status: 400 });
    }

    const voice = await generateVoiceBuffer({
      text: text.trim(),
      voiceId,
      format,
    });

    const response = new NextResponse(voice.buffer, {
      status: 200,
      headers: {
        'Content-Type': voice.mimeType,
        'Cache-Control': 'no-store',
        'X-Audio-File': voice.publicUrl,
      },
    });

    return response;
  } catch (error: any) {
    console.error('Voice generation error:', error);
    return NextResponse.json(
      {
        error: error.message || 'Failed to generate voice',
        details: error.toString(),
      },
      { status: 500 }
    );
  }
}
