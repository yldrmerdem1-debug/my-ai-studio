import { NextRequest } from 'next/server';
import fs from 'fs/promises';
import { findPersonaById } from '@/lib/persona-registry';
import { getStorageProvider } from '@/lib/storage';

const readRemoteZip = async (url: string) => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Remote ZIP fetch failed: ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
};

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const parts = url.pathname.split('/');
    const personaId = parts[parts.length - 2];
    if (!personaId) {
      return Response.json({ error: 'Persona id is required' }, { status: 400 });
    }

    const persona = await findPersonaById(personaId);
    if (persona?.trainingZipStoragePath) {
      const provider = getStorageProvider();
      let remoteUrl = '';
      if (provider.getPublicUrl) {
        try {
          remoteUrl = await provider.getPublicUrl(persona.trainingZipStoragePath);
        } catch {
          remoteUrl = await provider.getSignedUrl(persona.trainingZipStoragePath, 60 * 10);
        }
      } else {
        remoteUrl = await provider.getSignedUrl(persona.trainingZipStoragePath, 60 * 10);
      }

      const zipBuffer = await readRemoteZip(remoteUrl);
      return new Response(zipBuffer, {
        status: 200,
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': `inline; filename="persona-${personaId}.zip"`,
        },
      });
    }

    if (persona?.trainingZipPath) {
      const zipBuffer = await fs.readFile(persona.trainingZipPath);
      return new Response(zipBuffer, {
        status: 200,
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': `inline; filename="persona-${personaId}.zip"`,
        },
      });
    }

    if (
      persona?.trainingZipUrl
      && /^https?:\/\//i.test(persona.trainingZipUrl)
      && !persona.trainingZipUrl.includes(`/api/persona/zip/${personaId}`)
    ) {
      const zipBuffer = await readRemoteZip(persona.trainingZipUrl);
      return new Response(zipBuffer, {
        status: 200,
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': `inline; filename="persona-${personaId}.zip"`,
        },
      });
    }

    if (!persona) {
      return Response.json({ error: 'Training ZIP not found' }, { status: 404 });
    }
    return Response.json({ error: 'Training ZIP not found' }, { status: 404 });
  } catch (error: any) {
    console.error('ZIP download error:', error);
    return Response.json(
      { error: 'Unable to fetch training ZIP' },
      { status: 500 }
    );
  }
}
