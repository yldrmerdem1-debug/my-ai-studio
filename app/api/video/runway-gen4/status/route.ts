import { NextRequest, NextResponse } from 'next/server';
import { downloadMediaWithValidation } from '@/lib/replicate-media';
import { getStorageProvider, makeStorageObjectKey } from '@/lib/storage';
import { extractFirstOutputUrl, getRunwayTask, normalizeRunwayTaskStatus } from '@/lib/runway';

export const runtime = 'nodejs';

const storeVideoBestEffort = async (url: string): Promise<string> => {
  try {
    const media = await downloadMediaWithValidation(url, {
      expectedKind: 'video',
      strictExpectedKind: true,
      logger: {
        info: (...args) => console.log(...args),
        warn: (...args) => console.warn(...args),
      },
    });
    const provider = getStorageProvider();
    const key = makeStorageObjectKey('generated/runway', media.contentType || 'video/mp4', 'runway.mp4');
    await provider.upload(media.buffer, media.contentType || 'video/mp4', key);
    return await provider.getSignedUrl(key, 60 * 60 * 24);
  } catch (error) {
    console.warn('Runway output store failed; falling back to ephemeral URL.', (error as any)?.message || error);
    return url;
  }
};

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const taskId = String(searchParams.get('task_id') || searchParams.get('id') || '').trim();
    if (!taskId) {
      return NextResponse.json({ error: 'task_id is required.' }, { status: 400 });
    }

    const task = await getRunwayTask(taskId);
    const status = normalizeRunwayTaskStatus(task?.status);

    if (status !== 'SUCCEEDED') {
      return NextResponse.json({
        success: true,
        task_id: taskId,
        status,
        runwayStatus: task?.status || null,
        videoUrl: null,
      });
    }

    const outputUrl = extractFirstOutputUrl(task?.output);
    if (!outputUrl) {
      return NextResponse.json({
        success: true,
        task_id: taskId,
        status: 'FAILED',
        runwayStatus: task?.status || null,
        videoUrl: null,
        error: 'Runway task succeeded but output URL is missing.',
      });
    }

    const storedUrl = await storeVideoBestEffort(outputUrl);
    return NextResponse.json({
      success: true,
      task_id: taskId,
      status: 'SUCCEEDED',
      runwayStatus: task?.status || null,
      videoUrl: storedUrl,
      outputUrl,
    });
  } catch (error: any) {
    const message = String(error?.message || 'Unknown error');
    console.error('Runway status error:', message);
    return NextResponse.json({ error: message, status: 'FAILED' }, { status: 500 });
  }
}

