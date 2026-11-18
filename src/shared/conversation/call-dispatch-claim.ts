/**
 * Claim that a call is being dispatched or has been registered. One copy for
 * the backend guard and the Botpress validator: both used to carry their own
 * and could drift.
 */

const CALL_DISPATCH_CLAIM_V1 = /\b(?:te\s+(?:voy|vamos)\s+a\s+llamar|te\s+llam(?:o|amos)\b|(?:la\s+)?llamada\s+(?:ya\s+)?(?:qued[oó]|fue)\s+(?:registrad|solicitad|coordinad)\w*|(?:ya\s+)?(?:registr[eé]|solicit[eé]|coordin[eé])\s+(?:la\s+)?llamada)\b/iu;
// Scope negation and conditions to each matched claim. A reassurance such as
// “no te preocupes” or another sentence's question cannot cancel a dispatch.
const CALL_DISPATCH_NEGATION_PREFIX_V1 = /\b(?:no|nunca|tampoco)\s+(?:ya\s+)?$/iu;
const CALL_DISPATCH_CONDITION_PREFIX_V1 = /(?:^|,)\s*(?:y\s+)?(?:si|cuando)\s+[^,;]+,?\s*$/iu;
const CALL_DISPATCH_CONDITION_SUFFIX_V1 = /^\s*(?:ahora\s*)?,?\s*(?:si|cuando)\s+/iu;
const REGISTERED_CALL_STATUSES_V1 = new Set(['requested', 'dispatching', 'provider_accepted', 'in_progress']);
const CLAUSE_V1 = /[^.!?;¿\n]+[.!?;]?/gu;

function clauseClaimsCallDispatchV1(clause: string, activeCallStatus?: string | null): boolean {
  if (clause.trimEnd().endsWith('?')) return false;
  return [...clause.matchAll(new RegExp(CALL_DISPATCH_CLAIM_V1.source, 'giu'))].some((claim) => {
    // A known request can substantiate its registration. It cannot support
    // a fresh “te llamo” promise, nor an ambiguous or terminal call outcome.
    if (REGISTERED_CALL_STATUSES_V1.has(activeCallStatus ?? '') && !/^te\s+/iu.test(claim[0])) return false;
    const before = clause.slice(0, claim.index);
    const after = clause.slice(claim.index + claim[0].length);
    return !CALL_DISPATCH_NEGATION_PREFIX_V1.test(before)
      && !CALL_DISPATCH_CONDITION_PREFIX_V1.test(before)
      && !CALL_DISPATCH_CONDITION_SUFFIX_V1.test(after);
  });
}

/** An unconditional call-effect claim, not a question or a conditional offer. */
export function claimsImmediateCallDispatchV1(text: string, activeCallStatus?: string | null): boolean {
  return (text.match(CLAUSE_V1) ?? []).some((clause) => clauseClaimsCallDispatchV1(clause, activeCallStatus));
}

/** The text without the sentences that claim a call dispatch; the rest is untouched. */
export function withoutCallDispatchClaimsV1(text: string, activeCallStatus?: string | null): string {
  return text.replace(CLAUSE_V1, (clause) => (clauseClaimsCallDispatchV1(clause, activeCallStatus) ? '' : clause))
    .replace(/[ \t]{2,}/gu, ' ').replace(/^[ \t]+|[ \t]+$/gmu, '').trim();
}

/**
 * Prunes dispatch claims sentence by sentence (never a whole bubble when it
 * also carries other copy). A bubble left empty is dropped. Null when nothing
 * claims a dispatch or nothing remains to say.
 */
export function pruneCallDispatchClaimsV1(input: {
  readonly messages: readonly string[];
  readonly call_offer?: string | null;
  readonly active_call_status?: string | null;
}): { messages: string[]; kept_indices: number[]; call_offer: string | null } | null {
  const status = input.active_call_status;
  const offer = input.call_offer ?? null;
  const offerClaims = offer !== null && claimsImmediateCallDispatchV1(offer, status);
  if (!input.messages.some((message) => claimsImmediateCallDispatchV1(message, status)) && !offerClaims) return null;
  const pruned = input.messages.map((message) => withoutCallDispatchClaimsV1(message, status));
  const kept_indices = pruned.flatMap((message, index) => (message.length > 0 ? [index] : []));
  if (kept_indices.length === 0) return null;
  return {
    messages: kept_indices.map((index) => pruned[index]!),
    kept_indices,
    call_offer: offerClaims ? null : offer,
  };
}
