'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
export type PersonaDbStatus = 'idle' | 'training' | 'completed' | 'failed';
export type PersonaDisplayStatus = 'idle' | 'training' | 'trained' | 'failed';

export type PersonaItem = {
  dbId?: string | null;
  personaKey: string;
  id: string;
  name?: string | null;
  type?: 'visual' | 'voice';
  trainingId?: string | null;
  modelId?: string | null;
  createdAt?: string | null;
  dbStatus: PersonaDbStatus;
  status: PersonaDisplayStatus;
  progress?: number | null;
};

const normalizeDbStatus = (raw?: string | null): PersonaDbStatus => {
  if (raw === 'completed') return 'completed';
  if (raw === 'training') return 'training';
  if (raw === 'failed') return 'failed';
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

  const refresh = useCallback(async () => {
    if (!userId) return;
    setIsLoading(true);
    setError(null);
    const response = await fetch(`/api/save-persona?userId=${userId}`);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (isMounted.current) {
        setError('Failed to load personas');
        setIsLoading(false);
      }
      return;
    }

    const baseItems = (payload?.personas ?? []).map((row: any) => {
      const dbStatus = normalizeDbStatus(row.status);
      const personaKey = row.training_id ?? row.model_id ?? row.id ?? row.persona_id ?? row.personaId;
      return {
        dbId: row.id ?? null,
        personaKey,
        id: personaKey,
        name: row.name ?? null,
        type: row.type ?? 'visual',
        trainingId: row.training_id ?? null,
        modelId: row.model_id ?? null,
        createdAt: row.created_at ?? null,
        dbStatus,
        status: normalizeDisplayStatus(dbStatus),
        progress: null,
      } as PersonaItem;
    });

    if (isMounted.current) {
      setPersonas(baseItems);
    }

    const trainingItems = baseItems.filter(item => item.dbStatus === 'training');
    if (trainingItems.length === 0) {
      if (isMounted.current) setIsLoading(false);
      return;
    }

    const updates = await Promise.all(trainingItems.map(async (item) => {
      const response = await fetch(`/api/persona/${item.id}/training-status`);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        return { id: item.id, dbStatus: item.dbStatus, status: item.status, progress: null };
      }
      const nextDbStatus = normalizeDbStatus(payload?.status);
      return {
        id: item.id,
        dbStatus: nextDbStatus,
        status: normalizeDisplayStatus(nextDbStatus),
        progress: typeof payload?.progress === 'number' ? payload.progress : null,
      };
    }));

    if (isMounted.current) {
      setPersonas(prev => prev.map(item => {
        const update = updates.find(next => next.id === item.id);
        return update ? { ...item, ...update } : item;
      }));
      setIsLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    isMounted.current = true;
    refresh();
    return () => {
      isMounted.current = false;
    };
  }, [refresh]);

  return useMemo(() => ({
    personas,
    isLoading,
    error,
    refresh,
  }), [personas, isLoading, error, refresh]);
}
