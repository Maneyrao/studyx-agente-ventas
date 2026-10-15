import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { scheduleRejectedTurnRecovery } from '@/features/orchestration/adapters/postgres-turn-recovery';
import { loadAgentACommercialConfig } from '@/lib/config';
import { logger, timedStage } from '@/lib/observability/structured-log';
const bodySchema = z.object({ trace_id: z.string().uuid(), claim_token: z.string().uuid(),
  reason_code: z.string().regex(/^[A-Z0-9_]{1,128}$/u) }).strict();

export async function POST(request: NextRequest, context: { params: Promise<{ batch_id: string }> }) {
  const { batch_id } = await context.params;
  if (!z.string().uuid().safeParse(batch_id).success) {
    return NextResponse.json({ error: 'INVALID_BATCH_ID' }, { status: 400 });
  }
  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'VALIDATION_ERROR' }, { status: 400 });
  const result = await timedStage('orchestration.recovery.schedule', { trace_id: parsed.data.trace_id }, () =>
    scheduleRejectedTurnRecovery({ batchId: batch_id, claimToken: parsed.data.claim_token,
      reasonCode: parsed.data.reason_code, workspaceSlug: loadAgentACommercialConfig().workspaceSlug }));
  logger[result.outcome === 'exhausted' ? 'error' : 'info']({ event: 'orchestration.turn.recovery',
    trace_id: parsed.data.trace_id, batch_id, ...result });
  return NextResponse.json(result);
}
