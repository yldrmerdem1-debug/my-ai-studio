'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { User } from '@/lib/subscription';
import { canTrainVisualPersona, canTrainVoicePersona, isPremiumUser } from '@/lib/subscription';

export type PersonaStatus = 'none' | 'training' | 'ready';
export type PersonaTrainingStatus = 'training' | 'completed' | 'failed';

export type Persona = {
  id: string;
  hasVisualPersona: boolean;
  hasVoicePersona: boolean;
  visualStatus: PersonaStatus;
  voiceStatus: PersonaStatus;
  status: PersonaTrainingStatus;
  trainingId?: string;
  destinationModel?: string;
  weightsUrl?: string;
  errorMessage?: string;
  createdAt: Date;
};

type PersonaRequestResult = {
  ok: boolean;
  reason?: 'premium_required' | 'requires_20_photos' | 'requires_voice_samples';
  personaId?: string;
};

type PersonaContextValue = {
  persona: Persona | null;
  user: User | null;
  isPremiumUser: boolean;
  setUser: (user: User | null) => void;
  setIsPremiumUser: (isPremium: boolean) => void;
  requestVisualPersona: (photoCount: number) => PersonaRequestResult;
  requestVoicePersona: (totalSeconds: number) => PersonaRequestResult;
  setVisualStatus: (status: PersonaStatus) => void;
  setVoiceStatus: (status: PersonaStatus) => void;
  setPersonaStatus: (status: PersonaTrainingStatus, updates?: Partial<Persona>) => void;
  resetPersona: () => void;
};

const PersonaContext = createContext<PersonaContextValue | undefined>(undefined);

const buildPersona = (): Persona => {
  const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `persona_${Date.now()}`;
  return {
    id,
    hasVisualPersona: false,
    hasVoicePersona: false,
    visualStatus: 'none',
    voiceStatus: 'none',
    status: 'training',
    createdAt: new Date(),
  };
};

const resolveInitialUser = (): User | null => {
  if (typeof window === 'undefined') return null;
  const envUserId = process.env.NEXT_PUBLIC_PERSONA_USER_ID;
  const storedId = localStorage.getItem('localUserId');
  const id = envUserId || storedId || (typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `user_${Date.now()}`);
  if (!storedId) {
    localStorage.setItem('localUserId', id);
  }
  return {
    id,
    plan: 'free',
    isPremium: false,
  };
};

export function PersonaProvider({ children }: { children: ReactNode }) {
  const [persona, setPersona] = useState<Persona | null>(null);
  const [user, setUser] = useState<User | null>(() => resolveInitialUser());
  const isPremium = isPremiumUser(user);
  const setIsPremiumUser = useCallback((isPremium: boolean) => {
    setUser(prev => ({
      ...(prev ?? {}),
      plan: isPremium ? 'premium' : 'free',
      isPremium,
    }));
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const envUserId = process.env.NEXT_PUBLIC_PERSONA_USER_ID;
    const storedId = localStorage.getItem('localUserId');
    const id = envUserId || storedId || (typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `user_${Date.now()}`);
    if (!storedId) {
      localStorage.setItem('localUserId', id);
    }
    setUser(prev => ({
      id,
      plan: prev?.plan ?? 'free',
      isPremium: prev?.isPremium,
    }));
  }, []);

  const requestVisualPersona = useCallback((photoCount: number): PersonaRequestResult => {
    if (!canTrainVisualPersona(user)) {
      return { ok: false, reason: 'premium_required' };
    }
    if (photoCount !== 20) {
      return { ok: false, reason: 'requires_20_photos' };
    }
    let createdId: string | undefined;
    setPersona(prev => {
      const next = prev ?? buildPersona();
      createdId = next.id;
      return {
        ...next,
        hasVisualPersona: true,
        visualStatus: 'training',
        status: 'training',
      };
    });
    return { ok: true, personaId: createdId };
  }, [user]);

  const requestVoicePersona = useCallback((totalSeconds: number): PersonaRequestResult => {
    if (!canTrainVoicePersona(user)) {
      return { ok: false, reason: 'premium_required' };
    }
    if (totalSeconds < 120 || totalSeconds > 300) {
      return { ok: false, reason: 'requires_voice_samples' };
    }
    let createdId: string | undefined;
    setPersona(prev => {
      const next = prev ?? buildPersona();
      createdId = next.id;
      return {
        ...next,
        hasVoicePersona: true,
        voiceStatus: 'training',
      };
    });
    return { ok: true, personaId: createdId };
  }, [user]);

  const setVisualStatus = useCallback((status: PersonaStatus) => {
    if (!canTrainVisualPersona(user)) return;
    setPersona(prev => {
      if (!prev || !prev.hasVisualPersona) return prev;
      return {
        ...prev,
        visualStatus: status,
        status: status === 'ready' ? 'completed' : prev.status,
      };
    });
  }, [user]);

  const setVoiceStatus = useCallback((status: PersonaStatus) => {
    if (!canTrainVoicePersona(user)) return;
    setPersona(prev => {
      if (!prev || !prev.hasVoicePersona) return prev;
      return { ...prev, voiceStatus: status };
    });
  }, [user]);

  const setPersonaStatus = useCallback((status: PersonaTrainingStatus, updates?: Partial<Persona>) => {
    setPersona(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        status,
        visualStatus: status === 'completed' ? 'ready' : prev.visualStatus,
        ...(updates ?? {}),
      };
    });
  }, []);

  const resetPersona = useCallback(() => {
    setPersona(null);
  }, []);

  const value = useMemo(() => ({
    persona,
    user,
    isPremiumUser: isPremium,
    setUser,
    setIsPremiumUser,
    requestVisualPersona,
    requestVoicePersona,
    setVisualStatus,
    setVoiceStatus,
    setPersonaStatus,
    resetPersona,
  }), [
    persona,
    user,
    isPremium,
    setUser,
    setIsPremiumUser,
    requestVisualPersona,
    requestVoicePersona,
    setVisualStatus,
    setVoiceStatus,
    setPersonaStatus,
    resetPersona,
  ]);

  return (
    <PersonaContext.Provider value={value}>
      {children}
    </PersonaContext.Provider>
  );
}

export function usePersona() {
  const context = useContext(PersonaContext);
  if (!context) {
    throw new Error('usePersona must be used within PersonaProvider');
  }
  return context;
}
