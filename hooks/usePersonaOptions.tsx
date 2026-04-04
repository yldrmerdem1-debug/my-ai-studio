'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { fetchPersonasFromApi } from '@/lib/persona-client';
import type { PersonaSubjectType } from '@/lib/persona-subject';

export type PersonaOption = {
  id: string;
  name: string;
  triggerWord?: string;
  trigger_word?: string;
  modelId?: string;
  model_id?: string;
  image_url?: string;
  imageUrl?: string;
  type?: 'visual' | 'voice';
  voiceStatus?: 'none' | 'training' | 'ready';
  visualStatus?: 'none' | 'training' | 'ready';
  status?: string;
  destinationModel?: string;
  destination_model?: string;
  weightsUrl?: string;
  weights_url?: string;
  huggingFaceUrl?: string;
  huggingface_url?: string;
  trainingBaseModel?: string;
  training_base_model?: string;
  modelFamily?: 'flux-lora';
  model_family?: 'flux-lora';
  subjectType?: PersonaSubjectType;
  subject_type?: PersonaSubjectType;
  referenceImages?: Array<{ url: string; storagePath?: string; name?: string }>;
  reference_images?: Array<{ url: string; storagePath?: string; name?: string }>;
  referenceImageCount?: number;
  reference_image_count?: number;
};

const cachedPersonasByKey = new Map<string, PersonaOption[]>();

export function usePersonaOptions(user: any) {
  const [personaOptions, setPersonaOptions] = useState<PersonaOption[]>([]);
  const cacheKey = useMemo(() => {
    const id = user?.id || 'anon';
    return `personaOptionsCache:${id}`;
  }, [user?.id]);
  const isMounted = useRef(true);

  const refresh = useCallback(async (force = false) => {
    const cachedPersonas = cachedPersonasByKey.get(cacheKey) ?? null;
    if (cachedPersonas && !force) {
      setPersonaOptions(cachedPersonas);
      return;
    }

    if (!cachedPersonas && typeof window !== 'undefined') {
      try {
        const cachedRaw = localStorage.getItem(cacheKey);
        const cachedParsed = cachedRaw ? JSON.parse(cachedRaw) : null;
        if (Array.isArray(cachedParsed) && cachedParsed.length > 0) {
          cachedPersonasByKey.set(cacheKey, cachedParsed);
          setPersonaOptions(cachedParsed);
        }
      } catch (error) {
        console.warn('Failed to read persona cache', error);
      }
    }

    try {
      const { ok, personas: personasPayload } = await fetchPersonasFromApi<PersonaOption>(user?.id);
      if (!ok && personasPayload.length === 0) {
        if (isMounted.current) setPersonaOptions([]);
        return;
      }

      if (!isMounted.current) return;
      cachedPersonasByKey.set(cacheKey, personasPayload);
      setPersonaOptions(personasPayload);
      if (typeof window !== 'undefined') {
        try {
          localStorage.setItem(cacheKey, JSON.stringify(personasPayload));
        } catch (error) {
          console.warn('Failed to write persona cache', error);
        }
      }
    } catch {
      if (isMounted.current) setPersonaOptions([]);
    }
  }, [cacheKey, user?.id]);

  useEffect(() => {
    isMounted.current = true;
    refresh();
    return () => {
      isMounted.current = false;
    };
  }, [refresh]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleUpdate = () => {
      cachedPersonasByKey.delete(cacheKey);
      refresh(true);
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        handleUpdate();
      }
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key === 'personasUpdated') {
        handleUpdate();
      }
    };

    window.addEventListener('personas:updated', handleUpdate);
    window.addEventListener('storage', handleStorage);
    window.addEventListener('focus', handleUpdate);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener('personas:updated', handleUpdate);
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('focus', handleUpdate);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [cacheKey, refresh]);

  return { personaOptions, refresh };
}
