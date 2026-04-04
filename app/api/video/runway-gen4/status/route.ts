import { NextRequest, NextResponse } from 'next/server';
import { extractFirstOutputUrl, getRunwayTask, normalizeRunwayTaskStatus } from '@/lib/runway';
import { storeRunwayVideoBestEffort } from '@/lib/runway-video-storage';

export const runtime = 'nodejs';

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

    const storedUrl = await storeRunwayVideoBestEffort(outputUrl);
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

