import type { DeterministicSalesSignal } from './sales-signal';

/**
 * What the agent may do about offering or placing a sales call on this turn.
 *
 * The classifier in `sales-signal.ts` only reads the customer's current
 * message; it has no idea whether a call was offered five minutes ago or
 * declined last week. This module supplies that missing context. Given the
 * classified signal plus the facts of any recent offer, decline, or call, it
 * decides what the model is allowed to do next — offer a call, request one
 * immediately, or neither.
 *
 * Two clocks govern the decision:
 *
 *   - An open offer is live for 15 minutes. Past that, "sí" answers a
 *     question that is no longer on the table.
 *   - A decline starts a 30-minute cooldown during which the agent may not
 *     proactively offer again — but an explicit new "llamame" is always
 *     honored, cooldown or not, because it is the customer asking, not the
 *     agent pushing.
 *
 * Opt-out, a blocked contact, and an already-active call all short-circuit
 * to no sales action whatsoever, before any of the offer/cooldown math runs.
 *
 * Dependency-free and deterministic by construction: `now` and every fact
 * timestamp are passed in as ISO strings rather than read from the clock, so
 * the same facts always produce the same verdict.
 */

const OFFER_LIFETIME_MS = 15 * 60 * 1000;
const DECLINE_COOLDOWN_MS = 30 * 60 * 1000;

export interface CallOfferPolicyFacts {
  readonly now: string;
  readonly signal: DeterministicSalesSignal;
  /** The most recent unresolved call offer, if any. */
  readonly openOffer: { readonly decisionId: string; readonly offeredAt: string } | null;
  /** When the customer last declined a call, if ever. */
  readonly lastDeclineAt: string | null;
  readonly optedOut: boolean;
  readonly blocked: boolean;
  /** A call is in progress right now, so a new one cannot be offered or placed. */
  readonly activeCall: boolean;
}

export interface CallOfferPolicyResult {
  allowedActions: Array<'offer_call' | 'request_call_now'>;
  openOffer: { decisionId: string; expiresAt: string } | null;
  /** Live offer consumed by an acceptance on this turn, retained as evidence. */
  acceptedOffer: { decisionId: string; expiresAt: string } | null;
  cooldownUntil: string | null;
  reason: string;
}

function noSalesAction(reason: string): CallOfferPolicyResult {
  return { allowedActions: [], openOffer: null, acceptedOffer: null, cooldownUntil: null, reason };
}

/** The live open offer, recomputed against `now`, or null once it has expired. */
function liveOpenOffer(
  facts: CallOfferPolicyFacts,
  nowMs: number
): { decisionId: string; expiresAt: string } | null {
  if (facts.openOffer === null) return null;
  const expiresAtMs = Date.parse(facts.openOffer.offeredAt) + OFFER_LIFETIME_MS;
  if (!(expiresAtMs > nowMs)) return null;
  return { decisionId: facts.openOffer.decisionId, expiresAt: new Date(expiresAtMs).toISOString() };
}

/** When the current decline cooldown ends, or null if none is active. */
function activeCooldownUntil(facts: CallOfferPolicyFacts, nowMs: number): string | null {
  if (facts.lastDeclineAt === null) return null;
  const untilMs = Date.parse(facts.lastDeclineAt) + DECLINE_COOLDOWN_MS;
  if (!(untilMs > nowMs)) return null;
  return new Date(untilMs).toISOString();
}

export function evaluateCallOfferPolicy(facts: CallOfferPolicyFacts): CallOfferPolicyResult {
  const nowMs = Date.parse(facts.now);

  if (facts.blocked) return noSalesAction('CONTACT_BLOCKED');
  if (facts.optedOut || facts.signal.type === 'opt_out') return noSalesAction('OPTED_OUT');
  if (facts.activeCall) return noSalesAction('ACTIVE_CALL_IN_PROGRESS');

  const openOffer = liveOpenOffer(facts, nowMs);
  const cooldownUntil = activeCooldownUntil(facts, nowMs);

  if (facts.signal.type === 'direct_call_request') {
    // The customer is asking directly, right now. That is always honored,
    // even mid-cooldown or against a still-open offer — it supersedes both.
    return {
      allowedActions: ['request_call_now'],
      openOffer: null,
      acceptedOffer: null,
      cooldownUntil,
      reason: 'DIRECT_REQUEST',
    };
  }

  if (facts.signal.type === 'call_decline') {
    return {
      allowedActions: [],
      openOffer: null,
      acceptedOffer: null,
      cooldownUntil: new Date(nowMs + DECLINE_COOLDOWN_MS).toISOString(),
      reason: 'DECLINED',
    };
  }

  // A proactive offer stays disabled for the rest of this conversation.
  // An explicit direct request was handled above and always remains valid.
  if (facts.lastDeclineAt !== null) {
    return {
      allowedActions: [],
      openOffer: null,
      acceptedOffer: null,
      cooldownUntil,
      reason: cooldownUntil === null
        ? 'CALL_DECLINED_IN_CONVERSATION'
        : 'DECLINE_COOLDOWN_ACTIVE',
    };
  }

  if (facts.signal.type === 'call_acceptance') {
    // A short "sí" only means something against a live offer; otherwise it
    // is not this policy's to interpret, and no action is granted.
    if (openOffer !== null) {
      return {
        allowedActions: ['request_call_now'],
        openOffer: null,
        acceptedOffer: openOffer,
        cooldownUntil,
        reason: 'OFFER_ACCEPTED',
      };
    }
    if (cooldownUntil !== null) {
      return {
        allowedActions: [],
        openOffer: null,
        acceptedOffer: null,
        cooldownUntil,
        reason: 'DECLINE_COOLDOWN_ACTIVE',
      };
    }
    return {
      allowedActions: [],
      openOffer: null,
      acceptedOffer: null,
      cooldownUntil: null,
      reason: facts.openOffer !== null ? 'OFFER_EXPIRED' : 'NO_OPEN_OFFER',
    };
  }

  // model_required: the text itself settled nothing. The only thing this
  // policy adds is whether the model may proactively *offer* a call.
  if (cooldownUntil !== null) {
    return {
      allowedActions: [],
      openOffer,
      acceptedOffer: null,
      cooldownUntil,
      reason: 'DECLINE_COOLDOWN_ACTIVE',
    };
  }
  if (openOffer !== null) {
    return {
      allowedActions: [],
      openOffer,
      acceptedOffer: null,
      cooldownUntil: null,
      reason: 'OFFER_PENDING_RESPONSE',
    };
  }
  return {
    allowedActions: ['offer_call'],
    openOffer: null,
    acceptedOffer: null,
    cooldownUntil: null,
    reason: 'ELIGIBLE_FOR_OFFER',
  };
}
