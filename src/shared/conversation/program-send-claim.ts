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
const NOUN = /\b(?:programa|temario|pdf|plan\s+de\s+estudios?|brochure|syllabus)\b/u;
// Present / imperative first-person forms. Preterites (comparti, envie, mande, pase, deje) are NOT matched.
const SEND_NOW = /\b(?:te|les|nos)\s+(?:(?:lo|la)\s+)?(?:comparto|envio|mando|paso|dejo|adjunto|reenvio|vuelvo\s+a\s+(?:enviar|mandar|compartir|pasar))\b|\bahi\s+(?:va|tenes|tienes|esta)\b|\baqui\s+(?:va|tienes|tenes|esta)\b|\bte\s+(?:lo\s+|la\s+)?(?:comparto|envio|mando|paso|dejo)\b/gu;
const NEGATION = /\b(?:no|nunca|tampoco)\s+(?:te\s+)?(?:lo\s+|la\s+)?(?:puedo\s+|podemos\s+|voy\s+a\s+)?$/u;
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
  const wholeTopic = options.programTopic === true || NOUN.test(folded(text));
  for (const raw of sentences) {
    if (raw.trimStart().startsWith('¿') || raw.trimEnd().endsWith('?')) continue;
    const sentence = folded(raw);
    if (OFFER.test(sentence)) continue;
    for (const match of sentence.matchAll(SEND_NOW)) {
      if (NEGATION.test(sentence.slice(0, match.index))) continue;
      const pronominal = /\b(?:lo|la)\b/u.test(match[0]) || /^ahi|^aqui/u.test(match[0]);
      const nounNear = NOUN.test(sentence);
      if (nounNear || (pronominal && wholeTopic)) return true;
    }
  }
  return false;
}
