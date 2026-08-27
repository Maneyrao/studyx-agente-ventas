import type { ConversationChannel } from '@/lib/contracts/channel';
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
import { splitFullName } from '@/lib/heuristics/contact-identity';
import { registerMessage, type Message } from './message.service';
import { enqueueLeadProjection } from './projection.service';
import { auditLog } from '@/lib/audit/logger';
import {
  loadBusinessWorkspaceConfig,
  loadSheetsProjectionConfig,
  type SheetsProjectionConfig,
} from '@/lib/config';
import { PostgresBusinessContextStore } from '@/features/orchestration/adapters/postgres-business-context';
import { PostgresSalesContextStore } from '@/features/sales/adapters/postgres-sales-context-store';
import { isSalesPaymentPlan } from '@/features/sales/domain/sales-context';
import { materializePaymentLinkAction } from '@/features/payments/application/materialize-payment-link-action';
import { createConfigPaymentLinkResolver } from '@/features/payments/adapters/config-payment-link.resolver';
import { PAYMENT_PLAN_PRESENTATIONS } from '@/features/payments/domain/payment-link';
import {
  classifyCurrentPaymentIntent,
  deriveDeferredPaymentChoiceFromBatch,
  derivePaymentPlanSelectionFromBatch,
  hasTemporalPaymentDeferral,
} from '@/features/payments/domain/payment-choice-policy';
import {
  buildAuthorizedEgress,
  verifyAuthorizedEgress,
  type AuthorizedEgressV1,
  type ProtectedFactRef,
} from '@/features/orchestration/domain/egress-guard';
import {
  materializeCanonicalCatalogFacts,
  materializeCanonicalOfferingFacts,
  responseNeedsOfferingFactAuthorization,
} from '@/features/orchestration/domain/canonical-offering-egress';
import type { RawOfferingRow } from '@/features/orchestration/domain/business-context';
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
  /**
   * Claim-time canonical identity for facts in a non-payment response. This is
   * only a lookup hint: the backend must resolve it exactly in its own live
   * workspace snapshot before it authorizes a single fact.
   */
  authorized_offering_code?: string | null;
  /** Claim-time deterministic plan selection; re-derived from the batch. */
  authorized_payment_plan?: 'monthly_12' | 'monthly_6' | 'one_time' | null;
  decision: AnyDecision;
  model: {
    provider: 'botpress' | 'google-ai-direct' | 'groq-direct';
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
    /** Exact backend authorization that must verify against `content` before any send. */
    authorized_egress: AuthorizedEgressV1;
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
  channel: ConversationChannel;
  batch_id: string | null;
  /** Contents carrying durable evidence that this batch caused the first
   * effective opt-out transition. The representative turn is often the
   * first message in a burst, so `content` alone is not authoritative. */
  opt_out_ack_eligible_contents: string[];
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
  authorized_egress: unknown;
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
      od.attempt_count AS delivery_attempt,
      om.metadata -> 'authorized_egress' AS authorized_egress
    FROM agent_decisions AS ad
    LEFT JOIN outbound_deliveries AS od ON od.message_id = ad.outbound_message_id
    LEFT JOIN messages AS om ON om.id = ad.outbound_message_id
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
      conv.channel,
      COALESCE((
        SELECT array_agg(candidate.content ORDER BY candidate.conversation_seq, candidate.created_at, candidate.id)
        FROM messages AS candidate
        WHERE candidate.direction = 'inbound'
          AND candidate.contact_id = m.contact_id
          AND candidate.conversation_id = m.conversation_id
          AND (
            (m.batch_id IS NOT NULL AND candidate.batch_id = m.batch_id)
            OR (m.batch_id IS NULL AND candidate.id = m.id)
          )
          AND candidate.metadata @> '{"opt_out_ack_eligible": true}'::jsonb
      ), ARRAY[]::text[]) AS opt_out_ack_eligible_contents
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
  // Never infer acknowledgement eligibility from the representative message:
  // in a burst it may precede the actual opt-out. Conversely, content alone
  // would acknowledge every repeated opt-out. Require both persisted
  // first-transition evidence and the domain heuristic as defense in depth.
  const hasEligibleExplicitOptOut = turn.opt_out_ack_eligible_contents.some(isExplicitOptOut);
  const optOutAck = hasEligibleExplicitOptOut
    && decision.intent === 'opt_out'
    && decision.response_type === 'opt_out_ack'
    && decision.response !== null;

  if (blocked && decision.kind !== 'suppress' && !optOutAck) {
    throw new DecisionPolicyError('CONTACT_BLOCKED');
  }
  if (turn.consent_status === 'revoked' && decision.kind !== 'suppress' && !optOutAck) {
    throw new DecisionPolicyError('CONSENT_REVOKED');
  }
  if (decision.response_type === 'opt_out_ack' && !hasEligibleExplicitOptOut) {
    throw new DecisionPolicyError('OPT_OUT_ACK_WITHOUT_OPT_OUT');
  }
}

function decisionPayload(input: CommitDecisionInput) {
  return {
    turn_id: input.turn_id,
    decision: input.decision,
    model: input.model,
    // Preserve the historical hash for legacy/omitted-null callers while a
    // real capability identity remains part of the idempotency boundary.
    ...(input.authorized_offering_code
      ? { authorized_offering_code: input.authorized_offering_code }
      : {}),
    ...(input.authorized_payment_plan
      ? { authorized_payment_plan: input.authorized_payment_plan }
      : {}),
  };
}

function egressPolicyError(reason: string): DecisionPolicyError {
  return new DecisionPolicyError(`EGRESS_${reason}`);
}

function redactedUrlAuditEvidence(value: string) {
  let scheme = 'invalid';
  let hostHash: string | null = null;
  try {
    const parsed = new URL(value);
    scheme = parsed.protocol.replace(/:$/u, '').toLowerCase();
    // The hostname is attacker-controlled too (PII can be placed in a
    // subdomain), so retain only a correlation-safe digest.
    hostHash = sha256Hex(parsed.hostname.toLowerCase());
  } catch {
    // Invalid URL-like text still gets a stable fingerprint below.
  }
  return {
    scheme,
    host_hash: hostHash,
    value_hash: sha256Hex(value),
  };
}

function verifyPersistedEgress(content: string, manifest: unknown): AuthorizedEgressV1 {
  const verification = verifyAuthorizedEgress({ content, manifest });
  if (!verification.ok) throw egressPolicyError(verification.reason);
  return manifest as AuthorizedEgressV1;
}

function paymentPlanProtectedFacts(
  planCode: keyof typeof PAYMENT_PLAN_PRESENTATIONS
): readonly ProtectedFactRef[] {
  const presentation = PAYMENT_PLAN_PRESENTATIONS[planCode];
  // The trusted fixed payment block contains this exact lexical price. The
  // model never supplies either side of this authorization.
  const amount = presentation.installment_amount.replace(/\.00$/u, '');
  return [{ kind: 'price', value: `${presentation.currency} ${amount}` }];
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
      authorized_egress: verifyPersistedEgress(existing.response, existing.authorized_egress),
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
    let authorizedUrls: readonly string[] = [];
    let authorizedProtectedFacts: readonly ProtectedFactRef[] = [];
    let committedBusinessAction = decision.business_action;
    let effectiveAuthorizedOfferingCode = validatedInput.authorized_offering_code;
    let canonicalOfferings: readonly RawOfferingRow[] | undefined;
    let canonicalWorkspaceId: string | null = null;
    let canonicalSnapshotAttempted = false;
    const workspaceSlug = loadBusinessWorkspaceConfig().workspaceSlug;
    const salesContextStore = new PostgresSalesContextStore(db);
    const existingSalesContext = await salesContextStore.load(workspaceSlug, turn.contact_id);
    let loadedBatchMessages: Array<{ content: string }> | null = null;

    const loadBatchMessages = async (): Promise<Array<{ content: string }>> => {
      if (loadedBatchMessages !== null) return loadedBatchMessages;
      loadedBatchMessages = turn.batch_id === null
        ? [{ content: turn.content }]
        : await db<Array<{ content: string }>>`
            SELECT content FROM messages
            WHERE batch_id = ${turn.batch_id}::uuid AND direction = 'inbound'
            ORDER BY conversation_seq ASC, created_at ASC, id ASC
          `;
      return loadedBatchMessages;
    };

    const authorizedPaymentPlan = validatedInput.authorized_payment_plan ?? null;
    if (authorizedPaymentPlan !== null) {
      const batchMessages = await loadBatchMessages();
      const currentPaymentIntent = classifyCurrentPaymentIntent(batchMessages);
      const backendDerivedPlan = derivePaymentPlanSelectionFromBatch(batchMessages)
        ?? (currentPaymentIntent.kind === 'direct' || currentPaymentIntent.kind === 'resume'
          ? existingSalesContext?.selected_payment_plan ?? null
          : null);
      if (backendDerivedPlan !== authorizedPaymentPlan) {
        throw new DecisionPolicyError('PAYMENT_PLAN_MISMATCH');
      }
      if (
        effectiveAuthorizedOfferingCode === null
        && !existingSalesContext?.selected_offering_code
      ) {
        throw new DecisionPolicyError('PAYMENT_OFFERING_REQUIRED');
      }
    }

    const loadCanonicalOfferings = async (
      purpose: 'payment_link' | 'protected_facts'
    ): Promise<readonly RawOfferingRow[]> => {
      if (canonicalSnapshotAttempted) return canonicalOfferings ?? [];
      canonicalSnapshotAttempted = true;
      try {
        // Bound to THIS transaction's own connection, never the module-level
        // pool: with a one-connection pool, a second checkout from inside the
        // open transaction would wait on itself.
        const snapshot = await new PostgresBusinessContextStore(db).loadBusinessCatalog(
          workspaceSlug
        );
        canonicalWorkspaceId = snapshot?.workspace.id ?? null;
        canonicalOfferings = snapshot?.offerings ?? [];
      } catch (error) {
        canonicalOfferings = [];
        logger.error({
          event: purpose === 'payment_link'
            ? 'orchestration.payment_link.business_snapshot_unavailable'
            : 'orchestration.egress.business_snapshot_unavailable',
          trace_id: validatedInput.trace_id,
          turn_id: turn.id,
          error: String(error),
        });
      }
      return canonicalOfferings;
    };

    if (decision.schema_version === 4 && decision.business_action?.type === 'send_payment_link') {
      const action = decision.business_action;
      const batchMessages = await loadBatchMessages();

      // One extra canonical read, ONLY for payment or a response containing a
      // protected fact. A greeting/plain clarification does not pay this DB
      // latency. Payment and fact authorization reuse the same snapshot.
      const offerings = await loadCanonicalOfferings('payment_link');
      let deferredPlanCode: ReturnType<typeof deriveDeferredPaymentChoiceFromBatch> = null;
      if (classifyCurrentPaymentIntent(batchMessages).kind === 'resume') {
        const priorInboundMessages = await db<Array<{ content: string }>>`
          SELECT prior.content
          FROM messages AS prior
          WHERE prior.conversation_id = ${turn.conversation_id}::uuid
            AND prior.direction = 'inbound'
            AND prior.conversation_seq < (
              SELECT current_turn.conversation_seq
              FROM messages AS current_turn
              WHERE current_turn.id = ${turn.id}::uuid
            )
          ORDER BY prior.conversation_seq DESC, prior.created_at DESC, prior.id DESC
          LIMIT 1
        `;
        deferredPlanCode = deriveDeferredPaymentChoiceFromBatch(priorInboundMessages);
        if (
          deferredPlanCode === null
          && hasTemporalPaymentDeferral(priorInboundMessages)
          && existingSalesContext?.selected_payment_plan === action.plan_code
          && existingSalesContext.selected_offering_code === action.offering_sku
        ) {
          deferredPlanCode = existingSalesContext.selected_payment_plan;
        }
      }

      const materialized = materializePaymentLinkAction({
        action,
        authorizedOfferingCode: effectiveAuthorizedOfferingCode ?? null,
        deferredPlanCode,
        selectedPlanCode: existingSalesContext?.selected_payment_plan ?? null,
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

      // Revalidation above must happen before this dedupe read. Otherwise a
      // mismatched SKU or a current veto could obtain a friendly acknowledgement
      // merely because an older valid link existed in the same conversation.
      const priorPaymentLinks = await db<Array<{ id: string }>>`
        SELECT ad.id
        FROM agent_decisions AS ad
        JOIN messages AS prior_turn ON prior_turn.id = ad.turn_id
        WHERE prior_turn.conversation_id = ${turn.conversation_id}::uuid
          AND ad.outbound_message_id IS NOT NULL
          AND ad.business_action ->> 'type' = 'send_payment_link'
          AND ad.business_action ->> 'plan_code' = ${action.plan_code}
          AND ad.business_action ->> 'offering_sku' = ${action.offering_sku}
        LIMIT 1
      `;

      if (priorPaymentLinks.length > 0) {
        // Cross-turn idempotency: acknowledge the existing proposal without
        // emitting a second Stripe URL or a second payment_link_sent signal.
        finalResponse = 'Ya te compartí el link de ese plan. Si necesitás que revisemos otra opción, decime.';
        committedBusinessAction = null;
      } else {
        // `response_text` is only the model's OWN text, sanitized of any URL it
        // had no authority to write (spec §4 steps 3-4): the fixed
        // {label, url} block is a SEPARATE return value the caller must append.
        finalResponse = `${materialized.response_text}\n\n${materialized.block.label}: ${materialized.block.url}`.trim();
        paymentLinkStrippedUrls = materialized.stripped_urls;
        authorizedUrls = [materialized.block.url];
        authorizedProtectedFacts = paymentPlanProtectedFacts(action.plan_code);
      }
    }

    if (finalResponse !== null && responseNeedsOfferingFactAuthorization(finalResponse)) {
      const offerings = await loadCanonicalOfferings('protected_facts');
      const catalogLabels = [
        ...offerings.map((offering) => ({
          code: offering.code,
          display_name: offering.display_name,
        })),
        ...[...new Set(offerings.flatMap((offering) => {
          const academy = offering.metadata?.academy;
          return typeof academy === 'string' && academy.trim().length > 0 ? [academy.trim()] : [];
        }))].map((academy) => ({
          code: `academy:${academy}`,
          // The catalog guard authorizes complete availability assertions. Keep
          // the connective phrase in the synthetic label so both "curso de"
          // and the natural plural "cursos de" are treated as one grounded
          // academy assertion without widening the lexical detector.
          display_name: `cursos de ${academy}`,
        })),
      ];
      authorizedProtectedFacts = [
        ...authorizedProtectedFacts,
        ...materializeCanonicalCatalogFacts({ content: finalResponse, offerings: catalogLabels }),
      ];
      if (validatedInput.authorized_offering_code) {
        const exactMatches = offerings.filter(
          (offering) => offering.code === validatedInput.authorized_offering_code
        );
        if (exactMatches.length === 1) {
          effectiveAuthorizedOfferingCode = exactMatches[0].code;
          authorizedProtectedFacts = [
            ...authorizedProtectedFacts,
            ...materializeCanonicalOfferingFacts({
              content: finalResponse,
              offering: exactMatches[0],
            }),
          ];
        } else {
          effectiveAuthorizedOfferingCode = null;
        }
      }
    }

    // The manifest is created from backend-owned capabilities, then verified
    // against the exact final text before the first canonical write. A model
    // URL or protected commercial claim has no route to the outbox merely by
    // appearing in prose.
    let authorizedEgress: AuthorizedEgressV1 | null = null;
    if (finalResponse !== null) {
      authorizedEgress = buildAuthorizedEgress({
        content: finalResponse,
        authorized_urls: authorizedUrls,
        protected_facts: authorizedProtectedFacts,
      });
      const verification = verifyAuthorizedEgress({
        content: finalResponse,
        manifest: authorizedEgress,
      });
      if (!verification.ok) {
        const mayUseSafeFallback = verification.reason === 'UNAUTHORIZED_PROTECTED_FACT'
          && committedBusinessAction === null;
        if (!mayUseSafeFallback) throw egressPolicyError(verification.reason);

        counter.increment('egress_safe_fallback', 1);
        logger.warn({
          event: 'orchestration.egress.safe_fallback',
          trace_id: validatedInput.trace_id,
          turn_id: turn.id,
          reason: verification.reason,
        });
        finalResponse = 'No tengo ese dato confirmado en el catálogo. Decime qué curso te interesa y qué querés confirmar.';
        authorizedUrls = [];
        authorizedProtectedFacts = [];
        authorizedEgress = buildAuthorizedEgress({
          content: finalResponse,
          authorized_urls: [],
          protected_facts: [],
        });
      }
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
        ${jsonbParam(db, committedBusinessAction ?? null)},
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
          stripped_url_count: paymentLinkStrippedUrls.length,
          stripped_url_evidence: paymentLinkStrippedUrls.map(redactedUrlAuditEvidence),
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
            authorized_egress: authorizedEgress,
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
        authorized_egress: authorizedEgress,
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
        authorized_egress: authorizedEgress!,
      };

      if (
        committedBusinessAction?.type === 'send_payment_link'
        && canonicalWorkspaceId
      ) {
        // The configured deployment, not model output, establishes the
        // tenant/contact relation. The durable job is created before any
        // physical send and therefore survives a later report/projection
        // crash without having to rediscover tenant ownership from history.
        await db`
          INSERT INTO workspace_contacts (
            workspace_id, contact_id, lifecycle_status, source_channel
          ) VALUES (
            ${canonicalWorkspaceId}::uuid,
            ${turn.contact_id}::uuid,
            'active',
            ${turn.channel}
          )
          ON CONFLICT (workspace_id, contact_id) DO NOTHING
        `;
        await db`
          INSERT INTO payment_projection_jobs (
            decision_id, workspace_id, contact_id, outbound_message_id,
            trace_id, offering_sku, plan_code, decision_created_at
          )
          SELECT
            ad.id,
            ${canonicalWorkspaceId}::uuid,
            ${turn.contact_id}::uuid,
            ${message.id}::uuid,
            ad.trace_id,
            ${committedBusinessAction.offering_sku},
            ${committedBusinessAction.plan_code},
            ad.created_at
          FROM agent_decisions AS ad
          WHERE ad.id = ${decisionId}::uuid
          ON CONFLICT (decision_id) DO NOTHING
        `;
      }
    }

    // Persist business identity independently from vector memory. This runs in
    // the same serializable decision transaction, so an outbound/decision can
    // never claim a course or payment transition that failed to become durable.
    const requestedPayment = committedBusinessAction?.type === 'send_payment_link'
      ? committedBusinessAction
      : null;
    const selectedOfferingCode = requestedPayment?.offering_sku
      ?? effectiveAuthorizedOfferingCode
      ?? existingSalesContext?.selected_offering_code
      ?? null;
    const selectedPlan = requestedPayment && isSalesPaymentPlan(requestedPayment.plan_code)
      ? requestedPayment.plan_code
      : authorizedPaymentPlan;
    const closesCommercialConversation = decision.intent === 'opt_out'
      || (
        decision.intent === 'commercial_decline'
        && decision.next_state === 'completed'
        && decision.reason_code === 'DETERMINISTIC_DEFERRED_CLOSE'
      );
    const sameOfferingAsBefore = effectiveAuthorizedOfferingCode !== null
      && effectiveAuthorizedOfferingCode === existingSalesContext?.selected_offering_code;
    const stage = callRequest !== null
      ? 'handoff'
      : closesCommercialConversation
        ? 'closed'
        : requestedPayment !== null
          ? 'payment_link_sent'
          : selectedPlan !== null
            ? 'plan_selected'
            : effectiveAuthorizedOfferingCode !== null
              && (!sameOfferingAsBefore || existingSalesContext?.stage === 'exploring'
                || existingSalesContext?.stage === 'qualified' || existingSalesContext?.stage === 'closed')
              ? 'course_selected'
              : existingSalesContext?.stage ?? 'exploring';
    await salesContextStore.transition({
      workspace_slug: workspaceSlug,
      contact_id: turn.contact_id,
      conversation_id: turn.conversation_id,
      source_turn_id: turn.id,
      selected_offering_code: selectedOfferingCode,
      selected_payment_plan: selectedPlan,
      stage,
    });

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
        business_action: committedBusinessAction?.type ?? null,
        next_state: decision.next_state,
        outbound_id: outbound?.id ?? null,
        egress_hash: outbound?.authorized_egress.content_hash ?? null,
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

      await markPaymentProjectionJobDelivered(db, input.outbound_id);

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

  if (result.delivery_status === 'submitted_to_botpress') {
    // Physical provider evidence is already committed above and may never be
    // rolled back by a derived projection. This eager attempt is best-effort;
    // the scheduled reconciler reconstructs any missing row without sending.
    try {
      await projectPendingPaymentByOutbound(input.outbound_id);
    } catch (error) {
      logger.error({
        event: 'orchestration.payment_link.projection_enqueue_failed',
        trace_id: input.trace_id,
        outbound_id: input.outbound_id,
        error: String(error),
      });
    }
  }

  return result;
}

async function markPaymentProjectionJobDelivered(
  db: DbClient,
  outboundId: string,
): Promise<void> {
  const jobs = await db<Array<{
    decision_id: string;
    workspace_id: string;
    contact_id: string;
    decision_created_at: string;
  }>>`
    SELECT
      job.decision_id,
      job.workspace_id,
      job.contact_id,
      job.decision_created_at
    FROM payment_projection_jobs AS job
    JOIN workspace_contacts AS wc
      ON wc.workspace_id = job.workspace_id
      AND wc.contact_id = job.contact_id
    WHERE job.outbound_message_id = ${outboundId}::uuid
    FOR UPDATE OF wc, job
  `;
  const job = jobs[0];
  if (!job) return;

  const newer = await db<Array<{ exists: boolean }>>`
    SELECT EXISTS (
      SELECT 1
      FROM payment_projection_jobs AS candidate
      WHERE candidate.workspace_id = ${job.workspace_id}::uuid
        AND candidate.contact_id = ${job.contact_id}::uuid
        AND candidate.delivered_at IS NOT NULL
        AND (
          candidate.decision_created_at,
          candidate.decision_id
        ) > (
          ${job.decision_created_at}::timestamptz,
          ${job.decision_id}::uuid
        )
    ) AS exists
  `;

  if (newer[0]?.exists) {
    await db`
      UPDATE payment_projection_jobs
      SET delivered_at = COALESCE(delivered_at, now()),
          state = 'superseded'
      WHERE decision_id = ${job.decision_id}::uuid
    `;
    return;
  }

  await db`
    UPDATE payment_projection_jobs
    SET state = 'superseded'
    WHERE workspace_id = ${job.workspace_id}::uuid
      AND contact_id = ${job.contact_id}::uuid
      AND delivered_at IS NOT NULL
      AND decision_id <> ${job.decision_id}::uuid
      AND (
        decision_created_at,
        decision_id
      ) < (
        ${job.decision_created_at}::timestamptz,
        ${job.decision_id}::uuid
      )
  `;
  await db`
    UPDATE payment_projection_jobs
    SET delivered_at = COALESCE(delivered_at, now()),
        state = 'pending',
        projected_at = NULL
    WHERE decision_id = ${job.decision_id}::uuid
  `;
}

interface PaymentLinkProjectionSignal {
  readonly decisionId: string;
  readonly workspaceId: string;
  readonly planCode: string;
  readonly offeringSku: string;
  readonly contactId: string;
  readonly phone: string;
  readonly contactName: string | null;
  readonly contactEmail: string | null;
  readonly traceId: string;
}

type PaymentProjectionReconciliationStatus = 'ready' | 'disabled' | 'error';
type PaymentProjectionReconciliationReason =
  | 'SHEETS_NOT_CONFIGURED'
  | 'WORKSPACE_NOT_CONFIGURED'
  | 'WORKSPACE_CONFIG_INVALID'
  | 'WORKSPACE_NOT_FOUND'
  | 'RECONCILIATION_FAILED'
  | null;

interface PaymentProjectionRuntime {
  readonly workspaceId: string;
  readonly sheets: SheetsProjectionConfig;
}

type PaymentProjectionRuntimeResolution =
  | { status: 'ready'; reason: null; runtime: PaymentProjectionRuntime }
  | { status: 'disabled'; reason: 'SHEETS_NOT_CONFIGURED' | 'WORKSPACE_NOT_CONFIGURED' }
  | { status: 'error'; reason: 'WORKSPACE_CONFIG_INVALID' | 'WORKSPACE_NOT_FOUND' };

async function resolvePaymentProjectionRuntime(
  db: DbClient,
): Promise<PaymentProjectionRuntimeResolution> {
  const sheets = loadSheetsProjectionConfig();
  if (!sheets) return { status: 'disabled', reason: 'SHEETS_NOT_CONFIGURED' };

  let workspaceSlug: string;
  try {
    workspaceSlug = loadBusinessWorkspaceConfig().workspaceSlug;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('INVALID_BUSINESS_CONFIG:')) {
      return { status: 'error', reason: 'WORKSPACE_CONFIG_INVALID' };
    }
    return { status: 'disabled', reason: 'WORKSPACE_NOT_CONFIGURED' };
  }
  const workspaces = await db<Array<{ id: string }>>`
    SELECT id
    FROM workspaces
    WHERE slug = ${workspaceSlug} AND status = 'active'
    LIMIT 1
  `;
  if (!workspaces[0]) return { status: 'error', reason: 'WORKSPACE_NOT_FOUND' };
  return {
    status: 'ready',
    reason: null,
    runtime: { workspaceId: workspaces[0].id, sheets },
  };
}

/**
 * Loads one tenant-bound pending job after candidate acquisition. The job
 * carries the immutable plan/SKU/trace; PII is joined only after the exact
 * active workspace membership has been proven.
 */
async function loadPaymentLinkProjectionSignal(
  db: DbClient,
  candidate: PaymentProjectionCandidate,
): Promise<PaymentLinkProjectionSignal | null> {
  const rows = await db<Array<{
    decision_id: string;
    workspace_id: string;
    plan_code: string;
    offering_sku: string;
    contact_id: string;
    phone: string;
    name: string | null;
    email: string | null;
    trace_id: string;
  }>>`
    SELECT
      job.decision_id,
      job.workspace_id,
      job.plan_code,
      job.offering_sku,
      job.contact_id,
      c.phone,
      c.name,
      c.email,
      job.trace_id::text AS trace_id
    FROM payment_projection_jobs AS job
    JOIN workspace_contacts AS wc
      ON wc.workspace_id = job.workspace_id
      AND wc.contact_id = job.contact_id
      AND wc.lifecycle_status = 'active'
    JOIN contacts AS c ON c.id = job.contact_id
    WHERE job.decision_id = ${candidate.decision_id}::uuid
      AND job.workspace_id = ${candidate.workspace_id}::uuid
      AND job.contact_id = ${candidate.contact_id}::uuid
      AND job.outbound_message_id = ${candidate.outbound_message_id}::uuid
      AND job.state = 'pending'
    FOR UPDATE OF job
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    decisionId: row.decision_id,
    workspaceId: row.workspace_id,
    planCode: row.plan_code,
    offeringSku: row.offering_sku,
    contactId: row.contact_id,
    phone: row.phone,
    contactName: row.name,
    contactEmail: row.email,
    traceId: row.trace_id,
  };
}

/**
 * Enqueues the `payment_link_sent` row (spec §5: `etapa_comercial=proposal`,
 * `estado_pago=pendiente`, `plan=<plan_code>`). Runtime configuration and
 * tenant equality have already been validated. A DB enqueue failure throws so
 * the pending job stays visible for the scheduled reconciler.
 */
async function enqueuePaymentLinkSentProjection(
  signal: PaymentLinkProjectionSignal,
  runtime: PaymentProjectionRuntime,
  db: DbClient,
): Promise<'repaired' | 'unchanged'> {
  if (signal.workspaceId !== runtime.workspaceId) throw new Error('PAYMENT_PROJECTION_TENANT_MISMATCH');
  // Interés canónico: el `offering_sku` de la decisión se proyecta como el
  // display_name canónico del catálogo (P1, informe 2026-08-23: el outbox
  // descartaba el sku y `curso_interes` quedaba vacío tras un cierre).
  const offeringRows = await db<Array<{ display_name: string }>>`
    SELECT display_name FROM offerings
    WHERE workspace_id = ${runtime.workspaceId}::uuid AND code = ${signal.offeringSku}
    LIMIT 1
  `;
  const cursoInteres = offeringRows[0]?.display_name ?? signal.offeringSku;
  const identity = signal.contactName ? splitFullName(signal.contactName) : null;
  const projection = await enqueueLeadProjection({
    workspaceId: runtime.workspaceId,
    contactId: signal.contactId,
    spreadsheetId: runtime.sheets.spreadsheetId,
    tabName: runtime.sheets.tabName,
    telefono: signal.phone,
    nombre: identity?.nombre,
    apellido: identity?.apellido,
    email: signal.contactEmail ?? undefined,
    etapaComercial: 'proposal',
    cursoInteres,
    plan: signal.planCode,
    estadoPago: 'pendiente',
    fechaPago: '',
    callId: '',
    ultimaSenal: 'payment_link_sent',
    traceId: signal.traceId,
  }, { sql: db });
  return projection.changed ? 'repaired' : 'unchanged';
}

interface PaymentProjectionCandidate {
  readonly decision_id: string;
  readonly workspace_id: string;
  readonly contact_id: string;
  readonly outbound_message_id: string;
}

async function projectPaymentProjectionCandidate(
  candidate: PaymentProjectionCandidate,
  runtime: PaymentProjectionRuntime,
): Promise<'repaired' | 'unchanged' | 'skipped'> {
  return withSerializableTransaction(async (db) => {
    const membership = await db<Array<{ id: string }>>`
      SELECT id
      FROM workspace_contacts
      WHERE workspace_id = ${candidate.workspace_id}::uuid
        AND contact_id = ${candidate.contact_id}::uuid
        AND lifecycle_status = 'active'
      FOR UPDATE
    `;
    if (!membership[0] || candidate.workspace_id !== runtime.workspaceId) return 'skipped';

    const signal = await loadPaymentLinkProjectionSignal(db, candidate);
    if (!signal) return 'skipped';
    const outcome = await enqueuePaymentLinkSentProjection(signal, runtime, db);
    await db`
      UPDATE payment_projection_jobs
      SET state = 'projected', projected_at = now()
      WHERE decision_id = ${signal.decisionId}::uuid AND state = 'pending'
    `;
    return outcome;
  });
}

async function projectPendingPaymentByOutbound(outboundId: string): Promise<void> {
  const resolved = await resolvePaymentProjectionRuntime(sql);
  if (resolved.status !== 'ready') {
    logger.warn({
      event: 'orchestration.payment_link.projection_skipped',
      outbound_id: outboundId,
      status: resolved.status,
      reason: resolved.reason,
    });
    return;
  }
  const candidates = await sql<PaymentProjectionCandidate[]>`
    SELECT decision_id, workspace_id, contact_id, outbound_message_id
    FROM payment_projection_jobs
    WHERE outbound_message_id = ${outboundId}::uuid
      AND workspace_id = ${resolved.runtime.workspaceId}::uuid
      AND state = 'pending'
    LIMIT 1
  `;
  if (candidates[0]) {
    await projectPaymentProjectionCandidate(candidates[0], resolved.runtime);
  }
}

export interface DeliveredPaymentProjectionReconciliationResult {
  readonly status: PaymentProjectionReconciliationStatus;
  readonly reason: PaymentProjectionReconciliationReason;
  readonly examined: number;
  readonly repaired: number;
  readonly unchanged: number;
  readonly skipped: number;
  readonly failed: number;
}

/**
 * Repairs only the derived Sheet projection for already-submitted payment
 * messages. It has no provider client and cannot create or resend a message.
 */
export async function reconcileDeliveredPaymentProjections(
  input: { limit?: number } = {},
): Promise<DeliveredPaymentProjectionReconciliationResult> {
  const empty = { examined: 0, repaired: 0, unchanged: 0, skipped: 0, failed: 0 };
  const resolved = await resolvePaymentProjectionRuntime(sql);
  if (resolved.status !== 'ready') return { ...resolved, ...empty };
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
  const candidates = await sql<PaymentProjectionCandidate[]>`
    SELECT decision_id, workspace_id, contact_id, outbound_message_id
    FROM payment_projection_jobs
    WHERE workspace_id = ${resolved.runtime.workspaceId}::uuid
      AND state = 'pending'
    ORDER BY delivered_at ASC, decision_id ASC
    LIMIT ${limit}
  `;
  const result = { status: 'ready' as const, reason: null, ...empty, examined: candidates.length };
  for (const candidate of candidates) {
    try {
      const outcome = await projectPaymentProjectionCandidate(candidate, resolved.runtime);
      result[outcome] += 1;
    } catch (error) {
      result.failed += 1;
      logger.error({
        event: 'orchestration.payment_link.projection_reconcile_failed',
        outbound_id: candidate.outbound_message_id,
        error: String(error),
      });
    }
  }
  return result;
}
