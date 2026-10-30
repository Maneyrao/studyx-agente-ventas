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

const NAMED_GIFT_DESCRIPTOR = /^(?:,\s*)?(?:tambien\s+)?(?:de\s+regalo|gratis|sin\s+(?:costo|cargo)(?:\s+(?:extra|adicional))?|bonificad[oa]|incluid[oa])\b/u;

function namedIdentityAtStart(value: string, identities: readonly string[]): string | null {
  return identities.find(identity => value.startsWith(identity)
    && !/^[\p{L}\p{N}_]/u.test(value.slice(identity.length))) ?? null;
}

/**
 * Extract only catalog identities asserted by the narrow conversational form
 * "te llevás también X". The text after X remains free commercial copy unless
 * it contains another explicit course delivery (a direct list, or
 * "con <curso> también/gratis").
 */
function namedAdditiveCourseClaims(value: string, names: readonly string[]): {
  readonly claims: readonly string[];
  readonly has_unresolved_gift_tail: boolean;
} {
  const identities = [...new Set(names.map(normalize).filter(Boolean))]
    .sort((a, b) => b.length - a.length);
  let remaining = normalize(value)
    .replace(/^(?:(?:el|la|un|una)\s+)?(?:curso\s+(?:de\s+)?)?/u, '')
    .trim();
  const claims: string[] = [];

  const first = namedIdentityAtStart(remaining, identities);
  if (!first) return { claims: [], has_unresolved_gift_tail: false };
  claims.push(first);
  remaining = remaining.slice(first.length).trim();

  // A descriptor qualifies the identity just consumed; it never expands the
  // claimed object to the rest of the sales sentence.
  remaining = remaining.replace(NAMED_GIFT_DESCRIPTOR, '').trim();

  // Consume only an explicit list of immediately adjacent catalog courses.
  // A connector followed by ordinary closing copy ("y avanzamos") is not an
  // invalid effect and remains outside this fact validator.
  while (remaining) {
    const connector = remaining.match(/^(?:,\s*(?:(?:y|e)\s+)?|(?:y|e)\s+)(?:tambien\s+)?/u);
    if (!connector) break;
    const candidate = remaining.slice(connector[0].length).trim()
      .replace(/^(?:(?:el|la|un|una)\s+)?(?:curso\s+(?:de\s+)?)?/u, '');
    const identity = namedIdentityAtStart(candidate, identities);
    if (!identity) break;
    claims.push(identity);
    remaining = candidate.slice(identity.length).trim();
    remaining = remaining.replace(NAMED_GIFT_DESCRIPTOR, '').trim();
  }

  // An explanatory tail can contain a second, independently asserted course.
  // Recognize only the bounded form; do not interpret persuasion or closing
  // language as an effect.
  const parallel = /\b(?:con|ademas)\s+/gu;
  let sanitizedTail = '';
  let sanitizedCursor = 0;
  for (const match of remaining.matchAll(parallel)) {
    const prefixEnd = (match.index ?? 0) + match[0].length;
    const rawCandidate = remaining.slice(prefixEnd);
    const objectPrefix = rawCandidate.match(/^(?:(?:el|la|un|una)\s+)?(?:curso\s+(?:de\s+)?)?/u)?.[0] ?? '';
    const candidate = rawCandidate.slice(objectPrefix.length);
    const identity = namedIdentityAtStart(candidate, identities);
    if (!identity) continue;
    const tail = candidate.slice(identity.length).trim();
    const assertion = tail.match(/^(?:tambien(?:\s+(?:de\s+regalo|gratis|sin\s+(?:costo|cargo)(?:\s+(?:extra|adicional))?|bonificad[oa]|incluid[oa]))?|(?:,\s*)?(?:de\s+regalo|gratis|sin\s+(?:costo|cargo)(?:\s+(?:extra|adicional))?|bonificad[oa]|incluid[oa]))\b/u);
    if (!assertion) continue;
    claims.push(identity);
    const assertionEnd = prefixEnd + objectPrefix.length + identity.length
      + candidate.slice(identity.length).indexOf(tail) + assertion[0].length;
    sanitizedTail += remaining.slice(sanitizedCursor, match.index);
    sanitizedCursor = assertionEnd;
  }
  sanitizedTail += remaining.slice(sanitizedCursor);

  return {
    claims: [...new Set(claims)],
    has_unresolved_gift_tail: GIFT_TAIL_ASSERTION.test(sanitizedTail)
      || GIFT_TAIL_ADDITIONAL_COURSE.test(sanitizedTail),
  };
}

const GIFT_MARKER = /\b(?:regal\p{L}*|gratis|sin\s+(?:costo|cargo)|bonific\p{L}*|bono\s+de\s+curso)\b/gu;
// Tail inspection also includes descriptors that are meaningful only after a
// gift predicate ("Inglés incluido"). Keeping them here prevents an ordinary
// price explanation from swallowing a second asserted course.
const GIFT_TAIL_ASSERTION = /\b(?:regal\p{L}*|gratis|sin\s+(?:costo|cargo)|bonific\p{L}*|bono\s+de\s+curso|incluid[oa]s?)\b/u;
const GIFT_TAIL_PREDICATE = /\b(?:regal\p{L}*|bonific\p{L}*|incluy\p{L}*|sum\p{L}*|agreg\p{L}*)\b/u;
const GIFT_TAIL_ADDITIONAL_COURSE = /\b(?:(?:otro|un)\s+)?curso\s+(?:adicional|extra)\b/u;
const GIFT_TAIL_PARALLEL_OBJECT = /\b(?:con|ademas|y)\s+[^,;]{1,120}\s+tambien\b/u;
const GIFT_DESCRIPTOR_SOURCE = '(?:de\\s+regalo|gratis|sin\\s+(?:costo|cargo)(?:\\s+(?:adicional|extra))?|bonificad[oa]s?|incluid[oa]s?)';
const GIFT_DESCRIPTOR = new RegExp(`(?:,\\s*|\\s+)${GIFT_DESCRIPTOR_SOURCE}\\s*$`, 'u');
const GIFT_DESCRIPTOR_BEFORE_EXPLANATION = new RegExp(
  `(?:,\\s*|\\s+)${GIFT_DESCRIPTOR_SOURCE}(?=\\s*(?:,|:|$))`,
  'u',
);
const GIFT_PREDICATE = /\b(regalo|regalamos|regala|regalarte|bonifico|bonificamos|bonifica|incluyo|incluimos|incluye|incluyen|incluir|inclui|sumo|sumamos|sumar|sumarte|sume|sumad[oa]|agrego|agregamos|agregar|agregue|ofrezco)\s+(.+)$/u;
const EXPLANATION_BOUNDARY = /\s+para\s+|,\s*(?:que|para)\s+|:\s*(?=(?:te\s+sirve|para\b|porque\b|asi\b|que\b))/gu;

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
    let object = predicate[2]!
      // Natural offers often qualify the exact course after naming it. That
      // qualifier is not part of the catalog identity (and course names may
      // legitimately contain "para", so it cannot be treated as an
      // explanation boundary).
      .replace(/\s+como\s+(?:curso\s+)?(?:bonificad[oa]|regalo|gratis)(?=\s*(?:,|$))/u, '')
      .trim();
    // A price-preservation explanation and its ordinary closing question may
    // follow the exact gift object. Never consume that tail if it contains a
    // second gift marker: the complete asserted scope must remain visible to
    // the authorization check below.
    const priceExplanation = object.match(/,\s*(?:y\s+)?sin\s+cambiar\s+(?:el\s+)?(?:precio|valor)\b/u);
    if (priceExplanation?.index !== undefined) {
      const tail = object.slice(priceExplanation.index + priceExplanation[0].length);
      const assertsAnotherGift = GIFT_TAIL_ASSERTION.test(tail)
        || GIFT_TAIL_PREDICATE.test(tail)
        || GIFT_TAIL_ADDITIONAL_COURSE.test(tail)
        || GIFT_TAIL_PARALLEL_OBJECT.test(tail);
      // The commercial closing remains free-form. Only an independently
      // recognizable additional gift keeps the tail inside the asserted
      // object scope; ordinary persuasion and plan alternatives are not
      // interpreted by this fact/effect guard.
      if (!assertsAnotherGift) object = object.slice(0, priceExplanation.index).trim();
    }
    const descriptorExplanation = object.match(GIFT_DESCRIPTOR_BEFORE_EXPLANATION);
    if (descriptorExplanation?.index !== undefined) {
      const descriptorEnd = descriptorExplanation.index + descriptorExplanation[0].length;
      const tail = object.slice(descriptorEnd);
      const assertsAnotherGift = GIFT_TAIL_ASSERTION.test(tail)
        || GIFT_TAIL_PREDICATE.test(tail)
        || GIFT_TAIL_ADDITIONAL_COURSE.test(tail)
        || GIFT_TAIL_PARALLEL_OBJECT.test(tail);
      if (!assertsAnotherGift) object = object.slice(0, descriptorEnd).trim();
    }
    return object.replace(GIFT_DESCRIPTOR, '').trim();
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
  readonly known_offering_names?: readonly string[];
  readonly paid_offering_names?: readonly string[];
}): { readonly has_authorized_claim: boolean; readonly has_unauthorized_claim: boolean } {
  // Keep question closings attached to the offer clause. Splitting on `?`
  // would let an unsafe tail disappear before the complete gift scope is
  // checked (and would also detach a legitimate closing question).
  const normalizedContent = normalize(input.content).replace(/[¿?]/gu, '');
  const hasExplicitGiftContext = GIFT_TAIL_ASSERTION.test(normalizedContent);
  const clauses = normalizedContent.split(/[.!;\n]+|\b(?:pero|aunque|sin embargo)\b|,\s*(?=(?:no\s+)?(?:te\s+)?(?:regal|inclu|bonific|sum|agreg|llev))|\by\s+(?=(?:no\s+)?(?:te\s+)?(?:regal|inclu|bonific|sum|agreg|llev))/u);
  let authorized = false;
  let unauthorized = false;
  for (let index = 0; index < clauses.length; index += 1) {
    const clause = clauses[index]!;
    // A rejected direct-bonus proposal can lose its structured action during
    // recovery while retaining natural copy such as "te llevás también X".
    // Treat it as an effect claim only when X resolves to a real course; this
    // keeps ordinary benefits such as a certificate outside the bonus guard.
    const additiveCourse = clause.match(/\b(?:te\s+)?llevas\s+tambien\s+(.+)$/u)?.[1]?.trim() ?? null;
    if (additiveCourse !== null) {
      const authorizedNames = new Set(input.authorized_bonus_names.map(normalize));
      const scope = namedAdditiveCourseClaims(additiveCourse, [
        ...input.authorized_bonus_names,
        ...(input.known_offering_names ?? []),
      ]);
      if (scope.claims.length > 0) {
        if (scope.claims.some((claim) => authorizedNames.has(claim))) authorized = true;
        if (scope.has_unresolved_gift_tail
          || scope.claims.some((claim) => !authorizedNames.has(claim))) {
          unauthorized = true;
        }
        continue;
      }
    }
    const markers = [...clause.matchAll(GIFT_MARKER)];
    const implicitGift = /\b(?:agregar|sumar|incluir)\b.*\bcurso\b.*\b(?:mismo\s+(?:precio|valor)|incluid[oa])\b/u.test(clause);
    const contextualAdditiveGift = hasExplicitGiftContext
      && /^\s*(?:ademas\s+)?(?:te\s+)?(?:sumo|agrego|incluyo)\b/u.test(clause);
    if (!markers.length && !implicitGift && !contextualAdditiveGift) continue;
    // Only this clause's denied predicate is exempt. A later affirmative
    // predicate is split above and must independently resolve its whole object.
    const deniedPredicate = /^\s*(?:no|nunca|tampoco)\s+(?:(?:te|lo|la|le|les|se)\s+)?(?:(?:puedo|podemos)\s+)?(?:regal\p{L}*|inclu\p{L}*|bonific\p{L}*)\b/u.test(clause);
    const deniedExistence = /^\s*(?:no|nunca|tampoco)\s+(?:tengo|tenemos|hacemos|ofrecemos|damos|hay)\s+(?:(?:ningun[oa]?|un[oa]?|mas)\s+)?(?:regalos?|bonificaciones?|promociones?|cursos?\s+(?:gratis|bonificados?))\b/u.test(clause);
    const deniedDescriptor = /\b(?:no|nunca|tampoco)\s+(?:es|esta|va|queda)\s+(?:de\s+regalo|gratis|bonificad[oa]|sin\s+(?:costo|cargo))\b/u.test(clause);
    if (markers.length === 1 && (deniedPredicate || deniedExistence || deniedDescriptor)) continue;
    const paidNames = input.paid_offering_names ?? [];
    let asserted = clause.trim();
    let object = giftObject(asserted, paidNames);
    let objectAuthorized = object !== null && authorizedObjects(object, input.authorized_bonus_names);
    if (!objectAuthorized) {
      // Course identities may contain "para" (for example, "Fotografía con
      // Celulares para Tiendas Online"). Test each possible explanation
      // boundary and accept only the first prefix whose whole gift object is
      // an authorized identity. The detached tail is processed as its own
      // clause so an extra gift can never hide in the explanation.
      for (const boundary of clause.matchAll(EXPLANATION_BOUNDARY)) {
        if (boundary.index <= (markers[0]?.index ?? Infinity)) continue;
        const candidate = clause.slice(0, boundary.index).trim();
        const candidateObject = giftObject(candidate, paidNames);
        if (candidateObject === null
          || !authorizedObjects(candidateObject, input.authorized_bonus_names)) continue;
        asserted = candidate;
        object = candidateObject;
        objectAuthorized = true;
        clauses.push(clause.slice(boundary.index).replace(/^[:,]\s*/u, '').trim());
        break;
      }
    }
    if (objectAuthorized) authorized = true;
    else unauthorized = true;
  }
  return { has_authorized_claim: authorized, has_unauthorized_claim: unauthorized };
}
