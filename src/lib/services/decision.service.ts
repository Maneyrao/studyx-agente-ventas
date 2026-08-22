import { withSerializableTransaction } from '@/lib/db/transaction';
import { sql } from '@/lib/db/orchestrator';
import { jsonbParam } from '@/lib/db/json';
import { logger } from '@/lib/observability/structured-log';
import { counter } from '@/lib/observability/counters';
import { selectMemories } from '@/features/orchestration/application/select-memories';
import { memoryStore } from '@/features/orchestration/adapters/postgres-memory-store';
import { getPostgresError, type DbClient } from '@/lib/db/types';
import { sha256Hex } from '@/lib/idempotency/canonical-json';
import { isExplicitOptOut } from '@/lib/heuristics/opt-out';
import { registerMessage, type Message } from './message.service';
import { enqueueLeadProjection } from './projection.service';
import { auditLog } from '@/lib/audit/logger';
import { loadBusinessWorkspaceConfig, loadSheetsProjectionConfig } from '@/lib/config';
import { PostgresBusinessContextStore } from '@/features/orchestration/adapters/postgres-business-context';
import { materializePaymentLinkAction } from '@/features/payments/application/materialize-payment-link-action';
import { createConfigPaymentLinkResolver } from '@/features/payments/adapters/config-payment-link.resolver';
import {
  DecisionValidationError,
  type DecisionV2,
} from '@/features/orchestration/domain/decision';
import {
  type DecisionV3,
} from '@/features/orchestration/domain/decision-v3';
import {
  assertDecisionBusinessActionPermitted,
  parseDecisionAnyVersion,
  type DecisionV4,
} from '@/features/orchestration/domain/decision-v4';
import {
  CallRequestRejectedError,
  findCallRequestByTurn,
  reserveCallForDecision,
  type ReservedCallRequest,
} from '@/features/calls/application/request-call';

/**
 * The wire accepts every frozen schema version. Each one is a strict superset
 * of the previous, so an older producer keeps working unchanged while
 * Botpress migrates — the whole point of making each migration additive
 * instead of a flag day. v4 adds the call protocol (call_offer,
 * call_confirmation, request_call_now).
 */
export type AnyDecision = DecisionV2 | DecisionV3 | DecisionV4;

function retrievalUsedOf(decision: AnyDecision) {
  return 'retrieval_used' in decision ? decision.retrieval_used : null;
}

export interface CommitDecisionInput {
  turn_id: string;
  trace_id: string;
  decision: AnyDecision;
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
    /**
     * The attempt the workflow is being handed. It has to come back on the
     * delivery report: that is what lets the backend tell "this attempt failed"
     * apart from "an attempt that is no longer running failed", and only the
     * first of those may ever lead to another send.
     */
    delivery_attempt: number;
  } | null;
  /**
   * Present exactly when this decision reserved a call. On replay it carries
   * the same call_id the first commit reserved — the workflow can dispatch
   * with it idempotently, and never learns the phone number.
   */
  call_request: ReservedCallRequest | null;
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
  contact_name: string | null;
  lifecycle_status: 'active' | 'blocked' | 'deleted' | null;
  deleted_at: string | null;
  phone: string;
  consent_status: 'unknown' | 'granted' | 'revoked' | null;
  provider: string;
  integration_id: string;
  channel: 'whatsapp' | 'voice';
  batch_id: string | null;
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
  delivery_attempt: number | null;
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
      od.state AS delivery_state,
      od.attempt_count AS delivery_attempt
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
      c.name AS contact_name,
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

function validatePolicy(decision: AnyDecision, turn: TurnPolicyRow): void {
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
  payloadHash: string,
  callRequest: ReservedCallRequest | null
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
      delivery_attempt: Number(existing.delivery_attempt ?? 1),
    } : null,
    call_request: callRequest,
  };
}

export async function commitAgentDecision(input: CommitDecisionInput): Promise<CommitDecisionResult> {
  let decision: AnyDecision;
  try {
    decision = parseDecisionAnyVersion(input.decision);
    // The backend keeps the final word: Botpress validates the same rule, but
    // an agent that skips or misreads it must still be unable to commit.
    assertDecisionBusinessActionPermitted(decision);
  } catch (error) {
    if (error instanceof DecisionValidationError) {
      throw new DecisionPolicyError(error.code);
    }
    throw error;
  }
  const validatedInput = { ...input, decision };
  const payloadHash = sha256Hex(decisionPayload(validatedInput));
  let turnContext: TurnPolicyRow | null = null;

  const commit = async (): Promise<CommitDecisionResult> => {
  try {
    return await withSerializableTransaction(async (db) => {
      const existing = await loadDecision(validatedInput.turn_id, db);
      if (existing) {
        const replayedCall = await findCallRequestByTurn(db, validatedInput.turn_id);
        return duplicateDecisionResult(existing, validatedInput, payloadHash, replayedCall);
      }

    const turn = await loadTurnPolicy(validatedInput.turn_id, db);
    turnContext = turn;
    validatePolicy(decision, turn);

    // Fase 4 — pago (spec §4). Revalidado en el backend, nunca confiado del
    // modelo: `allowed_payment_plan` sale del batch ACTUAL (nunca memoria ni
    // resumen), el offering se revalida contra el snapshot canónico y el
    // link sale sólo de configuración. `business_action` ya sólo contiene
    // tipo/plan/offering — nunca link ni precio — así que no hace falta
    // filtrar nada antes de persistirlo como decisión o de guardarlo en
    // memoria.
    let finalResponse = decision.response;
    let paymentLinkStrippedUrls: readonly string[] = [];
    if (decision.schema_version === 4 && decision.business_action?.type === 'send_payment_link') {
      const action = decision.business_action;
      const batchMessages = turn.batch_id === null
        ? [{ content: turn.content }]
        : await db<Array<{ content: string }>>`
            SELECT content FROM messages
            WHERE batch_id = ${turn.batch_id}::uuid AND direction = 'inbound'
            ORDER BY conversation_seq ASC, created_at ASC, id ASC
          `;

      // One extra canonical read, ONLY here (spec §7): the offering must be
      // revalidated against the live snapshot, never trusted from the model
      // or from a stale claim-time copy. A snapshot failure degrades to "no
      // offerings known" rather than crashing the whole commit — the action
      // itself still fails closed via OFFERING_NOT_FOUND when it names one.
      let offerings: readonly { code: string }[] = [];
      try {
        // Bound to THIS transaction's own connection, never the module-level
        // pool: the pool is sized 1 in production (each serverless
        // invocation gets one connection), so a second query on the shared
        // `sql` singleton from inside an open transaction would starve
        // waiting for a connection the transaction itself is holding.
        const snapshot = await new PostgresBusinessContextStore(db).loadBusinessContext(
          loadBusinessWorkspaceConfig().workspaceSlug
        );
        offerings = snapshot?.offerings ?? [];
      } catch (error) {
        logger.error({
          event: 'orchestration.payment_link.business_snapshot_unavailable',
          trace_id: validatedInput.trace_id,
          turn_id: turn.id,
          error: String(error),
        });
      }

      const materialized = materializePaymentLinkAction({
        action,
        batchMessages,
        businessSnapshot: { offerings },
        contact: {
          blocked: turn.contact_status === 'inactivo'
            || turn.lifecycle_status === 'blocked'
            || turn.lifecycle_status === 'deleted'
            || turn.deleted_at !== null,
          // Only an actually revoked consent blocks a commercial outbound
          // (spec §8) — the same binary `validatePolicy` above already
          // enforces for every OTHER decision kind by checking exclusively
          // for `'revoked'`, never for `'unknown'`. Nothing in this codebase
          // ever writes `'granted'` for an inbound-initiated WhatsApp
          // conversation (see ingestion.service.ts): a prospect's default,
          // never-opted-out state is `'unknown'`, and it must count as
          // `'allowed'` here too, or `send_payment_link` would be
          // unreachable for every real contact.
          consent_status: turn.consent_status === 'revoked' ? 'revoked' : 'allowed',
        },
        modelResponseText: decision.response,
        resolver: createConfigPaymentLinkResolver(),
      });
      if (!materialized.ok) {
        throw new DecisionPolicyError(materialized.reason);
      }
      // `response_text` is only the model's OWN text, sanitized of any URL it
      // had no authority to write (spec §4 steps 3-4): the fixed
      // {label, url} block is a SEPARATE return value the caller must append
      // — materializePaymentLinkAction never does this itself.
      finalResponse = `${materialized.response_text}\n\n${materialized.block.label}: ${materialized.block.url}`.trim();
      paymentLinkStrippedUrls = materialized.stripped_urls;
    }

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
        retrieval_used,
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
        ${finalResponse},
        ${decision.response_type},
        ${jsonbParam(db, decision.business_action ?? null)},
        ${jsonbParam(db, retrievalUsedOf(decision))},
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

    // A non-empty list here is an injection/jailbreak signal: the model
    // wrote a URL it has no authority to write, and it was silently removed
    // before this response ever reached the customer. The action itself
    // still succeeds — spec §4's refusal list does not include this case —
    // but the attempt must stay observable.
    if (paymentLinkStrippedUrls.length > 0) {
      await auditLog({
        action: 'agent.decision.payment_link_urls_stripped',
        entity_type: 'agent_decision',
        entity_id: decisionId,
        payload: {
          turn_id: validatedInput.turn_id,
          stripped_urls: paymentLinkStrippedUrls,
        },
        event_key: `decision:${decisionId}:stripped_urls`,
        correlation_id: validatedInput.trace_id,
        causation_id: turn.id,
        source_event_id: turn.source_event_id ?? undefined,
      }, db);
    }

    // Reserva atómica: la sesión de llamada, su consentimiento derivado y el
    // evento `requested` viven o mueren con la decisión. Ninguna llamada de
    // red ocurre acá — el dispatch corre después del commit, por call_id.
    let callRequest: ReservedCallRequest | null = null;
    if (
      decision.schema_version === 4
      && decision.business_action?.type === 'request_call_now'
    ) {
      try {
        // El consentimiento se deriva del batch completo, no sólo del turno
        // representativo: un "llamame" enterrado en la ráfaga autoriza y un
        // "mejor no" posterior lo revoca.
        const consentMessages = turn.batch_id === null
          ? [{ id: turn.id, content: turn.content }]
          : await db<Array<{ id: string; content: string }>>`
              SELECT id, content FROM messages
              WHERE batch_id = ${turn.batch_id}::uuid AND direction = 'inbound'
              ORDER BY conversation_seq ASC, created_at ASC, id ASC
            `;
        callRequest = await reserveCallForDecision(db, {
          turn_id: validatedInput.turn_id,
          trace_id: validatedInput.trace_id,
          decision_id: decisionId,
          contact_id: turn.contact_id,
          conversation_id: turn.conversation_id,
          contact_name: turn.contact_name,
          phone: turn.phone,
          consent_messages: consentMessages,
          course_of_interest: decision.business_action.course_of_interest ?? null,
          prompt_version: validatedInput.model.prompt_version,
        });
      } catch (error) {
        if (error instanceof CallRequestRejectedError) {
          // Consentimiento no verificable => la decisión entera se rechaza.
          // Commitear el "registré la llamada" sin sesión mentiría al cliente.
          throw new DecisionPolicyError(error.reason);
        }
        throw error;
      }
    }

    if (finalResponse) {
      let message: Message;
      try {
        ({ message } = await registerMessage({
          conversation_id: turn.conversation_id,
          direction: 'outbound',
          content: finalResponse,
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
      // El intento sale del mismo UPDATE que toma el lease: es el número que
      // este workflow tiene que devolver al reportar, y leerlo aparte abriría
      // una ventana en la que ya no sería el suyo.
      const leased = await db<Array<{ attempt_count: number }>>`
        UPDATE outbound_deliveries
        SET
          state = 'leased',
          leased_by = ${`botpress:${validatedInput.trace_id}`},
          lease_until = now() + interval '5 minutes',
          attempt_count = attempt_count + 1
        WHERE id = ${queue.delivery_id}::uuid AND state = 'pending'
        RETURNING attempt_count
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
      outbound = {
        id: message.id,
        content: message.content,
        status: 'pending',
        delivery_attempt: Number(leased[0]?.attempt_count ?? 1),
      };
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
        business_action: decision.business_action?.type ?? null,
        next_state: decision.next_state,
        outbound_id: outbound?.id ?? null,
        call_id: callRequest?.call_id ?? null,
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
        call_request: callRequest,
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
      const replayedCall = await findCallRequestByTurn(db, validatedInput.turn_id);
      return duplicateDecisionResult(existing, validatedInput, payloadHash, replayedCall);
    });
  }
  };

  const result = await commit();

  // Fase 4 — memoria selectiva.
  //
  // Corre DESPUÉS del commit y en su propia conexión, a propósito. Adentro de
  // la transacción serializable, un solo INSERT rechazado dejaría la
  // transacción abortada y se llevaría puesta la decisión y el outbound: una
  // memoria jamás puede costar una respuesta al cliente. Un duplicado tampoco
  // reescribe nada, porque `commitAgentDecision` es idempotente por turno y una
  // repetición sale por `duplicate` sin volver a entrar acá.
  const turn = turnContext as TurnPolicyRow | null;
  if (result.status === 'committed' && turn && decision.memory_candidates.length > 0) {
    await recordTurnMemories({
      turn,
      candidates: decision.memory_candidates,
      decision_id: result.decision_id,
      trace_id: validatedInput.trace_id,
    });
  }

  return result;
}

/**
 * The messages a citation may point at: the whole claimed batch, in stable
 * order. Falls back to the representative turn when the inbound predates
 * batching, so an older row can still produce a verifiable memory.
 */
async function loadMemorySourceMessages(turn: TurnPolicyRow) {
  return sql<Array<{ id: string; content: string }>>`
    SELECT id, content
    FROM messages
    WHERE direction = 'inbound'
      AND contact_id = ${turn.contact_id}::uuid
      AND conversation_id = ${turn.conversation_id}::uuid
      AND (
        (${turn.batch_id}::uuid IS NOT NULL AND batch_id = ${turn.batch_id}::uuid)
        OR (${turn.batch_id}::uuid IS NULL AND id = ${turn.id}::uuid)
      )
    ORDER BY conversation_seq NULLS LAST, created_at
  `;
}

/**
 * "no registrar link ni precio como memoria seleccionada" (spec §4) is
 * structural for `send_payment_link` itself — the typed action never carries
 * a link or a price at all. This is the behavioral half of that rule: even a
 * well-formed `memory_candidate` whose free text happens to contain a URL or
 * a price-like amount (model hallucination, injection, or a bad generation)
 * must never reach `selected_memories`. Mirrors the same two patterns
 * `decision-v4.ts` already uses to reject a URL/amount-shaped
 * `offering_sku`, applied here to `value`/`source_quote` instead.
 */
const MEMORY_CANDIDATE_URL_PATTERN = /https?:\/\//i;
// Requires CURRENCY CONTEXT, not just a decimal-shaped number: a bare
// `\d[.,]\d{2}` false-positived on Spanish time expressions ("de 20.30 a
// 22.00", "turno de las 8,30") — exactly the schedule preferences the
// memory system exists to capture. A number only counts as price-like when
// it sits next to a currency symbol or a currency word (either order), and
// a currency word alone (without an adjacent number) is not enough either.
const MEMORY_CANDIDATE_AMOUNT_PATTERN =
  /[$€£]\s*\d|\d+(?:[.,]\d{2,3})?\s*\b(?:usd|u\$s|ars|d[oó]lares?|pesos)\b|\b(?:usd|u\$s|ars)\b\s*\d+/i;

function isUrlOrPriceLikeMemoryCandidate(candidate: DecisionV2['memory_candidates'][number]): boolean {
  const text = `${candidate.value} ${candidate.source_quote}`;
  return MEMORY_CANDIDATE_URL_PATTERN.test(text) || MEMORY_CANDIDATE_AMOUNT_PATTERN.test(text);
}

async function recordTurnMemories(params: {
  turn: TurnPolicyRow;
  candidates: DecisionV2['memory_candidates'];
  decision_id: string;
  trace_id: string;
}): Promise<void> {
  const rejectedCandidates = params.candidates.filter(isUrlOrPriceLikeMemoryCandidate);
  const safeCandidates = params.candidates.filter((candidate) => !isUrlOrPriceLikeMemoryCandidate(candidate));

  if (rejectedCandidates.length > 0) {
    // Best-effort, like every other post-commit write here: an audit failure
    // must never cost the (already safely filtered) memory recording below.
    await auditLog({
      action: 'agent.decision.memory_candidate_rejected',
      entity_type: 'agent_decision',
      entity_id: params.decision_id,
      payload: {
        rejected: rejectedCandidates.map((candidate) => ({
          type: candidate.type,
          key: candidate.key,
          reason: 'URL_OR_PRICE_LIKE',
        })),
      },
      event_key: `decision:${params.decision_id}:memory_candidates_rejected`,
      correlation_id: params.trace_id,
      causation_id: params.turn.id,
    }).catch((error) => {
      logger.error({
        event: 'orchestration.memory.reject_audit_failed',
        trace_id: params.trace_id,
        decision_id: params.decision_id,
        error: String(error),
      });
    });
  }

  if (safeCandidates.length === 0) return;

  try {
    const batchMessages = await loadMemorySourceMessages(params.turn);
    const outcome = await selectMemories(
      {
        contact_id: params.turn.contact_id,
        conversation_id: params.turn.conversation_id,
        source_batch_id: params.turn.batch_id,
        decision_id: params.decision_id,
        trace_id: params.trace_id,
        batch_messages: batchMessages,
        structured_facts: {
          contact_name: params.turn.contact_name,
          contact_status: params.turn.contact_status,
          consent_status: params.turn.consent_status ?? 'unknown',
        },
        candidates: safeCandidates,
      },
      {
        store: memoryStore,
        log: (event, fields) => logger.info({ event, ...fields }),
      }
    );

    if (outcome.accepted.length > 0) counter.increment('memory_accepted', outcome.accepted.length);
    if (outcome.rejected.length > 0) counter.increment('memory_rejected', outcome.rejected.length);
    if (outcome.duplicates > 0) counter.increment('memory_duplicate', outcome.duplicates);
    if (outcome.superseded.length > 0) {
      counter.increment('memory_superseded', outcome.superseded.length);
    }
  } catch (error) {
    // Already-degraded path: `selectMemories` swallows per-candidate failures,
    // so reaching here means the batch could not even be read. The turn is
    // committed and delivered either way.
    logger.error({
      event: 'orchestration.memory.selection_failed',
      trace_id: params.trace_id,
      decision_id: params.decision_id,
      error: String(error),
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
  /**
   * The attempt this report is about, as handed to the workflow when it took
   * the delivery. A workflow that revives late reports about *its* attempt, not
   * about whatever is running now; without this the backend cannot tell the two
   * apart and a stale `failed` can authorize a resend over a physical send.
   * Omitted means "whatever attempt is current", which is only safe for the
   * first one.
   */
  delivery_attempt?: number | null;
}

export interface DeliveryReportResult {
  /**
   * `stale_ignored`: the report belongs to an earlier attempt. It is kept as
   * evidence and audited, but it may not move the delivery — a later attempt
   * owns the row and may already have sent.
   */
  status: 'recorded' | 'duplicate' | 'stale_ignored';
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
  // Set only on the branch that actually transitions delivery to
  // `submitted`. Read after the transaction commits — never inside it, so a
  // Sheets/outbox failure can NEVER abort or revert the delivery state
  // change it follows (spec §5: "no revierte mensaje ni decisión").
  let paymentLinkSignal: PaymentLinkProjectionSignal | null = null;

  const result: DeliveryReportResult = await withSerializableTransaction(async (db) => {
    // The delivery is locked before anything else: the attempt it is on is what
    // gives this report an identity, and that number has to be read under the
    // same lock that will later refuse to move a row whose attempt advanced.
    const deliveries = await db<Array<{
      id: string;
      state: string;
      provider_message_id: string | null;
      attempt_count: number;
      outbox_id: string;
      outbox_state: string;
    }>>`
      SELECT od.id, od.state, od.provider_message_id, od.attempt_count,
             oe.id AS outbox_id, oe.state AS outbox_state
      FROM outbound_deliveries AS od
      JOIN outbox_events AS oe ON oe.delivery_id = od.id
      WHERE od.message_id = ${input.outbound_id}::uuid
      FOR UPDATE OF od, oe
    `;
    const delivery = deliveries[0];
    if (!delivery) throw new OutboundNotFoundError();

    const currentAttempt = Number(delivery.attempt_count);
    const reportedAttempt = input.delivery_attempt ?? currentAttempt;

    // A report from an attempt that has not happened is not a late report; it
    // is a client inventing history. It never touches the delivery.
    if (reportedAttempt > currentAttempt) {
      throw new DeliveryReportConflictError(
        `Report claims attempt ${reportedAttempt} but delivery is on attempt ${currentAttempt}`
      );
    }

    // The attempt belongs in the key: a replay of attempt 1's report must still
    // dedupe, while attempt 2's own report has to be recordable next to it.
    const eventKey = `delivery:${input.outbound_id}:${messageIdentity}:${input.status}:a${reportedAttempt}`;

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

    const stale = reportedAttempt < currentAttempt;

    if (!stale && ['delivered', 'dead_letter', 'cancelled'].includes(delivery.state)) {
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
        payload_hash,
        delivery_attempt
      )
      VALUES (
        ${eventKey},
        ${input.outbound_id}::uuid,
        ${delivery.id}::uuid,
        ${input.trace_id}::uuid,
        ${input.status},
        ${input.botpress_message_id},
        ${input.error_code},
        decode(${payloadHash}, 'hex'),
        ${reportedAttempt}
      )
    `;

    // A report about an attempt that is no longer running is evidence, not an
    // instruction. It stays in the table so the reconciler and a person can see
    // it, but the row belongs to the later attempt, which may already have
    // created the message in Botpress. Downgrading it here is how the same
    // message gets sent twice.
    if (stale) {
      await auditLog({
        action: 'delivery.report.stale_ignored',
        entity_type: 'outbound_delivery',
        entity_id: delivery.id,
        payload: {
          ...semanticPayload,
          reported_attempt: reportedAttempt,
          current_attempt: currentAttempt,
          delivery_state: delivery.state,
        },
        event_key: `audit:${eventKey}:stale`,
        correlation_id: input.trace_id,
      }, db);

      return {
        status: 'stale_ignored',
        replayed: false,
        outbound_id: input.outbound_id,
        delivery_status: input.status,
      };
    }

    if (input.status === 'submitted_to_botpress') {
      if (!input.botpress_message_id || input.error_code) throw new DeliveryReportConflictError('Invalid submitted report');
      if (delivery.state === 'submitted') {
        if (delivery.provider_message_id !== input.botpress_message_id) throw new DeliveryReportConflictError();
      } else {
        if (delivery.state !== 'leased') {
          await db`
            UPDATE outbound_deliveries
            SET state = 'leased', leased_by = ${`botpress:${input.trace_id}`}, lease_until = now() + interval '5 minutes'
            WHERE id = ${delivery.id}::uuid AND attempt_count = ${reportedAttempt}
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
          WHERE id = ${delivery.id}::uuid AND attempt_count = ${reportedAttempt}
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

      // Fase 4 — Sheets (spec §5): only after delivery is confirmed, and only
      // for the one action that projects a lead signal today. A read, never a
      // write — the actual enqueue happens after this transaction commits.
      paymentLinkSignal = await loadPaymentLinkProjectionSignal(db, input.outbound_id, input.trace_id);
    } else {
      if (!input.error_code) throw new DeliveryReportConflictError('Failed report requires error_code');
      if (delivery.state === 'submitted') throw new DeliveryReportConflictError('Submitted delivery cannot be downgraded');
      if (delivery.state !== 'leased') {
        await db`
          UPDATE outbound_deliveries
          SET state = 'leased', leased_by = ${`botpress:${input.trace_id}`}, lease_until = now() + interval '5 minutes'
          WHERE id = ${delivery.id}::uuid AND attempt_count = ${reportedAttempt}
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
        WHERE id = ${delivery.id}::uuid AND attempt_count = ${reportedAttempt}
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

  if (result.status === 'recorded' && paymentLinkSignal) {
    // Never throw out of here: an outbox failure must never surface as a
    // failure of THIS call, which already committed the canonical delivery
    // state. The row stays pending/retryable for the cron flush worker.
    await enqueuePaymentLinkSentProjection(paymentLinkSignal).catch((error) => {
      logger.error({
        event: 'orchestration.payment_link.projection_enqueue_failed',
        trace_id: input.trace_id,
        outbound_id: input.outbound_id,
        error: String(error),
      });
    });
  }

  return result;
}

interface PaymentLinkProjectionSignal {
  readonly planCode: string;
  readonly contactId: string;
  readonly phone: string;
  readonly traceId: string;
}

/**
 * Reads the decision behind this outbound, inside the SAME transaction that
 * just confirmed delivery: only a `send_payment_link` decision produces a
 * signal, and everything else (the plan and the customer identity to write)
 * comes straight from that decision's own turn — never a second guess.
 */
async function loadPaymentLinkProjectionSignal(
  db: DbClient,
  outboundId: string,
  traceId: string,
): Promise<PaymentLinkProjectionSignal | null> {
  const rows = await db<Array<{
    business_action: { type?: string; plan_code?: string } | null;
    contact_id: string;
    phone: string;
  }>>`
    SELECT ad.business_action, m.contact_id, c.phone
    FROM agent_decisions AS ad
    JOIN messages AS m ON m.id = ad.turn_id
    JOIN contacts AS c ON c.id = m.contact_id
    WHERE ad.outbound_message_id = ${outboundId}::uuid
    LIMIT 1
  `;
  const row = rows[0];
  if (!row || row.business_action?.type !== 'send_payment_link' || !row.business_action.plan_code) {
    return null;
  }
  return {
    planCode: row.business_action.plan_code,
    contactId: row.contact_id,
    phone: row.phone,
    traceId,
  };
}

/**
 * Enqueues the `payment_link_sent` row (spec §5: `etapa_comercial=proposal`,
 * `estado_pago=pendiente`, `plan=<plan_code>`). Fails closed and silent at
 * every missing-configuration step — no Sheets config, no resolvable
 * workspace — because none of that may ever block or revert the delivery
 * this runs after. `enqueueLeadProjection` itself can also throw
 * (retry-exhausted or a DB error); the caller wraps this whole function in
 * `.catch()` for exactly that reason.
 */
async function enqueuePaymentLinkSentProjection(signal: PaymentLinkProjectionSignal): Promise<void> {
  const sheets = loadSheetsProjectionConfig();
  if (!sheets) {
    logger.info({
      event: 'orchestration.payment_link.projection_skipped',
      trace_id: signal.traceId,
      reason: 'SHEETS_NOT_CONFIGURED',
    });
    return;
  }
  let workspaceSlug: string;
  try {
    workspaceSlug = loadBusinessWorkspaceConfig().workspaceSlug;
  } catch {
    logger.warn({
      event: 'orchestration.payment_link.projection_skipped',
      trace_id: signal.traceId,
      reason: 'MISSING_WORKSPACE_CONFIG',
    });
    return;
  }
  const workspaceRows = await sql<Array<{ id: string }>>`
    SELECT id FROM workspaces WHERE slug = ${workspaceSlug} AND status = 'active' LIMIT 1
  `;
  const workspaceId = workspaceRows[0]?.id;
  if (!workspaceId) {
    logger.warn({
      event: 'orchestration.payment_link.projection_skipped',
      trace_id: signal.traceId,
      reason: 'WORKSPACE_NOT_FOUND',
    });
    return;
  }
  await enqueueLeadProjection({
    workspaceId,
    contactId: signal.contactId,
    spreadsheetId: sheets.spreadsheetId,
    tabName: sheets.tabName,
    telefono: signal.phone,
    etapaComercial: 'proposal',
    cursoInteres: '',
    plan: signal.planCode,
    estadoPago: 'pendiente',
    fechaPago: '',
    callId: '',
    ultimaSenal: 'payment_link_sent',
    traceId: signal.traceId,
  });
}
