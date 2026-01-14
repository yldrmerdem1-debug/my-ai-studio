import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    // Get API key from environment
    const apiKey = process.env.ELEVENLABS_API_KEY;
    
    // Validate token exists
    if (!apiKey || apiKey.trim() === '') {
      console.error('ELEVENLABS_API_KEY not found in environment');
      return NextResponse.json(
        {
          error: 'API token not configured',
          details: 'Please set ELEVENLABS_API_KEY in your .env.local file and restart your dev server'
        },
        { status: 500 }
      );
    }

    const { text, voiceId = '21m00Tcm4TlvDq8ikWAM' } = await request.json();

    if (!text || !text.trim()) {
      return NextResponse.json(
        { error: 'Text is required' },
        { status: 400 }
      );
    }

    console.log('Converting text to speech with ElevenLabs...');

    // Call ElevenLabs API
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
        'Accept': 'audio/mpeg',
        'Content-Type': 'application/json',
        'xi-api-key': apiKey.trim(),
      },
      body: JSON.stringify({
        text: text.trim(),
        model_id: 'eleven_monolingual_v1',
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.5,
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('ElevenLabs API error:', errorText);
      throw new Error(`ElevenLabs API error: ${response.statusText}`);
    }

    // Get audio blob
    const audioBlob = await response.blob();
    
    // Convert blob to base64 for client-side use
    const arrayBuffer = await audioBlob.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString('base64');
    const audioUrl = `data:audio/mpeg;base64,${base64}`;

    console.log('Text-to-speech conversion successful');

    return NextResponse.json({
      audioUrl,
      status: 'succeeded',
    });

  } catch (error: any) {
    console.error('Text-to-speech error:', error);
    return NextResponse.json(
      { 
        error: error.message || 'Failed to convert text to speech',
        details: error.toString()
      },
      { status: 500 }
    );
  }
}
