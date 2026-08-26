import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  claimBatch,
  BatchFactsMissingError,
  DEFAULT_CONTEXT_LIMITS,
} from '@/features/orchestration/application/claim-batch';
import { orchestrationStore } from '@/features/orchestration/adapters/postgres-orchestration-store';
import {
  knowledgeRetriever,
  memoryRetriever,
  queryEmbedder,
} from '@/features/orchestration/adapters/postgres-retrievers';
import { businessContextStore } from '@/features/orchestration/adapters/postgres-business-context';
import {
  buildBusinessContextView,
  buildCatalogIndexView,
} from '@/features/orchestration/domain/business-context';
import { config, loadAgentACommercialConfig } from '@/lib/config';
import { logger, timedStage } from '@/lib/observability/structured-log';
import { counter } from '@/lib/observability/counters';

/**
 * The workspace is fixed by deployment configuration. Commercial automation
 * must not claim a turn without its complete configured source of truth.
 */
function businessContextLoader(workspaceSlug: string) {
  return {
    async load() {
      const raw = await businessContextStore.loadBusinessContext(workspaceSlug);
      return raw ? buildBusinessContextView(raw) : null;
    },
    async loadCompleteIndex() {
      const raw = await businessContextStore.loadCompleteIndex(workspaceSlug);
      return raw ? buildCatalogIndexView(raw) : null;
    },
    async loadByCode(code: string) {
      const raw = await businessContextStore.loadByCode(workspaceSlug, code);
      return raw ? buildBusinessContextView(raw) : null;
    },
  };
}

type UnclaimedCounter =
  | 'batch_claim_waiting'
  | 'batch_claim_absorbed'
  | 'batch_claim_completed'
  | 'batch_claim_abandoned'
  | 'batch_claim_not_found';

/**
 * POST /api/agent/batches/:batch_id/claim
 *
 * The single gate between "a message arrived" and "the model may speak". At
 * most one caller ever receives 200 with a claim token for a given window;
 * everyone else is told, explicitly, that they are not the owner.
 *
 * Status codes carry the outcome so the workflow never has to parse prose:
 *   200 claimed   — this caller owns the batch, body holds the controlled context
 *   202 waiting   — window still open, `retry_after_ms` says how long to sleep
 *   409 absorbed  — another workflow owns it; stop, do not call the model
 *   409 completed — the batch already produced its decision
 *   410 abandoned — terminal, the reconciler owns it now
 *   404 not_found
 */

const bodySchema = z.object({
  trace_id: z.string().uuid(),
  claimed_by: z.string().trim().min(1).max(128),
});

const uuidSchema = z.string().uuid();

const UNCLAIMED_STATUS: Record<string, number> = {
  waiting: 202,
  absorbed: 409,
  completed: 409,
  abandoned: 410,
  not_found: 404,
};

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ batch_id: string }> }
) {
  const { batch_id } = await context.params;
  if (!uuidSchema.safeParse(batch_id).success) {
    return NextResponse.json({ error: 'INVALID_BATCH_ID' }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'VALIDATION_ERROR', details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  let workspaceSlug: string;
  try {
    workspaceSlug = loadAgentACommercialConfig().workspaceSlug;
  } catch (error) {
    const code = error instanceof Error ? error.message : 'AGENT_A_CONFIGURATION_INVALID';
    logger.error({
      event: 'orchestration.claim.agent_a_not_ready',
      batch_id,
      trace_id: parsed.data.trace_id,
      error_code: code,
    });
    return NextResponse.json({ error: 'AGENT_A_NOT_READY', reason: code }, { status: 503 });
  }

  try {
    const result = await timedStage(
      'orchestration.claim',
      { trace_id: parsed.data.trace_id, batch_id },
      () => claimBatch(
      { batch_id, claimed_by: parsed.data.claimed_by, trace_id: parsed.data.trace_id },
      {
        store: orchestrationStore,
        embedding: queryEmbedder,
        memory: memoryRetriever,
        knowledge: knowledgeRetriever,
        limits: {
          ...DEFAULT_CONTEXT_LIMITS,
          recentTurns: config.recentTurnsLimit,
          memoryResults: config.ltmResultsLimit,
          knowledgeResults: config.kbResultsLimit,
          knowledgeMinSimilarity: config.kbMinSimilarity,
        },
        log: (event, fields) => logger.info({ event, ...fields }),
        business: businessContextLoader(workspaceSlug),
      }
    )
    );

    if (result.outcome !== 'claimed') {
      counter.increment(`batch_claim_${result.outcome}` as UnclaimedCounter);
      return NextResponse.json(result, { status: UNCLAIMED_STATUS[result.outcome] ?? 409 });
    }

    counter.increment('batch_claim_claimed');
    if (result.batch.stolen) counter.increment('batch_claim_stolen');
    if (!result.context.long_term_memory_available) {
      counter.increment('batch_context_memory_unavailable');
    }
    if (!result.context.knowledge_base_available) {
      counter.increment('batch_context_knowledge_unavailable');
    }
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    if (error instanceof BatchFactsMissingError) {
      return NextResponse.json({ error: error.code }, { status: 409 });
    }
    logger.error({
      event: 'orchestration.claim.failed',
      batch_id,
      trace_id: parsed.data.trace_id,
      error: String(error),
    });
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
