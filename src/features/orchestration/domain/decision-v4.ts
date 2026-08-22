import {
  DecisionIntent,
  DecisionKind,
  DecisionMemoryCandidate,
  DecisionNextState,
  DecisionResponseType,
  DecisionValidationError,
  DecisionV2,
  parseDecisionV2,
} from './decision';
import {
  BusinessAction,
  DecisionV3,
  RetrievalUsed,
  parseBusinessAction,
  parseDecisionV3,
} from './decision-v3';
import {
  PAYMENT_PLAN_CODES,
  PaymentPlanCode,
  SendPaymentLinkAction,
} from '../../payments/domain/payment-link';

export type { SendPaymentLinkAction };

/**
 * Decision schema v4 — the frozen call protocol between Agent A and the
 * backend.
 *
 * Additive over v3. It introduces exactly two response types and one
 * business action:
 *
 * - `call_offer`: the agent proposes a call and waits. It is pure copy:
 *   business_action stays null and next_state stays waiting_user, so an
 *   offer can never place a call by itself.
 * - `call_confirmation` + `request_call_now`: the agent asserts that the
 *   customer consented (a direct request or an accepted open offer) and asks
 *   the backend for a call. The two are inseparable in both directions: a
 *   confirmation without the action would promise a call nobody requested,
 *   and the action outside a confirmation would place a call the customer
 *   never saw acknowledged.
 *
 * The model never provides identity. Phone, contact_id, call_id, provider
 * IDs and consent evidence are derived by the backend from the canonical
 * turn; any such field in the action or the decision is rejected at parse
 * time, before policy even runs.
 */

export const DECISION_V4_RESPONSE_TYPES = ['call_offer', 'call_confirmation'] as const;

export type DecisionV4ResponseType =
  | DecisionResponseType
  | (typeof DECISION_V4_RESPONSE_TYPES)[number];

export const REQUEST_CALL_NOW_REASONS = ['direct_request', 'accepted_offer'] as const;

export type RequestCallNowReason = (typeof REQUEST_CALL_NOW_REASONS)[number];

export interface RequestCallNowAction {
  type: 'request_call_now';
  reason: RequestCallNowReason;
  course_of_interest?: string;
}

/**
 * The executable v4 union. Narrower than v3's on purpose: v4 only carries
 * actions the backend actually executes or records. The dormant v3 shapes
 * (send_pricing_info, schedule_followup, escalate_to_human) are not part of
 * the v4 contract at all.
 */
export type DecisionV4BusinessAction =
  | { type: 'mark_hot_lead'; score: number }
  | { type: 'log_objection'; objection_key: string; quote: string }
  | RequestCallNowAction
  | SendPaymentLinkAction;

export interface DecisionV4 {
  schema_version: 4;
  intent: DecisionIntent;
  kind: DecisionKind;
  response: string | null;
  response_type: DecisionV4ResponseType | null;
  confidence: number;
  reason_code: string;
  business_action: DecisionV4BusinessAction | null;
  memory_candidates: DecisionMemoryCandidate[];
  missing_information: string[];
  next_state: DecisionNextState;
  retrieval_used: RetrievalUsed | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const REQUEST_CALL_NOW_FIELDS = new Set(['type', 'reason', 'course_of_interest']);

function parseRequestCallNow(value: Record<string, unknown>): RequestCallNowAction {
  // Strict allowlist: an unknown key here is the model trying to provide
  // identity or evidence (phone, contact_id, call_id, provider IDs, consent),
  // which only the backend may derive.
  if (Object.keys(value).some((key) => !REQUEST_CALL_NOW_FIELDS.has(key))) {
    throw new DecisionValidationError('INVALID_BUSINESS_ACTION');
  }
  if (
    typeof value.reason !== 'string'
    || !(REQUEST_CALL_NOW_REASONS as readonly string[]).includes(value.reason)
  ) {
    throw new DecisionValidationError('INVALID_BUSINESS_ACTION');
  }
  const action: RequestCallNowAction = {
    type: 'request_call_now',
    reason: value.reason as RequestCallNowReason,
  };
  if (value.course_of_interest !== undefined) {
    if (
      typeof value.course_of_interest !== 'string'
      || value.course_of_interest.trim() === ''
      || value.course_of_interest.length > 128
    ) {
      throw new DecisionValidationError('INVALID_BUSINESS_ACTION');
    }
    action.course_of_interest = value.course_of_interest;
  }
  return action;
}

const SEND_PAYMENT_LINK_FIELDS = new Set(['type', 'plan_code', 'offering_sku']);

// A canonical offering sku is a short opaque slug. Anything shaped like a
// URL or a monetary amount is exactly what the model must never be able to
// smuggle into this action — plan/link/amount all come from the backend,
// never from the model, so any such shape is rejected outright rather than
// stripped or coerced.
const URL_LIKE_PATTERN = /https?:\/\//i;
const AMOUNT_LIKE_PATTERN = /\d[.,]\d{2}|\busd\b|\bars\b|[$€£]/i;

function isCanonicalOfferingSku(value: string): boolean {
  if (value.trim() === '' || value.length > 128) return false;
  return !URL_LIKE_PATTERN.test(value) && !AMOUNT_LIKE_PATTERN.test(value);
}

function parseSendPaymentLinkAction(value: Record<string, unknown>): SendPaymentLinkAction {
  // Strict allowlist, same discipline as request_call_now: an unknown key
  // here is exactly where a URL or an amount would get smuggled in under a
  // different name.
  if (Object.keys(value).some((key) => !SEND_PAYMENT_LINK_FIELDS.has(key))) {
    throw new DecisionValidationError('INVALID_BUSINESS_ACTION');
  }
  if (
    typeof value.plan_code !== 'string'
    || !(PAYMENT_PLAN_CODES as readonly string[]).includes(value.plan_code)
  ) {
    throw new DecisionValidationError('INVALID_BUSINESS_ACTION');
  }
  let offering_sku: string | null = null;
  if (value.offering_sku !== null && value.offering_sku !== undefined) {
    if (typeof value.offering_sku !== 'string' || !isCanonicalOfferingSku(value.offering_sku)) {
      throw new DecisionValidationError('INVALID_BUSINESS_ACTION');
    }
    offering_sku = value.offering_sku;
  }
  return {
    type: 'send_payment_link',
    plan_code: value.plan_code as PaymentPlanCode,
    offering_sku,
  };
}

function parseV4BusinessAction(value: unknown): DecisionV4BusinessAction | null {
  if (value === null || value === undefined) return null;
  if (!isRecord(value)) {
    throw new DecisionValidationError('INVALID_BUSINESS_ACTION');
  }
  if (value.type === 'request_call_now') {
    return parseRequestCallNow(value);
  }
  if (value.type === 'send_payment_link') {
    return parseSendPaymentLinkAction(value);
  }
  if (value.type !== 'mark_hot_lead' && value.type !== 'log_objection') {
    throw new DecisionValidationError('INVALID_BUSINESS_ACTION');
  }
  // The two observational actions keep their exact v3 field rules.
  return parseBusinessAction(value) as DecisionV4BusinessAction;
}

export function parseDecisionV4(value: unknown): DecisionV4 {
  if (!isRecord(value) || value.schema_version !== 4) {
    throw new DecisionValidationError('SCHEMA_VERSION_UNSUPPORTED');
  }

  // v4 reuses every v2/v3 field rule by round-tripping through the v3
  // validator with the v4-only pieces detached: the two call response types
  // are masked as an existing reply type (they share its shape rules) and
  // the business action is parsed separately under the narrower v4 union.
  const { schema_version: _sv, business_action, response_type, ...rest } = value;
  void _sv;
  const isCallResponseType = response_type === 'call_offer' || response_type === 'call_confirmation';
  const asV3 = parseDecisionV3({
    ...rest,
    schema_version: 3,
    response_type: isCallResponseType ? 'commercial_reply' : response_type,
    business_action: null,
  });

  const action = parseV4BusinessAction(business_action);

  if (action !== null && asV3.kind === 'suppress') {
    throw new DecisionValidationError('SUPPRESS_HAS_SIDE_EFFECT');
  }

  const finalResponseType = (isCallResponseType
    ? response_type
    : asV3.response_type) as DecisionV4ResponseType | null;

  if (finalResponseType === 'call_offer') {
    // An offer proposes and waits — it never carries a side effect and never
    // closes the turn.
    if (action !== null || asV3.kind !== 'reply' || asV3.next_state !== 'waiting_user') {
      throw new DecisionValidationError('INVALID_CALL_OFFER');
    }
  }

  const requestsCall = action?.type === 'request_call_now';
  if (requestsCall !== (finalResponseType === 'call_confirmation')) {
    throw new DecisionValidationError('INVALID_CALL_REQUEST');
  }
  if (requestsCall && asV3.kind !== 'reply') {
    throw new DecisionValidationError('INVALID_CALL_REQUEST');
  }

  return {
    schema_version: 4,
    intent: asV3.intent,
    kind: asV3.kind,
    response: asV3.response,
    response_type: finalResponseType,
    confidence: asV3.confidence,
    reason_code: asV3.reason_code,
    business_action: action,
    memory_candidates: asV3.memory_candidates,
    missing_information: asV3.missing_information,
    next_state: asV3.next_state,
    retrieval_used: asV3.retrieval_used,
  };
}

export type AnyVersionDecision = DecisionV2 | DecisionV3 | DecisionV4;

/**
 * Version-tolerant dispatcher covering every schema on the wire. v2 and v3
 * parsers stay untouched; only schema_version 4 reaches the v4 rules.
 */
export function parseDecisionAnyVersion(value: unknown): AnyVersionDecision {
  if (isRecord(value) && value.schema_version === 4) return parseDecisionV4(value);
  if (isRecord(value) && value.schema_version === 3) return parseDecisionV3(value);
  return parseDecisionV2(value);
}

/**
 * Policy gate across versions. v4's parser already narrows the action union
 * to executable/observational types, so a parsed v4 decision needs no extra
 * refusal; v2/v3 keep the existing gate (escalate_to_human et al.).
 */
export function assertDecisionBusinessActionPermitted(decision: AnyVersionDecision): void {
  if (decision.schema_version === 4) return;
  // Imported lazily by callers today; kept here so the rule has one home.
  if (decision.business_action === null) return;
  assertLegacyBusinessActionPermitted(decision.business_action);
}

function assertLegacyBusinessActionPermitted(action: BusinessAction): void {
  if (action.type === 'escalate_to_human') {
    throw new DecisionValidationError('HUMAN_HANDOFF_FORBIDDEN');
  }
  if (action.type !== 'mark_hot_lead' && action.type !== 'log_objection') {
    throw new DecisionValidationError('BUSINESS_ACTION_NOT_PERMITTED');
  }
}
