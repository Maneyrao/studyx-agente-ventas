import type { DecisionResponseType } from './decision';

/**
 * What the agent is allowed to say on this turn.
 *
 * This lived twice — once in the ingest response and once in the decision
 * commit — which is exactly the kind of duplication that lets a blocked contact
 * be answered through one path and suppressed through the other. It is now a
 * single dependency-free rule the backend applies at both boundaries.
 *
 * The policy is deliberately restrictive: it enumerates what IS permitted, so a
 * new response type is unreachable until someone allows it on purpose.
 */

export interface TurnPolicyFacts {
  readonly contact_status: 'prospecto' | 'cliente' | 'inactivo';
  readonly lifecycle_status: 'active' | 'blocked' | 'deleted' | null;
  readonly deleted_at: string | null;
  readonly consent_status: 'unknown' | 'granted' | 'revoked';
  /** The customer asked to stop, in this very turn. */
  readonly explicit_opt_out: boolean;
  /** The channel delivered something we cannot read (image, sticker, …). */
  readonly unsupported_message: boolean;
}

export type TurnPolicyReason =
  | 'CONTACT_BLOCKED'
  | 'CONSENT_REVOKED'
  | 'EXPLICIT_OPT_OUT_ACK_ONLY'
  | 'UNSUPPORTED_MESSAGE_TYPE';

export interface TurnPolicy {
  readonly may_respond: boolean;
  readonly allowed_response_types: DecisionResponseType[];
  readonly reason: TurnPolicyReason | null;
  readonly blocked: boolean;
}

const CONVERSATIONAL_RESPONSE_TYPES: DecisionResponseType[] = [
  'social_reply',
  'commercial_reply',
  'clarification',
  'complaint_ack',
  'automation_only',
  'out_of_scope',
  'technical_fallback',
];

const UNREADABLE_RESPONSE_TYPES: DecisionResponseType[] = ['out_of_scope', 'technical_fallback'];

export function isContactBlocked(facts: TurnPolicyFacts): boolean {
  return (
    facts.contact_status === 'inactivo'
    || facts.lifecycle_status === 'blocked'
    || facts.lifecycle_status === 'deleted'
    || facts.deleted_at !== null
  );
}

export function evaluateTurnPolicy(facts: TurnPolicyFacts): TurnPolicy {
  const blocked = isContactBlocked(facts);

  // Confirming an opt-out is the one message a revoked contact still receives;
  // refusing it would leave the customer unsure the request landed. It is never
  // commercial, and it is the only allowed type in that state.
  if (facts.explicit_opt_out) {
    return {
      may_respond: true,
      allowed_response_types: ['opt_out_ack'],
      reason: 'EXPLICIT_OPT_OUT_ACK_ONLY',
      blocked,
    };
  }

  if (blocked) {
    return { may_respond: false, allowed_response_types: [], reason: 'CONTACT_BLOCKED', blocked };
  }

  if (facts.consent_status === 'revoked') {
    return { may_respond: false, allowed_response_types: [], reason: 'CONSENT_REVOKED', blocked };
  }

  if (facts.unsupported_message) {
    return {
      may_respond: true,
      allowed_response_types: [...UNREADABLE_RESPONSE_TYPES],
      reason: 'UNSUPPORTED_MESSAGE_TYPE',
      blocked,
    };
  }

  return {
    may_respond: true,
    allowed_response_types: [...CONVERSATIONAL_RESPONSE_TYPES],
    reason: null,
    blocked,
  };
}
