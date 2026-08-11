import { withSerializableTransaction } from '@/lib/db/transaction';
import { jsonbParam } from '@/lib/db/json';
import { getPostgresError, type DbClient } from '@/lib/db/types';
import { sha256Hex } from '@/lib/idempotency/canonical-json';
import { isExplicitOptOut } from '@/lib/heuristics/opt-out';
import { registerMessage, type Message } from './message.service';
import { auditLog } from '@/lib/audit/logger';
import {
  DecisionValidationError,
  parseDecisionV2,
  type DecisionV2,
} from '@/features/orchestration/domain/decision';

export interface CommitDecisionInput {
  turn_id: string;
  trace_id: string;
  decision: DecisionV2;
  model: {
    provider: 'botpress';
    model: string;
    prompt_version: string;
  };
}

export interface CommitDecisionResult {
  status: 'committed' | 'duplicate' | 'rejected';
  replayed: boolean;
  trace_id: string;
  turn_id: string;
  decision_id: string;
  next_state: DecisionV2['next_state'];
  outbound: {
    id: string;
    content: string;
    status: 'pending' | 'submitted_to_botpress' | 'failed';
  } | null;
}

export class DecisionConflictError extends Error {
  readonly code = 'DECISION_CONFLICT';
  constructor() {
    super('The turn already has a different decision');
    this.name = 'DecisionConflictError';
  }
}

export class DecisionPolicyError extends Error {
  readonly code = 'DECISION_REJECTED';
  constructor(public readonly reason: string) {
    super(reason);
    this.name = 'DecisionPolicyError';
  }
}

export class DecisionTurnNotFoundError extends Error {
  readonly code = 'TURN_NOT_FOUND';
  constructor() {
    super('Inbound turn not found');
    this.name = 'DecisionTurnNotFoundError';
  }
}

interface TurnPolicyRow extends Message {
  contact_status: 'prospecto' | 'cliente' | 'inactivo';
  lifecycle_status: 'active' | 'blocked' | 'deleted' | null;
  deleted_at: string | null;
  phone: string;
  consent_status: 'unknown' | 'granted' | 'revoked' | null;
  provider: string;
  integration_id: string;
  channel: 'whatsapp' | 'voice';
}

interface DecisionRow {
  id: string;
  turn_id: string;
  trace_id: string;
  decision_kind: CommitDecisionInput['decision']['kind'];
  response: string | null;
  next_state: DecisionV2['next_state'];
  payload_hash_hex: string;
  outbound_message_id: string | null;
  delivery_state: string | null;
}

const AGENT_DECISION_TURN_UNIQUE_CONSTRAINT = 'agent_decisions_turn_id_uq';

function mapDeliveryState(state: string | null): 'pending' | 'submitted_to_botpress' | 'failed' {
  if (state === 'submitted' || state === 'delivered') return 'submitted_to_botpress';
  if (state === 'failed_retryable' || state === 'dead_letter' || state === 'cancelled') return 'failed';
  return 'pending';
}

async function loadDecision(turnId: string, db: DbClient): Promise<DecisionRow | null> {
  const rows = await db<DecisionRow[]>`
    SELECT
      ad.id,
      ad.turn_id,
      ad.trace_id,
      ad.decision_kind,
      ad.response,
      ad.next_state,
      encode(ad.payload_hash, 'hex') AS payload_hash_hex,
      ad.outbound_message_id,
      od.state AS delivery_state
    FROM agent_decisions AS ad
    LEFT JOIN outbound_deliveries AS od ON od.message_id = ad.outbound_message_id
    WHERE ad.turn_id = ${turnId}::uuid
    LIMIT 1
  `;
  return rows[0] ?? null;
}

async function loadTurnPolicy(turnId: string, db: DbClient): Promise<TurnPolicyRow> {
  const rows = await db<TurnPolicyRow[]>`
    SELECT
      m.*,
      c.status AS contact_status,
      c.lifecycle_status,
      c.deleted_at,
      c.phone,
      ccp.consent_status,
      ct.provider,
      ct.integration_id,
      conv.channel
    FROM messages AS m
    JOIN conversations AS conv ON conv.id = m.conversation_id
    JOIN contacts AS c ON c.id = m.contact_id
    JOIN channel_events AS ce ON ce.id = m.source_event_id
    JOIN channel_threads AS ct ON ct.id = ce.channel_thread_id
    LEFT JOIN contact_channel_permissions AS ccp
      ON ccp.contact_id = c.id AND ccp.channel = conv.channel
    WHERE m.id = ${turnId}::uuid AND m.direction = 'inbound'
    FOR UPDATE OF m, c
  `;
  if (!rows[0]) throw new DecisionTurnNotFoundError();
  return rows[0];
}

function validatePolicy(decision: DecisionV2, turn: TurnPolicyRow): void {
  const blocked = turn.contact_status === 'inactivo'
    || turn.lifecycle_status === 'blocked'
    || turn.lifecycle_status === 'deleted'
    || turn.deleted_at !== null;
  const optOutAck = isExplicitOptOut(turn.content)
    && decision.intent === 'opt_out'
    && decision.response_type === 'opt_out_ack'
    && decision.response !== null;

  if (blocked && decision.kind !== 'suppress') {
    throw new DecisionPolicyError('CONTACT_BLOCKED');
  }
  if (turn.consent_status === 'revoked' && decision.kind !== 'suppress' && !optOutAck) {
    throw new DecisionPolicyError('CONSENT_REVOKED');
  }
  if (decision.response_type === 'opt_out_ack' && !isExplicitOptOut(turn.content)) {
    throw new DecisionPolicyError('OPT_OUT_ACK_WITHOUT_OPT_OUT');
  }
}

function decisionPayload(input: CommitDecisionInput) {
  return { turn_id: input.turn_id, decision: input.decision, model: input.model };
}

function duplicateDecisionResult(
  existing: DecisionRow,
  input: CommitDecisionInput,
  payloadHash: string
): CommitDecisionResult {
  if (existing.payload_hash_hex !== payloadHash) throw new DecisionConflictError();
  return {
    status: 'duplicate',
    replayed: true,
    trace_id: input.trace_id,
    turn_id: input.turn_id,
    decision_id: existing.id,
    next_state: existing.next_state,
    outbound: existing.outbound_message_id && existing.response ? {
      id: existing.outbound_message_id,
      content: existing.response,
      status: mapDeliveryState(existing.delivery_state),
    } : null,
  };
}

export async function commitAgentDecision(input: CommitDecisionInput): Promise<CommitDecisionResult> {
  let decision: DecisionV2;
  try {
    decision = parseDecisionV2(input.decision);
  } catch (error) {
    if (error instanceof DecisionValidationError) {
      throw new DecisionPolicyError(error.code);
    }
    throw error;
  }
  const validatedInput = { ...input, decision };
  const payloadHash = sha256Hex(decisionPayload(validatedInput));

  try {
    return await withSerializableTransaction(async (db) => {
      const existing = await loadDecision(validatedInput.turn_id, db);
      if (existing) return duplicateDecisionResult(existing, validatedInput, payloadHash);

    const turn = await loadTurnPolicy(validatedInput.turn_id, db);
    validatePolicy(decision, turn);
    const inserted = await db<Array<{ id: string }>>`
      INSERT INTO agent_decisions (
        turn_id,
        trace_id,
        schema_version,
        intent,
        decision_kind,
        response,
        response_type,
        business_action,
        memory_candidates,
        missing_information,
        next_state,
        reason_code,
        confidence,
        model_provider,
        model_name,
        prompt_version,
        payload_hash
      )
      VALUES (
        ${validatedInput.turn_id}::uuid,
        ${validatedInput.trace_id}::uuid,
        ${decision.schema_version},
        ${decision.intent},
        ${decision.kind},
        ${decision.response},
        ${decision.response_type},
        NULL,
        ${jsonbParam(db, decision.memory_candidates)},
        ${decision.missing_information}::text[],
        ${decision.next_state},
        ${decision.reason_code},
        ${decision.confidence},
        ${validatedInput.model.provider},
        ${validatedInput.model.model},
        ${validatedInput.model.prompt_version},
        decode(${payloadHash}, 'hex')
      )
      RETURNING id
    `;
    const decisionId = inserted[0].id;
    let outbound: CommitDecisionResult['outbound'] = null;

    if (decision.response) {
      let message: Message;
      try {
        ({ message } = await registerMessage({
          conversation_id: turn.conversation_id,
          direction: 'outbound',
          content: decision.response,
          in_reply_to: turn.id,
          metadata: {
            decision_id: decisionId,
            response_type: decision.response_type,
            model: validatedInput.model,
          },
        }, {
          db,
          // Fase 4: ver ingestion.service. El outbound tampoco se vectoriza por
          // defecto; la memoria histórica sale de selected_memories.
          embedding: 'skip',
          audit: {
            event_key: `decision:${decisionId}:message`,
            correlation_id: validatedInput.trace_id,
            causation_id: turn.id,
            source_event_id: turn.source_event_id ?? undefined,
          },
        }));
      } catch (error) {
        const pg = getPostgresError(error);
        if (pg?.code === '23505' && (pg.constraint_name ?? pg.constraint) === 'messages_in_reply_to_unique') {
          throw new DecisionConflictError();
        }
        throw error;
      }

      await db`
        UPDATE agent_decisions
        SET outbound_message_id = ${message.id}::uuid
        WHERE id = ${decisionId}::uuid
      `;

      const purpose = decision.response_type === 'opt_out_ack'
        ? 'consent_confirmation'
        : decision.response_type === 'commercial_reply' || decision.response_type === 'clarification'
          ? 'conversational'
          : 'support';
      const outboxPayload = {
        decision_id: decisionId,
        outbound_id: message.id,
        turn_id: turn.id,
        trace_id: validatedInput.trace_id,
        content: message.content,
        response_type: decision.response_type,
      };
      const queued = await db<Array<{ delivery_id: string; outbox_id: string }>>`
        SELECT delivery_id, outbox_id
        FROM enqueue_outbound_delivery(
          ${message.id}::uuid,
          ${turn.provider},
          ${turn.integration_id},
          ${turn.channel},
          ${purpose},
          ${turn.phone},
          ${`outbound:${decisionId}`},
          ${jsonbParam(db, outboxPayload)},
          ${3}
        )
      `;
      const queue = queued[0];

      // The Botpress workflow receiving this response owns the first short
      // lease. A replay sees the existing decision and never sends again.
      await db`
        UPDATE outbound_deliveries
        SET
          state = 'leased',
          leased_by = ${`botpress:${validatedInput.trace_id}`},
          lease_until = now() + interval '5 minutes',
          attempt_count = attempt_count + 1
        WHERE id = ${queue.delivery_id}::uuid AND state = 'pending'
      `;
      await db`
        UPDATE outbox_events
        SET
          state = 'leased',
          leased_by = ${`botpress:${validatedInput.trace_id}`},
          lease_until = now() + interval '5 minutes',
          attempt_count = attempt_count + 1
        WHERE id = ${queue.outbox_id}::uuid AND state = 'pending'
      `;

      await db`
        UPDATE contacts
        SET pending_turns = pending_turns + 1
        WHERE id = ${turn.contact_id}::uuid
      `;
      outbound = { id: message.id, content: message.content, status: 'pending' };
    }

    await auditLog({
      action: 'agent.decision.committed',
      entity_type: 'agent_decision',
      entity_id: decisionId,
      payload: {
        turn_id: validatedInput.turn_id,
        schema_version: decision.schema_version,
        intent: decision.intent,
        kind: decision.kind,
        response_type: decision.response_type,
        next_state: decision.next_state,
        outbound_id: outbound?.id ?? null,
      },
      event_key: `decision:${decisionId}:committed`,
      correlation_id: validatedInput.trace_id,
      causation_id: validatedInput.turn_id,
      source_event_id: turn.source_event_id,
    }, db);

      return {
        status: 'committed',
        replayed: false,
        trace_id: validatedInput.trace_id,
        turn_id: validatedInput.turn_id,
        decision_id: decisionId,
        next_state: decision.next_state,
        outbound,
      };
    });
  } catch (error) {
    const postgresError = getPostgresError(error);
    const constraint = postgresError?.constraint_name ?? postgresError?.constraint;
    if (postgresError?.code !== '23505' || constraint !== AGENT_DECISION_TURN_UNIQUE_CONSTRAINT) {
      throw error;
    }

    // The failed INSERT transaction is already aborted. Reload the winning row
    // in a fresh transaction before comparing the canonical payload hash.
    return withSerializableTransaction(async (db) => {
      const existing = await loadDecision(validatedInput.turn_id, db);
      if (!existing) throw error;
      return duplicateDecisionResult(existing, validatedInput, payloadHash);
    });
  }
}

export interface DeliveryReportInput {
  outbound_id: string;
  trace_id: string;
  status: 'submitted_to_botpress' | 'failed';
  botpress_message_id: string | null;
  replayed: boolean;
  error_code: string | null;
}

export interface DeliveryReportResult {
  status: 'recorded' | 'duplicate';
  replayed: boolean;
  outbound_id: string;
  delivery_status: 'submitted_to_botpress' | 'failed';
}

export class DeliveryReportConflictError extends Error {
  readonly code = 'DELIVERY_REPORT_CONFLICT';
  constructor(message = 'Delivery report conflicts with canonical delivery state') {
    super(message);
    this.name = 'DeliveryReportConflictError';
  }
}

export class OutboundNotFoundError extends Error {
  readonly code = 'OUTBOUND_NOT_FOUND';
  constructor() {
    super('Outbound delivery not found');
    this.name = 'OutboundNotFoundError';
  }
}

export async function recordDeliveryReport(input: DeliveryReportInput): Promise<DeliveryReportResult> {
  const semanticPayload = {
    outbound_id: input.outbound_id,
    status: input.status,
    botpress_message_id: input.botpress_message_id,
    error_code: input.error_code,
  };
  const payloadHash = sha256Hex(semanticPayload);
  const messageIdentity = input.botpress_message_id ?? 'none';
  const eventKey = `delivery:${input.outbound_id}:${messageIdentity}:${input.status}`;

  return withSerializableTransaction(async (db) => {
    const existingReports = await db<Array<{ payload_hash_hex: string }>>`
      SELECT encode(payload_hash, 'hex') AS payload_hash_hex
      FROM delivery_reports
      WHERE event_key = ${eventKey}
      LIMIT 1
    `;
    if (existingReports[0]) {
      if (existingReports[0].payload_hash_hex !== payloadHash) throw new DeliveryReportConflictError();
      return {
        status: 'duplicate',
        replayed: true,
        outbound_id: input.outbound_id,
        delivery_status: input.status,
      };
    }

    const deliveries = await db<Array<{
      id: string;
      state: string;
      provider_message_id: string | null;
      outbox_id: string;
      outbox_state: string;
    }>>`
      SELECT od.id, od.state, od.provider_message_id, oe.id AS outbox_id, oe.state AS outbox_state
      FROM outbound_deliveries AS od
      JOIN outbox_events AS oe ON oe.delivery_id = od.id
      WHERE od.message_id = ${input.outbound_id}::uuid
      FOR UPDATE OF od, oe
    `;
    const delivery = deliveries[0];
    if (!delivery) throw new OutboundNotFoundError();
    if (['delivered', 'dead_letter', 'cancelled'].includes(delivery.state)) {
      throw new DeliveryReportConflictError(`Delivery is terminal: ${delivery.state}`);
    }

    await db`
      INSERT INTO delivery_reports (
        event_key,
        outbound_message_id,
        delivery_id,
        trace_id,
        report_status,
        botpress_message_id,
        error_code,
        payload_hash
      )
      VALUES (
        ${eventKey},
        ${input.outbound_id}::uuid,
        ${delivery.id}::uuid,
        ${input.trace_id}::uuid,
        ${input.status},
        ${input.botpress_message_id},
        ${input.error_code},
        decode(${payloadHash}, 'hex')
      )
    `;

    if (input.status === 'submitted_to_botpress') {
      if (!input.botpress_message_id || input.error_code) throw new DeliveryReportConflictError('Invalid submitted report');
      if (delivery.state === 'submitted') {
        if (delivery.provider_message_id !== input.botpress_message_id) throw new DeliveryReportConflictError();
      } else {
        if (delivery.state !== 'leased') {
          await db`
            UPDATE outbound_deliveries
            SET state = 'leased', leased_by = ${`botpress:${input.trace_id}`}, lease_until = now() + interval '5 minutes'
            WHERE id = ${delivery.id}::uuid
          `;
        }
        await db`
          UPDATE outbound_deliveries
          SET
            state = 'submitted',
            provider_message_id = ${input.botpress_message_id},
            submitted_at = now(),
            lease_until = NULL,
            leased_by = NULL
          WHERE id = ${delivery.id}::uuid
        `;
      }
      if (delivery.outbox_state !== 'published') {
        if (delivery.outbox_state !== 'leased') {
          await db`
            UPDATE outbox_events
            SET state = 'leased', leased_by = ${`botpress:${input.trace_id}`}, lease_until = now() + interval '5 minutes'
            WHERE id = ${delivery.outbox_id}::uuid
          `;
        }
        await db`
          UPDATE outbox_events
          SET state = 'published', published_at = now(), lease_until = NULL, leased_by = NULL
          WHERE id = ${delivery.outbox_id}::uuid
        `;
      }
    } else {
      if (!input.error_code) throw new DeliveryReportConflictError('Failed report requires error_code');
      if (delivery.state === 'submitted') throw new DeliveryReportConflictError('Submitted delivery cannot be downgraded');
      if (delivery.state !== 'leased') {
        await db`
          UPDATE outbound_deliveries
          SET state = 'leased', leased_by = ${`botpress:${input.trace_id}`}, lease_until = now() + interval '5 minutes'
          WHERE id = ${delivery.id}::uuid
        `;
      }
      await db`
        UPDATE outbound_deliveries
        SET
          state = 'failed_retryable',
          next_attempt_at = now() + interval '1 minute',
          last_error_code = ${input.error_code},
          lease_until = NULL,
          leased_by = NULL
        WHERE id = ${delivery.id}::uuid
      `;
      if (delivery.outbox_state !== 'leased') {
        await db`
          UPDATE outbox_events
          SET state = 'leased', leased_by = ${`botpress:${input.trace_id}`}, lease_until = now() + interval '5 minutes'
          WHERE id = ${delivery.outbox_id}::uuid
        `;
      }
      await db`
        UPDATE outbox_events
        SET
          state = 'failed_retryable',
          available_at = now() + interval '1 minute',
          last_error_code = ${input.error_code},
          lease_until = NULL,
          leased_by = NULL
        WHERE id = ${delivery.outbox_id}::uuid
      `;
    }

    await auditLog({
      action: 'outbound.delivery.reported',
      entity_type: 'message',
      entity_id: input.outbound_id,
      payload: semanticPayload,
      event_key: `audit:${eventKey}`,
      correlation_id: input.trace_id,
    }, db);

    return {
      status: 'recorded',
      replayed: false,
      outbound_id: input.outbound_id,
      delivery_status: input.status,
    };
  });
}
