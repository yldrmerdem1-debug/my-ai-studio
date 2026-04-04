export type PersonaSubjectType = 'human' | 'animal' | 'product' | 'other';

const SUBJECT_TYPE_ALIASES: Record<string, PersonaSubjectType> = {
  human: 'human',
  person: 'human',
  live: 'human',
  living: 'human',
  animal: 'animal',
  pet: 'animal',
  creature: 'animal',
  product: 'product',
  object: 'product',
  item: 'product',
  nonliving: 'product',
  'non-living': 'product',
  other: 'other',
  custom: 'other',
  misc: 'other',
  miscellaneous: 'other',
};

export const PERSONA_SUBJECT_TYPE_LABELS: Record<PersonaSubjectType, string> = {
  human: 'Human',
  animal: 'Animal',
  product: 'Product / Object',
  other: 'Other',
};

export const normalizePersonaSubjectType = (value: unknown): PersonaSubjectType | undefined => {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return undefined;
  return SUBJECT_TYPE_ALIASES[raw];
};

export const isPersonaSubjectType = (value: unknown): value is PersonaSubjectType =>
  Boolean(normalizePersonaSubjectType(value));

export const isHumanPersonaSubject = (value: unknown) =>
  normalizePersonaSubjectType(value) === 'human';

export const isLivingPersonaSubject = (value: unknown) => {
  const normalized = normalizePersonaSubjectType(value);
  return normalized === 'human' || normalized === 'animal';
};
