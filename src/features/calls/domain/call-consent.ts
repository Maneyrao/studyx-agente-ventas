import { classifyBatchSalesSignalWithIndex } from '@/features/orchestration/domain/sales-signal';

/**
 * Deterministic voice-consent policy — the backend's final word on whether a
 * `request_call_now` decision is actually backed by the customer.
 *
 * The model's claimed reason is never trusted: consent is re-derived from
 * the turn text (bounded patterns only) and the structured offer facts. A
 * negation in the same message always wins over any affirmative word, and a
 * short acceptance only counts against a same-conversation offer no older
 * than the offer lifetime. Anything outside the bounded patterns needs an
 * explicit confirmation turn, never a guess.
 */

/** Mirrors call-offer-policy's window: an offer stays open for 15 minutes. */
export const VOICE_OFFER_LIFETIME_MS = 15 * 60 * 1000;

export interface VoiceConsentFacts {
  /**
   * Every inbound text of the batch being decided, oldest first. Consent is
   * evaluated over the whole burst — the newest decisive message wins — so a
   * "llamame" buried mid-batch authorizes and a trailing "mejor no" revokes,
   * regardless of which message happens to be the batch representative.
   */
  readonly texts: readonly string[];
  /** ISO instant used to age the open offer. */
  readonly now: string;
  readonly openOffer: { decisionId: string; offeredAt: string } | null;
}

export type VoiceConsentVerdict =
  | {
      allowed: true;
      mode: 'direct_request' | 'accepted_offer';
      offeredByDecisionId: string | null;
      /** Index (into facts.texts) of the message that carried the consent. */
      sourceIndex: number;
    }
  | {
      allowed: false;
      code:
        | 'CALL_EXPLICITLY_DECLINED'
        | 'CALL_OFFER_MISSING'
        | 'CALL_OFFER_EXPIRED'
        | 'CALL_CONFIRMATION_REQUIRED';
    };

export function evaluateVoiceConsent(facts: VoiceConsentFacts): VoiceConsentVerdict {
  const { signal, index } = classifyBatchSalesSignalWithIndex(facts.texts);

  if (signal.type === 'call_decline' || signal.type === 'opt_out') {
    return { allowed: false, code: 'CALL_EXPLICITLY_DECLINED' };
  }
  if (signal.type === 'direct_call_request') {
    return { allowed: true, mode: 'direct_request', offeredByDecisionId: null, sourceIndex: index! };
  }
  if (signal.type === 'call_acceptance') {
    if (facts.openOffer === null) {
      return { allowed: false, code: 'CALL_OFFER_MISSING' };
    }
    const age = Date.parse(facts.now) - Date.parse(facts.openOffer.offeredAt);
    if (!Number.isFinite(age) || age > VOICE_OFFER_LIFETIME_MS) {
      return { allowed: false, code: 'CALL_OFFER_EXPIRED' };
    }
    return {
      allowed: true,
      mode: 'accepted_offer',
      offeredByDecisionId: facts.openOffer.decisionId,
      sourceIndex: index!,
    };
  }
  return { allowed: false, code: 'CALL_CONFIRMATION_REQUIRED' };
}
