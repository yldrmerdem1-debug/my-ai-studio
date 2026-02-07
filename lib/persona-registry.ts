import fs from 'fs/promises';
import path from 'path';

export type PersonaTrainingStatus = 'training' | 'completed' | 'failed';
export type PersonaStatus = 'none' | 'training' | 'ready';

export type PersonaRecord = {
  personaId: string;
  userId: string;
  name?: string;
  triggerWord?: string;
  modelId?: string;
  trainingId?: string;
  trainingZipUrl?: string;
  trainingZipPath?: string;
  imageUrl?: string;
  status?: PersonaTrainingStatus;
  weightsUrl?: string;
  destinationModel?: string;
  errorMessage?: string;
  createdAt?: string;
  completedAt?: string;
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
    if (error instanceof SyntaxError) {
      const corruptPath = PERSONAS_DB_PATH.replace(
        /\.json$/,
        `.corrupt-${Date.now()}.json`
      );
      try {
        await fs.rename(PERSONAS_DB_PATH, corruptPath);
      } catch (renameError) {
        console.error('Failed to move corrupt personas file:', renameError);
      }
      return [];
    }
    throw error;
  }
}

export async function writePersonas(personas: PersonaRecord[]) {
  await ensureDataDir();
  const tempPath = PERSONAS_DB_PATH.replace(/\.json$/, `.tmp-${Date.now()}.json`);
  await fs.writeFile(tempPath, JSON.stringify(personas, null, 2));
  await fs.rename(tempPath, PERSONAS_DB_PATH);
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
