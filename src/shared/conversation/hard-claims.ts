/**
 * Hard factual controls (AGENTS.md "Material de Gabi", controles duros).
 *
 * These detectors validate CLAIMS, never sales quality: a sentence that falsely
 * promises an official title, guaranteed work or income, a state license, an
 * invented quota/discount/deadline, USD 699 or a "beca". They are portable
 * (no I/O) and shared by the Botpress brain validator and the backend truth
 * guard, so both sides reject exactly the same wording.
 *
 * Each detector is deliberately narrow. A correct negation ("no es un título
 * oficial", "no reemplaza la licencia") must pass.
 */

export type HardClaimKindV1 =
  | 'official_title'
  | 'guaranteed_employment'
  | 'income_promise'
  | 'license_claim'
  | 'invented_scarcity'
  | 'invented_discount'
  | 'invented_deadline'
  | 'forbidden_price'
  | 'scholarship'
  | 'invented_testimonial';

export interface HardClaimV1 {
  readonly kind: HardClaimKindV1;
  readonly sentence: string;
}

/** URLs carry opaque ids (a Stripe link may hold "699" or "beca"); they are not prose. */
const URL_IN_TEXT = /https?:\/\/[^\s<>"')\]}]+/giu;
export function stripUrlsV1(value: string): string {
  return value.replace(URL_IN_TEXT, ' ');
}

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** Day/month pairs (as "d/m" and "d de mes") the authorized expiry can be read as, in the markets' time zones. */
function authorizedExpiryDates(iso: string | null | undefined): Set<string> {
  const dates = new Set<string>();
  const time = iso ? Date.parse(iso) : Number.NaN;
  if (Number.isNaN(time)) return dates;
  for (const offsetHours of [0, -3, -5]) {
    const local = new Date(time + offsetHours * 3_600_000);
    const day = local.getUTCDate();
    const month = local.getUTCMonth();
    dates.add(`${day}/${month + 1}`);
    dates.add(`${day} de ${MONTHS[month]}`);
  }
  return dates;
}

function fold(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/gu, '').toLowerCase();
}

/** A negation inside the same clause, just before the claim, turns it into a denial. */
const NEGATION = /\b(?:no|ni|nunca|jamas|tampoco|sin)\b[^.!?;\n]{0,36}$/u;

function negatedBefore(text: string, index: number): boolean {
  return NEGATION.test(text.slice(0, index));
}

/** Runs `pattern` and reports whether any match is NOT preceded by a negation. */
function hasAffirmed(text: string, pattern: RegExp): boolean {
  const global = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
  for (const match of text.matchAll(global)) {
    if (!negatedBefore(text, match.index ?? 0)) return true;
  }
  return false;
}

const OFFICIAL_TITLE = [
  /\btitulo\s+(?:oficial|universitari[oa]|academico|estatal|gubernamental|profesional\s+oficial|habilitante)/u,
  /\b(?:diploma|certificado|certificacion)\s+(?:oficial|universitari[oa]|gubernamental|estatal)\b/u,
  /\b(?:titulo|diploma|certificado|certificacion|diplomado|curso|formacion)\b[^.!?\n]{0,50}\b(?:acreditad[oa]s?|avalad[oa]s?|reconocid[oa]s?|homologad[oa]s?|validad[oa]s?|certificad[oa]s?|respaldad[oa]s?)\s+(?:oficialmente\s+)?(?:por|ante)\s+(?:el\s+|la\s+|una\s+|las\s+|los\s+)?(?:estado|gobierno|ministerio|universidad(?:es)?|secretaria\s+de\s+educacion|sep\b)/u,
  /\b(?:acreditad[oa]s?|avalad[oa]s?|reconocid[oa]s?|homologad[oa]s?)\s+(?:oficialmente\s+)?(?:por|ante)\s+(?:el\s+|la\s+|una\s+)?(?:estado|gobierno|ministerio|universidad(?:es)?)\b/u,
  /\b(?:validez|valor|reconocimiento)\s+(?:oficial|universitari[oa]|academic[oa])\b/u,
  /\bvalid[oa]\s+(?:oficialmente|ante\s+el\s+(?:estado|gobierno))\b/u,
];

const EMPLOYMENT = [
  /\bgarantiz\w*\s+(?:el\s+|un\s+|tu\s+)?(?:empleo|trabajo|puesto|salida\s+laboral|insercion\s+laboral|colocacion)\b/u,
  /\b(?:empleo|trabajo|puesto|salida\s+laboral|insercion\s+laboral)\s+(?:garantizad[oa]|asegurad[oa]|seguro)\b/u,
  /\b(?:salida\s+laboral|trabajo|empleo)\s+(?:100\s*%|inmediat[oa])\b/u,
  /\b(?:aseguramos|aseguro|prometemos|prometo|te\s+aseguro|te\s+prometo)\s+(?:que\s+)?(?:(?:vas\s+a\s+|podras\s+|vas\s+a\s+poder\s+)?(?:conseguir|encontrar|tener|obtener)\s+)?(?:un\s+|el\s+)?(?:trabajo|empleo|puesto)\b/u,
  /\b(?:vas\s+a|conseguiras|consegu[ií]s)\s+(?:conseguir\s+)?(?:trabajo|empleo)\s+(?:seguro|si\s+o\s+si|asegurad[oa]|garantizad[oa])\b/u,
];

const EARNING_VERB = '(?:ganar|ganas|gana|ganan|ganaras|ganarias|ganaria|facturar|facturas|factura|ingresos?|sueldo|salario|remuneracion)';
const CURRENCY_AMOUNT = '(?:(?:usd|us\\$|u\\$s|\\$|€|eur)\\s*\\d[\\d.,]*|\\d[\\d.,]*\\s*(?:usd|dolares|dolar|pesos|euros|mil|k)\\b)';
const INCOME = [
  new RegExp(`\\b${EARNING_VERB}\\b[^.!?\\n]{0,60}${CURRENCY_AMOUNT}`, 'u'),
  new RegExp(`${CURRENCY_AMOUNT}[^.!?\\n]{0,30}\\b(?:de\\s+)?(?:ingresos?|ganancias?|sueldo|salario)\\b`, 'u'),
  /\b(?:ingresos?|ganancias?)\s+(?:garantizad[oa]s?|asegurad[oa]s?|seguros?)\b/u,
  /\bgarantiz\w*\s+(?:tus\s+|los\s+)?(?:ingresos?|ganancias?)\b/u,
];

const TRADE = /\b(?:electric\w*|plomer\w*|plomeria|fontaner\w*|masoterap\w*|masajes?\b|depilacion\s+(?:laser|definitiva)|farmaci\w*|real\s+estate|bienes\s+raices|inmobiliari\w*|corredor\s+de\s+propiedades)/u;
const LICENSE_GRANT = [
  /\b(?:reemplaz\w+|sustituy\w+|equival\w+|habilit\w+|autoriz\w+|otorg\w+)\b[^.!?\n]{0,50}\b(?:licencia|matricula|ejercer|ejercicio|trabajar\s+legal\w*|practicar|operar\s+legal\w*)/u,
  /\b(?:te|les|nos)\s+(?:da|dan|entrega|entregan|consigue|conseguimos|gestiona|gestionamos)\b[^.!?\n]{0,20}\b(?:licencia|matricula)\b/u,
  /\b(?:licencia|matricula)\s+(?:incluid[oa]|estatal\s+incluid[oa]|ya\s+viene)/u,
  /\b(?:podes|puedes|podras|vas\s+a\s+poder|quedas\s+habilitad[oa]|estaras\s+habilitad[oa])\b[^.!?\n]{0,30}\b(?:ejercer|trabajar|practicar|operar)\b[^.!?\n]{0,30}\b(?:legal\w*|oficialmente|con\s+licencia|sin\s+licencia|en\s+(?:eeuu|ee\s*uu|usa|estados\s+unidos))/u,
];
/** Denying that a license is needed is the same false claim. */
const LICENSE_NOT_NEEDED = /\bno\s+(?:necesit\w+|hace\s+falta|requier\w+|pide\w*|exige\w*|precisas?)\s+(?:de\s+)?(?:la\s+|una\s+|ninguna\s+|tener\s+)?(?:licencia|matricula)/u;

const SCARCITY = [
  /\b(?:cupos?|lugares|vacantes|plazas)\s+(?:limitad[oa]s?|restantes|reducid[oa]s?|agotandose)\b/u,
  /\b(?:ultim[oa]s?)\s+(?:cupos?|lugares|vacantes|plazas|unidades)\b/u,
  /\bquedan\s+(?:solo\s+|apenas\s+|pocos\s+|\d+\s+)?(?:cupos?|lugares|vacantes|plazas)\b/u,
  /\bsolo\s+(?:quedan|hay)\s+\d+\b/u,
  /\b(?:cupos?|vacantes)\s+(?:disponibles|aseguradas?)\s+(?:son|hasta|para)\s+\d+/u,
];

const DISCOUNT = [
  /\b(?:hago|hacemos|damos|doy|ofrezco|ofrecemos|aplico|aplicamos|consigo|conseguimos|tenemos|tengo|hay|incluye|incluimos|con|tu|un|el)\s+(?:un\s+|el\s+|unos\s+|otro\s+|algun\s+)?(?:descuentos?|rebajas?)\s+(?:especial|exclusivo|del|de\s+\d|por|para|si|de\s+hasta)/u,
  /\b(?:te\s+)?(?:hago|hacemos|damos|doy|ofrezco|ofrecemos|aplico|aplicamos)\s+(?:un\s+|el\s+|unos\s+)?(?:descuentos?|rebajas?)\b/u,
  /\b\d{1,3}\s*%\s*(?:de\s+)?(?:descuento|off|menos|de\s+ahorro|dto)/u,
];

const WEEKDAY = '(?:lunes|martes|miercoles|jueves|viernes|sabado|domingo)';
const DEADLINE_SUBJECT = /\b(?:oferta|promo|promocion|precio|inscripcion(?:es)?|matricula|vigente|valido|disponible|cierra|cierre|beneficio|bonificacion)\b/u;
const DEADLINE_TERMS = [
  /\b(?:por\s+)?tiempo\s+limitado\b/u,
  /\b(?:ultimos?\s+dias|ultima\s+oportunidad|solo\s+por\s+hoy|solo\s+hoy|termina\s+(?:hoy|manana|este|esta|el\s)|vence\s+(?:hoy|manana|este|esta|el\s))/u,
];
const DEADLINE_DATE = new RegExp(
  `\\b(?:hasta|antes\\s+d(?:el|e)|solo\\s+hasta|vence|cierra|cierre)\\s+(?:el\\s+)?(?:\\d{1,2}\\s+de\\s+[a-z]+|\\d{1,2}/\\d{1,2}|${WEEKDAY}|fin\\s+de\\s+(?:mes|semana|ano)|fin\\s+del\\s+(?:mes|ano))`,
  'u',
);

// Only the manual's real stories may be told (AGENTS.md, Material de Gabi): a generic
// "tenemos egresadas que..." is an invented testimonial unless the sentence names one of them.
const GRADUATE = '(?:egresad[oa]s?|alumn[oa]s?|estudiantes|graduad[oa]s?|exalumn[oa]s?)';
const TESTIMONIAL = [
  new RegExp(`\\b(?:tenemos|tengo|hay|contamos\\s+con|conozco)\\s+(?:muchos?\\s+|muchas\\s+|varios?\\s+|varias\\s+|algunos?\\s+|algunas\\s+|miles\\s+de\\s+|cientos\\s+de\\s+)?${GRADUATE}\\s+que\\b`, 'u'),
  new RegExp(`\\b(?:muchos?|muchas|varios|varias|miles\\s+de|cientos\\s+de)\\s+(?:de\\s+nuestr[oa]s\\s+)?${GRADUATE}\\b`, 'u'),
  new RegExp(`\\bnuestr[oa]s\\s+${GRADUATE}\\s+(?:ya\\s+|hoy\\s+)?(?:viven|cobran|trabajan|ganan|facturan|abrieron|consiguieron|montaron)\\b`, 'u'),
  new RegExp(`\\b(?:el|la)\\s+mas\\s+cercan[oa]\\s+es\\s+(?:el|la)\\s+de\\s+(?:otros?\\s+|otras?\\s+)?${GRADUATE}\\s+que\\b`, 'u'),
];
const REAL_STORY = /\b(?:felipe\s+serrano|cristian\s+y\s+ana\s+maria|amparo\s+y\s+edson)\b/u;

const FORBIDDEN_PRICE = /(?:^|[^\d])699(?!\d)/u;
const SCHOLARSHIP = /\bbec(?:a|as|ado|ados|ada|adas)\b/u;

/** Kinds asserted by one sentence. Order is stable. */
export interface HardClaimContextV1 {
  readonly tradeText?: string;
  /** Real, persisted promotion expiry. A deadline claim matching it is authorized. */
  readonly promoExpiresAt?: string | null;
}

export function hardClaimKindsInSentenceV1(sentence: string, context?: HardClaimContextV1): HardClaimKindV1[] {
  const text = fold(stripUrlsV1(sentence)).replace(/\s+/gu, ' ');
  const expiry = authorizedExpiryDates(context?.promoExpiresAt);
  const kinds: HardClaimKindV1[] = [];
  const add = (kind: HardClaimKindV1) => { if (!kinds.includes(kind)) kinds.push(kind); };

  if (FORBIDDEN_PRICE.test(text)) add('forbidden_price');
  if (SCHOLARSHIP.test(text)) add('scholarship');
  if (OFFICIAL_TITLE.some((pattern) => hasAffirmed(text, pattern))) add('official_title');
  if (EMPLOYMENT.some((pattern) => hasAffirmed(text, pattern))) add('guaranteed_employment');
  if (INCOME.some((pattern) => hasAffirmed(text, pattern))) add('income_promise');

  const tradeScope = fold(context?.tradeText ?? sentence);
  if (TRADE.test(tradeScope) || TRADE.test(text)) {
    if (LICENSE_GRANT.some((pattern) => hasAffirmed(text, pattern)) || LICENSE_NOT_NEEDED.test(text)) {
      add('license_claim');
    }
  }
  if (!REAL_STORY.test(text) && TESTIMONIAL.some((pattern) => hasAffirmed(text, pattern))) add('invented_testimonial');
  if (SCARCITY.some((pattern) => hasAffirmed(text, pattern))) add('invented_scarcity');
  if (DISCOUNT.some((pattern) => hasAffirmed(text, pattern))) add('invented_discount');
  // With a real expiry, "tiempo limitado" and a date equal to it are true; any other deadline stays invented.
  const mentionedDates = [...text.matchAll(/\b(\d{1,2})\s+de\s+([a-z]+)\b|\b(\d{1,2})\/(\d{1,2})\b/gu)]
    .map((m) => (m[1] ? `${Number(m[1])} de ${m[2]}` : `${Number(m[3])}/${Number(m[4])}`));
  const datesAuthorized = mentionedDates.length > 0 && mentionedDates.every((date) => expiry.has(date));
  const [limitedTime, otherTerms] = DEADLINE_TERMS;
  if ((hasAffirmed(text, limitedTime!) && expiry.size === 0)
    || (hasAffirmed(text, otherTerms!) && !datesAuthorized)
    || (DEADLINE_SUBJECT.test(text) && hasAffirmed(text, DEADLINE_DATE) && !datesAuthorized)) add('invented_deadline');
  return kinds;
}

/** Sentences are cut after . ! ? or a newline; decimals such as 30.5 stay whole.
 * A period followed by a lowercase word or by another short capital
 * abbreviation («EE. UU.») does not end the sentence (golden case47 g03). */
export function splitClaimSentencesV1(message: string): string[] {
  const parts: string[] = [];
  let start = 0;
  for (const boundary of message.matchAll(/(?<=[.!?\n])(?=\s|$)/gu)) {
    const index = boundary.index;
    if (message[index - 1] === '.' && /^\s+(?:\p{Ll}|\p{Lu}{1,2}\.)/u.test(message.slice(index))) continue;
    parts.push(message.slice(start, index));
    start = index;
  }
  parts.push(message.slice(start));
  return parts.filter((part) => part.trim().length > 0);
}

/** Every offending sentence of one bubble. `tradeText` widens trade detection to the whole bubble. */
export function hardClaimsInTextV1(message: string, context?: Pick<HardClaimContextV1, 'promoExpiresAt'>): HardClaimV1[] {
  return splitClaimSentencesV1(message).flatMap((sentence) => (
    hardClaimKindsInSentenceV1(sentence, { tradeText: message, promoExpiresAt: context?.promoExpiresAt }).map((kind) => ({ kind, sentence: sentence.trim() }))
  ));
}

export function hardClaimKindsInTextV1(message: string, context?: Pick<HardClaimContextV1, 'promoExpiresAt'>): HardClaimKindV1[] {
  return [...new Set(hardClaimsInTextV1(message, context).map((claim) => claim.kind))];
}
