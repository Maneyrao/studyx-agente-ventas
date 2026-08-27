import { createHash, randomUUID } from 'node:crypto';
import type { DbClient } from '@/lib/db/types';
import { jsonbParam } from '@/lib/db/json';
import { CallEventSchema } from '@/lib/contracts/call-event';
import { evaluateVoiceConsent } from '../domain/call-consent';
import { hashCallContext, parseCallContext } from '../domain/call-context';

/**
 * Reserves exactly one call from a validated Decision v4 with
 * `request_call_now`, inside the SAME transaction that persists the
 * decision. Identity, phone and consent are derived here — never taken from
 * the model — and nothing in this module performs a network call: the
 * provider is contacted only after the canonical commit, through the
 * existing dispatch endpoint keyed by `call_id`.
 *
 * Idempotency and exclusivity ride on the ledger's own constraints:
 * one session per source turn (`call_sessions_source_turn_uq`) and one
 * active call per contact (`call_sessions_one_active_per_contact_uq`).
 */

const E164 = /^\+[1-9]\d{6,14}$/;

const ACTIVE_CALL_STATUSES = [
  'requested',
  'dispatching',
  'provider_accepted',
  'dispatch_ambiguous',
  'in_progress',
] as const;

export class CallRequestRejectedError extends Error {
  constructor(readonly reason: string) {
    super(`Call request rejected: ${reason}`);
    this.name = 'CallRequestRejectedError';
  }
}

export interface ReserveCallInput {
  turn_id: string;
  trace_id: string;
  decision_id: string;
  contact_id: string;
  conversation_id: string;
  contact_name: string | null;
  phone: string | null;
  /**
   * Every inbound message of the batch being decided, oldest first (a single
   * message when the turn was not batched). Consent is derived over the whole
   * burst; the decisive message becomes consent_source_message_id.
   */
  consent_messages: ReadonlyArray<{ id: string; content: string }>;
  /** Backend-planned semantic authorization; references one current-batch message. */
  authorized_conversation_move?: {
    mode: 'direct_request' | 'accepted_offer';
    source_message_id: string;
  };
  course_of_interest: string | null;
  prompt_version: string;
  now?: () => Date;
}

export interface ReservedCallRequest {
  call_id: string;
  status: 'requested';
}

function resolveVoiceProvider(): 'telegram_sandbox' | 'retell' {
  const configured = process.env.VOICE_PROVIDER ?? 'telegram_sandbox';
  if (configured !== 'telegram_sandbox' && configured !== 'retell') {
    throw new CallRequestRejectedError('VOICE_PROVIDER_INVALID');
  }
  return configured;
}

export async function reserveCallForDecision(
  db: DbClient,
  input: ReserveCallInput,
): Promise<ReservedCallRequest> {
  if (input.phone === null || !E164.test(input.phone)) {
    throw new CallRequestRejectedError('CALL_PHONE_INVALID');
  }

  const nowIso = (input.now?.() ?? new Date()).toISOString();

  const offers = await db<Array<{ decision_id: string; offered_at: Date }>>`
    SELECT ad.id AS decision_id, ad.created_at AS offered_at
    FROM agent_decisions AS ad
    JOIN messages AS m ON m.id = ad.turn_id
    WHERE m.contact_id = ${input.contact_id}::uuid
      AND m.conversation_id = ${input.conversation_id}::uuid
      AND ad.response_type = 'call_offer'
    ORDER BY ad.created_at DESC
    LIMIT 1
  `;
  const openOffer = offers[0]
    ? { decisionId: offers[0].decision_id, offeredAt: offers[0].offered_at.toISOString() }
    : null;

  if (input.consent_messages.length === 0) {
    throw new CallRequestRejectedError('CALL_CONFIRMATION_REQUIRED');
  }
  const authorizedIndex = input.authorized_conversation_move
    ? input.consent_messages.findIndex(
        (message) => message.id === input.authorized_conversation_move!.source_message_id,
      )
    : -1;
  if (input.authorized_conversation_move && authorizedIndex < 0) {
    throw new CallRequestRejectedError('CALL_CONFIRMATION_REQUIRED');
  }
  if (input.authorized_conversation_move?.mode === 'accepted_offer' && !openOffer) {
    throw new CallRequestRejectedError('CALL_CONFIRMATION_REQUIRED');
  }
  const verdict = input.authorized_conversation_move
    ? {
        allowed: true as const,
        mode: input.authorized_conversation_move.mode,
        offeredByDecisionId: input.authorized_conversation_move.mode === 'accepted_offer'
          ? openOffer?.decisionId ?? null
          : null,
        sourceIndex: authorizedIndex,
      }
    : evaluateVoiceConsent({
        texts: input.consent_messages.map((message) => message.content),
        now: nowIso,
        openOffer,
      });
  if (!verdict.allowed) {
    throw new CallRequestRejectedError(verdict.code);
  }
  const consentSourceMessageId = input.consent_messages[verdict.sourceIndex].id;

  const active = await db<Array<{ id: string }>>`
    SELECT id FROM call_sessions
    WHERE contact_id = ${input.contact_id}::uuid
      AND status = ANY(${ACTIVE_CALL_STATUSES as unknown as string[]}::text[])
    LIMIT 1
  `;
  if (active[0]) {
    throw new CallRequestRejectedError('ACTIVE_CALL_IN_PROGRESS');
  }

  const provider = resolveVoiceProvider();
  const callId = randomUUID();
  const context = parseCallContext({
    call_id: callId,
    nombre_lead: input.contact_name ?? '',
    curso_interes: input.course_of_interest ?? '',
    pais: '',
    email_lead: '',
    resumen_whatsapp: '',
    prompt_version: input.prompt_version,
  });
  const contextHashHex = hashCallContext(context);

  await db`
    INSERT INTO call_sessions (
      id,
      source_turn_id,
      decision_id,
      offered_by_decision_id,
      contact_id,
      conversation_id,
      provider,
      request_idempotency_key,
      status,
      consent_source_message_id,
      context_snapshot,
      context_hash,
      prompt_version,
      requested_at
    ) VALUES (
      ${callId}::uuid,
      ${input.turn_id}::uuid,
      ${input.decision_id}::uuid,
      ${verdict.offeredByDecisionId}::uuid,
      ${input.contact_id}::uuid,
      ${input.conversation_id}::uuid,
      ${provider},
      ${`voice-call:turn:${input.turn_id}`},
      'requested',
      ${consentSourceMessageId}::uuid,
      ${jsonbParam(db, context)},
      decode(${contextHashHex}, 'hex'),
      ${input.prompt_version},
      ${nowIso}::timestamptz
    )
  `;

  // Origen del ledger: el evento `requested` canónico queda en la misma
  // transacción que la sesión, así la proyección nunca ve una sesión sin
  // su primer hecho.
  const requestedEvent = CallEventSchema.parse({
    schema_version: 1,
    event_id: `studyx:requested:${callId}`,
    call_id: callId,
    event_type: 'requested',
    sequence: 0,
    occurred_at: nowIso,
    provider,
    payload: {
      event_type: 'requested',
      contact_id: input.contact_id,
      conversation_id: input.conversation_id,
      reason: verdict.mode,
      course_of_interest: input.course_of_interest,
      previous_summary: null,
    },
  });
  const payloadHashHex = createHash('sha256')
    .update(JSON.stringify(requestedEvent), 'utf8')
    .digest('hex');

  await db`
    INSERT INTO call_events (
      call_id, provider, event_id, event_type, sequence, occurred_at, payload, payload_hash
    ) VALUES (
      ${callId}::uuid,
      ${provider},
      ${requestedEvent.event_id},
      'requested',
      0,
      ${nowIso}::timestamptz,
      ${jsonbParam(db, requestedEvent.payload)},
      decode(${payloadHashHex}, 'hex')
    )
  `;

  return { call_id: callId, status: 'requested' };
}

/**
 * Replay lookup: a duplicate decision commit must return the same call_id it
 * reserved the first time. One session per source turn makes this total.
 */
export async function findCallRequestByTurn(
  db: DbClient,
  turnId: string,
): Promise<ReservedCallRequest | null> {
  const rows = await db<Array<{ id: string }>>`
    SELECT id FROM call_sessions WHERE source_turn_id = ${turnId}::uuid LIMIT 1
  `;
  return rows[0] ? { call_id: rows[0].id, status: 'requested' } : null;
}
