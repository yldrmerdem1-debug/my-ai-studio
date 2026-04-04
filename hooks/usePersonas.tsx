'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { fetchPersonasFromApi } from '@/lib/persona-client';
import type { PersonaSubjectType } from '@/lib/persona-subject';
export type PersonaDbStatus = 'idle' | 'training' | 'completed' | 'failed' | 'canceled';
export type PersonaDisplayStatus = 'idle' | 'training' | 'trained' | 'failed' | 'canceled';

export type PersonaItem = {
  dbId?: string | null;
  personaKey: string;
  id: string;
  name?: string | null;
  type?: 'visual' | 'voice';
  trainingId?: string | null;
  modelId?: string | null;
  subjectType?: PersonaSubjectType | null;
  trainingBaseModel?: string | null;
  modelFamily?: string | null;
  imageCount?: number | null;
  referenceImageCount?: number | null;
  createdAt?: string | null;
  completedAt?: string | null;
  dbStatus: PersonaDbStatus;
  status: PersonaDisplayStatus;
  progress?: number | null;
  errorMessage?: string | null;
};

const normalizeDbStatus = (raw?: string | null): PersonaDbStatus => {
  if (raw === 'active') return 'completed';
  if (raw === 'completed') return 'completed';
  if (raw === 'training') return 'training';
  if (raw === 'failed') return 'failed';
  if (raw === 'canceled') return 'canceled';
  return 'idle';
};

const normalizeDisplayStatus = (dbStatus: PersonaDbStatus): PersonaDisplayStatus => {
  if (dbStatus === 'completed') return 'trained';
  return dbStatus;
};

export function usePersonas(userId?: string | null) {
  const [personas, setPersonas] = useState<PersonaItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isMounted = useRef(true);

  const refresh = useCallback(async (options?: { silent?: boolean }) => {
    if (!userId) return;
    const shouldShowLoading = !options?.silent;
    if (shouldShowLoading) {
      setIsLoading(true);
    }
    setError(null);
    try {
      const { ok, personas: rows } = await fetchPersonasFromApi<any>(userId);
      if (!ok) {
        if (isMounted.current) setError('Failed to load personas');
        return;
      }

      const baseItems: PersonaItem[] = rows.map((row: any) => {
        const dbStatus = normalizeDbStatus(row.status);
        const personaKey = row.training_id ?? row.model_id ?? row.id ?? row.persona_id ?? row.personaId;
        const hasTrackableTraining = Boolean(row.training_id ?? row.model_id);
        const effectiveDbStatus =
          dbStatus === 'training' && !hasTrackableTraining
            ? 'failed'
            : dbStatus;
        return {
          dbId: row.id ?? null,
          personaKey,
          id: personaKey,
          name: row.name ?? null,
          type: row.type ?? 'visual',
          trainingId: row.training_id ?? null,
          modelId: row.model_id ?? null,
          subjectType: row.subjectType ?? row.subject_type ?? null,
          trainingBaseModel: row.trainingBaseModel ?? row.training_base_model ?? null,
          modelFamily: row.modelFamily ?? row.model_family ?? null,
          imageCount: row.imageCount ?? row.image_count ?? null,
          referenceImageCount: row.referenceImageCount ?? row.reference_image_count ?? null,
          createdAt: row.created_at ?? null,
          completedAt: row.completed_at ?? null,
          dbStatus: effectiveDbStatus,
          status: normalizeDisplayStatus(effectiveDbStatus),
          progress: null,
          errorMessage:
            row.error_message
            ?? row.errorMessage
            ?? (dbStatus === 'training' && !hasTrackableTraining
              ? 'Training record is missing a valid training id.'
              : null),
        } as PersonaItem;
      });

      if (isMounted.current) {
        setPersonas(baseItems);
      }

      const trainingItems = baseItems.filter((item: PersonaItem) => item.dbStatus === 'training');
      if (trainingItems.length === 0) {
        return;
      }

      const updates = await Promise.all(trainingItems.map(async (item) => {
        const response = await fetch(`/api/persona/${item.id}/training-status`);
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          return {
            id: item.id,
            dbStatus: response.status === 404 ? 'failed' : item.dbStatus,
            status: response.status === 404 ? 'failed' : item.status,
            progress: null,
            errorMessage:
              payload?.error
              ?? (response.status === 404 ? 'Training record could not be resolved.' : item.errorMessage ?? null),
          };
        }
        const nextDbStatus = normalizeDbStatus(payload?.status);
        return {
          id: item.id,
          dbStatus: nextDbStatus,
          status: normalizeDisplayStatus(nextDbStatus),
          progress: typeof payload?.progress === 'number' ? payload.progress : null,
          errorMessage: payload?.error ?? item.errorMessage ?? null,
        };
      }));

      if (isMounted.current) {
        const updateMap = new Map(updates.map((update) => [update.id, update]));
        setPersonas((prev) => prev.map((item) => {
          const update = updateMap.get(item.id);
          return update ? { ...item, ...update } : item;
        }));
      }
    } catch {
      if (isMounted.current) {
        setError('Failed to load personas');
      }
    } finally {
      if (isMounted.current && shouldShowLoading) {
        setIsLoading(false);
      }
    }
  }, [userId]);

  useEffect(() => {
    isMounted.current = true;
    refresh();
    return () => {
      isMounted.current = false;
    };
  }, [refresh]);

  useEffect(() => {
    if (!userId) return;
    const intervalId = window.setInterval(() => {
      refresh({ silent: true }).catch(() => undefined);
    }, 5000);

    const refreshOnFocus = () => {
      refresh({ silent: true }).catch(() => undefined);
    };

    const refreshOnVisibility = () => {
      if (document.visibilityState === 'visible') {
        refresh({ silent: true }).catch(() => undefined);
      }
    };

    window.addEventListener('focus', refreshOnFocus);
    window.addEventListener('personas:updated', refreshOnFocus);
    document.addEventListener('visibilitychange', refreshOnVisibility);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', refreshOnFocus);
      window.removeEventListener('personas:updated', refreshOnFocus);
      document.removeEventListener('visibilitychange', refreshOnVisibility);
    };
  }, [refresh, userId]);

  return useMemo(() => ({
    personas,
    isLoading,
    error,
    refresh,
  }), [personas, isLoading, error, refresh]);
}
