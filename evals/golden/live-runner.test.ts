import { evaluateNegotiationInvariantsV1, type InvariantStatusV1 } from './negotiation-invariants';
import { negotiationEvidenceV1, negotiationSemanticTurnV1, usesCurrentModelOwnedNegotiationV1 } from './negotiation-evidence';
import type { AgentAContextV1 } from '../../botpress-agent/src/schemas/agent-a-brain';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runWorkflowTurnV1, type WorkflowTurnEvidenceV1 } from '../../tests/helpers/agent-a-workflow-driver';
import { readWorkflowDbEvidenceV1 } from '../../tests/helpers/agent-a-workflow-db-evidence';
import { configuration, secrets } from '../../tests/helpers/botpress-workflow-runtime';
import { openLocalTestDatabase } from '../../tests/helpers/db';
import { AGENT_A_BRAIN_PROMPT_VERSION } from '../../botpress-agent/src/prompts/agent-a-brain-v1';
import {
  STUDYX_AGENT_A_CANONICAL_PROMPT_VERSION,
} from '../../botpress-agent/src/prompts/studyx-agent-a-canonical.generated';
import { AGENT_A_DEEPSEEK_MODEL } from '../../botpress-agent/src/config/agent-a-model';
import { createConfigPaymentLinkResolver } from '../../src/features/payments/adapters/config-payment-link.resolver';
import { postSaleAccessTestConfig } from '../../tests/helpers/post-sale-config';

import {
  evaluateHardRules,
  inferFailureAttribution,
  judgeCaseSemantically,
  primaryAuthorityCitation,
  type GoldenFailureV1,
  type GoldenTurnObservationV1,
} from './judge';
import { absoluteGoldenAcceptanceV1, compareGoldenRunsV1 } from './comparison';
import {
  createGoldenResponsesProviderV1,
  createGoldenOfficialResponsesProviderV1,
  type GoldenProviderReportV1,
  type GoldenResponsesProviderV1,
} from './provider';
import {
  extractAuthorizedContextV1,
  extractBackendRejectionsV1,
  extractContextEvidenceV1,
  extractFinalBackendDecisionErrorV1,
  extractCommittedProposalV1,
  extractCommittedCallIdV1,
  proposalEvidenceV1,
  quotedCurrentPriceEvidenceV1,
  appendEarlyCallOfferEvidenceV1,
  deliveryAcknowledgementTargetsV1,
  extractFinalDeterministicRuleOutcomeV1,
  extractModelAttemptsV1,
  normalizePromotionStatusV1,
  reportTurnTotalsV1,
  reportTurnLabelV1,
  noVerdictReasonV1,
} from './runner-support';
import { settleGoldenCallOutcomeV1 } from './call-settlement';
import { GOLDEN_BASE_SHA, GOLDEN_CASES, type GoldenCaseV1 } from './scenarios';
import { selectGoldenCasesV1 } from './run-config.mjs';
import { COURSE_PROGRAM_ASSETS_V1 } from '../../src/shared/catalog/course-programs';
import { OWNER_GOLDEN_CASES, OWNER_PROMOTION_MODE_REPLAY_CASES, OWNER_REPLAY_CASES } from './owner-rules-scenarios';

const live = process.env.STUDYX_GOLDEN_LIVE === 'true' ? describe : describe.skip;
const databaseUrl = process.env.TEST_DATABASE_URL ?? '';
const apiBaseUrl = process.env.STUDYX_EVAL_API_BASE_URL ?? '';
const model = process.env.STUDYX_GOLDEN_DEEPSEEK_MODEL ?? 'deepseek-v4-flash';
const providerName = process.env.STUDYX_GOLDEN_PROVIDER ?? 'deepseek';
const providerBaseUrl = process.env.STUDYX_GOLDEN_PROVIDER_BASE_URL ?? 'https://api.deepseek.com';
const providerModel = process.env.STUDYX_GOLDEN_PROVIDER_MODEL ?? model;
const judgeModel = process.env.STUDYX_GOLDEN_JUDGE_MODEL ?? 'deepseek-v4-flash';
const selectedCases = process.env.STUDYX_GOLDEN_CASE_IDS === undefined ? GOLDEN_CASES
  : selectGoldenCasesV1(process.env.STUDYX_GOLDEN_CASE_IDS, [...GOLDEN_CASES, ...OWNER_GOLDEN_CASES, ...OWNER_REPLAY_CASES, ...OWNER_PROMOTION_MODE_REPLAY_CASES]);
const isFullSuite = selectedCases.length === GOLDEN_CASES.length
  && selectedCases.every(scenario => GOLDEN_CASES.some(original => original.id === scenario.id));
const expectedTurns = selectedCases.reduce((count, scenario) => count + scenario.turns.length, 0);
const resultsDirectory = path.resolve(process.cwd(), 'evals/golden/results');
const reuseObservations = process.env.STUDYX_GOLDEN_REUSE_OBSERVATIONS === 'true';
const evaluatedSha = process.env.STUDYX_GOLDEN_EVALUATED_SHA ?? '';
const resultStem = process.env.STUDYX_GOLDEN_RESULT_STEM ?? 'baseline-v9';

type Sql = ReturnType<typeof openLocalTestDatabase>;
const PROGRAM_CODE_BY_SLUG = new Map([...COURSE_PROGRAM_ASSETS_V1.values()].map(asset => [asset.slug, asset.offering_code]));

interface PromotionEvidenceV1 {
  readonly status: string | null;
  readonly bonusCount: number;
  readonly paidCourse: string | null;
  readonly bonusCourses: readonly string[];
  readonly cycleId?: string | null;
  readonly offerVersion?: number | null;
}

interface TurnResultV1 {
  readonly case_id: string;
  readonly invariant_status?: InvariantStatusV1;
  readonly turn_id: string;
  readonly customer: string;
  readonly approved: boolean | null;
  readonly execution_status: 'executed' | 'not_executed' | 'evaluation_error';
  readonly authority: readonly string[];
  readonly must: readonly string[];
  readonly must_not: readonly string[];
  readonly response_real: string;
  readonly move: string | null;
  readonly proposed_action: Record<string, unknown> | null;
  readonly backend_action: string | null;
  readonly backend_rejections: readonly unknown[];
  readonly state: GoldenTurnObservationV1['state'];
  readonly failures: readonly GoldenFailureV1[];
  readonly failure_layer: ReturnType<typeof inferFailureAttribution>['layer'] | null;
  readonly validator_rejections: ReturnType<typeof inferFailureAttribution>['validatorRejections'];
  readonly judge_format_recovery?: { readonly kind: 'trailing_closing_brace_removed'; readonly raw_response: string };
  readonly model_attempts: GoldenTurnObservationV1['modelAttempts'];
  readonly preconditions: {
    readonly course_bonus: GoldenTurnObservationV1['courseBonus'];
    readonly price_objection_memory: GoldenTurnObservationV1['priceObjectionMemory'];
    readonly may_offer_call: boolean | null;
    readonly workflow: GoldenTurnObservationV1['workflow'];
  };
}

interface CaseResultV1 {
  readonly negotiation_evaluation?: ReturnType<typeof evaluateNegotiationInvariantsV1>;
  readonly case_id: string;
  readonly title: string;
  readonly approved: boolean | null;
  readonly setup_evidence?: unknown;
  readonly turns: readonly TurnResultV1[];
}

interface PendingCaseV1 {
  readonly scenario: GoldenCaseV1;
  readonly observations: GoldenTurnObservationV1[];
  readonly setupEvidence?: unknown;
  readonly executionError?: string;
  readonly executionErrorTurnIndex?: number;
}

interface FulfilledSetupV1 {
  readonly evidence: Record<string, unknown>;
  readonly accessMessage: string;
  readonly modelAttempts: GoldenTurnObservationV1['modelAttempts'];
  readonly backendRejections: readonly unknown[];
}

const pendingCases: PendingCaseV1[] = [];
const completedCases: CaseResultV1[] = [];
let db: Sql;
let nativeFetch: typeof fetch;
let recordDeliveryReportFn: typeof import('@/lib/services/decision.service')['recordDeliveryReport'];
let projectAgentAMemoriesFn: typeof import('@/features/memory/application/project-agent-a-memories')['projectAgentAMemories'];
let runEnrollmentWorkerFn: typeof import('@/features/fulfillment/central-carga/worker')['runEnrollmentWorker'];
let postSaleFns: typeof import('@/features/fulfillment/post-sale/service');
let goldenProvider: GoldenResponsesProviderV1 | null = null;
let baselineV8Cases: Array<{
  readonly case_id: string;
  readonly approved: boolean | null;
  readonly turns: Array<{ readonly turn_id: string; readonly approved: boolean | null }>;
}> = [];
let harnessFingerprint = '';
let harnessFiles: string[] = [];

function errorText(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

function blankObservation(): GoldenTurnObservationV1 {
  return {
    response: '', move: null, secondaryMoves: [], proposedAction: null,
    backendAction: null, backendRejections: [],
    state: { selectedCourse: null, stage: null, awaitingReply: null, plan: null,
      promotion: { status: null, bonusCount: 0, paidCourse: null, bonusCourses: [] } },
    deliveredLinks: [], authorizedFactIds: [], authorizedFacts: [], usedFactIds: [], availableOfferings: [],
    selectedOfferingFacts: [], modelAttempts: [], callRequirements: [],
    profileRequestedFields: [], activeCourses: [], activeCourseNames: [], mayOfferCall: null,
    courseBonus: { enabled: null, maxBonusCourses: null, mayOfferBonus: null, status: null },
    priceObjectionMemory: { present: false, sourceMessageIds: [], priorSourceMessageIds: [] },
    workflow: { commitSucceeded: false, status: null, errorCode: null, finalBackendDecisionError: null },
  };
}

function identity(caseId: string) {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 100_000)}`.slice(-10);
  return {
    conversationId: `golden-${caseId}-${randomUUID()}`,
    userId: `golden-user-${randomUUID()}`,
    phoneE164: `+999${suffix}`,
    providerMode: 'live' as const,
  };
}

/** The workflow itself reports channel acceptance as the delivery receipt
 * (2026-11-02). The harness only fills a gap for a bubble the workflow left
 * `submitted` (for example a stopped turn); it never overwrites a receipt, so
 * the live path is what later turns observe. */
async function acknowledgeDelivery(evidence: WorkflowTurnEvidenceV1): Promise<void> {
  for (const target of deliveryAcknowledgementTargetsV1(evidence.adapterCaptures)) {
    const [current] = await db<Array<{ state: string }>>`
      SELECT state FROM outbound_deliveries WHERE message_id=${target.outboundId}::uuid`;
    if (current?.state !== 'submitted') continue;
    console.warn(`[golden] workflow left outbound ${target.outboundId} submitted; harness acknowledged it`);
    await recordDeliveryReportFn({
      outbound_id: target.outboundId,
      trace_id: evidence.traceId,
      status: 'delivered',
      botpress_message_id: target.providerMessageId,
      replayed: false,
      error_code: null,
      delivery_attempt: 1,
      delivered_at: new Date().toISOString(),
    });
  }
}

async function promotionEvidence(externalConversationId: string): Promise<PromotionEvidenceV1> {
  const rows = await db<Array<{
    id: string; status: string; paid_code: string; created_at: Date; promotion_cycle_id: string | null; offer_version: number | null;
  }>>`
    SELECT offer.id, offer.status, paid.code AS paid_code, offer.created_at, offer.promotion_cycle_id, offer.offer_version
    FROM channel_threads thread
    JOIN conversations conversation ON conversation.channel_thread_id=thread.id
    JOIN promotion_offers offer ON offer.conversation_id=conversation.id
    JOIN offerings paid ON paid.id=offer.paid_offering_id
    WHERE thread.external_conversation_id=${externalConversationId}
    ORDER BY offer.created_at DESC LIMIT 1
  `;
  const offer = rows[0];
  if (!offer) return { status: null, bonusCount: 0, paidCourse: null, bonusCourses: [] };
  const bonuses = await db<Array<{ offering_code_snapshot: string }>>`
    SELECT offering_code_snapshot FROM promotion_offer_bonus_offerings
    WHERE offer_id=${offer.id}::uuid ORDER BY position
  `;
  return {
    status: normalizePromotionStatusV1(offer.status),
    bonusCount: bonuses.length,
    paidCourse: offer.paid_code,
    bonusCourses: bonuses.map((bonus) => bonus.offering_code_snapshot),
    cycleId: offer.promotion_cycle_id,
    offerVersion: offer.offer_version,
  };
}

async function activatedCourseEvidence(externalConversationId: string): Promise<{
  readonly codes: readonly string[];
  readonly names: readonly { readonly code: string; readonly displayName: string }[];
}> {
  const rows = await db<Array<{ code: string; display_name: string }>>`
    WITH target AS (
      SELECT conversation.id, conversation.contact_id
      FROM channel_threads thread JOIN conversations conversation ON conversation.channel_thread_id=thread.id
      WHERE thread.external_conversation_id=${externalConversationId}
      ORDER BY conversation.created_at DESC LIMIT 1
    ), latest_payment AS (
      SELECT payment.* FROM payments payment JOIN target ON target.contact_id=payment.contact_id
      WHERE payment.status='paid' ORDER BY payment.paid_at DESC LIMIT 1
    )
    SELECT offering.code,offering.display_name FROM latest_payment payment
    JOIN offerings offering ON offering.id=payment.offering_id
    JOIN central_enrollments enrollment ON enrollment.payment_id=payment.id
    UNION ALL
    SELECT item.offering_code AS code,snapshot.offering_display_name_snapshot AS display_name FROM latest_payment payment
    JOIN central_bonus_enrollment_items item ON item.payment_id=payment.id
    JOIN payment_bonus_offerings snapshot ON snapshot.payment_id=payment.id
      AND snapshot.offering_code_snapshot=item.offering_code
    ORDER BY code
  `;
  return {
    codes: rows.map((row) => row.code),
    names: rows.map((row) => ({ code: row.code, displayName: row.display_name })),
  };
}

async function priceObjectionMemoryEvidence(
  externalConversationId: string,
  currentTurnId: string | null,
): Promise<NonNullable<GoldenTurnObservationV1['priceObjectionMemory']>> {
  const rows = await db<Array<{ source_message_id: string }>>`
    WITH target AS (
      SELECT conversation.id AS conversation_id,conversation.contact_id
      FROM channel_threads thread
      JOIN conversations conversation ON conversation.channel_thread_id=thread.id
      WHERE thread.external_conversation_id=${externalConversationId}
      ORDER BY conversation.created_at DESC LIMIT 1
    )
    SELECT memory.source_message_id::text AS source_message_id
    FROM target
    JOIN selected_memories memory ON memory.conversation_id=target.conversation_id
      AND memory.contact_id=target.contact_id
    JOIN messages source ON source.id=memory.source_message_id
    WHERE memory.status IN ('active','accepted','superseded')
      AND memory.memory_type='objection' AND memory.memory_key='price_objection'
      AND memory.valid_from<=now() AND (memory.valid_until IS NULL OR memory.valid_until>now())
      AND source.direction='inbound'
    UNION
    SELECT decision.turn_id::text AS source_message_id
    FROM target
    JOIN agent_decisions decision ON true
    JOIN messages source ON source.id=decision.turn_id
      AND source.conversation_id=target.conversation_id AND source.contact_id=target.contact_id
    WHERE source.direction='inbound'
      AND decision.memory_candidates @> '[{"type":"objection","key":"price_objection"}]'::jsonb
    ORDER BY source_message_id
  `;
  const sourceMessageIds = [...new Set(rows.map((row) => row.source_message_id))];
  const priorSourceMessageIds = currentTurnId === null
    ? [...sourceMessageIds]
    : sourceMessageIds.filter((sourceMessageId) => sourceMessageId !== currentTurnId);
  return { present: sourceMessageIds.length > 0, sourceMessageIds, priorSourceMessageIds };
}

async function observeTurn(input: {
  readonly externalConversationId: string;
  readonly evidence: WorkflowTurnEvidenceV1;
  readonly accumulatedCaptures: readonly WorkflowTurnEvidenceV1['adapterCaptures'][number][];
  readonly priorObservations: readonly GoldenTurnObservationV1[];
}): Promise<GoldenTurnObservationV1> {
  const persisted = await readWorkflowDbEvidenceV1({
    databaseUrl,
    externalConversationId: input.externalConversationId,
    adapterCaptures: input.accumulatedCaptures,
  });
  const committedProposal = extractCommittedProposalV1(input.evidence.httpExchanges);
  const proposal = proposalEvidenceV1(committedProposal);
  const context = extractContextEvidenceV1(input.evidence.httpExchanges);
  const generationContext = input.evidence.httpExchanges.filter(e=>e.boundary==='deepseek').map(e=>extractAuthorizedContextV1(e.requestBody)).filter(Boolean).at(-1) as AgentAContextV1|null|undefined;
  const promotion = await promotionEvidence(input.externalConversationId);
  const activeCourseEvidence = await activatedCourseEvidence(input.externalConversationId);
  const decision = persisted.decisions.find((item) => item.turnId === input.evidence.turnId);
  const priceMemory = await priceObjectionMemoryEvidence(input.externalConversationId, input.evidence.turnId);
  const currentPriceEvidence = quotedCurrentPriceEvidenceV1(generationContext as Record<string, unknown> | null, committedProposal);
  const ruleEvent = extractFinalDeterministicRuleOutcomeV1(input.evidence.workflowEvents, input.evidence.httpExchanges);
  const response = input.evidence.authorizedMessages.join('\n');
  return {
    conversationId: input.externalConversationId,
    earlyCallOfferEvidence: appendEarlyCallOfferEvidenceV1({
      prior: input.priorObservations.at(-1)?.earlyCallOfferEvidence ?? [],
      conversationId: input.externalConversationId, turnId: input.evidence.turnId,
      callOffer: proposal.callOffer, response, ruleBReason: ruleEvent?.rule_b_reason,
      committed: input.evidence.commitSucceeded, persistedOfferCount: persisted.state?.callOfferCount ?? 0,
    }),
    ruleBonusBeforeTurn: generationContext?.capabilities.course_bonus?.rule_bonus ?? null,
    negotiationFacts:{currentTurnId:input.evidence.turnId,ladder:generationContext?.capabilities.course_bonus?.ladder,
      priorPriceSourceIds:generationContext?.commercial_state.negotiation?.price_objections.latest_source_turn_ids,
      ...currentPriceEvidence,
      currentPriceObjectionPersisted: input.evidence.turnId !== null && priceMemory.sourceMessageIds.includes(input.evidence.turnId),
      priceOnlyBarrierConfirmed: generationContext?.commercial_state.negotiation?.price_only_barrier.status === 'confirmed'
        || currentPriceEvidence.currentPriceOnlyBarrierQuoted},
    callOffer: proposal.callOffer,
    recordedCallOfferCount: persisted.state?.callOfferCount ?? 0,
    ruleOutcomes: ruleEvent ? { rule_a: ruleEvent.rule_a, rule_b: ruleEvent.rule_b } : null,
    response,
    move: proposal.move,
    secondaryMoves: proposal.secondaryMoves,
    proposedAction: proposal.proposedAction,
    backendAction: decision?.businessActionType ?? null,
    backendRejections: extractBackendRejectionsV1(input.evidence.httpExchanges),
    state: {
      selectedCourse: persisted.state?.selectedOfferingCode ?? null,
      stage: persisted.state?.stage ?? null,
      awaitingReply: persisted.state?.awaitingReply ?? null,
      plan: persisted.state?.selectedPaymentPlan ?? null,
      promotion,
    },
    deliveredLinks: persisted.deliveredLinks,
    programDocuments: input.evidence.documentMessages.map(document => (
      /\/material\/fichas\/([a-z0-9_]+)\.pdf$/u.exec(document.fileUrl)?.[1]
      ?? PROGRAM_CODE_BY_SLUG.get(/\/programas\/([a-z0-9-]+)\.pdf$/u.exec(document.fileUrl)?.[1] ?? '') ?? document.fileUrl)),
    programImages: input.evidence.imageMessages.map(image => /\/material\/imagenes\/([a-z0-9_]+)\.png$/u.exec(image.imageUrl)?.[1] ?? image.imageUrl),
    programDocumentKinds: input.evidence.documentMessages.map(document => (/\/material\/fichas\//u.test(document.fileUrl) ? 'ficha' : 'program')),
    authorizedFactIds: context.authorizedFactIds,
    authorizedFacts: context.authorizedFacts,
    usedFactIds: proposal.usedFactIds,
    availableOfferings: context.availableOfferings,
    selectedOfferingFacts: context.selectedOfferingFacts,
    modelAttempts: extractModelAttemptsV1(input.evidence.httpExchanges),
    callRequirements: context.callRequirements,
    profileRequestedFields: proposal.profileRequestedFields,
    activeCourses: activeCourseEvidence.codes,
    activeCourseNames: activeCourseEvidence.names,
    mayOfferCall: context.mayOfferCall,
    courseBonus: context.courseBonus,
    priceObjectionMemory: priceMemory,
    workflow: {
      commitSucceeded: input.evidence.commitSucceeded,
      status: input.evidence.status,
      errorCode: input.evidence.errorCode,
      finalBackendDecisionError: extractFinalBackendDecisionErrorV1(input.evidence.httpExchanges),
    },
  };
}

async function prepareFulfilledBonusPackage(input: {
  readonly externalConversationId: string;
  readonly setupTurn: WorkflowTurnEvidenceV1;
}): Promise<FulfilledSetupV1> {
  const [identityRow] = await db<Array<{
    workspace_id: string; contact_id: string; conversation_id: string;
  }>>`
    SELECT membership.workspace_id, conversation.contact_id, conversation.id AS conversation_id
    FROM channel_threads thread
    JOIN conversations conversation ON conversation.channel_thread_id=thread.id
    JOIN workspace_contacts membership ON membership.contact_id=conversation.contact_id
    JOIN workspaces workspace ON workspace.id=membership.workspace_id
    WHERE thread.external_conversation_id=${input.externalConversationId}
      AND workspace.slug=${process.env.BUSINESS_WORKSPACE_SLUG ?? 'studyx'}
    ORDER BY conversation.created_at DESC LIMIT 1
  `;
  if (!identityRow || !input.setupTurn.turnId || !input.setupTurn.outboundId) {
    throw new Error('GOLDEN_FULFILLED_SETUP_IDENTITY_MISSING');
  }
  const offerings = await db<Array<{ id: string; code: string; display_name: string }>>`
    SELECT id,code,display_name FROM offerings WHERE workspace_id=${identityRow.workspace_id}::uuid
      AND code=ANY(${db.array(['fotografia_profesional','fotografia_celulares_tiendas_online','marketing_digital'])})
  `;
  const byCode = new Map(offerings.map((offering) => [offering.code, offering]));
  const paid = byCode.get('fotografia_profesional');
  const bonuses = ['fotografia_celulares_tiendas_online','marketing_digital']
    .map((code) => byCode.get(code)).filter((item): item is NonNullable<typeof item> => Boolean(item));
  if (!paid || bonuses.length !== 2) throw new Error('GOLDEN_FULFILLED_SETUP_CATALOG_MISSING');

  // The real workflow creates this binding before a promotion can exist for a
  // legacy Botpress conversation (workspace_id = NULL). Seed the same
  // invariant before inserting the synthetic accepted offer; otherwise the
  // database correctly rejects the fixture as an identity mismatch.
  await db`INSERT INTO conversation_sales_context_states_v1(
      workspace_id,conversation_id,contact_id,selected_offering_code,selected_payment_plan,
      stage,awaiting_reply,source_turn_id)
    VALUES (${identityRow.workspace_id},${identityRow.conversation_id},${identityRow.contact_id},${paid.code},
      'monthly_12','payment_link_sent','none',${input.setupTurn.turnId})
    ON CONFLICT (workspace_id,conversation_id) DO UPDATE SET
      selected_offering_code=EXCLUDED.selected_offering_code,
      selected_payment_plan=EXCLUDED.selected_payment_plan,
      stage=EXCLUDED.stage,awaiting_reply=EXCLUDED.awaiting_reply,
      source_turn_id=EXCLUDED.source_turn_id,updated_at=now()`;

  const promotionCode = `golden-review-${randomUUID()}`;
  const [promotion] = await db<Array<{ id: string }>>`
    INSERT INTO promotions(workspace_id,promotion_code,paid_offering_id,channels,active)
    VALUES (${identityRow.workspace_id},${promotionCode},${paid.id},ARRAY['text']::text[],true) RETURNING id
  `;
  for (const [index, bonus] of bonuses.entries()) {
    await db`INSERT INTO promotion_bonus_offerings(promotion_id,workspace_id,offering_id,position)
      VALUES (${promotion.id},${identityRow.workspace_id},${bonus.id},${index + 1})`;
  }
  const [offer] = await db<Array<{ id: string; promotion_cycle_id: string }>>`
    INSERT INTO promotion_offers(workspace_id,contact_id,conversation_id,promotion_id,paid_offering_id,package_mode,
      source_turn_id,offered_outbound_message_id,offered_at,status,accepted_at,offer_version)
    VALUES (${identityRow.workspace_id},${identityRow.contact_id},${identityRow.conversation_id},${promotion.id},${paid.id},'review',
      ${input.setupTurn.turnId},${input.setupTurn.outboundId},now(),'accepted',now(),1)
    RETURNING id,promotion_cycle_id
  `;
  for (const [index, bonus] of bonuses.entries()) {
    await db`INSERT INTO promotion_offer_bonus_offerings(offer_id,promotion_id,offering_id,promotion_code_snapshot,
      offering_code_snapshot,offering_display_name_snapshot,position)
      VALUES (${offer.id},${promotion.id},${bonus.id},${promotionCode},${bonus.code},${bonus.display_name},${index + 1})`;
  }
  await db`UPDATE promotion_offers SET bonus_snapshot_sealed_at=now() WHERE id=${offer.id}`;

  const paymentKey = randomUUID();
  const [payment] = await db<Array<{ id: string }>>`
    INSERT INTO payments(workspace_id,contact_id,offering_id,amount,currency,status,provider,environment,checkout_mode,
      idempotency_key,provider_session_id,plan_code,registration_email,registration_name,source_conversation_id)
    VALUES (${identityRow.workspace_id},${identityRow.contact_id},${paid.id},360,'USD','reserved','stripe','test','payment',
      ${paymentKey},${`cs_test_${paymentKey}`},'monthly_12','ana.golden@example.test','Ana Golden',${identityRow.conversation_id})
    RETURNING id
  `;
  for (const [index, bonus] of bonuses.entries()) {
    await db`INSERT INTO payment_bonus_offerings(payment_id,promotion_id,offering_id,promotion_code_snapshot,
      offering_code_snapshot,offering_display_name_snapshot,position)
      VALUES (${payment.id},${promotion.id},${bonus.id},${promotionCode},${bonus.code},${bonus.display_name},${index + 1})`;
  }
  await db`UPDATE payments SET bonus_snapshot_sealed_at=now(),status='creating_checkout' WHERE id=${payment.id}`;
  await db`UPDATE payments SET status='pending' WHERE id=${payment.id}`;
  await db`UPDATE payments SET status='paid',paid_at=now() WHERE id=${payment.id}`;
  await db`UPDATE promotion_offers SET status='attached',payment_id=${payment.id} WHERE id=${offer.id}`;
  await db`INSERT INTO fulfillment_jobs(payment_id,workspace_id) VALUES (${payment.id},${identityRow.workspace_id})`;

  const centralFetch = (async (_url: unknown, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body)) as { bonus_offerings?: Array<{ code: string }> };
    return new Response(JSON.stringify({
      payment_id: payment.id,
      enrollment_id: `golden-enrollment-${paymentKey}`,
      student_id: `golden-student-${paymentKey}`,
      enrollment_status: 'active',
      student_was_created: true,
      access: { login_email: 'ana.golden@example.test', welcome_sent: true },
      bonus_enrollments: (request.bonus_offerings ?? []).map((bonus) => ({
        offering_code: bonus.code, enrollment_status: 'active',
      })),
    }), { status: 201, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  const worker = await runEnrollmentWorkerFn({ scoped: true, payment_id: payment.id, limit: 1 }, {
    sql: db,
    fetchImpl: centralFetch,
    config: {
      enabled: true, baseUrl: 'https://central.example.test', signingSecret: 'golden-local-secret',
      environment: 'test', paidAfter: new Date('2026-01-01'), allowSandboxContacts: true,
    },
    bonusConfig: { enabled: true, fulfillmentPaused: false },
  });
  const [notice] = await db<Array<{ id: string }>>`
    SELECT id FROM post_sale_notifications WHERE payment_id=${payment.id} AND kind='access_ready'
  `;
  if (!notice) throw new Error('GOLDEN_FULFILLED_SETUP_NOTICE_MISSING');
  const eventFetch = (async () => new Response(JSON.stringify({ event: { id: `golden-event-${paymentKey}` } }), {
    status: 201, headers: { 'content-type': 'application/json' },
  })) as typeof fetch;
  const notificationDeps = {
    db,
    config: { enabled: true, environment: 'test' as const, paidAfter: new Date('2026-01-01'), accessTemplate: postSaleAccessTestConfig },
    fetchImpl: eventFetch,
  };
  await postSaleFns.dispatchNotifications(payment.id, notificationDeps);
  const claim = await postSaleFns.claimNotification(notice.id, input.externalConversationId, notificationDeps);
  if (!claim.claimed) throw new Error('GOLDEN_FULFILLED_SETUP_CLAIM_FAILED');
  const accessMessages: string[] = [];
  const deliveryDeps = {
    ...notificationDeps,
    sender: async (message: { text: string }) => {
      accessMessages.push(message.text);
      return { outcome: 'sent' as const, channel: 'whatsapp' as const,
        providerMessageId: `golden-access-${paymentKey}`, deliveryId: null, reason: null };
    },
  };
  const backendRejections: unknown[] = [];
  const delivery = await postSaleFns.deliverNotification(notice.id, {
    claim_token: claim.claim_token,
    botpress_conversation_id: input.externalConversationId,
  }, deliveryDeps);
  if (delivery.outcome !== 'sent' || !accessMessages[0]) {
    throw new Error(`GOLDEN_POST_SALE_DELIVERY_FAILED:${delivery.outcome}`);
  }
  return {
    evidence: {
      fixture_kind: 'controlled_local_paid_and_fulfilled_package',
      payment_id: payment.id,
      promotion_offer_id: offer.id,
      paid_course: paid.code,
      bonus_courses: bonuses.map((bonus) => bonus.code),
      worker,
      access_message: accessMessages[0],
      template_delivery: delivery,
    },
    accessMessage: accessMessages[0],
    modelAttempts: [],
    backendRejections,
  };
}

function markdown(cases: readonly CaseResultV1[]): string {
  const escape = (value: unknown) => String(value ?? '').replaceAll('|', '\\|').replaceAll('\n', '<br>');
  const providerReport = goldenProvider?.report() ?? null;
  const comparison = compareGoldenRunsV1({
    baselineLabel: 'baseline-v8', candidateLabel: resultStem,
    baselineProvider: 'deepseek', candidateProvider: providerName,
    baselineCases: baselineV8Cases, candidateCases: cases,
  });
  const lines = [
    `# Agent A golden ${resultStem} — ${evaluatedSha.slice(0, 7)}`, '',
    isFullSuite
      ? `- Criterio absoluto: ${absoluteGoldenAcceptanceV1(cases).approved ? 'APROBADO' : 'NO APROBADO'}; ${absoluteGoldenAcceptanceV1(cases).passed_turns}/48 turnos, mínimo 41 y críticos 07/10/11/12/15 aprobados.`
      : `- Evaluación parcial: ${cases.flatMap(item => item.turns).filter(turn => turn.approved === true).length}/${expectedTurns} turnos aprobados en ${selectedCases.length} casos; no acredita aceptación completa de 48 turnos.`,
    `- SHA evaluado: \`${evaluatedSha}\``,
    `- Origen de la línea de base de autoridad: \`${GOLDEN_BASE_SHA}\``,
    `- Brain: \`${AGENT_A_BRAIN_PROMPT_VERSION}\``,
    `- Prompt canónico: \`${STUDYX_AGENT_A_CANONICAL_PROMPT_VERSION}\``,
    `- Modelo interno del agente: \`${model}\``,
    `- Proveedor/modelo de evaluación: \`${providerName}\` / \`${providerModel}\``,
    `- Modelo del juez: \`${judgeModel}\` (constante en la comparación oficial)`,
    `- Llamadas/intentos al proveedor: ${providerReport?.logical_calls ?? 'no registrado'} / ${providerReport?.attempts ?? 'no registrado'}`,
    `- Tokens: entrada ${providerReport?.tokens?.input ?? 'no informado'}, salida ${providerReport?.tokens?.output ?? 'no informado'}, total ${providerReport?.tokens?.total ?? 'no informado'}`,
    `- Recuperaciones de formato del juez: ${cases.flatMap(item => item.turns).filter(turn => turn.judge_format_recovery).length}; originales y diagnóstico conservados en el JSON por turno.`,
    `- Casos: ${cases.filter((item) => item.approved === true).length} aprobados; ${cases.filter((item) => item.approved === false).length} fallidos; ${cases.filter((item) => item.approved === null).length} con error del evaluador`,
    (() => {
      const totals = reportTurnTotalsV1(cases.flatMap((item) => item.turns));
      return `- Turnos (${totals.total}): ${totals.approved} aprobados; ${totals.failed} fallidos; ${totals.no_verdict} sin veredicto (approved=null, de los cuales ${totals.evaluation_error} con error del evaluador)`;
    })(), '',
    '| Caso/turno | Resultado | Autoridad | Borradores originales y reparaciones | Texto entregado al transporte | Move / acción | Rechazos backend | Hipótesis de capa |',
    '|---|---|---|---|---|---|---|---|',
  ];
  for (const item of cases) for (const turn of item.turns) {
    const result = reportTurnLabelV1(turn);
    const layer = turn.failure_layer === 'validador' && turn.validator_rejections.length > 0
      ? `validador — ${turn.validator_rejections.map((rejection) => `${rejection.code}${rejection.subject ? ` / ${rejection.subject}` : ''}`).join('; ')}`
      : turn.failure_layer ?? '—';
    lines.push(`| ${escape(`${item.case_id}/${turn.turn_id}`)} | ${result} | ${escape(turn.authority.join('; '))} | ${escape(turn.model_attempts.map(attempt => `Intento ${attempt.attempt}: ${attempt.response ?? '(sin texto)'}`).join('\n'))} | ${escape(turn.response_real)} | ${escape(`${turn.move ?? 'null'} / ${JSON.stringify(turn.proposed_action)}`)} | ${escape(JSON.stringify(turn.backend_rejections))} | ${escape(layer)} |`);
  }
  lines.push('', '## Fallos', '');
  for (const item of cases) for (const turn of item.turns.filter((candidate) => candidate.approved !== true)) {
    lines.push(`- **${item.case_id}/${turn.turn_id} — ${turn.failure_layer ?? turn.execution_status}:** ${turn.failures.length === 0 && turn.approved === null ? noVerdictReasonV1(turn) : turn.failures.map((failure) => `${failure.code} [${failure.authorityReference ?? turn.authority[0] ?? 'sin referencia'}]: ${failure.detail}`).join(' | ')}`);
  }
  lines.push('', '## Evidencia de entorno y precondiciones', '');
  for (const item of cases.filter((candidate) => ['06_repeated_price_bonus_ladder', '10_requested_call',
    '11_purchase_to_payment_link', '14_course_change_cancels_promotion'].includes(candidate.case_id))) {
    for (const turn of item.turns) {
      lines.push(`- **${item.case_id}/${turn.turn_id}:** ${escape(JSON.stringify(turn.preconditions))}`);
    }
  }
  lines.push('', '## Comparación con baseline-v8', '',
    `- ${comparison.disclosure}`,
    `- Casos: ${comparison.summary.cases_improved} mejoraron, ${comparison.summary.cases_regressed} retrocedieron, ${comparison.summary.cases_unchanged} sin cambio.`,
    `- Turnos: ${comparison.summary.turns_improved} mejoraron, ${comparison.summary.turns_regressed} retrocedieron, ${comparison.summary.turns_unchanged} sin cambio, ${comparison.summary.turns_missing} faltantes.`, '',
    '| Caso/turno | v8 | Corrida actual | Cambio |',
    '|---|---:|---:|---|');
  for (const turn of comparison.turns) {
    lines.push(`| ${escape(`${turn.case_id}/${turn.turn_id}`)} | ${escape(turn.baseline)} | ${escape(turn.candidate)} | ${turn.change} |`);
  }
  return `${lines.join('\n')}\n`;
}

function baselineReport(cases: readonly CaseResultV1[]) {
  const providerReport: GoldenProviderReportV1 | null = goldenProvider?.report() ?? null;
  return {
    schema_version: 3,
    absolute_acceptance: isFullSuite ? absoluteGoldenAcceptanceV1(cases) : null,
    evaluation_scope: { case_ids: selectedCases.map(scenario => scenario.id), expected_turns: expectedTurns, full_suite: isFullSuite },
    generated_at: new Date().toISOString(),
    base_sha: evaluatedSha,
    authority_baseline_origin_sha: GOLDEN_BASE_SHA,
    execution_harness: 'processInboundTurn',
    environment: 'isolated_local',
    environment_configuration: {
      commercial_planning: configuration.agentACommercialPlanningEnabled === true,
      voice_provider: process.env.VOICE_PROVIDER ?? null,
      payment_provider: process.env.PAYMENT_PROVIDER ?? null,
      payment_link_environment: process.env.PAYMENT_LINK_ENVIRONMENT ?? null,
      payment_links_configured: (['monthly_12', 'monthly_6', 'one_time'] as const)
        .every((plan) => createConfigPaymentLinkResolver(process.env).resolve(plan) !== null),
      course_bonus_flow_mode: process.env.COURSE_BONUS_FLOW_MODE ?? null,
      course_bonus_max_courses: process.env.COURSE_BONUS_MAX_COURSES ?? null,
      provider_transport: {
        protocol: providerName === 'nvidia_nim' ? 'openai_chat_completions' : 'responses_api',
        source_envelope: 'responses_api',
        max_requests_per_minute: providerName === 'nvidia_nim' ? 40 : null,
        max_attempts: providerName === 'nvidia_nim' ? 4 : null,
        retry_base_delay_ms: providerName === 'nvidia_nim' ? 500 : null,
        request_timeouts_ms: { agent: 15_000, judge: 30_000, post_sale: 10_000 },
        reasoning_mapping: providerName === 'nvidia_nim'
          ? 'Responses reasoning effort none is omitted; NVIDIA documents thinking disabled by default for DeepSeek V4.1 Flash.'
          : 'native',
      },
    },
    production_or_vertice_used: false,
    deepseek_model: model,
    actual_agent_model: providerModel,
    judge_model: providerName === 'deepseek' ? judgeModel : providerModel,
    evaluation_provider: {
      name: providerName,
      base_url: providerBaseUrl,
      model: providerModel,
      judge_model: providerName === 'deepseek' ? judgeModel : providerModel,
      report: providerReport,
    },
    evaluation_harness: {
      sha256: harnessFingerprint,
      files: harnessFiles,
      agent_runtime_sha: evaluatedSha,
    },
    prompt_version: STUDYX_AGENT_A_CANONICAL_PROMPT_VERSION,
    brain_version: AGENT_A_BRAIN_PROMPT_VERSION,
    case_summary: {
      approved: cases.filter((item) => item.approved === true).length,
      failed: cases.filter((item) => item.approved === false).length,
      not_evaluated: cases.filter((item) => item.approved === null).length,
      evaluator_errors: cases.flatMap((item) => item.turns)
        .filter((turn) => turn.execution_status === 'evaluation_error').length,
      judge_format_recoveries: cases.flatMap(item => item.turns).filter(turn => turn.judge_format_recovery).length,
      completed: cases.length,
      total: selectedCases.length,
    },
    cases,
    comparison_to_v8: compareGoldenRunsV1({
      baselineLabel: 'baseline-v8', candidateLabel: resultStem,
      baselineProvider: 'deepseek', candidateProvider: providerName,
      baselineCases: baselineV8Cases, candidateCases: cases,
    }),
  };
}

async function writeRawProgress(): Promise<void> {
  await mkdir(resultsDirectory, { recursive: true });
  await writeFile(path.join(resultsDirectory, `${resultStem}-observations.partial.json`), `${JSON.stringify({
    schema_version: 3,
    base_sha: evaluatedSha,
    authority_baseline_origin_sha: GOLDEN_BASE_SHA,
    completed_cases: pendingCases.length,
    total_cases: selectedCases.length,
    evaluation_provider: {
      name: providerName, base_url: providerBaseUrl, model: providerModel,
      judge_model: providerName === 'deepseek' ? judgeModel : providerModel,
      report: goldenProvider?.report() ?? null,
    },
    cases: pendingCases,
  }, null, 2)}\n`);
}

async function writeCompletedProgress(): Promise<void> {
  await mkdir(resultsDirectory, { recursive: true });
  // Local synthetic DB only. Keep original drafts and physical-send evidence
  // after the runner tears down its disposable database; no secrets/headers.
  const durable = await db`SELECT a.id,a.occurred_at,a.action,a.entity_type,a.entity_id,a.correlation_id,a.payload
    FROM audit_log a WHERE a.action IN ('agent.turn.evidence','agent.decision.committed',
      'outbound.delivery.reported','outbound.provider.attempt','outbound.provider.result',
      'post_sale.narrative.received','post_sale.narrative.rejected','post_sale.narrative.authorized')
    ORDER BY a.occurred_at,a.id`;
  await writeFile(path.join(resultsDirectory, `${resultStem}-durable-evidence.json`), `${JSON.stringify({
    evaluated_sha: evaluatedSha, records: durable,
  }, null, 2)}\n`);
  await writeFile(path.join(resultsDirectory, `${resultStem}.json`), `${JSON.stringify(baselineReport(completedCases), null, 2)}\n`);
  await writeFile(path.join(resultsDirectory, `${resultStem}.md`), markdown(completedCases));
}

async function writeProviderProgress(report: GoldenProviderReportV1): Promise<void> {
  await mkdir(resultsDirectory, { recursive: true });
  const target = path.join(resultsDirectory, `${resultStem}-provider.partial.json`);
  const temporary = `${target}.tmp`;
  await writeFile(temporary, `${JSON.stringify({
    schema_version: 1,
    status: 'running',
    evaluated_sha: evaluatedSha,
    harness_sha256: harnessFingerprint,
    updated_at: new Date().toISOString(),
    report,
  }, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, target);
}

async function writeProviderCompleted(report: GoldenProviderReportV1): Promise<void> {
  const target = path.join(resultsDirectory, `${resultStem}-provider.json`);
  const temporary = `${target}.tmp`;
  await writeFile(temporary, `${JSON.stringify({
    schema_version: 1,
    status: 'completed',
    evaluated_sha: evaluatedSha,
    harness_sha256: harnessFingerprint,
    completed_at: new Date().toISOString(),
    report,
  }, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, target);
}

async function fingerprintHarness(): Promise<void> {
  harnessFiles = execFileSync('git', [
    'ls-files', '--cached', '--others', '--exclude-standard', 'evals/golden',
  ], { encoding: 'utf8' })
    .split(/\r?\n/u)
    .filter((filename) => filename.endsWith('.ts') || filename.endsWith('.mts') || filename.endsWith('.mjs'))
    .sort();
  const hash = createHash('sha256');
  for (const filename of harnessFiles) {
    hash.update(filename);
    hash.update('\0');
    hash.update(await readFile(filename));
    hash.update('\0');
  }
  harnessFingerprint = hash.digest('hex');
}

beforeAll(async () => {
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  if (reuseObservations) {
    expect(evaluatedSha).toMatch(/^[a-f0-9]{40}$/u);
    expect(() => execFileSync('git', ['cat-file', '-e', `${evaluatedSha}^{commit}`])).not.toThrow();
  } else expect(evaluatedSha).toBe(head);
  await fingerprintHarness();
  expect(harnessFingerprint).toMatch(/^[a-f0-9]{64}$/u);
  expect(() => execFileSync('git', ['merge-base', '--is-ancestor', GOLDEN_BASE_SHA, head]))
    .not.toThrow();
  const changed = execFileSync('git', ['diff', '--name-only', 'HEAD'], { encoding: 'utf8' })
    .split(/\r?\n/u).filter(Boolean);
  expect(changed.every((filename) => filename.startsWith('evals/golden/')),
    `GOLDEN_AGENT_CODE_DIFFERS_FROM_BASE:${changed.join(',')}`).toBe(true);
  const unsafeUntracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard'], { encoding: 'utf8' })
    .split(/\r?\n/u).filter(Boolean)
    .filter((filename) => !filename.startsWith('evals/golden/')
      && !filename.startsWith('docs/reports/evidence/'));
  expect(unsafeUntracked, `GOLDEN_UNTRACKED_RUNTIME_FILES_PRESENT:${unsafeUntracked.join(',')}`).toEqual([]);
  expect(secrets.DEEPSEEK_API_KEY?.trim(), 'DEEPSEEK_API_KEY_MISSING').toBeTruthy();
  expect(['deepseek', 'nvidia_nim']).toContain(providerName);
  if (providerName === 'nvidia_nim') {
    expect(new URL(providerBaseUrl).origin).toBe('https://integrate.api.nvidia.com');
    expect(process.env.NVIDIA_API_KEY?.trim(), 'NVIDIA_API_KEY_MISSING').toBeTruthy();
  }
  expect(new URL(apiBaseUrl).origin).toBe('http://127.0.0.1:3217');
  expect(new URL(databaseUrl).origin).toBe('null');
  configuration.apiBaseUrl = apiBaseUrl;
  configuration.agentAPlannerlessV2Enabled = true;
  // A/B on the same SHA: 'false' measures the single-pass writer (byte-identical fallback).
  configuration.agentACommercialPlanningEnabled = process.env.STUDYX_GOLDEN_COMMERCIAL_PLANNING === 'true';
  configuration.agentAAdvisorName = 'Emma';
  expect(model).toBe(AGENT_A_DEEPSEEK_MODEL);
  configuration.agentABrainDeepSeekModel = model;
  expect((await fetch(`${apiBaseUrl}/api/ready`, { signal: AbortSignal.timeout(4_000) })).ok).toBe(true);
  const paymentLinkResolver = createConfigPaymentLinkResolver(process.env);
  expect({
    monthly_12: paymentLinkResolver.resolve('monthly_12'),
    monthly_6: paymentLinkResolver.resolve('monthly_6'),
    one_time: paymentLinkResolver.resolve('one_time'),
  }, 'GOLDEN_PAYMENT_LINK_RESOLVER_NOT_CONFIGURED').toEqual({
    monthly_12: 'https://buy.stripe.com/test_studyx_golden_12m',
    monthly_6: 'https://buy.stripe.com/test_studyx_golden_6m',
    one_time: 'https://buy.stripe.com/test_studyx_golden_contado',
  });
  ({ recordDeliveryReport: recordDeliveryReportFn } = await import('@/lib/services/decision.service'));
  ({ projectAgentAMemories: projectAgentAMemoriesFn } = await import('@/features/memory/application/project-agent-a-memories'));
  ({ runEnrollmentWorker: runEnrollmentWorkerFn } = await import('@/features/fulfillment/central-carga/worker'));
  postSaleFns = await import('@/features/fulfillment/post-sale/service');
  const baselineV8 = JSON.parse(await readFile(
    path.join(resultsDirectory, 'baseline-v8.json'), 'utf8',
  )) as { readonly cases?: typeof baselineV8Cases };
  baselineV8Cases = [...(baselineV8.cases ?? [])];
  expect(baselineV8Cases).toHaveLength(GOLDEN_CASES.length);
  baselineV8Cases = baselineV8Cases.filter(item => selectedCases.some(scenario => scenario.id === item.case_id));
  db = openLocalTestDatabase();
  nativeFetch = globalThis.fetch;
  if (providerName === 'deepseek') {
    goldenProvider = createGoldenOfficialResponsesProviderV1({ agentModel: providerModel, judgeModel },
      { fetchImpl: nativeFetch, onReport: writeProviderProgress });
  }
  if (providerName === 'nvidia_nim') {
    goldenProvider = createGoldenResponsesProviderV1({
      provider: 'nvidia_nim',
      baseUrl: providerBaseUrl,
      model: providerModel,
      apiKey: process.env.NVIDIA_API_KEY!,
      maxRequestsPerMinute: 40,
      maxAttempts: 4,
      retryBaseDelayMs: 500,
    }, { fetchImpl: nativeFetch, onReport: writeProviderProgress });
  }
  globalThis.fetch = async (request, init) => {
    const url = new URL(request instanceof Request ? request.url : String(request));
    if (url.origin !== 'https://api.deepseek.com' && url.origin !== new URL(apiBaseUrl).origin) {
      throw new Error(`GOLDEN_UNEXPECTED_EXTERNAL_REQUEST:${url.hostname}`);
    }
    if (url.origin === 'https://api.deepseek.com' && goldenProvider) {
      expect(url.pathname).toBe('/responses');
      return goldenProvider.fetch(request, init);
    }
    return nativeFetch(request, init);
  };
});

afterAll(async () => {
  if (nativeFetch) globalThis.fetch = nativeFetch;
  await db?.end({ timeout: 5 });
});

live('authority-only Agent A golden baseline through the real workflow', () => {
  it('executes every scenario and preserves raw evidence for semantic judgment', async () => {
    if (reuseObservations) {
      const raw = JSON.parse(await readFile(
        path.join(resultsDirectory, `${resultStem}-observations.partial.json`),
        'utf8',
      )) as {
        readonly base_sha?: string;
        readonly completed_cases?: number;
        readonly cases?: readonly {
          readonly scenario?: { readonly id?: string };
          readonly observations?: readonly GoldenTurnObservationV1[];
          readonly setupEvidence?: unknown;
          readonly executionError?: string;
          readonly executionErrorTurnIndex?: number;
        }[];
      };
      expect(raw.base_sha).toBe(evaluatedSha);
      expect(raw.completed_cases).toBe(raw.cases?.length);
      for (const scenario of selectedCases) {
        const saved = raw.cases?.find((candidate) => candidate.scenario?.id === scenario.id);
        expect(saved, `GOLDEN_REUSED_OBSERVATIONS_MISSING:${scenario.id}`).toBeTruthy();
        pendingCases.push({
          scenario,
          observations: [...(saved?.observations ?? [])],
          ...(saved?.setupEvidence === undefined ? {} : { setupEvidence: saved.setupEvidence }),
          ...(saved?.executionError ? { executionError: saved.executionError } : {}),
          ...(saved?.executionErrorTurnIndex === undefined
            ? {} : { executionErrorTurnIndex: saved.executionErrorTurnIndex }),
        });
      }
      expect(pendingCases).toHaveLength(selectedCases.length);
      return;
    }
    for (const scenario of selectedCases) {
      const id = identity(scenario.id);
      const captures: WorkflowTurnEvidenceV1['adapterCaptures'][number][] = [];
      let setupEvidence: unknown;
      let executionError: string | undefined;
      let executionErrorTurnIndex: number | undefined;
      let activeTurnIndex = 0;
      const observations: GoldenTurnObservationV1[] = [];
      let lastCommittedCallId: string | null = null;
      try {
        let firstConversationalTurn = 0;
        if (scenario.setup === 'fulfilled_bonus_package') {
          const setupTurn = await runWorkflowTurnV1({ ...id, text: 'Hola, soy Ana y estoy probando mi acceso.' });
          captures.push(...setupTurn.adapterCaptures);
          await acknowledgeDelivery(setupTurn);
          const fulfilled = await prepareFulfilledBonusPackage({
            externalConversationId: id.conversationId,
            setupTurn,
          });
          setupEvidence = fulfilled.evidence;
          const persisted = await readWorkflowDbEvidenceV1({
            databaseUrl, externalConversationId: id.conversationId, adapterCaptures: captures,
          });
          const activeCourseEvidence = await activatedCourseEvidence(id.conversationId);
          observations.push({
            response: fulfilled.accessMessage,
            move: null,
            secondaryMoves: [],
            proposedAction: null,
            backendAction: null,
            backendRejections: fulfilled.backendRejections,
            state: {
              selectedCourse: persisted.state?.selectedOfferingCode ?? null,
              stage: persisted.state?.stage ?? null,
              awaitingReply: persisted.state?.awaitingReply ?? null,
              plan: persisted.state?.selectedPaymentPlan ?? null,
              promotion: await promotionEvidence(id.conversationId),
            },
            deliveredLinks: [],
            authorizedFactIds: [],
            authorizedFacts: [],
            usedFactIds: [],
            availableOfferings: activeCourseEvidence.names,
            selectedOfferingFacts: [],
            modelAttempts: fulfilled.modelAttempts,
            callRequirements: [],
            profileRequestedFields: [],
            activeCourses: activeCourseEvidence.codes,
            activeCourseNames: activeCourseEvidence.names,
            mayOfferCall: null,
            courseBonus: { enabled: true, maxBonusCourses: 3, mayOfferBonus: false, status: 'accepted' },
            priceObjectionMemory: await priceObjectionMemoryEvidence(id.conversationId, null),
            workflow: {
              commitSucceeded: true,
              status: 'post_sale_notification_sent',
              errorCode: null,
              finalBackendDecisionError: null,
            },
          });
          firstConversationalTurn = 1;
        }
        for (const turn of scenario.turns.slice(firstConversationalTurn)) {
          activeTurnIndex = observations.length;
          if (turn.settleLatestCallBefore) {
            if (!lastCommittedCallId) {
              throw new Error(`GOLDEN_CALL_SETTLEMENT_COMMITTED_ID_MISSING:${scenario.id}:${turn.id}`);
            }
            await settleGoldenCallOutcomeV1({
              db,
              callId: lastCommittedCallId,
              externalConversationId: id.conversationId,
              workspaceSlug: process.env.BUSINESS_WORKSPACE_SLUG ?? 'studyx',
              result: turn.settleLatestCallBefore,
            });
          }
          const evidence = await runWorkflowTurnV1({
            ...id,
            text: turn.customer,
            syntheticCallDispatch: 'provider_accepted',
          });
          lastCommittedCallId = extractCommittedCallIdV1(evidence.httpExchanges) ?? lastCommittedCallId;
          captures.push(...evidence.adapterCaptures);
          await acknowledgeDelivery(evidence);
          observations.push(await observeTurn({
            externalConversationId: id.conversationId,
            evidence,
            accumulatedCaptures: captures,
            priorObservations: observations,
          }));
          await projectAgentAMemoriesFn({ limit: 100 }, { db });
        }
      } catch (error) {
        executionError = errorText(error);
        executionErrorTurnIndex = activeTurnIndex;
      }
      pendingCases.push({
        scenario,
        observations,
        setupEvidence,
        ...(executionError ? { executionError } : {}),
        ...(executionErrorTurnIndex === undefined ? {} : { executionErrorTurnIndex }),
      });
      await writeRawProgress();
    }
    expect(pendingCases).toHaveLength(selectedCases.length);
  }, 1_200_000);

  it('judges every real turn and writes the auditable baseline table', async () => {
    expect(pendingCases).toHaveLength(selectedCases.length);
    for (const pending of pendingCases) {
      let semantic: Awaited<ReturnType<typeof judgeCaseSemantically>> = [];
      let semanticEvaluationError: string | undefined;
      const observationMismatch = pending.observations.length !== pending.scenario.turns.length;
      const executionError = pending.executionError
        ?? (observationMismatch
          ? `OBSERVATION_COUNT_MISMATCH:${pending.observations.length}/${pending.scenario.turns.length}`
          : undefined);
      const executionErrorTurnIndex = pending.executionErrorTurnIndex
        ?? (executionError ? pending.observations.length : undefined);
      if (pending.observations.length > 0) {
        try {
          const observedScenario = pending.observations.length === pending.scenario.turns.length
            ? pending.scenario
            : { ...pending.scenario, turns: pending.scenario.turns.slice(0, pending.observations.length) };
          semantic = await judgeCaseSemantically({
            apiKey: secrets.DEEPSEEK_API_KEY!, model: judgeModel, scenario: observedScenario,
            observations: pending.observations,
          });
        } catch (error) {
          semanticEvaluationError = errorText(error);
        }
      }
      const turns: TurnResultV1[] = [];
      for (const [index, turn] of pending.scenario.turns.entries()) {
        const actualObservation = pending.observations[index];
        const isExecutionFailureTurn = !actualObservation && index === executionErrorTurnIndex;
        const observation = actualObservation ?? blankObservation();
        const primaryCitation = await primaryAuthorityCitation(turn);
        const hard = actualObservation ? evaluateHardRules(
          turn,
          observation,
          pending.observations[index - 1] ?? null,
          pending.scenario.evaluationMode,
        )
          : { failures: [], evaluatorErrors: [] };
        const hardFailures = hard.failures.map((failure) => ({
          ...failure,
          ...(failure.authorityReference || !primaryCitation
            ? {} : { authorityReference: primaryCitation }),
        }));
        const semanticVerdict = semantic.find((item) => item.turn_id === turn.id);
        const semanticFailures: GoldenFailureV1[] = (semanticVerdict?.failures ?? []).map((failure) => ({
          code: failure.code,
          detail: failure.explanation,
          authorityReference: failure.authority_reference,
        }));
        const evaluatorErrors = [
          ...(actualObservation && semanticEvaluationError ? [semanticEvaluationError] : []),
          ...(actualObservation && !semanticEvaluationError && !semanticVerdict ? ['GOLDEN_JUDGE_VERDICT_MISSING'] : []),
          ...(semanticVerdict?.evaluation_error ? [semanticVerdict.evaluation_error] : []),
          ...hard.evaluatorErrors.map((error) => `${error.code}:${error.detail}`),
        ];
        const technicalFailures: GoldenFailureV1[] = actualObservation
          ? evaluatorErrors.map((detail) => ({
            code: 'EVALUATOR_ERROR',
            detail,
            ...(primaryCitation ? { authorityReference: primaryCitation } : {}),
          }))
          : [{
            code: isExecutionFailureTurn ? 'EVALUATOR_ERROR' : 'TURN_NOT_EXECUTED',
            detail: isExecutionFailureTurn
              ? executionError ?? 'El runner falló antes de producir la observación de este turno.'
              : `No ejecutado porque un turno anterior falló: ${executionError ?? 'causa desconocida'}`,
            ...(primaryCitation ? { authorityReference: primaryCitation } : {}),
          }];
        const failures = [...hardFailures, ...semanticFailures, ...technicalFailures];
        const executionStatus: TurnResultV1['execution_status'] = actualObservation
          ? evaluatorErrors.length > 0 ? 'evaluation_error' : 'executed'
          : isExecutionFailureTurn ? 'evaluation_error' : 'not_executed';
        const attribution = executionStatus !== 'executed' || failures.length === 0 ? null
          : inferFailureAttribution(turn, observation, failures.map((failure) => failure.code));
        turns.push({
          case_id: pending.scenario.id,
          turn_id: turn.id,
          customer: turn.customer,
          approved: executionStatus === 'executed' ? failures.length === 0 : null,
          execution_status: executionStatus,
          authority: primaryCitation ? [primaryCitation] : [],
          must: pending.scenario.evaluationMode==='negotiation_invariants'?negotiationSemanticTurnV1(turn,index===pending.scenario.turns.length-1,usesCurrentModelOwnedNegotiationV1(observation.negotiationFacts)).must:turn.must,
          must_not: pending.scenario.evaluationMode==='negotiation_invariants'?negotiationSemanticTurnV1(turn,index===pending.scenario.turns.length-1,usesCurrentModelOwnedNegotiationV1(observation.negotiationFacts)).mustNot:turn.mustNot,
          response_real: observation.response,
          move: observation.move,
          proposed_action: observation.proposedAction,
          backend_action: observation.backendAction,
          backend_rejections: observation.backendRejections,
          state: observation.state,
          failures,
          failure_layer: attribution?.layer ?? null,
          validator_rejections: attribution?.validatorRejections ?? [],
          ...(semanticVerdict?.format_recovery ? { judge_format_recovery: semanticVerdict.format_recovery } : {}),
          model_attempts: observation.modelAttempts,
          preconditions: {
            course_bonus: observation.courseBonus,
            price_objection_memory: observation.priceObjectionMemory,
            may_offer_call: observation.mayOfferCall ?? null,
            workflow: observation.workflow,
          },
        });
      }
      const hasUnevaluatedTurns = turns.some((turn) => turn.execution_status !== 'executed');
      const semanticStatus:InvariantStatusV1=semantic.some(t=>t.approved===false)?'FAIL':semantic.length!==pending.scenario.turns.length||semantic.some(t=>t.approved===null)?'INDETERMINATE':'PASS';
      const packageRecapStatusByTurn:Readonly<Record<string,InvariantStatusV1>>=Object.fromEntries(
        pending.scenario.turns.map(turn=>{
          const verdict=semantic.find(item=>item.turn_id===turn.id);
          if(!verdict||verdict.approved===null)return [turn.id,'INDETERMINATE' as const];
          const recapFailed=verdict.failures.some(failure=>failure.code==='SEMANTIC_MUST_FAILED'&&failure.requirement_index===2);
          return [turn.id,recapFailed?'FAIL' as const:'PASS' as const];
        }),
      );
      const negotiation = pending.scenario.evaluationMode==='negotiation_invariants'?evaluateNegotiationInvariantsV1(pending.scenario.id,pending.scenario.turns.map((t,i)=>negotiationEvidenceV1(t,pending.observations[i]??blankObservation())),semanticStatus,hasUnevaluatedTurns?'INDETERMINATE':turns.some(t=>t.failures.some(f=>!f.code.startsWith('SEMANTIC_')))?'FAIL':'PASS',packageRecapStatusByTurn):undefined;
      if(negotiation)for(const [index,turn] of turns.entries()){
        const structural=negotiation.turn_results[index]!;
        const failed=negotiation.checks.filter(c=>c.failedTurnIds.includes(turn.turn_id));
        const structuralFailures:GoldenFailureV1[]=failed.map(c=>({code:'NEGOTIATION_INVARIANT_FAILED',detail:`${c.id}: ${c.evidence.join('; ')}`,authorityReference:c.authority}));
        turns[index]={...turn,invariant_status:structural.status,
          approved:structural.status==='FAIL'?false:structural.status==='INDETERMINATE'&&turn.approved===true?null:turn.approved,
          failures:[...turn.failures,...structuralFailures],
          ...(structuralFailures.length?{failure_layer:inferFailureAttribution(pending.scenario.turns[index]!,pending.observations[index]??blankObservation(),structuralFailures.map(f=>f.code)).layer}:{})};
      }
      completedCases.push({
        case_id: pending.scenario.id,
        title: pending.scenario.title,
        approved: negotiation?negotiation.approved:hasUnevaluatedTurns ? null : turns.every((turn) => turn.approved === true),
        ...(negotiation?{negotiation_evaluation:negotiation}:{}),
        ...(pending.setupEvidence === undefined ? {} : { setup_evidence: pending.setupEvidence }),
        turns,
      });
      await writeCompletedProgress();
    }
    expect(completedCases).toHaveLength(selectedCases.length);
    if (goldenProvider) await writeProviderCompleted(goldenProvider.report());
  }, 600_000);
});
