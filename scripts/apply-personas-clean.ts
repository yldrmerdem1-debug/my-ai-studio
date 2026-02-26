import fs from 'node:fs/promises';
import path from 'node:path';

type Persona = Record<string, any> & { personaId?: string; id?: string };

const PERSONAS_PATH = path.join(process.cwd(), 'data', 'personas.json');
const CLEAN_PATH = path.join(process.cwd(), 'data', 'personas_clean.json');

const safeTrim = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const isDataUri = (value: string) => value.trim().toLowerCase().startsWith('data:') && value.includes('base64,');

function normalizePersonaId(p: Persona): string {
  return safeTrim(p?.personaId) || safeTrim(p?.id);
}

function stripBloatedStrings(obj: Record<string, any>) {
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v !== 'string') continue;
    const s = v.trim();
    if (!s) continue;
    if (isDataUri(s)) {
      delete obj[k];
      continue;
    }
    // guardrail: remove extremely large strings (likely base64 blobs)
    if (s.length > 250_000) {
      delete obj[k];
    }
  }
}

async function readJsonArray(filePath: string): Promise<any[]> {
  const raw = await fs.readFile(filePath, 'utf-8');
  const parsed = raw ? JSON.parse(raw) : [];
  return Array.isArray(parsed) ? parsed : [];
}

async function main() {
  const personas: Persona[] = await readJsonArray(PERSONAS_PATH);
  const clean: Persona[] = await readJsonArray(CLEAN_PATH);

  const cleanById = new Map<string, Persona>();
  for (const row of clean) {
    const id = normalizePersonaId(row);
    if (!id) continue;
    cleanById.set(id, row);
  }

  const byId = new Map<string, Persona>();
  for (const p of personas) {
    const id = normalizePersonaId(p);
    if (!id) continue;
    byId.set(id, p);
  }

  let updated = 0;
  let added = 0;

  for (const [id, c] of cleanById.entries()) {
    const hf = safeTrim((c as any).huggingFaceUrl) || safeTrim((c as any).huggingfaceUrl);
    const weights = safeTrim((c as any).weightsUrl) || safeTrim((c as any).weights_url);
    if (!hf && !weights) continue; // nothing to merge

    const existing = byId.get(id);
    if (existing) {
      existing.personaId = safeTrim(existing.personaId) || id;
      if (hf) existing.huggingFaceUrl = hf;
      if (weights) existing.weightsUrl = weights;
      if (!safeTrim(existing.triggerWord) && safeTrim((c as any).triggerWord)) existing.triggerWord = (c as any).triggerWord;
      if (!safeTrim(existing.name) && safeTrim((c as any).name)) existing.name = (c as any).name;
      if (!safeTrim(existing.trainingId) && safeTrim((c as any).trainingId)) existing.trainingId = (c as any).trainingId;
      if (!safeTrim(existing.modelId) && safeTrim((c as any).modelId)) existing.modelId = (c as any).modelId;
      updated += 1;
    } else {
      personas.push({
        personaId: id,
        userId: (c as any).userId,
        name: (c as any).name,
        triggerWord: (c as any).triggerWord,
        modelId: (c as any).modelId,
        trainingId: (c as any).trainingId,
        status: (c as any).status,
        imageUrl: (c as any).imageUrl,
        huggingFaceUrl: hf || undefined,
        weightsUrl: weights || undefined,
      });
      added += 1;
    }
  }

  // sanitize: remove base64 / huge blobs from personas.json
  for (const p of personas) stripBloatedStrings(p);

  await fs.writeFile(PERSONAS_PATH, JSON.stringify(personas, null, 2), 'utf-8');

  console.log('Applied HF links from personas_clean.json');
  console.log('Updated personas:', updated);
  console.log('Added personas:', added);
  console.log('Wrote:', PERSONAS_PATH);
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});

