import { sql } from '@/lib/db/orchestrator';
import type { DbClient } from '@/lib/db/types';
import type {
  BatchClaim,
  BatchCompletion,
  BatchMembership,
  BatchMessage,
  ClaimBatchInput,
  ClaimedBatchContext,
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

function jsonIso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
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

  async loadClaimedBatchContext(input: {
    batch_id: string;
    recent_turns_limit: number;
  }): Promise<ClaimedBatchContext | null> {
    const limit = Math.min(Math.max(input.recent_turns_limit, 1), 20);
    type JsonBatchMessage = {
      id: string;
      conversation_seq: string | number;
      content: string;
      created_at: Date | string;
      message_type: string | null;
    };
    type JsonRecentTurn = {
      direction: 'inbound' | 'outbound';
      content: string;
      created_at: Date | string;
    };
    type SnapshotRow = {
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
      representative_turn_id: string;
      unsupported_message: boolean;
      decision_id: string | null;
      outbound_id: string | null;
      delivery_state: string | null;
      next_state: 'completed' | 'waiting_user' | null;
      batch_messages: JsonBatchMessage[];
      recent_turns: JsonRecentTurn[];
      open_offer: { decision_id: string; offered_at: Date | string } | null;
      active_call: { call_id: string; status: string } | null;
      last_call_result: {
        call_id: string;
        result: string | null;
        ended_at: Date | string;
      } | null;
      last_decline_at: Date | string | null;
    };

    const rows = await this.db<SnapshotRow[]>`
      SELECT
        c.id AS contact_id,
        c.status AS contact_status,
        c.name,
        c.lifecycle_status,
        c.deleted_at,
        ccp.consent_status,
        c.opted_in_at,
        c.pending_turns,
        c.summary,
        c.summary_version,
        c.summary_updated_at,
        b.representative_turn_id,
        NOT EXISTS (
          SELECT 1
          FROM messages AS readable
          WHERE readable.batch_id = b.id
            AND COALESCE(readable.metadata ->> 'message_type', 'text') <> 'unsupported'
        ) AS unsupported_message,
        ad.id AS decision_id,
        ad.outbound_message_id AS outbound_id,
        od.state AS delivery_state,
        ad.next_state,
        COALESCE((
          SELECT jsonb_agg(
            jsonb_build_object(
              'id', bm.id,
              'conversation_seq', bm.conversation_seq,
              'content', bm.content,
              'created_at', bm.created_at,
              'message_type', COALESCE(bm.metadata ->> 'message_type', 'text')
            ) ORDER BY bm.conversation_seq
          )
          FROM messages AS bm
          WHERE bm.batch_id = b.id
            AND bm.conversation_id = b.conversation_id
            AND bm.contact_id = b.contact_id
        ), '[]'::jsonb) AS batch_messages,
        COALESCE((
          SELECT jsonb_agg(
            jsonb_build_object(
              'direction', recent.direction,
              'content', recent.content,
              'created_at', recent.created_at
            ) ORDER BY recent.created_at, recent.id
          )
          FROM (
            SELECT rm.id, rm.direction, rm.content, rm.created_at
            FROM messages AS rm
            WHERE rm.conversation_id = b.conversation_id
              AND rm.contact_id = b.contact_id
              AND rm.batch_id IS DISTINCT FROM b.id
            ORDER BY rm.created_at DESC, rm.id DESC
            LIMIT ${limit}
          ) AS recent
        ), '[]'::jsonb) AS recent_turns,
        (
          SELECT jsonb_build_object(
            'decision_id', offer.id,
            'offered_at', offer.created_at
          )
          FROM agent_decisions AS offer
          JOIN messages AS offer_message ON offer_message.id = offer.turn_id
          WHERE offer_message.contact_id = b.contact_id
            AND offer_message.conversation_id = b.conversation_id
            AND offer.response_type = 'call_offer'
          ORDER BY offer.created_at DESC
          LIMIT 1
        ) AS open_offer,
        (
          SELECT jsonb_build_object('call_id', active.id, 'status', active.status)
          FROM call_sessions AS active
          WHERE active.contact_id = b.contact_id
            AND active.conversation_id = b.conversation_id
            AND active.status IN (
              'requested', 'dispatching', 'provider_accepted',
              'dispatch_ambiguous', 'in_progress'
            )
          ORDER BY active.created_at DESC
          LIMIT 1
        ) AS active_call,
        (
          SELECT jsonb_build_object(
            'call_id', terminal.id,
            'result', terminal.result,
            'ended_at', COALESCE(terminal.completed_at, terminal.updated_at)
          )
          FROM call_sessions AS terminal
          WHERE terminal.contact_id = b.contact_id
            AND terminal.conversation_id = b.conversation_id
            AND terminal.status IN (
              'completed', 'failed', 'no_answer', 'timed_out', 'cancelled'
            )
          ORDER BY COALESCE(terminal.completed_at, terminal.updated_at) DESC
          LIMIT 1
        ) AS last_call_result,
        (
          SELECT decline.created_at
          FROM agent_decisions AS decline
          JOIN messages AS decline_message ON decline_message.id = decline.turn_id
          WHERE decline_message.contact_id = b.contact_id
            AND decline_message.conversation_id = b.conversation_id
            AND decline.intent = 'commercial_decline'
          ORDER BY decline.created_at DESC
          LIMIT 1
        ) AS last_decline_at
      FROM inbound_batches AS b
      JOIN conversations AS conv
        ON conv.id = b.conversation_id AND conv.contact_id = b.contact_id
      JOIN contacts AS c ON c.id = b.contact_id
      LEFT JOIN contact_channel_permissions AS ccp
        ON ccp.contact_id = c.id AND ccp.channel = conv.channel
      LEFT JOIN agent_decisions AS ad ON ad.turn_id = b.representative_turn_id
      LEFT JOIN outbound_deliveries AS od ON od.message_id = ad.outbound_message_id
      WHERE b.id = ${input.batch_id}::uuid
      LIMIT 1
    `;

    const row = rows[0];
    if (!row) return null;
    return {
      facts: {
        contact: {
          id: row.contact_id,
          status: row.contact_status,
          name: row.name,
          lifecycle_status: row.lifecycle_status,
          deleted_at: jsonIso(row.deleted_at),
          consent_status: row.consent_status ?? 'unknown',
          opted_in_at: jsonIso(row.opted_in_at)!,
          pending_turns: Number(row.pending_turns),
        },
        summary: {
          text: row.summary,
          version: Number(row.summary_version),
          updated_at: jsonIso(row.summary_updated_at),
        },
        recent_turns: (row.recent_turns ?? []).map((turn) => ({
          direction: turn.direction,
          content: turn.content,
          created_at: jsonIso(turn.created_at)!,
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
      },
      batch_messages: (row.batch_messages ?? []).map((message) => ({
        id: message.id,
        conversation_seq: Number(message.conversation_seq),
        content: message.content,
        created_at: jsonIso(message.created_at)!,
        message_type: message.message_type ?? 'text',
      })),
      call_facts: {
        open_offer: row.open_offer
          ? {
              decision_id: row.open_offer.decision_id,
              offered_at: jsonIso(row.open_offer.offered_at)!,
            }
          : null,
        active_call: row.active_call,
        last_call_result: row.last_call_result
          ? {
              call_id: row.last_call_result.call_id,
              result: row.last_call_result.result,
              ended_at: jsonIso(row.last_call_result.ended_at)!,
            }
          : null,
        last_decline_at: jsonIso(row.last_decline_at),
      },
    };
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
          AND batch_id IS DISTINCT FROM ${input.batch_id}::uuid
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
   * All three facts are projected from canonical rows: `open_offer` from the
   * latest immutable `call_offer` decision (Decision v4), and the call facts
   * from `call_sessions` — active statuses feed `active_call` (the partial
   * unique index guarantees at most one), and the most recent terminal row
   * feeds `last_call_result` from its structured `result` column, never from
   * a free-form transcript.
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

    const activeRows = await this.db<Array<{ id: string; status: string }>>`
      SELECT id, status
      FROM call_sessions
      WHERE contact_id = ${input.contact_id}::uuid
        AND conversation_id = ${input.conversation_id}::uuid
        AND status IN ('requested', 'dispatching', 'provider_accepted', 'dispatch_ambiguous', 'in_progress')
      ORDER BY created_at DESC
      LIMIT 1
    `;

    const terminalRows = await this.db<Array<{ id: string; result: string | null; ended_at: Date }>>`
      SELECT id, result, COALESCE(completed_at, updated_at) AS ended_at
      FROM call_sessions
      WHERE contact_id = ${input.contact_id}::uuid
        AND conversation_id = ${input.conversation_id}::uuid
        AND status IN ('completed', 'failed', 'no_answer', 'timed_out', 'cancelled')
      ORDER BY COALESCE(completed_at, updated_at) DESC
      LIMIT 1
    `;

    // Declines are ordinary immutable decisions; `intent = 'commercial_decline'`
    // is their durable marker. The newest one drives the cross-turn cooldown.
    const declineRows = await this.db<Array<{ declined_at: Date }>>`
      SELECT ad.created_at AS declined_at
      FROM agent_decisions AS ad
      JOIN messages AS m ON m.id = ad.turn_id
      WHERE m.contact_id = ${input.contact_id}::uuid
        AND m.conversation_id = ${input.conversation_id}::uuid
        AND ad.intent = 'commercial_decline'
      ORDER BY ad.created_at DESC
      LIMIT 1
    `;

    const offer = offerRows[0];
    const active = activeRows[0];
    const terminal = terminalRows[0];

    return {
      open_offer: offer ? { decision_id: offer.decision_id, offered_at: offer.offered_at.toISOString() } : null,
      active_call: active ? { call_id: active.id, status: active.status } : null,
      last_call_result: terminal
        ? { call_id: terminal.id, result: terminal.result, ended_at: terminal.ended_at.toISOString() }
        : null,
      last_decline_at: declineRows[0] ? declineRows[0].declined_at.toISOString() : null,
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
