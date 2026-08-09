export const DECISION_INTENTS = [
  'social',
  'commercial',
  'commercial_decline',
  'complaint',
  'human_request',
  'opt_out',
  'out_of_scope',
  'unknown',
] as const;

export const DECISION_KINDS = ['reply', 'clarify', 'suppress'] as const;

export const DECISION_RESPONSE_TYPES = [
  'social_reply',
  'commercial_reply',
  'clarification',
  'complaint_ack',
  'automation_only',
  'opt_out_ack',
  'out_of_scope',
  'technical_fallback',
] as const;

export const DECISION_NEXT_STATES = ['completed', 'waiting_user'] as const;

const DECISION_FIELDS = new Set([
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
]);

const MEMORY_CANDIDATE_FIELDS = new Set([
  'type',
  'key',
  'value',
  'source_quote',
  'confidence',
]);

export type DecisionIntent = (typeof DECISION_INTENTS)[number];
export type DecisionKind = (typeof DECISION_KINDS)[number];
export type DecisionResponseType = (typeof DECISION_RESPONSE_TYPES)[number];
export type DecisionNextState = (typeof DECISION_NEXT_STATES)[number];

export interface DecisionMemoryCandidate {
  type: string;
  key: string;
  value: string;
  source_quote: string;
  confidence: number;
}

export interface DecisionV2 {
  schema_version: 2;
  intent: DecisionIntent;
  kind: DecisionKind;
  response: string | null;
  response_type: DecisionResponseType | null;
  confidence: number;
  reason_code: string;
  business_action: null;
  memory_candidates: DecisionMemoryCandidate[];
  missing_information: string[];
  next_state: DecisionNextState;
}

export class DecisionValidationError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = 'DecisionValidationError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOneOf<const T extends readonly string[]>(
  value: unknown,
  allowed: T
): value is T[number] {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value);
}

function parseMemoryCandidates(value: unknown): DecisionMemoryCandidate[] {
  if (!Array.isArray(value)) throw new DecisionValidationError('INVALID_MEMORY_CANDIDATES');

  return value.map((candidate) => {
    if (
      !isRecord(candidate)
      || Object.keys(candidate).some((key) => !MEMORY_CANDIDATE_FIELDS.has(key))
      || typeof candidate.type !== 'string'
      || candidate.type.trim() === ''
      || typeof candidate.key !== 'string'
      || candidate.key.trim() === ''
      || typeof candidate.value !== 'string'
      || candidate.value.trim() === ''
      || typeof candidate.source_quote !== 'string'
      || candidate.source_quote.trim() === ''
      || typeof candidate.confidence !== 'number'
      || !Number.isFinite(candidate.confidence)
      || candidate.confidence < 0
      || candidate.confidence > 1
    ) {
      throw new DecisionValidationError('INVALID_MEMORY_CANDIDATES');
    }

    return {
      type: candidate.type,
      key: candidate.key,
      value: candidate.value,
      source_quote: candidate.source_quote,
      confidence: candidate.confidence,
    };
  });
}

function parseMissingInformation(value: unknown): string[] {
  if (
    !Array.isArray(value)
    || value.some((item) => typeof item !== 'string' || item.trim() === '')
  ) {
    throw new DecisionValidationError('INVALID_MISSING_INFORMATION');
  }
  return [...value] as string[];
}

export function parseDecisionV2(value: unknown): DecisionV2 {
  if (!isRecord(value) || value.schema_version !== 2) {
    throw new DecisionValidationError('SCHEMA_VERSION_UNSUPPORTED');
  }
  if (Object.keys(value).some((key) => !DECISION_FIELDS.has(key))) {
    throw new DecisionValidationError('UNKNOWN_DECISION_FIELD');
  }
  if (!isOneOf(value.intent, DECISION_INTENTS)) {
    throw new DecisionValidationError('INVALID_INTENT');
  }
  if (!isOneOf(value.kind, DECISION_KINDS)) {
    throw new DecisionValidationError('INVALID_KIND');
  }
  if (
    value.response !== null
    && (typeof value.response !== 'string' || value.response.trim() === '')
  ) {
    throw new DecisionValidationError('INVALID_RESPONSE');
  }
  if (
    value.response_type !== null
    && !isOneOf(value.response_type, DECISION_RESPONSE_TYPES)
  ) {
    throw new DecisionValidationError('INVALID_RESPONSE_TYPE');
  }
  if (
    typeof value.confidence !== 'number'
    || !Number.isFinite(value.confidence)
    || value.confidence < 0
    || value.confidence > 1
  ) {
    throw new DecisionValidationError('INVALID_CONFIDENCE');
  }
  if (typeof value.reason_code !== 'string' || value.reason_code.trim() === '') {
    throw new DecisionValidationError('INVALID_REASON_CODE');
  }
  if (value.business_action !== null) {
    throw new DecisionValidationError('BUSINESS_ACTION_FORBIDDEN');
  }
  if (!isOneOf(value.next_state, DECISION_NEXT_STATES)) {
    throw new DecisionValidationError('INVALID_NEXT_STATE');
  }

  const memoryCandidates = parseMemoryCandidates(value.memory_candidates);
  const missingInformation = parseMissingInformation(value.missing_information);

  if (value.kind === 'suppress') {
    if (
      value.response !== null
      || value.response_type !== null
      || memoryCandidates.length > 0
      || missingInformation.length > 0
    ) {
      throw new DecisionValidationError('SUPPRESS_HAS_SIDE_EFFECT');
    }
  } else if (value.kind === 'clarify') {
    if (
      typeof value.response !== 'string'
      || value.response_type === null
      || missingInformation.length === 0
      || value.next_state !== 'waiting_user'
    ) {
      throw new DecisionValidationError('INVALID_CLARIFICATION');
    }
  } else if (typeof value.response !== 'string' || value.response_type === null) {
    throw new DecisionValidationError('REPLY_REQUIRES_RESPONSE');
  }

  if (
    value.intent === 'opt_out'
    && (
      value.response_type !== 'opt_out_ack'
      || memoryCandidates.length > 0
      || value.next_state !== 'completed'
    )
  ) {
    throw new DecisionValidationError('INVALID_OPT_OUT');
  }

  if (
    value.intent === 'human_request'
    && (
      value.response_type !== 'automation_only'
      || value.next_state !== 'waiting_user'
    )
  ) {
    throw new DecisionValidationError('INVALID_HUMAN_REQUEST');
  }

  return {
    schema_version: 2,
    intent: value.intent,
    kind: value.kind,
    response: value.response,
    response_type: value.response_type,
    confidence: value.confidence,
    reason_code: value.reason_code,
    business_action: null,
    memory_candidates: memoryCandidates,
    missing_information: missingInformation,
    next_state: value.next_state,
  };
}
