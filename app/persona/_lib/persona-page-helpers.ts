import { AlertTriangle, Ban, CheckCircle2, LoaderCircle, Sparkles } from 'lucide-react';

import type { PersonaSubjectType } from '@/lib/persona-subject';

export type PersonaCardStatus = 'idle' | 'training' | 'trained' | 'failed' | 'canceled';

export const getDeletedPersonaIds = () => {
  if (typeof window === 'undefined') return new Set<string>();
  const raw = localStorage.getItem('deleted_person_ids');
  if (!raw) return new Set<string>();
  try {
    const parsed = JSON.parse(raw);
    return new Set<string>(Array.isArray(parsed) ? parsed : []);
  } catch (error) {
    console.error('Failed to parse deleted personas:', error);
    return new Set<string>();
  }
};

export const persistDeletedPersonaIds = (ids: Set<string>) => {
  if (typeof window === 'undefined') return;
  localStorage.setItem('deleted_person_ids', JSON.stringify(Array.from(ids)));
};

export const formatPersonaDate = (value?: string | null) => {
  if (!value) return 'Unknown';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
};

export const getPersonaStatusMeta = (status: PersonaCardStatus) => {
  switch (status) {
    case 'trained':
      return {
        label: 'Completed',
        badgeClass: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200',
        icon: CheckCircle2,
        summaryClass: 'text-emerald-300',
        summaryText: 'Ready to use across images, ads, and videos.',
      };
    case 'failed':
      return {
        label: 'Failed',
        badgeClass: 'border-red-500/30 bg-red-500/10 text-red-200',
        icon: AlertTriangle,
        summaryClass: 'text-red-300',
        summaryText: 'Training stopped with an error. Review the details below.',
      };
    case 'canceled':
      return {
        label: 'Canceled',
        badgeClass: 'border-yellow-500/30 bg-yellow-500/10 text-yellow-200',
        icon: Ban,
        summaryClass: 'text-yellow-300',
        summaryText: 'Training was canceled before completion.',
      };
    case 'training':
      return {
        label: 'Training',
        badgeClass: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-200',
        icon: LoaderCircle,
        summaryClass: 'text-cyan-300',
        summaryText: 'Training is live and the status will update automatically.',
      };
    default:
      return {
        label: 'Idle',
        badgeClass: 'border-white/10 bg-white/5 text-gray-300',
        icon: Sparkles,
        summaryClass: 'text-gray-400',
        summaryText: 'Persona is waiting for the next action.',
      };
  }
};

export const getPersonaNames = () => {
  if (typeof window === 'undefined') return {};
  const raw = localStorage.getItem('persona_names');
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    console.error('Failed to parse persona names:', error);
    return {};
  }
};

export const persistPersonaNames = (names: Record<string, string>) => {
  if (typeof window === 'undefined') return;
  localStorage.setItem('persona_names', JSON.stringify(names));
};

export const generateTriggerWord = () => {
  const adjectives = ['cool', 'epic', 'amazing', 'stellar', 'radiant', 'mystic', 'noble', 'brave'];
  const nouns = ['hero', 'legend', 'star', 'champion', 'warrior', 'sage', 'guardian', 'spirit'];
  const randomAdj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const randomNoun = nouns[Math.floor(Math.random() * nouns.length)];
  const randomNum = Math.floor(Math.random() * 1000);
  return `${randomAdj}${randomNoun}${randomNum}`;
};

export const getSubjectGuidance = (
  subjectType: '' | PersonaSubjectType,
  recommendedMinImages: number,
  recommendedMaxImages: number
) => {
  if (subjectType === 'product') {
    return `Upload ${recommendedMinImages}-${recommendedMaxImages} clean photos of the same product from different angles. Keep logos, ports, buttons, and lighting details visible.`;
  }
  if (subjectType === 'animal') {
    return `Upload ${recommendedMinImages}-${recommendedMaxImages} clear photos of the same animal with varied angles, but keep fur pattern, markings, and proportions consistent.`;
  }
  if (subjectType === 'other') {
    return `Upload ${recommendedMinImages}-${recommendedMaxImages} clear photos of the same subject from different angles. Keep its defining shape, texture, markings, and proportions consistent across all images.`;
  }
  return `Upload ${recommendedMinImages}-${recommendedMaxImages} clear photos of the same person with varied angles, lighting, and expressions while keeping identity consistent.`;
};
