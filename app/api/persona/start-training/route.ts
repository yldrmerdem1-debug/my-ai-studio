import { NextRequest } from 'next/server';
import { findPersonaById, upsertPersona } from '@/lib/persona-registry';

export async function POST(request: NextRequest) {
  try {
    console.log('=== START TRAINING ROUTE HIT ===');
    const requestBody = await request.json().catch(() => ({}));
    const personaId = requestBody?.personaId as string | undefined;

    const apiToken = process.env.REPLICATE_API_TOKEN;
    console.log('REPLICATE TOKEN PREFIX:', apiToken?.slice(0, 6));
    if (!apiToken || apiToken.trim() === '') {
      return Response.json(
        { error: 'REPLICATE_API_TOKEN not configured' },
        { status: 500 }
      );
    }

    if (!personaId) {
      return Response.json(
        { error: 'Persona id is required' },
        { status: 400 }
      );
    }

    const persona = await findPersonaById(personaId);
    if (!persona) {
      return Response.json(
        { error: 'Persona not found' },
        { status: 400 }
      );
    }
    if (!persona.trainingZipUrl) {
      return Response.json(
        { error: 'Training images not ready' },
        { status: 400 }
      );
    }

    const trainingEndpoint =
      'https://api.replicate.com/v1/models/replicate/fast-flux-trainer/versions/8b10794665aed907bb98a1a5324cd1d3a8bea0e9b31e65210967fb9c9e2e08ed/trainings';
    const destination = 'yldrmerdem1-debug/persona-model';
    const input_images = persona.trainingZipUrl;
    const trigger_word = persona.triggerWord ?? 'TOK';
    const lora_type = 'subject';

    console.log('DESTINATION SENT TO REPLICATE:', destination);
    console.log(
      'REPLICATE PAYLOAD:',
      JSON.stringify(
        {
          destination,
          input: {
            input_images,
            trigger_word,
            lora_type,
          },
        },
        null,
        2
      )
    );
    console.log('SENDING TRAINING TO REPLICATE');

    const response = await fetch(trainingEndpoint, {
      method: 'POST',
      headers: {
        Authorization: `Token ${apiToken?.trim() ?? ''}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        destination,
        input: {
          input_images,
          trigger_word,
          lora_type,
        },
      }),
    });

    console.log('Replicate response status:', response.status);
    const responseBody = await response.json().catch(() => null);
    console.log('Replicate response body:', responseBody);
    if (!response.ok) {
      return Response.json(
        { error: 'Replicate training failed' },
        { status: 500 }
      );
    }

    const trainingId = responseBody?.id;
    if (!trainingId) {
      return Response.json(
        { error: 'Training id missing from Replicate response' },
        { status: 500 }
      );
    }
    if (trainingId) {
      await upsertPersona({
        personaId,
        userId: persona.userId,
        trainingId,
        status: 'training',
      });
    }

    return Response.json(responseBody ?? {});
  } catch (error: any) {
    console.error('START TRAINING ERROR:', error);
    return Response.json(
      { error: String(error?.message || error) },
      { status: 500 }
    );
  }
}
