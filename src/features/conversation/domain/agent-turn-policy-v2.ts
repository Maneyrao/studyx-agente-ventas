import { supportsChatPreferenceV1 } from './channel-preference-evidence';
import type { AgentAProposedActionV1, AgentATurnProposalV1 } from './agent-a-brain';
import type {
  AwaitingReplyV1,
  CallOfferStatusV1,
  CallPreferenceV1,
  CanonicalFactV1,
  ConversationStateV1,
  PaymentLinkRequestV1,
} from './conversation-pipeline';
import type { SalesContextStage, SalesPaymentPlan } from '@/features/sales/domain/sales-context';
import {
  dropUnsupportedStateAssertionsV1,
  solicitsACall,
} from './operational-promise-guard';
import {
  materializeStateFactsV1,
  type StateFactIdV1,
} from './state-fact-registry';
import type { ContactIntakeV1 } from './conversation-planner';
import {
  classifyCurrentPaymentIntent,
  derivePaymentPlanSelectionFromBatch,
} from '@/features/payments/domain/payment-choice-policy';

export interface PlannerlessOfferingV2 {
  readonly code: string;
  readonly display_name: string;
  readonly aliases?: readonly string[];
}

export interface AgentTurnStateTransitionV2 {
  readonly selected_offering_code: string | null;
  readonly selected_payment_plan: SalesPaymentPlan | null;
  readonly stage: SalesContextStage;
  readonly call_preference: CallPreferenceV1;
  readonly call_offer_status: CallOfferStatusV1;
  readonly call_offer_count: 0 | 1 | 2;
  readonly awaiting_reply: AwaitingReplyV1;
  readonly payment_reported: boolean;
  readonly payment_link_request: PaymentLinkRequestV1 | null;
}

export type AgentTurnRejectionReasonV2 =
  | 'FACT_NOT_AUTHORIZED'
  | 'UNSUPPORTED_STATE_ASSERTION'
  | 'ACTION_NOT_AUTHORIZED'
  | 'MISSING_INTAKE'
  | 'CALL_OFFER_NOT_AUTHORIZED'
  | 'CALL_OFFER_MESSAGE_BOUNDARY_INVALID'
  | 'CALL_OFFER_REQUIRED'
  | 'COURSE_NOT_RESOLVED'
  | 'CHANNEL_PREFERENCE_NOT_SUPPORTED';

export type AgentTurnAuthorityResultV2 = {
  readonly ok: true;
  readonly response: string;
  /** Customer-visible parts authored by the model, after state-claim pruning. */
  readonly response_messages: readonly string[];
  readonly action: AgentAProposedActionV1;
  readonly transition: AgentTurnStateTransitionV2;
  readonly authorized_fact_ids: readonly string[];
  readonly state_facts: ReadonlySet<StateFactIdV1>;
} | {
  readonly ok: false;
  readonly reasons: readonly AgentTurnRejectionReasonV2[];
};

function referenceKey(value: string): string {
  return value.trim().toLocaleLowerCase('es').normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .replace(/\s+/gu, ' ');
}

function resolveOffering(
  reference: string | undefined,
  offerings: readonly PlannerlessOfferingV2[],
): string | null {
  if (!reference) return null;
  const key = referenceKey(reference);
  const matches = offerings.filter((offering) => (
    referenceKey(offering.code) === key
    || referenceKey(offering.display_name) === key
    || (offering.aliases ?? []).some((alias) => referenceKey(alias) === key)
  ));
  return matches.length === 1 ? matches[0].code : null;
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function allMoves(proposal: AgentATurnProposalV1): Set<string> {
  return new Set([proposal.move.move, ...proposal.move.secondary_moves]);
}

function stateFactId(value: string): value is StateFactIdV1 {
  return value === 'state:intake_recorded:v1'
    || value === 'state:payment_reported:v1'
    || value === 'process:human_verification:v1'
    || value === 'process:access_after_verification:v1';
}

/**
 * Authorizes a complete model-owned turn without choosing its response goal or
 * wording. This is a policy boundary, not a conversational planner: it can
 * accept/reject facts and side effects and reduce durable state, never author
 * customer-facing copy.
 */
export function authorizeAgentTurnV2(input: {
  readonly proposal: AgentATurnProposalV1;
  readonly state: ConversationStateV1;
  readonly offerings: readonly PlannerlessOfferingV2[];
  readonly facts: readonly CanonicalFactV1[];
  readonly contact_intake?: ContactIntakeV1;
  readonly current_customer_messages?: readonly string[];
  readonly call_policy: {
    readonly may_offer_call: boolean;
    readonly may_request_call_now: boolean;
  };
}): AgentTurnAuthorityResultV2 {
  const { proposal, state } = input;
  const moves = allMoves(proposal);
  const requestedOffering = resolveOffering(proposal.move.course_reference, input.offerings);
  const changesCourse = moves.has('select_course');
  const selectedOffering = changesCourse
    ? requestedOffering ?? state.selected_offering_code
    : state.selected_offering_code;
  const factOffering = moves.has('ask_course_information') && requestedOffering !== null
    ? requestedOffering
    : selectedOffering;
  const courseChanged = selectedOffering !== state.selected_offering_code;
  const currentPaymentMessages = (input.current_customer_messages ?? [])
    .map((content) => ({ content }));
  const explicitCurrentPlan = derivePaymentPlanSelectionFromBatch(currentPaymentMessages);
  const currentPaymentIntent = classifyCurrentPaymentIntent(currentPaymentMessages);
  const committedCurrentPlan = currentPaymentIntent.kind === 'direct'
    ? currentPaymentIntent.planCode
    : null;
  // The customer's explicit current-turn choice outranks a mismatching model
  // field. The model still owns the reply; this boundary only chooses which
  // canonical plan may be persisted or materialized as a payment action.
  const selectedCurrentPlan = committedCurrentPlan ?? proposal.move.payment_plan;
  const selectsPaymentPlanNow = selectedCurrentPlan !== null && (
    moves.has('select_payment_plan')
    || selectedCurrentPlan === explicitCurrentPlan
  );
  const resumesDurablePlan = moves.has('request_payment_link')
    && state.selected_payment_plan !== null
    && !selectsPaymentPlanNow;
  // A link request without a simultaneous plan-selection move always uses the
  // already persisted customer choice. Agent A owns the meaning of the request;
  // the backend prevents an incidental model field from replacing that plan.
  const selectedPlan = resumesDurablePlan
    ? state.selected_payment_plan
    : selectedCurrentPlan ?? (courseChanged ? null : state.selected_payment_plan);
  const plannedPaymentReported = moves.has('report_payment') || state.payment_reported_at !== null;
  const stateFacts = materializeStateFactsV1({
    intake: input.contact_intake,
    planned_payment_reported: plannedPaymentReported,
  });
  const factsById = new Map(input.facts.map((fact) => [fact.id, fact]));
  const authorizedFactIds: string[] = [];
  const reasons: AgentTurnRejectionReasonV2[] = [];

  // An ambiguous course reference is a conversational miss, not a reason to
  // discard the reply. It simply cannot mutate the canonical course state.

  for (const factId of proposal.used_fact_ids) {
    if (stateFactId(factId)) {
      if (stateFacts.has(factId)) authorizedFactIds.push(factId);
      else reasons.push('FACT_NOT_AUTHORIZED');
      continue;
    }
    const fact = factsById.get(factId);
    const navigationFact = fact?.kind === 'area_name' || fact?.kind === 'offering_name';
    const browsingCourseDetail = factOffering === null && fact !== undefined
      && (fact.kind === 'offering_description'
        || fact.kind === 'offering_duration'
        || fact.kind === 'offering_modality')
      && input.offerings.some((offering) => offering.code === fact.offering_code);
    const selectedOfferingFact = fact !== undefined
      && fact.kind !== 'payment_link'
      && fact.offering_code === factOffering;
    if (fact && (navigationFact || browsingCourseDetail || selectedOfferingFact)) authorizedFactIds.push(factId);
    else reasons.push('FACT_NOT_AUTHORIZED');
  }

  const authoredMessages = [...proposal.response.messages];
  const currentText = (input.current_customer_messages ?? []).join('\n');
  const resumesAcceptedCall = state.call_preference === 'call'
    && state.call_offer_status === 'accepted';
  const channelChoice = moves.has('continue_by_chat') || moves.has('decline_call');
  const currentTurnRejectsCallOffer = channelChoice || supportsChatPreferenceV1(
    currentText,
    state.awaiting_reply === 'call_or_chat',
  );
  const callRequestSupported = !currentTurnRejectsCallOffer
    && !proposal.move.vetoes.includes('call')
    && (moves.has('request_call') || resumesAcceptedCall);
  const requestedCallNow = moves.has('request_call') && proposal.proposed_action.type === 'request_call_now'
    && input.call_policy.may_request_call_now && callRequestSupported
    && !proposal.move.vetoes.includes('call');
  const authoredCallOffer = proposal.response.call_offer?.trim() || null;
  const sanitizedCallOffer = authoredCallOffer === null
    ? null
    : dropUnsupportedStateAssertionsV1(authoredCallOffer, stateFacts).trim() || null;
  const mayDeliverCallOffer = input.call_policy.may_offer_call
    && state.call_offer_count < 2
    && state.call_preference !== 'call'
    && state.call_offer_status !== 'accepted'
    && state.stage !== 'handoff'
    && state.stage !== 'closed'
    && state.stage !== 'payment_link_sent'
    && !plannedPaymentReported
    && !currentTurnRejectsCallOffer
    && !proposal.move.vetoes.includes('call');
  // The invitation ceiling is a durable permission, including invitations
  // embedded in prose. Return it to the model for repair instead of silently
  // editing its response. A customer-initiated request never spends this budget.
  const proactiveCallOffer = !callRequestSupported && (
    (authoredCallOffer !== null && solicitsACall(authoredCallOffer, true))
    || authoredMessages.some((message) => solicitsACall(message))
  );
  if (proactiveCallOffer && state.call_offer_count >= 2) {
    reasons.push('CALL_OFFER_NOT_AUTHORIZED');
  }
  const authorizedCallOffer = sanitizedCallOffer !== null
    && (!solicitsACall(sanitizedCallOffer, true) || mayDeliverCallOffer)
    ? sanitizedCallOffer
    : null;
  const authorizedMessages = authoredMessages
    .map((message) => dropUnsupportedStateAssertionsV1(message, stateFacts).trim())
    .filter((message) => message.length > 0);
  const visibleCallOffer = (authorizedCallOffer !== null && solicitsACall(authorizedCallOffer, true))
    || !requestedCallNow && authorizedMessages.some((message) => solicitsACall(message));
  // Call timing and message boundaries are sales guidance. They remain in the
  // prompt and evaluation suite, but they never reject customer-facing copy.
  // Only an eligible visible invitation advances the durable call ledger.
  const callOfferCanAdvanceState = visibleCallOffer && mayDeliverCallOffer && !callRequestSupported;

  const supportedChannelChoice = channelChoice;
  if ((proposal.proposed_action.type === 'request_call_now' || (
    moves.has('request_call') && !callRequestSupported
  )) && !requestedCallNow) reasons.push('ACTION_NOT_AUTHORIZED');
  // Whether the model remembered the recommended first invitation is measured
  // as conversational quality; it is not transaction authority.

  let action: AgentAProposedActionV1 = { type: 'none' };
  // DeepSeek owns the semantic move. Reclassifying that move a second time
  // with text patterns made a correct deferral disappear when the customer
  // used wording the regex did not know. The backend still owns the effect:
  // these structured moves can only withdraw consent or close the sale; they
  // can never authorize a payment link.
  const paymentDeferred = moves.has('defer_payment');
  const purchaseDeclined = moves.has('decline_purchase') && !paymentDeferred;
  const paymentVetoed = proposal.move.vetoes.includes('payment_link')
    || proposal.move.vetoes.includes('purchase');
  const paymentRequestWithdrawn = paymentDeferred || purchaseDeclined || paymentVetoed;
  const pendingPaymentRequest = state.payment_link_request?.status === 'pending'
    && state.payment_link_request.offering_code === selectedOffering
    && state.payment_link_request.payment_plan === selectedPlan
    ? state.payment_link_request
    : null;
  const paymentLinkAuthorized = !plannedPaymentReported
    && stateFacts.has('state:intake_recorded:v1');
  // Asking for the next missing field is also prompt guidance. Missing intake
  // remains a hard boundary only for the payment side effect below.
  const paymentLinkRequestedNow = !paymentRequestWithdrawn && moves.has('request_payment_link');
  const paymentLinkRequested = paymentLinkRequestedNow
    || (!paymentRequestWithdrawn && pendingPaymentRequest !== null && moves.has('provide_contact_details'));
  if (proposal.proposed_action.type === 'request_call_now') {
    if (!requestedCallNow || proposal.move.vetoes.includes('call')) reasons.push('ACTION_NOT_AUTHORIZED');
    else action = resumesAcceptedCall && state.stage !== 'handoff'
      // This customer request was accepted before a callable number existed.
      // Supplying the number resumes that permission; it does not accept a
      // new agent offer. A fulfilled handoff cannot reuse this pending grant.
      ? { type: 'request_call_now', reason: 'direct_request' }
      : proposal.proposed_action;
  }
  if (proposal.proposed_action.type === 'send_payment_link') {
    const matchesState = selectedOffering !== null
      && proposal.proposed_action.offering_code === selectedOffering
      && selectedPlan !== null
      && (resumesDurablePlan || proposal.proposed_action.payment_plan === selectedPlan);
    if (!paymentLinkRequested || !matchesState
      || proposal.move.vetoes.includes('payment_link')
      || proposal.move.vetoes.includes('purchase')) {
      reasons.push('ACTION_NOT_AUTHORIZED');
    } else if (!stateFacts.has('state:intake_recorded:v1')) {
      reasons.push('MISSING_INTAKE');
    } else if (!paymentLinkAuthorized) {
      reasons.push('ACTION_NOT_AUTHORIZED');
    } else {
      action = resumesDurablePlan
        ? {
            type: 'send_payment_link',
            offering_code: selectedOffering,
            payment_plan: selectedPlan,
          }
        : proposal.proposed_action;
    }
  }
  if (proposal.proposed_action.type === 'send_test_payment_link') {
    const explicitlyRequested = moves.has('request_payment_link')
      && !proposal.move.vetoes.includes('payment_link')
      && !proposal.move.vetoes.includes('purchase');
    const matchesOffering = selectedOffering !== null
      && proposal.proposed_action.offering_code === selectedOffering;
    if (!explicitlyRequested || !matchesOffering) reasons.push('ACTION_NOT_AUTHORIZED');
    else action = proposal.proposed_action;
  }
  if (
    proposal.proposed_action.type === 'none'
    && paymentLinkRequested
    && selectedOffering !== null
    && selectedPlan !== null
    && !proposal.move.vetoes.includes('payment_link')
    && !proposal.move.vetoes.includes('purchase')
    && paymentLinkAuthorized
  ) {
    // The model owns the conversational move; the backend owns side effects.
    // Materializing the action encoded by an authorized request is not a
    // conversational plan: it is the same narrow policy mapping used when the
    // model redundantly emits proposed_action, with canonical IDs only.
    action = {
      type: 'send_payment_link',
      offering_code: selectedOffering,
      payment_plan: selectedPlan,
    };
  }

  if (reasons.length > 0) return { ok: false, reasons: unique(reasons) };

  const response = [...authorizedMessages, ...(authorizedCallOffer ? [authorizedCallOffer] : [])]
    .join('\n\n').trim();
  if (!response) return { ok: false, reasons: ['UNSUPPORTED_STATE_ASSERTION'] };

  let nextOffering = state.selected_offering_code;
  let nextPlan = state.selected_payment_plan;
  let stage = state.stage;
  let callPreference = state.call_preference;
  let callOfferStatus = state.call_offer_status;
  let callOfferCount = state.call_offer_count;
  let awaitingReply = state.awaiting_reply;
  let paymentLinkRequest: PaymentLinkRequestV1 | null = state.payment_link_request ?? null;

  if (paymentLinkRequestedNow && selectedOffering !== null && selectedPlan !== null) {
    paymentLinkRequest = {
      status: 'pending',
      offering_code: selectedOffering,
      payment_plan: selectedPlan,
      requested_by_turn_id: null,
      resolved_by_decision_id: null,
    };
  } else if (paymentRequestWithdrawn || (changesCourse && courseChanged) || (
    selectsPaymentPlanNow && selectedPlan !== state.selected_payment_plan
  )) {
    paymentLinkRequest = paymentLinkRequest === null ? null : {
      ...paymentLinkRequest,
      status: 'withdrawn',
      resolved_by_decision_id: null,
    };
  }

  if (changesCourse && requestedOffering) {
    if (courseChanged) {
      nextPlan = null;
      awaitingReply = 'none';
    }
    nextOffering = requestedOffering;
    stage = 'course_selected';
  }
  if (selectsPaymentPlanNow && selectedPlan && selectedOffering) {
    nextOffering = selectedOffering;
    nextPlan = selectedPlan;
    stage = 'plan_selected';
    // A saved plan is not permission to deliver its link. Only the explicit
    // request below can carry that permission through a pending intake.
    awaitingReply = 'payment_confirmation';
  }
  if (
    moves.has('request_payment_link') && !paymentRequestWithdrawn
    && selectedOffering !== null
    && selectedPlan !== null
    && !stateFacts.has('state:intake_recorded:v1')
  ) {
    nextOffering = selectedOffering;
    nextPlan = selectedPlan;
    stage = 'plan_selected';
    awaitingReply = 'contact_details';
  }
  if (
    moves.has('request_payment_link') && !paymentRequestWithdrawn
    && selectedOffering !== null
    && selectedPlan !== null
    && stateFacts.has('state:intake_recorded:v1')
    && !paymentLinkAuthorized
  ) {
    nextOffering = selectedOffering;
    nextPlan = selectedPlan;
    stage = 'plan_selected';
    awaitingReply = 'payment_confirmation';
  }
  if (
    moves.has('provide_contact_details')
    && selectedOffering !== null
    && selectedPlan !== null
    && stateFacts.has('state:intake_recorded:v1')
    && state.stage !== 'payment_link_sent'
  ) {
    stage = 'plan_selected';
    awaitingReply = 'payment_confirmation';
  }
  if (supportedChannelChoice) {
    // A refusal rejects the current invitation; it is not a global opt-out.
    // Keep the customer on chat and preserve the offer ledger so one different,
    // situational reminder may still happen later. Explicit opt-out is handled
    // by the channel consent boundary before this policy runs.
    callPreference = 'chat';
    if (callOfferStatus !== 'not_offered') callOfferStatus = 'declined';
    if (awaitingReply === 'call_or_chat') awaitingReply = 'none';
  }
  if (callOfferCanAdvanceState && !supportedChannelChoice) {
    callOfferCount = Math.min(2, state.call_offer_count + 1) as 1 | 2;
    if (callPreference === 'declined') callPreference = 'chat';
    callOfferStatus = 'offered';
    if (awaitingReply !== 'contact_details'
      && awaitingReply !== 'payment_confirmation'
      && paymentLinkRequest?.status !== 'pending') awaitingReply = 'call_or_chat';
  }
  if (action.type === 'request_call_now') {
    callPreference = 'call';
    callOfferStatus = 'accepted';
    awaitingReply = 'none';
    stage = 'handoff';
  } else if (callRequestSupported) {
    // The customer chose the call, but dispatch always waits for a later
    // availability confirmation. Persist the prepared call while the agent
    // asks for that confirmation or for a missing callable number.
    callPreference = 'call';
    callOfferStatus = 'accepted';
    awaitingReply = 'call_or_chat';
  }
  if (action.type === 'send_payment_link') {
    nextOffering = action.offering_code;
    nextPlan = action.payment_plan;
    awaitingReply = 'none';
    stage = 'payment_link_sent';
    paymentLinkRequest = {
      status: 'consumed',
      offering_code: action.offering_code,
      payment_plan: action.payment_plan,
      requested_by_turn_id: paymentLinkRequest?.requested_by_turn_id ?? null,
      resolved_by_decision_id: null,
    };
  }
  if (paymentRequestWithdrawn) awaitingReply = 'none';
  if (purchaseDeclined) {
    stage = 'closed';
    awaitingReply = 'none';
  }

  return {
    ok: true,
    response,
    response_messages: [...authorizedMessages, ...(authorizedCallOffer ? [authorizedCallOffer] : [])],
    action,
    authorized_fact_ids: unique(authorizedFactIds),
    state_facts: stateFacts,
    transition: {
      selected_offering_code: nextOffering,
      selected_payment_plan: nextPlan,
      stage,
      call_preference: callPreference,
      call_offer_status: callOfferStatus,
      call_offer_count: callOfferCount,
      awaiting_reply: awaitingReply,
      payment_reported: plannedPaymentReported,
      payment_link_request: paymentLinkRequest,
    },
  };
}
