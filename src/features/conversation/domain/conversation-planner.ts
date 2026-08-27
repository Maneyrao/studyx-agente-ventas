import type {
  AwaitingReplyV1,
  CallOfferStatusV1,
  CallPreferenceV1,
  CanonicalFactRequestV1,
  ConversationMoveKindV1,
  ConversationMoveV1,
  ConversationStateV1,
  ConversationVetoV1,
  MissingInformationV1,
  ResponseGoalV1,
  TurnPlanV1,
} from './conversation-pipeline';

export interface PlanningBusinessContextV1 {
  readonly catalog_available: boolean;
  readonly areas: ReadonlyArray<{ readonly code: string; readonly display_name: string }>;
  readonly offerings: ReadonlyArray<{
    readonly code: string;
    readonly display_name: string;
    readonly area_code: string | null;
    readonly aliases?: readonly string[];
  }>;
  readonly payment_plans: readonly ('monthly_12' | 'monthly_6' | 'one_time')[];
}

export interface PlanConversationTurnInputV1 {
  readonly move: ConversationMoveV1;
  readonly sales_context: ConversationStateV1;
  readonly business_context: PlanningBusinessContextV1;
}

type StateIdentity = Pick<ConversationStateV1, 'workspace_id' | 'conversation_id' | 'contact_id'>;

export function createDefaultConversationStateV1(identity: StateIdentity): ConversationStateV1 {
  return {
    ...identity,
    selected_offering_code: null,
    selected_payment_plan: null,
    stage: 'exploring',
    call_preference: 'unknown',
    call_offer_status: 'not_offered',
    awaiting_reply: 'none',
    source_turn_id: null,
    version: 0,
    created_at: '1970-01-01T00:00:00.000Z',
    updated_at: '1970-01-01T00:00:00.000Z',
  };
}

export function canonicalReferenceKey(value: string): string {
  let output = '';
  let pendingSpace = false;
  for (const character of value.trim().toLocaleLowerCase('es').normalize('NFD')) {
    const code = character.codePointAt(0) ?? 0;
    if (code >= 0x0300 && code <= 0x036f) continue;
    const isWhitespace = character === ' ' || character === '\t' || character === '\n' || character === '\r';
    if (isWhitespace) {
      pendingSpace = output.length > 0;
      continue;
    }
    if (pendingSpace) output += ' ';
    output += character;
    pendingSpace = false;
  }
  return output;
}

function resolveOffering(reference: string | undefined, business: PlanningBusinessContextV1): string | null {
  if (!reference) return null;
  const key = canonicalReferenceKey(reference);
  const matches = business.offerings.filter((offering) => (
    canonicalReferenceKey(offering.code) === key
    || canonicalReferenceKey(offering.display_name) === key
    || (offering.aliases ?? []).some((alias) => canonicalReferenceKey(alias) === key)
  ));
  return matches.length === 1 ? matches[0].code : null;
}

function resolveArea(reference: string | undefined, business: PlanningBusinessContextV1): string | null {
  if (!reference) return null;
  const key = canonicalReferenceKey(reference);
  const matches = business.areas.filter(
    (area) => canonicalReferenceKey(area.code) === key || canonicalReferenceKey(area.display_name) === key,
  );
  return matches.length === 1 ? matches[0].code : null;
}

function unchangedPlan(
  state: ConversationStateV1,
  responseGoal: ResponseGoalV1 = 'clarify_current_step',
  missing: readonly MissingInformationV1[] = [],
): TurnPlanV1 {
  return {
    schema_version: 1,
    next_stage: state.stage,
    response_goal: responseGoal,
    canonical_fact_requests: [],
    allowed_business_action: { type: 'none' },
    missing_information: [...missing],
    should_offer_call: false,
    next_call_preference: state.call_preference,
    next_call_offer_status: state.call_offer_status,
    next_awaiting_reply: state.awaiting_reply,
    selected_offering_code: state.selected_offering_code,
    selected_payment_plan: state.selected_payment_plan,
  };
}

function asState(plan: TurnPlanV1, previous: ConversationStateV1): ConversationStateV1 {
  return {
    ...previous,
    stage: plan.next_stage,
    selected_offering_code: plan.selected_offering_code,
    selected_payment_plan: plan.selected_payment_plan,
    call_preference: plan.next_call_preference,
    call_offer_status: plan.next_call_offer_status,
    awaiting_reply: plan.next_awaiting_reply,
  };
}

function uniqueRequests(requests: readonly CanonicalFactRequestV1[]): CanonicalFactRequestV1[] {
  const seen = new Set<string>();
  return requests.filter((request) => {
    const key = JSON.stringify(request);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function factsForOffering(offeringCode: string): CanonicalFactRequestV1[] {
  return [
    { kind: 'offering_name', offering_code: offeringCode },
    { kind: 'offering_description', offering_code: offeringCode },
    { kind: 'offering_duration', offering_code: offeringCode },
    { kind: 'offering_modality', offering_code: offeringCode },
  ];
}

function shouldOfferCall(state: ConversationStateV1, vetoes: ReadonlySet<ConversationVetoV1>): boolean {
  return state.selected_offering_code !== null
    && state.call_preference === 'unknown'
    && state.call_offer_status === 'not_offered'
    && !vetoes.has('call');
}

function incompatible(moves: readonly ConversationMoveKindV1[], vetoes: ReadonlySet<ConversationVetoV1>): boolean {
  const active = new Set(moves.filter((move) => {
    if (move === 'request_call' && vetoes.has('call')) return false;
    if (move === 'request_payment_link' && (vetoes.has('payment_link') || vetoes.has('purchase'))) return false;
    return true;
  }));
  if (active.has('request_call') && active.has('decline_call')) return true;
  if (active.has('request_call') && active.has('request_payment_link')) return true;
  if (active.has('request_payment_link') && (active.has('defer_payment') || active.has('decline_purchase'))) return true;
  return false;
}

function planSingle(
  kind: ConversationMoveKindV1,
  input: PlanConversationTurnInputV1,
  state: ConversationStateV1,
  vetoes: ReadonlySet<ConversationVetoV1>,
): TurnPlanV1 {
  const business = input.business_context;
  const move = input.move;
  if (!business.catalog_available && kind !== 'greeting' && kind !== 'decline_call') {
    return unchangedPlan(state, 'catalog_temporarily_unavailable', ['catalog_snapshot']);
  }

  if (kind === 'greeting') {
    return { ...unchangedPlan(state, 'greet_and_discover'), next_awaiting_reply: 'area_choice' };
  }
  if (kind === 'browse_catalog') {
    return {
      ...unchangedPlan(state, 'guide_area_choice', ['area_reference']),
      canonical_fact_requests: [{ kind: 'area_options', limit: 3 }],
      next_awaiting_reply: 'area_choice',
    };
  }
  if (kind === 'select_area') {
    const areaCode = resolveArea(move.area_reference, business);
    if (!areaCode) return unchangedPlan(state, 'guide_area_choice', ['area_reference']);
    return {
      ...unchangedPlan(state, 'guide_course_choice', ['course_selection']),
      canonical_fact_requests: [{ kind: 'course_options', area_code: areaCode, limit: 3 }],
      next_awaiting_reply: 'course_choice',
    };
  }
  if (kind === 'select_course') {
    const offeringCode = resolveOffering(move.course_reference, business);
    if (!offeringCode) return unchangedPlan(state, 'guide_course_choice', ['course_reference']);
    const changed = offeringCode !== state.selected_offering_code;
    return {
      ...unchangedPlan(state, 'explain_selected_course'),
      next_stage: 'course_selected',
      canonical_fact_requests: factsForOffering(offeringCode),
      next_awaiting_reply: 'none',
      selected_offering_code: offeringCode,
      selected_payment_plan: changed ? null : state.selected_payment_plan,
    };
  }
  if (kind === 'ask_course_information') {
    const offeringCode = resolveOffering(move.course_reference, business) ?? state.selected_offering_code;
    if (!offeringCode) return unchangedPlan(state, 'guide_course_choice', ['course_selection']);
    const offerCall = shouldOfferCall({ ...state, selected_offering_code: offeringCode }, vetoes);
    return {
      ...unchangedPlan(state, 'explain_selected_course'),
      next_stage: 'course_selected',
      canonical_fact_requests: factsForOffering(offeringCode),
      should_offer_call: offerCall,
      next_call_offer_status: offerCall ? 'offered' : state.call_offer_status,
      next_awaiting_reply: offerCall ? 'call_or_chat' : state.awaiting_reply,
      selected_offering_code: offeringCode,
    };
  }
  if (kind === 'continue_by_chat') {
    const acceptedChoice = state.awaiting_reply === 'call_or_chat' || state.call_offer_status === 'offered';
    return {
      ...unchangedPlan(
        state,
        acceptedChoice ? 'acknowledge_chat_preference' : 'continue_course_advice',
        state.selected_offering_code ? [] : ['course_selection'],
      ),
      canonical_fact_requests: state.selected_offering_code
        ? factsForOffering(state.selected_offering_code).slice(0, 2)
        : [],
      next_call_preference: acceptedChoice ? 'chat' : state.call_preference,
      next_call_offer_status: acceptedChoice ? 'declined' : state.call_offer_status,
      next_awaiting_reply: acceptedChoice ? 'none' : state.awaiting_reply,
    };
  }
  if (kind === 'decline_call') {
    return {
      ...unchangedPlan(state, 'acknowledge_call_decline'),
      next_call_preference: 'declined',
      next_call_offer_status: 'declined',
      next_awaiting_reply: 'none',
    };
  }
  if (kind === 'request_call') {
    if (vetoes.has('call')) return unchangedPlan(state, 'clarify_current_step', ['call_or_chat_choice']);
    return {
      ...unchangedPlan(state, 'confirm_call_request'),
      next_stage: 'handoff',
      allowed_business_action: { type: 'request_call_now', reason: 'direct_request' },
      next_call_preference: 'call',
      next_call_offer_status: 'accepted',
      next_awaiting_reply: 'none',
    };
  }
  if (kind === 'ask_payment_options') {
    const offeringCode = resolveOffering(move.course_reference, business) ?? state.selected_offering_code;
    if (!offeringCode) return unchangedPlan(state, 'guide_course_choice', ['course_selection']);
    return {
      ...unchangedPlan(state, 'present_payment_options', ['payment_plan']),
      canonical_fact_requests: [{ kind: 'payment_options', offering_code: offeringCode }],
      next_awaiting_reply: 'payment_plan',
      selected_offering_code: offeringCode,
    };
  }
  if (kind === 'select_payment_plan') {
    const offeringCode = resolveOffering(move.course_reference, business) ?? state.selected_offering_code;
    if (!offeringCode) return unchangedPlan(state, 'guide_course_choice', ['course_selection']);
    if (!move.payment_plan || !business.payment_plans.includes(move.payment_plan)) {
      return unchangedPlan(state, 'present_payment_options', ['payment_plan']);
    }
    return {
      ...unchangedPlan(state, 'confirm_selected_plan', ['payment_confirmation']),
      next_stage: 'plan_selected',
      canonical_fact_requests: [{ kind: 'payment_options', offering_code: offeringCode }],
      next_awaiting_reply: 'payment_confirmation',
      selected_offering_code: offeringCode,
      selected_payment_plan: move.payment_plan,
    };
  }
  if (kind === 'defer_payment') {
    if (!state.selected_payment_plan) return unchangedPlan(state, 'present_payment_options', ['payment_plan']);
    return {
      ...unchangedPlan(state, 'acknowledge_payment_deferral'),
      next_stage: 'plan_selected',
      next_awaiting_reply: 'payment_confirmation',
    };
  }
  if (kind === 'request_payment_link') {
    if (vetoes.has('payment_link') || vetoes.has('purchase')) {
      return unchangedPlan(state, 'acknowledge_payment_deferral');
    }
    const offeringCode = resolveOffering(move.course_reference, business) ?? state.selected_offering_code;
    const paymentPlan = move.payment_plan ?? state.selected_payment_plan;
    if (!offeringCode) return unchangedPlan(state, 'guide_course_choice', ['course_selection']);
    if (!paymentPlan) return unchangedPlan(state, 'present_payment_options', ['payment_plan']);
    return {
      ...unchangedPlan(state, 'confirm_payment_link'),
      next_stage: 'payment_link_sent',
      canonical_fact_requests: [{ kind: 'payment_link', offering_code: offeringCode, payment_plan: paymentPlan }],
      allowed_business_action: { type: 'send_payment_link', offering_code: offeringCode, payment_plan: paymentPlan },
      next_awaiting_reply: 'none',
      selected_offering_code: offeringCode,
      selected_payment_plan: paymentPlan,
    };
  }
  if (kind === 'decline_purchase') {
    return {
      ...unchangedPlan(state, 'acknowledge_purchase_decline'),
      next_stage: 'closed',
      next_awaiting_reply: 'none',
    };
  }
  return unchangedPlan(state, 'clarify_current_step');
}

export function planConversationTurn(input: PlanConversationTurnInputV1): TurnPlanV1 {
  const { move } = input;
  const vetoes = new Set(move.vetoes);
  if (move.confidence < 0.75 || move.move === 'unknown') {
    return unchangedPlan(input.sales_context, 'clarify_current_step');
  }
  const moves = [move.move, ...move.secondary_moves];
  if (incompatible(moves, vetoes)) {
    return unchangedPlan(input.sales_context, 'clarify_current_step');
  }

  let state = input.sales_context;
  let result = unchangedPlan(state);
  const accumulatedRequests: CanonicalFactRequestV1[] = [];
  for (const kind of moves) {
    result = planSingle(kind, input, state, vetoes);
    accumulatedRequests.push(...result.canonical_fact_requests);
    state = asState(result, state);
  }
  return {
    ...result,
    canonical_fact_requests: uniqueRequests(accumulatedRequests),
    should_offer_call: vetoes.has('call') ? false : result.should_offer_call,
    allowed_business_action:
      (vetoes.has('call') && result.allowed_business_action.type === 'request_call_now')
      || ((vetoes.has('payment_link') || vetoes.has('purchase'))
        && result.allowed_business_action.type === 'send_payment_link')
        ? { type: 'none' }
        : result.allowed_business_action,
  };
}
