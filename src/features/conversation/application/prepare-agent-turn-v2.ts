import { priceObservationQuoteInBatchV1 } from '@/shared/conversation/deterministic-sales-rules';
import type { BusinessContextView, CatalogIndexView } from '@/features/orchestration/domain/business-context';
import type { DecisionV4 } from '@/features/orchestration/domain/decision-v4';
import type { ProtectedFactRef } from '@/features/orchestration/domain/egress-guard';
import {
  materializeCanonicalCatalogFacts,
  singleCanonicalOfferingReferenceV1,
} from '@/features/orchestration/domain/canonical-offering-egress';
import type { OrchestrationStore, RecentTurn } from '@/features/orchestration/ports/orchestration-store';
import { activeSessionRecentTurnsV1, deriveConversationCourseFocusV1 } from '@/features/orchestration/domain/course-focus';
import { classifyBatchSalesSignal } from '@/features/orchestration/domain/sales-signal';
import { loadConversationSessionConfig } from '@/lib/config';
import type { AgentAProposedActionV1, AgentATurnProposalV1 } from '../domain/agent-a-brain';
import { authorizeAgentTurnV2 } from '../domain/agent-turn-policy-v2';
import {
  buildCanonicalFactRegistry,
  TEMPORARY_TEST_PAYMENT_FACT_ID,
} from '../domain/canonical-fact-registry';
import type {
  CanonicalFactV1,
  ConversationStateTransitionV1,
} from '../domain/conversation-pipeline';
import {
  createDefaultConversationStateV1,
  effectiveConversationStateV1,
  type ContactIntakeV1,
} from '../domain/conversation-planner';
import {
  customerResumesCommercialFlowAfterCallV1,
  reconcileTerminalCallStateV1,
} from '../domain/call-lifecycle-reconciliation';
import { claimsImmediateCallDispatchV1, claimsImmediatePaymentLinkDelivery, solicitsACall } from '../domain/operational-promise-guard';
import type { ConversationStateStoreV1 } from '../ports/conversation-state-store';
import type { PaymentVerificationV1 } from '@/features/payments/application/read-payment-verification';
import type { CourseBonusCapabilityV1 } from '@/features/promotions/application/read-course-bonus-capability';
import { claimsUnverifiedCallProgressV1 } from '@/shared/conversation/call-progress-claim';
import {
  evaluateCallIntakeReadinessV1,
  type CallIntakeReadinessV1,
} from '@/features/calls/domain/call-intake-readiness';

export class AgentTurnV2RejectedError extends Error {
  readonly code = 'AGENT_TURN_V2_REJECTED';

  constructor(
    readonly reasons: readonly string[],
    readonly rejectionSubjects: readonly string[] = [],
  ) {
    super(`AGENT_TURN_V2_REJECTED:${reasons.join(',')}`);
    this.name = 'AgentTurnV2RejectedError';
  }
}

export interface AgentActionRejectionV1 {
  readonly action: 'request_call_now' | 'send_payment_link' | 'send_test_payment_link'
    | 'schedule_price_objection_checkin' | 'request_promotion_review' | 'offer_course_bonus' | 'accept_promotion';
  readonly status: 'needs_input' | 'rejected';
  readonly code: string;
  readonly codes: readonly string[];
  readonly missing_fields: readonly string[];
  readonly canonical_data: {
    readonly offering_code: string | null;
    readonly payment_plan: 'monthly_12' | 'monthly_6' | 'one_time' | null;
  };
  readonly retryable: boolean;
}

function actionRejectionV1(input: {
  readonly action: AgentActionRejectionV1['action'];
  readonly codes: readonly string[];
  readonly missing_fields: readonly string[];
  readonly offering_code: string | null;
  readonly payment_plan: 'monthly_12' | 'monthly_6' | 'one_time' | null;
}): AgentActionRejectionV1 {
  const codes = [...new Set(input.codes)];
  return {
    action: input.action,
    status: input.missing_fields.length > 0 || codes.includes('MISSING_INTAKE')
      || codes.includes('PLAN_NOT_SELECTED') ? 'needs_input' : 'rejected',
    code: codes[0] ?? 'ACTION_NOT_AUTHORIZED',
    codes,
    missing_fields: [...new Set(input.missing_fields)],
    canonical_data: {
      offering_code: input.offering_code,
      payment_plan: input.payment_plan,
    },
    retryable: false,
  };
}

function renderDecimal(amount: string): string {
  return amount.replace(/(\.\d*?[1-9])0+$/u, '$1').replace(/\.0+$/u, '');
}

function protectedFactsFromCitations(input: {
  readonly facts: readonly CanonicalFactV1[];
  readonly authorized_fact_ids: readonly string[];
  readonly business_context: BusinessContextView | null;
}): ProtectedFactRef[] {
  const authorized = new Set(input.authorized_fact_ids);
  const result: ProtectedFactRef[] = [];
  for (const fact of input.facts) {
    if (!authorized.has(fact.id)) continue;
    if (fact.id === TEMPORARY_TEST_PAYMENT_FACT_ID) {
      result.push({ kind: 'price', value: 'USD 0.50' });
      result.push({ kind: 'price', value: 'USD 0,50' });
    }
    if (fact.kind === 'offering_duration') result.push({ kind: 'duration', value: fact.value });
    if (fact.kind === 'offering_modality') result.push({ kind: 'modality', value: fact.value });
    if (fact.kind === 'payment_plan_price') result.push({ kind: 'price', value: fact.value });
    if (fact.kind === 'payment_plan_label' && fact.payment_plan) {
      const option = input.business_context?.workspace.payment_options.find(
        (candidate) => candidate.code === fact.payment_plan,
      );
      if (option) {
        result.push({
          kind: 'price',
          value: `${option.total.currency} ${renderDecimal(option.installment_amount)}`,
        });
      }
    }
  }
  return result;
}

function uniqueProtectedFacts(facts: readonly ProtectedFactRef[]): ProtectedFactRef[] {
  return [...new Map(facts.map((fact) => [`${fact.kind}\u0000${fact.value}`, fact])).values()];
}

function responseType(input: {
  readonly proposal: AgentATurnProposalV1;
  readonly response: string;
}): DecisionV4['response_type'] {
  if (input.proposal.proposed_action.type === 'request_call_now') return 'call_confirmation';
  // The promotion is the committed effect; an optional invitation remains
  // authored conversation and its existing state transition still applies.
  if (input.proposal.proposed_action.type === 'offer_course_bonus') return 'commercial_reply';
  const declaredOffer = input.proposal.response.call_offer;
  if ((declaredOffer && solicitsACall(declaredOffer, true)) || solicitsACall(input.response)) return 'call_offer';
  if (input.proposal.move.move === 'greeting') return 'social_reply';
  return 'commercial_reply';
}

function decisionFromAuthorizedTurn(input: {
  readonly proposal: AgentATurnProposalV1;
  readonly response: string;
  readonly selected_offering_code: string | null;
}): DecisionV4 {
  const action = input.proposal.proposed_action;
  const businessAction: DecisionV4['business_action'] = action.type === 'request_call_now'
    ? {
        type: 'request_call_now', reason: action.reason,
        ...(input.selected_offering_code ? { course_of_interest: input.selected_offering_code } : {}),
      }
    : action.type === 'send_payment_link'
      ? {
          type: 'send_payment_link', offering_sku: action.offering_code, plan_code: action.payment_plan,
          ...(action.promotion_code ? { promotion_code: action.promotion_code } : {}),
        }
      : action.type === 'send_test_payment_link'
        ? { type: 'send_test_payment_link', offering_sku: action.offering_code }
        : action.type === 'schedule_price_objection_checkin'
          ? action
          : action.type === 'request_promotion_review' || action.type === 'offer_course_bonus'
            ? action
            : action.type === 'accept_promotion'
              ? action
              : null;
  return {
    schema_version: 4,
    intent: input.proposal.move.move === 'greeting'
      ? 'social'
      : input.proposal.move.move === 'decline_call' || input.proposal.move.move === 'decline_purchase'
        ? 'commercial_decline'
        : 'commercial',
    kind: 'reply',
    response: input.response,
    response_type: responseType(input),
    confidence: input.proposal.move.confidence,
    reason_code: 'AGENT_A_PLANNERLESS_V2',
    business_action: businessAction,
    memory_candidates: [...input.proposal.memory_candidates],
    missing_information: [],
    next_state: input.proposal.move.move === 'decline_purchase' ? 'completed' : 'waiting_user',
    retrieval_used: null,
  };
}

/**
 * Backend preparation for a model-owned turn. It reloads authority and may
 * accept or reject the proposal, but never chooses the response goal or
 * rewrites the model's customer-facing language.
 */
export async function prepareAgentTurnV2(input: {
  readonly turn: {
    readonly id: string;
    readonly workspace_id: string;
    readonly conversation_id: string;
    readonly contact_id: string;
  };
  readonly workspace_slug: string;
  readonly current_customer_messages?: readonly string[];
  /** Internal server snapshot, never accepted from the model/wire proposal. */
  readonly course_focus_context?: {
    readonly recent_turns: readonly RecentTurn[];
    readonly batch_started_at: string;
  };
  readonly proposal: AgentATurnProposalV1;
  /** Retain semantic state while a model continuation cannot execute effects. */
  readonly conversation_only?: boolean;
  /** Original explicit request, retained only as semantic evidence by a continuation. */
  readonly requested_action?: AgentAProposedActionV1;
  readonly operational_continuity?: 'call_consent_revoked';
  /** Production Agent A keeps semantic checks diagnostic-only. */
  readonly semantic_rejections?: 'blocking' | 'advisory';
  readonly business_context: BusinessContextView | null;
  readonly catalog_index: CatalogIndexView | null;
  /** Canonical knowledge rows reloaded by the backend from cited fact IDs. */
  readonly authorized_knowledge_facts?: readonly CanonicalFactV1[];
  readonly course_bonus_capability?: CourseBonusCapabilityV1;
}, deps: {
  readonly state_store: Pick<ConversationStateStoreV1, 'load'>;
  readonly call_facts?: Pick<OrchestrationStore, 'loadClaimedCallFacts'>;
  readonly contact_intake?: (contactId: string) => Promise<ContactIntakeV1>;
  readonly call_intake_readiness?: (
    contactId: string,
    conversationId: string,
  ) => Promise<CallIntakeReadinessV1>;
  readonly payment_verification?: (input: {
    workspace_slug: string;
    contact_id: string;
    offering_code?: string | null;
    plan_code?: 'monthly_12' | 'monthly_6' | 'one_time' | null;
  }) => Promise<PaymentVerificationV1 | null>;
  readonly now?: () => number;
}): Promise<{
  readonly decision: DecisionV4;
  readonly response_messages: readonly string[];
  readonly transition: ConversationStateTransitionV1;
  readonly authorized_offering_code: string | null;
  readonly authorized_payment_plan: 'monthly_12' | 'monthly_6' | 'one_time' | null;
  readonly authorized_protected_facts: readonly ProtectedFactRef[];
  readonly action_rejection: AgentActionRejectionV1 | null;
  readonly discussed_offering_code: string | null;
  readonly commercial_interest_offering_code: string | null;
  readonly records_price_objection: boolean;
  /** Rule A: accept the offered direct package before reserving the link. */
  readonly auto_accept_promotion: boolean;
  /** A terminal sale followed by generic catalog browsing starts without the old promotion focus. */
  readonly resets_promotion_context: boolean;
  /** Explicit course switch retires open packages and prior unpaid intents. */
  readonly abandons_course_bonus_offer: boolean;
}> {
  const nowMs = deps.now?.() ?? Date.now();
  const [loaded, callFacts, contactIntake, strictCallIntakeReadiness] = await Promise.all([
    deps.state_store.load(input.workspace_slug, input.turn.conversation_id, input.turn.contact_id),
    deps.call_facts?.loadClaimedCallFacts({
      conversation_id: input.turn.conversation_id,
      contact_id: input.turn.contact_id,
    }) ?? Promise.resolve(null),
    deps.contact_intake?.(input.turn.contact_id) ?? Promise.resolve(undefined),
    deps.call_intake_readiness?.(input.turn.contact_id, input.turn.conversation_id)
      ?? Promise.resolve(undefined),
  ]);
  const callIntakeReadiness = strictCallIntakeReadiness ?? evaluateCallIntakeReadinessV1({
    intake: contactIntake ?? { nombre: null, apellido: null, correo: null, telefono: null },
    // Compatibility for isolated callers; production supplies durable
    // evidence and the final reservation always revalidates it under lock.
    email_evidence: contactIntake?.correo
      ? { direction: 'inbound', message_type: 'text', channel: 'whatsapp' }
      : null,
  });
  const sessionState = loaded
    ? effectiveConversationStateV1(
        loaded,
        nowMs,
        loadConversationSessionConfig().sessionIdleMs,
      )
    : createDefaultConversationStateV1(input.turn);
  const currentCustomerMessages = input.current_customer_messages ?? [];
  const salesSignal = classifyBatchSalesSignal(
    currentCustomerMessages,
    { pendingCallReply: sessionState.awaiting_reply === 'call_or_chat' },
  );
  if (input.operational_continuity === 'call_consent_revoked'
    && (salesSignal.type !== 'call_decline' || input.conversation_only !== true
      || input.proposal.move.move !== 'decline_call' || input.proposal.proposed_action.type !== 'none'
      || input.proposal.move.secondary_moves.length > 0 || input.proposal.move.course_reference !== undefined
      || input.proposal.move.payment_plan !== undefined || (input.proposal.profile_updates?.length ?? 0) > 0
      || (input.proposal.profile_requests?.length ?? 0) > 0 || input.proposal.memory_candidates.length > 0)) {
    throw new AgentTurnV2RejectedError(['ACTION_NOT_AUTHORIZED'], ['call_revocation_outdated']);
  }
  const state = callFacts === null
    ? sessionState
    : reconcileTerminalCallStateV1(sessionState, callFacts, {
        current_customer_signal: salesSignal.type,
        current_customer_resumes_commercial_flow:
          customerResumesCommercialFlowAfterCallV1(currentCustomerMessages),
      });
  const awaitingCallAvailability = state.call_preference === 'call'
    && state.call_offer_status === 'accepted'
    && state.awaiting_reply === 'call_or_chat';
  const paymentVerification = await deps.payment_verification?.({
    workspace_slug: input.workspace_slug, contact_id: input.turn.contact_id,
    offering_code: state.selected_offering_code, plan_code: state.selected_payment_plan,
  }) ?? null;
  const registry = buildCanonicalFactRegistry({
    business_context: input.business_context,
    catalog_index: input.catalog_index,
  });
  const canonicalOfferingCodes = new Set(
    (input.catalog_index?.offerings ?? input.business_context?.offerings ?? []).map((offering) => offering.code),
  );
  const supplementalFacts = (input.authorized_knowledge_facts ?? []).filter((fact) => (
    fact.kind === 'offering_syllabus'
    && fact.source === 'knowledge_base'
    && /^knowledge-source:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(fact.id)
    && fact.offering_code !== undefined
    && canonicalOfferingCodes.has(fact.offering_code)
    && !registry.facts.has(fact.id)
  ));
  const facts = [...registry.facts.values(), ...supplementalFacts];
  const offerings = (input.catalog_index?.offerings ?? input.business_context?.offerings ?? []).map(
    (offering) => ({
      code: offering.code,
      display_name: offering.display_name,
      aliases: offering.aliases,
    }),
  );
  const mentionFocus = deriveConversationCourseFocusV1({
    currentMessageTexts:currentCustomerMessages,
    recentTurns:activeSessionRecentTurnsV1(input.course_focus_context?.recent_turns ?? [],
      [{created_at:input.course_focus_context?.batch_started_at ?? new Date(nowMs).toISOString()}],
      loadConversationSessionConfig().sessionIdleMs),
    catalogIndex:input.catalog_index ?? (input.business_context ? {
      as_of:input.business_context.as_of,
      offerings_total:offerings.length+input.business_context.offerings_truncated,
      offerings:input.business_context.offerings.map(offering=>({
        code:offering.code,display_name:offering.display_name,aliases:offering.aliases,academy:offering.academy,
      })),
      injection_suspected_count:input.business_context.injection_suspected_count,
    } : null),
  });
  const noActiveCall = callFacts?.active_call == null;
  const currentCallAuthorization = salesSignal.type === 'direct_call_request';
  const authorize = (proposal: AgentATurnProposalV1, effectsAllowed = input.conversation_only !== true,
    semanticRejections = input.semantic_rejections) => {
    const availabilityConfirmed = salesSignal.type === 'call_acceptance'
      || salesSignal.type === 'direct_call_request';
    return authorizeAgentTurnV2({
    proposal,
    state,
    offerings,
    facts,
    contact_intake: contactIntake,
    ...(paymentVerification?.status === 'paid' && paymentVerification.paid_at !== null
      ? { paid_purchase: paymentVerification } : {}),
    payment_verified: paymentVerification?.status === 'paid'
      && paymentVerification.paid_at !== null
      && paymentVerification.offering_code === state.selected_offering_code
      && (state.selected_payment_plan === null
        || paymentVerification.plan_code === state.selected_payment_plan),
    current_customer_messages: input.current_customer_messages,
    paid_mention_offering_code:mentionFocus.offering_code,
    course_bonus: input.course_bonus_capability,
    semantic_rejections: semanticRejections,
    action_rejections: 'structured',
    effects_allowed: effectsAllowed,
    call_policy: {
      // A refusal closes the invitation in that turn, not the whole sales
      // conversation. The per-turn authority below still blocks an immediate
      // repeat; the durable counter keeps the lifetime ceiling at two.
      may_offer_call: noActiveCall,
      // A direct request is current-turn authority. Accepting an invitation
      // only prepares the call; a later reply to the availability question is
      // the separate authority to dispatch.
      may_request_call_now: noActiveCall
        && (currentCallAuthorization || (awaitingCallAvailability && availabilityConfirmed))
        && callIntakeReadiness.status === 'ready',
      intake_ready: callIntakeReadiness.status === 'ready',
    },
    });
  };
  if (input.requested_action !== undefined && input.conversation_only !== true) {
    throw new AgentTurnV2RejectedError(['ACTION_NOT_AUTHORIZED']);
  }
  const requestedProposal = input.requested_action === undefined ? input.proposal
    : { ...input.proposal, proposed_action: input.requested_action };
  const effectiveProposal = { ...requestedProposal, memory_candidates: requestedProposal.memory_candidates.filter(candidate =>
    !(candidate.type === 'objection' && candidate.key === 'price_objection'
      || candidate.type === 'constraint' && candidate.key === 'price_only_barrier' && candidate.value === 'confirmed')
    || priceObservationQuoteInBatchV1(candidate.source_quote, currentCustomerMessages)) };
  const authority = authorize(effectiveProposal);
  let actionRejection: AgentActionRejectionV1 | null = null;

  // A delivered package must be accepted before checkout. Returning only a
  // stripped action here would let the conversational owner believe it had
  // advanced while the durable offer remained pending. Send this narrow
  // conflict through the existing model repair receipt instead, where the
  // current capability re-authorizes `accept_promotion` but not a simple link.
  if (authority.ok
    && input.course_bonus_capability?.status === 'offer_available'
    && input.course_bonus_capability.may_accept_offer
    && effectiveProposal.proposed_action.type === 'send_payment_link'
    && authority.action.type === 'none') {
    throw new AgentTurnV2RejectedError(
      ['ACTION_NOT_AUTHORIZED'],
      ['promotion_acceptance_required'],
    );
  }

  if (authority.ok
    && effectiveProposal.proposed_action.type !== 'none'
    && authority.action.type === 'none') {
    const actionCodes = (authority.advisory_reasons ?? []).filter((reason) => (
      reason === 'ACTION_NOT_AUTHORIZED' || reason === 'MISSING_INTAKE'
    ));
    if (actionCodes.length > 0) {
      const rejectedAction = effectiveProposal.proposed_action.type;
      const requiredFields = rejectedAction === 'request_call_now'
        ? callIntakeReadiness.requirements.map(({ field }) => field)
        : rejectedAction === 'send_payment_link' || rejectedAction === 'send_test_payment_link'
          ? (['nombre', 'apellido', 'correo', 'telefono'] as const)
          : [];
      actionRejection = actionRejectionV1({
        action: rejectedAction,
        codes: [...new Set(actionCodes)],
        missing_fields: rejectedAction === 'request_call_now'
          ? requiredFields
          : requiredFields.filter((field) => !contactIntake?.[field]),
        offering_code: state.selected_offering_code,
        payment_plan: state.selected_payment_plan,
      });
    }
  }

  if (!authority.ok) {
    throw new AgentTurnV2RejectedError(authority.reasons, authority.rejection_subjects);
  }
  // P:208–212/236: a revoked consent cannot survive as a stale accepted
  // semantic transition. The agent repairs the complete proposal, not its copy.
  if (salesSignal.type === 'call_decline' && (
    effectiveProposal.proposed_action.type === 'request_call_now'
    || effectiveProposal.move.move === 'request_call'
    || (authority.transition.call_preference === 'call' && authority.transition.call_offer_status === 'accepted')
  )) throw new AgentTurnV2RejectedError(['ACTION_NOT_AUTHORIZED'], ['call_consent_revoked']);
  if (state.call_offer_status === 'declined' && !currentCallAuthorization
    && authority.transition.call_preference === 'call' && authority.transition.call_offer_status === 'accepted') {
    throw new AgentTurnV2RejectedError(['ACTION_NOT_AUTHORIZED'], ['call_consent_missing']);
  }
  if (claimsUnverifiedCallProgressV1(authority.response, callFacts?.active_call?.status)) {
    throw new AgentTurnV2RejectedError(['UNSUPPORTED_OPERATIONAL_CLAIM'], ['call_in_progress']);
  }
  // Reject a false completion, so Agent A can rewrite it through the existing
  // repair path. Do not publish "here is the link" with a removed side effect.
  if (authority.action.type !== 'send_payment_link' && authority.action.type !== 'send_test_payment_link'
    && claimsImmediatePaymentLinkDelivery(authority.response)) {
    throw new AgentTurnV2RejectedError(['ACTION_NOT_AUTHORIZED']);
  }
  if (authority.action.type !== 'request_call_now'
    && claimsImmediateCallDispatchV1(authority.response, callFacts?.active_call?.status)) {
    throw new AgentTurnV2RejectedError(['ACTION_NOT_AUTHORIZED']);
  }

  const transition: ConversationStateTransitionV1 = {
    workspace_slug: input.workspace_slug,
    conversation_id: input.turn.conversation_id,
    contact_id: input.turn.contact_id,
    ...authority.transition,
    payment_link_request: authority.transition.payment_link_request === null
      ? null
      : {
          ...authority.transition.payment_link_request,
          requested_by_turn_id: authority.transition.payment_link_request.requested_by_turn_id
            ?? input.turn.id,
        },
    source_turn_id: input.turn.id,
  };
  const decision = decisionFromAuthorizedTurn({
    proposal: { ...effectiveProposal, proposed_action: authority.action },
    response: authority.response,
    selected_offering_code: authority.transition.selected_offering_code,
  });
  const catalogFacts = materializeCanonicalCatalogFacts({
    content: authority.response,
    offerings: offerings.map((offering) => ({ code: offering.code, display_name: offering.display_name })),
  });
  const responseOfferingCode = singleCanonicalOfferingReferenceV1({
    content: authority.response,
    offerings: offerings.map((offering) => ({ code: offering.code, display_name: offering.display_name })),
  });
  const resetsPromotionContext = state.stage === 'closed'
    && [effectiveProposal.move.move, ...effectiveProposal.move.secondary_moves].includes('browse_catalog');
  const commercialInterestOfferingCode = resetsPromotionContext
    ? null
    : authority.discussed_offering_code
      ?? input.course_bonus_capability?.interest_offering_code
      ?? state.selected_offering_code
      ?? responseOfferingCode;
  const recordsPriceObjection = commercialInterestOfferingCode !== null && (
    authority.action.type === 'schedule_price_objection_checkin'
    || authority.action.type === 'request_promotion_review'
    || effectiveProposal.memory_candidates.some((candidate) => (
      candidate.type === 'objection' && candidate.key === 'price_objection'
    ))
  );
  const previousPurchaseCourse = state.selected_offering_code
    ?? input.course_bonus_capability?.interest_offering_code;
  // The policy owns effective selection, including an exact course carried by
  // request_call. Information/comparison moves preserve the prior selection.
  const explicitlySelectsAnotherCourse = authority.transition.selected_offering_code !== null
    && previousPurchaseCourse !== null
    && previousPurchaseCourse !== undefined
    && authority.transition.selected_offering_code
      !== previousPurchaseCourse;
  const abandonsCourseBonusOffer = authority.action.type !== 'accept_promotion'
    && explicitlySelectsAnotherCourse;
  return {
    decision,
    response_messages: authority.response_messages,
    transition,
    authorized_offering_code: authority.transition.selected_offering_code,
    authorized_payment_plan: authority.action.type === 'send_payment_link'
      ? authority.action.payment_plan
      : [effectiveProposal.move.move, ...effectiveProposal.move.secondary_moves].includes('select_payment_plan')
        ? authority.transition.selected_payment_plan
        : null,
    authorized_protected_facts: uniqueProtectedFacts([
      ...protectedFactsFromCitations({
        facts,
        authorized_fact_ids: authority.authorized_fact_ids,
        business_context: input.business_context,
      }),
      ...catalogFacts,
    ]),
    action_rejection: actionRejection,
    discussed_offering_code: authority.discussed_offering_code,
    commercial_interest_offering_code: commercialInterestOfferingCode,
    records_price_objection: recordsPriceObjection,
    auto_accept_promotion: authority.auto_accept_promotion === true,
    resets_promotion_context: resetsPromotionContext,
    abandons_course_bonus_offer: abandonsCourseBonusOffer,
  };
}
