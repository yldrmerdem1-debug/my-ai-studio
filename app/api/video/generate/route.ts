import { NextResponse } from 'next/server';
import Replicate from 'replicate';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import crypto from 'node:crypto';
import { getGeminiModelId } from '@/lib/gemini';
import { generateSpeech, generateSFX } from '@/lib/audio-service';
import { VOICE_CAST } from '@/lib/voice-constants';
import { mergeVideoWithAudioUrl, mixVideoWithDucking } from '@/lib/videoProcessor';

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
  fetch: (url, options) => fetch(url, { ...(options as RequestInit), timeout: 300000 } as any),
});

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

const isReadableStream = (value: any): value is ReadableStream => {
  return value && typeof value.getReader === 'function';
};

const findFirstStream = (output: any): ReadableStream | null => {
  if (!output) return null;
  if (isReadableStream(output)) return output;
  if (Array.isArray(output)) {
    for (const item of output) {
      const found = findFirstStream(item);
      if (found) return found;
    }
    return null;
  }
  if (typeof output === 'object') {
    for (const value of Object.values(output)) {
      const found = findFirstStream(value);
      if (found) return found;
    }
  }
  return null;
};

const saveStreamToPublic = async (stream: ReadableStream, extension: string): Promise<string> => {
  const dir = path.join(process.cwd(), 'public', 'generated');
  await mkdir(dir, { recursive: true });
  const fileName = `${crypto.randomUUID()}.${extension}`;
  const filePath = path.join(dir, fileName);
  await pipeline(Readable.fromWeb(stream as any), createWriteStream(filePath));
  return `/generated/${fileName}`;
};

const extractImageUrl = (output: any): string => {
  if (!output) return '';
  if (typeof output === 'string') return output.includes('://') ? output : '';
  if (Array.isArray(output)) {
    for (const item of output) {
      const found = extractImageUrl(item);
      if (found) return found;
    }
    return '';
  }
  if (typeof output === 'object') {
    for (const value of Object.values(output)) {
      const found = extractImageUrl(value);
      if (found) return found;
    }
  }
  return '';
};

const extractSceneJson = (raw: string) => {
  const cleaned = raw.trim().replace(/^```[a-zA-Z]*\n?/, '').replace(/```$/, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : null;
  }
};

const resolveReplicateFileUrl = async (apiUrl: string, token: string): Promise<string> => {
  if (!apiUrl.includes('api.replicate.com/v1/files/')) return apiUrl;
  const fileResponse = await fetch(apiUrl, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const fileText = await fileResponse.text();
  if (!fileResponse.ok) {
    throw new Error(`Replicate file lookup failed: ${fileResponse.status} ${fileText}`);
  }
  const filePayload = fileText ? JSON.parse(fileText) : null;
  const fileSignedUrl = filePayload?.urls?.get || filePayload?.urls?.original;
  const fileServingUrl = filePayload?.serving_url;
  if (typeof fileServingUrl === 'string' && fileServingUrl.includes('://') && !fileServingUrl.includes('api.replicate.com/v1/files/')) {
    return fileServingUrl;
  }
  if (typeof fileSignedUrl === 'string' && fileSignedUrl.includes('://') && !fileSignedUrl.includes('api.replicate.com/v1/files/')) {
    return fileSignedUrl;
  }
  if (typeof fileServingUrl === 'string' && fileServingUrl.includes('://')) {
    return fileServingUrl;
  }
  if (typeof fileSignedUrl === 'string' && fileSignedUrl.includes('://')) {
    return fileSignedUrl;
  }
  throw new Error(`Replicate file lookup returned no signed URL. Payload: ${fileText}`);
};

const normalizeReplicateAssetUrl = async (url: string) => {
  if (url && url.includes('api.replicate.com/v1/files/')) {
    return await resolveReplicateFileUrl(url, process.env.REPLICATE_API_TOKEN || '');
  }
  return url;
};

const resolveReplicatePublicUrl = async (url: string) => {
  if (!url) return url;
  if (url.includes('api.replicate.com/v1/files/')) {
    return await resolveReplicateFileUrl(url, process.env.REPLICATE_API_TOKEN || '');
  }
  return url;
};

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

const uploadUrlToReplicate = async (url: string, filename: string, contentType: string) => {
  const token = process.env.REPLICATE_API_TOKEN || '';
  if (!token) {
    throw new Error('REPLICATE_API_TOKEN not configured');
  }
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch asset for upload: ${response.status}`);
  }
  const buffer = await response.arrayBuffer();
  const blob = new Blob([buffer], { type: contentType });
  const form = new FormData();
  form.append('content', blob, filename);
  const upload = await fetch('https://api.replicate.com/v1/files', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const text = await upload.text();
  if (!upload.ok) {
    throw new Error(`Replicate upload failed: ${upload.status} ${text}`);
  }
  let payload: any = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }
  const servingUrl = payload?.serving_url;
  const signedUrl = payload?.urls?.get || payload?.urls?.original;
  const apiUrl = payload?.url;
  const candidateUrl = typeof signedUrl === 'string' && signedUrl.includes('://')
    ? signedUrl
    : typeof servingUrl === 'string' && servingUrl.includes('://')
      ? servingUrl
      : typeof apiUrl === 'string' && apiUrl.includes('://')
        ? apiUrl
        : '';
  if (!candidateUrl) {
    throw new Error(`Replicate upload returned no URL. Payload: ${text}`);
  }
  return await resolveReplicatePublicUrl(candidateUrl);
};

const ensureReplicateUri = async (url: string, filename: string, contentType: string) => {
  if (!url) return url;
  const absolute = ensureAbsoluteUrl(url);
  const isLocal = absolute.includes('localhost') || absolute.includes('127.0.0.1') || absolute.includes('0.0.0.0');
  if (isLocal || absolute.startsWith('/')) {
    return await uploadUrlToReplicate(absolute, filename, contentType);
  }
  return await resolveReplicatePublicUrl(absolute);
};

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      userPrompt,
      prompt,
      personaModelId,
      personaTriggerWord,
      voiceId,
    } = body || {};

    const inputPrompt = (userPrompt || prompt || '').toString().trim();
    if (!inputPrompt) {
      throw new Error('Prompt is required.');
    }

    const triggerWord = personaTriggerWord || 'TOK';

    const preferredModel = 'gemini-3-pro-preview';
    const geminiApiKey = process.env.GEMINI_API_KEY || '';
    if (!geminiApiKey.trim()) {
      throw new Error('GEMINI_API_KEY not configured.');
    }
    const resolvedModel = await getGeminiModelId(geminiApiKey, preferredModel);
    const model = genAI.getGenerativeModel({
      model: resolvedModel,
      generationConfig: { temperature: 0.7 },
    });

    const directorPrompt = `
SEN DÜNYANIN EN İYİ SİNEMATİK YAPAY ZEKA YÖNETMENİSİN.
Amacın: Görsel, Ses, Hareket ve Atmosferin %100 uyumlu olduğu bir video tasarlamak.

GÖREVLERİN:
1. CASTING: Karakterin görsel tanımına göre en uygun ses profilini seç.
2. HAREKET YÖNETİMİ: Baş, göz ve mimik hareketleri doğal olmalı.
3. ATMOSFER TASARIMI: Sahne duygusuna uygun arka plan müzik/SFX belirle.

BANA ŞU JSON FORMATINDA CEVAP VER:
{
  "character_profile": {
    "visual_description": "Flux-2-max için aşırı detaylı, 4K prompt. Yüz hatlarını, cilt dokusunu ve ışığı belirt.",
    "age_group": "young | middle_aged | old",
    "gender": "male | female",
    "nationality": "american | british | turkish",
    "suggested_voice_category": "young_male_american"
  },
  "movement_direction": {
    "kling_prompt": "Kling için hareket emri. Örn: 'Slowly turns head from left to right, blinks naturally, slightly tilts head while speaking, looks directly at camera at the end.'",
    "expression": "happy | serious | suspicious | flirting"
  },
  "audio_engineering": {
    "speech_text": "Karakterin söyleyeceği metin.",
    "speech_emotion_prompt": "ElevenLabs için duygu tarifi (Örn: 'Deep, raspy voice, slightly angry tone').",
    "background_music_prompt": "ElevenLabs/AudioLDM için müzik/SFX tarifi."
  }
}
Output MUST be valid JSON only. Use English in prompts.
User idea: "${inputPrompt}"
    `.trim();

    const directorCut = await model.generateContent(directorPrompt);
    const raw = directorCut.response.text().trim();
    const scene = extractSceneJson(raw);
    if (!scene) {
      throw new Error('Gemini returned invalid JSON.');
    }

    const characterProfile = scene.character_profile || {};
    const movementDirection = scene.movement_direction || {};
    const audioEngineering = scene.audio_engineering || {};
    const fluxPrompt = typeof characterProfile.visual_description === 'string' ? characterProfile.visual_description.trim() : '';
    const klingPrompt = typeof movementDirection.kling_prompt === 'string' ? movementDirection.kling_prompt.trim() : '';
    const rawUserDialogue = typeof body?.dialogue === 'string'
      ? body.dialogue.trim()
      : typeof body?.dialogueText === 'string'
        ? body.dialogueText.trim()
        : typeof body?.voiceScript === 'string'
          ? body.voiceScript.trim()
          : typeof body?.script === 'string'
            ? body.script.trim()
            : '';
    const speechText = typeof audioEngineering.speech_text === 'string' ? audioEngineering.speech_text.trim() : '';
    const speechEmotionPrompt = typeof audioEngineering.speech_emotion_prompt === 'string'
      ? audioEngineering.speech_emotion_prompt.trim()
      : '';
    const sfxPrompt = typeof audioEngineering.background_music_prompt === 'string'
      ? audioEngineering.background_music_prompt.trim()
      : '';
    const suggestedVoiceCategory = typeof characterProfile.suggested_voice_category === 'string'
      ? characterProfile.suggested_voice_category.trim()
      : '';
    const isDialogue = Boolean(rawUserDialogue) && Boolean(speechText);

    if (!sfxPrompt || !fluxPrompt || !klingPrompt) {
      throw new Error('Director output missing required prompts.');
    }

    const generateImage = async () => {
      if (personaModelId) {
        let targetVersion = personaModelId;
        if (personaModelId && !personaModelId.includes('/') && !personaModelId.includes(':')) {
          const training = await replicate.trainings.get(personaModelId);
          targetVersion = training.output?.version || training.version || personaModelId;
        }
        const personaPrompt = fluxPrompt.toLowerCase().includes(triggerWord.toLowerCase())
          ? fluxPrompt
          : `${triggerWord} ${fluxPrompt}`.trim();
        const imageOutput = await replicate.run(targetVersion, {
          input: {
            prompt: personaPrompt,
            output_format: 'jpg',
            disable_safety_checker: true,
          },
        });
        let imageUrl = extractImageUrl(imageOutput);
        if (!imageUrl) {
          const stream = findFirstStream(imageOutput);
          if (stream) imageUrl = await saveStreamToPublic(stream, 'jpg');
        }
        if (!imageUrl) throw new Error('Persona image generation failed.');
        return await normalizeReplicateAssetUrl(imageUrl);
      }

      const imageOutput = await replicate.run('black-forest-labs/flux-2-max', {
        input: {
          prompt: fluxPrompt,
          aspect_ratio: '16:9',
          output_quality: 100,
          output_format: 'jpg',
          num_inference_steps: 50,
        },
      });
      let imageUrl = extractImageUrl(imageOutput);
      if (!imageUrl) {
        const stream = findFirstStream(imageOutput);
        if (stream) imageUrl = await saveStreamToPublic(stream, 'jpg');
      }
      if (!imageUrl) throw new Error('Flux image generation failed.');
      return await normalizeReplicateAssetUrl(imageUrl);
    };

    const generateAtmosphere = async (promptText: string) => {
      return await generateSFX({
        text: promptText,
        durationSeconds: 10,
        promptInfluence: 0.5,
      });
    };

    const generateSpeechAudio = async () => {
      if (!speechText) return '';
      const fallbackVoiceId = '21m00Tcm4TlvDq8ikWAM';
      const selectedVoiceId = VOICE_CAST[suggestedVoiceCategory] || voiceId || fallbackVoiceId;
      return await generateSpeech({
        text: speechText,
        voiceId: selectedVoiceId,
        emotion_prompt: speechEmotionPrompt,
      });
    };

    const [voiceUrl, sfxUrl, imageUrl] = await Promise.all([
      isDialogue ? generateSpeechAudio() : Promise.resolve(''),
      generateAtmosphere(sfxPrompt),
      generateImage(),
    ]);

    const absoluteVoiceUrl = isDialogue ? ensureAbsoluteUrl(voiceUrl) : '';
    if (isDialogue && !absoluteVoiceUrl) {
      throw new Error('Dialogue requested but speech audio failed.');
    }
    let klingImageUrl = await ensureReplicateUri(imageUrl, 'image.jpg', 'image/jpeg');
    let klingAudioUrl = isDialogue
      ? await ensureReplicateUri(absoluteVoiceUrl, 'audio.mp3', 'audio/mpeg')
      : '';
    if (klingImageUrl.includes('api.replicate.com/v1/files/')) {
      klingImageUrl = await resolveReplicateFileUrl(klingImageUrl, process.env.REPLICATE_API_TOKEN || '');
    }
    if (klingAudioUrl.includes('api.replicate.com/v1/files/')) {
      klingAudioUrl = await resolveReplicateFileUrl(klingAudioUrl, process.env.REPLICATE_API_TOKEN || '');
    }
    if (isDialogue) {
      console.log('🎧 KLING AUDIO URI:', klingAudioUrl);
      if (!klingAudioUrl || !/^https?:\/\//.test(klingAudioUrl)) {
        throw new Error(`Kling audio URI invalid: ${klingAudioUrl || 'empty'}`);
      }
    }

    let videoUrl = '';
    if (isDialogue) {
      const avatarModel = 'kwaivgi/kling-avatar-v2';
      const avatarOutput = await replicate.run(avatarModel, {
        input: {
          image: klingImageUrl,
          audio: klingAudioUrl,
          prompt: klingPrompt,
          match_mode: 'audio_driven',
          audio_strength: 1.0,
          animation_mode: 'high_fidelity',
          cfg_scale: 0.6,
          aspect_ratio: '16:9',
          duration: 30,
        },
      });
      videoUrl = extractImageUrl(avatarOutput);
      if (!videoUrl) {
        const stream = findFirstStream(avatarOutput);
        if (stream) videoUrl = await saveStreamToPublic(stream, 'mp4');
      }
    } else {
      const videoModel = 'kwaivgi/kling-v2.5-turbo-pro';
      const videoOutput = await replicate.run(videoModel, {
        input: {
          prompt: klingPrompt,
          input_image: klingImageUrl,
          aspect_ratio: '16:9',
          duration: 30,
          cfg_scale: 0.6,
        },
      });
      videoUrl = extractImageUrl(videoOutput);
      if (!videoUrl) {
        const stream = findFirstStream(videoOutput);
        if (stream) videoUrl = await saveStreamToPublic(stream, 'mp4');
      }
    }
    if (!videoUrl) throw new Error('Kling video failed.');
    videoUrl = await normalizeReplicateAssetUrl(videoUrl);

    const finalMovie = isDialogue
      ? await mixVideoWithDucking({
        videoUrl,
        voiceUrl,
        sfxUrl,
        voiceVolume: 1.0,
        sfxBedVolume: 0.6,
        duckedSfxVolume: 0.2,
      })
      : await mergeVideoWithAudioUrl({
        videoUrl,
        audioUrl: sfxUrl,
        audioVolume: 0.6,
      });

    return NextResponse.json({
      success: true,
      videoUrl: finalMovie.videoUrl,
      imageUrl,
      scene,
    });
  } catch (error: any) {
    console.error('❌ HATA:', error.message || error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
