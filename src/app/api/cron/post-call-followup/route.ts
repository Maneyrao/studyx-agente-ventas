import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { runPostCallFollowup } from '@/features/calls/application/post-call-followup';
import { PostgresPostCallFollowupStore } from '@/features/calls/adapters/postgres-post-call-followup-store';
import { createPostCallOutboundSender } from '@/features/calls/adapters/post-call-outbound';
import { sql } from '@/lib/db/orchestrator';
import { counter } from '@/lib/observability/counters';
import { logger } from '@/lib/observability/structured-log';

const store = new PostgresPostCallFollowupStore(sql);

/**
 * GET /api/cron/post-call-followup
 *
 * Spec 007 — cierra el loop B→A: una llamada que terminó en estado terminal
 * inicia su propio mensaje de cierre por WhatsApp, sin esperar a que el
 * cliente escriba primero. El dominio autoriza un brief estructurado y el
 * borde emite un estado operativo mínimo; el Agente A conserva la autoría de
 * toda continuación conversacional con ese mismo contexto durable.
 *
 * Protegido por CRON_SECRET, igual que el resto de /api/cron/* — sin firma
 * HMAC de Botpress porque no hay turno de Botpress que lo dispare.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const traceId = request.headers.get('x-trace-id') ?? randomUUID();

  try {
    const result = await runPostCallFollowup(
      { trace_id: traceId },
      {
        store,
        sendOutbound: createPostCallOutboundSender(sql),
        log: (event, fields) => logger.info({ event, ...fields }),
      }
    );

    if (result.sent > 0) counter.increment('post_call_followup_sent', result.sent);
    if (result.revoked > 0) counter.increment('post_call_followup_revoked', result.revoked);
    if (result.skipped > 0) counter.increment('post_call_followup_skipped', result.skipped);
    if (result.failed > 0) counter.increment('post_call_followup_failed', result.failed);

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    logger.error({
      event: 'cron.post_call_followup.failed',
      trace_id: traceId,
      error: String(error),
    });
    return NextResponse.json({ error: 'POST_CALL_FOLLOWUP_FAILED', trace_id: traceId }, { status: 500 });
  }
}
