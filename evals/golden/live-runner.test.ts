import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runWorkflowTurnV1, type WorkflowTurnEvidenceV1 } from '../../tests/helpers/agent-a-workflow-driver';
import { readWorkflowDbEvidenceV1 } from '../../tests/helpers/agent-a-workflow-db-evidence';
import { configuration, secrets } from '../../tests/helpers/botpress-workflow-runtime';
import { openLocalTestDatabase } from '../../tests/helpers/db';
import { AGENT_A_BRAIN_PROMPT_VERSION } from '../../botpress-agent/src/prompts/agent-a-brain-v1';
import {
  STUDYX_AGENT_A_CANONICAL_PROMPT,
  STUDYX_AGENT_A_CANONICAL_PROMPT_VERSION,
} from '../../botpress-agent/src/prompts/studyx-agent-a-canonical.generated';
import { AGENT_A_DEEPSEEK_MODEL } from '../../botpress-agent/src/config/agent-a-model';
import { resolveCanonicalPromptIdentityV1 } from '../../botpress-agent/src/prompts/agent-a-identity';
import { createConfigPaymentLinkResolver } from '../../src/features/payments/adapters/config-payment-link.resolver';
import {
  buildPostSaleInstructions,
  fallbackPostSaleNarrative,
} from '../../botpress-agent/src/utils/post-sale-instructions';

import {
  evaluateHardRules,
  inferFailureAttribution,
  judgeCaseSemantically,
  primaryAuthorityCitation,
  type GoldenFailureV1,
  type GoldenTurnObservationV1,
} from './judge';
import {
  extractBackendRejectionsV1,
  extractContextEvidenceV1,
  extractFinalBackendDecisionErrorV1,
  extractLastProposalV1,
  extractModelAttemptsV1,
  normalizePromotionStatusV1,
} from './runner-support';
import { GOLDEN_BASE_SHA, GOLDEN_CASES, type GoldenCaseV1 } from './scenarios';

const live = process.env.STUDYX_GOLDEN_LIVE === 'true' ? describe : describe.skip;
const databaseUrl = process.env.TEST_DATABASE_URL ?? '';
const apiBaseUrl = process.env.STUDYX_EVAL_API_BASE_URL ?? '';
const model = process.env.STUDYX_GOLDEN_DEEPSEEK_MODEL ?? 'deepseek-v4-flash';
const resultsDirectory = path.resolve(process.cwd(), 'evals/golden/results');
const reuseObservations = process.env.STUDYX_GOLDEN_REUSE_OBSERVATIONS === 'true';
const evaluatedSha = process.env.STUDYX_GOLDEN_EVALUATED_SHA ?? '';
const resultStem = 'baseline-v8';

type Sql = ReturnType<typeof openLocalTestDatabase>;

interface PromotionEvidenceV1 {
  readonly status: string | null;
  readonly bonusCount: number;
  readonly paidCourse: string | null;
  readonly bonusCourses: readonly string[];
}

interface TurnResultV1 {
  readonly case_id: string;
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
  readonly model_attempts: GoldenTurnObservationV1['modelAttempts'];
  readonly preconditions: {
    readonly course_bonus: GoldenTurnObservationV1['courseBonus'];
    readonly price_objection_memory: GoldenTurnObservationV1['priceObjectionMemory'];
    readonly may_offer_call: boolean | null;
    readonly workflow: GoldenTurnObservationV1['workflow'];
  };
}

interface CaseResultV1 {
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
}

interface FulfilledSetupV1 {
  readonly evidence: Record<string, unknown>;
  readonly accessMessage: string;
  readonly modelAttempt: GoldenTurnObservationV1['modelAttempts'][number];
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

async function acknowledgeDelivery(evidence: WorkflowTurnEvidenceV1): Promise<void> {
  const capture = evidence.adapterCaptures[0];
  if (!evidence.outboundId || !capture) return;
  await recordDeliveryReportFn({
    outbound_id: evidence.outboundId,
    trace_id: evidence.traceId,
    status: 'delivered',
    botpress_message_id: capture.providerMessageId,
    replayed: false,
    error_code: null,
    delivery_attempt: 1,
    delivered_at: new Date().toISOString(),
  });
}

async function promotionEvidence(externalConversationId: string): Promise<PromotionEvidenceV1> {
  const rows = await db<Array<{
    id: string; status: string; paid_code: string; created_at: Date;
  }>>`
    SELECT offer.id, offer.status, paid.code AS paid_code, offer.created_at
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
}): Promise<GoldenTurnObservationV1> {
  const persisted = await readWorkflowDbEvidenceV1({
    databaseUrl,
    externalConversationId: input.externalConversationId,
    adapterCaptures: input.accumulatedCaptures,
  });
  const proposal = extractLastProposalV1(input.evidence.httpExchanges);
  const context = extractContextEvidenceV1(input.evidence.httpExchanges);
  const promotion = await promotionEvidence(input.externalConversationId);
  const activeCourseEvidence = await activatedCourseEvidence(input.externalConversationId);
  const decision = persisted.decisions.find((item) => item.turnId === input.evidence.turnId);
  return {
    response: input.evidence.authorizedMessages.join('\n'),
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
    priceObjectionMemory: await priceObjectionMemoryEvidence(
      input.externalConversationId,
      input.evidence.turnId,
    ),
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
    config: { enabled: true, environment: 'test' as const, paidAfter: new Date('2026-01-01') },
    fetchImpl: eventFetch,
  };
  await postSaleFns.dispatchNotifications(payment.id, notificationDeps);
  const claim = await postSaleFns.claimNotification(notice.id, input.externalConversationId, notificationDeps);
  if (!claim.claimed) throw new Error('GOLDEN_FULFILLED_SETUP_CLAIM_FAILED');
  const resolvedIdentity = resolveCanonicalPromptIdentityV1(STUDYX_AGENT_A_CANONICAL_PROMPT, {
    advisor_name: 'Emma', academy_name: claim.academy_name, website: null, instagram: null,
  });
  if (resolvedIdentity.unresolved.length > 0) throw new Error('GOLDEN_POST_SALE_IDENTITY_UNRESOLVED');
  const providerResponse = await fetch('https://api.deepseek.com/responses', {
    method: 'POST',
    signal: AbortSignal.timeout(10_000),
    headers: { authorization: `Bearer ${secrets.DEEPSEEK_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: AGENT_A_DEEPSEEK_MODEL,
      instructions: buildPostSaleInstructions(resolvedIdentity.prompt, claim),
      input: JSON.stringify(claim),
      reasoning: { effort: 'none' }, temperature: 0.3, stream: false, max_output_tokens: 350,
      text: { format: { type: 'json_schema', name: 'studyx_post_sale', schema: {
        type: 'object', additionalProperties: false, required: ['intro', 'suggestion'], properties: {
          intro: { type: 'string', minLength: 1, maxLength: 500 },
          suggestion: { type: 'string', maxLength: 180 },
        },
      } } },
    }),
  });
  const providerPayload = await providerResponse.json() as {
    output_text?: string;
    output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
  };
  const providerText = typeof providerPayload.output_text === 'string' ? providerPayload.output_text
    : providerPayload.output?.flatMap((item) => item.content ?? [])
      .filter((item) => item.type === 'output_text' && typeof item.text === 'string')
      .map((item) => item.text).join('') ?? '';
  if (!providerResponse.ok || !providerText) {
    throw new Error(`GOLDEN_POST_SALE_MODEL_FAILED:${providerResponse.status}`);
  }
  const narrative = JSON.parse(providerText) as { intro: string; suggestion: string };
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
  let delivery = await postSaleFns.deliverNotification(notice.id, {
    claim_token: claim.claim_token,
    botpress_conversation_id: input.externalConversationId,
    narrative,
  }, deliveryDeps);
  if (delivery.outcome === 'invalid_content') {
    backendRejections.push({ subject: 'post_sale_narrative', reason: delivery.reason ?? 'invalid_content' });
    delivery = await postSaleFns.deliverNotification(notice.id, {
      claim_token: claim.claim_token,
      botpress_conversation_id: input.externalConversationId,
      narrative: fallbackPostSaleNarrative(claim),
    }, deliveryDeps);
  }
  if (delivery.outcome !== 'sent' || !accessMessages[0]) {
    throw new Error(`GOLDEN_POST_SALE_DELIVERY_FAILED:${delivery.outcome}`);
  }
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
  return {
    evidence: {
      fixture_kind: 'controlled_local_paid_and_fulfilled_package',
      payment_id: payment.id,
      promotion_offer_id: offer.id,
      paid_course: paid.code,
      bonus_courses: bonuses.map((bonus) => bonus.code),
      worker,
      access_message: accessMessages[0],
      narrative_delivery: delivery,
    },
    accessMessage: accessMessages[0],
    modelAttempt: {
      attempt: 1,
      response: [narrative.intro, narrative.suggestion].filter(Boolean).join('\n'),
      move: null,
      proposedAction: null,
      turnRejection: null,
      providerStatus: providerResponse.status,
      providerError: null,
    },
    backendRejections,
  };
}

function markdown(cases: readonly CaseResultV1[]): string {
  const escape = (value: unknown) => String(value ?? '').replaceAll('|', '\\|').replaceAll('\n', '<br>');
  const lines = [
    `# Agent A golden baseline v8 — ${evaluatedSha.slice(0, 7)}`, '',
    `- SHA evaluado: \`${evaluatedSha}\``,
    `- Origen de la línea de base de autoridad: \`${GOLDEN_BASE_SHA}\``,
    `- Brain: \`${AGENT_A_BRAIN_PROMPT_VERSION}\``,
    `- Prompt canónico: \`${STUDYX_AGENT_A_CANONICAL_PROMPT_VERSION}\``,
    `- Modelo: \`${model}\``,
    `- Casos: ${cases.filter((item) => item.approved === true).length} aprobados; ${cases.filter((item) => item.approved === false).length} fallidos; ${cases.filter((item) => item.approved === null).length} con error del evaluador`,
    `- Turnos: ${cases.flatMap((item) => item.turns).filter((turn) => turn.approved === true).length} aprobados; ${cases.flatMap((item) => item.turns).filter((turn) => turn.approved === false).length} fallidos; ${cases.flatMap((item) => item.turns).filter((turn) => turn.execution_status === 'evaluation_error').length} con error del evaluador`, '',
    '| Caso/turno | Resultado | Autoridad | Respuesta real | Move / acción | Rechazos backend | Hipótesis de capa |',
    '|---|---|---|---|---|---|---|',
  ];
  for (const item of cases) for (const turn of item.turns) {
    const result = turn.execution_status === 'not_executed' ? 'NO_EJECUTADO'
      : turn.execution_status === 'evaluation_error' ? 'ERROR_EVALUACIÓN'
        : turn.approved ? 'APROBADO' : 'FALLIDO';
    const layer = turn.failure_layer === 'validador' && turn.validator_rejections.length > 0
      ? `validador — ${turn.validator_rejections.map((rejection) => `${rejection.code}${rejection.subject ? ` / ${rejection.subject}` : ''}`).join('; ')}`
      : turn.failure_layer ?? '—';
    lines.push(`| ${escape(`${item.case_id}/${turn.turn_id}`)} | ${result} | ${escape(turn.authority.join('; '))} | ${escape(turn.response_real)} | ${escape(`${turn.move ?? 'null'} / ${JSON.stringify(turn.proposed_action)}`)} | ${escape(JSON.stringify(turn.backend_rejections))} | ${escape(layer)} |`);
  }
  lines.push('', '## Fallos', '');
  for (const item of cases) for (const turn of item.turns.filter((candidate) => candidate.approved !== true)) {
    lines.push(`- **${item.case_id}/${turn.turn_id} — ${turn.failure_layer ?? turn.execution_status}:** ${turn.failures.map((failure) => `${failure.code} [${failure.authorityReference ?? turn.authority[0] ?? 'sin referencia'}]: ${failure.detail}`).join(' | ')}`);
  }
  lines.push('', '## Evidencia de entorno y precondiciones', '');
  for (const item of cases.filter((candidate) => ['06_repeated_price_bonus_ladder', '10_requested_call',
    '11_purchase_to_payment_link', '14_course_change_cancels_promotion'].includes(candidate.case_id))) {
    for (const turn of item.turns) {
      lines.push(`- **${item.case_id}/${turn.turn_id}:** ${escape(JSON.stringify(turn.preconditions))}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

function baselineReport(cases: readonly CaseResultV1[]) {
  return {
    schema_version: 2,
    generated_at: new Date().toISOString(),
    base_sha: evaluatedSha,
    authority_baseline_origin_sha: GOLDEN_BASE_SHA,
    execution_harness: 'processInboundTurn',
    environment: 'isolated_local',
    environment_configuration: {
      voice_provider: process.env.VOICE_PROVIDER ?? null,
      payment_provider: process.env.PAYMENT_PROVIDER ?? null,
      payment_link_environment: process.env.PAYMENT_LINK_ENVIRONMENT ?? null,
      payment_links_configured: (['monthly_12', 'monthly_6', 'one_time'] as const)
        .every((plan) => createConfigPaymentLinkResolver(process.env).resolve(plan) !== null),
      course_bonus_flow_mode: process.env.COURSE_BONUS_FLOW_MODE ?? null,
      course_bonus_max_courses: process.env.COURSE_BONUS_MAX_COURSES ?? null,
    },
    production_or_vertice_used: false,
    deepseek_model: model,
    prompt_version: STUDYX_AGENT_A_CANONICAL_PROMPT_VERSION,
    brain_version: AGENT_A_BRAIN_PROMPT_VERSION,
    case_summary: {
      approved: cases.filter((item) => item.approved === true).length,
      failed: cases.filter((item) => item.approved === false).length,
      not_evaluated: cases.filter((item) => item.approved === null).length,
      evaluator_errors: cases.flatMap((item) => item.turns)
        .filter((turn) => turn.execution_status === 'evaluation_error').length,
      completed: cases.length,
      total: GOLDEN_CASES.length,
    },
    cases,
  };
}

async function writeRawProgress(): Promise<void> {
  await mkdir(resultsDirectory, { recursive: true });
  await writeFile(path.join(resultsDirectory, `${resultStem}-observations.partial.json`), `${JSON.stringify({
    schema_version: 2,
    base_sha: evaluatedSha,
    authority_baseline_origin_sha: GOLDEN_BASE_SHA,
    completed_cases: pendingCases.length,
    total_cases: GOLDEN_CASES.length,
    cases: pendingCases,
  }, null, 2)}\n`);
}

async function writeCompletedProgress(): Promise<void> {
  await mkdir(resultsDirectory, { recursive: true });
  await writeFile(path.join(resultsDirectory, `${resultStem}.json`), `${JSON.stringify(baselineReport(completedCases), null, 2)}\n`);
  await writeFile(path.join(resultsDirectory, `${resultStem}.md`), markdown(completedCases));
}

beforeAll(async () => {
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  expect(evaluatedSha).toBe(head);
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
  expect(new URL(apiBaseUrl).origin).toBe('http://127.0.0.1:3217');
  expect(new URL(databaseUrl).origin).toBe('null');
  configuration.apiBaseUrl = apiBaseUrl;
  configuration.agentAPlannerlessV2Enabled = true;
  configuration.agentAAdvisorName = 'Emma';
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
  db = openLocalTestDatabase();
  nativeFetch = globalThis.fetch;
  globalThis.fetch = async (request, init) => {
    const url = new URL(request instanceof Request ? request.url : String(request));
    if (url.origin !== 'https://api.deepseek.com' && url.origin !== new URL(apiBaseUrl).origin) {
      throw new Error(`GOLDEN_UNEXPECTED_EXTERNAL_REQUEST:${url.hostname}`);
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
        }[];
      };
      expect(raw.base_sha).toBe(evaluatedSha);
      expect(raw.completed_cases).toBe(GOLDEN_CASES.length);
      for (const scenario of GOLDEN_CASES) {
        const saved = raw.cases?.find((candidate) => candidate.scenario?.id === scenario.id);
        expect(saved, `GOLDEN_REUSED_OBSERVATIONS_MISSING:${scenario.id}`).toBeTruthy();
        pendingCases.push({
          scenario,
          observations: [...(saved?.observations ?? [])],
          ...(saved?.setupEvidence === undefined ? {} : { setupEvidence: saved.setupEvidence }),
          ...(saved?.executionError ? { executionError: saved.executionError } : {}),
        });
      }
      expect(pendingCases).toHaveLength(GOLDEN_CASES.length);
      return;
    }
    for (const scenario of GOLDEN_CASES) {
      const id = identity(scenario.id);
      const captures: WorkflowTurnEvidenceV1['adapterCaptures'][number][] = [];
      let setupEvidence: unknown;
      let executionError: string | undefined;
      const observations: GoldenTurnObservationV1[] = [];
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
            modelAttempts: [fulfilled.modelAttempt],
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
          const evidence = await runWorkflowTurnV1({ ...id, text: turn.customer });
          captures.push(...evidence.adapterCaptures);
          await acknowledgeDelivery(evidence);
          observations.push(await observeTurn({
            externalConversationId: id.conversationId,
            evidence,
            accumulatedCaptures: captures,
          }));
          await projectAgentAMemoriesFn({ limit: 100 }, { db });
        }
      } catch (error) {
        executionError = errorText(error);
      }
      pendingCases.push({ scenario, observations, setupEvidence, ...(executionError ? { executionError } : {}) });
      await writeRawProgress();
    }
    expect(pendingCases).toHaveLength(GOLDEN_CASES.length);
  }, 1_200_000);

  it('judges every real turn and writes the auditable baseline table', async () => {
    expect(pendingCases).toHaveLength(GOLDEN_CASES.length);
    for (const pending of pendingCases) {
      let semantic: Awaited<ReturnType<typeof judgeCaseSemantically>> = [];
      let evaluationError = pending.executionError;
      if (!evaluationError && pending.observations.length === pending.scenario.turns.length) {
        try {
          semantic = await judgeCaseSemantically({
            apiKey: secrets.DEEPSEEK_API_KEY!, model, scenario: pending.scenario,
            observations: pending.observations,
          });
        } catch (error) {
          evaluationError = errorText(error);
        }
      } else if (!evaluationError) {
        evaluationError = `OBSERVATION_COUNT_MISMATCH:${pending.observations.length}/${pending.scenario.turns.length}`;
      }
      const turns: TurnResultV1[] = [];
      for (const [index, turn] of pending.scenario.turns.entries()) {
        const actualObservation = pending.observations[index];
        const observation = actualObservation ?? blankObservation();
        const primaryCitation = await primaryAuthorityCitation(turn);
        const hard = actualObservation ? evaluateHardRules(
          turn,
          observation,
          pending.observations[index - 1] ?? null,
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
          ...(evaluationError ? [evaluationError] : []),
          ...(!evaluationError && !semanticVerdict ? ['GOLDEN_JUDGE_VERDICT_MISSING'] : []),
          ...(semanticVerdict?.evaluation_error ? [semanticVerdict.evaluation_error] : []),
          ...hard.evaluatorErrors.map((error) => `${error.code}:${error.detail}`),
        ];
        const technicalFailures: GoldenFailureV1[] = !actualObservation ? [{
          code: 'TURN_NOT_EXECUTED',
          detail: evaluationError ?? 'El runner no produjo una observación para este turno.',
          ...(primaryCitation ? { authorityReference: primaryCitation } : {}),
        }] : evaluatorErrors.map((detail) => ({
          code: 'EVALUATOR_ERROR',
          detail,
          ...(primaryCitation ? { authorityReference: primaryCitation } : {}),
        }));
        const failures = [...hardFailures, ...semanticFailures, ...technicalFailures];
        const executionStatus: TurnResultV1['execution_status'] = !actualObservation
          ? 'not_executed' : evaluatorErrors.length > 0 ? 'evaluation_error' : 'executed';
        const attribution = executionStatus !== 'executed' || failures.length === 0 ? null
          : inferFailureAttribution(turn, observation, failures.map((failure) => failure.code));
        turns.push({
          case_id: pending.scenario.id,
          turn_id: turn.id,
          customer: turn.customer,
          approved: executionStatus === 'executed' ? failures.length === 0 : null,
          execution_status: executionStatus,
          authority: primaryCitation ? [primaryCitation] : [],
          must: turn.must,
          must_not: turn.mustNot,
          response_real: observation.response,
          move: observation.move,
          proposed_action: observation.proposedAction,
          backend_action: observation.backendAction,
          backend_rejections: observation.backendRejections,
          state: observation.state,
          failures,
          failure_layer: attribution?.layer ?? null,
          validator_rejections: attribution?.validatorRejections ?? [],
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
      completedCases.push({
        case_id: pending.scenario.id,
        title: pending.scenario.title,
        approved: hasUnevaluatedTurns ? null : turns.every((turn) => turn.approved === true),
        ...(pending.setupEvidence === undefined ? {} : { setup_evidence: pending.setupEvidence }),
        turns,
      });
      await writeCompletedProgress();
    }
    expect(completedCases).toHaveLength(GOLDEN_CASES.length);
  }, 600_000);
});
