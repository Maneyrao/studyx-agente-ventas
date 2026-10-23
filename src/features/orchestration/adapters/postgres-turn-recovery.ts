import { sql } from '@/lib/db/orchestrator';
import type { DbClient } from '@/lib/db/types';
import { withSerializableTransactionOn } from '@/lib/db/transaction';
import { auditLog } from '@/lib/audit/logger';
import type postgres from 'postgres';
interface RecoveryOutcome {
  outcome: 'scheduled' | 'exhausted' | 'superseded' | 'not_owner' | 'already_decided';
  attempt: number;
  delay_ms: number;
}
export async function scheduleRejectedTurnRecovery(input: {
  batchId: string; claimToken: string; reasonCode: string; workspaceSlug: string;
}, db: DbClient = sql): Promise<RecoveryOutcome> {
  const [result] = await db<RecoveryOutcome[]>`
    SELECT * FROM schedule_inbound_batch_recovery(${input.batchId}::uuid,
      ${input.claimToken}::uuid, ${input.reasonCode}, ${input.workspaceSlug})
  `;
  if (!result) throw new Error('RECOVERY_RESULT_MISSING');
  return result;
}

export type ExhaustedBatchRepairOutcome =
  | { outcome: 'reopened'; replayed: boolean }
  | { outcome: 'not_eligible' | 'not_owner' | 'already_decided' | 'superseded'; replayed: false };

/**
 * Reopens one terminally exhausted, still-unanswered batch without erasing
 * its recovery ledger. This is an operator repair, not another automatic
 * retry cycle: a fresh Botpress workflow must be started explicitly after the
 * transaction commits.
 */
export async function repairExhaustedInboundBatch(input: {
  batchId: string;
  conversationId: string;
  turnId: string;
  traceId: string;
  workspaceSlug: string;
}, connection: postgres.Sql = sql): Promise<ExhaustedBatchRepairOutcome> {
  return withSerializableTransactionOn(connection, async (db) => {
    await db`SELECT id FROM conversations
      WHERE id = ${input.conversationId}::uuid FOR UPDATE`;
    const [batch] = await db<Array<{
      id: string;
      conversation_id: string;
      contact_id: string;
      representative_turn_id: string;
      state: string;
      last_error_code: string | null;
    }>>`SELECT id, conversation_id, contact_id, representative_turn_id, state, last_error_code
      FROM inbound_batches WHERE id = ${input.batchId}::uuid FOR UPDATE`;

    if (!batch
      || batch.conversation_id !== input.conversationId
      || batch.representative_turn_id !== input.turnId) {
      return { outcome: 'not_eligible', replayed: false };
    }

    const alreadyReopened = batch.state === 'waiting'
      && batch.last_error_code === 'AGENT_A_MANUAL_REPLAY_PENDING';
    if (!alreadyReopened
      && (batch.state !== 'abandoned' || batch.last_error_code !== 'AGENT_A_RECOVERY_EXHAUSTED')) {
      return { outcome: 'not_eligible', replayed: false };
    }

    const [newerInbound] = await db<Array<{ id: string }>>`
      SELECT newer.id
      FROM messages newer
      WHERE newer.conversation_id = ${input.conversationId}::uuid
        AND newer.direction = 'inbound'
        AND newer.batch_id IS DISTINCT FROM ${input.batchId}::uuid
        AND (message_occurrence_v1(newer.metadata, newer.created_at), newer.conversation_seq) > (
          SELECT message_occurrence_v1(current.metadata, current.created_at), current.conversation_seq
          FROM messages current
          WHERE current.batch_id = ${input.batchId}::uuid
          ORDER BY message_occurrence_v1(current.metadata, current.created_at) DESC,
            current.conversation_seq DESC
          LIMIT 1
        )
      ORDER BY message_occurrence_v1(newer.metadata, newer.created_at), newer.conversation_seq
      LIMIT 1`;
    if (newerInbound) return { outcome: 'superseded', replayed: false };

    const [membership] = await db<Array<{ workspace_id: string }>>`
      SELECT membership.workspace_id
      FROM workspace_contacts membership
      JOIN workspaces workspace ON workspace.id = membership.workspace_id
      WHERE membership.contact_id = ${batch.contact_id}::uuid
        AND workspace.slug = ${input.workspaceSlug}
        AND workspace.status = 'active'
        AND membership.lifecycle_status = 'active'`;
    if (!membership) return { outcome: 'not_owner', replayed: false };

    const [decision] = await db<Array<{ id: string }>>`
      SELECT id FROM agent_decisions WHERE turn_id = ${input.turnId}::uuid LIMIT 1`;
    if (decision) return { outcome: 'already_decided', replayed: false };

    // The batch marker itself is the idempotency receipt. Unlike audit_log it
    // is readable by orchestrator_role, and the current authorization and
    // freshness checks above still run on every replayed request.
    if (alreadyReopened) return { outcome: 'reopened', replayed: true };

    await db`UPDATE inbound_batches SET
      state = 'waiting',
      due_at = now(),
      hard_deadline_at = now() + interval '1 second',
      claim_token = NULL,
      claimed_by = NULL,
      claimed_at = NULL,
      lease_until = NULL,
      last_error_code = 'AGENT_A_MANUAL_REPLAY_PENDING',
      completed_at = NULL,
      version = version + 1,
      updated_at = now()
      WHERE id = ${input.batchId}::uuid`;
    const eventKey = `inbound-batch-repair:${input.batchId}`;
    await auditLog({
      action: 'inbound_batch.reopened_after_recovery_exhaustion',
      entity_type: 'inbound_batch',
      entity_id: input.batchId,
      event_key: eventKey,
      correlation_id: input.traceId,
      payload: {
        conversation_id: input.conversationId,
        turn_id: input.turnId,
        prior_error_code: 'AGENT_A_RECOVERY_EXHAUSTED',
      },
    }, db);
    return { outcome: 'reopened', replayed: false };
  }, { traceId: input.traceId });
}
