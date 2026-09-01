/**
 * Guard against claiming an operational outcome that never happened.
 *
 * Production incident: the agent told a customer "ya te dejo la preinscripción
 * cargada en el sistema". Nothing was loaded anywhere — no row, no record, no
 * operator had seen it. The sentence was invented, and the customer believed
 * it and waited.
 *
 * The rule is not about particular wording. Asserting that an enrolment,
 * registration, admission or access ALREADY EXISTS is a claim about durable
 * state, and no conversational turn can create that state: the pipeline's only
 * committed business actions are sending a payment link and requesting a call.
 * So the claim is never supported and is always removed.
 *
 * Two conditions must hold together, in the same sentence:
 *   - the subject is an operational outcome (an enrolment, an admission, a
 *     seat, an access), not a preference, a price or a choice; and
 *   - it is asserted as already completed, not as a future step or a
 *     condition.
 *
 * Either alone is ordinary, truthful copy. "Para inscribirte necesitás pagar"
 * names the outcome as a future step. "Queda registrada tu elección de plan"
 * is completed, but the subject is the customer's own choice, which the turn
 * really did record. Neither is touched.
 */

/** The outcome nouns. Participles are listed as written; no prefix matching,
 *  so the verb "inscribirte" is never mistaken for the noun "inscripción". */
const OPERATIONAL_OUTCOME = new RegExp(
  '(?:^|[^\\p{L}])(?:'
  + 'pre\\s?-?\\s?inscripci[oó]n(?:es)?|inscripci[oó]n(?:es)?'
  + '|matr[ií]cula(?:s)?|matriculaci[oó]n'
  + '|inscripto|inscripta|inscriptos|inscriptas|inscrito|inscrita'
  + '|matriculado|matriculada|anotado|anotada'
  + '|(?:el|tu|su|la|mi|un)\\s+alta\\b'
  + '|(?:el|tu|su|mi)\\s+acceso\\b'
  + '|(?:el|tu|su|mi)\\s+cupo\\b|vacante(?:s)?|(?:tu|su|la)\\s+plaza\\b'
  + ')(?:[^\\p{L}]|$)',
  'iu',
);

/** Assertions that the thing is already done. */
const COMPLETED_ASSERTION = new RegExp(
  '(?:^|[^\\p{L}])(?:'
  + 'cargad[oa]s?|confirmad[oa]s?|habilitad[oa]s?|procesad[oa]s?|activad[oa]s?'
  + '|acreditad[oa]s?|registrad[oa]s?|generad[oa]s?|efectuad[oa]s?|realizad[oa]s?'
  + '|complet[oa]s?|completad[oa]s?|list[oa]s?|hech[oa]s?|otorgad[oa]s?|asignad[oa]s?'
  + '|qued[oó]|quedaron|est[aá]\\s+lista|ya\\s+est[aá]|ya\\s+qued'
  + ')(?:[^\\p{L}]|$)',
  'iu',
);

/**
 * Whether one sentence claims an operational outcome already happened.
 */
export function assertsCompletedOperationalOutcome(sentence: string): boolean {
  return OPERATIONAL_OUTCOME.test(sentence) && COMPLETED_ASSERTION.test(sentence);
}

/** Splits on sentence terminators while keeping each terminator attached. */
function sentences(paragraph: string): string[] {
  const parts = paragraph.match(/[^.!?…]+(?:[.!?…]+|$)/gu);
  return parts ? parts.filter((part) => part.trim().length > 0) : [];
}

/**
 * Removes every sentence that claims an unsupported operational outcome and
 * keeps everything else, including the paragraph structure around it. A
 * paragraph left empty disappears rather than becoming a blank gap.
 */
export function stripUnsupportedOperationalClaims(text: string): string {
  return text
    .split(/\n{2,}/u)
    .map((paragraph) => sentences(paragraph)
      .filter((sentence) => !assertsCompletedOperationalOutcome(sentence))
      .join(' ')
      .trim())
    .filter((paragraph) => paragraph.length > 0)
    .join('\n\n');
}
