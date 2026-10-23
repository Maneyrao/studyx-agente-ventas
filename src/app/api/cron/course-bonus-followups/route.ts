import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { dispatchDueCommercialFollowupsV1 } from '@/features/promotions/application/commercial-followup-service';
import { logger } from '@/lib/observability/structured-log';

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || request.headers.get('authorization') !== expected) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }
  const traceId = request.headers.get('x-trace-id') ?? randomUUID();
  try {
    const result = await dispatchDueCommercialFollowupsV1();
    logger.info({ event: 'cron.course_bonus_followups.completed', trace_id: traceId, ...result });
    return NextResponse.json(result);
  } catch (error) {
    logger.error({
      event: 'cron.course_bonus_followups.failed',
      trace_id: traceId,
      error_name: error instanceof Error ? error.name : 'unknown',
    });
    return NextResponse.json({ error: 'COURSE_BONUS_FOLLOWUP_DISPATCH_FAILED', trace_id: traceId }, { status: 500 });
  }
}
