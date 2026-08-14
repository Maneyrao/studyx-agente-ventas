import { resolveContact, Contact } from './contact.service';
import { getOrCreateOpenConversation } from './conversation.service';
import { registerMessage, getMessageById, Message } from './message.service';
import { randomUUID } from 'node:crypto';
import {
  commitAgentDecision,
  DecisionConflictError,
  DecisionTurnNotFoundError,
} from './decision.service';
import { logger } from '@/lib/observability/structured-log';
import { counter } from '@/lib/observability/counters';
import { sql } from '@/lib/db/orchestrator';
import { withSerializableTransaction } from '@/lib/db/transaction';
import { jsonbParam } from '@/lib/db/json';
import { sha256Hex } from '@/lib/idempotency/canonical-json';
import { isExplicitOptOut } from '@/lib/heuristics/opt-out';
import type { DbClient } from '@/lib/db/types';
import type { DecisionResponseType } from '@/features/orchestration/domain/decision';
import { evaluateTurnPolicy, type TurnPolicyReason } from '@/features/orchestration/domain/turn-policy';
import { PostgresOrchestrationStore } from '@/features/orchestration/adapters/postgres-orchestration-store';
import type { BatchMembership } from '@/features/orchestration/ports/orchestration-store';
import { DEFAULT_BATCH_WINDOW_POLICY } from '@/features/orchestration/domain/batch-window';

export class TurnNotFoundError extends Error {
  readonly code = 'TURN_NOT_FOUND';
  constructor(turn_id: string) {
    super(`Turn not found or not inbound: ${turn_id}`);
    this.name = 'TurnNotFoundError';
  }
}

export class TurnAlreadyAnsweredError extends Error {
  readonly code = 'TURN_ALREADY_ANSWERED';
  constructor(turn_id: string) {
    super(`Turn already has a reply: ${turn_id}`);
    this.name = 'TurnAlreadyAnsweredError';
  }
}

export interface AgentReplyResult {
  message: Message;
  summary_regenerated: boolean;
  pending_turns: number;
}

export interface ContactContext {
  id: string;
  status: 'prospecto' | 'cliente' | 'inactivo';
  name: string | null;
  blocked: boolean;
  consent_status: 'allowed' | 'revoked' | 'unknown';
  opted_in_at: string;
  summary: string | null;
  summary_updated_at: string | null;
  summary_version: number;
}

export interface IngestContext {
  status: 'accepted' | 'duplicate' | 'suppressed';
  replayed: boolean;
  trace_id: string;
  turn_id: string;
  conversation_id: string;
  /**
   * The durable window this inbound joined. The caller sleeps until `due_at`
   * and then claims; it never decides on its own that a turn is ready.
   */
  batch: {
    id: string;
    state: 'waiting' | 'claimed' | 'completed' | 'abandoned';
    joined_existing: boolean;
    due_at: string;
    hard_deadline_at: string;
    conversation_seq: number;
    message_count: number;
  };
  policy: {
    may_respond: boolean;
    allowed_response_types: DecisionResponseType[];
    reason: TurnPolicyReason | null;
  };
  contact: ContactContext;
  existing_result: {
    decision_id: string | null;
    outbound_id: string | null;
    delivery_status: string | null;
    next_state: 'completed' | 'waiting_user';
  } | null;
}

export interface InboundEnvelope {
  schema_version: 1;
  source: 'botpress';
  channel: 'emulator' | 'whatsapp';
  integration_id: string;
  external_message_id: string;
  provider_message_id?: string;
  external_conversation_id: string;
  external_user_id: string;
  phone_e164: string;
  trace_id: string;
  message: {
    type: 'text' | 'audio' | 'image' | 'unsupported';
    text: string;
    occurred_at: string;
    reply_to_external_message_id: string | null;
    audio_reference?: {
      provider_file_id: string;
      mime_type: string;
      duration_seconds: number | null;
      transcription_status: 'ok' | 'failed' | 'skipped';
      transcription_provider: string | null;
    } | null;
    metadata?: Record<string, string | number | boolean>;
  };
  /**
   * Sandbox origin marker. When set, the backend uses this as the `provider`
   * for idempotency keys (channel_events / channel_threads UNIQUE) and the
   * anti-real-effects lock (see `sandbox.service.ts`) so a sandbox contact
   * cannot trigger Retell, Stripe, or production WhatsApp / Sheets.
   */
  sandbox_provider?: 'telegram_sandbox' | null;
}

export class IdempotencyConflictError extends Error {
  readonly code = 'IDEMPOTENCY_KEY_REUSED';
  constructor() {
    super('The external message identity is already bound to another payload');
    this.name = 'IdempotencyConflictError';
  }
}

export class ChannelIdentityConflictError extends Error {
  readonly code = 'CHANNEL_IDENTITY_CONFLICT';
  constructor() {
    super('The provider conversation is already bound to another contact');
    this.name = 'ChannelIdentityConflictError';
  }
}

export class InboundEventUnavailableError extends Error {
  readonly code = 'INBOUND_EVENT_UNAVAILABLE';
  constructor(public readonly retryable: boolean) {
    super(retryable ? 'The inbound event is already being processed' : 'The inbound event is terminal');
    this.name = 'InboundEventUnavailableError';
  }
}

interface InboundCore {
  inbound: Message;
  contact: Contact;
  conversation_id: string;
  replayed: boolean;
  explicit_opt_out: boolean;
  consent_status: 'unknown' | 'granted' | 'revoked';
  batch: BatchMembership;
}

async function findExistingInbound(eventId: string, db: DbClient): Promise<InboundCore | null> {
  const rows = await db<Array<Message & Contact & {
    message_id: string;
    conversation_id: string;
    consent_status: 'unknown' | 'granted' | 'revoked' | null;
    batch_id: string;
    batch_state: BatchMembership['state'];
    batch_due_at: Date;
    batch_hard_deadline_at: Date;
    batch_message_count: number;
    conversation_seq: string | number;
  }>>`
    SELECT
      m.id AS message_id,
      m.conversation_id,
      m.contact_id,
      m.direction,
      m.content,
      m.in_reply_to,
      m.metadata,
      m.created_at,
      m.source_event_id,
      m.conversation_seq,
      c.*,
      ccp.consent_status,
      b.id               AS batch_id,
      b.state            AS batch_state,
      b.due_at           AS batch_due_at,
      b.hard_deadline_at AS batch_hard_deadline_at,
      b.message_count    AS batch_message_count
    FROM messages AS m
    JOIN contacts AS c ON c.id = m.contact_id
    JOIN inbound_batches AS b ON b.id = m.batch_id
    LEFT JOIN contact_channel_permissions AS ccp
      ON ccp.contact_id = c.id AND ccp.channel = 'whatsapp'
    WHERE m.source_event_id = ${eventId}::uuid
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    inbound: { ...row, id: row.message_id },
    contact: row,
    conversation_id: row.conversation_id,
    replayed: true,
    explicit_opt_out: row.consent_status === 'revoked',
    consent_status: row.consent_status ?? 'unknown',
    // A replay must return the window the original message already belongs to,
    // never open a second one.
    batch: {
      batch_id: row.batch_id,
      joined: true,
      state: row.batch_state,
      due_at: row.batch_due_at.toISOString(),
      hard_deadline_at: row.batch_hard_deadline_at.toISOString(),
      conversation_seq: Number(row.conversation_seq),
      message_count: Number(row.batch_message_count),
    },
  };
}

async function persistInbound(envelope: InboundEnvelope): Promise<InboundCore> {
  const channel = 'whatsapp' as const;
  // sandbox_provider (e.g. 'telegram_sandbox') wins over the default derivation so
  // the sandbox lives on its own row in channel_events / channel_threads (their
  // UNIQUE constraints include `provider`) and never collides with production.
  const provider =
    envelope.sandbox_provider ??
    (envelope.channel === 'emulator' ? 'botpress_emulator' : envelope.source);
  const canonicalPayload = {
    schema_version: envelope.schema_version,
    source: envelope.source,
    channel,
    integration_id: envelope.integration_id,
    external_message_id: envelope.external_message_id,
    provider_message_id: envelope.provider_message_id ?? null,
    external_conversation_id: envelope.external_conversation_id,
    external_user_id: envelope.external_user_id,
    phone_e164: envelope.phone_e164,
    message: envelope.message,
  };
  const payloadHash = sha256Hex(canonicalPayload);

  return withSerializableTransaction(async (db) => {
    // Per-phase wall-clock inside the transaction. One log line per attempt,
    // no message content: this is how we know WHERE an ingest spent its time
    // (observed range in prod: 0.8s–2.9s for the same work).
    const txnStartedAt = Date.now();
    let phaseMark = txnStartedAt;
    const phases: Record<string, number> = {};
    const mark = (name: string): void => {
      phases[name] = Date.now() - phaseMark;
      phaseMark = Date.now();
    };

    const reservations = await db<Array<{
      event_id: string;
      was_created: boolean;
      payload_matches: boolean;
      event_status: string;
    }>>`
      SELECT * FROM reserve_inbound_channel_event(
        ${provider},
        ${envelope.integration_id},
        ${channel},
        ${envelope.external_message_id},
        ${envelope.external_message_id},
        ${envelope.external_conversation_id},
        decode(${payloadHash}, 'hex'),
        ${jsonbParam(db, canonicalPayload)}
      )
    `;
    const reservation = reservations[0];
    if (!reservation?.payload_matches) throw new IdempotencyConflictError();

    const events = await db<Array<{ status: string }>>`
      SELECT status FROM channel_events WHERE id = ${reservation.event_id}::uuid FOR UPDATE
    `;
    const existing = await findExistingInbound(reservation.event_id, db);
    if (existing) return existing;
    if (events[0]?.status === 'processing') throw new InboundEventUnavailableError(true);
    if (events[0]?.status === 'processed' || events[0]?.status === 'dead_letter') {
      throw new InboundEventUnavailableError(false);
    }
    mark('reserve');

    const { contact } = await resolveContact({
      phone: envelope.phone_e164,
      channel,
      db,
      audit: {
        event_key: `channel-event:${reservation.event_id}:contact`,
        correlation_id: envelope.trace_id,
        source_event_id: reservation.event_id,
      },
    });
    await db`SELECT id FROM contacts WHERE id = ${contact.id}::uuid FOR UPDATE`;
    mark('contact');

    const threads = await db<Array<{ id: string; contact_id: string }>>`
      INSERT INTO channel_threads (
        contact_id, provider, integration_id, channel, external_conversation_id, metadata
      )
      VALUES (
        ${contact.id}::uuid,
        ${provider},
        ${envelope.integration_id},
        ${channel},
        ${envelope.external_conversation_id},
        ${jsonbParam(db, { external_user_id: envelope.external_user_id })}
      )
      ON CONFLICT (provider, integration_id, external_conversation_id)
      DO UPDATE SET last_seen_at = now()
      WHERE channel_threads.contact_id = EXCLUDED.contact_id
        AND channel_threads.channel = EXCLUDED.channel
      RETURNING id, contact_id
    `;
    const thread = threads[0];
    if (!thread) throw new ChannelIdentityConflictError();

    await db`
      UPDATE channel_events
      SET
        contact_id = ${contact.id}::uuid,
        channel_thread_id = ${thread.id}::uuid,
        status = 'processing',
        attempt_count = attempt_count + 1,
        lease_until = now() + interval '60 seconds',
        leased_by = ${`next:${envelope.trace_id}`}
      WHERE id = ${reservation.event_id}::uuid
    `;
    mark('thread_event');

    const openRows = await db<Array<{ id: string; channel_thread_id: string | null }>>`
      SELECT id, channel_thread_id
      FROM conversations
      WHERE contact_id = ${contact.id}::uuid AND channel = ${channel} AND status = 'open'
      FOR UPDATE
    `;
    let conversationId: string;
    if (openRows[0]?.channel_thread_id === null) {
      const adopted = await db<Array<{ id: string }>>`
        UPDATE conversations
        SET channel_thread_id = ${thread.id}::uuid
        WHERE id = ${openRows[0].id}::uuid
        RETURNING id
      `;
      conversationId = adopted[0].id;
    } else {
      if (openRows[0] && openRows[0].channel_thread_id !== thread.id) {
        await db`
          UPDATE conversations
          SET status = 'closed', last_turn_at = now()
          WHERE id = ${openRows[0].id}::uuid
        `;
      }
      const conversation = await getOrCreateOpenConversation(contact.id, channel, {
        db,
        channel_thread_id: thread.id,
      });
      conversationId = conversation.id;
    }
    mark('conversation');

    // Both branches surface the resulting consent themselves (RETURNING /
    // the function's current_status), so no separate final SELECT is needed.
    const explicitOptOut = isExplicitOptOut(envelope.message.text);
    let consentStatus: 'unknown' | 'granted' | 'revoked';
    if (explicitOptOut) {
      const consentRows = await db<Array<{ current_status: 'unknown' | 'granted' | 'revoked' | null }>>`
        SELECT * FROM record_contact_permission_event(
          ${`opt-out:${reservation.event_id}`},
          ${contact.id}::uuid,
          ${channel},
          ${'revoked'},
          ${'inbound_explicit_opt_out'},
          ${reservation.event_id}::uuid,
          ${jsonbParam(db, { text: envelope.message.text })},
          ${envelope.message.occurred_at}::timestamptz
        )
      `;
      consentStatus = consentRows[0]?.current_status ?? 'unknown';
    } else {
      const permissionRows = await db<Array<{ consent_status: 'unknown' | 'granted' | 'revoked' }>>`
        INSERT INTO contact_channel_permissions (
          contact_id, channel, consent_status, consent_source, reply_window_expires_at
        )
        VALUES (
          ${contact.id}::uuid,
          ${channel},
          'unknown',
          'inbound_message',
          ${envelope.message.occurred_at}::timestamptz + interval '24 hours'
        )
        ON CONFLICT (contact_id, channel) DO UPDATE
        SET reply_window_expires_at = GREATEST(
          contact_channel_permissions.reply_window_expires_at,
          EXCLUDED.reply_window_expires_at
        )
        RETURNING consent_status
      `;
      consentStatus = permissionRows[0]?.consent_status ?? 'unknown';
    }
    mark('permissions');

    const { message: inbound } = await registerMessage({
      conversation_id: conversationId,
      direction: 'inbound',
      content: envelope.message.text,
      source_event_id: reservation.event_id,
      metadata: {
        message_type: envelope.message.type,
        external_message_id: envelope.external_message_id,
        provider_message_id: envelope.provider_message_id ?? null,
        occurred_at: envelope.message.occurred_at,
        reply_to_external_message_id: envelope.message.reply_to_external_message_id,
      },
    }, {
      db,
      // Fase 4: la memoria es selectiva. Un mensaje canónico ya no se vectoriza
      // por el hecho de existir; sólo los memory candidates validados entran a
      // la cola de embeddings. Vectorizar todo contradecía la política y además
      // llenaba pgvector de ruido que después degradaba el recall.
      embedding: 'skip',
      audit: {
        event_key: `channel-event:${reservation.event_id}:message`,
        correlation_id: envelope.trace_id,
        source_event_id: reservation.event_id,
      },
    });

    mark('message');

    await db`
      UPDATE channel_events
      SET
        status = 'processed',
        processed_at = now(),
        lease_until = NULL,
        leased_by = NULL,
        last_error_code = NULL,
        last_error_detail = NULL
      WHERE id = ${reservation.event_id}::uuid
    `;

    // Batching commits with the inbound: the message is a durable member of a
    // window before Botpress is ever told to sleep, so a workflow crash during
    // the wait can never lose it.
    const batch = await new PostgresOrchestrationStore(db).openOrJoinBatch({
      conversation_id: conversationId,
      contact_id: contact.id,
      message_id: inbound.id,
      window_ms: DEFAULT_BATCH_WINDOW_POLICY.windowMs,
      hard_deadline_ms: DEFAULT_BATCH_WINDOW_POLICY.hardDeadlineMs,
    });

    mark('batch');
    logger.info({
      event: 'ingestion.phases',
      trace_id: envelope.trace_id,
      ...phases,
      txn_ms: Date.now() - txnStartedAt,
    });

    return {
      inbound,
      contact,
      conversation_id: conversationId,
      replayed: !reservation.was_created,
      explicit_opt_out: explicitOptOut,
      consent_status: consentStatus,
      batch,
    };
  });
}

export async function processInboundMessage(envelope: InboundEnvelope): Promise<IngestContext> {
  const { inbound, contact, conversation_id, replayed, explicit_opt_out, consent_status, batch } =
    await persistInbound(envelope);
  // Fase 3: la ingesta no construye contexto. Recuperación semántica, base de
  // conocimiento y regeneración de resumen son trabajo derivado y se hacen una
  // sola vez, en el claim, por el workflow que realmente es dueño del lote.
  // Hacerlo acá significaba pagar embeddings y una llamada al modelo por CADA
  // mensaje de una ráfaga, en el camino crítico del ACK del canal.
  counter.increment('ingest_processed');

  logger.info({
    event: 'ingestion.processed',
    contact_id: contact.id,
    conversation_id,
    turn_id: inbound.id,
    batch_id: batch.batch_id,
    batch_message_count: batch.message_count,
    trace_id: envelope.trace_id,
  });

  const policy = evaluateTurnPolicy({
    contact_status: contact.status,
    lifecycle_status: contact.lifecycle_status,
    deleted_at: contact.deleted_at,
    consent_status,
    explicit_opt_out,
    unsupported_message: envelope.message.type === 'unsupported',
  });

  const decisions = await sql<Array<{
    decision_id: string;
    outbound_id: string | null;
    state: string | null;
    next_state: 'completed' | 'waiting_user';
  }>>`
    SELECT ad.id AS decision_id, ad.outbound_message_id AS outbound_id, od.state, ad.next_state
    FROM agent_decisions AS ad
    LEFT JOIN outbound_deliveries AS od ON od.message_id = ad.outbound_message_id
    WHERE ad.turn_id = ${inbound.id}::uuid
    LIMIT 1
  `;
  const existingDecision = decisions[0];
  const deliveryStatus = existingDecision?.state === 'submitted' || existingDecision?.state === 'delivered'
    ? 'submitted_to_botpress'
    : existingDecision?.state === 'failed_retryable' || existingDecision?.state === 'dead_letter'
      ? 'failed'
      : existingDecision?.state ?? null;

  return {
    status: !policy.may_respond ? 'suppressed' : replayed ? 'duplicate' : 'accepted',
    replayed,
    trace_id: envelope.trace_id,
    turn_id: inbound.id,
    conversation_id,
    batch: {
      id: batch.batch_id,
      state: batch.state,
      joined_existing: batch.joined,
      due_at: batch.due_at,
      hard_deadline_at: batch.hard_deadline_at,
      conversation_seq: batch.conversation_seq,
      message_count: batch.message_count,
    },
    policy: {
      may_respond: policy.may_respond,
      allowed_response_types: policy.allowed_response_types,
      reason: policy.reason,
    },
    contact: {
      id: contact.id,
      status: contact.status,
      name: contact.name,
      // C1 / Edge case opt-out: señal explícita para que el agente NO continúe la
      // conversación comercial cuando el contacto está inactivo/bloqueado.
      blocked: policy.blocked,
      consent_status: consent_status === 'granted' ? 'allowed' : consent_status,
      opted_in_at: contact.opted_in_at,
      summary: contact.summary,
      summary_updated_at: contact.summary_updated_at,
      summary_version: contact.summary_version,
    },
    existing_result: existingDecision ? {
      decision_id: existingDecision.decision_id,
      outbound_id: existingDecision.outbound_id,
      delivery_status: deliveryStatus,
      next_state: existingDecision.next_state,
    } : null,
  };
}

export async function registerAgentReply(params: {
  turn_id: string;
  content: string;
  trace_id?: string;
}): Promise<AgentReplyResult> {
  const { turn_id, content, trace_id = randomUUID() } = params;
  try {
    const decision = await commitAgentDecision({
      turn_id,
      trace_id,
      decision: {
        schema_version: 2,
        intent: 'commercial',
        kind: 'reply',
        response: content,
        response_type: 'commercial_reply',
        business_action: null,
        memory_candidates: [],
        missing_information: [],
        next_state: 'completed',
        reason_code: 'LEGACY_REPLY_ADAPTER',
        confidence: 1,
      },
      model: {
        provider: 'botpress',
        model: 'legacy-reply-adapter',
        prompt_version: 'legacy-v2',
      },
    });
    if (!decision.outbound) throw new TurnAlreadyAnsweredError(turn_id);
    const outbound = await getMessageById(decision.outbound.id);
    const pending = await sql<Array<{ pending_turns: number }>>`
      SELECT pending_turns FROM contacts WHERE id = ${outbound.contact_id}::uuid
    `;
    counter.increment('replies_registered');
    return {
      message: outbound,
      summary_regenerated: false,
      pending_turns: pending[0]?.pending_turns ?? 0,
    };
  } catch (error) {
    if (error instanceof DecisionTurnNotFoundError) throw new TurnNotFoundError(turn_id);
    if (error instanceof DecisionConflictError) throw new TurnAlreadyAnsweredError(turn_id);
    throw error;
  }
}
