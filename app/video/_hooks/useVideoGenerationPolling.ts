'use client';

import { useEffect } from 'react';
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
};

type UseVideoGenerationPollingArgs = {
  pendingVideoId: string | null;
  generationRunRef: MutableRefObject<number>;
  pendingRunIdRef: MutableRefObject<number>;
  actions: PollingActions;
};

export const useVideoGenerationPolling = ({
  pendingVideoId,
  generationRunRef,
  pendingRunIdRef,
  actions,
}: UseVideoGenerationPollingArgs) => {
  useEffect(() => {
    if (!pendingVideoId) return;
    let cancelled = false;
    const runId = pendingRunIdRef.current;

    const pollOnce = async () => {
      if (cancelled || generationRunRef.current !== runId) return;

      try {
        if (pendingVideoId.startsWith('runway:')) {
          actions.setStatusMessage('Gen-4.5 Motoru işliyor... Ultra Gerçekçi Video Hazırlanıyor');
          const taskId = pendingVideoId.slice('runway:'.length);
          const res = await fetch(`/api/video/runway-gen4/status?task_id=${encodeURIComponent(taskId)}`);
          if (!res.ok) {
            console.warn('Runway status check failed:', res.status);
            return;
          }

          const data = await res.json().catch(() => ({}));
          const status = String(data.status || '').toUpperCase();
          if (status === 'SUCCEEDED') {
            if (!data.videoUrl) throw new Error('Runway succeeded but videoUrl is missing');
            if (generationRunRef.current !== runId) return;
            actions.setVideoUrl(String(data.videoUrl));
            actions.setHasGenerated(true);
            actions.setAudioMerged(false);
            actions.setIsGenerating(false);
            actions.setPendingVideoId(null);
            return;
          }

          if (status === 'FAILED') {
            throw new Error(data.error || 'Runway generation failed');
          }
          return;
        }

        const response = await fetch(`/api/generate-video/status?id=${encodeURIComponent(pendingVideoId)}`);
        if (!response.ok) {
          console.warn('Status check failed with status:', response.status);
          if (response.status >= 500) return;

          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || errorData.details || 'Failed to check video status');
        }

        const data = await response.json().catch(() => ({}));
        if (data.statusMessage) {
          actions.setStatusMessage(data.statusMessage);
        }

        if (data.status === 'starting' || data.status === 'processing' || data.status === 'in_queue' || data.status === 'IN_QUEUE') {
          return;
        }

        if (data.status === 'succeeded') {
          if (!data.videoUrl) {
            throw new Error('Video generated but URL is missing');
          }
          if (generationRunRef.current !== runId) return;

          const output = data.output || {};
          const faceSwapped = Boolean(output.faceSwapped);
          const originalVideoUrl = output.originalVideoUrl;
          const faceSwapError = output.faceSwapError;

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

          if (output.imageUrl) {
            actions.setGeneratedImageUrl(output.imageUrl);
          }

          actions.setVideoUrl(String(data.videoUrl));
          actions.setHasGenerated(true);
          actions.setAudioMerged(Boolean(data.audioMerged || output.audioMerged));
          actions.setIsGenerating(false);
          actions.setPendingVideoId(null);
          return;
        }

        if (data.status === 'failed' || data.status === 'canceled') {
          throw new Error(data.error || 'Video generation failed');
        }
      } catch (error: any) {
        if (generationRunRef.current !== runId) return;

        const isNetworkError =
          error?.message?.includes('Failed to fetch') ||
          error?.message?.includes('NetworkError') ||
          error?.message?.includes('Connection refused') ||
          error?.message?.includes('fetch');
        if (isNetworkError) {
          console.warn('Network error during polling, will retry:', error.message);
          return;
        }

        console.error('Polling error:', error);
        actions.setErrorMessage(error?.message || 'Failed to check video status');
        actions.setIsGenerating(false);
        actions.setPendingVideoId(null);
      }
    };

    pollOnce();
    const intervalId = window.setInterval(pollOnce, 4000);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [actions, generationRunRef, pendingRunIdRef, pendingVideoId]);
};
