import type { AgentAProposedActionV1, AgentATurnProposalV1 } from './agent-a-brain';
import type {
  AwaitingReplyV1,
  CallOfferStatusV1,
  CallPreferenceV1,
  CanonicalFactV1,
  ConversationStateV1,
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
}

export type AgentTurnRejectionReasonV2 =
  | 'FACT_NOT_AUTHORIZED'
  | 'UNSUPPORTED_STATE_ASSERTION'
  | 'ACTION_NOT_AUTHORIZED'
  | 'MISSING_INTAKE'
  | 'CALL_OFFER_NOT_AUTHORIZED';

export type AgentTurnAuthorityResultV2 = {
  readonly ok: true;
  readonly response: string;
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
  readonly call_policy: {
    readonly may_offer_call: boolean;
    readonly may_request_call_now: boolean;
  };
}): AgentTurnAuthorityResultV2 {
  const { proposal, state } = input;
  const moves = allMoves(proposal);
  const requestedOffering = resolveOffering(proposal.move.course_reference, input.offerings);
  const changesCourse = moves.has('select_course') || moves.has('ask_course_information');
  const selectedOffering = requestedOffering ?? state.selected_offering_code;
  const courseChanged = selectedOffering !== state.selected_offering_code;
  const selectedPlan = proposal.move.payment_plan ?? (courseChanged ? null : state.selected_payment_plan);
  const selectionChanged = courseChanged || selectedPlan !== state.selected_payment_plan;
  const plannedPaymentReported = moves.has('report_payment') || state.payment_reported_at !== null;
  const stateFacts = materializeStateFactsV1({
    intake: input.contact_intake,
    planned_payment_reported: plannedPaymentReported,
  });
  const factsById = new Map(input.facts.map((fact) => [fact.id, fact]));
  const authorizedFactIds: string[] = [];
  const reasons: AgentTurnRejectionReasonV2[] = [];

  for (const factId of proposal.used_fact_ids) {
    if (stateFactId(factId)) {
      if (stateFacts.has(factId)) authorizedFactIds.push(factId);
      else reasons.push('FACT_NOT_AUTHORIZED');
      continue;
    }
    const fact = factsById.get(factId);
    const navigationFact = fact?.kind === 'area_name' || fact?.kind === 'offering_name';
    const selectedOfferingFact = fact !== undefined
      && fact.kind !== 'payment_link'
      && fact.offering_code === selectedOffering;
    if (fact && (navigationFact || selectedOfferingFact)) authorizedFactIds.push(factId);
    else reasons.push('FACT_NOT_AUTHORIZED');
  }

  const authoredMessages = [...proposal.response.messages];
  const authoredCallOffer = proposal.response.call_offer?.trim() || null;
  const visibleCallOffer = authoredCallOffer !== null
    || authoredMessages.some((message) => solicitsACall(message));
  if (visibleCallOffer && (
    !input.call_policy.may_offer_call
    || selectedOffering === null
    || state.call_offer_count >= 2
    || state.call_offer_status === 'accepted'
    || state.call_offer_status === 'declined'
    || proposal.move.vetoes.includes('call')
  )) {
    reasons.push('CALL_OFFER_NOT_AUTHORIZED');
  }

  let action: AgentAProposedActionV1 = { type: 'none' };
  const paymentDeferred = moves.has('defer_payment') || moves.has('decline_purchase')
    || proposal.move.vetoes.includes('payment_link')
    || proposal.move.vetoes.includes('purchase');
  const paymentLinkRequested = !paymentDeferred && (moves.has('request_payment_link')
    || (moves.has('provide_contact_details') && !selectionChanged
      && state.awaiting_reply === 'contact_details'));
  if (proposal.proposed_action.type === 'request_call_now') {
    const requested = moves.has('request_call') && !proposal.move.vetoes.includes('call');
    if (!requested || !input.call_policy.may_request_call_now) reasons.push('ACTION_NOT_AUTHORIZED');
    else action = proposal.proposed_action;
  }
  if (proposal.proposed_action.type === 'send_payment_link') {
    const matchesState = selectedOffering !== null
      && proposal.proposed_action.offering_code === selectedOffering
      && selectedPlan !== null
      && proposal.proposed_action.payment_plan === selectedPlan;
    if (!paymentLinkRequested || !matchesState
      || proposal.move.vetoes.includes('payment_link')
      || proposal.move.vetoes.includes('purchase')) {
      reasons.push('ACTION_NOT_AUTHORIZED');
    } else if (!stateFacts.has('state:intake_recorded:v1')) {
      reasons.push('MISSING_INTAKE');
    } else {
      action = proposal.proposed_action;
    }
  }
  if (
    proposal.proposed_action.type === 'none'
    && paymentLinkRequested
    && selectedOffering !== null
    && selectedPlan !== null
    && !proposal.move.vetoes.includes('payment_link')
    && !proposal.move.vetoes.includes('purchase')
    && stateFacts.has('state:intake_recorded:v1')
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

  const rawResponse = [...authoredMessages, ...(authoredCallOffer ? [authoredCallOffer] : [])]
    .join('\n\n');
  const response = dropUnsupportedStateAssertionsV1(rawResponse, stateFacts).trim();
  if (!response) return { ok: false, reasons: ['UNSUPPORTED_STATE_ASSERTION'] };

  let nextOffering = state.selected_offering_code;
  let nextPlan = state.selected_payment_plan;
  let stage = state.stage;
  let callPreference = state.call_preference;
  let callOfferStatus = state.call_offer_status;
  let callOfferCount = state.call_offer_count;
  let awaitingReply = state.awaiting_reply;

  if (changesCourse && requestedOffering) {
    if (courseChanged) {
      nextPlan = null;
      awaitingReply = 'none';
    }
    nextOffering = requestedOffering;
    stage = 'course_selected';
  }
  if (moves.has('select_payment_plan') && proposal.move.payment_plan && selectedOffering) {
    nextOffering = selectedOffering;
    nextPlan = proposal.move.payment_plan;
    stage = 'plan_selected';
    // A saved plan is not permission to deliver its link. Only the explicit
    // request below can carry that permission through a pending intake.
    awaitingReply = 'payment_confirmation';
  }
  if (
    moves.has('request_payment_link') && !paymentDeferred
    && selectedOffering !== null
    && selectedPlan !== null
    && !stateFacts.has('state:intake_recorded:v1')
  ) {
    nextOffering = selectedOffering;
    nextPlan = selectedPlan;
    stage = 'plan_selected';
    awaitingReply = 'contact_details';
  }
  if (moves.has('continue_by_chat') || moves.has('decline_call')) {
    callPreference = moves.has('decline_call') ? 'declined' : 'chat';
    callOfferStatus = 'declined';
    if (awaitingReply === 'call_or_chat') awaitingReply = 'none';
  }
  if (visibleCallOffer) {
    callOfferCount = Math.min(2, state.call_offer_count + 1) as 1 | 2;
    callOfferStatus = 'offered';
    if (awaitingReply !== 'contact_details') awaitingReply = 'call_or_chat';
  }
  if (action.type === 'request_call_now') {
    callPreference = 'call';
    callOfferStatus = 'accepted';
    awaitingReply = 'none';
    stage = 'handoff';
  }
  if (action.type === 'send_payment_link') {
    nextOffering = action.offering_code;
    nextPlan = action.payment_plan;
    awaitingReply = 'none';
    stage = 'payment_link_sent';
  }
  if (paymentDeferred) awaitingReply = 'none';
  if (moves.has('decline_purchase')) {
    stage = 'closed';
    awaitingReply = 'none';
  }

  return {
    ok: true,
    response,
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
    },
  };
}
