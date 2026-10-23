import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { repairExhaustedInboundBatch } from '@/features/orchestration/adapters/postgres-turn-recovery';
import { loadAgentACommercialConfig } from '@/lib/config';
import { logger, timedStage } from '@/lib/observability/structured-log';

const bodySchema = z.object({
  trace_id: z.string().uuid(),
  conversation_id: z.string().uuid(),
  turn_id: z.string().uuid(),
}).strict();

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ batch_id: string }> },
) {
  const { batch_id } = await context.params;
  if (!z.string().uuid().safeParse(batch_id).success) {
    return NextResponse.json({ error: 'INVALID_BATCH_ID' }, { status: 400 });
  }
  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'VALIDATION_ERROR' }, { status: 400 });
  }

  const result = await timedStage(
    'orchestration.recovery.repair',
    { trace_id: parsed.data.trace_id },
    () => repairExhaustedInboundBatch({
      batchId: batch_id,
      conversationId: parsed.data.conversation_id,
      turnId: parsed.data.turn_id,
      traceId: parsed.data.trace_id,
      workspaceSlug: loadAgentACommercialConfig().workspaceSlug,
    }),
  );
  logger[result.outcome === 'reopened' ? 'info' : 'warn']({
    event: 'orchestration.turn.repair',
    trace_id: parsed.data.trace_id,
    batch_id,
    ...result,
  });
  return NextResponse.json(result);
}
