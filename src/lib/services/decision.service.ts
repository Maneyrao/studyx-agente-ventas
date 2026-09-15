import type { ConversationChannel } from '@/lib/contracts/channel';
import { withSerializableTransaction } from '@/lib/db/transaction';
import { sql } from '@/lib/db/orchestrator';
import { jsonbParam } from '@/lib/db/json';
import { logger } from '@/lib/observability/structured-log';
import { counter } from '@/lib/observability/counters';
import { getPostgresError, type DbClient } from '@/lib/db/types';
import { sha256Hex } from '@/lib/idempotency/canonical-json';
import { physicalOutboundTexts } from '@/features/orchestration/domain/physical-outbound-texts';
import { isExplicitOptOut } from '@/lib/heuristics/opt-out';
import { splitFullName } from '@/lib/heuristics/contact-identity';
import { registerMessage, type Message } from './message.service';
import { enqueueLeadProjection, upsertCommittedLeadStateProjection } from './projection.service';
import { loadContactIntakeV1 } from '@/lib/repositories/contact-intake.repository';
import {
  paymentReportProjectionPayloadV1,
  shouldProjectPaymentReportV1,
  type PaymentReportProjectionSubjectV1,
} from '@/features/payments/domain/payment-report-projection';
import { auditLog } from '@/lib/audit/logger';
import {
  loadAgentARolloutConfig,
  loadBusinessWorkspaceConfig,
  loadSheetsProjectionConfig,
  type SheetsProjectionConfig,
} from '@/lib/config';
import { PostgresBusinessContextStore } from '@/features/orchestration/adapters/postgres-business-context';
import { PostgresSalesContextStore } from '@/features/sales/adapters/postgres-sales-context-store';
import { PostgresConversationStateStoreV1 } from '@/features/conversation/adapters/postgres-conversation-state-store';
import {
  resolveTechnicalFallbackV1,
  type TechnicalFallbackV1,
} from '@/features/conversation/domain/technical-fallback';
import { solicitsACall } from '@/features/conversation/domain/operational-promise-guard';
import { PostgresOrchestrationStore } from '@/features/orchestration/adapters/postgres-orchestration-store';
import { enqueueAgentAMemoryProjectionJobs } from '@/features/memory/application/project-agent-a-memories';
import {
  ConversationPlanMismatchError,
  prepareConversationPipelineCommitV1,
} from '@/features/conversation/application/prepare-conversation-pipeline-commit';
import { CanonicalResponseAssemblyError } from '@/features/conversation/domain/canonical-response-assembler';
import {
  canonicalTruthSetFromOfferingsV1,
  enforceCommercialTruthV1,
} from '@/features/orchestration/domain/commercial-truth-guard';
import type { ParsedConversationPipelineCommitV1 } from '@/features/conversation/adapters/conversation-pipeline-schema';
import type { AgentATurnProposalV1 } from '@/features/conversation/domain/agent-a-brain';
import {
  AgentTurnV2RejectedError,
  prepareAgentTurnV2,
} from '@/features/conversation/application/prepare-agent-turn-v2';
import { isSalesPaymentPlan } from '@/features/sales/domain/sales-context';
import {
  assembleMaterializedPaymentResponse,
  materializePaymentLinkAction,
} from '@/features/payments/application/materialize-payment-link-action';
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
  protectedFactsInContentV1,
  verifyAuthorizedEgress,
  type AuthorizedEgressV1,
  type ProtectedFactRef,
} from '@/features/orchestration/domain/egress-guard';
import {
  buildBusinessContextView,
  buildCatalogIndexView,
  type RawOfferingRow,
} from '@/features/orchestration/domain/business-context';
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
import { selectAuthorizedVoiceConsentSourceIndex } from '@/features/calls/domain/call-consent';
import {
  applyAcceptedOutboundStatePatchV3,
  applyLeadProjectionOnAcceptedOutboundV3,
} from '@/features/conversation/application/commit-agent-turn-v3';

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
  /** Meaning and natural composition; backend replans and validates cited facts before using either. */
  conversation_pipeline_v1?: ParsedConversationPipelineCommitV1 | null;
  /** Model-owned conversation turn; backend authorizes facts/actions/state but never replans its copy. */
  agent_turn_v2?: {
    readonly schema_version: 2;
    readonly proposal: AgentATurnProposalV1;
  } | null;
  /** Additive capability negotiation: older Botpress bundles keep one outbound. */
  supports_multi_outbound?: boolean;
  /** New workflow capability: stale model results may yield to a newer inbound batch. */
  supports_turn_supersession?: boolean;
  decision: AnyDecision;
  model: {
    provider: 'botpress' | 'google-ai-direct' | 'groq-direct' | 'openai-direct' | 'deepseek-direct';
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
  /** Physical customer-visible parts. Empty on suppression; one for legacy callers. */
  outbounds: Array<{
    id: string;
    content: string;
    status: 'pending' | 'submitted_to_botpress' | 'failed';
    delivery_attempt: number;
    authorized_egress: AuthorizedEgressV1;
    part_index: number;
    part_count: number;
  }>;
  /**
   * Present exactly when this decision reserved a call. On replay it carries
   * the same call_id the first commit reserved — the workflow can dispatch
   * with it idempotently, and never learns the phone number.
   */
  call_request: ReservedCallRequest | null;
  /** Structured evaluator/observability evidence; never inferred from copy. */
  conversation_effects?: {
    readonly technical_fallback_reason:
      | 'EGRESS_UNAUTHORIZED_PROTECTED_FACT_SUPPRESSED'
      | 'EGRESS_PARTIAL_VETO_TRANSITION_REFUSED';
    readonly human_review_requested: boolean;
    /** Sólo presente en un veto parcial: qué autoridad preparó el turno refusado. */
    readonly partial_veto_refused_authority?: 'agent_turn_v2' | 'conversation_pipeline_v1';
  };
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
  contact_email: string | null;
  contact_summary: string | null;
  lifecycle_status: 'active' | 'blocked' | 'deleted' | null;
  deleted_at: string | null;
  phone: string;
  consent_status: 'unknown' | 'granted' | 'revoked' | null;
  provider: string;
  integration_id: string;
  channel: ConversationChannel;
  batch_id: string | null;
  conversation_seq: number;
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

interface PersistedOutboundPartRow {
  id: string;
  content: string;
  delivery_state: string | null;
  delivery_attempt: number | null;
  authorized_egress: unknown;
  part_index: number;
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

async function loadDecisionOutbounds(
  decision: DecisionRow,
  db: DbClient,
): Promise<CommitDecisionResult['outbounds']> {
  if (!decision.outbound_message_id || !decision.response) return [];
  const rows = await db<PersistedOutboundPartRow[]>`
    SELECT
      message.id,
      message.content,
      delivery.state AS delivery_state,
      delivery.attempt_count AS delivery_attempt,
      message.metadata -> 'authorized_egress' AS authorized_egress,
      part.part_index::integer AS part_index
    FROM agent_decision_outbound_parts AS part
    JOIN messages AS message ON message.id = part.message_id
    LEFT JOIN outbound_deliveries AS delivery ON delivery.message_id = message.id
    WHERE part.decision_id = ${decision.id}::uuid
    ORDER BY part.part_index
  `;
  if (rows.length === 0) {
    const legacyManifest = verifyPersistedEgress(decision.response, decision.authorized_egress);
    return [{
      id: decision.outbound_message_id,
      content: decision.response,
      status: mapDeliveryState(decision.delivery_state),
      delivery_attempt: Number(decision.delivery_attempt ?? 1),
      authorized_egress: legacyManifest,
      part_index: 0,
      part_count: 1,
    }];
  }
  return rows.map((row) => ({
    id: row.id,
    content: row.content,
    status: mapDeliveryState(row.delivery_state),
    delivery_attempt: Number(row.delivery_attempt ?? 1),
    authorized_egress: verifyPersistedEgress(row.content, row.authorized_egress),
    part_index: Number(row.part_index),
    part_count: rows.length,
  }));
}

async function loadTurnPolicy(turnId: string, db: DbClient): Promise<TurnPolicyRow> {
  const rows = await db<TurnPolicyRow[]>`
    SELECT
      m.*,
      c.status AS contact_status,
      c.name AS contact_name,
      c.email AS contact_email,
      c.summary AS contact_summary,
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
    ...(input.conversation_pipeline_v1
      ? { conversation_pipeline_v1: input.conversation_pipeline_v1 }
      : {}),
    ...(input.agent_turn_v2
      ? { agent_turn_v2: input.agent_turn_v2 }
      : {}),
    ...(input.supports_multi_outbound ? { supports_multi_outbound: true } : {}),
    ...(input.supports_turn_supersession ? { supports_turn_supersession: true } : {}),
  };
}

/**
 * Drops URL-bearing sentences and keeps the rest of the prose intact.
 * Used where an answer is authorized but a link is not: the canonical link
 * may share a paragraph with model prose after composition, so sentence removal
 * keeps an answer about the existing link instead of deleting that answer.
 * Removing the complete URL sentence avoids
 * leaving a dangling label or an unauthorized URL for the egress guard.
 */
function proseWithoutUrls(text: string): {
  readonly text: string;
  readonly removed_urls: readonly string[];
} {
  const removed: string[] = [];
  const announcesNewLink = /(?:\bte\s+(?:paso|mando|env[ií]o|comparto|dejo|adjunto)|\b(?:voy|vamos)\s+a\s+(?:enviarte|mandarte|compartirte|pasarte|dejarte)|\b(?:ac[aá]|aqu[ií])\s+(?:ten[eé]s|tienes|est[aá]))[^.!?\n]{0,70}\b(?:link|enlace)\b/iu;
  const kept = text
    .split(/\n{2,}/u)
    .map((paragraph) => paragraph.split(/(?<=[.!?])\s+|\n/u)
      .filter((sentence) => {
        const urls = sentence.match(/https?:\/\/\S+/giu);
        if (urls !== null) removed.push(...urls);
        return urls === null && !announcesNewLink.test(sentence);
      }).join(' ').trim())
    .filter(Boolean);
  return { text: kept.join('\n\n'), removed_urls: removed };
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

async function duplicateDecisionResult(
  existing: DecisionRow,
  input: CommitDecisionInput,
  payloadHash: string,
  callRequest: ReservedCallRequest | null,
  db: DbClient,
): Promise<CommitDecisionResult> {
  if (existing.payload_hash_hex !== payloadHash) throw new DecisionConflictError();
  const outbounds = await loadDecisionOutbounds(existing, db);
  const firstOutbound = outbounds[0] ?? null;
  return {
    status: 'duplicate',
    replayed: true,
    trace_id: input.trace_id,
    turn_id: input.turn_id,
    decision_id: existing.id,
    next_state: existing.next_state,
    outbound: firstOutbound ? {
      id: firstOutbound.id,
      content: firstOutbound.content,
      status: firstOutbound.status,
      delivery_attempt: firstOutbound.delivery_attempt,
      authorized_egress: firstOutbound.authorized_egress,
    } : null,
    outbounds,
    call_request: callRequest,
  };
}

export async function commitAgentDecision(input: CommitDecisionInput): Promise<CommitDecisionResult> {
  if (input.conversation_pipeline_v1 && input.agent_turn_v2) {
    throw new DecisionPolicyError('MULTIPLE_CONVERSATION_AUTHORITIES');
  }
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

  // Set inside the transaction, consumed after it commits: the operator row is
  // a derived projection and must never run inside the canonical write.
  let reportedPaymentContactId: string | null = null;

  const commit = async (): Promise<CommitDecisionResult> => {
  try {
    return await withSerializableTransaction(async (db) => {
      const existing = await loadDecision(validatedInput.turn_id, db);
      if (existing) {
        const replayedCall = await findCallRequestByTurn(db, validatedInput.turn_id);
        return duplicateDecisionResult(existing, validatedInput, payloadHash, replayedCall, db);
      }

    const turn = await loadTurnPolicy(validatedInput.turn_id, db);
    // Capability-gated so legacy callers retain their established concurrency
    // contract. The current Botpress workflow opts in: if a customer sends a
    // new batch while the model is generating, the stale proposal is persisted
    // as suppressed and the newer batch owns the next visible answer.
    if (validatedInput.supports_turn_supersession === true) {
      await db`SELECT id FROM conversations WHERE id = ${turn.conversation_id}::uuid FOR UPDATE`;
      const newerInbound = await db<Array<{ id: string }>>`
        SELECT newer.id
        FROM messages AS newer
        WHERE newer.conversation_id = ${turn.conversation_id}::uuid
          AND newer.direction = 'inbound'
          AND newer.conversation_seq > ${turn.conversation_seq}
          AND newer.batch_id IS DISTINCT FROM ${turn.batch_id}::uuid
        ORDER BY newer.conversation_seq
        LIMIT 1
      `;
      if (newerInbound.length > 0) {
        const suppressed = await db<Array<{ id: string }>>`
          INSERT INTO agent_decisions (
            turn_id, trace_id, schema_version, intent, decision_kind, response,
            response_type, business_action, retrieval_used, memory_candidates,
            missing_information, next_state, reason_code, confidence,
            model_provider, model_name, prompt_version, payload_hash
          ) VALUES (
            ${validatedInput.turn_id}::uuid,
            ${validatedInput.trace_id}::uuid,
            ${decision.schema_version},
            'commercial',
            'suppress',
            NULL,
            NULL,
            NULL,
            ${jsonbParam(db, retrievalUsedOf(decision))},
            ${jsonbParam(db, [])},
            ${[]}::text[],
            'waiting_user',
            'SUPERSEDED_BY_NEWER_INBOUND',
            1,
            ${validatedInput.model.provider},
            ${validatedInput.model.model},
            ${validatedInput.model.prompt_version},
            decode(${payloadHash}, 'hex')
          )
          RETURNING id
        `;
        const suppressedDecisionId = suppressed[0]!.id;
        await auditLog({
          action: 'agent.decision.superseded_by_newer_inbound',
          entity_type: 'agent_decision',
          entity_id: suppressedDecisionId,
          payload: { turn_id: turn.id, newer_turn_id: newerInbound[0]!.id },
          event_key: `decision:${suppressedDecisionId}:superseded`,
          correlation_id: validatedInput.trace_id,
          causation_id: turn.id,
          source_event_id: turn.source_event_id ?? undefined,
        }, db);
        return {
          status: 'committed',
          replayed: false,
          trace_id: validatedInput.trace_id,
          turn_id: validatedInput.turn_id,
          decision_id: suppressedDecisionId,
          next_state: 'waiting_user',
          outbound: null,
          outbounds: [],
          call_request: null,
        };
      }
    }
    const workspaceSlug = loadBusinessWorkspaceConfig().workspaceSlug;
    let preparedPipeline: Awaited<ReturnType<typeof prepareConversationPipelineCommitV1>> | null = null;
    let preparedAgentTurn: Awaited<ReturnType<typeof prepareAgentTurnV2>> | null = null;
    // El contador de fallbacks tiene que sobrevivir a la supresión, y
    // `preparedPipeline` no: la rama de egress lo anula y con él se iría la
    // única lectura del estado de la conversación.
    let pipelineStateBefore: Awaited<
      ReturnType<PostgresConversationStateStoreV1['load']>
    > = null;
    let technicalFallback: TechnicalFallbackV1 | null = null;
    let technicalFallbackReasonCode:
      | 'EGRESS_UNAUTHORIZED_PROTECTED_FACT_SUPPRESSED'
      | 'EGRESS_PARTIAL_VETO_TRANSITION_REFUSED'
      | null = null;
    // Cuál autoridad preparó el turno que un veto parcial refusó —
    // `agent_turn_v2` o `conversation_pipeline_v1`, mutuamente excluyentes.
    // `reason_code` no distingue (columna acotada); esto sí, en
    // `conversation_effects`, que es evidencia estructurada y admite el
    // campo extra sin tocar el esquema de `agent_decisions`.
    let technicalFallbackRefusedAuthority:
      | 'agent_turn_v2'
      | 'conversation_pipeline_v1'
      | null = null;
    if (validatedInput.conversation_pipeline_v1) {
      pipelineStateBefore = await new PostgresConversationStateStoreV1(db).load(
        workspaceSlug, turn.conversation_id, turn.contact_id,
      );
      const businessStore = new PostgresBusinessContextStore(db);
      const [rawBusiness, rawCatalogIndex, workspaceRows] = await Promise.all([
        businessStore.loadBusinessContext(workspaceSlug),
        businessStore.loadCompleteIndex(workspaceSlug),
        db<Array<{ id: string }>>`
          SELECT workspace.id
          FROM workspaces AS workspace
          JOIN workspace_contacts AS membership
            ON membership.workspace_id = workspace.id
           AND membership.contact_id = ${turn.contact_id}::uuid
          WHERE workspace.slug = ${workspaceSlug}
            AND workspace.status = 'active'
          LIMIT 1
        `,
      ]);
      const workspaceId = rawBusiness?.workspace.id ?? workspaceRows[0]?.id;
      if (!workspaceId) throw new DecisionPolicyError('CONVERSATION_PIPELINE_CONTEXT_NOT_FOUND');
      try {
        preparedPipeline = await prepareConversationPipelineCommitV1({
          turn: {
            id: turn.id,
            workspace_id: workspaceId,
            conversation_id: turn.conversation_id,
            contact_id: turn.contact_id,
          },
          workspace_slug: workspaceSlug,
          move: validatedInput.conversation_pipeline_v1.move,
          expected_plan_hash: validatedInput.conversation_pipeline_v1.plan_hash,
          composition: validatedInput.conversation_pipeline_v1.composition,
          business_context: rawBusiness ? buildBusinessContextView(rawBusiness) : null,
          catalog_index: rawCatalogIndex ? buildCatalogIndexView(rawCatalogIndex) : null,
          state_assertions_enabled: loadAgentARolloutConfig().stateAssertions,
        }, {
          state_store: new PostgresConversationStateStoreV1(db),
          call_facts: new PostgresOrchestrationStore(db),
          contact_intake: (contactId) => loadContactIntakeV1(contactId, db),
        });
      } catch (error) {
        if (error instanceof ConversationPlanMismatchError
          || error instanceof CanonicalResponseAssemblyError) {
          throw new DecisionPolicyError(error.code);
        }
        throw error;
      }
      // The brain can propose only literal, current-batch memory candidates.
      // The authoritative planner replaces every commercial field, but these
      // candidates remain attached to the decision so the async projector can
      // revalidate and persist them after commit.
      decision = parseDecisionAnyVersion({
        ...preparedPipeline.decision,
        memory_candidates: validatedInput.decision.memory_candidates,
      });
      assertDecisionBusinessActionPermitted(decision);
    } else if (validatedInput.agent_turn_v2) {
      pipelineStateBefore = await new PostgresConversationStateStoreV1(db).load(
        workspaceSlug, turn.conversation_id, turn.contact_id,
      );
      const businessStore = new PostgresBusinessContextStore(db);
      const [rawBusiness, rawCatalogIndex, workspaceRows] = await Promise.all([
        businessStore.loadBusinessContext(workspaceSlug),
        businessStore.loadCompleteIndex(workspaceSlug),
        db<Array<{ id: string }>>`
          SELECT workspace.id
          FROM workspaces AS workspace
          JOIN workspace_contacts AS membership
            ON membership.workspace_id = workspace.id
           AND membership.contact_id = ${turn.contact_id}::uuid
          WHERE workspace.slug = ${workspaceSlug}
            AND workspace.status = 'active'
          LIMIT 1
        `,
      ]);
      const workspaceId = rawBusiness?.workspace.id ?? workspaceRows[0]?.id;
      if (!workspaceId) throw new DecisionPolicyError('AGENT_TURN_V2_CONTEXT_NOT_FOUND');
      try {
        const currentMessages = turn.batch_id === null
          ? [{ content: turn.content }]
          : await db<Array<{ content: string }>>`
              SELECT content FROM messages
              WHERE batch_id = ${turn.batch_id}::uuid AND direction = 'inbound'
              ORDER BY conversation_seq ASC, created_at ASC, id ASC
            `;
        preparedAgentTurn = await prepareAgentTurnV2({
          turn: {
            id: turn.id,
            workspace_id: workspaceId,
            conversation_id: turn.conversation_id,
            contact_id: turn.contact_id,
          },
          workspace_slug: workspaceSlug,
          proposal: validatedInput.agent_turn_v2.proposal,
          current_customer_messages: currentMessages.map((message) => message.content),
          business_context: rawBusiness ? buildBusinessContextView(rawBusiness) : null,
          catalog_index: rawCatalogIndex ? buildCatalogIndexView(rawCatalogIndex) : null,
        }, {
          state_store: new PostgresConversationStateStoreV1(db),
          call_facts: new PostgresOrchestrationStore(db),
          contact_intake: (contactId) => loadContactIntakeV1(contactId, db),
        });
      } catch (error) {
        if (error instanceof AgentTurnV2RejectedError) {
          throw new DecisionPolicyError(`${error.code}:${error.reasons.join(',')}`);
        }
        throw error;
      }
      decision = parseDecisionAnyVersion(preparedAgentTurn.decision);
      assertDecisionBusinessActionPermitted(decision);
    }
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
    let authorizedProtectedFacts: readonly ProtectedFactRef[] = preparedAgentTurn?.authorized_protected_facts
      ?? preparedPipeline?.authorized_protected_facts
      ?? [];
    let committedBusinessAction = decision.business_action;
    let effectiveAuthorizedOfferingCode = preparedAgentTurn?.authorized_offering_code
      ?? preparedPipeline?.authorized_offering_code
      ?? validatedInput.authorized_offering_code;
    let canonicalOfferings: readonly RawOfferingRow[] | undefined;
    let canonicalWorkspaceId: string | null = null;
    let canonicalSnapshotAttempted = false;
    const salesContextStore = new PostgresSalesContextStore(db);
    const existingSalesContext = await salesContextStore.load(workspaceSlug, turn.contact_id);
    // Agent Turn V2 authorizes against its conversation-state row inside this
    // same transaction. The legacy sales projection may legitimately lag (or
    // predate plannerless V2), so it must not override or erase that durable
    // plan during a later generic “mandame el link” request.
    const authoritativeSelectedPaymentPlan = preparedAgentTurn !== null
      ? pipelineStateBefore?.selected_payment_plan ?? null
      : existingSalesContext?.selected_payment_plan ?? null;
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

    const authorizedPaymentPlan = preparedAgentTurn?.authorized_payment_plan
      ?? preparedPipeline?.authorized_payment_plan
      ?? validatedInput.authorized_payment_plan
      ?? null;
    if (authorizedPaymentPlan !== null) {
      const batchMessages = await loadBatchMessages();
      const currentPaymentIntent = classifyCurrentPaymentIntent(batchMessages);
      const completesRequestedIntake = preparedAgentTurn !== null
        && validatedInput.agent_turn_v2?.proposal.move.move === 'provide_contact_details'
        && pipelineStateBefore?.awaiting_reply === 'contact_details';
      // Agent Turn V2 already authorized the model-owned interpretation against
      // the conversation state reloaded inside this transaction. Reclassifying
      // the same prose here made contextual confirmations such as
      // “Sí, ¿cómo se paga?” lose their durable plan merely because they were
      // phrased as a question. Keep the legacy text-derived check for the older
      // paths; plannerless V2 validates canonical plan identity, not language.
      const backendDerivedPlan = preparedAgentTurn !== null
        ? preparedAgentTurn.authorized_payment_plan
        : preparedPipeline?.plan.selected_payment_plan
          ?? derivePaymentPlanSelectionFromBatch(batchMessages)
          ?? (currentPaymentIntent.kind === 'direct' || currentPaymentIntent.kind === 'resume'
            || completesRequestedIntake
            ? authoritativeSelectedPaymentPlan
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
        selectedPlanCode: authoritativeSelectedPaymentPlan,
        backendAuthorizedPlanCode: preparedAgentTurn?.decision.business_action?.type === 'send_payment_link'
          ? preparedAgentTurn.decision.business_action.plan_code
          : preparedPipeline?.plan.allowed_business_action.type === 'send_payment_link'
          ? preparedPipeline.plan.allowed_business_action.payment_plan
          : null,
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
        // Cross-turn idempotency governs the ACTION, not the answer: no second
        // Stripe URL, no second payment_link_sent signal, no second projection.
        // The question the customer actually asked still deserves the reply
        // written for it, so the authored copy survives with the link removed
        // from it. Replacing it wholesale is what made every follow-up about an
        // existing link receive the same sentence, answering none of them.
        const withoutLink = proseWithoutUrls(materialized.response_text);
        if (preparedAgentTurn && withoutLink.text.length === 0) {
          // The authoritative model route must repair/reject an empty answer;
          // the backend cannot invent commercial wording for its duplicate.
          throw egressPolicyError('COMMERCIAL_TRUTH_VIOLATION');
        }
        // Empty legacy prose reaches the existing technical-degradation
        // boundary below, including its durable counter and telemetry.
        finalResponse = withoutLink.text;
        paymentLinkStrippedUrls = [...materialized.stripped_urls, ...withoutLink.removed_urls];
        committedBusinessAction = null;
      } else if (preparedPipeline || preparedAgentTurn) {
        finalResponse = assembleMaterializedPaymentResponse(materialized);
        paymentLinkStrippedUrls = materialized.stripped_urls;
        authorizedUrls = [materialized.block.url];
        authorizedProtectedFacts = paymentPlanProtectedFacts(action.plan_code);
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

    // Frontera comercial única (A4): verifica VALORES contra el registro
    // canónico y veta ORACIONES.
    //
    // Reemplaza a la materialización canónica, que autorizaba una afirmación
    // sólo si el modelo reproducía textualmente una oración renderizada por el
    // backend. Eso no verificaba verdad sino redacción: una sola palabra
    // natural —«online», «certificado», «3 meses»— convertía el turno entero
    // en el piso técnico. El manifiesto se sigue emitiendo porque el egress y
    // el ADK verifican su hash aguas abajo, pero deja de ser una segunda
    // frontera con criterio propio.
    let egressSuppressed = false;
    if (finalResponse !== null) {
      const offerings = await loadCanonicalOfferings('protected_facts');
      const canonicalTruth = canonicalTruthSetFromOfferingsV1({
        offerings,
        selected_offering_code: effectiveAuthorizedOfferingCode ?? null,
        payment_options: Object.values(PAYMENT_PLAN_PRESENTATIONS).map((plan) => ({
          label: plan.label,
          installments: plan.installments,
          installment_amount: plan.installment_amount,
          total: { currency: plan.currency, amount: plan.total_amount },
        })),
      });
      const inspectCommercialText = (content: string) => enforceCommercialTruthV1({
        content,
        authorized_urls: authorizedUrls,
        canonical: {
          ...canonicalTruth,
          // Un plan de pago ya autorizado por la ruta de cobro es verdad
          // canónica para esta respuesta aunque no sea el precio de lista.
          prices: [
            ...canonicalTruth.prices,
            ...authorizedProtectedFacts
              .filter((fact) => fact.kind === 'price')
              .map((fact) => fact.value),
          ],
          durations: [
            ...canonicalTruth.durations,
            ...authorizedProtectedFacts
              .filter((fact) => fact.kind === 'duration')
              .map((fact) => fact.value),
          ],
        },
      });
      const verdict = inspectCommercialText(finalResponse);

      // La URL sigue fallando cerrado sobre el turno completo: no es una frase
      // que se pueda quitar, es un canal de cobro.
      if (verdict.violations.some((violation) => violation.code === 'UNAUTHORIZED_URL')) {
        throw egressPolicyError('UNAUTHORIZED_URL');
      }
      // Un efecto ya comprometido no puede quedar sin respuesta que lo
      // acompañe: eso rompería la correspondencia entre acción y mensaje.
      if (committedBusinessAction !== null && verdict.content === null) {
        throw egressPolicyError('COMMERCIAL_TRUTH_VIOLATION');
      }

      if (verdict.removed.length > 0) {
        counter.increment('egress_sentences_vetoed', verdict.removed.length);
        logger.warn({
          event: 'orchestration.egress.sentences_vetoed',
          trace_id: validatedInput.trace_id,
          turn_id: turn.id,
          violations: verdict.violations.map((violation) => violation.code),
        });
      }

      // Un veto PARCIAL sobre un turno preparado (`preparedAgentTurn` O
      // `preparedPipeline` — nunca ambos a la vez, son autoridades
      // mutuamente excluyentes) deja sobrevivir texto, pero la `transition`
      // de esa autoridad se calculó sobre AMBAS oraciones — la que sobrevive
      // y la que se acaba de vetar. Ese cálculo describe un mensaje que el
      // cliente nunca recibió completo, y no se recomputa sobre el texto
      // podado: eso sería el backend eligiendo el estado por su cuenta otra
      // vez. Cae por la MISMA puerta que una supresión total —silencio
      // técnico, nunca silencio llano (A7)— con su propio `reason_code` para
      // que la telemetría pueda distinguir un veto parcial de una supresión
      // completa. Ambas autoridades comparten el mismo `reason_code`: la
      // columna no admite un enum por autoridad, así que la distinción vive
      // en `conversation_effects` (barato de agregar), no en `reason_code`.
      // Una transición sólo deja de ser representativa cuando el fragmento
      // vetado contenía el efecto que iba a persistir (una llamada o una
      // acción comercial). Un precio o dato curricular falso no altera un
      // curso canónico ya resuelto ni una invitación a llamada que sobrevivió;
      // degradar todo ese turno a una disculpa técnica escondía precisamente
      // la respuesta comercial segura que el cliente debía recibir.
      // A dedicated offer accepts natural declarative wording ("puedo
      // llamarte"), while narrative solicitation detection is narrower. Check
      // its surviving evidence with the same declared-offer semantics that
      // authorized the transition; otherwise a veto can leave a ghost count.
      const declaredOffer = preparedAgentTurn !== null
        ? validatedInput.agent_turn_v2?.proposal.response.call_offer ?? null : null;
      const declaredOfferLost = declaredOffer !== null && solicitsACall(declaredOffer, true)
        && !solicitsACall(inspectCommercialText(declaredOffer).content ?? '', true);
      const initialOfferLostInformation = declaredOffer !== null
        && preparedAgentTurn?.transition.call_offer_count === 1
        && !preparedAgentTurn.response_messages.slice(0, -1).some((content) => (
          inspectCommercialText(content).content !== null
        ));
      const partialVetoRemovedStatefulEffect = declaredOfferLost || initialOfferLostInformation
        || verdict.removed.some((sentence) => solicitsACall(sentence))
        || committedBusinessAction !== null;
      const partialVetoOnPreparedTurn = (preparedAgentTurn !== null || preparedPipeline !== null)
        && verdict.removed.length > 0
        && verdict.content !== null
        && partialVetoRemovedStatefulEffect;
      const partialVetoRefusedAuthority: 'agent_turn_v2' | 'conversation_pipeline_v1' | null =
        !partialVetoOnPreparedTurn
          ? null
          : preparedAgentTurn !== null ? 'agent_turn_v2' : 'conversation_pipeline_v1';

      if (verdict.content !== null && !partialVetoOnPreparedTurn) {
        finalResponse = verdict.content;
        if (preparedAgentTurn !== null && verdict.removed.length > 0) {
          const retainedParts = preparedAgentTurn.response_messages
            .map((content) => inspectCommercialText(content).content)
            .filter((content): content is string => content !== null && content.trim().length > 0);
          const compact = (content: string) => content.replace(/\s+/gu, ' ').trim();
          // Preserve existing physical boundaries only when individually
          // validated parts contain exactly the surviving whole-turn text.
          if (retainedParts.length > 0 && compact(retainedParts.join(' ')) === compact(finalResponse)) {
            finalResponse = retainedParts.join('\n\n');
            preparedAgentTurn = { ...preparedAgentTurn, response_messages: retainedParts };
          }
        }
      } else {
        counter.increment(
          partialVetoOnPreparedTurn ? 'egress_partial_veto_transition_refused' : 'egress_response_suppressed',
          1,
        );
        logger.warn({
          event: partialVetoOnPreparedTurn
            ? 'orchestration.egress.partial_veto_transition_refused'
            : 'orchestration.egress.response_suppressed',
          trace_id: validatedInput.trace_id,
          turn_id: turn.id,
          reason: verdict.violations[0]?.code ?? 'COMMERCIAL_TRUTH_VIOLATION',
          ...(partialVetoRefusedAuthority ? { refused_authority: partialVetoRefusedAuthority } : {}),
        });
        // A7: el silencio técnico deja de ser un resultado posible. El turno
        // sigue siendo una supresión comercial —ninguna acción, ningún hecho,
        // ninguna proyección— pero el cliente recibe el piso técnico.
        //
        // El silencio deliberado por opt-out o bloqueo no pasa por acá: esos
        // turnos no llegan a componer una respuesta.
        technicalFallback = resolveTechnicalFallbackV1({
          consecutive_technical_fallbacks:
            pipelineStateBefore?.consecutive_technical_fallbacks ?? 0,
          human_review_already_requested:
            pipelineStateBefore?.human_review_requested_at != null,
        });
        decision = parseDecisionAnyVersion({
          ...decision,
          kind: 'reply',
          response: technicalFallback.text,
          response_type: 'clarification',
          business_action: null,
          memory_candidates: [],
          missing_information: [],
          next_state: 'completed',
          reason_code: partialVetoOnPreparedTurn
            ? 'EGRESS_PARTIAL_VETO_TRANSITION_REFUSED'
            : 'EGRESS_UNAUTHORIZED_PROTECTED_FACT_SUPPRESSED',
          confidence: 1,
        });
        technicalFallbackReasonCode = partialVetoOnPreparedTurn
          ? 'EGRESS_PARTIAL_VETO_TRANSITION_REFUSED'
          : 'EGRESS_UNAUTHORIZED_PROTECTED_FACT_SUPPRESSED';
        technicalFallbackRefusedAuthority = partialVetoRefusedAuthority;
        finalResponse = technicalFallback.text;
        authorizedUrls = [];
        authorizedProtectedFacts = [];
        committedBusinessAction = null;
        preparedPipeline = null;
        preparedAgentTurn = null;
        effectiveAuthorizedOfferingCode = null;
        egressSuppressed = true;
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
    if (decision.memory_candidates.length > 0) {
      await enqueueAgentAMemoryProjectionJobs({
        db,
        decision_id: decisionId,
        turn_id: turn.id,
        candidates: decision.memory_candidates,
      });
    }
    let outbound: CommitDecisionResult['outbound'] = null;
    const outbounds: CommitDecisionResult['outbounds'] = [];

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
        const authorizedSourceIndex = preparedPipeline || preparedAgentTurn
          ? selectAuthorizedVoiceConsentSourceIndex({
              mode: decision.business_action.reason,
              texts: consentMessages.map((message) => message.content),
            })
          : -1;
        callRequest = await reserveCallForDecision(db, {
          turn_id: validatedInput.turn_id,
          trace_id: validatedInput.trace_id,
          decision_id: decisionId,
          contact_id: turn.contact_id,
          conversation_id: turn.conversation_id,
          contact_name: turn.contact_name,
          contact_email: turn.contact_email,
          persisted_summary: turn.contact_summary,
          phone: turn.phone,
          consent_messages: consentMessages,
          ...(preparedPipeline || preparedAgentTurn
            ? {
                authorized_conversation_move: {
                  mode: decision.business_action.reason,
                  source_message_id: consentMessages[authorizedSourceIndex]!.id,
                },
              }
            : {}),
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
      const partTexts = physicalOutboundTexts({
        final_response: finalResponse,
        authored_messages: preparedAgentTurn?.response_messages ?? null,
        enabled: validatedInput.supports_multi_outbound === true,
      });
      const purpose = decision.response_type === 'opt_out_ack'
        ? 'consent_confirmation'
        : decision.response_type === 'commercial_reply' || decision.response_type === 'clarification'
          ? 'conversational'
          : 'support';
      const persistedParts: Array<{ message: Message; manifest: AuthorizedEgressV1 }> = [];

      for (const [partIndex, content] of partTexts.entries()) {
        const partManifest = buildAuthorizedEgress({
          content,
          authorized_urls: authorizedUrls.filter((url) => content.includes(url)),
          protected_facts: protectedFactsInContentV1(content),
        });
        let message: Message;
        try {
          ({ message } = await registerMessage({
            conversation_id: turn.conversation_id,
            direction: 'outbound',
            content,
            in_reply_to: turn.id,
            part_index: partIndex,
            metadata: {
              decision_id: decisionId,
              response_type: decision.response_type,
              model: validatedInput.model,
              part_index: partIndex,
              part_count: partTexts.length,
              authorized_egress: partManifest,
            },
          }, {
            db,
            embedding: 'skip',
            audit: {
              event_key: `decision:${decisionId}:message:${partIndex}`,
              correlation_id: validatedInput.trace_id,
              causation_id: turn.id,
              source_event_id: turn.source_event_id ?? undefined,
            },
          }));
        } catch (error) {
          const pg = getPostgresError(error);
          const constraint = pg?.constraint_name ?? pg?.constraint;
          if (pg?.code === '23505' && (
            constraint === 'messages_in_reply_to_unique'
            || constraint === 'messages_in_reply_to_part_unique'
          )) throw new DecisionConflictError();
          throw error;
        }

        await db`
          INSERT INTO agent_decision_outbound_parts (decision_id, part_index, message_id)
          VALUES (${decisionId}::uuid, ${partIndex}, ${message.id}::uuid)
        `;
        persistedParts.push({ message, manifest: partManifest });
      }

      const firstMessage = persistedParts[0]!.message;
      await db`
        UPDATE agent_decisions
        SET outbound_message_id = ${firstMessage.id}::uuid
        WHERE id = ${decisionId}::uuid
      `;

      for (const [partIndex, persisted] of persistedParts.entries()) {
        const { message, manifest } = persisted;
        const outboxPayload = {
          decision_id: decisionId,
          outbound_id: message.id,
          turn_id: turn.id,
          trace_id: validatedInput.trace_id,
          content: message.content,
          response_type: decision.response_type,
          part_index: partIndex,
          part_count: persistedParts.length,
          authorized_egress: manifest,
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
            ${validatedInput.supports_multi_outbound
              ? `outbound:${decisionId}:part:${partIndex}`
              : `outbound:${decisionId}`},
            ${jsonbParam(db, outboxPayload)},
            ${3}
          )
        `;
        const queue = queued[0];
        if (!queue) throw new DecisionPolicyError('OUTBOUND_ENQUEUE_FAILED');
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
        outbounds.push({
          id: message.id,
          content: message.content,
          status: 'pending',
          delivery_attempt: Number(leased[0]?.attempt_count ?? 1),
          authorized_egress: manifest,
          part_index: partIndex,
          part_count: persistedParts.length,
        });
      }

      await db`
        UPDATE contacts
        SET pending_turns = pending_turns + 1
        WHERE id = ${turn.contact_id}::uuid
      `;
      const firstOutbound = outbounds[0]!;
      outbound = {
        id: firstOutbound.id,
        content: firstOutbound.content,
        status: firstOutbound.status,
        delivery_attempt: firstOutbound.delivery_attempt,
        authorized_egress: firstOutbound.authorized_egress,
      };

      if (committedBusinessAction?.type === 'send_payment_link' && canonicalWorkspaceId) {
        const paymentMessage = persistedParts.find(({ message }) => (
          authorizedUrls.some((url) => message.content.includes(url))
        ))?.message ?? firstMessage;
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
            ${paymentMessage.id}::uuid,
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
    if (!egressSuppressed) {
      await salesContextStore.transition({
        workspace_slug: workspaceSlug,
        contact_id: turn.contact_id,
        conversation_id: turn.conversation_id,
        source_turn_id: turn.id,
        selected_offering_code: selectedOfferingCode,
        selected_payment_plan: selectedPlan,
        stage,
      });
    }
    if (technicalFallback) {
      // Turno técnico: no hay nada comercial que escribir, sólo el contador
      // y, en el segundo consecutivo, la derivación. O2: esto ocurre en la
      // misma transacción que el INSERT del outbound, así que si falla, el
      // mensaje se va con ella y nunca se afirma una derivación que no quedó.
      await new PostgresConversationStateStoreV1(db).recordTechnicalFallbackV1({
        workspace_slug: workspaceSlug,
        conversation_id: turn.conversation_id,
        contact_id: turn.contact_id,
        source_turn_id: turn.id,
        consecutive_technical_fallbacks: technicalFallback.next_consecutive_count,
        request_human_review: technicalFallback.requests_human_review,
      });
    }
    if (preparedPipeline) {
      await new PostgresConversationStateStoreV1(db).transition(preparedPipeline.transition);
      if (preparedPipeline.transition.payment_reported) {
        reportedPaymentContactId = turn.contact_id;
      }
    }
    // Un veto PARCIAL sobre CUALQUIERA de las dos autoridades ya cayó por
    // la rama de silencio técnico más arriba y dejó tanto `preparedPipeline`
    // como `preparedAgentTurn` en null — no hay nada que recomputar ni que
    // rechazar acá. Esta escritura sólo ve un turno cuya `transition`
    // describe exactamente el texto que se entregó.
    if (preparedAgentTurn) {
      await new PostgresConversationStateStoreV1(db).transition(preparedAgentTurn.transition);
      if (preparedAgentTurn.transition.payment_reported) {
        reportedPaymentContactId = turn.contact_id;
      }
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
        outbounds,
        call_request: callRequest,
        ...(technicalFallback && technicalFallbackReasonCode ? {
          conversation_effects: {
            technical_fallback_reason: technicalFallbackReasonCode,
            human_review_requested: technicalFallback.requests_human_review,
            ...(technicalFallbackRefusedAuthority
              ? { partial_veto_refused_authority: technicalFallbackRefusedAuthority }
              : {}),
          },
        } : {}),
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
      return duplicateDecisionResult(existing, validatedInput, payloadHash, replayedCall, db);
    });
  }
  };

  const result = await commit();

  // Keep the single operator-facing lead row synchronized with durable
  // commercial progress (course, plan and stage). This is fail-soft and
  // idempotent; Google itself is still reached only by the outbox worker.
  if (result.status === 'committed' && !result.replayed) {
    await upsertCommittedLeadStateProjection({
      messageId: validatedInput.turn_id,
      traceId: validatedInput.trace_id,
    });
  }

  // A reported payment is durable the moment it commits; unlike a link, it
  // needs no physical delivery of our own reply to become true. Best-effort:
  // the scheduled reconciler converges the row if this attempt fails.
  if (result.status === 'committed' && reportedPaymentContactId !== null) {
    try {
      await projectPendingPaymentsForContact(reportedPaymentContactId);
    } catch (error) {
      logger.error({
        event: 'orchestration.payment_report.projection_enqueue_failed',
        trace_id: validatedInput.trace_id,
        contact_id: reportedPaymentContactId,
        error: String(error),
      });
    }
  }

  return result;
}

/**
 * Reconciles every pending payment job of one contact. A reported payment
 * arrives on a different turn from the link, so the link's job is addressed by
 * contact rather than by this turn's outbound message.
 */
async function projectPendingPaymentsForContact(contactId: string): Promise<void> {
  const resolved = await resolvePaymentProjectionRuntime(sql);
  if (resolved.status !== 'ready') return;
  const candidates = await sql<PaymentProjectionCandidate[]>`
    SELECT decision_id, workspace_id, contact_id, outbound_message_id
    FROM payment_projection_jobs
    WHERE contact_id = ${contactId}::uuid
      AND workspace_id = ${resolved.runtime.workspaceId}::uuid
      AND state = 'pending'
    ORDER BY delivered_at ASC, decision_id ASC
    LIMIT 10
  `;
  for (const candidate of candidates) {
    await projectPaymentProjectionCandidate(candidate, resolved.runtime);
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
      await applyAcceptedOutboundStatePatchV3(db, input.outbound_id);
      // P1-C (re-review 2026-09-05): a `prepare_lead_projection` commit is
      // never allowed to reach Sheets before the channel accepts the outbound
      // — this is the gate. See applyLeadProjectionOnAcceptedOutboundV3.
      await applyLeadProjectionOnAcceptedOutboundV3(db, input.outbound_id);

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
    await upsertCommittedLeadStateProjection({
      messageId: input.outbound_id,
      traceId: input.trace_id,
    });
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
  readonly paymentReported: boolean;
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
    payment_reported_at: Date | string | null;
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
      job.trace_id::text AS trace_id,
      (
        SELECT max(state.payment_reported_at)
        FROM conversation_sales_context_states_v1 AS state
        WHERE state.workspace_id = job.workspace_id
          AND state.contact_id = job.contact_id
      ) AS payment_reported_at
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
    paymentReported: row.payment_reported_at !== null,
  };
}

/**
 * Enqueues the operator row for a payment the customer says they made.
 *
 * Delivering a payment link used to be enough to write this row, and that was
 * wrong: a delivered link says a customer was given a way to pay, not that a
 * sale happened, so operators worked rows for people who never paid. The row
 * now needs both halves of the evidence — the six data points that let a human
 * find the person, and the customer's own claim that they paid.
 *
 * The claim is recorded as a claim. Nothing in this path can verify money
 * arrived, so nothing it writes may say so.
 *
 * Runtime configuration and tenant equality have already been validated. A DB
 * enqueue failure throws so the pending job stays visible for the reconciler.
 */
async function enqueuePaymentLinkSentProjection(
  signal: PaymentLinkProjectionSignal,
  runtime: PaymentProjectionRuntime,
  db: DbClient,
): Promise<'repaired' | 'unchanged' | 'skipped'> {
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
  const subject: PaymentReportProjectionSubjectV1 = {
    nombre: identity?.nombre ?? null,
    apellido: identity?.apellido ?? null,
    correo: signal.contactEmail,
    telefono: signal.phone,
    cursoInteres,
    plan: signal.planCode,
    paymentReported: signal.paymentReported,
  };
  // The gate stays closed until both halves exist. The job stays pending
  // rather than being consumed, so the row appears the moment they do.
  if (!shouldProjectPaymentReportV1(subject)) return 'skipped';
  const reported = paymentReportProjectionPayloadV1(subject);
  const projection = await enqueueLeadProjection({
    workspaceId: runtime.workspaceId,
    contactId: signal.contactId,
    spreadsheetId: runtime.sheets.spreadsheetId,
    tabName: runtime.sheets.tabName,
    ...reported,
    fechaPago: '',
    callId: '',
    traceId: signal.traceId,
  }, { sql: db });
  if (!projection) return 'skipped';
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
    if (outcome === 'skipped') return 'skipped';
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
