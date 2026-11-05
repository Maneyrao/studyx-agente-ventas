/**
 * Effect claim: the reply says a course programme (temario / PDF) is being sent or
 * shared NOW. True only when a `send_course_program` action was accepted for it, so a
 * claim without that effect is repaired or removed like a payment-link claim.
 * Portable lexical detection only; authorization stays with the backend.
 *
 * Not claims: a question or an offer ("si querés te lo mando", "¿te lo comparto?"),
 * a negation ("no te lo puedo mandar"), and past references to an earlier delivery
 * ("ya te lo compartí", "te lo había enviado"): those are true when the ledger says sent.
 */
const NOUN = String.raw`(?:programa|temario|pdf|plan\s+de\s+estudios?|brochure|syllabus)`;
const DOCUMENT_NOUN = new RegExp(`\\b${NOUN}\\b`, 'u');
// The document must be the OBJECT of the send ("te comparto el programa"), not a modifier ("link ... del programa").
const DETERMINER = String.raw`(?:(?:el|la|tu|este|mi|un|una|nuestro)\s+)?(?:archivo\s+(?:del|de)\s+)?(?:adjunto\s+)?`;
const PRESENT_VERB = String.raw`(?:comparto|envio|mando|paso|dejo|adjunto|reenvio|vuelvo\s+a\s+(?:enviar|mandar|compartir|pasar))`;
const PAST_VERB = String.raw`(?:envie|mande|comparti|pase|deje|adjunte|reenvie)`;
const IO = String.raw`(?:(?:te|les|nos)\s+)`;
const PRESENT_WITH_NOUN = new RegExp(`\\b${IO}?${PRESENT_VERB}\\s+(?:ahora\\s+|ya\\s+|tambien\\s+|por\\s+aca\\s+)?${DETERMINER}${NOUN}\\b`, 'u');
const PRESENT_PRONOUN = new RegExp(`\\b${IO}(?:lo|la)\\s+${PRESENT_VERB}\\b`, 'u');
const PRESENTATION = new RegExp(`\\b(?:ahi|aca|aqui|alli)\\s+(?:va|tienes|tenes|esta|viene)\\s+${DETERMINER}(?:${NOUN}\\b|[.,;:]|$)`, 'u');
// A past send is a claim about THIS turn unless it points to an earlier delivery ("ya", "antes", "habia", "hace ...").
const PAST_WITH_NOUN = new RegExp(`\\b${IO}?${PAST_VERB}\\s+${DETERMINER}${NOUN}\\b`, 'u');
const PAST_PRONOUN = new RegExp(`\\b${IO}(?:lo|la)\\s+${PAST_VERB}\\b`, 'u');
const EARLIER_DELIVERY = /\b(?:ya|antes|anteriormente|habia|hace\s+\w+|mas\s+arriba|recien\s+te\s+lo\s+dije)\b/u;
// Sentences about the payment link / checkout / enrolment are not programme sends.
const ABOUT_LINK_OR_PAYMENT = /\b(?:link|enlace|url|pago|pagos|pagar|cuotas?|inscripcion|inscribir\w*|checkout|factura)\b/u;
const NEGATION = /\b(?:no|nunca|tampoco)\s+(?:te\s+)?(?:lo\s+|la\s+)?(?:puedo\s+|podemos\s+|voy\s+a\s+|pude\s+)?$/u;
const OFFER = /\b(?:si|cuando)\s+(?:queres|quieres|gustas|prefieres|necesitas|te\s+(?:sirve|interesa|parece|gustaria)|lo\s+(?:queres|quieres|necesitas))\b/u;

function folded(value: string): string {
  const letters: Record<string, string> = { á: 'a', é: 'e', í: 'i', ó: 'o', ú: 'u', ü: 'u', ñ: 'n' };
  return value.toLowerCase().replace(/[áéíóúüñ]/gu, (letter) => letters[letter]!);
}

export interface ProgramSendClaimOptionsV1 {
  /** The current turn is about a programme (move=request_course_program): a bare "te lo comparto" refers to it. */
  readonly programTopic?: boolean;
}

export function claimsProgramSendNowV1(text: string, options: ProgramSendClaimOptionsV1 = {}): boolean {
  const sentences = text.normalize('NFC').match(/¿[^?\n]*(?:\?|$)|[^.!?;¿\n]+[.!?;]?/gu) ?? [];
  const wholeTopic = options.programTopic === true || DOCUMENT_NOUN.test(folded(text));
  for (const raw of sentences) {
    if (raw.trimStart().startsWith('¿') || raw.trimEnd().endsWith('?')) continue;
    const sentence = folded(raw);
    if (OFFER.test(sentence) || ABOUT_LINK_OR_PAYMENT.test(sentence)) continue;
    // Clause-level scan so "ya te lo había enviado, pero te lo comparto otra vez" still claims.
    for (const clause of sentence.split(/,|\bpero\b|\baunque\b/u)) {
      const negated = (pattern: RegExp) => {
        const match = pattern.exec(clause);
        return match === null || NEGATION.test(clause.slice(0, match.index));
      };
      const earlier = EARLIER_DELIVERY.test(clause);
      if (PRESENT_WITH_NOUN.test(clause) && !negated(PRESENT_WITH_NOUN)) return true;
      if (PRESENT_PRONOUN.test(clause) && wholeTopic && !negated(PRESENT_PRONOUN)) return true;
      if (PRESENTATION.test(clause) && (DOCUMENT_NOUN.test(clause) || wholeTopic)) return true;
      if (!earlier && PAST_WITH_NOUN.test(clause) && !negated(PAST_WITH_NOUN)) return true;
      if (!earlier && PAST_PRONOUN.test(clause) && wholeTopic && !negated(PAST_PRONOUN)) return true;
    }
  }
  return false;
}
