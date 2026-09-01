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

// ─────────────────────────────────────────────────────────────────────────
// V5 · § 05b — Autorización por estado durable, no por texto.
//
// Todo lo de arriba decide si una oración afirma un resultado operativo, y
// hasta ahora decidía TAMBIÉN si esa afirmación era válida. Eso era un error
// de diseño con dos caras:
//
//   - Demasiado estricto: bloqueaba «Registré tus datos. Cuando informes el
//     pago, el equipo lo revisará y, si está acreditado, gestionará tu
//     acceso.» —la frase que P6 manda escribir— porque veía un resultado
//     operativo junto a un verbo en primera persona, sin mirar a quién se
//     atribuye el resultado ni cuándo ocurre.
//
//   - Demasiado laxo: dejaba pasar «Registré tus datos» aunque no se hubiera
//     registrado nada, porque esa oración no contiene ningún sustantivo
//     operativo de los que reconoce.
//
// La salida fácil habría sido una lista blanca con la frase aprobada. Sería
// un error: la misma oración es verdadera si los datos están registrados y
// falsa si no, y una lista blanca no distingue esos dos casos.
//
// El detector léxico no desaparece — sigue haciendo falta para reconocer que
// una oración hace una afirmación de estado. Lo que cambia es que ya no
// decide si es válida: eso lo decide la cita contra el estado durable.
// ─────────────────────────────────────────────────────────────────────────

import type { StateFactIdV1 } from './state-fact-registry';

export interface OperationalAssertionV1 {
  readonly sentence: string;
  /** El hecho que debe estar materializado para que la oración sea cierta. */
  readonly requires: StateFactIdV1;
}

/**
 * Los hitos externos —inscripción, alta, matrícula, credenciales, acceso
 * entregado, pago verificado— no tienen `fact_id` porque ningún turno
 * conversacional puede establecerlos. Se les asigna un requisito imposible:
 * caen por ausencia de respaldo igual que cualquier otra afirmación sin
 * hecho, sin una regla especial que los enumere.
 */
const UNREACHABLE_MILESTONE = 'state:__external_milestone__:v1' as StateFactIdV1;

/**
 * `\b` no sirve acá. Se apoya en `\w`, que en JavaScript es `[A-Za-z0-9_]`
 * y no incluye vocales acentuadas: en «registré» no hay frontera de palabra
 * después de la «é», así que `registr[ée]\b` no cierra nunca. Es el mismo
 * motivo por el que los patrones de arriba usan `[^\p{L}]` en vez de `\b`.
 * Acá se usan lookarounds, que no consumen el carácter vecino.
 */
const L = '(?<![\\p{L}])';
const R = '(?![\\p{L}])';

const ASSERTION_CLASSES: readonly {
  readonly pattern: RegExp;
  readonly requires: StateFactIdV1;
}[] = [
  {
    // Afirmar que los datos del cliente quedaron guardados.
    pattern: new RegExp(
      `${L}(?:registr[éeo]|guard[éeo]|anot[éeo]|tom[éeo])${R}[^.;]{0,40}${L}datos${R}`,
      'iu',
    ),
    requires: 'state:intake_recorded:v1',
  },
  {
    // Afirmar que consta el aviso de pago del cliente.
    pattern: new RegExp(
      `${L}(?:tengo|qued[óo])\\s+registrad[oa]${R}[^.;]{0,40}`
      + `${L}(?:pago|abonaste|pagaste|informaste)${R}`,
      'iu',
    ),
    requires: 'state:payment_reported:v1',
  },
  {
    pattern: new RegExp(
      `${L}(?:inscripci[óo]n|matr[íi]cula|preinscripci[óo]n)${R}[^.;]{0,30}`
      + `${L}(?:confirmad|carga|complet|realizad)`,
      'iu',
    ),
    requires: UNREACHABLE_MILESTONE,
  },
  {
    pattern: new RegExp(
      `${L}(?:alta\\s+acad[ée]mica|credenciales|usuario\\s+y\\s+contrase|acceso)${R}`
      + `[^.;]{0,40}${L}(?:gener|entreg|habilit|activ|doy|damos|dar)`,
      'iu',
    ),
    requires: UNREACHABLE_MILESTONE,
  },
  {
    pattern: new RegExp(
      `${L}(?:doy|damos|genero|generamos)${R}[^.;]{0,30}`
      + `${L}(?:alta|credenciales|acceso)${R}`,
      'iu',
    ),
    requires: UNREACHABLE_MILESTONE,
  },
  {
    pattern: new RegExp(`${L}pago${R}[^.;]{0,30}${L}(?:verificad|acreditad|confirmad)`, 'iu'),
    requires: UNREACHABLE_MILESTONE,
  },
  {
    // El posesivo no es decoración: "acceso 24/7" es una característica del
    // producto y no dice nada sobre si ESTE cliente tiene acceso. Sin el
    // posesivo, el guard borraba la descripción del curso.
    pattern: new RegExp(
      `${L}(?:tu|su|el|mi)\\s+(?:acceso|campus)${R}[^.;]{0,30}`
      + `${L}(?:habilitad|activad|listo|otorgad)`,
      'iu',
    ),
    requires: UNREACHABLE_MILESTONE,
  },
];

/**
 * Una oración que atribuye el resultado al equipo humano Y lo sitúa después
 * de una verificación no afirma un estado alcanzado: describe el proceso.
 *
 * Son los dos hechos canónicos de § 05b, y es exactamente por esto que «el
 * equipo lo revisará y, si está acreditado, gestionará tu acceso» no cae
 * mientras «gestioné tu acceso» sí. La diferencia no es el sustantivo, es
 * quién actúa y cuándo.
 */
/**
 * Una oración que NIEGA el resultado, o que prohíbe afirmarlo, es lo contrario
 * de una afirmación. Sin esto el agente no podría escribir «todavía no puedo
 * confirmar que el pago esté acreditado», que es justamente la frase honesta
 * que queremos que pueda decir — y el prompt no podría prohibir por escrito lo
 * que el guard bloquea, que es el gate de § 08.
 *
 * La negación se busca ANTES del verbo de resultado dentro de la misma
 * oración, no en cualquier parte: si bastara un «no» suelto, evadir el guard
 * sería trivial.
 */
const NEGATED_ASSERTION = new RegExp(
  '(?:^|[^\\p{L}])(?:'
  + 'no|nunca|jam[áa]s|ni|sin|tampoco|todav[íi]a\\s+no|a[úu]n\\s+no'
  + '|prohibid[oa]|evit[áa]|jam[áa]s\\s+digas'
  + ')(?:[^\\p{L}]|$)',
  'iu',
);

const ATTRIBUTED_TO_TEAM = /\b(?:el\s+equipo|una\s+persona|el\s+[áa]rea|lo\s+revisar)/iu;
const AFTER_VERIFICATION = /\b(?:cuando|si\s+est[áa]\s+acreditad|una\s+vez\s+(?:que\s+)?(?:lo\s+)?verifi|tras\s+(?:la\s+)?verifica|revisar[áa])/iu;

function splitAssertionSentences(text: string): readonly string[] {
  return text
    .split(/(?<=[.;!?…])\s+/u)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

/**
 * Detector léxico. Reconoce que una oración afirma un estado y con qué hecho
 * se sostiene. NO juzga si es válida.
 */
export function detectOperationalStateAssertionsV1(
  text: string,
): readonly OperationalAssertionV1[] {
  const found: OperationalAssertionV1[] = [];
  for (const sentence of splitAssertionSentences(text)) {
    if (ATTRIBUTED_TO_TEAM.test(sentence) && AFTER_VERIFICATION.test(sentence)) continue;
    for (const { pattern, requires } of ASSERTION_CLASSES) {
      const match = pattern.exec(sentence);
      if (match) {
        // La negación cuenta sólo si precede al resultado dentro de la misma
        // oración. "El pago está acreditado, no hace falta nada más" afirma;
        // "no puedo confirmar que el pago esté acreditado" niega.
        if (NEGATED_ASSERTION.test(sentence.slice(0, match.index + match[0].length))) break;
        found.push({ sentence, requires });
        break;
      }
    }
  }
  return found;
}

/**
 * V5. Las afirmaciones cuyo hecho no está materializado para este turno.
 * Un resultado no vacío es `UNSUPPORTED_OPERATIONAL_CLAIM`.
 */
export function unsupportedOperationalAssertionsV1(
  text: string,
  materialized: ReadonlySet<StateFactIdV1>,
): readonly OperationalAssertionV1[] {
  return detectOperationalStateAssertionsV1(text)
    .filter((assertion) => !materialized.has(assertion.requires));
}
