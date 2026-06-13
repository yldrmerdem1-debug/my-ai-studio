'use client';

import { useEffect, useRef } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';

type PollingActions = {
  setStatusMessage: Dispatch<SetStateAction<string>>;
  setVideoUrl: Dispatch<SetStateAction<string | null>>;
  setHasGenerated: Dispatch<SetStateAction<boolean>>;
  setAudioMerged: Dispatch<SetStateAction<boolean>>;
  setIsGenerating: Dispatch<SetStateAction<boolean>>;
  setPendingVideoId: Dispatch<SetStateAction<string | null>>;
  setOriginalVideoUrl: Dispatch<SetStateAction<string | null>>;
  setFaceSwapSuccess: Dispatch<SetStateAction<boolean>>;
  setFaceSwapError: Dispatch<SetStateAction<string>>;
  setGeneratedImageUrl: Dispatch<SetStateAction<string | null>>;
  setErrorMessage: Dispatch<SetStateAction<string>>;
  setActiveVideoTab?: Dispatch<SetStateAction<'original' | 'swapped'>>;
};

type UseVideoGenerationPollingArgs = {
  pendingVideoId: string | null;
  generationRunRef: MutableRefObject<number>;
  pendingRunIdRef: MutableRefObject<number>;
  actions: PollingActions;
};

const POLL_INTERVAL_MS = 2000;
const MAX_POLL_DURATION_MS = 20 * 60 * 1000;

const TERMINAL_FAILURE_RE =
  /\b(canceled|cancelled|nsfw|safety|invalid prompt|permission denied|insufficient credit|payment required|billing)\b/i;

const RETRYABLE_FAILURE_RE =
  /\b(not found|expired|temporarily|throttl|rate limit|timeout|econnreset|network|fetch failed|starting)\b/i;

const extractResponseVideoUrl = (data: Record<string, unknown>): string => {
  const direct = String(data?.videoUrl || '').trim();
  if (direct) return direct;

  const output = data?.output;
  if (typeof output === 'string' && /^https?:\/\//i.test(output)) {
    return output.trim();
  }
  if (Array.isArray(output)) {
    for (const item of output) {
      if (typeof item === 'string' && /^https?:\/\//i.test(item)) {
        return item.trim();
      }
    }
  }
  if (output && typeof output === 'object') {
    const record = output as Record<string, unknown>;
    const nested = String(record.videoUrl || record.url || record.mp4 || '').trim();
    if (/^https?:\/\//i.test(nested)) return nested;
  }
  return '';
};

const isRetryableFailure = (message: string) => {
  const safe = String(message || '').trim();
  if (!safe) return true;
  if (TERMINAL_FAILURE_RE.test(safe)) return false;
  return RETRYABLE_FAILURE_RE.test(safe);
};

const applyVideoSuccess = (
  actions: PollingActions,
  data: Record<string, unknown>
) => {
  const resolvedUrl = extractResponseVideoUrl(data);
  if (!resolvedUrl) {
    throw new Error('Video generated but URL is missing');
  }

  const output = (data.output && typeof data.output === 'object'
    ? data.output
    : {}) as Record<string, unknown>;
  const faceSwapped = Boolean(output.faceSwapped);
  const originalVideoUrl = typeof output.originalVideoUrl === 'string'
    ? output.originalVideoUrl
    : null;
  const faceSwapError = typeof output.faceSwapError === 'string'
    ? output.faceSwapError
    : '';

  if (faceSwapped && originalVideoUrl) {
    actions.setOriginalVideoUrl(originalVideoUrl);
    actions.setFaceSwapSuccess(true);
    setTimeout(() => actions.setFaceSwapSuccess(false), 3000);
  } else if (faceSwapError) {
    actions.setFaceSwapError(faceSwapError);
    setTimeout(() => actions.setFaceSwapError(''), 5000);
  } else {
    actions.setOriginalVideoUrl(null);
  }

  if (typeof output.imageUrl === 'string' && output.imageUrl.trim()) {
    actions.setGeneratedImageUrl(output.imageUrl.trim());
  }

  actions.setErrorMessage('');
  actions.setVideoUrl(resolvedUrl);
  actions.setHasGenerated(true);
  actions.setAudioMerged(Boolean(data.audioMerged || output.audioMerged));
  actions.setIsGenerating(false);
  actions.setPendingVideoId(null);
  actions.setActiveVideoTab?.('swapped');

  if (typeof window !== 'undefined') {
    localStorage.setItem('latestRawVideoUrl', resolvedUrl);
  }
};

export const useVideoGenerationPolling = ({
  pendingVideoId,
  generationRunRef,
  pendingRunIdRef,
  actions,
}: UseVideoGenerationPollingArgs) => {
  const startedAtRef = useRef(0);

  useEffect(() => {
    if (!pendingVideoId) return;
    let cancelled = false;
    const runId = pendingRunIdRef.current;
    startedAtRef.current = Date.now();

    const pollOnce = async () => {
      if (cancelled || generationRunRef.current !== runId) return;

      if (Date.now() - startedAtRef.current > MAX_POLL_DURATION_MS) {
        actions.setErrorMessage('Video generation timed out. Please try again.');
        actions.setIsGenerating(false);
        actions.setPendingVideoId(null);
        return;
      }

      try {
        if (pendingVideoId.startsWith('runway:')) {
          actions.setStatusMessage('Gen-4.5 Motoru işliyor... Ultra Gerçekçi Video Hazırlanıyor');
          const taskId = pendingVideoId.slice('runway:'.length);
          const res = await fetch(`/api/video/runway-gen4/status?task_id=${encodeURIComponent(taskId)}`);
          if (!res.ok) {
            console.warn('Runway status check failed:', res.status);
            if (res.status >= 500) return;
            const errorData = await res.json().catch(() => ({}));
            const message = String(errorData.error || errorData.details || 'Runway status check failed');
            if (isRetryableFailure(message)) return;
            throw new Error(message);
          }

          const data = await res.json().catch(() => ({}));
          const status = String(data.status || '').toUpperCase();
          if (status === 'SUCCEEDED') {
            if (generationRunRef.current !== runId) return;
            applyVideoSuccess(actions, data);
            return;
          }

          if (status === 'FAILED') {
            const message = String(data.error || 'Runway generation failed');
            if (isRetryableFailure(message)) return;
            throw new Error(message);
          }
          return;
        }

        const response = await fetch(
          `/api/generate-video/status?id=${encodeURIComponent(pendingVideoId)}`,
          { cache: 'no-store' }
        );
        if (!response.ok) {
          console.warn('Status check failed with status:', response.status);
          if (response.status >= 500 || response.status === 429) return;

          const errorData = await response.json().catch(() => ({}));
          const message = String(errorData.error || errorData.details || 'Failed to check video status');
          if (isRetryableFailure(message)) return;
          throw new Error(message);
        }

        const data = await response.json().catch(() => ({}));
        if (data.statusMessage) {
          actions.setStatusMessage(String(data.statusMessage));
        }

        const resolvedUrl = extractResponseVideoUrl(data);
        if (resolvedUrl) {
          if (generationRunRef.current !== runId) return;
          applyVideoSuccess(actions, { ...data, videoUrl: resolvedUrl });
          return;
        }

        const status = String(data.status || '').toLowerCase();
        if (
          status === 'starting'
          || status === 'processing'
          || status === 'in_queue'
          || status === 'in_progress'
        ) {
          return;
        }

        if (status === 'succeeded') {
          throw new Error('Video generated but URL is missing');
        }

        if (status === 'failed' || status === 'canceled' || status === 'error') {
          const message = String(data.error || data.statusMessage || 'Video generation failed');
          if (isRetryableFailure(message)) {
            actions.setStatusMessage('Reconnecting to video job...');
            return;
          }
          throw new Error(message);
        }
      } catch (error: any) {
        if (generationRunRef.current !== runId) return;

        const message = String(error?.message || '');
        const isNetworkError =
          message.includes('Failed to fetch')
          || message.includes('NetworkError')
          || message.includes('Connection refused')
          || message.includes('fetch');
        if (isNetworkError || isRetryableFailure(message)) {
          console.warn('Retryable polling issue, will retry:', message);
          actions.setStatusMessage('Connection hiccup — still waiting for your video...');
          return;
        }

        console.error('Polling error:', error);
        actions.setErrorMessage(message || 'Failed to check video status');
        actions.setIsGenerating(false);
        actions.setPendingVideoId(null);
      }
    };

    pollOnce();
    const intervalId = window.setInterval(pollOnce, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [actions, generationRunRef, pendingRunIdRef, pendingVideoId]);
};
