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
  + '|(?:tus|sus|las)\\s+credenciales\\b|alta\\s+acad[eé]mica'
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
 * The agent committing to perform the outcome itself. Same lie, future tense:
 * "te doy el alta", "genero tus credenciales", "en unos minutos te llega".
 * Nothing downstream will do any of it.
 *
 * The subject matters. A sentence about what the CUSTOMER must do
 * ("para inscribirte necesitás pagar") or about what a HUMAN will do later
 * ("cuando el equipo confirme el pago, te contactan") promises nothing on the
 * agent's behalf and is left alone.
 */
const AGENT_COMMITMENT = new RegExp(
  '(?:^|[^\\p{L}])(?:'
  + '(?:te\\s+|le\\s+)?(?:doy|damos|genero|generamos|habilito|habilitamos'
  + '|inscribo|inscribimos|matriculo|matriculamos|activo|activamos'
  + '|cargo|cargamos|proceso|procesamos|anoto|anotamos|registro|registramos)'
  + '|procedo\\s+a|proceder[eé]\\s+a|voy\\s+a\\s+(?:dar|generar|habilitar|cargar|inscribir)'
  + '|te\\s+(?:llega|llegan|env[ií]o|enviamos|mando|mandamos)'
  + ')(?:[^\\p{L}]|$)',
  'iu',
);

/**
 * Acts where the verb IS the outcome, so there is no separate noun to find:
 * enrolling someone, admitting them, granting them access. Deliberately narrow
 * — "te registro la preferencia" is a real thing the turn does, and stays out.
 */
const SELF_CONTAINED_ACT = new RegExp(
  '(?:^|[^\\p{L}])(?:'
  + '(?:te|lo|la|los|las)\\s+(?:inscribo|inscribimos|matriculo|matriculamos|anoto|anotamos)'
  + '|d(?:oy|amos)\\s+de\\s+alta|te\\s+habilit(?:o|amos)'
  + ')(?:[^\\p{L}]|$)',
  'iu',
);

/**
 * Whether one sentence claims an operational outcome already happened, or
 * commits the agent to making it happen.
 */
export function assertsCompletedOperationalOutcome(sentence: string): boolean {
  if (SELF_CONTAINED_ACT.test(sentence)) return true;
  if (!OPERATIONAL_OUTCOME.test(sentence)) return false;
  return COMPLETED_ASSERTION.test(sentence) || AGENT_COMMITMENT.test(sentence);
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

/**
 * Whether a sentence solicits a voice call from the customer.
 *
 * The conversation-local ledger allows at most two proactive call offers, and
 * that budget was only ever applied to the offer the assembler itself appends.
 * An offer the model wrote inside its own narrative was invisible to it, so a
 * customer could see three offers while the ledger had spent two.
 *
 * Solicitation, not mention. Confirming a call the customer already asked for,
 * or acknowledging that they declined one, talks about calls without offering
 * one, and neither consumes the budget nor is removed.
 */
const CALL_SUBJECT = /(?:llamada|llamemos|llamarte|llamarnos|telef[oó]nic|por\s+tel[eé]fono|contactemos|contactarte)/iu;

const SOLICITATION = new RegExp(
  '(?:'
  + 'quer[eé]s|querr[ií]as|te\\s+gustar[ií]a|prefer[ií]s|preferir[ií]as'
  + '|si\\s+quer[eé]s|pod[eé]s\\s+(?:pedir|solicitar)|podemos\\s+(?:coordinar|agendar|organizar)'
  + '|te\\s+parece|avisame\\s+si|dec[ií]me\\s+si'
  + ')',
  'iu',
);

/** A negation or a completed request is not an offer. */
const NOT_AN_OFFER = /(?:ya\s+(?:registr|qued|solicit|ped)|no\s+te\s+llam|sin\s+llamada|nada\s+de\s+llam)/iu;

export function solicitsACall(text: string): boolean {
  return CALL_SUBJECT.test(text)
    && SOLICITATION.test(text)
    && !NOT_AN_OFFER.test(text);
}

/**
 * Removes every call solicitation the model wrote itself. The assembler owns
 * the single ledgered offer and appends it separately, so the narrative never
 * needs to carry one.
 */
export function stripModelAuthoredCallOffers(text: string): string {
  return text
    .split(/\n{2,}/u)
    .map((paragraph) => sentences(paragraph)
      .filter((sentence) => !solicitsACall(sentence))
      .join(' ')
      .trim())
    .filter((paragraph) => paragraph.length > 0)
    .join('\n\n');
}
