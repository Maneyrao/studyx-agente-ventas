import type {
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

/**
 * The commercial contract is frozen at six data points. Two of them —
 * the canonical course and the canonical plan — already live in the
 * conversation state, so only these four are gathered from the customer.
 * The phone arrives with the channel identity rather than being asked for.
 *
 * Adding a field here is a change to the commercial contract, not a detail.
 */
export const CONTACT_INTAKE_FIELDS_V1 = ['nombre', 'apellido', 'correo', 'telefono'] as const;

export type ContactIntakeFieldV1 = typeof CONTACT_INTAKE_FIELDS_V1[number];

export type ContactIntakeV1 = {
  readonly [Field in ContactIntakeFieldV1]: string | null;
};

/** Blank-but-present is absent: a whitespace name bills nobody. */
export function missingContactIntakeFieldsV1(
  intake: ContactIntakeV1 | undefined,
): ContactIntakeFieldV1[] {
  if (!intake) return [...CONTACT_INTAKE_FIELDS_V1];
  return CONTACT_INTAKE_FIELDS_V1.filter((field) => (intake[field] ?? '').trim().length === 0);
}

export interface PlanConversationTurnInputV1 {
  readonly move: ConversationMoveV1;
  readonly sales_context: ConversationStateV1;
  readonly business_context: PlanningBusinessContextV1;
  /** Current backend call ledger capability; semantic meaning cannot grant it. */
  readonly proactive_call_offer_allowed?: boolean;
  /**
   * Whether the persisted session went quiet past the session window. Time is
   * not readable from a plan, so the caller measures it with
   * `isConversationSessionDormantV1` and hands the verdict in.
   */
  readonly session_dormant?: boolean;
  /**
   * The identity already durable in `contacts`. Absent means unknown, and
   * unknown is treated as missing: the gate never opens on ignorance.
   */
  readonly contact_intake?: ContactIntakeV1;
}

type StateIdentity = Pick<ConversationStateV1, 'workspace_id' | 'conversation_id' | 'contact_id'>;

export const CONVERSATION_STATE_MAX_IDLE_MS = 24 * 60 * 60 * 1_000;

/**
 * A pending question only stays pending while the customer is still in the
 * same sitting. Past this window the question expired: the next inbound
 * message must be read for what it says, never as an answer to something
 * asked hours earlier. Commercial selection survives — it is useful context,
 * not an open obligation — and is retired separately by the reopening-greeting
 * rule below or by the 24h full expiry.
 */
export const CONVERSATION_SESSION_IDLE_MS = 4 * 60 * 60 * 1_000;

export function createDefaultConversationStateV1(identity: StateIdentity): ConversationStateV1 {
  return {
    ...identity,
    selected_offering_code: null,
    selected_payment_plan: null,
    stage: 'exploring',
    call_preference: 'unknown',
    call_offer_status: 'not_offered',
    call_offer_count: 0,
    awaiting_reply: 'none',
    payment_reported_at: null,
    human_review_requested_at: null,
    consecutive_technical_fallbacks: 0,
    source_turn_id: null,
    version: 0,
    created_at: '1970-01-01T00:00:00.000Z',
    updated_at: '1970-01-01T00:00:00.000Z',
  };
}

export function effectiveConversationStateV1(
  state: ConversationStateV1,
  nowMs = Date.now(),
  sessionIdleMs = CONVERSATION_SESSION_IDLE_MS,
): ConversationStateV1 {
  const updatedAtMs = Date.parse(state.updated_at);
  if (!Number.isFinite(updatedAtMs) || nowMs < updatedAtMs) return state;
  const idleMs = nowMs - updatedAtMs;
  if (idleMs > CONVERSATION_STATE_MAX_IDLE_MS) {
    return {
      ...createDefaultConversationStateV1(state),
      version: state.version,
      created_at: state.created_at,
      updated_at: state.updated_at,
    };
  }
  if (idleMs > sessionIdleMs && state.awaiting_reply !== 'none') {
    return { ...state, awaiting_reply: 'none' };
  }
  return state;
}

/**
 * Terminal stages. A conversation that closed or went to a human is over; the
 * next greeting starts something new, no matter how recent it was.
 */
const TERMINAL_STAGES: ReadonlySet<ConversationStateV1['stage']> = new Set(['closed', 'handoff']);

/**
 * Whether the persisted session is dormant: quiet for longer than the session
 * window, so a greeting on top of it reopens rather than continues. Uses the
 * same window that expires a pending question, so both rules move together.
 */
export function isConversationSessionDormantV1(
  state: ConversationStateV1,
  nowMs = Date.now(),
  sessionIdleMs = CONVERSATION_SESSION_IDLE_MS,
): boolean {
  const updatedAtMs = Date.parse(state.updated_at);
  if (!Number.isFinite(updatedAtMs) || nowMs < updatedAtMs) return false;
  return nowMs - updatedAtMs > sessionIdleMs;
}

/**
 * Reopening boundary.
 *
 * A greeting is NOT by itself evidence that the customer is starting over —
 * people say hello in the middle of a live conversation, and throwing away
 * their course and plan there would be its own defect. What makes a greeting a
 * reopening is the state it lands on: one that is terminal, or one that has
 * been quiet past the session window.
 *
 * Reopening clears the commercial selection only. The call ledger and the
 * durable call preference survive — a customer who chose chat or declined a
 * call must never be offered one again — and so do identity, consent and the
 * concurrency version, so history and audit stay intact.
 */
function reopenedSessionState(state: ConversationStateV1): ConversationStateV1 {
  return {
    ...state,
    selected_offering_code: null,
    selected_payment_plan: null,
    stage: 'exploring',
    awaiting_reply: 'none',
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
    next_call_offer_count: state.call_offer_count,
    next_awaiting_reply: state.awaiting_reply,
    // A claim of payment, once made, is durable: no later move retracts it.
    payment_reported: state.payment_reported_at !== null,
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
    call_offer_count: plan.next_call_offer_count,
    awaiting_reply: plan.next_awaiting_reply,
    payment_reported_at: plan.payment_reported
      ? previous.payment_reported_at ?? REPORTED_THIS_TURN
      : previous.payment_reported_at,
  };
}

/**
 * Placeholder timestamp for a claim made in the turn currently being planned.
 * Planning is pure — it cannot read the clock — so the commit path stamps the
 * real time; only the truth of the claim is decided here.
 */
const REPORTED_THIS_TURN = '__reported_this_turn__';

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
    && state.call_offer_count < 2
    && state.call_offer_status !== 'accepted'
    && state.call_offer_status !== 'declined'
    && !vetoes.has('call');
}

function incompatible(moves: readonly ConversationMoveKindV1[], vetoes: ReadonlySet<ConversationVetoV1>): boolean {
  const active = new Set(moves.filter((move) => {
    if (move === 'request_call' && vetoes.has('call')) return false;
    if (move === 'request_payment_link' && (vetoes.has('payment_link') || vetoes.has('purchase'))) return false;
    return true;
  }));
  // A greeting carries no purchase intent. Reading "buenas tardes" as a
  // request to resume a payment is what sent a link to a customer who had
  // only said hello; the two moves cannot describe the same message.
  if (active.has('greeting')
    && (active.has('request_payment_link') || active.has('select_payment_plan'))) return true;
  // Reporting a completed payment and asking for a link to pay are opposite
  // tenses of the same event; one message cannot be both.
  if (active.has('report_payment')
    && (active.has('request_payment_link') || active.has('select_payment_plan'))) return true;
  if (active.has('request_call') && active.has('decline_call')) return true;
  if (active.has('request_call') && active.has('request_payment_link')) return true;
  if (active.has('request_payment_link') && (active.has('defer_payment') || active.has('decline_purchase'))) return true;
  return false;
}

/**
 * Some compatible moves have a domain dependency that is stronger than the
 * order chosen by the model. A payment plan must exist before the planner can
 * authorize its link. Both `select -> request` and `request -> select` mean
 * the same customer intent, so make that dependency explicit instead of
 * letting array order decide whether the sale advances.
 */
function orderCompoundMoves(moves: readonly ConversationMoveKindV1[]): ConversationMoveKindV1[] {
  const ordered = [...moves];
  const selectIndex = ordered.indexOf('select_payment_plan');
  const requestIndex = ordered.indexOf('request_payment_link');
  if (selectIndex < 0 || requestIndex < 0 || selectIndex < requestIndex) return ordered;
  ordered.splice(selectIndex, 1);
  ordered.splice(ordered.indexOf('request_payment_link'), 0, 'select_payment_plan');
  return ordered;
}

function requestContactDetails(state: ConversationStateV1): TurnPlanV1 {
  return {
    ...unchangedPlan(state, 'request_contact_details', ['contact_details']),
    next_awaiting_reply: 'contact_details',
  };
}

function paymentLinkPlan(
  state: ConversationStateV1,
  offeringCode: string,
  paymentPlan: NonNullable<ConversationStateV1['selected_payment_plan']>,
): TurnPlanV1 {
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
    const reopens = input.session_dormant === true || TERMINAL_STAGES.has(state.stage);
    return {
      ...unchangedPlan(reopens ? reopenedSessionState(state) : state, 'greet_and_discover'),
      next_awaiting_reply: reopens ? 'area_choice' : state.awaiting_reply,
    };
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
    const offerCall = input.proactive_call_offer_allowed !== false
      && shouldOfferCall({ ...state, selected_offering_code: offeringCode }, vetoes);
    return {
      ...unchangedPlan(state, 'explain_selected_course'),
      next_stage: 'course_selected',
      canonical_fact_requests: factsForOffering(offeringCode),
      should_offer_call: offerCall,
      next_call_offer_status: offerCall ? 'offered' : state.call_offer_status,
      next_call_offer_count: offerCall
        ? (Math.min(2, state.call_offer_count + 1) as 1 | 2)
        : state.call_offer_count,
      next_awaiting_reply: offerCall ? 'call_or_chat' : 'none',
      selected_offering_code: offeringCode,
      selected_payment_plan: changed ? null : state.selected_payment_plan,
    };
  }
  if (kind === 'ask_course_information') {
    const offeringCode = resolveOffering(move.course_reference, business) ?? state.selected_offering_code;
    if (!offeringCode) return unchangedPlan(state, 'guide_course_choice', ['course_selection']);
    const offerCall = input.proactive_call_offer_allowed !== false
      && shouldOfferCall({ ...state, selected_offering_code: offeringCode }, vetoes);
    return {
      ...unchangedPlan(state, 'explain_selected_course'),
      next_stage: 'course_selected',
      canonical_fact_requests: factsForOffering(offeringCode),
      should_offer_call: offerCall,
      next_call_offer_status: offerCall ? 'offered' : state.call_offer_status,
      next_call_offer_count: offerCall
        ? (Math.min(2, state.call_offer_count + 1) as 1 | 2)
        : state.call_offer_count,
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
        ? factsForOffering(state.selected_offering_code)
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
    const acceptedOffer = state.call_offer_status === 'offered'
      && state.awaiting_reply === 'call_or_chat';
    return {
      ...unchangedPlan(state, 'confirm_call_request'),
      next_stage: 'handoff',
      allowed_business_action: {
        type: 'request_call_now',
        reason: acceptedOffer ? 'accepted_offer' : 'direct_request',
      },
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
    if (!state.selected_payment_plan) {
      return {
        ...unchangedPlan(state, 'acknowledge_payment_deferral'),
        next_awaiting_reply: 'payment_plan',
      };
    }
    return {
      ...unchangedPlan(state, 'acknowledge_payment_deferral'),
      next_stage: 'plan_selected',
      next_awaiting_reply: 'payment_confirmation',
    };
  }
  if (kind === 'provide_contact_details') {
    // Supplying data is only ever the answer to a question we asked. If it
    // was, the link the customer already requested resumes on its own.
    if (state.awaiting_reply !== 'contact_details') {
      return unchangedPlan(state, 'clarify_current_step');
    }
    if (missingContactIntakeFieldsV1(input.contact_intake).length > 0) {
      return requestContactDetails(state);
    }
    const offeringCode = state.selected_offering_code;
    const paymentPlan = state.selected_payment_plan;
    if (!offeringCode) return unchangedPlan(state, 'guide_course_choice', ['course_selection']);
    if (!paymentPlan) return unchangedPlan(state, 'present_payment_options', ['payment_plan']);
    return paymentLinkPlan(state, offeringCode, paymentPlan);
  }
  if (kind === 'request_payment_link') {
    if (vetoes.has('payment_link') || vetoes.has('purchase')) {
      return unchangedPlan(state, 'acknowledge_payment_deferral');
    }
    const offeringCode = resolveOffering(move.course_reference, business) ?? state.selected_offering_code;
    const paymentPlan = move.payment_plan ?? state.selected_payment_plan;
    if (!offeringCode) return unchangedPlan(state, 'guide_course_choice', ['course_selection']);
    if (!paymentPlan) return unchangedPlan(state, 'present_payment_options', ['payment_plan']);
    // The six data points are what a human needs to process the sale. A link
    // sent without them produces a payment nobody can attribute.
    if (missingContactIntakeFieldsV1(input.contact_intake).length > 0) {
      return {
        ...requestContactDetails(state),
        selected_offering_code: offeringCode,
        selected_payment_plan: paymentPlan,
      };
    }
    return paymentLinkPlan(state, offeringCode, paymentPlan);
  }
  if (kind === 'report_payment') {
    // The customer's word is the only input here, and it is not evidence.
    // The turn records the claim, hands it to a human, and authorizes nothing.
    return {
      ...unchangedPlan(state, 'acknowledge_payment_report'),
      payment_reported: true,
      next_awaiting_reply: 'none',
    };
  }
  if (kind === 'ask_current_state') {
    // A question about what was already decided or already sent. It is
    // answered from state; re-issuing the link would answer a question the
    // customer did not ask.
    return unchangedPlan(state, 'confirm_current_state');
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
  const moves = orderCompoundMoves([move.move, ...move.secondary_moves]);
  if (incompatible(moves, vetoes)) {
    return unchangedPlan(input.sales_context, 'clarify_current_step');
  }
  if (
    input.sales_context.awaiting_reply === 'call_or_chat'
    && vetoes.has('call')
    && !moves.includes('request_call')
    && !moves.includes('decline_call')
    && !moves.includes('continue_by_chat')
  ) {
    moves.push('continue_by_chat');
  }

  let state = input.sales_context;
  let result = unchangedPlan(state);
  let offeredCallThisTurn = false;
  const accumulatedRequests: CanonicalFactRequestV1[] = [];
  for (const kind of moves) {
    result = planSingle(kind, {
      ...input,
      proactive_call_offer_allowed:
        input.proactive_call_offer_allowed !== false && !offeredCallThisTurn,
    }, state, vetoes);
    if (result.next_call_offer_count > state.call_offer_count) offeredCallThisTurn = true;
    accumulatedRequests.push(...result.canonical_fact_requests);
    state = asState(result, state);
  }
  return {
    ...result,
    canonical_fact_requests: uniqueRequests(accumulatedRequests),
    should_offer_call: !vetoes.has('call')
      && offeredCallThisTurn
      && result.next_call_preference === 'unknown'
      && result.next_call_offer_status === 'offered',
    allowed_business_action:
      (vetoes.has('call') && result.allowed_business_action.type === 'request_call_now')
      || ((vetoes.has('payment_link') || vetoes.has('purchase'))
        && result.allowed_business_action.type === 'send_payment_link')
        ? { type: 'none' }
        : result.allowed_business_action,
  };
}
