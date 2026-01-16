import fs from 'fs/promises';
import path from 'path';

export type PersonaStatus = 'none' | 'training' | 'ready';

export type PersonaRecord = {
  personaId: string;
  userId: string;
  triggerWord?: string;
  modelId?: string;
  trainingId?: string;
  createdAt?: string;
  imageCount?: number;
  visualStatus?: PersonaStatus;
  voiceStatus?: PersonaStatus;
};

const PERSONAS_DB_PATH = path.join(process.cwd(), 'data', 'personas.json');

async function ensureDataDir() {
  const dataDir = path.join(process.cwd(), 'data');
  try {
    await fs.access(dataDir);
  } catch {
    await fs.mkdir(dataDir, { recursive: true });
  }
}

export async function readPersonas(): Promise<PersonaRecord[]> {
  try {
    await ensureDataDir();
    const data = await fs.readFile(PERSONAS_DB_PATH, 'utf-8');
    return JSON.parse(data) as PersonaRecord[];
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

export async function writePersonas(personas: PersonaRecord[]) {
  await ensureDataDir();
  await fs.writeFile(PERSONAS_DB_PATH, JSON.stringify(personas, null, 2));
}

export async function findPersonaById(personaId: string): Promise<PersonaRecord | undefined> {
  const personas = await readPersonas();
  return personas.find(persona => persona.personaId === personaId);
}

export async function upsertPersona(record: PersonaRecord) {
  const personas = await readPersonas();
  const existingIndex = personas.findIndex(persona => persona.personaId === record.personaId);
  if (existingIndex >= 0) {
    personas[existingIndex] = { ...personas[existingIndex], ...record };
  } else {
    personas.push(record);
  }
  await writePersonas(personas);
}
