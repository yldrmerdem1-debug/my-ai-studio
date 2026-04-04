'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Sidebar from '@/components/Sidebar';
import PricingModal from '@/components/PricingModal';
import Link from 'next/link';
import { Sparkles, Camera, Target, Lock, Pencil, Trash2 } from 'lucide-react';
import { usePersona } from '@/hooks/usePersona';
import { usePersonas } from '@/hooks/usePersonas';
import { fileToDataUrl } from '@/lib/client/file-data-url';
import {
  getPersonaTrainingProfile,
  getTrainingEngineLabel,
} from '@/lib/persona-pipeline';
import { PERSONA_SUBJECT_TYPE_LABELS, type PersonaSubjectType } from '@/lib/persona-subject';
import { canTrainVisualPersona } from '@/lib/subscription';
import {
  formatPersonaDate,
  generateTriggerWord,
  getDeletedPersonaIds,
  getPersonaNames,
  getPersonaStatusMeta,
  getSubjectGuidance,
  persistDeletedPersonaIds,
  persistPersonaNames,
} from '@/app/persona/_lib/persona-page-helpers';
import { usePersistedSelectedTrainingId } from '@/app/persona/_hooks/usePersistedSelectedTrainingId';

export default function PersonaPage() {
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
  const [referenceFiles, setReferenceFiles] = useState<File[]>([]);
  const [isTraining, setIsTraining] = useState(false);
  const [trainingProgress, setTrainingProgress] = useState<number>(0);
  const [trainingStatus, setTrainingStatus] = useState<string>('');
  const [isTrainingIndeterminate, setIsTrainingIndeterminate] = useState(false);
  const [trainingError, setTrainingError] = useState<string | null>(null);
  const [isUploadingImages, setIsUploadingImages] = useState(false);
  const [personaName, setPersonaName] = useState('');
  const [subjectType, setSubjectType] = useState<'' | PersonaSubjectType>('');
  const [gender, setGender] = useState<'' | 'male' | 'female'>('');
  const [triggerWord, setTriggerWord] = useState<string>('');
  const [trainingId, setTrainingId] = useState<string>('');
  const [isTrainingComplete, setIsTrainingComplete] = useState(false);
  const [completedModelId, setCompletedModelId] = useState<string | null>(null);
  const [isPricingModalOpen, setIsPricingModalOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const referenceInputRef = useRef<HTMLInputElement>(null);
  const [trainedPersonas, setTrainedPersonas] = useState<Array<{
    dbId?: string | null;
    personaKey: string;
    id: string;
    status: 'idle' | 'training' | 'trained' | 'failed' | 'canceled';
    dbStatus: 'idle' | 'training' | 'completed' | 'failed' | 'canceled';
    createdAt?: string | null;
    completedAt?: string | null;
    name?: string | null;
    type?: 'visual' | 'voice';
    subjectType?: PersonaSubjectType | null;
    trainingBaseModel?: string | null;
    imageCount?: number | null;
    referenceImageCount?: number | null;
    progress?: number | null;
    errorMessage?: string | null;
  }>>([]);
  const [selectedPersonaId, setSelectedPersonaId] = useState<string | null>(null);
  const [isRenameOpen, setIsRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [renameTargetId, setRenameTargetId] = useState<string | null>(null);
  const [cancelingPersonaId, setCancelingPersonaId] = useState<string | null>(null);
  const [isRefreshingTrainingStatus, setIsRefreshingTrainingStatus] = useState(false);
  const { user, persona, requestVisualPersona, setVisualStatus, setPersonaStatus, setIsPremiumUser } = usePersona();
  const {
    personas: dbPersonas,
    isLoading: isLoadingPersonas,
    refresh: refreshPersonas,
  } = usePersonas(user?.id);
  const canTrainVisual = canTrainVisualPersona(user);
  const visualStatus = persona?.visualStatus ?? 'none';
  const FORCE_PREMIUM_PREVIEW = true;
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isHumanSubject = subjectType === 'human';
  const trainingProfile = getPersonaTrainingProfile(subjectType || 'human');
  const subjectGuidance = useMemo(
    () => getSubjectGuidance(subjectType, trainingProfile.recommendedMinImages, trainingProfile.recommendedMaxImages),
    [subjectType, trainingProfile.recommendedMinImages, trainingProfile.recommendedMaxImages]
  );
  const subjectSummary = subjectType
    ? PERSONA_SUBJECT_TYPE_LABELS[subjectType]
    : 'Subject';
  const providerStackDescription = trainingProfile.provider === 'replicate'
    ? 'Provider stack: Replicate FLUX Dev LoRA trainer only for maximum fidelity. No lower-quality fallback is used.'
    : 'Provider stack: fal.ai portrait trainer first for maximum human identity fidelity, Replicate FLUX Dev LoRA fallback if fal.ai is unavailable.';

  const clearSelectedTrainingId = useCallback(() => {
    setSelectedPersonaId(null);
    setTrainingId('');
    if (typeof window !== 'undefined') {
      localStorage.removeItem('selectedPersonaTrainingId');
    }
  }, []);

  const handleCancelTraining = async (personaKey: string, dbId?: string | null) => {
    if (!window.confirm('Are you sure you want to cancel this training?')) return;
    if (cancelingPersonaId === personaKey) return;

    stopPolling();
    setCancelingPersonaId(personaKey);

    try {
      const response = await fetch('/api/persona/training-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          personaId: personaKey,
          trainingId: personaKey,
          dbId: dbId ?? undefined,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || 'Training could not be canceled');
      }

      if (data?.status === 'completed') {
        applyTrainingStatus('completed', null, personaKey, 100);
        await refreshPersonas({ silent: true }).catch(() => undefined);
        return;
      }

      const resolvedStatus = data?.status === 'failed' ? 'failed' : 'canceled';
      const resolvedMessage =
        data?.error
        || (resolvedStatus === 'failed' ? 'Training failed.' : 'Training canceled by user.');

      clearTrainingUi(resolvedStatus === 'failed' ? 'Training failed' : 'Training canceled');
      setTrainingError(resolvedMessage);
      setVisualStatus('none');
      setPersonaStatus(resolvedStatus as 'failed' | 'canceled');
      clearSelectedTrainingId();
      setTrainedPersonas(prev => prev.map(item => (
        item.personaKey === personaKey
          ? {
              ...item,
              status: resolvedStatus,
              dbStatus: resolvedStatus,
              progress: null,
              errorMessage: resolvedMessage,
            }
          : item
      )));
      await refreshPersonas({ silent: true }).catch(() => undefined);
      if (typeof window !== 'undefined') {
        localStorage.setItem('personasUpdated', String(Date.now()));
        window.dispatchEvent(new CustomEvent('personas:updated'));
      }
    } catch (error) {
      console.error('Cancel failed:', error);
      setTrainingError(error instanceof Error ? error.message : 'Training could not be canceled');
    } finally {
      setCancelingPersonaId((current) => (current === personaKey ? null : current));
    }
  };

  useEffect(() => {
    if (FORCE_PREMIUM_PREVIEW) {
      setIsPremiumUser(true);
    }
  }, [FORCE_PREMIUM_PREVIEW, setIsPremiumUser]);

  useEffect(() => {
    if (subjectType !== 'human' && gender) {
      setGender('');
    }
  }, [gender, subjectType]);

  useEffect(() => {
    if (!isRenameOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeRenameModal();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isRenameOpen]);

  usePersistedSelectedTrainingId({
    selectedPersonaId,
    setSelectedPersonaId,
    setTrainingId,
    setTriggerWord,
  });

  useEffect(() => {
    if (!dbPersonas.length) {
      return;
    }
    const deletedIds = getDeletedPersonaIds();
    const nameMap = getPersonaNames();
    const next = dbPersonas
      .filter(item => item.dbStatus === 'training' || !deletedIds.has(item.personaKey))
      .map(item => ({
        dbId: item.dbId ?? null,
        personaKey: item.personaKey,
        id: item.personaKey,
        status: item.status,
        dbStatus: item.dbStatus,
        createdAt: item.createdAt,
        completedAt: item.completedAt ?? null,
        name: item.name ?? nameMap?.[item.personaKey] ?? null,
        type: item.type ?? 'visual',
        subjectType: item.subjectType ?? null,
        trainingBaseModel: item.trainingBaseModel ?? null,
        imageCount: item.imageCount ?? null,
        referenceImageCount: item.referenceImageCount ?? null,
        progress: item.progress ?? null,
        errorMessage: item.errorMessage ?? null,
      }));
    setTrainedPersonas(next);
  }, [dbPersonas]);

  const activeTraining = useMemo(
    () => [...trainedPersonas]
      .filter(item => item.status === 'training')
      .sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime())[0] ?? null,
    [trainedPersonas]
  );
  const showTrainingBanner = Boolean(activeTraining || isUploadingImages || isTraining);

  useEffect(() => {
    if (!activeTraining) return;
    setIsTraining(true);
    setIsTrainingComplete(false);
    setTrainingError(null);
    setTrainingStatus('Persona training in progress');
    setTrainingId(activeTraining.personaKey);
    if (typeof activeTraining.progress === 'number') {
      setIsTrainingIndeterminate(false);
      setTrainingProgress(activeTraining.progress);
    } else {
      setIsTrainingIndeterminate(true);
    }
  }, [activeTraining]);

  const clearTrainingUi = useCallback((message?: string) => {
    setIsTraining(false);
    setIsTrainingIndeterminate(false);
    setTrainingProgress(0);
    setIsTrainingComplete(false);
    setTrainingError(null);
    setTrainingStatus(message ?? '');
    setTrainingId('');
  }, []);
  const openRenameModal = (id: string, currentName?: string | null) => {
    setRenameTargetId(id);
    setRenameValue(currentName?.trim() ? currentName : '');
    setIsRenameOpen(true);
  };

  const closeRenameModal = () => {
    setIsRenameOpen(false);
    setRenameValue('');
    setRenameTargetId(null);
  };

  const saveRename = () => {
    if (!renameTargetId) {
      closeRenameModal();
      return;
    }
    const nameMap = getPersonaNames();
    nameMap[renameTargetId] = renameValue.trim() || 'Untitled Persona';
    persistPersonaNames(nameMap);
    setTrainedPersonas(prev => prev.map(item => (
      item.id === renameTargetId
        ? { ...item, name: nameMap[renameTargetId] }
        : item
    )));
    fetch('/api/save-persona', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        personaId: renameTargetId,
        name: nameMap[renameTargetId],
        user,
      }),
    }).catch((error) => {
      console.error('Failed to save persona name:', error);
    });
    closeRenameModal();
  };

  const personaList = trainedPersonas;

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!canTrainVisual) {
      setIsPricingModalOpen(true);
      alert('Premium plan required to upload photos for persona training.');
      return;
    }
    const files = Array.from(e.target.files || []);
    const imageFiles = files.filter(file => file.type.startsWith('image/'));

    if (imageFiles.length + uploadedFiles.length > trainingProfile.maxImages) {
      alert(`Maximum ${trainingProfile.maxImages} training images allowed for this subject type.`);
      return;
    }

    setUploadedFiles(prev => [...prev, ...imageFiles]);
  };

  const removeFile = (index: number) => {
    setUploadedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleReferenceFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!canTrainVisual) {
      setIsPricingModalOpen(true);
      alert('Premium plan required to upload reference images.');
      return;
    }
    const files = Array.from(e.target.files || []);
    const imageFiles = files.filter(file => file.type.startsWith('image/'));

    if (imageFiles.length + referenceFiles.length > trainingProfile.referenceImagesMax) {
      alert(`Maximum ${trainingProfile.referenceImagesMax} reference images allowed for this subject type.`);
      return;
    }

    setReferenceFiles(prev => [...prev, ...imageFiles]);
  };

  const removeReferenceFile = (index: number) => {
    setReferenceFiles(prev => prev.filter((_, i) => i !== index));
  };

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  const applyTrainingStatus = useCallback((
    status: string,
    errorMessage?: string | null,
    personaId?: string | null,
    progress?: number | null,
  ) => {
    if (status === 'completed') {
      stopPolling();
      setCancelingPersonaId(null);
      setTrainingProgress(100);
      setTrainingStatus('Training completed');
      setIsTrainingIndeterminate(false);
      setIsTraining(false);
      setVisualStatus('ready');
      setPersonaStatus('completed');
      setIsTrainingComplete(true);
      setTrainingError(null);
      setCompletedModelId(personaId ?? null);
      setTrainingId(personaId ?? '');
      clearSelectedTrainingId();
      if (personaId) {
        setTrainedPersonas(prev => prev.map(item => (
          item.id === personaId
            ? { ...item, dbStatus: 'completed', status: 'trained', progress: 100, completedAt: new Date().toISOString(), errorMessage: null }
            : item
        )));
      }
      refreshPersonas();
      if (typeof window !== 'undefined') {
        localStorage.setItem('personasUpdated', String(Date.now()));
        window.dispatchEvent(new CustomEvent('personas:updated'));
      }
      return;
    }

    if (status === 'failed' || status === 'canceled') {
      stopPolling();
      setCancelingPersonaId(null);
      const failedStatus = status === 'canceled' ? 'canceled' : 'failed';
      const message = errorMessage || (failedStatus === 'canceled' ? 'Training canceled by user.' : 'Training failed.');
      setTrainingStatus(message);
      setTrainingError(message || null);
      setIsTrainingIndeterminate(false);
      setIsTraining(false);
      setVisualStatus('none');
      setPersonaStatus(failedStatus as 'failed' | 'canceled');
      clearSelectedTrainingId();
      if (personaId) {
        setTrainedPersonas(prev => prev.map(item => (
          item.id === personaId
            ? { ...item, dbStatus: failedStatus, status: failedStatus, progress: null, errorMessage: message }
            : item
        )));
      }
      refreshPersonas();
      if (typeof window !== 'undefined') {
        localStorage.setItem('personasUpdated', String(Date.now()));
        window.dispatchEvent(new CustomEvent('personas:updated'));
      }
      return;
    }

    setIsTraining(true);
    if (typeof progress === 'number') {
      setTrainingProgress(progress);
      setIsTrainingIndeterminate(false);
    } else {
      setIsTrainingIndeterminate(true);
    }
    setTrainingStatus('Persona training in progress');
    setTrainingError(null);
    if (personaId) {
      setTrainedPersonas(prev => prev.map(item => (
        item.id === personaId
          ? { ...item, dbStatus: 'training', status: 'training', progress: typeof progress === 'number' ? progress : item.progress }
          : item
      )));
    }
  }, [clearSelectedTrainingId, refreshPersonas, setPersonaStatus, setVisualStatus, stopPolling]);

  const fetchTrainingStatus = useCallback(async (personaId: string) => {
    try {
      const response = await fetch(`/api/persona/${personaId}/training-status`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 404) {
          return { status: 'failed', progress: null, error: 'Training record could not be resolved.' };
        }
        return { status: 'failed', error: data?.error || 'Unable to fetch training status.' };
      }
      return data;
    } catch {
      return { status: 'failed', progress: null, error: 'Unable to fetch training status.' };
    }
  }, []);

  const refreshTrainingStatus = useCallback(async (personaId: string) => {
    setIsRefreshingTrainingStatus(true);
    try {
      const data = await fetchTrainingStatus(personaId);
      applyTrainingStatus(data.status, data.error, personaId, data.progress);
      await refreshPersonas({ silent: true }).catch(() => undefined);
    } finally {
      setIsRefreshingTrainingStatus(false);
    }
  }, [applyTrainingStatus, fetchTrainingStatus, refreshPersonas]);

  const startPolling = useCallback((personaId: string) => {
    if (pollingRef.current) return;
    pollingRef.current = setInterval(async () => {
      try {
        const data = await fetchTrainingStatus(personaId);
        applyTrainingStatus(data.status, data.error, personaId, data.progress);
      } catch (error: any) {
        console.error('Polling error:', error);
      }
    }, 5000);
  }, [applyTrainingStatus, fetchTrainingStatus, clearTrainingUi, stopPolling]);

  useEffect(() => {
    if (!selectedPersonaId) return;
    let isActive = true;
    const checkStatus = async () => {
      try {
        const data = await fetchTrainingStatus(selectedPersonaId);
        if (!isActive) return;
        applyTrainingStatus(data.status, data.error, selectedPersonaId, data.progress);
        if (data.status === 'training') {
          startPolling(selectedPersonaId);
        }
      } catch (error: any) {
        if (!isActive) return;
        console.error('Failed to load persona status:', error);
      }
    };
    checkStatus();
    return () => {
      isActive = false;
      stopPolling();
    };
  }, [applyTrainingStatus, fetchTrainingStatus, selectedPersonaId, startPolling, stopPolling, clearTrainingUi]);

  useEffect(() => {
    if (!selectedPersonaId) return;
    if (dbPersonas.length === 0) return;
    const matchingPersona = dbPersonas.find(item => item.personaKey === selectedPersonaId || item.id === selectedPersonaId);
    if (!matchingPersona || matchingPersona.status !== 'training') {
      clearSelectedTrainingId();
      clearTrainingUi('');
    }
  }, [clearSelectedTrainingId, clearTrainingUi, dbPersonas, selectedPersonaId]);

  const startTraining = async () => {
    if (!canTrainVisual) {
      setIsPricingModalOpen(true);
      alert('Premium plan required to create or train personas.');
      return;
    }

    if (uploadedFiles.length < trainingProfile.minImages) {
      alert(`Please upload at least ${trainingProfile.minImages} images to train this persona`);
      return;
    }

    if (uploadedFiles.length > trainingProfile.maxImages) {
      alert(`Maximum ${trainingProfile.maxImages} images allowed for this subject type`);
      return;
    }

    if (!personaName.trim()) {
      alert('Please enter a persona name before training.');
      return;
    }

    if (!subjectType) {
      alert('Please choose whether this persona is a human, animal, or product before training.');
      return;
    }

    if (subjectType === 'human' && !gender) {
      alert('Please select a gender (Male / Female) before training.');
      return;
    }

    const personaRequest = requestVisualPersona(uploadedFiles.length);
    if (!personaRequest.ok) {
      if (personaRequest.reason === 'premium_required') {
        setIsPricingModalOpen(true);
        alert('Premium plan required to create or train personas.');
      } else if (personaRequest.reason === 'requires_training_images') {
        alert(`Please upload at least ${trainingProfile.minImages} images to train your AI persona`);
      }
      return;
    }

    setIsTraining(true);
    setTrainingProgress(0);
    setTrainingStatus('Preparing training data...');
    setTrainingError(null);
    const newTriggerWord = generateTriggerWord();
    setTriggerWord(newTriggerWord);
    const personaId = personaRequest.personaId ?? persona?.id;

    try {
      setTrainingStatus('Uploading images to training service...');
      setTrainingProgress(10);

      const formData = new FormData();
      uploadedFiles.forEach((file) => {
        formData.append('images', file, file.name);
      });
      referenceFiles.forEach((file) => {
        formData.append('referenceImages', file, file.name);
      });
      formData.append('personaName', personaName.trim());
      formData.append('personaId', String(personaId || ''));
      formData.append('triggerWord', newTriggerWord);
      formData.append('subjectType', subjectType);
      if (subjectType === 'human' && gender) {
        formData.append('gender', gender);
      }
      formData.append('user', JSON.stringify(user ?? null));

      setIsUploadingImages(true);
      const response = await fetch('/api/train-persona', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        setIsUploadingImages(false);
        let rawText = '';
        let error: any = null;
        try {
          rawText = await response.text();
          console.error('Start training raw error:', rawText);
          try {
            error = rawText ? JSON.parse(rawText) : null;
          } catch {
            error = null;
          }
        } catch (parseError) {
          console.error('Failed to read error response body:', parseError);
        }
        console.error('Start training failed:', {
          status: response.status,
          statusText: response.statusText,
          error,
          rawText,
        });
        const fallbackByStatus: Record<number, string> = {
          400: 'Missing or invalid request (Code: 400)',
          401: 'Unauthorized request (Code: 401)',
          403: 'Access denied (Code: 403)',
          404: 'Resource not found (Code: 404)',
          413: 'File too large (Code: 413)',
          500: 'Server error (Code: 500)',
          502: 'Temporary upstream error (Code: 502)',
          503: 'Service unavailable (Code: 503)',
        };
        const statusFallback = fallbackByStatus[response.status] || `Server error (Code: ${response.status})`;
        const safeMessage = (error as any)?.error || rawText || statusFallback;
        setTrainingError(safeMessage);
        setIsTraining(false);
        setTrainingProgress(0);
        setTrainingStatus('');
        return;
      }

      const data = await response.json();
      setIsUploadingImages(false);
      if (!data.trainingId || typeof data.trainingId !== 'string') {
        throw new Error('Training provider did not return a valid training id.');
      }

      // Upload a preview image for the persona (use the first uploaded photo).
      let previewImageUrl: string | null = null;
      let previewStoragePath: string | null = null;
      try {
        const previewFile = uploadedFiles[0] ?? null;
        if (previewFile) {
          const dataUrl = await fileToDataUrl(previewFile);
          const previewRes = await fetch('/api/upload-image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dataUrl, userId: user?.id }),
          });
          const previewData = await previewRes.json().catch(() => ({}));
          if (previewRes.ok && typeof previewData.publicUrl === 'string' && previewData.publicUrl.trim()) {
            previewImageUrl = previewData.publicUrl.trim();
            if (typeof previewData.storagePath === 'string' && previewData.storagePath.trim()) {
              previewStoragePath = previewData.storagePath.trim();
            }
          }
        }
      } catch (e) {
        console.warn('Preview image upload failed (continuing):', e);
      }
      setTrainingId(data.trainingId ?? '');
      setTrainingStatus('Persona training in progress');
      setIsTrainingIndeterminate(true);
      setTrainingProgress(40);
      if (data.trainingId && typeof window !== 'undefined') {
        setSelectedPersonaId(data.trainingId);
        localStorage.setItem('selectedPersonaTrainingId', data.trainingId);
        const stored = localStorage.getItem('personaTriggerWords');
        const map = stored ? JSON.parse(stored) : {};
        map[data.trainingId] = newTriggerWord;
        localStorage.setItem('personaTriggerWords', JSON.stringify(map));
        const storedNames = localStorage.getItem('persona_names');
        const nameMap = storedNames ? JSON.parse(storedNames) : {};
        nameMap[data.trainingId] = personaName.trim();
        localStorage.setItem('persona_names', JSON.stringify(nameMap));
      }

      if (data.trainingId) {
        fetch('/api/save-persona', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            personaId: data.trainingId,
            name: personaName.trim(),
            triggerWord: newTriggerWord,
            modelId: data.trainingId,
            trainingId: data.trainingId,
            destinationModel: data.destinationModel,
            modelFamily: data.modelFamily,
            trainingBaseModel: data.trainingBaseModel,
            subjectType,
            gender: subjectType === 'human' ? gender : undefined,
            referenceImages: data.referenceImages,
            referenceImageCount: data.referenceImageCount,
            // image_url should be a real image preview, not the ZIP/training input URL
            image_url: previewImageUrl ?? '',
            imageUrl: previewImageUrl ?? '',
            storage_path: previewStoragePath ?? undefined,
            storagePath: previewStoragePath ?? undefined,
            createdAt: new Date().toISOString(),
            status: 'training',
            visualStatus: 'training',
            user,
          }),
        }).catch((error) => {
          console.error('Failed to save persona record:', error);
        });
      }

      if (data.trainingId) {
        setTrainedPersonas(prev => {
          const exists = prev.some(item => item.personaKey === data.trainingId);
          if (exists) return prev;
          return [
            {
              dbId: null,
              personaKey: data.trainingId,
              id: data.trainingId,
              status: 'training',
              dbStatus: 'training',
              createdAt: new Date().toISOString(),
              name: personaName.trim(),
              type: 'visual',
              subjectType,
              trainingBaseModel: data.trainingBaseModel ?? null,
              imageCount: uploadedFiles.length,
              referenceImageCount: referenceFiles.length,
              progress: 0,
            },
            ...prev,
          ];
        });
      }

      if (data.trainingId) {
        // Poll by training id; polling with generated persona UUID can miss completion updates.
        startPolling(data.trainingId);
      }

    } catch (error: any) {
      console.error('Training error:', error);
      alert(error.message || 'Training error');
      setIsUploadingImages(false);
      setIsTraining(false);
      setTrainingProgress(0);
      setTrainingStatus('');
    }
  };


  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0a0a0a] via-[#1a1a1a] to-[#0a0a0a]">
      <Sidebar onSubscriptionClick={() => setIsPricingModalOpen(true)} />
      
      <main className="ml-64 p-8">
        <div className="mx-auto max-w-6xl">
          {/* Header */}
          <div className="mb-8">
            <Link href="/" className="text-[#00d9ff] hover:text-[#00d9ff]/80 mb-4 inline-block">
              ← Back to Studio
            </Link>
            <div className="flex items-center gap-3 mb-2">
              <Sparkles className="w-8 h-8 text-[#00d9ff]" style={{ filter: 'drop-shadow(0 0 8px #00d9ff)' }} />
              <h1 className="text-4xl font-bold text-white">
                <span className="bg-gradient-to-r from-[#00d9ff] via-[#0099cc] to-[#00d9ff] bg-clip-text text-transparent">
                  AI Persona Lab
                </span>
              </h1>
              <span className="px-3 py-1 text-xs font-semibold bg-gradient-to-r from-yellow-500 to-orange-500 text-black rounded-full">
                PREMIUM
              </span>
            </div>
            <p className="text-gray-300 text-base mb-2">
              Train one persona and reuse it across videos, ads, and images.
            </p>
            <p className="text-gray-400 text-lg">
              Upload {trainingProfile.minImages}-{trainingProfile.maxImages} photos to start.
            </p>
          </div>

          {/* Visual Persona Training */}
          <div className="glass rounded-2xl p-8 mb-8">
            <div className="flex items-start justify-between gap-4 mb-6">
              <div>
                <h2 className="text-2xl font-semibold text-white mb-2">Visual Persona Training</h2>
                <p className="text-gray-400">
                  Upload subject-aware training photos and optional reference images.
                  We train a private visual persona you can reuse everywhere.
                </p>
                <p className="text-gray-500 text-sm mt-2">
                  Premium covers model training, private storage, and ongoing persona access across the suite.
                </p>
              </div>
              <span className="px-3 py-1 text-xs font-semibold rounded-full bg-white/10 text-white">
                Status: {visualStatus}
              </span>
            </div>

            {!canTrainVisual && (
              <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/10 p-6 text-center mb-6">
                <div className="flex items-center justify-center gap-2 text-yellow-300 mb-2">
                  <Lock className="w-4 h-4" />
                  <span>Premium Required</span>
                </div>
                <p className="text-sm text-yellow-200 mb-3">
                  Training a private persona requires dedicated GPU compute and storage. Premium unlocks training and keeps your model private.
                </p>
                <p className="text-sm text-yellow-200 mb-4">
                  Free users can preview the flow; training starts after upgrade.
                </p>
                <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
                  <button
                    onClick={() => setIsPricingModalOpen(true)}
                    className="px-6 py-3 rounded-lg bg-gradient-to-r from-[#00d9ff] to-[#0099cc] text-white font-semibold hover:from-[#00d9ff]/90 hover:to-[#0099cc]/90 transition-all"
                  >
                    Unlock persona training
                  </button>
                  <button
                    onClick={() => setIsPricingModalOpen(true)}
                    className="px-6 py-3 rounded-lg border border-yellow-500/40 text-yellow-200 hover:border-yellow-400/60 hover:text-yellow-100 transition-all"
                  >
                    See what Premium includes
                  </button>
                </div>
              </div>
            )}
            <p className="text-sm text-[#00d9ff] mb-6 flex items-center gap-2">
              <Sparkles className="w-4 h-4" /> Add {trainingProfile.minImages}-{trainingProfile.maxImages} photos or a folder. We package them automatically.
            </p>

            {/* File Upload Buttons */}
            <div className="mb-6 flex flex-wrap items-end gap-4">
              <div className="flex-1">
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Persona Name (Required)
                </label>
                <input
                  value={personaName}
                  onChange={(event) => setPersonaName(event.target.value)}
                  placeholder="e.g. My LinkedIn Avatar, Game Character, etc."
                  className="w-full glass rounded-lg px-4 py-3 text-white border border-white/10 focus:border-[#00d9ff]/50 focus:outline-none placeholder-gray-500"
                />
              </div>
              <div className="w-56">
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Subject Type (Required)
                </label>
                <select
                  value={subjectType}
                  onChange={(event) => setSubjectType(event.target.value as '' | PersonaSubjectType)}
                  className="w-full glass rounded-lg px-4 py-3 text-white border border-white/10 focus:border-[#00d9ff]/50 focus:outline-none"
                >
                  <option value="" className="bg-[#0b1220]">Select one</option>
                  <option value="human" className="bg-[#0b1220]">Living - Human</option>
                  <option value="animal" className="bg-[#0b1220]">Living - Animal</option>
                  <option value="product" className="bg-[#0b1220]">Product / Object</option>
                  <option value="other" className="bg-[#0b1220]">Other</option>
                </select>
              </div>
              {isHumanSubject && (
                <div className="w-48">
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Gender (Required for humans)
                  </label>
                  <select
                    value={gender}
                    onChange={(event) => setGender(event.target.value as '' | 'male' | 'female')}
                    className="w-full glass rounded-lg px-4 py-3 text-white border border-white/10 focus:border-[#00d9ff]/50 focus:outline-none"
                  >
                    <option value="" className="bg-[#0b1220]">Select one</option>
                    <option value="male" className="bg-[#0b1220]">Male</option>
                    <option value="female" className="bg-[#0b1220]">Female</option>
                  </select>
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={handleFileSelect}
                className="hidden"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={isTraining || !canTrainVisual}
                className="interactive-element glass rounded-lg px-6 py-3 text-white font-medium hover:bg-[#00d9ff]/10 border border-[#00d9ff]/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                <Camera className="w-4 h-4" /> Select Images
              </button>

              <input
                type="file"
                accept="image/*"
                multiple
                // @ts-expect-error - webkitdirectory is a non-standard attribute supported by Chromium browsers
                webkitdirectory=""
                onChange={handleFileSelect}
                className="hidden"
              />
              <button
                onClick={(event) => {
                  const input = (event.currentTarget.previousElementSibling as HTMLInputElement | null);
                  input?.click();
                }}
                disabled={isTraining || !canTrainVisual}
                className="glass rounded-lg px-6 py-3 text-white font-medium hover:bg-[#00d9ff]/10 border border-[#00d9ff]/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                📁 Upload Folder
              </button>
            </div>

            <div className="mb-6 rounded-xl border border-cyan-500/20 bg-cyan-500/5 px-4 py-4 text-sm text-cyan-100">
              <p className="font-medium text-white">
                Training Engine: {trainingProfile.engineLabel}
              </p>
              <p className="mt-1 text-cyan-100/80">
                {trainingProfile.engineDescription}
              </p>
              <p className="mt-2 text-xs text-cyan-50/70">
                Supports {trainingProfile.minImages}-{trainingProfile.maxImages} training images.
                Recommended range: {trainingProfile.recommendedMinImages}-{trainingProfile.recommendedMaxImages}.
              </p>
              <p className="mt-2 text-xs text-cyan-50/70">
                {providerStackDescription}
              </p>
            </div>

            <div className="mb-6 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-gray-300">
              <p className="font-medium text-white">
                Training Mode: {subjectSummary}
              </p>
              <p className="mt-1 text-gray-400">
                {subjectGuidance}
              </p>
              <p className="mt-2 text-xs text-gray-500">
                Optional reference images: up to {trainingProfile.referenceImagesMax}. Recommended for tighter exact-mode outputs later, but not required.
              </p>
            </div>

            <div className="mb-6">
              <label className="mb-2 block text-sm font-medium text-gray-300">
                Reference Images (Optional, Recommended)
              </label>
              <input
                ref={referenceInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={handleReferenceFileSelect}
                className="hidden"
              />
              <button
                onClick={() => referenceInputRef.current?.click()}
                disabled={isTraining || !canTrainVisual}
                className="glass rounded-lg px-6 py-3 text-white font-medium hover:bg-fuchsia-500/10 border border-fuchsia-500/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Upload Reference Images
              </button>
              <p className="mt-2 text-xs text-gray-500">
                Add up to {trainingProfile.referenceImagesMax} reference images. These are optional and will not block training.
              </p>
            </div>

            {!canTrainVisual && (
              <p className="text-sm text-yellow-300 mb-4">
                Status: Preview Mode (training locked)
              </p>
            )}

            {/* Uploaded Files List */}
            {uploadedFiles.length > 0 && (
              <div className="mb-6">
                <p className="text-sm text-gray-400 mb-3">
                  {uploadedFiles.length} / {trainingProfile.maxImages} training images uploaded
                </p>
                <div className="grid grid-cols-5 gap-4">
                  {uploadedFiles.map((file, index) => (
                    <div key={index} className="relative group">
                      <img
                        src={URL.createObjectURL(file)}
                        alt={`Upload ${index + 1}`}
                        className="w-full h-32 object-cover rounded-lg"
                      />
                      {!isTraining && (
                        <button
                          onClick={() => removeFile(index)}
                          className="absolute top-2 right-2 bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          ×
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {referenceFiles.length > 0 && (
              <div className="mb-6">
                <p className="text-sm text-gray-400 mb-3">
                  {referenceFiles.length} / {trainingProfile.referenceImagesMax} reference images uploaded
                </p>
                <div className="grid grid-cols-5 gap-4">
                  {referenceFiles.map((file, index) => (
                    <div key={`${file.name}-${index}`} className="relative group">
                      <img
                        src={URL.createObjectURL(file)}
                        alt={`Reference ${index + 1}`}
                        className="w-full h-32 object-cover rounded-lg"
                      />
                      {!isTraining && (
                        <button
                          onClick={() => removeReferenceFile(index)}
                          className="absolute top-2 right-2 bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          ×
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <p className="text-sm text-gray-500 mb-4">
              When training starts, you’ll see progress and your trigger word here.
              Use that trigger word in any tool to get consistent results.
            </p>
            <p className="text-sm text-gray-500 mb-4">
              If you leave this page, training continues in the background.
            </p>
            {trainingError && (
              <p className="text-sm text-red-400 mb-4">
                {trainingError}
              </p>
            )}
            {/* Training Button */}
            <button
              onClick={startTraining}
              disabled={isTraining || isUploadingImages || uploadedFiles.length < trainingProfile.minImages || !canTrainVisual}
              className="w-full glass rounded-lg px-6 py-4 text-white font-semibold bg-gradient-to-r from-[#00d9ff] to-[#0099cc] hover:from-[#00d9ff]/90 hover:to-[#0099cc]/90 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isTraining ? 'Training in Progress...' : 'Train My AI Persona'}
            </button>

            {uploadedFiles.length < trainingProfile.minImages && uploadedFiles.length > 0 && (
              <p className="mt-4 text-sm text-yellow-400 text-center">
                Upload {trainingProfile.minImages - uploadedFiles.length} more image(s) to reach the minimum
              </p>
            )}
          </div>

          {/* My Trained Personas */}
          <div className="glass rounded-2xl p-8 mb-8">
            <div className="flex items-start justify-between gap-4 mb-6">
              <div>
                <h2 className="text-2xl font-semibold text-white mb-2">My Trained Personas</h2>
                <p className="text-gray-400">
                  Manage your trained personas here.
                </p>
              </div>
            </div>

            {isLoadingPersonas && (
              <p className="text-sm text-gray-400">Loading personas...</p>
            )}

            {!isLoadingPersonas && personaList.length === 0 && (
              <p className="text-sm text-gray-500">
                No personas found yet.
              </p>
            )}

            {!isLoadingPersonas && personaList.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {personaList.map((personaItem) => {
                  const statusMeta = getPersonaStatusMeta(personaItem.status);
                  const StatusIcon = statusMeta.icon;
                  return (
                    <div
                      key={personaItem.id}
                      className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 shadow-[0_10px_40px_rgba(0,0,0,0.24)]"
                    >
                      <div className="flex items-start justify-between mb-3 gap-4">
                        <div>
                          <p className="text-white font-semibold text-lg">
                            {personaItem.name?.trim() ? personaItem.name : 'Untitled Persona'}
                          </p>
                          <p className="text-xs text-gray-400 mt-1">
                            {personaItem.id.slice(0, 8)}...
                          </p>
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <span className="rounded-full border border-blue-500/30 bg-blue-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-blue-200">
                              {personaItem.type === 'voice' ? 'Voice' : 'Visual'}
                            </span>
                            <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${statusMeta.badgeClass}`}>
                              <StatusIcon className={`h-3.5 w-3.5 ${personaItem.status === 'training' ? 'animate-spin' : ''}`} />
                              {statusMeta.label}
                            </span>
                            {personaItem.subjectType && (
                              <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-300">
                                {PERSONA_SUBJECT_TYPE_LABELS[personaItem.subjectType]}
                              </span>
                            )}
                          </div>
                          {(personaItem.trainingBaseModel || personaItem.imageCount || personaItem.referenceImageCount) && (
                            <div className="mt-3 space-y-1 text-xs text-gray-400">
                              {personaItem.trainingBaseModel && (
                                <p>Trainer: {getTrainingEngineLabel(personaItem.trainingBaseModel)}</p>
                              )}
                              {typeof personaItem.imageCount === 'number' && (
                                <p>Training images: {personaItem.imageCount}</p>
                              )}
                              {typeof personaItem.referenceImageCount === 'number' && personaItem.referenceImageCount > 0 && (
                                <p>Reference images: {personaItem.referenceImageCount}</p>
                              )}
                            </div>
                          )}
                        </div>
                        <span className="text-xs text-gray-400">
                          {formatPersonaDate(personaItem.completedAt ?? personaItem.createdAt)}
                        </span>
                      </div>
                      <div className="flex items-start justify-between gap-4">
                        <span className={`text-xs ${statusMeta.summaryClass}`}>
                          {statusMeta.summaryText}
                        </span>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => {
                              openRenameModal(personaItem.id, personaItem.name);
                            }}
                            className="px-3 py-2 rounded-lg text-xs font-semibold bg-white/10 text-white hover:bg-white/20 inline-flex items-center gap-2"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                            Rename
                          </button>
                          {personaItem.status === 'training' && (
                            <button
                              onClick={() => handleCancelTraining(personaItem.personaKey, personaItem.dbId)}
                              disabled={cancelingPersonaId === personaItem.personaKey}
                              className="px-3 py-2 rounded-lg text-xs font-semibold bg-yellow-500/20 text-yellow-200 hover:bg-yellow-500/30 inline-flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {cancelingPersonaId === personaItem.personaKey ? 'Canceling...' : 'Cancel'}
                            </button>
                          )}
                          <button
                            onClick={async () => {
                              const confirmed = window.confirm('Remove this persona from your list?');
                              if (!confirmed) return;
                              try {
                                await fetch('/api/save-persona', {
                                  method: 'DELETE',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({
                                    personaId: personaItem.dbId ?? personaItem.personaKey,
                                    user,
                                  }),
                                });
                              } catch (error) {
                                console.error('Failed to delete persona:', error);
                              }
                              const deleted = getDeletedPersonaIds();
                              deleted.add(personaItem.personaKey);
                              persistDeletedPersonaIds(deleted);
                              setTrainedPersonas(prev => prev.filter(item => item.id !== personaItem.id));
                            }}
                            className="px-3 py-2 rounded-lg text-xs font-semibold bg-red-500/20 text-red-300 hover:bg-red-500/30 inline-flex items-center gap-2"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            Delete
                          </button>
                        </div>
                      </div>
                      {(personaItem.status === 'failed' || personaItem.status === 'canceled') && (
                        <div className={`mt-4 rounded-xl border px-3 py-3 text-sm ${
                          personaItem.status === 'failed'
                            ? 'border-red-500/20 bg-red-500/10 text-red-100'
                            : 'border-yellow-500/20 bg-yellow-500/10 text-yellow-100'
                        }`}>
                          {personaItem.errorMessage?.trim()
                            ? personaItem.errorMessage
                            : personaItem.status === 'canceled'
                              ? 'Training canceled by user.'
                              : 'Training ended with an error.'}
                        </div>
                      )}
                      {personaItem.status === 'training' && (
                        <div className="mt-4 rounded-xl border border-cyan-500/10 bg-cyan-500/[0.04] p-3">
                          <div className="flex items-center justify-between text-[11px] text-gray-400 mb-2">
                            <span>Training progress</span>
                            <span>{typeof personaItem.progress === 'number' ? `${personaItem.progress}%` : 'calculating...'}</span>
                          </div>
                          <div className="h-2 w-full rounded-full bg-white/10 overflow-hidden">
                            <div
                              className="h-full bg-gradient-to-r from-[#00d9ff] to-[#0099cc]"
                              style={{ width: `${Math.min(100, Math.max(0, personaItem.progress ?? 2))}%` }}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

          </div>

          {/* Cinematic Training Progress Screen */}
          {showTrainingBanner && (
            <div className="relative glass rounded-2xl p-8 mb-8 overflow-hidden">
              {/* Animated background effect */}
              <div className="absolute inset-0 opacity-20">
                <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-br from-[#00d9ff]/20 via-transparent to-[#0099cc]/20 animate-pulse" />
                <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-[#00d9ff]/10 rounded-full blur-3xl animate-ping" style={{ animationDuration: '3s' }} />
              </div>

              <div className="relative z-10">
                <div className="flex items-center gap-3 mb-6">
                  <div className="relative">
                    <div className="absolute inset-0 bg-[#00d9ff] rounded-full blur-xl opacity-50 animate-pulse" />
                    <div className="relative w-16 h-16 rounded-full bg-gradient-to-br from-[#00d9ff] to-[#0099cc] flex items-center justify-center">
                      <div className="w-8 h-8 border-4 border-white border-t-transparent rounded-full animate-spin" />
                    </div>
                  </div>
                  <div>
                    <h2 className="text-2xl font-bold text-white">Training Your AI Persona</h2>
                    <p className="text-sm text-gray-400">Creating your unique digital twin...</p>
                  </div>
                </div>

                {triggerWord && (
                  <div className="mb-6 p-5 bg-gradient-to-r from-[#00d9ff]/20 to-[#0099cc]/20 rounded-xl border-2 border-[#00d9ff]/50">
                    <div className="flex items-center gap-2 mb-2">
                      <Target className="w-5 h-5 text-[#00d9ff]" style={{ filter: 'drop-shadow(0 0 6px #00d9ff)' }} />
                      <p className="text-sm font-semibold text-gray-300 uppercase tracking-wide">Your Unique Trigger Word</p>
                    </div>
                    <div className="bg-black/50 rounded-lg p-4 border border-[#00d9ff]/30">
                      <p className="text-3xl font-mono font-bold text-[#00d9ff] text-center mb-2 tracking-wider">
                        {triggerWord}
                      </p>
                      <p className="text-xs text-gray-400 text-center">
                        Use this word in any prompt to activate your persona: &quot;{triggerWord} walking in a park&quot;
                      </p>
                    </div>
                  </div>
                )}

                {/* Progress Bar with Animation */}
                <div className="mb-6">
                  <div className="flex justify-between items-center text-sm mb-3">
                    <span className="text-gray-300 font-medium">
                      {trainingStatus || 'Persona training in progress'}
                    </span>
                    <span className="text-[#00d9ff] font-bold text-lg">
                      {typeof activeTraining?.progress === 'number'
                        ? `${Math.round(activeTraining.progress)}%`
                        : isTrainingIndeterminate ? '—' : `${Math.round(trainingProgress)}%`}
                    </span>
                  </div>
                  <div className="relative w-full bg-gray-800/50 rounded-full h-6 overflow-hidden border border-gray-700">
                    {/* Animated gradient bar */}
                    <div
                      className={`relative h-full bg-gradient-to-r from-[#00d9ff] via-[#0099cc] to-[#00d9ff] transition-all duration-700 ease-out shadow-lg ${isTrainingIndeterminate ? 'animate-pulse' : ''}`}
                      style={{
                        width: isTrainingIndeterminate
                          ? '100%'
                          : `${typeof activeTraining?.progress === 'number' ? activeTraining.progress : trainingProgress}%`,
                      }}
                    >
                      {/* Shimmer effect */}
                      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent animate-shimmer" />
                    </div>
                    {/* Progress glow */}
                    <div
                      className="absolute top-0 h-full bg-[#00d9ff]/50 blur-md transition-all duration-700"
                      style={{
                        width: isTrainingIndeterminate
                          ? '100%'
                          : `${typeof activeTraining?.progress === 'number' ? activeTraining.progress : trainingProgress}%`,
                      }}
                    />
                  </div>
                  
                  {/* Step indicators */}
                  {!isTrainingIndeterminate && (
                    <div className="flex justify-between mt-4 text-xs text-gray-500">
                      <span className={trainingProgress > 10 ? 'text-[#00d9ff]' : ''}>✓ Preparing</span>
                      <span className={trainingProgress > 30 ? 'text-[#00d9ff]' : ''}>✓ Uploading</span>
                      <span className={trainingProgress > 50 ? 'text-[#00d9ff]' : ''}>✓ Training</span>
                      <span className={trainingProgress > 90 ? 'text-[#00d9ff]' : ''}>✓ Finalizing</span>
                    </div>
                  )}
                </div>

                <div className="mt-4 flex justify-end gap-2">
                  {activeTraining?.personaKey && (
                    <>
                      <button
                        type="button"
                        onClick={() => refreshTrainingStatus(activeTraining.personaKey)}
                        disabled={isRefreshingTrainingStatus || cancelingPersonaId === activeTraining.personaKey}
                        className="px-4 py-2 rounded-lg text-xs font-semibold bg-white/10 text-white hover:bg-white/20 inline-flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {isRefreshingTrainingStatus ? 'Refreshing...' : 'Refresh Status'}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleCancelTraining(activeTraining.personaKey, activeTraining.dbId)}
                        disabled={cancelingPersonaId === activeTraining.personaKey}
                        className="px-4 py-2 rounded-lg text-xs font-semibold bg-yellow-500/20 text-yellow-200 hover:bg-yellow-500/30 inline-flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {cancelingPersonaId === activeTraining.personaKey ? 'Canceling...' : 'Cancel Training'}
                      </button>
                    </>
                  )}
                </div>

                {/* Estimated time */}
                <div className="flex items-center justify-center gap-2 text-sm text-gray-400 mb-4">
                  <svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span>
                    {isTrainingIndeterminate
                      ? 'Estimated time: calculating...'
                      : `Estimated time: ${Math.max(1, Math.ceil((100 - trainingProgress) / 10))} minutes remaining`}
                  </span>
                </div>

                {trainingId && (
                  <div className="text-center">
                    <p className="text-xs text-gray-500">
                      Training ID: <span className="font-mono text-gray-400">{trainingId.substring(0, 8)}...</span>
                    </p>
                  </div>
                )}

                {/* Floating particles effect */}
                <div className="absolute inset-0 pointer-events-none overflow-hidden rounded-2xl">
                  {[...Array(20)].map((_, i) => (
                    <div
                      key={i}
                      className="absolute w-1 h-1 bg-[#00d9ff] rounded-full opacity-20"
                      style={{
                        left: `${Math.random() * 100}%`,
                        top: `${Math.random() * 100}%`,
                        animation: `float ${3 + Math.random() * 4}s ease-in-out infinite`,
                        animationDelay: `${Math.random() * 2}s`,
                      }}
                    />
                  ))}
                </div>
              </div>

              <style jsx>{`
                @keyframes shimmer {
                  0% { transform: translateX(-100%); }
                  100% { transform: translateX(100%); }
                }
                @keyframes float {
                  0%, 100% { transform: translateY(0) translateX(0); opacity: 0.2; }
                  50% { transform: translateY(-20px) translateX(10px); opacity: 0.5; }
                }
                .animate-shimmer {
                  animation: shimmer 2s infinite;
                }
              `}</style>
            </div>
          )}

          {/* Success Screen */}
          {isTrainingComplete && triggerWord && (
            <div className="glass rounded-2xl p-8 mb-8 border-2 border-[#00d9ff]/50 bg-gradient-to-br from-[#00d9ff]/10 to-transparent">
              <div className="text-center">
                <div className="mb-6">
                  <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-gradient-to-br from-[#00d9ff] to-[#0099cc] mb-4 animate-bounce">
                    <span className="text-4xl">✓</span>
                  </div>
                  <h2 className="text-3xl font-bold text-white mb-2">Successful ✅</h2>
                  <p className="text-gray-400">Your AI persona is ready to use</p>
                </div>

                <div className="bg-black/50 rounded-xl p-6 mb-6 border border-[#00d9ff]/30">
                  <p className="text-sm text-gray-400 mb-2 uppercase tracking-wide">Your Trigger Word</p>
                  <p className="text-4xl font-mono font-bold text-[#00d9ff] mb-4">{triggerWord}</p>
                  <p className="text-sm text-gray-300 mb-4">
                    Use this word in any prompt to activate your persona
                  </p>
                  <div className="bg-gray-900 rounded-lg p-4 text-left">
                    <p className="text-xs text-gray-500 mb-1">Example:</p>
                    <p className="text-sm font-mono text-[#00d9ff]">
                      &quot;{triggerWord} walking in a park, cinematic, high quality&quot;
                    </p>
                  </div>
                </div>

                {completedModelId && (
                  <div className="mb-6 p-4 bg-gray-800/50 rounded-lg">
                    <p className="text-xs text-gray-500 mb-1">Model ID:</p>
                    <p className="text-xs font-mono text-gray-400 break-all">{completedModelId}</p>
                  </div>
                )}

                <div className="flex gap-4 justify-center">
                  <Link
                    href="/"
                    className="px-6 py-3 bg-gradient-to-r from-[#00d9ff] to-[#0099cc] text-white font-semibold rounded-lg hover:from-[#00d9ff]/90 hover:to-[#0099cc]/90 transition-all"
                  >
                    🎬 Start Creating with Your Persona
                  </Link>
                  <button
                    onClick={() => {
                      setIsTrainingComplete(false);
                      setUploadedFiles([]);
                      setTriggerWord('');
                      setTrainingProgress(0);
                      setTrainingStatus('');
                      setCompletedModelId(null);
                    }}
                    className="px-6 py-3 glass text-white font-semibold rounded-lg hover:bg-[#00d9ff]/10 transition-all border border-white/10"
                  >
                    Train Another Persona
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Info Section - Only show when training is not complete */}
          {!isTrainingComplete && (
            <div className="glass rounded-2xl p-8">
              <h2 className="text-2xl font-semibold text-white mb-4">How It Works</h2>
              <div className="space-y-4 text-gray-400">
                <div className="flex gap-4">
                  <span className="text-2xl">1️⃣</span>
                  <div>
                    <h3 className="text-white font-medium mb-1">Upload Images</h3>
                    <p>Upload {trainingProfile.recommendedMinImages}-{trainingProfile.recommendedMaxImages} high-quality training images. More variety usually means better results.</p>
                  </div>
                </div>
                <div className="flex gap-4">
                  <span className="text-2xl">2️⃣</span>
                  <div>
                    <h3 className="text-white font-medium mb-1">Training</h3>
                    <p>Our AI trains a custom model based on your images. This takes 5-10 minutes.</p>
                  </div>
                </div>
                <div className="flex gap-4">
                  <span className="text-2xl">3️⃣</span>
                  <div>
                    <h3 className="text-white font-medium mb-1">Use Your Persona</h3>
                    <p>Use your unique trigger word in prompts to generate images with your persona.</p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      <PricingModal
        isOpen={isPricingModalOpen}
        onClose={() => setIsPricingModalOpen(false)}
      />

      {isRenameOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={closeRenameModal}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              closeRenameModal();
            }
          }}
          tabIndex={-1}
        >
          <div
            className="w-full max-w-md rounded-xl border border-white/10 bg-gray-900 p-6 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-white mb-4">Rename Persona</h3>
            <input
              value={renameValue}
              onChange={(event) => setRenameValue(event.target.value)}
              placeholder="Enter persona name"
              className="w-full rounded-lg border border-white/10 bg-black/40 px-4 py-3 text-white placeholder-gray-500 focus:border-[#00d9ff]/50 focus:outline-none"
              autoFocus
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  saveRename();
                }
                if (event.key === 'Escape') {
                  event.preventDefault();
                  closeRenameModal();
                }
              }}
            />
            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={closeRenameModal}
                className="px-4 py-2 rounded-lg text-sm font-semibold text-gray-300 hover:bg-white/5"
              >
                Cancel
              </button>
              <button
                onClick={saveRename}
                className="px-4 py-2 rounded-lg text-sm font-semibold bg-gradient-to-r from-[#00d9ff] to-[#0099cc] text-black hover:opacity-90"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
