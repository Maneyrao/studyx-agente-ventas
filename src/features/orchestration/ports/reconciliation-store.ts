import type { DeliveryReconciliationAction } from '../domain/delivery-reconciliation';

/**
 * Port for everything the reconciler is allowed to touch.
 *
 * Narrow on purpose. The reconciler is the only process that writes to rows
 * another process abandoned, so the surface it can reach has to be exactly the
 * repair operations and nothing else — there is no generic update here, and no
 * way to send a message.
 */

export interface StaleDelivery {
  readonly delivery_id: string;
  readonly outbound_id: string;
  readonly conversation_id: string;
  readonly contact_id: string;
  readonly state:
    | 'pending'
    | 'leased'
    | 'submitted'
    | 'delivered'
    | 'failed_retryable'
    | 'dead_letter'
    | 'cancelled';
  readonly provider_message_id: string | null;
  readonly attempt_count: number;
  readonly max_attempts: number;
  readonly lease_until: string | null;
  readonly reported_status: 'submitted_to_botpress' | 'failed' | null;
  readonly reconciliation_state: string | null;
}

export interface OrphanedDecision {
  readonly decision_id: string;
  readonly turn_id: string;
  readonly trace_id: string;
  readonly created_at: string;
}

export interface ExpiredClaim {
  readonly batch_id: string;
  readonly conversation_id: string;
  readonly claim_attempt_count: number;
  readonly action: 'abandoned' | 'reclaimable';
}

export interface AppliedReconciliation {
  readonly applied: boolean;
  readonly new_state: string | null;
  readonly new_reconciliation_state: string | null;
}

export interface ReconciliationStore {
  /** Batches whose lease ran out: stolen back or abandoned, never re-queued. */
  expireStaleClaims(input?: { max_claim_attempts?: number; limit?: number }): Promise<ExpiredClaim[]>;

  listStaleDeliveries(input?: { limit?: number; grace_seconds?: number }): Promise<StaleDelivery[]>;

  applyDeliveryVerdict(input: {
    delivery_id: string;
    action: DeliveryReconciliationAction;
    reason: string;
  }): Promise<AppliedReconciliation>;

  listOrphanedDecisions(input?: { limit?: number; grace_seconds?: number }): Promise<OrphanedDecision[]>;
}
