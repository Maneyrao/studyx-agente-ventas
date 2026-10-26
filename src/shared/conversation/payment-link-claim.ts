/** Portable lexical detection only; authorization remains with the owning agent/backend. */
const LINK_NOUN = /\b(?:link|enlace)\b/u;
const DELIVERY = /\b(?:te\s+(?:lo\s+)?(?:(?:he|hemos)\s+)?(?:paso|envio|mando|comparto|dejo|dejamos|pase|envie|mande|comparti|deje|pasado|enviado|mandado|compartido|dejado)|ahi\s+va|(?:link|enlace)\b.{0,48}\bya\s+(?:esta|quedo))\b/gu;
const COMPLETED = /\b(?:pase|envie|mande|comparti|deje|pasado|enviado|mandado|compartido|dejado|ya\s+(?:esta|quedo))\b/u;
const NEGATION_PREFIX = /\b(?:no|nunca|tampoco)\s+(?:ya\s+)?$/u;
const CONDITION_PREFIX = /(?:^|\b(?:as[ií]\s+que|entonces)\s+)\s*(?:si|cuando|en\s+caso\s+de(?:\s+que)?|una\s+vez\s+que)\s+\S[\s\S]*$/u;
const CONDITION_SUFFIX = /^\s*(?:(?:de|para)\s+(?:el\s+)?pago\s*)?(?:ahora(?:\s+mismo)?\s*)?(?:si|cuando)\s+\S/u;
const CONDITIONAL_ANTECEDENT = /^(?:si|cuando)\s+(?:(?:tu|vos|usted|lo|la|los|las|me|te|nos|ya|aun|todavia)\s+)*\p{L}+(?:as|es|is)\b\s*(.*)$/u;
const INFINITIVE_COMPLEMENT = /^(?:no\s+)?\p{L}+(?:ar|er|ir)(?:me|te|se|lo|la|los|las|nos)?\b/u;
const FINITE_CONSEQUENT = /\b\p{L}{2,}(?:amos|emos|imos|ais|eis|is|as|es|an|en|o|a|e)\b/u;

// Fold Spanish spelling for verb matching, preserving positions and the original
// distinction between conditional "si" and affirmative "sí" for scope checks.
function folded(value: string): string {
  const letters: Record<string, string> = { á: 'a', é: 'e', í: 'i', ó: 'o', ú: 'u', ü: 'u', ñ: 'n' };
  return value.replace(/[áéíóúüñ]/gu, (letter) => letters[letter]);
}

function hasConditionalConsequent(clause: string): boolean {
  const tail = CONDITIONAL_ANTECEDENT.exec(folded(clause))?.[1] ?? '';
  // An infinitive complements the subordinate verb, while another finite
  // predicate is a separate consequent. Scan its tail so intervening adverbs
  // and different grammatical persons do not erase the preceding assertion.
  return !INFINITIVE_COMPLEMENT.test(tail) && FINITE_CONSEQUENT.test(tail);
}

/**
 * Whether text asserts a completed or immediate payment-link delivery.
 * Questions, conditions and negations govern their own matched claim; an
 * unrelated reassurance, question or later condition cannot erase another claim.
 */
export function claimsImmediatePaymentLinkDeliveryV1(text: string): boolean {
  const source = text.normalize('NFC').toLowerCase();
  if (!LINK_NOUN.test(source)) return false;
  const sentences = source.match(/¿[^?;\n]*(?:\?|$)|[^.!?;¿\n]+[.!?;]?/gu) ?? [];
  for (const sentence of sentences) {
    if (sentence.trimStart().startsWith('¿')) continue;
    let inheritedCondition = false;
    // Keep separators: a conditional antecedent may govern its comma-separated
    // consequence, while an adversative starts a new independent statement.
    const pieces = sentence.split(/(,|\s+(?:pero|sin\s+embargo|aunque|y)\s+)/u);
    for (const [pieceIndex, piece] of pieces.entries()) {
      if (/^\s*(?:pero|sin\s+embargo|aunque)\s*$/u.test(piece)) {
        inheritedCondition = false;
        continue;
      }
      if (piece === ',' || /^\s*y\s*$/u.test(piece)) continue;
      const clause = piece.trim();
      const normalized = folded(clause);
      for (const claim of normalized.matchAll(new RegExp(DELIVERY.source, 'gu'))) {
        const before = clause.slice(0, claim.index);
        const after = clause.slice(claim.index + claim[0].length);
        const linkAfter = LINK_NOUN.exec(folded(after));
        const linkBefore = [...folded(before).matchAll(new RegExp(LINK_NOUN.source, 'gu'))].at(-1);
        const pronominal = /\bte\s+lo\b/u.test(claim[0]);
        const subjectInClaim = LINK_NOUN.test(claim[0]);
        const presentedLink = claim[0] === 'ahi va';
        if (!subjectInClaim && !pronominal && !presentedLink
          && !(linkAfter && linkAfter.index <= 48)
          && !(linkBefore && before.length - linkBefore.index <= 48)) continue;
        const completed = COMPLETED.test(claim[0]);
        if (clause.endsWith('?')
          || NEGATION_PREFIX.test(before) || CONDITION_PREFIX.test(before)) continue;
        if (inheritedCondition && !completed) continue;
        // A suffix condition can qualify a proposed send, but cannot turn
        // "ya te envié el link, si quieres seguimos" into an unsent offer.
        const afterSubject = linkAfter
          ? after.slice(linkAfter.index + linkAfter[0].length)
          : after;
        const nextClause = pieces[pieceIndex + 2]?.trim() ?? '';
        const commaSuffix = pieces[pieceIndex + 1] === ','
          && /^(?:si|cuando)\b/u.test(nextClause)
          && !hasConditionalConsequent(nextClause);
        const purposeQuestion = pieces[pieceIndex + 1] === ','
          && /^para\s+\p{L}+(?:ar|er|ir)\b/u.test(folded(nextClause))
          && nextClause.endsWith('?');
        if (!completed && (CONDITION_SUFFIX.test(afterSubject) || commaSuffix || purposeQuestion)) continue;
        return true;
      }
      if (CONDITION_PREFIX.test(clause)) inheritedCondition = true;
    }
  }
  return false;
}
