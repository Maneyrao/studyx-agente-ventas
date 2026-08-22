import {
  commitAgentDecision,
  type CommitDecisionInput,
  type CommitDecisionResult,
} from '@/lib/services/decision.service';
import { logger } from '@/lib/observability/structured-log';
import type { CompleteBatchOutcome, OrchestrationStore } from '../ports/orchestration-store';

/**
 * `commitAgentDecision` plus the batch lifecycle close (spec §8: "El batch
 * debe terminar completed; no puede quedar claimed con lease vencida
 * después del commit").
 *
 * The two writes are deliberately NOT one transaction. The decision commit
 * is canonical and must stand on its own the moment it lands — a customer
 * already has (or is about to get) their answer. Closing the batch is a
 * separate, best-effort step that runs only after a commit or a replay
 * actually produced a result (never before, never on a rejected decision)
 * and NEVER re-throws: a stale claim_token, a foreign batch_id, or a
 * transient DB error here must log and pause, not duplicate the decision or
 * the outbound that just committed. The reconciler (`reconcile-orchestration`)
 * is what recovers a batch left behind by a close failure — this function's
 * only job is to try once and never lie about the outcome.
 */

export interface CommitClaimedDecisionInput extends CommitDecisionInput {
  /**
   * Proof of ownership from the claim this decision answers. Both null
   * together means "no batch to close" (a caller predating batching, or a
   * direct decision.service caller in a test) — completeBatch is simply
   * skipped, exactly like every other optional/degradable step in this
   * pipeline. Only one of the two being null is treated the same way: a
   * batch_id without its claim_token (or vice versa) cannot prove ownership,
   * so closing is skipped rather than guessed at.
   */
  readonly batch_id: string | null;
  readonly claim_token: string | null;
}

export interface CommitClaimedDecisionDependencies {
  readonly store: OrchestrationStore;
}

export type BatchCompletionOutcome = CompleteBatchOutcome | 'skipped' | 'error';

export interface CommitClaimedDecisionResult extends CommitDecisionResult {
  readonly batch_completion: BatchCompletionOutcome;
}

export async function commitClaimedDecision(
  input: CommitClaimedDecisionInput,
  deps: CommitClaimedDecisionDependencies,
): Promise<CommitClaimedDecisionResult> {
  const result = await commitAgentDecision(input);

  // A rejected decision never claimed to have finished anything with this
  // batch's turn; closing it here would be this function inventing an
  // outcome the commit itself did not produce.
  if (result.status === 'rejected' || input.batch_id === null || input.claim_token === null) {
    return { ...result, batch_completion: 'skipped' };
  }

  try {
    const completion = await deps.store.completeBatch({
      batch_id: input.batch_id,
      claim_token: input.claim_token,
    });
    if (completion.outcome !== 'completed' && completion.outcome !== 'duplicate') {
      // The decision already committed; this is a signal for the
      // reconciler/operator, never a reason to retry the commit itself.
      logger.error({
        event: 'orchestration.batch.close_failed',
        trace_id: input.trace_id,
        turn_id: input.turn_id,
        batch_id: input.batch_id,
        outcome: completion.outcome,
      });
    }
    return { ...result, batch_completion: completion.outcome };
  } catch (error) {
    logger.error({
      event: 'orchestration.batch.close_error',
      trace_id: input.trace_id,
      turn_id: input.turn_id,
      batch_id: input.batch_id,
      error: String(error),
    });
    return { ...result, batch_completion: 'error' };
  }
}
