import {
  DECISION_INTENTS,
  DECISION_KINDS,
  DECISION_RESPONSE_TYPES,
  DECISION_NEXT_STATES,
  DecisionIntent,
  DecisionKind,
  DecisionResponseType,
  DecisionNextState,
  DecisionMemoryCandidate,
  DecisionValidationError,
  parseDecisionV2,
  DecisionV2,
} from './decision';

/**
 * Decision schema v3.
 *
 * Additive over v2. All v2 fields keep their exact semantics; v3 introduces
 * two orthogonal capabilities used by the Botpress-side decision router:
 *
 * - business_action: a typed side-effect the agent commits to run *after* the
 *   response is delivered (send_pricing_info, escalate_to_human, …). v2's
 *   contract forbade this field to be non-null; v3 lifts that restriction
 *   but keeps it OPTIONAL — v3 without business_action behaves like a v2.
 *
 * - retrieval_used: auditability of which context slots the LLM actually
 *   consulted when making the decision. Enables offline metrics like
 *   "% turns that used KB vs long-term memory" without extra instrumentation.
 *
 * v2 remains valid on the wire (via parseDecisionAny). The upgrade path is
 * strictly additive: no v2 producer needs to change to keep working.
 */

export const BUSINESS_ACTION_TYPES = [
  'send_pricing_info',
  'schedule_followup',
  'escalate_to_human',
  'mark_hot_lead',
  'log_objection',
] as const;

export type BusinessActionType = (typeof BUSINESS_ACTION_TYPES)[number];

export type BusinessAction =
  | {
      type: 'send_pricing_info';
      sku: string;
    }
  | {
      type: 'schedule_followup';
      when_iso: string;
    }
  | {
      type: 'escalate_to_human';
      reason: string;
    }
  | {
      type: 'mark_hot_lead';
      score: number;
    }
  | {
      type: 'log_objection';
      objection_key: string;
      quote: string;
    };

export interface RetrievalUsed {
  kb: boolean;
  long_term_memory: boolean;
  summary_version: number | null;
}

export interface DecisionV3 {
  schema_version: 3;
  intent: DecisionIntent;
  kind: DecisionKind;
  response: string | null;
  response_type: DecisionResponseType | null;
  confidence: number;
  reason_code: string;
  business_action: BusinessAction | null;
  memory_candidates: DecisionMemoryCandidate[];
  missing_information: string[];
  next_state: DecisionNextState;
  retrieval_used: RetrievalUsed | null;
}

const V3_FIELDS = new Set([
  'schema_version',
  'intent',
  'kind',
  'response',
  'response_type',
  'confidence',
  'reason_code',
  'business_action',
  'memory_candidates',
  'missing_information',
  'next_state',
  'retrieval_used',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOneOf<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
): value is T[number] {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value);
}

const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function parseBusinessAction(value: unknown): BusinessAction | null {
  if (value === null) return null;
  if (!isRecord(value) || !isOneOf(value.type, BUSINESS_ACTION_TYPES)) {
    throw new DecisionValidationError('INVALID_BUSINESS_ACTION');
  }
  switch (value.type) {
    case 'send_pricing_info': {
      if (typeof value.sku !== 'string' || value.sku.trim() === '') {
        throw new DecisionValidationError('INVALID_BUSINESS_ACTION');
      }
      return { type: 'send_pricing_info', sku: value.sku };
    }
    case 'schedule_followup': {
      if (typeof value.when_iso !== 'string' || !ISO_DATETIME.test(value.when_iso)) {
        throw new DecisionValidationError('INVALID_BUSINESS_ACTION');
      }
      return { type: 'schedule_followup', when_iso: value.when_iso };
    }
    case 'escalate_to_human': {
      if (typeof value.reason !== 'string' || value.reason.trim() === '') {
        throw new DecisionValidationError('INVALID_BUSINESS_ACTION');
      }
      return { type: 'escalate_to_human', reason: value.reason };
    }
    case 'mark_hot_lead': {
      if (
        typeof value.score !== 'number'
        || !Number.isFinite(value.score)
        || value.score < 0
        || value.score > 1
      ) {
        throw new DecisionValidationError('INVALID_BUSINESS_ACTION');
      }
      return { type: 'mark_hot_lead', score: value.score };
    }
    case 'log_objection': {
      if (
        typeof value.objection_key !== 'string'
        || value.objection_key.trim() === ''
        || typeof value.quote !== 'string'
        || value.quote.trim() === ''
      ) {
        throw new DecisionValidationError('INVALID_BUSINESS_ACTION');
      }
      return { type: 'log_objection', objection_key: value.objection_key, quote: value.quote };
    }
  }
}

function parseRetrievalUsed(value: unknown): RetrievalUsed | null {
  if (value === null || value === undefined) return null;
  if (
    !isRecord(value)
    || typeof value.kb !== 'boolean'
    || typeof value.long_term_memory !== 'boolean'
    || !(
      value.summary_version === null
      || (typeof value.summary_version === 'number'
        && Number.isInteger(value.summary_version)
        && value.summary_version >= 0)
    )
  ) {
    throw new DecisionValidationError('INVALID_RETRIEVAL_USED');
  }
  return {
    kb: value.kb,
    long_term_memory: value.long_term_memory,
    summary_version: value.summary_version as number | null,
  };
}

export function parseDecisionV3(value: unknown): DecisionV3 {
  if (!isRecord(value) || value.schema_version !== 3) {
    throw new DecisionValidationError('SCHEMA_VERSION_UNSUPPORTED');
  }
  if (Object.keys(value).some((k) => !V3_FIELDS.has(k))) {
    throw new DecisionValidationError('UNKNOWN_DECISION_FIELD');
  }

  // v3 reuses v2's field-level rules by round-tripping through v2's
  // validator with schema_version overridden and v3-only fields stripped.
  // Any v2 rule (intent enum, kind/response constraints, opt_out/human_request
  // policies, …) still applies, so v3 stays a strict superset.
  const {
    business_action: _rawBA,
    retrieval_used: _rawRU,
    schema_version: _rawSV,
    ...v2Only
  } = value as Record<string, unknown>;
  void _rawBA; void _rawRU; void _rawSV;
  const asV2 = parseDecisionV2({
    ...v2Only,
    schema_version: 2,
    business_action: null,
  });

  const business_action = parseBusinessAction(value.business_action ?? null);
  const retrieval_used = parseRetrievalUsed(value.retrieval_used ?? null);

  // Business action is only meaningful when we actually send a reply.
  if (business_action !== null && asV2.kind === 'suppress') {
    throw new DecisionValidationError('SUPPRESS_HAS_SIDE_EFFECT');
  }

  return {
    schema_version: 3,
    intent: asV2.intent,
    kind: asV2.kind,
    response: asV2.response,
    response_type: asV2.response_type,
    confidence: asV2.confidence,
    reason_code: asV2.reason_code,
    business_action,
    memory_candidates: asV2.memory_candidates,
    missing_information: asV2.missing_information,
    next_state: asV2.next_state,
    retrieval_used,
  };
}

/**
 * Version-tolerant parser. Dispatches on schema_version. v3 producers may
 * downgrade to v2 by omitting business_action + retrieval_used; v2 producers
 * keep working unmodified.
 */
export function parseDecisionAny(value: unknown): DecisionV2 | DecisionV3 {
  if (isRecord(value) && value.schema_version === 3) return parseDecisionV3(value);
  return parseDecisionV2(value);
}

export { DECISION_INTENTS, DECISION_KINDS, DECISION_RESPONSE_TYPES, DECISION_NEXT_STATES };
