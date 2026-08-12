import { sql } from '@/lib/db/orchestrator';
import type { DbClient } from '@/lib/db/types';
import type {
  AppliedReconciliation,
  ExpiredClaim,
  OrphanedDecision,
  ReconciliationStore,
  StaleDelivery,
} from '../ports/reconciliation-store';
import type { DeliveryReconciliationAction } from '../domain/delivery-reconciliation';

/**
 * PostgreSQL adapter for the reconciler.
 *
 * Reads return *facts*, never verdicts: the rule that decides whether a
 * delivery may be resent lives in the domain, in TypeScript, where it can be
 * exercised across the whole state space without a database. SQL's job here is
 * to find the rows and to apply a verdict atomically once it is made.
 */
export class PostgresReconciliationStore implements ReconciliationStore {
  constructor(private readonly db: DbClient = sql) {}

  async expireStaleClaims(input: { max_claim_attempts?: number; limit?: number } = {}) {
    return this.db<ExpiredClaim[]>`
      SELECT batch_id, conversation_id, claim_attempt_count, action
      FROM expire_inbound_batch_claims(${input.max_claim_attempts ?? 3}, ${input.limit ?? 100})
    `;
  }

  async listStaleDeliveries(input: { limit?: number; grace_seconds?: number } = {}) {
    return this.db<StaleDelivery[]>`
      SELECT
        delivery_id, outbound_id, conversation_id, contact_id, state,
        provider_message_id, attempt_count, max_attempts,
        lease_until, reported_status, reconciliation_state
      FROM list_stale_outbound_deliveries(${input.limit ?? 50}, ${input.grace_seconds ?? 60})
    `;
  }

  async applyDeliveryVerdict(input: {
    delivery_id: string;
    action: DeliveryReconciliationAction;
    reason: string;
  }): Promise<AppliedReconciliation> {
    const rows = await this.db<AppliedReconciliation[]>`
      SELECT applied, new_state, new_reconciliation_state
      FROM apply_delivery_reconciliation(
        ${input.delivery_id}::uuid,
        ${input.action},
        ${input.reason}
      )
    `;
    return rows[0] ?? { applied: false, new_state: null, new_reconciliation_state: null };
  }

  async listOrphanedDecisions(input: { limit?: number; grace_seconds?: number } = {}) {
    return this.db<OrphanedDecision[]>`
      SELECT decision_id, turn_id, trace_id, created_at
      FROM list_orphaned_decisions(${input.limit ?? 50}, ${input.grace_seconds ?? 300})
    `;
  }
}

export const reconciliationStore = new PostgresReconciliationStore();
