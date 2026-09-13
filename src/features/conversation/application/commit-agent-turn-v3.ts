import type { AgentTurnDecisionV3 } from '../../../../agent-core/src/ports/model-provider';
import type { AgentTurnIntegrityTraceV3 } from '../../../../agent-core/src/loop';
import {
  parseReleaseManifestV1,
  type ReleaseManifestV1,
} from '../../../../agent-core/src/domain/release-manifest';
import { renderBlocksV3 } from '../../../../agent-core/src/domain/response-blocks';
import {
  splitStatePatchV3,
  type StatePatchFieldsV3,
  type StatePatchV3,
} from '../../../../agent-core/src/domain/state-patch';
import {
  checkAgentTurnIntegrityV3,
  type IntegrityRejectionV1,
  type PreparationToolV3,
} from '../domain/integrity-check-v3';
import { getCourseInformationToolV1 } from './agent-tools-read';
import { missingContactIntakeFieldsV1 } from '../domain/conversation-planner';
import { resolveTechnicalFallbackV1 } from '../domain/technical-fallback';
import { PostgresConversationStateStoreV1 } from '../adapters/postgres-conversation-state-store';
import { PostgresBusinessContextStore } from '@/features/orchestration/adapters/postgres-business-context';
import {
  commercialIntakeFromContactRowV1,
  splitFullName,
} from '@/lib/heuristics/contact-identity';
import { reserveCallForDecision } from '@/features/calls/application/request-call';
import {
  agentALeadProjectionSourceOrder,
  enqueueLeadProjection,
  type LeadProjectionInput,
} from '@/lib/services/projection.service';
import { loadSheetsProjectionConfig } from '@/lib/config';
import {
  PAYMENT_PLAN_CODES,
  PAYMENT_PLAN_PRESENTATIONS,
  isPaymentPlanCode,
  isStripePaymentLinkUrl,
  type SendPaymentLinkAction,
} from '@/features/payments/domain/payment-link';
import {
  buildAuthorizedEgress,
  protectedFactsInContentV1,
} from '@/features/orchestration/domain/egress-guard';
import { jsonbParam } from '@/lib/db/json';
import { sql } from '@/lib/db/orchestrator';
import { withSerializableTransactionOn } from '@/lib/db/transaction';
import type { DbClient } from '@/lib/db/types';
import { sha256Hex } from '@/lib/idempotency/canonical-json';
import { registerMessage } from '@/lib/services/message.service';

interface ExistingDecisionRowV3 {
  readonly id: string;
  readonly outbound_message_id: string | null;
  readonly payload_hash_hex: string;
}

interface TurnContextRowV3 {
  readonly turn_id: string;
  readonly source_order: number;
  readonly conversation_id: string;
  readonly turn_content: string;
  readonly batch_id: string | null;
  readonly contact_id: string;
  readonly workspace_id: string;
  readonly workspace_slug: string;
  readonly provider: string;
  readonly integration_id: string;
  readonly channel: 'whatsapp' | 'voice' | 'telegram';
  readonly destination: string;
  readonly contact_name: string | null;
  readonly contact_email: string | null;
  readonly declared_phone: string | null;
  readonly selected_offering_code: string | null;
  readonly selected_payment_plan: 'monthly_12' | 'monthly_6' | 'one_time' | null;
  readonly stage: StatePatchFieldsV3['stage'];
  readonly call_preference: StatePatchFieldsV3['call_preference'];
  readonly call_offer_status: StatePatchFieldsV3['call_offer_status'];
  readonly call_offer_count: 0 | 1 | 2;
  readonly awaiting_reply: StatePatchFieldsV3['awaiting_reply'];
  readonly payment_reported_at: Date | string | null;
  readonly human_review_requested_at: Date | string | null;
  readonly consecutive_technical_fallbacks: number;
  readonly version: number;
}

interface PreparationRowV3 {
  readonly id: string;
  readonly tool: PreparationToolV3;
  readonly canonical_data: unknown;
}

interface PaymentArtifactV3 {
  readonly label: string;
  readonly url: string;
  readonly offering_code: string;
  readonly payment_plan: 'monthly_12' | 'monthly_6' | 'one_time';
}

interface ContactArtifactV3 {
  readonly values: Readonly<{
    readonly nombre?: string;
    readonly apellido?: string;
    readonly correo?: string;
    readonly telefono?: string;
  }>;
}

interface CallArtifactV3 {
  readonly call_id: string;
  readonly status: 'reserved';
  readonly reason: 'customer_request' | 'accepted_offer';
}

interface RequestCallActionV3 {
  readonly type: 'request_call_now';
  readonly reason: 'direct_request' | 'accepted_offer';
  readonly course_of_interest: string | null;
}

interface MemoryArtifactV3 {
  readonly accepted: ReadonlyArray<{
    readonly id: string;
    readonly text: string;
    readonly type: string;
    readonly supersedes: readonly string[];
  }>;
  readonly supersedes: readonly string[];
}

interface ContactSnapshotV3 {
  readonly name: string | null;
  readonly email: string | null;
  readonly declared_phone: string | null;
  readonly intake: ReturnType<typeof commercialIntakeFromContactRowV1>;
}

const MEMORY_TYPES_V3 = new Set([
  'study_goal', 'study_context', 'preference', 'constraint',
  'objection', 'timeline', 'contact_preference',
]);

const STORED_RESPONSE_TYPES = new Set([
  'social_reply',
  'commercial_reply',
  'clarification',
  'complaint_ack',
  'automation_only',
  'opt_out_ack',
  'out_of_scope',
  'technical_fallback',
  'call_offer',
  'call_confirmation',
]);

export class AgentTurnV3RejectedError extends Error {
  readonly code = 'AGENT_TURN_V3_REJECTED';

  constructor(readonly rejection: IntegrityRejectionV1) {
    super(rejection.violations.map((violation) => violation.code).join(','));
    this.name = 'AgentTurnV3RejectedError';
  }
}

export class AgentTurnV3ConflictError extends Error {
  readonly code = 'AGENT_TURN_V3_CONFLICT';

  constructor() {
    super('The turn already has a different Agent Loop V3 decision');
    this.name = 'AgentTurnV3ConflictError';
  }
}

type FallbackInputV3 =
  | {
      readonly reason: 'AGENT_LOOP_INTEGRITY_FAILED';
      readonly rejection: IntegrityRejectionV1;
      readonly prompt_sha256: string;
      readonly trace: AgentTurnIntegrityTraceV3;
    }
  | {
      readonly reason: 'AGENT_LOOP_BUDGET_EXHAUSTED';
      readonly rejection: null;
      readonly prompt_sha256: string | null;
      readonly trace: AgentTurnIntegrityTraceV3;
    };

type CommitAgentTurnV3BaseInput = {
  readonly turn_id: string;
  readonly trace_id: string;
  readonly release_manifest: ReleaseManifestV1;
};

type CommitAgentTurnV3Input =
  | CommitAgentTurnV3BaseInput & {
      readonly effective_prompt_sha256: string;
      readonly decision: AgentTurnDecisionV3;
      readonly fallback?: never;
    }
  | CommitAgentTurnV3BaseInput & {
      readonly effective_prompt_sha256: string | null;
      readonly decision?: never;
      readonly fallback: FallbackInputV3;
    };

function own(object: object, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, field);
}

function assertFallbackInput(
  fallback: FallbackInputV3,
  effectivePromptSha256: string | null,
): void {
  const rejectionMatchesReason = fallback.reason === 'AGENT_LOOP_INTEGRITY_FAILED'
    ? fallback.rejection !== null
    : fallback.rejection === null;
  const digest = /^[a-f0-9]{64}$/u;
  const hashesAreValid = digest.test(fallback.trace.attempt_hashes.first)
    && (
      fallback.trace.attempt_hashes.second === null
      || digest.test(fallback.trace.attempt_hashes.second)
    );
  const modelRequestPromptSha256s = fallback.trace.model_request_prompt_sha256s;
  const requestHashesAreValid = Array.isArray(modelRequestPromptSha256s)
    && modelRequestPromptSha256s.every((hash) => digest.test(hash));
  const lastRequestPromptSha256 = modelRequestPromptSha256s.at(-1) ?? null;
  const promptMatchesTrace = fallback.prompt_sha256 === lastRequestPromptSha256
    && effectivePromptSha256 === fallback.prompt_sha256;
  const promptMatchesReason = fallback.reason === 'AGENT_LOOP_INTEGRITY_FAILED'
    ? digest.test(fallback.prompt_sha256) && modelRequestPromptSha256s.length > 0
    : fallback.prompt_sha256 === null
      ? modelRequestPromptSha256s.length === 0
      : digest.test(fallback.prompt_sha256) && modelRequestPromptSha256s.length > 0;
  if (
    !rejectionMatchesReason
    || !hashesAreValid
    || !requestHashesAreValid
    || !promptMatchesTrace
    || !promptMatchesReason
  ) {
    throw new Error('AGENT_TURN_V3_INVALID_FALLBACK_TRACE');
  }
}

function paymentArtifact(value: unknown): PaymentArtifactV3 | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.label !== 'string'
    || typeof candidate.url !== 'string'
    || !isStripePaymentLinkUrl(candidate.url)
    || typeof candidate.offering_code !== 'string'
    || !isPaymentPlanCode(candidate.payment_plan)
  ) return null;
  return {
    label: candidate.label,
    url: candidate.url,
    offering_code: candidate.offering_code,
    payment_plan: candidate.payment_plan,
  };
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function contactArtifact(value: unknown): ContactArtifactV3 | null {
  const candidate = objectValue(value);
  const values = objectValue(candidate?.values);
  if (!values) return null;
  const allowed = new Set(['nombre', 'apellido', 'correo', 'telefono']);
  if (
    Object.keys(values).some((field) => !allowed.has(field))
    || Object.values(values).some((field) => typeof field !== 'string' || field.length === 0)
  ) return null;
  return { values: values as ContactArtifactV3['values'] };
}

function callArtifact(value: unknown): CallArtifactV3 | null {
  const candidate = objectValue(value);
  if (
    typeof candidate?.call_id !== 'string'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
      .test(candidate.call_id)
    || candidate.status !== 'reserved'
    || (candidate.reason !== 'customer_request' && candidate.reason !== 'accepted_offer')
  ) return null;
  return candidate as unknown as CallArtifactV3;
}

function memoryArtifact(value: unknown): MemoryArtifactV3 | null {
  const candidate = objectValue(value);
  if (!candidate || !Array.isArray(candidate.accepted) || !Array.isArray(candidate.supersedes)) {
    return null;
  }
  const supersedes = candidate.supersedes;
  if (supersedes.some((id) => typeof id !== 'string')) return null;
  const accepted = candidate.accepted.map(objectValue);
  if (accepted.some((item) => (
    !item
    || typeof item.id !== 'string'
    || typeof item.text !== 'string'
    || item.text.length === 0
    || typeof item.type !== 'string'
    || !MEMORY_TYPES_V3.has(item.type)
    || !Array.isArray(item.supersedes)
    || item.supersedes.some((id) => typeof id !== 'string')
  ))) return null;
  return {
    accepted: accepted as unknown as MemoryArtifactV3['accepted'],
    supersedes: supersedes as string[],
  };
}

function selectedPreparations(
  preparations: readonly PreparationRowV3[],
  committedIds: readonly string[],
): readonly PreparationRowV3[] {
  const committed = new Set(committedIds);
  return preparations.filter((preparation) => committed.has(preparation.id));
}

function projectContactSnapshot(
  context: Pick<TurnContextRowV3, 'destination' | 'declared_phone' | 'contact_name' | 'contact_email'>,
  preparations: readonly PreparationRowV3[],
): ContactSnapshotV3 {
  const current = commercialIntakeFromContactRowV1({
    phone: context.destination,
    declared_phone: context.declared_phone,
    name: context.contact_name,
    email: context.contact_email,
  });
  let nombre = current.nombre;
  let apellido = current.apellido;
  let email = context.contact_email;
  let declaredPhone = context.declared_phone;
  for (const preparation of preparations) {
    if (preparation.tool !== 'prepare_contact_details') continue;
    const artifact = contactArtifact(preparation.canonical_data);
    if (!artifact) throw new Error('PREPARATION_CANONICAL_DATA_INVALID');
    nombre = artifact.values.nombre ?? nombre;
    apellido = artifact.values.apellido ?? apellido;
    email = artifact.values.correo ?? email;
    declaredPhone = artifact.values.telefono ?? declaredPhone;
  }
  const name = nombre
    ? [nombre, apellido].filter((part): part is string => Boolean(part)).join(' ')
    : context.contact_name;
  return {
    name,
    email,
    declared_phone: declaredPhone,
    intake: {
      nombre,
      apellido,
      correo: email,
      telefono: declaredPhone ?? current.telefono,
    },
  };
}

function rejected(
  rejectionId: string,
  code: string,
  subject: string,
  context: {
    readonly factIds: readonly string[];
    readonly preparationIds: readonly string[];
    readonly missing: readonly string[];
  },
): AgentTurnV3RejectedError {
  return new AgentTurnV3RejectedError({
    rejection_id: rejectionId,
    attempt: 1,
    violations: [{ code, subject }],
    authorized_alternatives: {
      fact_ids: [...context.factIds],
      preparations: [...context.preparationIds],
      missing_information: [...context.missing],
    },
  });
}

async function loadExistingDecision(
  db: DbClient,
  turnId: string,
): Promise<ExistingDecisionRowV3 | null> {
  const rows = await db<ExistingDecisionRowV3[]>`
    SELECT id, outbound_message_id, encode(payload_hash, 'hex') AS payload_hash_hex
    FROM agent_decisions
    WHERE turn_id = ${turnId}::uuid
    LIMIT 1
  `;
  return rows[0] ?? null;
}

async function loadTurnContext(db: DbClient, turnId: string): Promise<TurnContextRowV3> {
  const rows = await db<TurnContextRowV3[]>`
    SELECT
      turn.id AS turn_id,
      COALESCE(turn.conversation_seq, 0) AS source_order,
      turn.conversation_id,
      turn.contact_id,
      turn.content AS turn_content,
      turn.batch_id,
      state.workspace_id,
      workspace.slug AS workspace_slug,
      thread.provider,
      thread.integration_id,
      conversation.channel,
      contact.phone AS destination,
      contact.phone,
      contact.name AS contact_name,
      contact.email AS contact_email,
      contact.declared_phone,
      state.selected_offering_code,
      state.selected_payment_plan,
      state.stage,
      state.call_preference,
      state.call_offer_status,
      state.call_offer_count,
      state.awaiting_reply,
      state.payment_reported_at,
      state.human_review_requested_at,
      state.consecutive_technical_fallbacks,
      state.version
    FROM messages AS turn
    JOIN conversations AS conversation ON conversation.id = turn.conversation_id
    JOIN contacts AS contact ON contact.id = turn.contact_id
    JOIN channel_events AS event ON event.id = turn.source_event_id
    JOIN channel_threads AS thread ON thread.id = event.channel_thread_id
    JOIN conversation_sales_context_states_v1 AS state
      ON state.conversation_id = turn.conversation_id
     AND state.contact_id = turn.contact_id
    JOIN workspaces AS workspace ON workspace.id = state.workspace_id
    WHERE turn.id = ${turnId}::uuid
      AND turn.direction = 'inbound'
      AND conversation.status = 'open'
      AND workspace.status = 'active'
    FOR UPDATE OF turn, contact, state
  `;
  if (!rows[0]) throw new Error('AGENT_TURN_V3_CONTEXT_NOT_FOUND');
  return {
    ...rows[0],
    version: Number(rows[0].version),
    source_order: Number(rows[0].source_order),
  };
}

async function loadOpenPreparations(
  db: DbClient,
  context: TurnContextRowV3,
): Promise<readonly PreparationRowV3[]> {
  return db<PreparationRowV3[]>`
    SELECT id, tool, canonical_data
    FROM agent_turn_preparations
    WHERE turn_id = ${context.turn_id}::uuid
      AND conversation_id = ${context.conversation_id}::uuid
      AND committed_at IS NULL
    ORDER BY created_at, id
    FOR UPDATE
  `;
}

async function loadCanonicalFacts(
  db: DbClient,
  workspaceSlug: string,
  decision: AgentTurnDecisionV3,
): Promise<Map<string, string>> {
  const facts = new Map(PAYMENT_PLAN_CODES.map((code) => [
    `fact:payment_plan:${code}`,
    PAYMENT_PLAN_PRESENTATIONS[code].label,
  ]));
  const citedCourseCodes = new Set(decision.blocks.flatMap((block) => {
    if (block.type !== 'fact') return [];
    const match = /^offering:([^:]+):[^:]+:v1$/u.exec(block.fact_id);
    return match?.[1] ? [match[1]] : [];
  }));
  const store = new PostgresBusinessContextStore(db);
  for (const code of citedCourseCodes) {
    const detail = await getCourseInformationToolV1(
      { store, workspaceSlug },
      { code },
    );
    if (!detail.success || !detail.canonical_data) continue;
    for (const fact of detail.canonical_data.facts) {
      facts.set(fact.fact_id, fact.value);
    }
  }
  return facts;
}

function renderableArtifacts(preparations: readonly PreparationRowV3[]): {
  readonly table: Map<string, string>;
  readonly paymentById: ReadonlyMap<string, PaymentArtifactV3>;
} {
  const table = new Map<string, string>();
  const paymentById = new Map<string, PaymentArtifactV3>();
  for (const preparation of preparations) {
    if (preparation.tool !== 'prepare_payment_link') continue;
    const artifact = paymentArtifact(preparation.canonical_data);
    if (!artifact) continue;
    paymentById.set(preparation.id, artifact);
    table.set(preparation.id, `${artifact.label}: ${artifact.url}`);
  }
  return { table, paymentById };
}

function callPolicy(
  context: TurnContextRowV3,
  decision: AgentTurnDecisionV3,
): {
  readonly offer_allowed: boolean;
  readonly offer_required: boolean;
  readonly request_allowed: boolean;
} {
  const offerAllowed = context.call_offer_count < 2
    && context.call_preference === 'unknown'
    && context.call_offer_status !== 'accepted'
    && context.call_offer_status !== 'declined';
  const proposedOffering = decision.state_patch.set.selected_offering_code;
  const selectsNewOffering = proposedOffering !== undefined
    && proposedOffering !== null
    && proposedOffering !== context.selected_offering_code;
  const proposedPreference = decision.state_patch.set.call_preference;
  const proposedStatus = decision.state_patch.set.call_offer_status;
  return {
    offer_allowed: offerAllowed,
    offer_required: selectsNewOffering
      && context.call_offer_count === 0
      && context.call_offer_status === 'not_offered'
      && context.call_preference === 'unknown',
    request_allowed: context.call_preference === 'call'
      || context.call_offer_status === 'accepted'
      || proposedPreference === 'call'
      || proposedStatus === 'accepted',
  };
}

function hasEffectiveFields(patch: StatePatchV3): boolean {
  return Object.entries(patch.set).some(([field, value]) => (
    field !== 'payment_reported' || value === true
  ));
}

async function applyStatePatch(
  db: DbClient,
  context: Pick<
    TurnContextRowV3,
    'workspace_id' | 'conversation_id' | 'contact_id' | 'version'
  > & { readonly consecutive_technical_fallbacks?: number },
  patch: StatePatchV3,
  sourceTurnId: string | null,
  options: { readonly resetTechnicalFallbacks?: boolean } = {},
): Promise<number> {
  if (context.version !== patch.expected_state_version) {
    throw new Error('STATE_VERSION_CONFLICT');
  }
  const resetsTechnicalFallbacks = options.resetTechnicalFallbacks === true
    && (context.consecutive_technical_fallbacks ?? 0) > 0;
  if (!hasEffectiveFields(patch) && !resetsTechnicalFallbacks) return context.version;

  const set = patch.set;
  const hasOffering = own(set, 'selected_offering_code');
  const hasPlan = own(set, 'selected_payment_plan');
  const hasStage = own(set, 'stage');
  const hasPreference = own(set, 'call_preference');
  const hasOfferStatus = own(set, 'call_offer_status');
  const hasOfferDelta = own(set, 'call_offer_delta');
  const hasAwaiting = own(set, 'awaiting_reply');
  const reportsPayment = set.payment_reported === true;
  const rows = await db<Array<{ version: number }>>`
    UPDATE conversation_sales_context_states_v1 AS state
    SET
      selected_offering_code = CASE WHEN ${hasOffering}
        THEN ${set.selected_offering_code ?? null}::text ELSE state.selected_offering_code END,
      selected_payment_plan = CASE WHEN ${hasPlan}
        THEN ${set.selected_payment_plan ?? null}::text ELSE state.selected_payment_plan END,
      stage = CASE WHEN ${hasStage}
        THEN ${set.stage ?? null}::text ELSE state.stage END,
      call_preference = CASE WHEN ${hasPreference}
        THEN ${set.call_preference ?? null}::text ELSE state.call_preference END,
      call_offer_status = CASE WHEN ${hasOfferStatus}
        THEN ${set.call_offer_status ?? null}::text ELSE state.call_offer_status END,
      call_offer_count = CASE WHEN ${hasOfferDelta}
        THEN LEAST(2, state.call_offer_count + ${set.call_offer_delta ?? 0}::smallint)
        ELSE state.call_offer_count END,
      awaiting_reply = CASE WHEN ${hasAwaiting}
        THEN ${set.awaiting_reply ?? null}::text ELSE state.awaiting_reply END,
      payment_reported_at = CASE WHEN ${reportsPayment}
        THEN COALESCE(state.payment_reported_at, now()) ELSE state.payment_reported_at END,
      source_turn_id = CASE WHEN ${sourceTurnId}::uuid IS NULL
        THEN state.source_turn_id ELSE ${sourceTurnId}::uuid END,
      consecutive_technical_fallbacks = CASE WHEN ${resetsTechnicalFallbacks}
        THEN 0 ELSE state.consecutive_technical_fallbacks END,
      version = state.version + 1,
      updated_at = now()
    WHERE state.workspace_id = ${context.workspace_id}::uuid
      AND state.conversation_id = ${context.conversation_id}::uuid
      AND state.contact_id = ${context.contact_id}::uuid
      AND state.version = ${patch.expected_state_version}
    RETURNING state.version
  `;
  const updated = rows[0];
  if (!updated) throw new Error('STATE_VERSION_CONFLICT');

  await db`
    INSERT INTO conversation_sales_context_state_events_v1 (
      workspace_id, conversation_id, contact_id, state_version, source_turn_id,
      selected_offering_code, selected_payment_plan, stage,
      call_preference, call_offer_status, call_offer_count, awaiting_reply,
      payment_reported_at, human_review_requested_at, consecutive_technical_fallbacks
    )
    SELECT
      state.workspace_id, state.conversation_id, state.contact_id, state.version,
      ${sourceTurnId}::uuid,
      state.selected_offering_code, state.selected_payment_plan, state.stage,
      state.call_preference, state.call_offer_status, state.call_offer_count,
      state.awaiting_reply, state.payment_reported_at,
      state.human_review_requested_at, state.consecutive_technical_fallbacks
    FROM conversation_sales_context_states_v1 AS state
    WHERE state.workspace_id = ${context.workspace_id}::uuid
      AND state.conversation_id = ${context.conversation_id}::uuid
      AND state.contact_id = ${context.contact_id}::uuid
    ON CONFLICT DO NOTHING
  `;
  return Number(updated.version);
}

function modelIdentity(manifest: Pick<ReleaseManifestV1, 'model' | 'prompt_version'>): {
  readonly model: string;
  readonly promptVersion: string;
} {
  return {
    model: typeof manifest.model === 'string' && manifest.model.trim()
      ? manifest.model : 'agent-loop-v3',
    promptVersion: typeof manifest.prompt_version === 'string' && manifest.prompt_version.trim()
      ? manifest.prompt_version : 'agent-loop-v3',
  };
}

function decisionProvenance(decision: AgentTurnDecisionV3): {
  readonly used_memory_ids: readonly string[];
  readonly fact_ids: readonly string[];
  readonly preparation_ids: readonly string[];
} {
  return {
    used_memory_ids: [...decision.used_memory_ids],
    fact_ids: decision.blocks.flatMap((block) => (
      block.type === 'fact' ? [block.fact_id] : []
    )),
    preparation_ids: [...decision.commit_preparations],
  };
}

async function runInTransaction<T>(
  db: DbClient,
  operation: (transaction: DbClient) => Promise<T>,
): Promise<T> {
  const candidate = db as DbClient & {
    readonly begin?: unknown;
    readonly savepoint?: unknown;
  };
  if (typeof candidate.begin === 'function') {
    return withSerializableTransactionOn(db as typeof sql, operation);
  }
  if (typeof candidate.savepoint === 'function') return operation(db);
  throw new Error('AGENT_TURN_V3_TRANSACTION_CAPABILITY_REQUIRED');
}

export async function commitAgentTurnV3(
  db: DbClient,
  input: CommitAgentTurnV3Input,
): Promise<{ readonly decision_id: string; readonly outbound_id: string | null }> {
  const releaseManifest = parseReleaseManifestV1(input.release_manifest);
  if (releaseManifest.prompt_sha256 !== input.effective_prompt_sha256) {
    throw new Error('AGENT_TURN_V3_PROMPT_SHA_MISMATCH');
  }
  if (input.decision && input.effective_prompt_sha256 === null) {
    throw new Error('AGENT_TURN_V3_PROMPT_SHA_REQUIRED');
  }
  if (!input.decision) {
    assertFallbackInput(input.fallback, input.effective_prompt_sha256);
  }
  const payloadHash = sha256Hex({
    turn_id: input.turn_id,
    outcome: input.decision
      ? { decision: input.decision }
      : { fallback: input.fallback },
    release_manifest: releaseManifest,
  });

  return runInTransaction(db, async (transaction) => {
    const existing = await loadExistingDecision(transaction, input.turn_id);
    if (existing) {
      if (existing.payload_hash_hex !== payloadHash) throw new AgentTurnV3ConflictError();
      return { decision_id: existing.id, outbound_id: existing.outbound_message_id };
    }

    const context = await loadTurnContext(transaction, input.turn_id);
    if (!input.decision) {
      const fallback = resolveTechnicalFallbackV1({
        consecutive_technical_fallbacks: context.consecutive_technical_fallbacks,
        human_review_already_requested: context.human_review_requested_at !== null,
      });
      await new PostgresConversationStateStoreV1(transaction).recordTechnicalFallbackV1({
        workspace_slug: context.workspace_slug,
        conversation_id: context.conversation_id,
        contact_id: context.contact_id,
        source_turn_id: context.turn_id,
        consecutive_technical_fallbacks: fallback.next_consecutive_count,
        request_human_review: fallback.requests_human_review,
      });
      await transaction`
        INSERT INTO conversation_sales_context_state_events_v1 (
          workspace_id, conversation_id, contact_id, state_version, source_turn_id,
          selected_offering_code, selected_payment_plan, stage,
          call_preference, call_offer_status, call_offer_count, awaiting_reply,
          payment_reported_at, human_review_requested_at, consecutive_technical_fallbacks
        )
        SELECT
          state.workspace_id, state.conversation_id, state.contact_id, state.version,
          ${context.turn_id}::uuid,
          state.selected_offering_code, state.selected_payment_plan, state.stage,
          state.call_preference, state.call_offer_status, state.call_offer_count,
          state.awaiting_reply, state.payment_reported_at,
          state.human_review_requested_at, state.consecutive_technical_fallbacks
        FROM conversation_sales_context_states_v1 AS state
        WHERE state.workspace_id = ${context.workspace_id}::uuid
          AND state.conversation_id = ${context.conversation_id}::uuid
          AND state.contact_id = ${context.contact_id}::uuid
        ON CONFLICT DO NOTHING
      `;

      const model = modelIdentity(releaseManifest);
      const inserted = await transaction<Array<{ id: string }>>`
        INSERT INTO agent_decisions (
          turn_id, trace_id, schema_version, intent, decision_kind, response,
          response_type, business_action, retrieval_used, memory_candidates, used_memory_ids,
          missing_information, next_state, reason_code, confidence,
          model_provider, model_name, prompt_version, payload_hash, release_manifest
        ) VALUES (
          ${input.turn_id}::uuid, ${input.trace_id}::uuid, 4, 'commercial', 'reply',
          ${fallback.text}, 'clarification', NULL, NULL, ${jsonbParam(transaction, [])},
          ARRAY[]::text[], ARRAY[]::text[], 'waiting_user', ${input.fallback.reason}, 1,
          'deepseek-direct', ${model.model}, ${model.promptVersion},
          decode(${payloadHash}, 'hex'), ${jsonbParam(transaction, releaseManifest)}
        )
        RETURNING id
      `;
      const decisionId = inserted[0]?.id;
      if (!decisionId) throw new Error('AGENT_TURN_V3_DECISION_INSERT_FAILED');

      const authorizedEgress = buildAuthorizedEgress({
        content: fallback.text,
        authorized_urls: [],
        protected_facts: [],
      });
      const fallbackTrace = {
        reason: input.fallback.reason,
        rejection: input.fallback.rejection,
        ...input.fallback.trace,
      };
      const { message } = await registerMessage({
        conversation_id: context.conversation_id,
        direction: 'outbound',
        content: fallback.text,
        in_reply_to: input.turn_id,
        metadata: {
          decision_id: decisionId,
          response_type: 'clarification',
          authorized_egress: authorizedEgress,
          release_manifest: releaseManifest,
          agent_loop_fallback: fallbackTrace,
        },
      }, {
        db: transaction,
        embedding: 'skip',
        audit: {
          event_key: `decision:${decisionId}:message`,
          correlation_id: input.trace_id,
          causation_id: input.turn_id,
        },
      });
      await transaction`
        UPDATE agent_decisions
        SET outbound_message_id = ${message.id}::uuid
        WHERE id = ${decisionId}::uuid
      `;

      const outboxPayload = {
        decision_id: decisionId,
        outbound_id: message.id,
        turn_id: input.turn_id,
        trace_id: input.trace_id,
        content: fallback.text,
        response_type: 'clarification',
        authorized_egress: authorizedEgress,
        agent_loop_fallback: fallbackTrace,
      };
      const queued = await transaction<Array<{ delivery_id: string; outbox_id: string }>>`
        SELECT delivery_id, outbox_id
        FROM enqueue_outbound_delivery(
          ${message.id}::uuid,
          ${context.provider},
          ${context.integration_id},
          ${context.channel},
          'conversational',
          ${context.destination},
          ${`outbound:${decisionId}`},
          ${jsonbParam(transaction, outboxPayload)},
          3
        )
      `;
      const queue = queued[0];
      if (!queue) throw new Error('AGENT_TURN_V3_OUTBOX_ENQUEUE_FAILED');
      const leased = await transaction<Array<{ attempt_count: number }>>`
        UPDATE outbound_deliveries
        SET
          state = 'leased',
          leased_by = ${`botpress:${input.trace_id}`},
          lease_until = now() + interval '5 minutes',
          attempt_count = attempt_count + 1,
          deferred_state_patch = NULL
        WHERE id = ${queue.delivery_id}::uuid
          AND state = 'pending'
        RETURNING attempt_count
      `;
      if (Number(leased[0]?.attempt_count) !== 1) {
        throw new Error('AGENT_TURN_V3_DELIVERY_LEASE_FAILED');
      }
      await transaction`
        UPDATE outbox_events
        SET
          state = 'leased',
          leased_by = ${`botpress:${input.trace_id}`},
          lease_until = now() + interval '5 minutes',
          attempt_count = attempt_count + 1
        WHERE id = ${queue.outbox_id}::uuid
          AND state = 'pending'
      `;
      await transaction`
        UPDATE contacts
        SET pending_turns = pending_turns + 1
        WHERE id = ${context.contact_id}::uuid
      `;
      return { decision_id: decisionId, outbound_id: message.id };
    }

    const preparations = await loadOpenPreparations(transaction, context);
    const facts = await loadCanonicalFacts(
      transaction,
      context.workspace_slug,
      input.decision,
    );
    const renderedArtifacts = renderableArtifacts(preparations);
    const committedPreparations = selectedPreparations(
      preparations,
      input.decision.commit_preparations,
    );
    const projectedContact = projectContactSnapshot(context, committedPreparations);
    const missing = missingContactIntakeFieldsV1(projectedContact.intake);
    const preparationTools = Object.fromEntries(
      preparations.map((preparation) => [preparation.id, preparation.tool]),
    );
    const preparationIds = preparations.map((preparation) => preparation.id);
    const integrity = checkAgentTurnIntegrityV3({
      decision: input.decision,
      context: {
        state_version: context.version,
        authorized_fact_ids: [...facts.keys()],
        open_preparations: preparationIds,
        preparation_tools: preparationTools,
        intake_missing: missing,
        call_policy: callPolicy(context, input.decision),
      },
      rejection_id: input.trace_id,
    });
    if (!integrity.ok) throw new AgentTurnV3RejectedError(integrity.rejection);

    const committedCalls = committedPreparations.filter(
      (preparation) => preparation.tool === 'prepare_call_request',
    );
    const committedMemories = committedPreparations.filter(
      (preparation) => preparation.tool === 'prepare_memory',
    );
    const committedLeads = committedPreparations.filter(
      (preparation) => preparation.tool === 'prepare_lead_projection',
    );
    if (committedCalls.length > 1) {
      throw rejected(
        input.trace_id,
        'MULTIPLE_CALL_PREPARATIONS',
        'commit_preparations',
        { factIds: [...facts.keys()], preparationIds, missing },
      );
    }
    for (const preparation of committedCalls) {
      if (!callArtifact(preparation.canonical_data)) {
        throw new Error('PREPARATION_CANONICAL_DATA_INVALID');
      }
    }
    for (const preparation of committedMemories) {
      if (!memoryArtifact(preparation.canonical_data)) {
        throw new Error('PREPARATION_CANONICAL_DATA_INVALID');
      }
    }
    // Fail closed on every `supersedes` target before any write happens: a
    // successor may only reference (a) a memory that is ALREADY durable,
    // contact-authorized, AND originating from a conversation durably linked
    // to THIS SAME workspace (P1-A, 2026-09-05 — contacts are global, so
    // contact scoping alone cannot stop a workspace-B conversation from
    // superseding a workspace-A memory of the same contact), or (b) a
    // predecessor preparation that is part of THIS SAME commit (a closed
    // dependency materialized atomically by the worker). Anything else —
    // most importantly a reservation from a turn that never committed it, or
    // a memory that originated in a different workspace — must reject the
    // whole commit, never silently defer the failure to the async worker
    // (`MEMORY_PROJECTION_STORE_FAILED`).
    const committedMemoryArtifacts = committedMemories.map(
      (preparation) => memoryArtifact(preparation.canonical_data)!,
    );
    const intraCommitMemoryIds = new Set(
      committedMemoryArtifacts.flatMap(
        (artifact) => artifact.accepted.map((candidate) => candidate.id),
      ),
    );
    const durableSupersedes = [...new Set(
      committedMemoryArtifacts.flatMap(
        (artifact) => artifact.accepted.flatMap((candidate) => candidate.supersedes),
      ),
    )].filter((id) => !intraCommitMemoryIds.has(id));
    if (durableSupersedes.length > 0) {
      const authorizedDurable = await transaction<Array<{ id: string }>>`
        SELECT memory.id::text AS id
        FROM selected_memories AS memory
        JOIN conversation_sales_context_states_v1 AS origin
          ON origin.conversation_id = memory.conversation_id
         AND origin.contact_id = memory.contact_id
        WHERE memory.contact_id = ${context.contact_id}::uuid
          AND memory.id = ANY(${durableSupersedes}::uuid[])
          AND memory.status IN ('accepted', 'active')
          AND origin.workspace_id = ${context.workspace_id}::uuid
        FOR UPDATE OF memory
      `;
      if (authorizedDurable.length !== durableSupersedes.length) {
        throw rejected(
          input.trace_id,
          'MEMORY_SUPERSEDES_NOT_COMMITTABLE',
          'commit_preparations',
          { factIds: [...facts.keys()], preparationIds, missing },
        );
      }
      // Spec §3.10: deactivate the predecessor INSIDE this decision
      // transaction so a read immediately after commit can never recall it —
      // `search_selected_memories` only reads `status = 'active'`. This
      // cannot use `status = 'superseded'` yet: that status requires
      // `superseded_by_memory_id` to already be set (checked by
      // `selected_memories_superseded_shape_check`), and the successor's row
      // does not exist yet — its FK cannot be satisfied from here. It also
      // must not reuse an early `valid_until` or roll `embedding_state` back
      // to `pending`: both would race the TTL sweep
      // (`expire_selected_memories`) or the embedding worker, which act on
      // any `status = 'active'` row and would silently undo this
      // deactivation. `pending_supersession` (20260905000007) is invisible to
      // all three and to `search_selected_memories`; the worker flips it to
      // the real `superseded` terminal state once the successor is durable.
      // `resolved_at` stays NULL here: `selected_memories_resolved_shape_check`
      // requires it set only for the true terminal statuses
      // ('rejected'/'superseded'/'expired'), which `pending_supersession`
      // deliberately is not yet. The worker's final flip to `superseded`
      // sets it.
      await transaction`
        UPDATE selected_memories
        SET status = 'pending_supersession',
            embedding = NULL,
            embedding_state = 'skip',
            embedding_updated_at = now()
        WHERE id = ANY(${durableSupersedes}::uuid[])
          AND status IN ('accepted', 'active')
      `;
    }
    for (const preparation of committedLeads) {
      const canonical = objectValue(preparation.canonical_data);
      if (canonical?.queued !== false) throw new Error('PREPARATION_CANONICAL_DATA_INVALID');
    }

    const committedPayment = input.decision.commit_preparations
      .map((id) => renderedArtifacts.paymentById.get(id) ?? null)
      .filter((artifact): artifact is PaymentArtifactV3 => artifact !== null);
    if (committedPayment.length > 1) {
      throw rejected(
        input.trace_id,
        'MULTIPLE_PAYMENT_PREPARATIONS',
        'commit_preparations',
        { factIds: [...facts.keys()], preparationIds, missing },
      );
    }

    if (!STORED_RESPONSE_TYPES.has(input.decision.response_type)) {
      throw rejected(input.trace_id, 'RESPONSE_TYPE_NOT_AUTHORIZED', 'response_type', {
        factIds: [...facts.keys()], preparationIds, missing,
      });
    }
    const rendered = renderBlocksV3(input.decision.blocks, {
      facts,
      artifacts: renderedArtifacts.table,
    });
    if (rendered.missing.length > 0) {
      throw rejected(input.trace_id, 'UNRESOLVED_REFERENCE', rendered.missing[0]!, {
        factIds: [...facts.keys()], preparationIds, missing,
      });
    }
    if (!rendered.text.trim()) {
      throw rejected(input.trace_id, 'EMPTY_RESPONSE', 'blocks', {
        factIds: [...facts.keys()], preparationIds, missing,
      });
    }

    const committedIds = input.decision.commit_preparations;
    if (committedIds.length > 0) {
      const committed = await transaction<Array<{ id: string }>>`
        UPDATE agent_turn_preparations
        SET committed_at = now()
        WHERE turn_id = ${context.turn_id}::uuid
          AND conversation_id = ${context.conversation_id}::uuid
          AND id = ANY(${committedIds}::uuid[])
          AND committed_at IS NULL
        RETURNING id
      `;
      if (committed.length !== new Set(committedIds).size) {
        throw new Error('PREPARATION_COMMIT_CONFLICT');
      }
    }

    const { immediate, deferred } = splitStatePatchV3(input.decision.state_patch);
    const versionAfterImmediate = await applyStatePatch(
      transaction,
      context,
      immediate,
      context.turn_id,
      { resetTechnicalFallbacks: true },
    );
    const storedDeferred: StatePatchV3 = {
      expected_state_version: versionAfterImmediate,
      set: deferred.set,
    };

    const committedCallArtifact = committedCalls[0]
      ? callArtifact(committedCalls[0].canonical_data)
      : null;
    const businessAction: SendPaymentLinkAction | RequestCallActionV3 | null = committedCallArtifact
      ? {
          type: 'request_call_now',
          reason: committedCallArtifact.reason === 'accepted_offer'
            ? 'accepted_offer' : 'direct_request',
          course_of_interest: input.decision.state_patch.set.selected_offering_code
            ?? context.selected_offering_code,
        }
      : committedPayment[0] ? {
          type: 'send_payment_link',
          plan_code: committedPayment[0].payment_plan,
          offering_sku: committedPayment[0].offering_code,
        }
      : null;
    const model = modelIdentity(releaseManifest);
    const inserted = await transaction<Array<{ id: string }>>`
      INSERT INTO agent_decisions (
        turn_id, trace_id, schema_version, intent, decision_kind, response,
        response_type, business_action, retrieval_used, memory_candidates, used_memory_ids,
        missing_information, next_state, reason_code, confidence,
        model_provider, model_name, prompt_version, payload_hash, release_manifest
      ) VALUES (
        ${input.turn_id}::uuid, ${input.trace_id}::uuid, 4, 'commercial', 'reply',
        ${rendered.text}, ${input.decision.response_type},
        ${jsonbParam(transaction, businessAction)}, NULL, ${jsonbParam(transaction, [])},
        ${input.decision.used_memory_ids}, ARRAY[]::text[],
        'waiting_user', 'AGENT_LOOP_V3_ACCEPTED', 1,
        'deepseek-direct', ${model.model}, ${model.promptVersion},
        decode(${payloadHash}, 'hex'), ${jsonbParam(transaction, releaseManifest)}
      )
      RETURNING id
    `;
    const decisionId = inserted[0]?.id;
    if (!decisionId) throw new Error('AGENT_TURN_V3_DECISION_INSERT_FAILED');

    if (committedPreparations.some(
      (preparation) => preparation.tool === 'prepare_contact_details',
    )) {
      await transaction`
        UPDATE contacts
        SET
          name = ${projectedContact.name},
          email = ${projectedContact.email},
          declared_phone = ${projectedContact.declared_phone},
          updated_at = now()
        WHERE id = ${context.contact_id}::uuid
      `;
    }

    let committedCallId: string | null = null;
    const committedCall = committedCalls[0];
    if (committedCall) {
      const artifact = callArtifact(committedCall.canonical_data)!;
      const consentMessages = context.batch_id === null
        ? [{ id: context.turn_id, content: context.turn_content }]
        : await transaction<Array<{ id: string; content: string }>>`
            SELECT id, content
            FROM messages
            WHERE batch_id = ${context.batch_id}::uuid
              AND direction = 'inbound'
              AND conversation_id = ${context.conversation_id}::uuid
              AND contact_id = ${context.contact_id}::uuid
            ORDER BY conversation_seq NULLS LAST, created_at, id
          `;
      const reserved = await reserveCallForDecision(transaction, {
        turn_id: context.turn_id,
        trace_id: input.trace_id,
        decision_id: decisionId,
        contact_id: context.contact_id,
        conversation_id: context.conversation_id,
        contact_name: projectedContact.name,
        contact_email: projectedContact.email,
        phone: projectedContact.declared_phone ?? context.destination,
        consent_messages: consentMessages,
        course_of_interest: input.decision.state_patch.set.selected_offering_code
          ?? context.selected_offering_code,
        prompt_version: model.promptVersion,
        reserved_call_id: artifact.call_id,
        expected_consent_mode: artifact.reason === 'accepted_offer'
          ? 'accepted_offer' : 'direct_request',
      });
      committedCallId = reserved.call_id;
    }

    let memoryCandidateIndex = 0;
    for (const preparation of committedMemories) {
      const artifact = memoryArtifact(preparation.canonical_data)!;
      for (const candidate of artifact.accepted) {
        const candidateIndex = memoryCandidateIndex;
        memoryCandidateIndex += 1;
        if (candidateIndex >= 20) throw new Error('TOO_MANY_MEMORY_PREPARATIONS');
        const memoryKey = `agent_loop_${candidate.type}`;
        const durableCandidate = {
          id: candidate.id,
          text: candidate.text,
          type: candidate.type,
          supersedes: candidate.supersedes,
          key: memoryKey,
          value: candidate.text,
          source_quote: candidate.text,
          confidence: 1,
        };
        await transaction`
          INSERT INTO agent_a_memory_projection_jobs (
            decision_id, candidate_index, turn_id, idempotency_key, candidate
          ) VALUES (
            ${decisionId}::uuid,
            ${candidateIndex},
            ${context.turn_id}::uuid,
            ${`agent-a-memory:${context.turn_id}:${candidate.type}:candidate_${candidateIndex}`},
            ${jsonbParam(transaction, durableCandidate)}
          )
          ON CONFLICT DO NOTHING
        `;
      }
    }

    // P1-C (re-review 2026-09-05): `enqueueLeadProjection` used to run right
    // here, INSIDE the canonical transaction, leaving `sheet_projection_rows`
    // in `pending` — immediately claimable by `flushSheetProjections` — while
    // the outbound below could still be `leased` or never delivered at all.
    // That violated this module's own contract (`projection.service.ts`:
    // "always after channel delivery is confirmed, never inside the canonical
    // transaction") and the operating contract
    // (docs/contracts/agent-a-operational-mvp.md §61/§85/§111).
    //
    // Fix: only the INPUT is captured here (pure, no DB write). It is stored
    // on `outbound_deliveries.deferred_lead_projection` alongside
    // `deferred_state_patch` below (same deferred-until-accepted-delivery
    // column pattern, 20260905000002) and only turned into a claimable
    // `sheet_projection_rows` row by
    // `applyLeadProjectionOnAcceptedOutboundV3`, invoked from the same
    // `recordDeliveryReport` `submitted_to_botpress` branch that already
    // applies the deferred state patch and marks the payment projection job
    // delivered (decision.service.ts) — the existing "gate on delivery"
    // mechanism, not a new parallel scheduler.
    let pendingLeadProjection: LeadProjectionInput | null = null;
    const names = projectedContact.name ? splitFullName(projectedContact.name) : null;
    const selectedCourse = input.decision.state_patch.set.selected_offering_code
      ?? context.selected_offering_code;
    if (
      names?.nombre?.trim()
      && names.apellido?.trim()
      && projectedContact.email?.trim()
      && selectedCourse?.trim()
    ) {
      const sheets = loadSheetsProjectionConfig();
      if (sheets) {
        pendingLeadProjection = {
          workspaceId: context.workspace_id,
          contactId: context.contact_id,
          spreadsheetId: sheets.spreadsheetId,
          tabName: sheets.tabName,
          sourceOrder: agentALeadProjectionSourceOrder(context.source_order),
          sourceKey: `agent-a-turn:${context.turn_id}`,
          telefono: projectedContact.declared_phone ?? context.destination,
          nombre: names.nombre,
          apellido: names.apellido,
          email: projectedContact.email,
          etapaComercial: input.decision.state_patch.set.stage ?? context.stage,
          cursoInteres: selectedCourse,
          plan: input.decision.state_patch.set.selected_payment_plan
            ?? context.selected_payment_plan ?? undefined,
          callId: committedCallId ?? undefined,
          ultimaSenal: 'agent_loop_lead_committed',
          traceId: input.trace_id,
        };
      }
    }

    const authorizedUrls = committedPayment.map((artifact) => artifact.url);
    const authorizedEgress = buildAuthorizedEgress({
      content: rendered.text,
      authorized_urls: authorizedUrls,
      protected_facts: protectedFactsInContentV1(rendered.text),
    });
    const provenance = decisionProvenance(input.decision);
    const { message } = await registerMessage({
      conversation_id: context.conversation_id,
      direction: 'outbound',
      content: rendered.text,
      in_reply_to: input.turn_id,
      metadata: {
        decision_id: decisionId,
        response_type: input.decision.response_type,
        authorized_egress: authorizedEgress,
        release_manifest: releaseManifest,
        agent_loop_provenance: provenance,
      },
    }, {
      db: transaction,
      embedding: 'skip',
      audit: {
        event_key: `decision:${decisionId}:message`,
        correlation_id: input.trace_id,
        causation_id: input.turn_id,
      },
    });
    await transaction`
      UPDATE agent_decisions
      SET outbound_message_id = ${message.id}::uuid
      WHERE id = ${decisionId}::uuid
    `;
    const paymentAction = committedPayment[0];
    if (paymentAction) {
      await transaction`
        INSERT INTO workspace_contacts (
          workspace_id, contact_id, lifecycle_status, source_channel
        ) VALUES (
          ${context.workspace_id}::uuid,
          ${context.contact_id}::uuid,
          'active',
          ${context.channel}
        )
        ON CONFLICT (workspace_id, contact_id) DO NOTHING
      `;
      await transaction`
        INSERT INTO payment_projection_jobs (
          decision_id, workspace_id, contact_id, outbound_message_id,
          trace_id, offering_sku, plan_code, decision_created_at
        )
        SELECT
          decision.id,
          ${context.workspace_id}::uuid,
          ${context.contact_id}::uuid,
          ${message.id}::uuid,
          decision.trace_id,
          ${paymentAction.offering_code},
          ${paymentAction.payment_plan},
          decision.created_at
        FROM agent_decisions AS decision
        WHERE decision.id = ${decisionId}::uuid
        ON CONFLICT (decision_id) DO NOTHING
      `;
    }

    const outboxPayload = {
      decision_id: decisionId,
      outbound_id: message.id,
      turn_id: input.turn_id,
      trace_id: input.trace_id,
      content: rendered.text,
      response_type: input.decision.response_type,
      authorized_egress: authorizedEgress,
      agent_loop_provenance: provenance,
    };
    const queued = await transaction<Array<{ delivery_id: string; outbox_id: string }>>`
      SELECT delivery_id, outbox_id
      FROM enqueue_outbound_delivery(
        ${message.id}::uuid,
        ${context.provider},
        ${context.integration_id},
        ${context.channel},
        ${input.decision.response_type === 'opt_out_ack'
          ? 'consent_confirmation' : 'conversational'},
        ${context.destination},
        ${`outbound:${decisionId}`},
        ${jsonbParam(transaction, outboxPayload)},
        3
      )
    `;
    const queue = queued[0];
    if (!queue) throw new Error('AGENT_TURN_V3_OUTBOX_ENQUEUE_FAILED');

    const leased = await transaction<Array<{ attempt_count: number }>>`
      UPDATE outbound_deliveries
      SET
        state = 'leased',
        leased_by = ${`botpress:${input.trace_id}`},
        lease_until = now() + interval '5 minutes',
        attempt_count = attempt_count + 1,
        deferred_state_patch = ${jsonbParam(transaction, storedDeferred)},
        deferred_lead_projection = ${jsonbParam(transaction, pendingLeadProjection)}
      WHERE id = ${queue.delivery_id}::uuid
        AND state = 'pending'
      RETURNING attempt_count
    `;
    if (Number(leased[0]?.attempt_count) !== 1) {
      throw new Error('AGENT_TURN_V3_DELIVERY_LEASE_FAILED');
    }
    await transaction`
      UPDATE outbox_events
      SET
        state = 'leased',
        leased_by = ${`botpress:${input.trace_id}`},
        lease_until = now() + interval '5 minutes',
        attempt_count = attempt_count + 1
      WHERE id = ${queue.outbox_id}::uuid
        AND state = 'pending'
    `;
    await transaction`
      UPDATE contacts
      SET pending_turns = pending_turns + 1
      WHERE id = ${context.contact_id}::uuid
    `;
    return { decision_id: decisionId, outbound_id: message.id };
  });
}

/** Applies visibility-gated state inside the delivery-report transaction. */
export async function applyAcceptedOutboundStatePatchV3(
  db: DbClient,
  outboundId: string,
): Promise<boolean> {
  const rows = await db<Array<{
    workspace_id: string;
    conversation_id: string;
    contact_id: string;
    source_turn_id: string;
    version: number;
    deferred_state_patch: StatePatchV3 | null;
  }>>`
    SELECT
      state.workspace_id,
      state.conversation_id,
      state.contact_id,
      message.in_reply_to AS source_turn_id,
      state.version,
      delivery.deferred_state_patch
    FROM outbound_deliveries AS delivery
    JOIN messages AS message ON message.id = delivery.message_id
    JOIN conversation_sales_context_states_v1 AS state
      ON state.conversation_id = message.conversation_id
     AND state.contact_id = message.contact_id
    WHERE delivery.message_id = ${outboundId}::uuid
      AND delivery.deferred_patch_applied_on IS NULL
    FOR UPDATE OF state
  `;
  const row = rows[0];
  const patch = row?.deferred_state_patch;
  if (!row || !patch || !hasEffectiveFields(patch)) return false;
  await applyStatePatch(db, {
    workspace_id: row.workspace_id,
    conversation_id: row.conversation_id,
    contact_id: row.contact_id,
    version: Number(row.version),
  }, patch, row.source_turn_id);
  await db`
    UPDATE outbound_deliveries
    SET deferred_patch_applied_on = 'accepted'
    WHERE message_id = ${outboundId}::uuid
      AND deferred_patch_applied_on IS NULL
  `;
  return true;
}

/**
 * Materializes the deferred lead projection captured at commit time
 * (`outbound_deliveries.deferred_lead_projection`) into a claimable
 * `sheet_projection_rows` row, once — and only once — the channel has
 * ACCEPTED the outbound message (`submitted_to_botpress`). This is the P1-C
 * fix (re-review 2026-09-05): a lead used to become claimable by
 * `flushSheetProjections` inside the canonical commit transaction, before the
 * customer's message even left this database.
 *
 * Called from the same `recordDeliveryReport` `submitted_to_botpress` branch
 * that already applies `applyAcceptedOutboundStatePatchV3` and marks the
 * payment projection job delivered — the existing "defer until accepted
 * delivery" mechanism, reused here rather than duplicated.
 *
 * `submitted_to_botpress` proves the channel ACCEPTED the message, not that
 * the customer has seen it: it is the strongest proof available for the
 * Telegram sandbox, which emits no delivery receipt. `enqueueLeadProjection`
 * itself is an idempotent upsert keyed by `lead:<workspace>:<contact>`, so a
 * duplicate/replayed report calling this twice is safe — the second call is a
 * no-op because `deferred_lead_projection_applied_on` is already set.
 */
export async function applyLeadProjectionOnAcceptedOutboundV3(
  db: DbClient,
  outboundId: string,
): Promise<boolean> {
  const rows = await db<Array<{
    deferred_lead_projection: LeadProjectionInput | null;
  }>>`
    SELECT deferred_lead_projection
    FROM outbound_deliveries
    WHERE message_id = ${outboundId}::uuid
      AND deferred_lead_projection_applied_on IS NULL
    FOR UPDATE
  `;
  const payload = rows[0]?.deferred_lead_projection;
  if (!payload) return false;

  await enqueueLeadProjection(payload, { sql: db });

  await db`
    UPDATE outbound_deliveries
    SET deferred_lead_projection_applied_on = 'accepted'
    WHERE message_id = ${outboundId}::uuid
      AND deferred_lead_projection_applied_on IS NULL
  `;
  return true;
}
