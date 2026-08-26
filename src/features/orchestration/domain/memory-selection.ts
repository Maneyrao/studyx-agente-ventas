import { createHash } from 'node:crypto';

/**
 * Structural admission control for long-term memory.
 *
 * The model proposes; this module decides. Everything here is a *structural*
 * check — it can be evaluated against the batch the customer actually wrote,
 * without trusting a single word of the model's own reasoning. That is the
 * point: a memory is the one artefact that outlives the turn, so a hallucinated
 * one poisons every future conversation with that contact.
 *
 * Dependency-free on purpose (only `node:crypto`, a platform primitive). No
 * Next, no Botpress, no Supabase, no Zod — so the rules can be exercised
 * directly and reused from any adapter.
 *
 * The order of the checks is part of the contract: cheap shape rules first,
 * then content prohibitions, then the two grounding rules that need the batch.
 * A candidate is rejected with the FIRST reason that applies, so the stored
 * rejection reason is stable and comparable across runs.
 */

export const ALLOWED_MEMORY_TYPES = [
  'study_goal',
  'study_context',
  'preference',
  'constraint',
  'objection',
  'timeline',
  'contact_preference',
] as const;

export type MemoryType = (typeof ALLOWED_MEMORY_TYPES)[number];

/**
 * Facts the backend owns and the model may never pin down as a memory. A
 * remembered "price" would survive a catalog change and be quoted back as
 * truth, which is exactly the failure mode `.claude/rules/payments.md` forbids.
 */
const RESERVED_KEYS = new Set([
  'precio',
  'price',
  'importe',
  'arancel',
  'costo',
  'descuento',
  'discount',
  'pago',
  'payment',
  'cobro',
  'factura',
  'cupo',
  'disponibilidad',
  'availability',
  'stock',
  'inscripcion',
  'matricula',
  'enrollment',
  'beca',
  // Curso y plan no son preferencias semánticas: el agregado Sales es su
  // única fuente de verdad. Guardarlos aquí permite que un vector viejo
  // sobreviva a un cambio explícito de oferta o de plan.
  'curso',
  'course',
  'course_of_interest',
  'target_course',
  'offering',
  'offering_code',
  'selected_offering_code',
  'plan',
  'plan_code',
  'payment_plan',
  'selected_payment_plan',
  'consentimiento',
  'consent',
  'opt_out',
  'nombre',
  'name',
  'nombre_completo',
  'apellido',
  'email',
  'correo',
  'correo_electronico',
  'telefono',
  'phone',
  'phone_e164',
  'celular',
  'codigo_postal',
  'postal_code',
  'zip',
  'zip_code',
]);

/**
 * How long a memory of each type stays authoritative. `null` means it holds
 * until something supersedes it. Anything anchored to a moment in the
 * customer's calendar has to rot on its own, or "quiere rendir en marzo" is
 * still being recalled the following December.
 */
const MEMORY_TTL_DAYS: Record<MemoryType, number | null> = {
  study_goal: 365,
  study_context: null,
  preference: null,
  constraint: 180,
  objection: 180,
  timeline: 120,
  contact_preference: null,
};

export const DEFAULT_MIN_MEMORY_CONFIDENCE = 0.7;
export const MAX_MEMORY_VALUE_LENGTH = 512;
export const MAX_MEMORY_QUOTE_LENGTH = 2048;

const KEY_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

/**
 * Text that tries to steer the agent rather than describe the customer. A
 * memory is replayed into a future prompt, so an imperative stored today is a
 * delayed prompt injection.
 */
const INSTRUCTION_PATTERNS: RegExp[] = [
  /\bignor(a|ar|as|en|e)\b/,
  /\bignore\b/,
  /\bdisregard\b/,
  /\bolvid(a|ate|ar|en)\b/,
  /\bforget\b/,
  /\boverride\b/,
  /\bjailbreak\b/,
  /\b(system|sistema)\s+prompt\b/,
  /\bprompt\s+del\s+sistema\b/,
  /\b(nuevas|new)\s+(instrucciones|instructions)\b/,
  /\btus\s+(reglas|instrucciones)\b/,
  /\byour\s+(rules|instructions)\b/,
  /\bact(ua|úa)?\s+como\b/,
  /\bact\s+as\b/,
  /\bpretend\b/,
  /\bsin\s+restricciones\b/,
  /\bresponde\s+siempre\b/,
  /\bno\s+menciones\b/,
];

/**
 * Categories that must never reach a durable store: payment instruments,
 * government identifiers, credentials, and special-category personal data.
 * These are matched on the raw candidate AND on its quote — a clean value
 * extracted from a dirty quote still forces us to keep the dirty quote.
 */
const SENSITIVE_PATTERNS: RegExp[] = [
  // 13-22 consecutive digits once separators are removed: cards, CBU, IBAN.
  /\d{13,}/,
  /\b(tarjeta|card|visa|mastercard|amex)\b[^0-9]{0,20}\d{4}/,
  /\b(cbu|cvu|iban|swift)\b/,
  /\b(dni|documento|cuil|cuit|pasaporte|passport|ssn|nif)\b[^0-9]{0,20}\d{6,}/,
  /\b(contrasena|password|clave|passwd|pin|cvv|token|otp)\b/,
  /\bdiagnostic\w*\b/,
  /\b(enfermedad|epilepsia|diabetes|cancer|hiv|vih|sida|embarazo|discapacidad|psiquiatric\w*|depresion)\b/,
  /\b(religion|religios\w*|orientacion\s+sexual|partido\s+politico|sindicato|etnia)\b/,
];

/**
 * Facts whose source of truth is either contact identity/consent or the
 * commercial backend. Unlike `RESERVED_KEYS`, these catch a model that tries
 * to hide the same fact behind a harmless-looking arbitrary key.
 */
const RESERVED_CONTENT_PATTERNS: RegExp[] = [
  /\b[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+\b/,
  /\b(?:telefono|celular|whatsapp|numero|llamame|contactame|contacto)\b[^0-9]{0,24}\+?\d[\d\s().-]{6,}\d\b/,
  /\+\d(?:[\s().-]*\d){6,14}\b/,
  /\b(?:codigo postal|postal|zip|c\.?p\.?)\b(?:\s+(?:es|:))?\s*(?:[a-z]\d{4}[a-z]{0,3}|\d{4,8})\b/,
  /\b[a-z]\d{4}[a-z]{3}\b/,
  /\b(?:mi nombre es|me llamo|nombre completo:?)\s+[a-z]+(?:\s+[a-z]+){0,3}\b/,
  /\b(?:precio|price|arancel|costo|gratis|sin cargo)\b/,
  /\b(?:cuesta|sale|son|es)\s+(?:\$?\d+(?:[.\s]\d{3})*(?:,\d+)?\s*(?:pesos?|ars|usd|dolares?)|gratis|sin cargo)\b/,
  /\b(?:pago|payment|pag[ao]|abone(?:\s+la\s+inscripcion)?|tarjeta|transferencia|cuotas?)\b/,
  /\b(?:cupo(?:s)?|vacante(?:s)?|stock)\b/,
  /\b(?:hay|quedan)\s+(?:un(?:a)?|dos|tres|\d+)\s+(?:cupos?|lugares|vacantes)\b/,
  /\bhay disponibilidad\s+(?:para|del|de)\s+(?:el\s+)?curso\b/,
  /\b(?:consent(?:imiento)?|autoriz(?:o|acion)|acepto\s+(?:(?:los\s+)?terminos|que\s+me contacten)|doy permiso\s+para\s+que\s+me contacten)\b/,
];

/** Identity stated as a capitalized name needs the original quote's casing. */
const RAW_RESERVED_CONTENT_PATTERNS: RegExp[] = [
  /\bSoy\s+\p{Lu}[\p{L}'-]+(?:\s+\p{Lu}[\p{L}'-]+)+\b/u,
];

const STOPWORDS = new Set([
  'que', 'los', 'las', 'del', 'por', 'para', 'con', 'una', 'unos', 'unas', 'sus',
  'como', 'mas', 'pero', 'este', 'esta', 'esto', 'ese', 'esa', 'the', 'and', 'for',
  'quiero', 'necesito', 'tengo', 'soy', 'estoy', 'mi', 'me', 'yo',
]);

export interface MemoryCandidateInput {
  readonly type: string;
  readonly key: string;
  readonly value: string;
  readonly source_quote: string;
  readonly confidence: number;
}

export interface MemorySelectionContext {
  readonly contact_id: string;
  /** The batch the customer actually wrote. The only admissible citation source. */
  readonly batch_messages: ReadonlyArray<{ id: string; content: string }>;
  readonly min_confidence?: number;
}

export type MemoryRejectionReason =
  | 'TYPE_NOT_ALLOWED'
  | 'INVALID_KEY'
  | 'RESERVED_KEY'
  | 'LOW_CONFIDENCE'
  | 'EMPTY_VALUE'
  | 'VALUE_TOO_LONG'
  | 'QUOTE_TOO_LONG'
  | 'INSTRUCTION_LIKE'
  | 'SENSITIVE_DATA'
  | 'QUOTE_NOT_FOUND'
  | 'VALUE_NOT_GROUNDED';

export interface NormalizedMemory {
  readonly type: MemoryType;
  readonly key: string;
  /** Normalized, storable text. This is what future prompts will read. */
  readonly value: string;
  /** The quote exactly as the customer wrote it, taken from the source message. */
  readonly source_quote: string;
  readonly source_message_id: string;
  readonly confidence: number;
  readonly dedupe_hash: string;
  /** null = holds until superseded. Otherwise the store stamps now() + ttl. */
  readonly ttl_days: number | null;
}

export type MemoryEvaluation =
  | { readonly status: 'accepted'; readonly memory: NormalizedMemory }
  | { readonly status: 'rejected'; readonly reason: MemoryRejectionReason };

/**
 * Lowercase, strip diacritics, collapse whitespace. Deliberately keeps
 * punctuation: removing it here would let "no quiero" and "no, quiero" collapse
 * onto the same dedupe hash.
 */
export function normalizeMemoryText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function significantChars(value: string): string {
  return value.replace(/[^a-z0-9]/g, '');
}

function tokens(value: string): string[] {
  return value.split(/[^a-z0-9]+/).filter((token) => token.length > 0);
}

export function memoryDedupeHash(input: {
  contact_id: string;
  type: string;
  key: string;
  value: string;
}): string {
  // Contact first and always: two contacts stating the same fact are two
  // memories, and no hash collision may ever merge them.
  const canonical = [
    input.contact_id,
    normalizeMemoryText(input.type),
    normalizeMemoryText(input.key),
    normalizeMemoryText(input.value),
  ].join(' ');
  return createHash('sha256').update(canonical).digest('hex');
}

function matchesAny(patterns: RegExp[], text: string): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

/** Digits split by spaces or dashes still form one identifier. */
function collapseDigitRuns(text: string): string {
  return text.replace(/(?<=\d)[\s.-]+(?=\d)/g, '');
}

/**
 * Is every meaningful piece of the value actually present in its own quote?
 *
 * This is the check that makes "the agent did not invent the datum" a
 * structural property rather than a hope. A paraphrase that only reorders or
 * drops words passes; one that introduces a number, a name or a noun the
 * customer never wrote does not.
 */
function isGroundedInQuote(value: string, quote: string): boolean {
  if (quote.includes(value)) return true;
  const quoteTokens = new Set(tokens(quote));
  return tokens(value).every((token) => {
    if (quoteTokens.has(token)) return true;
    // Numbers are never allowed to appear from nowhere.
    if (/^\d+$/.test(token)) return false;
    if (token.length < 3 || STOPWORDS.has(token)) return true;
    return false;
  });
}

export function evaluateMemoryCandidate(
  candidate: MemoryCandidateInput,
  context: MemorySelectionContext
): MemoryEvaluation {
  const reject = (reason: MemoryRejectionReason): MemoryEvaluation => ({
    status: 'rejected',
    reason,
  });

  const type = normalizeMemoryText(candidate.type);
  if (!(ALLOWED_MEMORY_TYPES as readonly string[]).includes(type)) {
    return reject('TYPE_NOT_ALLOWED');
  }

  const key = normalizeMemoryText(candidate.key);
  if (!KEY_PATTERN.test(key)) return reject('INVALID_KEY');
  if (RESERVED_KEYS.has(key)) return reject('RESERVED_KEY');

  const minConfidence = context.min_confidence ?? DEFAULT_MIN_MEMORY_CONFIDENCE;
  if (
    !Number.isFinite(candidate.confidence)
    || candidate.confidence < minConfidence
    || candidate.confidence > 1
  ) {
    return reject('LOW_CONFIDENCE');
  }

  const value = normalizeMemoryText(candidate.value);
  if (significantChars(value).length === 0) return reject('EMPTY_VALUE');
  if (candidate.value.length > MAX_MEMORY_VALUE_LENGTH) return reject('VALUE_TOO_LONG');
  if (candidate.source_quote.length > MAX_MEMORY_QUOTE_LENGTH) return reject('QUOTE_TOO_LONG');

  const quote = normalizeMemoryText(candidate.source_quote);
  const inspected = `${value} ${quote}`;
  if (matchesAny(INSTRUCTION_PATTERNS, inspected)) return reject('INSTRUCTION_LIKE');
  if (matchesAny(SENSITIVE_PATTERNS, collapseDigitRuns(inspected))) return reject('SENSITIVE_DATA');
  if (matchesAny(RESERVED_CONTENT_PATTERNS, inspected)) return reject('RESERVED_KEY');
  if (matchesAny(RAW_RESERVED_CONTENT_PATTERNS, `${candidate.value} ${candidate.source_quote}`)) {
    return reject('RESERVED_KEY');
  }

  // The citation must exist in a message of THIS batch, which the store built
  // from this contact's own conversation. A quote lifted from another contact
  // therefore cannot resolve. It is a literal citation, not a normalized
  // paraphrase the model may have reconstructed.
  const literalQuote = candidate.source_quote.trim();
  const source = context.batch_messages.find((message) => message.content.includes(literalQuote));
  if (!source || significantChars(quote).length === 0) return reject('QUOTE_NOT_FOUND');

  if (!isGroundedInQuote(value, quote)) return reject('VALUE_NOT_GROUNDED');

  return {
    status: 'accepted',
    memory: {
      type: type as MemoryType,
      key,
      value,
      source_quote: candidate.source_quote.trim(),
      source_message_id: source.id,
      confidence: candidate.confidence,
      dedupe_hash: memoryDedupeHash({ contact_id: context.contact_id, type, key, value }),
      ttl_days: MEMORY_TTL_DAYS[type as MemoryType],
    },
  };
}

/**
 * The structured facts a memory is not allowed to argue with.
 *
 * Priority order in this system is fixed: structured data > recent messages >
 * summary > retrieved memory. A remembered claim that contradicts a column is
 * therefore already losing at read time — the point of rejecting it at write
 * time is to keep the contradiction from ever being retrievable.
 */
export interface StructuredMemoryFacts {
  readonly contact_name: string | null;
  readonly contact_status: 'prospecto' | 'cliente' | 'inactivo';
  readonly consent_status: 'unknown' | 'granted' | 'revoked';
}

const NAME_KEYS = new Set(['nombre', 'name', 'nombre_completo', 'apellido']);

const OPT_OUT_PATTERNS: RegExp[] = [
  /\bno me (escrib|contact|manden|mandes|molest)/,
  /\bdejen? de (escribirme|contactarme|molestarme)\b/,
  /\bdar(me)? de baja\b/,
  /\bno quiero recibir\b/,
  /\bunsubscribe\b/,
];

const CUSTOMER_CLAIM_PATTERNS: RegExp[] = [
  /\bya soy (cliente|alumn[oa])\b/,
  /\bya estoy inscript[oa]\b/,
  /\bya pague\b/,
];

/**
 * Returns the qualified column a candidate contradicts, or null.
 *
 * Consent is the subtle one: "no me escribas" IS a real signal, but it belongs
 * to the opt-out path that revokes consent at ingest — not to memory. Letting
 * it in as a `contact_preference` would create a second, unversioned place
 * where consent appears to live.
 */
export function detectStructuredContradiction(
  memory: Pick<NormalizedMemory, 'key' | 'value'>,
  facts: StructuredMemoryFacts
): string | null {
  if (NAME_KEYS.has(memory.key) && facts.contact_name) {
    const structured = normalizeMemoryText(facts.contact_name);
    if (structured.length > 0 && !memory.value.includes(structured)) return 'contacts.name';
  }

  if (facts.consent_status !== 'revoked' && matchesAny(OPT_OUT_PATTERNS, memory.value)) {
    return 'contact_channel_permissions.consent_status';
  }

  if (facts.contact_status !== 'cliente' && matchesAny(CUSTOMER_CLAIM_PATTERNS, memory.value)) {
    return 'contacts.status';
  }

  return null;
}
