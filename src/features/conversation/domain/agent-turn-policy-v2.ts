import { supportsChatPreferenceV1 } from './channel-preference-evidence';
import type { AgentAProposedActionV1, AgentATurnProposalV1 } from './agent-a-brain';
import type { CourseBonusCapabilityV1 } from '@/features/promotions/application/read-course-bonus-capability';
import type {
  AwaitingReplyV1,
  CallOfferStatusV1,
  CallPreferenceV1,
  CanonicalFactV1,
  ConversationStateV1,
  PaymentLinkRequestV1,
} from './conversation-pipeline';
import { TEMPORARY_TEST_PAYMENT_FACT_ID } from './canonical-fact-registry';
import type { SalesContextStage, SalesPaymentPlan } from '@/features/sales/domain/sales-context';
import {
  dropUnsupportedStateAssertionsV1,
  solicitsACall,
  unsupportedOperationalAssertionsV1,
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
  readonly payment_link_request: PaymentLinkRequestV1 | null;
}

export type AgentTurnRejectionReasonV2 =
  | 'COMMERCIAL_TRUTH_VIOLATION'
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
  /** Exact catalog course referenced by Agent A this turn. It is interest,
   * not purchase selection, and is persisted separately by the commit layer. */
  readonly discussed_offering_code: string | null;
  /** Present when semantic checks run as diagnostics instead of a copy veto. */
  readonly advisory_reasons?: readonly AgentTurnRejectionReasonV2[];
  readonly rejection_subjects?: readonly string[];
} | {
  readonly ok: false;
  readonly reasons: readonly AgentTurnRejectionReasonV2[];
  /** Exact durable facts the authored response claimed without authority. */
  readonly rejection_subjects?: readonly string[];
};

function referenceKey(value: string): string {
  return value.trim().toLocaleLowerCase('es').normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .replace(/\s+/gu, ' ');
}

export function resolveAgentTurnOfferingReferenceV2(
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

function explicitlyRequestsPaymentLink(messages: readonly string[] | undefined): boolean {
  const text = (messages ?? []).join('\n').normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '').toLocaleLowerCase('es');
  return /\b(?:pasame|mandame|enviame|compartime|dame|quiero|necesito|me\s+(?:pasas|mandas|envias|compartis|compartes|das)|(?:podes|puedes)\s+(?:pasarme|mandarme|enviarme|compartirme|darme))\b[^.!?\n]{0,48}\b(?:link|enlace)\b/u.test(text)
    || /\b(?:link|enlace)\b[^.!?\n]{0,32}\b(?:pago|pagar|cuota)\b/u.test(text);
}

function allMoves(proposal: AgentATurnProposalV1): Set<string> {
  return new Set([proposal.move.move, ...proposal.move.secondary_moves]);
}

function stateFactId(value: string): value is StateFactIdV1 {
  return value === 'state:intake_recorded:v1'
    || value === 'state:payment_reported:v1'
    || value === 'state:payment_verified:v1'
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
  /** Revalidated from the signed Stripe ledger at commit time. */
  readonly payment_verified?: boolean;
  readonly paid_purchase?: { readonly offering_code: string; readonly plan_code: SalesPaymentPlan | null };
  readonly current_customer_messages?: readonly string[];
  readonly course_bonus?: CourseBonusCapabilityV1;
  /** A continuation retains its semantic transition without executing effects. */
  readonly effects_allowed?: boolean;
  /**
   * Agent A owns customer-facing copy in production. `advisory` preserves the
   * exact response while this boundary still reduces unauthorized effects to
   * `none`. The strict mode remains useful for offline policy evaluation.
   */
  readonly semantic_rejections?: 'blocking' | 'advisory';
  /** Return an action-only veto as data while preserving safe Agent A prose. */
  readonly action_rejections?: 'blocking' | 'structured';
  readonly call_policy: {
    readonly may_offer_call: boolean;
    readonly may_request_call_now: boolean;
    /** Canonical persisted intake readiness for the current claimed turn. */
    readonly intake_ready?: boolean;
  };
}): AgentTurnAuthorityResultV2 {
  const { proposal, state } = input;
  const moves = allMoves(proposal);
  const requestedOffering = resolveAgentTurnOfferingReferenceV2(proposal.move.course_reference, input.offerings);
  const capabilityInterestOffering = input.course_bonus?.interest_offering_code ?? null;
  const requestedOfferingIsPresentedBonus = requestedOffering !== null
    && input.course_bonus?.bonus_offerings.some((offering) => offering.code === requestedOffering) === true;
  const acceptsPresentedPromotion = proposal.proposed_action.type === 'accept_promotion'
    && input.course_bonus?.may_accept_offer === true
    && capabilityInterestOffering !== null
    && !moves.has('ask_course_information')
    && !moves.has('browse_catalog')
    && !moves.has('decline_purchase')
    && !proposal.move.vetoes.includes('purchase')
    && (requestedOffering === null
      || requestedOffering === capabilityInterestOffering
      || requestedOfferingIsPresentedBonus);
  // A call must carry the course currently being discussed, not a stale
  // selection from an earlier sale. Merely asking a comparative question
  // remains non-mutating; `request_call` is the execution boundary where an
  // exact model-owned reference becomes the active course for the handoff.
  // Accepting a presented package is different from switching to its bonus.
  // The durable offer owns the paid course even when the customer names the
  // included course while accepting it.
  const changesCourse = !acceptsPresentedPromotion && (moves.has('select_course')
    || (moves.has('request_call') && requestedOffering !== null));
  const selectedOfferingCandidate = acceptsPresentedPromotion
    ? capabilityInterestOffering
    : changesCourse ? requestedOffering : state.selected_offering_code;
  const selectedOffering = input.offerings.some(offering => offering.code === selectedOfferingCandidate)
    ? selectedOfferingCandidate : null;
  const acceptedPromotionOwnsBonusReference = input.course_bonus?.status === 'accepted'
    && input.course_bonus.may_send_promoted_payment === true
    && capabilityInterestOffering !== null
    && selectedOffering === capabilityInterestOffering
    && requestedOfferingIsPresentedBonus
    && !changesCourse;
  // A promotion capability belongs to the exact course that produced it. An
  // explicit course switch wins, while naming an included course during an
  // accepted package checkout keeps the paid course and its durable benefit.
  const currentCommercialInterest = acceptsPresentedPromotion || acceptedPromotionOwnsBonusReference
    ? capabilityInterestOffering
    : requestedOffering
    ?? capabilityInterestOffering
    ?? selectedOffering;
  const promotionMatchesCurrentInterest = capabilityInterestOffering !== null
    && currentCommercialInterest === capabilityInterestOffering;
  const promotionMatchesSelectedPurchase = capabilityInterestOffering !== null
    && selectedOffering === capabilityInterestOffering;
  const selectedOfferingIsPresentedBonus = selectedOffering !== null
    && input.course_bonus?.bonus_offerings.some((offering) => offering.code === selectedOffering) === true;
  const selectedOfferingBelongsToPresentedPackage = promotionMatchesSelectedPurchase
    || selectedOfferingIsPresentedBonus;
  const requestedOfferingBelongsToPresentedPackage = requestedOffering === capabilityInterestOffering
    || requestedOfferingIsPresentedBonus;
  const promotionEligibleForPurchase = input.course_bonus?.may_send_promoted_payment === true
    && promotionMatchesSelectedPurchase
    && promotionMatchesCurrentInterest;
  const offeredPromotionNeedsAcceptance = input.course_bonus?.status === 'offer_available'
    && input.course_bonus.may_accept_offer === true
    && (selectedOfferingBelongsToPresentedPackage || requestedOfferingBelongsToPresentedPackage);
  const authorizedPromotionCode = promotionEligibleForPurchase
    ? input.course_bonus.promotion_code
    : null;
  const factOffering = moves.has('ask_course_information') && requestedOffering !== null
    ? requestedOffering
    : selectedOffering;
  const courseChanged = selectedOffering !== state.selected_offering_code;
  const canonicalPlan = (plan: SalesPaymentPlan | null | undefined): plan is SalesPaymentPlan => (
    selectedOffering !== null && plan != null && input.facts.some(fact => (
      fact.kind === 'payment_plan_label' && fact.offering_code === selectedOffering && fact.payment_plan === plan
    ))
  );
  // Agent A owns the current choice. Check its canonical resource rather than
  // reinterpreting the customer's wording with a second payment classifier.
  const selectedCurrentPlan = moves.has('select_payment_plan') && canonicalPlan(proposal.move.payment_plan)
    ? proposal.move.payment_plan : null;
  const selectsPaymentPlanNow = selectedCurrentPlan !== null;
  const invalidCurrentPaymentSelection = moves.has('select_payment_plan')
    && selectedCurrentPlan === null;
  const resumesDurablePlan = moves.has('request_payment_link')
    && state.selected_payment_plan !== null
    && !selectsPaymentPlanNow;
  // A link request without a simultaneous plan-selection move always uses the
  // already persisted customer choice. Agent A owns the meaning of the request;
  // the backend prevents an incidental model field from replacing that plan.
  const durablePlan = !courseChanged && canonicalPlan(state.selected_payment_plan)
    ? state.selected_payment_plan : null;
  const selectedPlan = invalidCurrentPaymentSelection ? null : selectedCurrentPlan ?? durablePlan;
  const plannedPaymentReported = moves.has('report_payment') || state.payment_reported_at !== null;
  const stateFacts = materializeStateFactsV1({
    intake: input.contact_intake,
    planned_payment_reported: plannedPaymentReported,
    payment_verified: input.payment_verified === true,
  });
  const factsById = new Map(input.facts.map((fact) => [fact.id, fact]));
  const authorizedFactIds: string[] = [];
  const reasons: AgentTurnRejectionReasonV2[] = [];
  if (invalidCurrentPaymentSelection) {
    reasons.push('ACTION_NOT_AUTHORIZED');
  }

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
    const workspacePlanFact = fact?.kind === 'payment_plan_label'
      && fact.offering_code === undefined
      && fact.id === `payment-workspace:${fact.payment_plan}:label:v1`;
    const temporaryTestPaymentFact = fact?.id === TEMPORARY_TEST_PAYMENT_FACT_ID
      && proposal.proposed_action.type === 'send_test_payment_link';
    if (fact && (navigationFact || browsingCourseDetail || selectedOfferingFact || workspacePlanFact || temporaryTestPaymentFact)) {
      authorizedFactIds.push(factId);
    }
    else reasons.push('FACT_NOT_AUTHORIZED');
  }

  const authoredMessages = [...proposal.response.messages];
  const currentText = (input.current_customer_messages ?? []).join('\n');
  const resumesAcceptedCall = state.call_preference === 'call'
    && state.call_offer_status === 'accepted';
  const completesAcceptedCallIntake = resumesAcceptedCall
    && state.awaiting_reply === 'contact_details'
    && input.call_policy.intake_ready === true
    && moves.has('provide_contact_details');
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
  const authoredCallOffer = proposal.response.call_offer ?? null;
  const rejectionSubjects = unique([
    ...authoredMessages,
    ...(authoredCallOffer === null ? [] : [authoredCallOffer]),
  ].flatMap((message) => (
    unsupportedOperationalAssertionsV1(message, stateFacts).map((assertion) => assertion.requires)
  )));
  const inspectedCallOffer = authoredCallOffer === null
    ? null
    : dropUnsupportedStateAssertionsV1(authoredCallOffer, stateFacts);
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
  const inspectedMessages = authoredMessages.map((message) => (
    dropUnsupportedStateAssertionsV1(message, stateFacts)
  ));
  // The backend is an authority boundary, not a copy editor. If any sentence
  // depends on state that is not durable yet, reject the complete proposal so
  // Agent A can rewrite it. Never delete, shorten or replace model-authored
  // customer copy here.
  if (inspectedMessages.some((message, index) => message !== authoredMessages[index])
    || inspectedCallOffer !== authoredCallOffer) {
    reasons.push('UNSUPPORTED_STATE_ASSERTION');
  }
  if (authoredCallOffer !== null && solicitsACall(authoredCallOffer, true)
    && !mayDeliverCallOffer && !callRequestSupported) {
    reasons.push('CALL_OFFER_NOT_AUTHORIZED');
  }
  const visibleCallOffer = (authoredCallOffer !== null && solicitsACall(authoredCallOffer, true))
    || !requestedCallNow && authoredMessages.some((message) => solicitsACall(message));
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
  // A customer's historical claim is evidence of what they said, not a paid
  // purchase and not an indefinite veto of later payment requests.
  const selectedPurchasePaid = input.paid_purchase
    ? input.paid_purchase.offering_code === selectedOffering
      && input.paid_purchase.plan_code === selectedPlan
    : input.payment_verified === true
      && selectedOffering === state.selected_offering_code
      && selectedPlan === state.selected_payment_plan;
  // Contact data and payment consent are separate durable steps. A complete
  // intake never authorizes checkout in the same turn it is first assembled.
  // The prior turn must have persisted both a pending link request and the
  // `payment_confirmation` wait; only the customer's next confirmation may
  // consume that request. This makes reconfirmation a state boundary rather
  // than optional wording in the prompt.
  const paymentConfirmationSatisfied = state.awaiting_reply === 'payment_confirmation';
  // `payment_plan` is a structured checkpoint created when Agent A explicitly
  // asked how the customer wants to pay. A canonical plan selection answering
  // that checkpoint is checkout intent; no raw-text reinterpretation or extra
  // "dale" is needed. Intake, promotion, paid-state and veto boundaries below
  // still own authorization.
  const answersRequestedPaymentPlan = state.awaiting_reply === 'payment_plan'
    && selectsPaymentPlanNow;
  const explicitlyResumesDurablePlan = resumesDurablePlan
    && explicitlyRequestsPaymentLink(input.current_customer_messages);
  const paymentLinkWasAlreadyDelivered = state.stage === 'payment_link_sent'
    && state.selected_offering_code === selectedOffering
    && state.selected_payment_plan === selectedPlan;
  const sameTurnPlanAndCheckoutRequested = selectsPaymentPlanNow
    && moves.has('request_payment_link')
    && explicitlyRequestsPaymentLink(input.current_customer_messages);
  const paymentLinkBaseAuthorized = !moves.has('report_payment') && !selectedPurchasePaid
    && !(promotionMatchesSelectedPurchase && input.course_bonus?.package_status === 'attached'
      && !input.course_bonus.may_send_promoted_payment)
    && stateFacts.has('state:intake_recorded:v1');
  const paymentLinkAuthorized = paymentLinkBaseAuthorized
    && (paymentConfirmationSatisfied || paymentLinkWasAlreadyDelivered
      || explicitlyResumesDurablePlan
      || sameTurnPlanAndCheckoutRequested
      || answersRequestedPaymentPlan
      || (pendingPaymentRequest !== null && moves.has('provide_contact_details')));
  // Asking for the next missing field is also prompt guidance. Missing intake
  // remains a hard boundary only for the payment side effect below.
  const explicitPaymentLinkRequested = proposal.proposed_action.type === 'send_payment_link'
    && selectedOffering !== null && proposal.proposed_action.offering_code === selectedOffering
    && selectedPlan !== null && proposal.proposed_action.payment_plan === selectedPlan
    && !moves.has('report_payment') && !selectedPurchasePaid;
  const paymentLinkRequestedNow = !paymentRequestWithdrawn
    && (moves.has('request_payment_link') || explicitPaymentLinkRequested
      || answersRequestedPaymentPlan);
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
    const matchesPromotion = proposal.proposed_action.promotion_code === undefined
      || authorizedPromotionCode === proposal.proposed_action.promotion_code;
    if (!paymentLinkRequested || !matchesState || !matchesPromotion
      || offeredPromotionNeedsAcceptance
      || (promotionEligibleForPurchase && authorizedPromotionCode === null)
      || proposal.move.vetoes.includes('payment_link')
      || proposal.move.vetoes.includes('purchase')) {
      reasons.push('ACTION_NOT_AUTHORIZED');
    } else if (!stateFacts.has('state:intake_recorded:v1')) {
      reasons.push('MISSING_INTAKE');
    } else if (!paymentLinkBaseAuthorized) {
      reasons.push('ACTION_NOT_AUTHORIZED');
    } else if (paymentLinkAuthorized) {
      action = {
        type: 'send_payment_link',
        offering_code: selectedOffering,
        payment_plan: selectedPlan,
        ...(authorizedPromotionCode ? { promotion_code: authorizedPromotionCode } : {}),
      };
    }
  }
  if (proposal.proposed_action.type === 'send_test_payment_link') {
    const explicitlyRequested = moves.has('request_payment_link')
      && !proposal.move.vetoes.includes('payment_link')
      && !proposal.move.vetoes.includes('purchase');
    const matchesOffering = selectedOffering !== null
      && proposal.proposed_action.offering_code === selectedOffering;
    if (!explicitlyRequested || !matchesOffering) reasons.push('ACTION_NOT_AUTHORIZED');
    else if (!stateFacts.has('state:intake_recorded:v1')) reasons.push('MISSING_INTAKE');
    else action = proposal.proposed_action;
  }
  if (proposal.proposed_action.type === 'schedule_price_objection_checkin') {
    if (input.course_bonus?.may_schedule_checkin === true && promotionMatchesCurrentInterest) {
      action = proposal.proposed_action;
    }
    else reasons.push('ACTION_NOT_AUTHORIZED');
  }
  if (proposal.proposed_action.type === 'request_promotion_review') {
    const selectedBonusCode = proposal.proposed_action.bonus_offering_code;
    const selectedBonusIsActive = selectedBonusCode !== undefined
      && selectedBonusCode !== capabilityInterestOffering
      && input.offerings.some((offering) => offering.code === selectedBonusCode);
    const bonusSelectionAuthorized = input.course_bonus?.bonus_selection_mode === 'any_active_course'
      ? selectedBonusIsActive
      : selectedBonusCode === undefined
        || input.course_bonus?.bonus_offerings.some(
          (offering) => offering.code === selectedBonusCode,
        ) === true;
    if (input.course_bonus?.may_request_review === true
      && promotionMatchesCurrentInterest
      && bonusSelectionAuthorized) {
      action = proposal.proposed_action;
    }
    else reasons.push('ACTION_NOT_AUTHORIZED');
  }
  if (proposal.proposed_action.type === 'accept_promotion') {
    if (input.course_bonus?.enabled === true || input.course_bonus?.promotion_cycle_id) {
      const requested = proposal.proposed_action;
      const cap = input.course_bonus;
      if (!cap.may_accept_offer || !('promotion_cycle_id' in requested)
        || requested.promotion_cycle_id !== cap.promotion_cycle_id
        || requested.promotion_code !== cap.promotion_code || requested.offer_version !== cap.offer_version
        || requested.interest_offering_code !== cap.interest_offering_code || !promotionMatchesCurrentInterest) {
        return {ok:false,reasons:['COMMERCIAL_TRUTH_VIOLATION'],
          rejection_subjects:['forbidden_promise','direct_bonus:stale_offer_version']};
      }
    }
    if (input.course_bonus?.may_accept_offer === true && promotionMatchesCurrentInterest) {
      action = proposal.proposed_action;
    }
    else reasons.push('ACTION_NOT_AUTHORIZED');
  }
  if (proposal.proposed_action.type === 'offer_course_bonus') {
    const proposed = proposal.proposed_action;
    const cap = input.course_bonus;
    const reason = cap?.enabled !== true || cap.may_offer_bonus !== true ? 'bonus_disabled'
      : proposed.interest_offering_code !== capabilityInterestOffering || !promotionMatchesCurrentInterest
        || !input.offerings.some(o => o.code === proposed.bonus_offering_code) ? 'invalid_offering'
      : proposed.bonus_offering_code === capabilityInterestOffering ? 'same_as_paid_course'
      : cap.bonus_offerings.some(o => o.code === proposed.bonus_offering_code) ? 'duplicate_bonus'
      : cap.bonus_offerings.length >= (cap.max_bonus_courses ?? 0) ? 'bonus_limit_reached' : null;
    if (reason) return {ok:false,reasons:['COMMERCIAL_TRUTH_VIOLATION'],
      rejection_subjects:['forbidden_promise',`direct_bonus:${reason}`]};
    action = proposed;
  }
  if (
    proposal.proposed_action.type === 'none'
    && paymentLinkRequested
    && selectedOffering !== null
    && selectedPlan !== null
    && !proposal.move.vetoes.includes('payment_link')
    && !proposal.move.vetoes.includes('purchase')
    && paymentLinkAuthorized
    && !offeredPromotionNeedsAcceptance
    // Completing intake preserves the customer's pending request, but it must
    // not make the backend invent a checkout behind an Agent A confirmation
    // question. An explicit proposed action can still consume the request.
    && !(pendingPaymentRequest !== null && moves.has('provide_contact_details'))
  ) {
    // The model owns the conversational move; the backend owns side effects.
    // Materializing the action encoded by an authorized request is not a
    // conversational plan: it is the same narrow policy mapping used when the
    // model redundantly emits proposed_action, with canonical IDs only.
    action = {
      type: 'send_payment_link',
      offering_code: selectedOffering,
      payment_plan: selectedPlan,
      ...(authorizedPromotionCode ? { promotion_code: authorizedPromotionCode } : {}),
    };
  }

  // Effect authorization and conversational meaning are separate. Preserve
  // the validated selection/consent below, but do not turn this continuation
  // into dispatch, checkout, or a consumed pending request.
  if (input.effects_allowed === false) action = { type: 'none' };

  const rejectedActionOnly = proposal.proposed_action.type !== 'none'
    && reasons.length > 0
    && reasons.every((reason) => reason === 'ACTION_NOT_AUTHORIZED' || reason === 'MISSING_INTAKE');
  if (reasons.length > 0
    && !(rejectedActionOnly && input.action_rejections === 'structured')
    && input.semantic_rejections !== 'advisory') return {
    ok: false,
    reasons: unique(reasons),
    ...(rejectionSubjects.length > 0 ? { rejection_subjects: rejectionSubjects } : {}),
  };

  const responseMessages = [...authoredMessages, ...(authoredCallOffer ? [authoredCallOffer] : [])];
  const response = responseMessages
    .join('\n\n').trim();
  if (!response) return {
    ok: false,
    reasons: ['UNSUPPORTED_STATE_ASSERTION'],
    ...(rejectionSubjects.length > 0 ? { rejection_subjects: rejectionSubjects } : {}),
  };

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
  } else if (paymentRequestWithdrawn
    || ((changesCourse || acceptsPresentedPromotion) && courseChanged)
    || (
    selectsPaymentPlanNow && selectedPlan !== state.selected_payment_plan
  )) {
    paymentLinkRequest = paymentLinkRequest === null ? null : {
      ...paymentLinkRequest,
      status: 'withdrawn',
      resolved_by_decision_id: null,
    };
  }

  if (acceptsPresentedPromotion && capabilityInterestOffering && courseChanged) {
    nextOffering = capabilityInterestOffering;
    nextPlan = null;
    awaitingReply = 'none';
    stage = 'course_selected';
  } else if (changesCourse && requestedOffering) {
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
    paymentLinkRequestedNow
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
    paymentLinkRequestedNow
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
  // Historical call consent must not overwrite a newer payment checkpoint or
  // reopen availability after a fulfilled handoff. Resume only a pending call.
  } else if (callRequestSupported && (moves.has('request_call') || (
    state.awaiting_reply === 'call_or_chat'
    && !selectsPaymentPlanNow && !paymentLinkRequested
  ) || completesAcceptedCallIntake)) {
    // The customer chose the call, but dispatch always waits for a later
    // availability confirmation. Persist the prepared call while the agent
    // asks for that confirmation or for a missing callable number.
    callPreference = 'call';
    callOfferStatus = 'accepted';
    awaitingReply = input.call_policy.intake_ready === false
      ? 'contact_details'
      : 'call_or_chat';
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
    response_messages: responseMessages,
    action,
    authorized_fact_ids: unique(authorizedFactIds),
    state_facts: stateFacts,
    discussed_offering_code: acceptsPresentedPromotion
      ? capabilityInterestOffering
      : requestedOffering,
    ...(reasons.length > 0 ? { advisory_reasons: unique(reasons) } : {}),
    ...(rejectionSubjects.length > 0 ? { rejection_subjects: rejectionSubjects } : {}),
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
