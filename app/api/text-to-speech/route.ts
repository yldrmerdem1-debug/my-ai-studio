import { NextRequest, NextResponse } from 'next/server';
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import crypto from 'node:crypto';
import { requirePersonaAccess } from '@/lib/persona-guards';
import { createGeminiModel, getGeminiModelId, resolveGeminiModelId } from '@/lib/gemini';

let geminiTtsDisabled = false;
const geminiModelId = resolveGeminiModelId(
  process.env.GEMINI_MODEL_ID,
  'gemini-3-pro-preview'
);

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const parseRetryDelayMs = (errorMessage: string) => {
  const match = errorMessage.match(/retry in\s+([\d.]+)s/i) || errorMessage.match(/retryDelay":"(\d+)s"/i);
  if (!match) return null;
  const seconds = Number(match[1]);
  if (Number.isNaN(seconds)) return null;
  return Math.max(0, Math.round(seconds * 1000));
};

const enhanceSpeechText = async (text: string) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || !apiKey.trim()) {
    throw new Error('GEMINI_API_KEY not configured');
  }
  if (geminiTtsDisabled) {
    throw new Error('Gemini TTS enhancement is disabled');
  }
  let resolvedModelId = geminiModelId;
  try {
    resolvedModelId = await getGeminiModelId(apiKey, geminiModelId);
  } catch (error) {
    console.warn('Gemini model list failed, using fallback model.', error);
  }
  const model = createGeminiModel(apiKey, resolvedModelId);
  const prompt = [
    'Rewrite this text to be natural, clear, and engaging for voice narration.',
    'Keep the original meaning.',
    'Do not add extra content.',
    'Return only the final rewritten text.',
    '',
    text,
  ].join('\n');
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const result = await model.generateContent(prompt);
      const response = await result.response;
      const output = response.text().trim();
      if (!output) {
        throw new Error('Gemini returned an empty narration script');
      }
      return output;
    } catch (error: any) {
      const message = error?.message || String(error);
      const isRateLimit = message.includes('429') || message.includes('Too Many Requests');
      const retryDelayMs = parseRetryDelayMs(message);
      if (!isRateLimit || attempt === 1) {
        throw error;
      }
      await sleep(retryDelayMs ?? 35000);
    }
  }
  throw new Error('Gemini request failed after retry');
};

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

    const {
      text,
      voiceId,
      format = 'mp3',
      useTrainedVoice,
      useGeminiEnhancement = true,
      personaId,
      user,
    } = await request.json();

    if (!text || !text.trim()) {
      return NextResponse.json(
        { error: 'Text is required' },
        { status: 400 }
      );
    }
    let finalText: string;
    try {
      finalText = await enhanceSpeechText(text.trim());
    } catch (error: any) {
      return NextResponse.json(
        {
          error: 'Gemini prompt is required for text-to-speech',
          code: 'GEMINI_REQUIRED',
          details: error?.message || String(error),
        },
        { status: 502 }
      );
    }

    if (useTrainedVoice) {
      const personaCheck = await requirePersonaAccess({
        user,
        personaId,
        requireReady: 'voice',
        allowCrossUser: true,
      });
      if (!personaCheck.ok) {
        return NextResponse.json(personaCheck.body, { status: personaCheck.status });
      }
    }

    console.log('Converting text to speech with ElevenLabs...', {
      format,
      useTrainedVoice,
      personaId,
    });

    const resolvedVoiceId = voiceId || '21m00Tcm4TlvDq8ikWAM';
    const acceptHeader = format === 'wav' ? 'audio/wav' : 'audio/mpeg';

    console.log('API Key Check:', process.env.ELEVENLABS_API_KEY?.slice(0, 5) + '...');
    console.log('API Key Suffix Check:', process.env.ELEVENLABS_API_KEY?.slice(-4));
    // Call ElevenLabs API
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${resolvedVoiceId}`, {
      method: 'POST',
      headers: {
        'Accept': acceptHeader,
        'Content-Type': 'application/json',
        'xi-api-key': apiKey.trim(),
      },
      body: JSON.stringify({
        text: finalText,
        model_id: 'eleven_multilingual_v2',
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
    
    const audioMime = format === 'wav' ? 'audio/wav' : 'audio/mpeg';
    const extension = format === 'wav' ? 'wav' : 'mp3';
    const dir = path.join(process.cwd(), 'public', 'tts');
    await mkdir(dir, { recursive: true });
    const fileName = `${crypto.randomUUID()}.${extension}`;
    const filePath = path.join(dir, fileName);
    await pipeline(Readable.fromWeb(audioBlob.stream() as any), createWriteStream(filePath));

    // Convert blob to base64 for client-side use
    const arrayBuffer = await audioBlob.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString('base64');
    const audioUrl = `data:${audioMime};base64,${base64}`;
    const audioFileUrl = `/tts/${fileName}`;

    console.log('Text-to-speech conversion successful');

    return NextResponse.json({
      audioUrl,
      audioFileUrl,
      format: format === 'wav' ? 'wav' : 'mp3',
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
