import { NextRequest, NextResponse } from 'next/server';
import Replicate from 'replicate';
import { getJob, setJob } from '@/lib/async-video-jobs';
import { fal } from '@fal-ai/client';
import { extractFirstOutputUrl, getRunwayTask, normalizeRunwayTaskStatus } from '@/lib/runway';
import { storeRunwayVideoBestEffort } from '@/lib/runway-video-storage';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const videoId = searchParams.get('id');

    if (!videoId) {
      return NextResponse.json(
        { error: 'Video ID is required' },
        { status: 400 }
      );
    }

    // Runway task id: runway:<taskId>
    if (videoId.startsWith('runway:')) {
      const taskId = videoId.slice('runway:'.length).trim();
      if (!taskId) {
        return NextResponse.json({ status: 'failed', progress: 0, statusMessage: 'Invalid Runway task id', error: 'Invalid task id', videoUrl: null, output: null });
      }
      const task = await getRunwayTask(taskId);
      const normalized = normalizeRunwayTaskStatus(task?.status);
      if (normalized === 'SUCCEEDED') {
        const outputUrl = extractFirstOutputUrl(task?.output);
        if (!outputUrl) {
          return NextResponse.json({
            status: 'failed',
            progress: 0,
            statusMessage: 'Runway succeeded but output URL is missing.',
            error: 'Missing output URL',
            videoUrl: null,
            output: task ?? null,
          });
        }
        // Best-effort: persist to our storage so URL won't expire.
        const storedUrl = await storeRunwayVideoBestEffort(outputUrl);
        return NextResponse.json({
          status: 'succeeded',
          progress: 1,
          statusMessage: 'Video generation complete!',
          error: null,
          videoUrl: storedUrl,
          output: task ?? null,
        });
      }
      if (normalized === 'FAILED') {
        const failure = (task as any)?.failure || (task as any)?.error || 'Runway failed';
        const failureCode = (task as any)?.failureCode || (task as any)?.errorCode || null;
        return NextResponse.json({
          status: 'failed',
          progress: 0,
          statusMessage: failureCode ? `Runway generation failed (${failureCode}).` : 'Runway generation failed.',
          error: failure,
          failure,
          failureCode,
          videoUrl: null,
          output: task ?? null,
        });
      }
      return NextResponse.json({
        status: 'processing',
        progress: normalized === 'PENDING' ? 0.1 : 0.5,
        statusMessage: normalized === 'PENDING' ? 'Queued...' : 'Generating video...',
        error: null,
        videoUrl: null,
        output: task ?? null,
      });
    }

    // Async job (job_xxx): in-memory store from generate-video when body.async === true
    if (videoId.startsWith('job_')) {
      const job = await getJob(videoId);
      if (!job) {
        // Job record can lag behind the initial POST response during dev reload/HMR or cold start.
        // Keep the client polling instead of failing immediately.
        return NextResponse.json({
          status: 'processing',
          progress: 0.05,
          statusMessage: 'Video job is starting...',
          error: null,
          videoUrl: null,
          output: null,
        });
      }
      const result = (job.result || {}) as Record<string, unknown>;
      const storedVideoUrl =
        typeof result.videoUrl === 'string' && result.videoUrl.trim()
          ? result.videoUrl.trim()
          : null;

      if (job.status === 'failed' && !storedVideoUrl) {
        return NextResponse.json({
          status: 'failed',
          progress: 0,
          statusMessage: job.error || 'Generation failed',
          error: job.error || null,
          videoUrl: null,
          output: null,
        });
      }

      if (job.status === 'succeeded' && storedVideoUrl) {
        return NextResponse.json({
          status: 'succeeded',
          progress: 1,
          statusMessage: 'Video generation complete!',
          error: null,
          videoUrl: storedVideoUrl,
          output: result,
          audioMerged: Boolean((result as { audioMerged?: boolean }).audioMerged),
        });
      }

      const nestedVideoId =
        typeof result.videoId === 'string' && result.videoId.trim()
          ? result.videoId.trim()
          : '';

      if (!storedVideoUrl && nestedVideoId && nestedVideoId !== videoId && !nestedVideoId.startsWith('job_')) {
        const nestedStatusUrl = new URL(request.url);
        nestedStatusUrl.searchParams.set('id', nestedVideoId);

        const nestedResponse = await fetch(nestedStatusUrl.toString(), { cache: 'no-store' });
        const nestedData = await nestedResponse.json().catch(() => ({}));

        if (nestedResponse.ok && nestedData?.status === 'succeeded' && nestedData?.videoUrl) {
          const mergedResult = {
            ...result,
            ...nestedData,
            videoId: nestedVideoId,
            videoUrl: String(nestedData.videoUrl),
          };
          await setJob(videoId, {
            status: 'succeeded',
            result: mergedResult,
            userId: job.userId,
            createdAt: job.createdAt,
          });
          return NextResponse.json({
            status: 'succeeded',
            progress: 1,
            statusMessage: nestedData.statusMessage || 'Video generation complete!',
            error: null,
            videoUrl: String(nestedData.videoUrl),
            output: mergedResult,
            audioMerged: Boolean(nestedData.audioMerged || (mergedResult as { audioMerged?: boolean }).audioMerged),
          });
        }

        if (
          nestedResponse.ok
          && (nestedData?.status === 'failed' || nestedData?.status === 'canceled' || nestedData?.status === 'error')
        ) {
          const message = String(nestedData?.error || nestedData?.statusMessage || 'Generation failed');
          const retryableNested = /\b(not found|throttl|timeout|temporarily|starting|processing)\b/i.test(message);
          if (retryableNested) {
            return NextResponse.json({
              status: 'processing',
              progress: typeof nestedData?.progress === 'number' ? nestedData.progress : 0.5,
              statusMessage: nestedData?.statusMessage || 'Generating video...',
              error: null,
              videoUrl: null,
              output: {
                ...result,
                nestedStatus: nestedData || null,
              },
            });
          }
          await setJob(videoId, {
            status: 'failed',
            error: message,
            result: {
              ...result,
              nestedStatus: nestedData,
            },
            userId: job.userId,
            createdAt: job.createdAt,
          });
          return NextResponse.json({
            status: 'failed',
            progress: 0,
            statusMessage: message,
            error: message,
            videoUrl: null,
            output: {
              ...result,
              nestedStatus: nestedData,
            },
          });
        }

        return NextResponse.json({
          status: 'processing',
          progress: typeof nestedData?.progress === 'number' ? nestedData.progress : 0.5,
          statusMessage: nestedData?.statusMessage || 'Generating video...',
          error: null,
          videoUrl: null,
          output: {
            ...result,
            nestedStatus: nestedData || null,
          },
        });
      }

      if (job.status === 'pending' && !storedVideoUrl) {
        return NextResponse.json({
          status: 'processing',
          progress: 0.5,
          statusMessage: 'Generating video...',
          error: null,
          videoUrl: null,
          output: result,
        });
      }

      const videoUrl = storedVideoUrl;
      if (!videoUrl) {
        return NextResponse.json({
          status: 'processing',
          progress: 0.5,
          statusMessage: 'Generating video...',
          error: null,
          videoUrl: null,
          output: result,
        });
      }
      return NextResponse.json({
        status: 'succeeded',
        progress: 1,
        statusMessage: 'Video generation complete!',
        error: null,
        videoUrl,
        output: result,
      });
    }

    // fal queue id: fal:<urlEncodedModel>:<requestId>
    if (videoId.startsWith('fal:')) {
      const parts = videoId.split(':');
      const modelEncoded = parts[1] || '';
      const requestId = parts.slice(2).join(':');
      const model = decodeURIComponent(modelEncoded);
      const key = String(process.env.FAL_KEY || '').trim();
      if (!key) {
        return NextResponse.json(
          { error: 'FAL_KEY not configured', status: 'error' },
          { status: 500 }
        );
      }
      fal.config({ credentials: key });
      let st: any = null;
      try {
        st = await fal.queue.status(model, { requestId, logs: false } as any);
      } catch (error: any) {
        const body = error?.body ?? error?.response?.data ?? null;
        const detail =
          body?.detail
          || body?.error
          || body?.message
          || error?.message
          || 'Fal status check failed';
        const message = typeof detail === 'string' ? detail : JSON.stringify(detail);
        console.error('Fal status check error:', {
          model,
          requestId,
          status: error?.status,
          body,
          message,
        });
        return NextResponse.json({
          status: 'failed',
          progress: 0,
          statusMessage: message,
          error: message,
          videoUrl: null,
          output: {
            provider: 'fal',
            model,
            requestId,
            status: error?.status ?? null,
            body,
          },
        });
      }
      const status = String((st as any)?.status || '').toUpperCase();
      if (status === 'COMPLETED') {
        const result = await fal.queue.result(model, { requestId } as any);
        const data = (result as any)?.data ?? result;
        const videoUrl =
          data?.video?.url
          || data?.output?.video?.url
          || data?.url
          || null;
        return NextResponse.json({
          status: 'succeeded',
          progress: 1,
          statusMessage: 'Video generation complete!',
          error: null,
          videoUrl,
          output: data ?? null,
        });
      }
      if (status === 'FAILED' || status === 'CANCELED') {
        const message = String((st as any)?.error || (st as any)?.message || 'Fal generation failed');
        return NextResponse.json({
          status: 'failed',
          progress: 0,
          statusMessage: message,
          error: message,
          videoUrl: null,
          output: (st as any) ?? null,
        });
      }
      return NextResponse.json({
        status: 'processing',
        progress: status === 'IN_QUEUE' ? 0.1 : 0.5,
        statusMessage: status === 'IN_QUEUE' ? 'Queued...' : 'Generating video...',
        error: null,
        videoUrl: null,
        output: (st as any) ?? null,
      });
    }

    // Replicate prediction id (r8_xxx or similar)
    const apiToken = process.env.REPLICATE_API_TOKEN;
    if (!apiToken || apiToken.trim() === '') {
      console.error('REPLICATE_API_TOKEN not found in environment');
      return NextResponse.json(
        {
          error: 'API token not configured',
          details: 'Please set REPLICATE_API_TOKEN in your .env.local file and restart your dev server'
        },
        { status: 500 }
      );
    }
    if (!apiToken.startsWith('r8_')) {
      return NextResponse.json(
        { error: 'Invalid API token format' },
        { status: 500 }
      );
    }

    const replicate = new Replicate({
      auth: apiToken.trim(),
    });

    const prediction = await replicate.predictions.get(videoId);

    // Calculate progress based on status
    let progress = 0;
    let statusMessage = '';
    let videoUrl: string | null = null;

    switch (prediction.status) {
      case 'starting':
        progress = 10;
        statusMessage = 'Initializing video generation...';
        break;
      case 'processing':
        progress = 50;
        statusMessage = 'Generating video frames...';
        break;
      case 'succeeded':
        progress = 100;
        statusMessage = 'Video generation complete!';
        // Extract video URL from output
        if (prediction.output) {
          if (Array.isArray(prediction.output)) {
            videoUrl = prediction.output[0] || null;
          } else if (typeof prediction.output === 'string') {
            videoUrl = prediction.output;
          } else if (typeof prediction.output === 'object' && prediction.output !== null) {
            // Try to find video URL in object
            const output = prediction.output as any;
            videoUrl = output.video || output.url || output.mp4 || null;
            
            // If still no URL, search for any string starting with http
            if (!videoUrl) {
              const searchForUrl = (obj: any): string | null => {
                if (typeof obj === 'string' && obj.startsWith('http')) {
                  return obj;
                }
                if (Array.isArray(obj)) {
                  for (const item of obj) {
                    const found = searchForUrl(item);
                    if (found) return found;
                  }
                }
                if (typeof obj === 'object' && obj !== null) {
                  for (const value of Object.values(obj)) {
                    const found = searchForUrl(value);
                    if (found) return found;
                  }
                }
                return null;
              };
              videoUrl = searchForUrl(output);
            }
          }
        }
        break;
      case 'failed':
        progress = 0;
        statusMessage = `Video generation failed: ${prediction.error || 'Unknown error'}`;
        break;
      case 'canceled':
        progress = 0;
        statusMessage = 'Video generation canceled';
        break;
      default:
        progress = 25;
        statusMessage = 'Waiting for video generation to start...';
    }

    return NextResponse.json({
      status: prediction.status,
      progress: progress / 100, // Normalize to 0-1
      statusMessage: statusMessage,
      error: prediction.error || null,
      videoUrl: videoUrl,
      output: prediction.output || null,
    });

  } catch (error: any) {
    console.error('Status check error:', error);
    const providerStatus = Number(error?.status || error?.response?.status || 0);
    if (providerStatus === 422) {
      const body = error?.body ?? error?.response?.data ?? null;
      const detail =
        body?.detail
        || body?.error
        || body?.message
        || error?.message
        || 'Video provider rejected the status request.';
      const message = typeof detail === 'string' ? detail : JSON.stringify(detail);
      return NextResponse.json({
        error: message,
        status: 'failed',
        progress: 0,
        statusMessage: message,
        videoUrl: null,
        output: {
          providerStatus,
          requestId: error?.requestId ?? null,
          body,
        },
      });
    }
    return NextResponse.json(
      { 
        error: error.message || 'Failed to check video generation status',
        status: 'error'
      },
      { status: 500 }
    );
  }
}
