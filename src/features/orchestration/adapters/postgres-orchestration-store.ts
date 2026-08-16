import { sql } from '@/lib/db/orchestrator';
import type { DbClient } from '@/lib/db/types';
import type {
  BatchClaim,
  BatchCompletion,
  BatchMembership,
  BatchMessage,
  ClaimBatchInput,
  ClaimedCallFacts,
  ClaimedTurnFacts,
  CompleteBatchInput,
  OpenOrJoinBatchInput,
  OrchestrationStore,
  StaleClaim,
} from '../ports/orchestration-store';

/**
 * PostgreSQL adapter for the orchestration store.
 *
 * Every mutation is a single call into a SQL function from
 * `20260811020001_inbound_batches.sql`. Keeping the logic in the database is
 * what makes the claim safe: five concurrent claimers serialize on one row lock
 * and the losers re-evaluate the predicate against the winner's row, so exactly
 * one token is ever issued — no application lock, no Redis.
 *
 * `openOrJoinBatch` accepts the caller's transaction handle because it has to
 * commit atomically with the inbound it is attaching. The claim deliberately
 * does NOT: it runs on the pool at READ COMMITTED, where the row lock gives the
 * single-winner guarantee without inviting 40001 storms at 150 concurrent
 * conversations.
 */

interface MembershipRow {
  batch_id: string;
  joined: boolean;
  state: BatchMembership['state'];
  due_at: Date;
  hard_deadline_at: Date;
  conversation_seq: string | number;
  message_count: number;
}

interface ClaimRow {
  outcome: BatchClaim['outcome'];
  batch_id: string;
  claim_token: string | null;
  conversation_id: string | null;
  contact_id: string | null;
  due_at: Date | null;
  hard_deadline_at: Date | null;
  lease_until: Date | null;
  retry_after_ms: number;
  message_count: number;
  stolen: boolean;
}

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function requireIso(value: Date | null, field: string): string {
  const parsed = iso(value);
  if (!parsed) throw new Error(`Orchestration store returned a null ${field}`);
  return parsed;
}

export class PostgresOrchestrationStore implements OrchestrationStore {
  constructor(private readonly db: DbClient = sql) {}

  /** Bind the store to a transaction so batching commits with its inbound. */
  withTransaction(db: DbClient): PostgresOrchestrationStore {
    return new PostgresOrchestrationStore(db);
  }

  async openOrJoinBatch(input: OpenOrJoinBatchInput): Promise<BatchMembership> {
    const rows = await this.db<MembershipRow[]>`
      SELECT batch_id, joined, state, due_at, hard_deadline_at, conversation_seq, message_count
      FROM open_or_join_inbound_batch(
        ${input.conversation_id}::uuid,
        ${input.contact_id}::uuid,
        ${input.message_id}::uuid,
        ${input.window_ms ?? 2000},
        ${input.hard_deadline_ms ?? 4000}
      )
    `;
    const row = rows[0];
    if (!row) throw new Error('open_or_join_inbound_batch returned no row');

    return {
      batch_id: row.batch_id,
      joined: row.joined,
      state: row.state,
      due_at: requireIso(row.due_at, 'due_at'),
      hard_deadline_at: requireIso(row.hard_deadline_at, 'hard_deadline_at'),
      conversation_seq: Number(row.conversation_seq),
      message_count: Number(row.message_count),
    };
  }

  async claimBatch(input: ClaimBatchInput): Promise<BatchClaim> {
    const rows = await this.db<ClaimRow[]>`
      SELECT
        outcome, batch_id, claim_token, conversation_id, contact_id,
        due_at, hard_deadline_at, lease_until, retry_after_ms, message_count, stolen
      FROM claim_inbound_batch(
        ${input.batch_id}::uuid,
        ${input.claimed_by},
        ${input.lease_ms ?? 120000}
      )
    `;
    const row = rows[0];
    if (!row) throw new Error('claim_inbound_batch returned no row');

    return {
      outcome: row.outcome,
      batch_id: row.batch_id,
      claim_token: row.claim_token,
      conversation_id: row.conversation_id,
      contact_id: row.contact_id,
      due_at: iso(row.due_at),
      hard_deadline_at: iso(row.hard_deadline_at),
      lease_until: iso(row.lease_until),
      retry_after_ms: Number(row.retry_after_ms),
      message_count: Number(row.message_count),
      stolen: row.stolen,
    };
  }

  async completeBatch(input: CompleteBatchInput): Promise<BatchCompletion> {
    const rows = await this.db<Array<{
      outcome: BatchCompletion['outcome'];
      batch_id: string;
      state: BatchCompletion['state'];
    }>>`
      SELECT outcome, batch_id, state
      FROM complete_inbound_batch(
        ${input.batch_id}::uuid,
        ${input.claim_token}::uuid,
        ${input.last_error_code ?? null}
      )
    `;
    const row = rows[0];
    if (!row) throw new Error('complete_inbound_batch returned no row');
    return { outcome: row.outcome, batch_id: row.batch_id, state: row.state };
  }

  async listBatchMessages(batch_id: string): Promise<BatchMessage[]> {
    // The batch's own identity scopes the read; there is no way to widen it to
    // another contact or conversation from the caller side.
    const rows = await this.db<Array<{
      id: string;
      conversation_seq: string | number;
      content: string;
      created_at: Date;
      message_type: string | null;
    }>>`
      SELECT
        m.id,
        m.conversation_seq,
        m.content,
        m.created_at,
        COALESCE(m.metadata ->> 'message_type', 'text') AS message_type
      FROM messages AS m
      JOIN inbound_batches AS b
        ON b.id = m.batch_id
       AND b.conversation_id = m.conversation_id
       AND b.contact_id = m.contact_id
      WHERE m.batch_id = ${batch_id}::uuid
      ORDER BY m.conversation_seq ASC
    `;

    return rows.map((row) => ({
      id: row.id,
      conversation_seq: Number(row.conversation_seq),
      content: row.content,
      created_at: row.created_at.toISOString(),
      message_type: row.message_type ?? 'text',
    }));
  }

  async loadClaimedTurnFacts(input: {
    batch_id: string;
    recent_turns_limit: number;
  }): Promise<ClaimedTurnFacts | null> {
    const limit = Math.min(Math.max(input.recent_turns_limit, 1), 20);

    const rows = await this.db<Array<{
      contact_id: string;
      contact_status: 'prospecto' | 'cliente' | 'inactivo';
      name: string | null;
      lifecycle_status: 'active' | 'blocked' | 'deleted' | null;
      deleted_at: Date | null;
      consent_status: 'unknown' | 'granted' | 'revoked' | null;
      opted_in_at: Date;
      pending_turns: number;
      summary: string | null;
      summary_version: number;
      summary_updated_at: Date | null;
      conversation_id: string;
      representative_turn_id: string;
      unsupported_message: boolean;
      decision_id: string | null;
      outbound_id: string | null;
      delivery_state: string | null;
      next_state: 'completed' | 'waiting_user' | null;
    }>>`
      SELECT
        c.id            AS contact_id,
        c.status        AS contact_status,
        c.name,
        c.lifecycle_status,
        c.deleted_at,
        ccp.consent_status,
        c.opted_in_at,
        c.pending_turns,
        c.summary,
        c.summary_version,
        c.summary_updated_at,
        b.conversation_id,
        b.representative_turn_id,
        -- A batch counts as unreadable only when every member is unreadable;
        -- one usable message is enough to answer normally.
        NOT EXISTS (
          SELECT 1 FROM messages AS bm
          WHERE bm.batch_id = b.id
            AND COALESCE(bm.metadata ->> 'message_type', 'text') <> 'unsupported'
        )               AS unsupported_message,
        ad.id           AS decision_id,
        ad.outbound_message_id AS outbound_id,
        od.state        AS delivery_state,
        ad.next_state
      FROM inbound_batches AS b
      JOIN conversations AS conv
        ON conv.id = b.conversation_id AND conv.contact_id = b.contact_id
      JOIN contacts AS c ON c.id = b.contact_id
      LEFT JOIN contact_channel_permissions AS ccp
        ON ccp.contact_id = c.id AND ccp.channel = conv.channel
      LEFT JOIN agent_decisions AS ad ON ad.turn_id = b.representative_turn_id
      LEFT JOIN outbound_deliveries AS od ON od.message_id = ad.outbound_message_id
      WHERE b.id = ${input.batch_id}::uuid
    `;

    const row = rows[0];
    if (!row) return null;

    const recent = await this.db<Array<{
      direction: 'inbound' | 'outbound';
      content: string;
      created_at: Date;
    }>>`
      SELECT direction, content, created_at
      FROM (
        SELECT direction, content, created_at
        FROM messages
        WHERE conversation_id = ${row.conversation_id}::uuid
        ORDER BY created_at DESC, id DESC
        LIMIT ${limit}
      ) AS recent_window
      ORDER BY created_at ASC
    `;

    return {
      contact: {
        id: row.contact_id,
        status: row.contact_status,
        name: row.name,
        lifecycle_status: row.lifecycle_status,
        deleted_at: row.deleted_at ? row.deleted_at.toISOString() : null,
        consent_status: row.consent_status ?? 'unknown',
        opted_in_at: row.opted_in_at.toISOString(),
        pending_turns: Number(row.pending_turns),
      },
      summary: {
        text: row.summary,
        version: Number(row.summary_version),
        updated_at: row.summary_updated_at ? row.summary_updated_at.toISOString() : null,
      },
      recent_turns: recent.map((turn) => ({
        direction: turn.direction,
        content: turn.content,
        created_at: turn.created_at.toISOString(),
      })),
      representative_turn_id: row.representative_turn_id,
      unsupported_message: row.unsupported_message,
      existing_decision: row.decision_id
        ? {
            decision_id: row.decision_id,
            outbound_id: row.outbound_id,
            delivery_state: row.delivery_state,
            next_state: row.next_state ?? 'completed',
          }
        : null,
    };
  }

  /**
   * The current open call offer, active call and last call result, each
   * scoped to the claimed batch's own contact and conversation.
   *
   * Only `open_offer` is real today. `active_call` and `last_call_result`
   * are hardcoded null: `call_sessions` is owned by the sibling call-
   * infrastructure plan and does not exist on this branch (this worktree
   * owns only Agent A's conversational layer). These facts are wired when
   * the sibling plan's call ledger merges — the port's `ActiveCallFact` /
   * `LastCallResultFact` shapes are kept for that integration, but nothing
   * here queries `call_sessions` in the meantime.
   *
   * The `open_offer` query itself is read-only and safe to ship, but it is
   * currently unreachable in practice: `agent_decisions.response_type` has
   * no `'call_offer'` value in its CHECK constraint yet (that arrives with
   * Decision v4, tracked in the sibling `005-agent-a-b-communication` plan).
   * No producer in this codebase can write such a row today, so this query
   * returns null until that migration lands — see task-2 report for the
   * open NEEDS_CONTEXT finding.
   */
  async loadClaimedCallFacts(input: {
    contact_id: string;
    conversation_id: string;
  }): Promise<ClaimedCallFacts> {
    const offerRows = await this.db<Array<{ decision_id: string; offered_at: Date }>>`
      SELECT ad.id AS decision_id, ad.created_at AS offered_at
      FROM agent_decisions AS ad
      JOIN messages AS m ON m.id = ad.turn_id
      WHERE m.contact_id = ${input.contact_id}::uuid
        AND m.conversation_id = ${input.conversation_id}::uuid
        AND ad.response_type = 'call_offer'
      ORDER BY ad.created_at DESC
      LIMIT 1
    `;

    const offer = offerRows[0];

    return {
      open_offer: offer ? { decision_id: offer.decision_id, offered_at: offer.offered_at.toISOString() } : null,
      active_call: null,
      last_call_result: null,
    };
  }

  async expireStaleClaims(
    input: { max_claim_attempts?: number; limit?: number } = {}
  ): Promise<StaleClaim[]> {
    const rows = await this.db<Array<{
      batch_id: string;
      conversation_id: string;
      claim_attempt_count: number;
      action: StaleClaim['action'];
    }>>`
      SELECT batch_id, conversation_id, claim_attempt_count, action
      FROM expire_inbound_batch_claims(
        ${input.max_claim_attempts ?? 3},
        ${input.limit ?? 100}
      )
    `;
    return rows.map((row) => ({
      batch_id: row.batch_id,
      conversation_id: row.conversation_id,
      claim_attempt_count: Number(row.claim_attempt_count),
      action: row.action,
    }));
  }
}

/** Default store bound to the pooled connection. */
export const orchestrationStore = new PostgresOrchestrationStore();
