import {
  decideDeliveryReconciliation,
  type DeliveryReconciliationAction,
} from '../domain/delivery-reconciliation';
import type { ReconciliationStore } from '../ports/reconciliation-store';

/**
 * One reconciliation sweep.
 *
 * Everything in this system that can be interrupted is interrupted in a row:
 * a batch claimed by a workflow that died, a delivery leased and never
 * reported, a decision whose outbound never materialized. Nothing else in the
 * codebase is allowed to repair those, precisely so the repair rules live in
 * exactly one place.
 *
 * The sweep is deliberately dull:
 *
 * - It never sends anything. It can only *authorize* a resend by returning the
 *   delivery to `pending`; the physical send belongs to whoever owns the
 *   channel. That separation is what makes "no blind retries" enforceable.
 * - It never resolves an ambiguity in favour of acting. A delivery it cannot
 *   prove unsent becomes `ambiguous_paused` and stays there until a person
 *   looks at it.
 * - It is idempotent. Running it twice in a row produces the same rows; every
 *   verdict is derived from current state, and the paused verdict is sticky.
 * - One bad row cannot stop the sweep. Failures are counted and reported.
 */

export interface ReconcileOrchestrationInput {
  readonly trace_id: string;
  readonly claim_limit?: number;
  readonly delivery_limit?: number;
  readonly max_claim_attempts?: number;
  /** How long a row must sit untouched before the sweep treats it as stale. */
  readonly grace_seconds?: number;
  readonly now?: number;
}

export interface ReconcileOrchestrationResult {
  readonly trace_id: string;
  readonly claims: {
    readonly examined: number;
    readonly abandoned: number;
    readonly reclaimable: number;
  };
  readonly deliveries: {
    readonly examined: number;
    readonly by_action: Record<DeliveryReconciliationAction, number>;
    readonly failed: number;
  };
  readonly orphaned_decisions: number;
  readonly findings: Array<{
    readonly kind: 'claim' | 'delivery' | 'decision';
    readonly id: string;
    readonly action: string;
    readonly reason: string;
  }>;
}

export interface ReconcileOrchestrationDependencies {
  readonly store: ReconciliationStore;
  readonly log?: (event: string, fields: Record<string, unknown>) => void;
  readonly audit?: (entry: {
    action: string;
    entity_type: string;
    entity_id: string;
    payload: Record<string, unknown>;
    event_key: string;
    correlation_id: string;
  }) => Promise<void>;
}

const EMPTY_ACTIONS: Record<DeliveryReconciliationAction, number> = {
  authorize_resend: 0,
  abandon: 0,
  mark_sent: 0,
  pause_ambiguous: 0,
  wait: 0,
};

export async function reconcileOrchestration(
  input: ReconcileOrchestrationInput,
  deps: ReconcileOrchestrationDependencies
): Promise<ReconcileOrchestrationResult> {
  const log = deps.log ?? (() => {});
  const now = input.now ?? Date.now();
  const findings: ReconcileOrchestrationResult['findings'] = [];
  const byAction = { ...EMPTY_ACTIONS };

  // ── Claims vencidos ──────────────────────────────────────────────────────
  // Un lote con lease vencido no vuelve a `waiting`: chocaría con el índice
  // parcial si la conversación ya abrió otra ventana. Se roba o se abandona.
  const claims = await deps.store.expireStaleClaims({
    max_claim_attempts: input.max_claim_attempts,
    limit: input.claim_limit,
  });
  let abandoned = 0;
  let reclaimable = 0;
  for (const claim of claims) {
    if (claim.action === 'abandoned') abandoned += 1;
    else reclaimable += 1;
    findings.push({
      kind: 'claim',
      id: claim.batch_id,
      action: claim.action,
      reason: 'CLAIM_LEASE_EXPIRED',
    });
  }
  if (claims.length > 0) {
    log('orchestration.reconcile.claims', {
      trace_id: input.trace_id,
      examined: claims.length,
      abandoned,
      reclaimable,
    });
  }

  // ── Entregas huérfanas ───────────────────────────────────────────────────
  const stale = await deps.store.listStaleDeliveries({
    limit: input.delivery_limit,
    grace_seconds: input.grace_seconds,
  });
  let failed = 0;

  for (const delivery of stale) {
    const verdict = decideDeliveryReconciliation({
      state: delivery.state,
      provider_message_id: delivery.provider_message_id,
      attempt_count: delivery.attempt_count,
      max_attempts: delivery.max_attempts,
      lease_until: delivery.lease_until,
      reported_status: delivery.reported_status,
      reconciliation_state: delivery.reconciliation_state,
      now,
    });

    byAction[verdict.action] += 1;
    if (verdict.action === 'wait') continue;

    try {
      const applied = await deps.store.applyDeliveryVerdict({
        delivery_id: delivery.delivery_id,
        action: verdict.action,
        reason: verdict.reason,
      });

      findings.push({
        kind: 'delivery',
        id: delivery.outbound_id,
        action: applied.new_reconciliation_state ?? verdict.action,
        reason: verdict.reason,
      });

      await deps.audit?.({
        action: `orchestration.reconcile.${verdict.action}`,
        entity_type: 'message',
        entity_id: delivery.outbound_id,
        payload: {
          delivery_id: delivery.delivery_id,
          previous_state: delivery.state,
          new_state: applied.new_state,
          reconciliation_state: applied.new_reconciliation_state,
          reason: verdict.reason,
          attempt_count: delivery.attempt_count,
        },
        // Deterministic per outbound + verdict, so replaying the sweep does not
        // pile up duplicate audit rows for the same repair.
        event_key: `reconcile:${delivery.delivery_id}:${verdict.action}:${delivery.attempt_count}`,
        correlation_id: input.trace_id,
      });

      if (verdict.action === 'pause_ambiguous') {
        log('orchestration.reconcile.ambiguous_paused', {
          trace_id: input.trace_id,
          outbound_id: delivery.outbound_id,
          delivery_id: delivery.delivery_id,
          reason: verdict.reason,
        });
      }
    } catch (error) {
      // A row the sweep cannot repair must not stop it repairing the rest.
      failed += 1;
      log('orchestration.reconcile.delivery_failed', {
        trace_id: input.trace_id,
        delivery_id: delivery.delivery_id,
        action: verdict.action,
        error: String(error),
      });
    }
  }

  // ── Decisiones sin outbound ──────────────────────────────────────────────
  // No se reparan desde acá: una decisión es inmutable después del commit, así
  // que lo único honesto es dejarlas visibles.
  const orphaned = await deps.store.listOrphanedDecisions({
    limit: input.delivery_limit,
    grace_seconds: input.grace_seconds,
  });
  for (const decision of orphaned) {
    findings.push({
      kind: 'decision',
      id: decision.decision_id,
      action: 'needs_review',
      reason: 'DECISION_WITHOUT_OUTBOUND',
    });
    log('orchestration.reconcile.orphaned_decision', {
      trace_id: input.trace_id,
      decision_id: decision.decision_id,
      turn_id: decision.turn_id,
      decision_trace_id: decision.trace_id,
    });
  }

  const result: ReconcileOrchestrationResult = {
    trace_id: input.trace_id,
    claims: { examined: claims.length, abandoned, reclaimable },
    deliveries: { examined: stale.length, by_action: byAction, failed },
    orphaned_decisions: orphaned.length,
    findings,
  };

  log('orchestration.reconcile.completed', {
    trace_id: input.trace_id,
    claims_examined: claims.length,
    deliveries_examined: stale.length,
    paused_ambiguous: byAction.pause_ambiguous,
    resends_authorized: byAction.authorize_resend,
    marked_sent: byAction.mark_sent,
    abandoned_deliveries: byAction.abandon,
    orphaned_decisions: orphaned.length,
    failed,
  });

  return result;
}
