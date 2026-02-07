import { NextRequest } from 'next/server';
import fs from 'fs/promises';
import { findPersonaById } from '@/lib/persona-registry';

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const parts = url.pathname.split('/');
    const personaId = parts[parts.length - 2];
    if (!personaId) {
      return Response.json({ error: 'Persona id is required' }, { status: 400 });
    }

    const persona = await findPersonaById(personaId);
    if (!persona?.trainingZipPath) {
      return Response.json({ error: 'Training ZIP not found' }, { status: 404 });
    }

    const zipBuffer = await fs.readFile(persona.trainingZipPath);
    return new Response(zipBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `inline; filename="persona-${personaId}.zip"`,
      },
    });
  } catch (error: any) {
    console.error('ZIP download error:', error);
    return Response.json(
      { error: 'Unable to fetch training ZIP' },
      { status: 500 }
    );
  }
}
