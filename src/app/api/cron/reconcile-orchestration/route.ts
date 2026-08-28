import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import {
  paymentProjectionReconciliationHttpStatus,
  reconcileOrchestration,
} from '@/features/orchestration/application/reconcile-orchestration';
import { reconciliationStore } from '@/features/orchestration/adapters/postgres-reconciliation-store';
import { auditLog } from '@/lib/audit/logger';
import { counter } from '@/lib/observability/counters';
import { logger } from '@/lib/observability/structured-log';
import { reconcileDeliveredPaymentProjections } from '@/lib/services/decision.service';
import { projectAgentAMemories } from '@/features/memory/application/project-agent-a-memories';

/**
 * GET /api/cron/reconcile-orchestration
 *
 * The only scheduled process allowed to repair work another process abandoned.
 *
 * Protected by `CRON_SECRET`, which Vercel Cron injects as a bearer token. The
 * orchestrator HMAC does not apply here: `src/proxy.ts` exempts `/api/cron/*`
 * precisely because a scheduled request has no Botpress signature to offer.
 *
 * It never sends a message. The most it can do is return a delivery to
 * `pending` after proving it was never sent — everything ambiguous is paused,
 * and stays paused, until a person looks at it.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const traceId = request.headers.get('x-trace-id') ?? randomUUID();

  try {
    const result = await reconcileOrchestration(
      { trace_id: traceId },
      {
        store: reconciliationStore,
        log: (event, fields) => logger.info({ event, ...fields }),
        audit: async (entry) => {
          await auditLog(entry);
        },
        reconcilePaymentProjections: reconcileDeliveredPaymentProjections,
        projectAgentAMemories: (input) => projectAgentAMemories(input, {
          log: (event, fields) => logger.info({ event, ...fields }),
          audit: auditLog,
        }),
      }
    );

    if (result.claims.abandoned > 0) {
      counter.increment('reconcile_claims_abandoned', result.claims.abandoned);
    }
    if (result.claims.reclaimable > 0) {
      counter.increment('reconcile_claims_reclaimable', result.claims.reclaimable);
    }
    if (result.deliveries.by_action.pause_ambiguous > 0) {
      counter.increment(
        'reconcile_deliveries_ambiguous',
        result.deliveries.by_action.pause_ambiguous
      );
    }
    if (result.deliveries.by_action.authorize_resend > 0) {
      counter.increment(
        'reconcile_resends_authorized',
        result.deliveries.by_action.authorize_resend
      );
    }
    if (result.deliveries.by_action.mark_sent > 0) {
      counter.increment('reconcile_deliveries_confirmed', result.deliveries.by_action.mark_sent);
    }
    if (result.deliveries.by_action.abandon > 0) {
      counter.increment('reconcile_deliveries_abandoned', result.deliveries.by_action.abandon);
    }
    if (result.orphaned_decisions > 0) {
      counter.increment('reconcile_orphaned_decisions', result.orphaned_decisions);
    }
    const totalFailures = result.deliveries.failed
      + result.payment_projections.failed
      + result.memory_projections.failed;
    if (totalFailures > 0) {
      counter.increment('reconcile_failures', totalFailures);
    }

    return NextResponse.json(result, {
      status: paymentProjectionReconciliationHttpStatus(result.payment_projections.status),
    });
  } catch (error) {
    logger.error({
      event: 'cron.reconcile_orchestration.failed',
      trace_id: traceId,
      error: String(error),
    });
    return NextResponse.json({ error: 'RECONCILIATION_FAILED', trace_id: traceId }, { status: 500 });
  }
}
