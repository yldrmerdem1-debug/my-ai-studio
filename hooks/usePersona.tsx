'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { User } from '@/lib/subscription';
import { canTrainVisualPersona, canTrainVoicePersona, isPremiumUser } from '@/lib/subscription';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';

export type PersonaStatus = 'none' | 'training' | 'ready';
export type PersonaTrainingStatus = 'training' | 'completed' | 'failed' | 'canceled';

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
  reason?: 'premium_required' | 'requires_training_images' | 'requires_voice_samples';
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
    fullName: 'Guest workspace',
    plan: 'free',
    isPremium: false,
  };
};

const mapAuthUserToAppUser = (authUser: any): User => {
  const plan = authUser?.user_metadata?.plan === 'premium' || authUser?.app_metadata?.plan === 'premium'
    ? 'premium'
    : 'free';
  const metadata = authUser?.user_metadata || {};
  const appMetadata = authUser?.app_metadata || {};
  const firstName = String(metadata.first_name || metadata.firstName || '').trim();
  const lastName = String(metadata.last_name || metadata.lastName || '').trim();
  const fullName = String(
    metadata.full_name
    || metadata.name
    || [firstName, lastName].filter(Boolean).join(' ')
    || authUser.email?.split('@')?.[0]
    || ''
  ).trim();
  return {
    id: authUser.id,
    email: authUser.email,
    firstName: firstName || undefined,
    lastName: lastName || undefined,
    fullName: fullName || undefined,
    username: String(metadata.username || metadata.user_name || '').trim() || undefined,
    avatarUrl: String(metadata.avatar_url || metadata.picture || metadata.avatarUrl || '').trim() || undefined,
    isAdmin: appMetadata.role === 'admin' || metadata.role === 'admin',
    plan,
    isPremium: plan === 'premium',
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
    const supabase = getSupabaseBrowserClient();
    let cancelled = false;

    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      const authUser = data.session?.user;
      if (authUser?.id) {
        localStorage.setItem('localUserId', authUser.id);
        setUser(mapAuthUserToAppUser(authUser));
        return;
      }

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
        fullName: prev?.fullName ?? 'Guest workspace',
        plan: prev?.plan ?? 'free',
        isPremium: prev?.isPremium,
      }));
    }).catch(() => {
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
        fullName: prev?.fullName ?? 'Guest workspace',
        plan: prev?.plan ?? 'free',
        isPremium: prev?.isPremium,
      }));
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      const authUser = session?.user;
      if (authUser?.id) {
        localStorage.setItem('localUserId', authUser.id);
        localStorage.setItem('assetCacheUserId', authUser.id);
        setUser(mapAuthUserToAppUser(authUser));
        return;
      }
      setUser(resolveInitialUser());
    });

    return () => {
      cancelled = true;
      listener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const envUserId = process.env.NEXT_PUBLIC_PERSONA_USER_ID;
    const storedId = localStorage.getItem('localUserId');
    if (storedId || envUserId) return;
    const id = envUserId || storedId || (typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `user_${Date.now()}`);
    if (!storedId) {
      localStorage.setItem('localUserId', id);
    }
    setUser(prev => ({
      id,
      fullName: prev?.fullName ?? 'Guest workspace',
      plan: prev?.plan ?? 'free',
      isPremium: prev?.isPremium,
    }));
  }, []);

  const requestVisualPersona = useCallback((photoCount: number): PersonaRequestResult => {
    if (!canTrainVisualPersona(user)) {
      return { ok: false, reason: 'premium_required' };
    }
    if (photoCount < 4) {
      return { ok: false, reason: 'requires_training_images' };
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
        visualStatus:
          status === 'completed'
            ? 'ready'
            : status === 'failed' || status === 'canceled'
              ? 'none'
              : prev.visualStatus,
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
