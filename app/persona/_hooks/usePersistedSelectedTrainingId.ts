'use client';

import { useEffect } from 'react';
import type { Dispatch, SetStateAction } from 'react';

type UsePersistedSelectedTrainingIdArgs = {
  selectedPersonaId: string | null;
  setSelectedPersonaId: Dispatch<SetStateAction<string | null>>;
  setTrainingId: Dispatch<SetStateAction<string>>;
  setTriggerWord: Dispatch<SetStateAction<string>>;
};

export const usePersistedSelectedTrainingId = ({
  selectedPersonaId,
  setSelectedPersonaId,
  setTrainingId,
  setTriggerWord,
}: UsePersistedSelectedTrainingIdArgs) => {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = localStorage.getItem('selectedPersonaTrainingId');
    if (!stored) return;

    setSelectedPersonaId(stored);
    setTrainingId(stored);

    const storedTriggerMap = localStorage.getItem('personaTriggerWords');
    if (!storedTriggerMap) return;
    try {
      const triggerMap = JSON.parse(storedTriggerMap);
      setTriggerWord(triggerMap?.[stored] ?? '');
    } catch (error) {
      console.error('Failed to parse persona trigger words:', error);
    }
  }, [setSelectedPersonaId, setTrainingId, setTriggerWord]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (selectedPersonaId) {
      localStorage.setItem('selectedPersonaTrainingId', selectedPersonaId);
    } else {
      localStorage.removeItem('selectedPersonaTrainingId');
    }
  }, [selectedPersonaId]);
};
