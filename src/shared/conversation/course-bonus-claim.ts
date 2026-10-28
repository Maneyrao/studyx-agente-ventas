function normalize(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/gu, '').toLowerCase().replace(/[^\S\n]+/gu, ' ').trim();
}

/** Consume the entire object list, not only catalog names found within it. */
function authorizedObjects(value: string, names: readonly string[]): boolean {
  const identities = names.map(normalize).filter(Boolean).sort((a, b) => b.length - a.length);
  let remaining = value.trim();
  let count = 0;
  while (remaining) {
    remaining = remaining.replace(/^(?:(?:el|la|un|una)\s+)?(?:curso\s+(?:de\s+)?)?/u, '');
    const identity = identities.find(name => remaining.startsWith(name)
      && !/^[\p{L}\p{N}_]/u.test(remaining.slice(name.length)));
    if (!identity) return false;
    count += 1;
    remaining = remaining.slice(identity.length).trim();
    if (!remaining) return count > 0;
    const connector = remaining.match(/^(?:,\s*(?:(?:y|e)\s+)?|(?:y|e)\s+)/u);
    if (!connector) return false;
    remaining = remaining.slice(connector[0].length).trim();
    if (!remaining) return false;
  }
  return false;
}

const GIFT_MARKER = /\b(?:regal\p{L}*|gratis|sin\s+(?:costo|cargo)|bonific\p{L}*|bono\s+de\s+curso)\b/gu;
const GIFT_DESCRIPTOR = /\s+(?:de\s+regalo|gratis|sin\s+(?:costo|cargo)(?:\s+adicional)?|bonificad[oa]s?|incluid[oa]s?)\s*$/u;
const GIFT_PREDICATE = /\b(regalo|regalamos|regala|regalarte|bonifico|bonificamos|bonifica|incluyo|incluimos|incluye|incluyen|incluir|sumo|sumamos|sumar|agrego|agregamos|agregar|ofrezco)\s+(.+)$/u;

function giftObject(clause: string, paidNames: readonly string[]): string | null {
  let gift = clause;
  // The purchase condition identifies the paid course, never another gift.
  const condition = gift.match(/\s+(?:al|por)\s+comprar\s+(.+)$/u);
  if (condition) {
    if (!authorizedObjects(condition[1]!, paidNames)) return null;
    gift = gift.slice(0, condition.index).trim();
  }
  const predicate = gift.match(GIFT_PREDICATE);
  if (predicate) {
    if (/^incluye[n]?$/u.test(predicate[1]!)) {
      const subject = gift.slice(0, predicate.index).trim();
      if (subject && !authorizedObjects(subject, paidNames)
        && !/^(?:(?:el|tu|este)\s+(?:paquete|curso)|(?:la|tu|esta)\s+promocion)$/u.test(subject)) return null;
    }
    return predicate[2]!.replace(GIFT_DESCRIPTOR, '').trim();
  }
  if (!GIFT_DESCRIPTOR.test(gift)) return null;
  return gift.replace(GIFT_DESCRIPTOR, '')
    .replace(/\s+(?:sigue|queda|va|esta|seria|es|se\s+incluye|te\s+lo\s+dejo)$/u, '')
    .replace(/^(?:queda\s+confirmad[oa]|ya\s+esta\s+confirmad[oa])\s+/u, '').trim();
}

/**
 * Bounded egress authorization only: a gift object's complete asserted scope
 * must resolve to the already authorized identities. No catalog search or
 * sales interpretation can add an identity to this set.
 */
export function inspectCourseBonusClaimsV1(input: {
  readonly content: string;
  readonly authorized_bonus_names: readonly string[];
  readonly paid_offering_names?: readonly string[];
}): { readonly has_authorized_claim: boolean; readonly has_unauthorized_claim: boolean } {
  const clauses = normalize(input.content).split(/[.!?;\n]+|\b(?:pero|aunque|sin embargo)\b|,\s*(?=(?:no\s+)?(?:te\s+)?(?:regal|inclu|bonific|sum|agreg))|\by\s+(?=(?:no\s+)?(?:te\s+)?(?:regal|inclu|bonific|sum|agreg))/u);
  let authorized = false;
  let unauthorized = false;
  for (const clause of clauses) {
    const markers = [...clause.matchAll(GIFT_MARKER)];
    const implicitGift = /\b(?:agregar|sumar|incluir)\b.*\bcurso\b.*\b(?:mismo\s+(?:precio|valor)|incluid[oa])\b/u.test(clause);
    if (!markers.length && !implicitGift) continue;
    // Only this clause's denied predicate is exempt. A later affirmative
    // predicate is split above and must independently resolve its whole object.
    const deniedPredicate = /^\s*(?:no|nunca|tampoco)\s+(?:(?:te|lo|la|le|les|se)\s+)?(?:(?:puedo|podemos)\s+)?(?:regal\p{L}*|inclu\p{L}*|bonific\p{L}*|tengo|tenemos|hacemos|ofrecemos|damos|hay)\b/u.test(clause);
    const deniedDescriptor = /\b(?:no|nunca|tampoco)\s+(?:es|esta|va|queda)\s+(?:de\s+regalo|gratis|bonificad[oa]|sin\s+(?:costo|cargo))\b/u.test(clause);
    if (markers.length === 1 && (deniedPredicate || deniedDescriptor)) continue;
    const object = giftObject(clause.trim(), input.paid_offering_names ?? []);
    if (object !== null && authorizedObjects(object, input.authorized_bonus_names)) authorized = true;
    else unauthorized = true;
  }
  return { has_authorized_claim: authorized, has_unauthorized_claim: unauthorized };
}
