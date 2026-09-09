type ChannelPreferenceEvidenceV1 = 'call' | 'chat' | null;

/** A model label is not consent. Resolve only the customer's latest explicit
 * choice, including the last message of a batched delivery. */
function channelPreferenceEvidenceV1(
  text: string,
  pendingCallOffer: boolean,
): ChannelPreferenceEvidenceV1 {
  const value = text.normalize('NFD').replace(/[\u0300-\u036f]/gu, '').toLowerCase().trim();
  const declinesPending = pendingCallOffer
    && /^(?:no(?:\s+gracias)?|ahora\s+no|por\s+ahora\s+no|prefiero\s+que\s+no)[,.!\s]*$/u.test(value);
  if (declinesPending) return 'chat';
  const acceptsPending = pendingCallOffer
    && /^(?:si(?:\s+por\s+favor)?|dale|bueno|ok|okay|llamame)[,.!\s]*$/u.test(value);
  if (acceptsPending) return 'call';
  // A bare channel question supplies no preference.
  if (/[?¿]/u.test(value) && !/\b(?:prefiero|sigamos|seguimos|continuemos|mejor|no\s+quiero|llamame|llamarme|llamada|telefono|hablemos)\b/u.test(value)) {
    return null;
  }
  const clauses = value.split(/[\n,;.!?…¿¡]|\b(?:pero|aunque|sin\s+embargo)\b/gu)
    .map((clause) => clause.trim()).filter(Boolean).reverse();
  for (const clause of clauses) {
    const refusesCall = /\b(?:no\s+(?:(?:quiero|puedo|deseo|me\s+interesa)\s+)?(?:(?:una\s+|la\s+|me\s+|que\s+me\s+)?llam\w*|(?:quiero\s+)?hablar\s+por\s+telefono)|sin\s+llam\w*|prefiero\s+que\s+no\s+me\s+llam\w*)\b/u.test(clause);
    const rejectsWritten = /\bno\s+(?:quiero\s+|prefiero\s+)?(?:seguir\s+|continuar\s+)?(?:por\s+)?(?:chat|escrito|mensajes?)\b/u.test(clause);
    const writtenChoice = !rejectsWritten && (
      /\bprefiero\s+(?:mantener|seguir|continuar)[^.!?]{0,40}\bpor\s+(?:chat|escrito|mensajes?)\b/u.test(clause)
      || /\b(?:(?:prefiero|sigamos|seguimos|continuemos|continuar|mejor)\s+(?:(?:seguir|continuar)\s+)?(?:por\s+)?(?:chat|escrito|mensajes?)|(?:sigamos|seguimos|continuemos|prefiero\s+seguir|mejor\s+seguimos)\s+(?:por\s+)?(?:aca|aqui))\b/u.test(clause)
      || /\b(?:contame|cuentame|explicame|decime|dime)(?:\s+todo)?\s+por\s+(?:aca|aqui|chat|escrito)\b/u.test(clause)
      || /^(?:chat|por chat(?:\s+por favor)?|por aca|por aqui|por escrito(?:\s+por favor)?|por mensajes?)$/u.test(clause)
    );
    if (refusesCall || writtenChoice) return 'chat';
    const choosesCall = /\b(?:mejor\s+llamame|prefiero\s+(?:una\s+)?llamada|prefiero\s+(?:hablar\s+)?por\s+telefono|quiero\s+(?:una\s+)?llamada|(?:podes|puedes)\s+llamarme|(?:hablemos|hablamos|podemos\s+(?:hablar|conversar)|podriamos\s+(?:hablar|conversar))\s+por\s+telefono|llamame)\b/u.test(clause);
    if (choosesCall) return 'call';
  }
  return null;
}

export function supportsChatPreferenceV1(text: string, pendingCallOffer: boolean): boolean {
  return channelPreferenceEvidenceV1(text, pendingCallOffer) === 'chat';
}

export function supportsCallRequestV1(text: string, pendingCallOffer: boolean): boolean {
  return channelPreferenceEvidenceV1(text, pendingCallOffer) === 'call';
}
