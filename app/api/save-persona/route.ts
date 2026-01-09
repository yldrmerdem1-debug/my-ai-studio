import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

// Simple file-based database for personas
// In production, replace with a real database (PostgreSQL, MongoDB, etc.)
const PERSONAS_DB_PATH = path.join(process.cwd(), 'data', 'personas.json');

interface PersonaData {
  triggerWord: string;
  modelId: string;
  trainingId: string;
  createdAt: string;
  imageCount: number;
}

async function ensureDataDir() {
  const dataDir = path.join(process.cwd(), 'data');
  try {
    await fs.access(dataDir);
  } catch {
    await fs.mkdir(dataDir, { recursive: true });
  }
}

async function readPersonas(): Promise<PersonaData[]> {
  try {
    await ensureDataDir();
    const data = await fs.readFile(PERSONAS_DB_PATH, 'utf-8');
    return JSON.parse(data);
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

async function writePersonas(personas: PersonaData[]) {
  await ensureDataDir();
  await fs.writeFile(PERSONAS_DB_PATH, JSON.stringify(personas, null, 2));
}

export async function POST(request: NextRequest) {
  try {
    const personaData: PersonaData = await request.json();

    if (!personaData.triggerWord || !personaData.modelId) {
      return NextResponse.json(
        { error: 'Trigger word and model ID are required' },
        { status: 400 }
      );
    }

    const personas = await readPersonas();
    
    // Check if persona already exists
    const existingIndex = personas.findIndex(
      p => p.triggerWord === personaData.triggerWord
    );

    if (existingIndex >= 0) {
      // Update existing persona
      personas[existingIndex] = personaData;
    } else {
      // Add new persona
      personas.push(personaData);
    }

    await writePersonas(personas);

    return NextResponse.json({
      success: true,
      message: 'Persona saved successfully',
      persona: personaData,
    });

  } catch (error: any) {
    console.error('Save persona error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to save persona' },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const personas = await readPersonas();
    return NextResponse.json({ personas });
  } catch (error: any) {
    console.error('Get personas error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to get personas' },
      { status: 500 }
    );
  }
}
