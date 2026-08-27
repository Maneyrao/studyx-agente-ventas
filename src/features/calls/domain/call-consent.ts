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

export interface AuthorizedVoiceConsentFacts {
  readonly mode: 'direct_request' | 'accepted_offer';
  readonly sourceIndex: number;
  readonly now: string;
  readonly openOffer: VoiceConsentFacts['openOffer'];
}

function acceptedOpenOffer(
  now: string,
  openOffer: VoiceConsentFacts['openOffer'],
): VoiceConsentVerdict {
  if (openOffer === null) return { allowed: false, code: 'CALL_OFFER_MISSING' };
  const age = Date.parse(now) - Date.parse(openOffer.offeredAt);
  if (!Number.isFinite(age) || age > VOICE_OFFER_LIFETIME_MS) {
    return { allowed: false, code: 'CALL_OFFER_EXPIRED' };
  }
  return {
    allowed: true,
    mode: 'accepted_offer',
    offeredByDecisionId: openOffer.decisionId,
    sourceIndex: 0,
  };
}

/**
 * A semantic interpreter may establish meaning, but it cannot extend the
 * lifetime of a durable call offer. This policy applies the same temporal
 * authority boundary as the deterministic path without re-reading prose.
 */
export function evaluateAuthorizedVoiceConsent(
  facts: AuthorizedVoiceConsentFacts,
): VoiceConsentVerdict {
  if (facts.mode === 'direct_request') {
    return {
      allowed: true,
      mode: 'direct_request',
      offeredByDecisionId: null,
      sourceIndex: facts.sourceIndex,
    };
  }
  const verdict = acceptedOpenOffer(facts.now, facts.openOffer);
  return verdict.allowed ? { ...verdict, sourceIndex: facts.sourceIndex } : verdict;
}

/**
 * Prefer exact evidence from the existing deterministic classifier. Semantic
 * paraphrases have no token-level provenance, so their safe fallback remains
 * the newest message in the interpreted batch.
 */
export function selectAuthorizedVoiceConsentSourceIndex(input: {
  readonly mode: AuthorizedVoiceConsentFacts['mode'];
  readonly texts: readonly string[];
}): number {
  const { signal, index } = classifyBatchSalesSignalWithIndex(input.texts);
  const matches = (input.mode === 'direct_request' && signal.type === 'direct_call_request')
    || (input.mode === 'accepted_offer' && signal.type === 'call_acceptance');
  return matches && index !== null ? index : input.texts.length - 1;
}

export function evaluateVoiceConsent(facts: VoiceConsentFacts): VoiceConsentVerdict {
  const { signal, index } = classifyBatchSalesSignalWithIndex(facts.texts);

  if (signal.type === 'call_decline' || signal.type === 'opt_out') {
    return { allowed: false, code: 'CALL_EXPLICITLY_DECLINED' };
  }
  if (signal.type === 'direct_call_request') {
    return { allowed: true, mode: 'direct_request', offeredByDecisionId: null, sourceIndex: index! };
  }
  if (signal.type === 'call_acceptance') {
    const verdict = acceptedOpenOffer(facts.now, facts.openOffer);
    return verdict.allowed ? { ...verdict, sourceIndex: index! } : verdict;
  }
  return { allowed: false, code: 'CALL_CONFIRMATION_REQUIRED' };
}
