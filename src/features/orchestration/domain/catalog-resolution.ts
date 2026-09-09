import type { BusinessOfferingView } from './business-context';

export type CatalogSnapshotOffering = Pick<
  BusinessOfferingView,
  'code' | 'display_name' | 'academy'
> & {
  /** Owner-authored aliases only; the resolver never derives new aliases. */
  readonly aliases?: readonly string[];
};

export interface CatalogResolutionSnapshot {
  readonly offerings: readonly CatalogSnapshotOffering[];
  readonly offerings_truncated: number;
}

interface CanonicalCatalogOffering {
  readonly sku: string;
  readonly name: string;
  readonly academy: string | null;
}

export type CatalogMatchMethod = 'canonical' | 'unique_typo';

export type CatalogResolution =
  | { readonly kind: 'no_catalog_intent' }
  | {
      readonly kind: 'exact';
      readonly offeringCode: string;
      readonly displayName: string;
      readonly academy: string | null;
      readonly match: CatalogMatchMethod;
    }
  | {
      readonly kind: 'ambiguous';
      readonly requestedText: string;
      readonly candidateCodes: readonly string[];
      readonly clarification: 'choose_offering' | 'choose_area';
    }
  | {
      readonly kind: 'not_found';
      readonly requestedText: string;
      readonly requestedArea: string | null;
      readonly alternativeCodes: readonly string[];
    }
  | {
      readonly kind: 'unavailable';
      readonly reason: 'snapshot_missing' | 'snapshot_truncated' | 'snapshot_invalid';
    };

interface IndexedOffering {
  readonly source: CatalogSnapshotOffering;
  readonly candidate: CanonicalCatalogOffering;
  readonly normalizedName: string;
  readonly normalizedCode: string;
  readonly normalizedAliases: readonly string[];
}

type LiteralMatchMethod = 'canonical_name' | 'canonical_sku' | 'alias';

interface LiteralHit {
  readonly messageIndex: number;
  readonly start: number;
  readonly end: number;
  readonly offering: IndexedOffering;
  readonly method: LiteralMatchMethod;
}

interface OfferingMatch {
  readonly offering: IndexedOffering;
  readonly method: LiteralMatchMethod;
}

const METHOD_PRIORITY: Readonly<Record<LiteralMatchMethod, number>> = {
  canonical_name: 3,
  canonical_sku: 2,
  alias: 1,
};

const CATALOG_INTENT_PATTERN =
  /(?:\b(?:cursos|diplomados|capacitaciones|formaciones|programas|catalogo|oferta academica|academia|inscribirme|inscribime|anotarme|anotame)\b|\bestudiar\b(?!\s+para\b)|\b(?:curso|diplomado|capacitacion|formacion|programa)\s+de\s+[\p{L}\p{N}]|\b(?:tienen|ofrecen|hay)\b.{0,24}\b(?:curso|diplomado|capacitacion|formacion|programa)\b)/u;

const SELECTION_CUE_PATTERN =
  /\b(?:prefiero|elijo|elegi|selecciono|me quedo con|voy con|quiero|mejor|cambio a)\b/gu;

const BARE_COURSE_SELECTION_PATTERN =
  // Clitic forms (pagarlo, abonarla…) must stay payment cues, not course
  // selections: "quiero pagarlo en 12 cuotas" cannot reset the remembered
  // course. Mirrored in botpress-agent/src/utils/commercial-router.ts.
  /\b(?:quiero|prefiero|elijo|elegi|selecciono|me quedo con|voy con|cambio a)\s+(?!(?:que|para|aprender|estudiar|pagar(?:l[oa]s?)?|abonar(?:l[oa]s?)?|comprar(?:l[oa]s?)?|hablar|llamar|una llamada|un llamado|saber|consultar|confirmar|verificar|revisar|continuar|seguir|el plan|un plan|plan|cuotas?|por chat|mas informacion|informacion|info|es[ae]|est[ae]|aquel(?:la)?|(?:(?:el|la|un|una)\s+)?(?:opcion|alternativa))\b)(?:el|la|un|una)?\s*[\p{L}][\p{L}\p{N}]*(?:\s+[\p{L}\p{N}]+){0,4}\b/u;

const CATALOG_REJECTION_PATTERN =
  /\b(?:no quiero|no me interesa|no prefiero|no elijo|ya no quiero|descarto|cancelo|no mejor no|mejor no|dejalo|dejala|ninguno|ninguna|cambi(?:o|emos|ar) de (?:curso|programa))\b/u;

const CATALOG_REPLACEMENT_AFTER_REJECTION_PATTERN =
  /\b(?:ninguno|ninguna)\b\s+(?:mejor\s+)?(?:el|la|uno|una)\s+de\s+([\p{L}\p{N}].*)$/u;

const NEUTRAL_CATALOG_TRAILING_FRAGMENT_PATTERN =
  /^(?:(?:muchas\s+)?gracias(?:\s+(?:igual|por\s+(?:la\s+)?(?:info|informacion|ayuda)))?|dale|ok|okay|perfecto|listo)$/u;

const PAYMENT_OR_LINK_CONTEXT_PATTERN =
  /\b(?:pag(?:o|ar|arlo|arla|arlos|arlas)?|cuotas?|dolares?|usd|link|plan(?:es)?|mensual(?:es)?|mes(?:es)?|pensar(?:lo|la)?|decidir)\b/u;

const EXPLICIT_COURSE_NOUN_PATTERN =
  /\b(?:curso|diplomado|capacitacion|formacion|programa)\b/u;

const NON_CATALOG_PROGRAM_CONTEXT_PATTERN =
  /(?:\b(?:sin (?:haber )?(?:usado|usar)|nunca (?:haber )?(?:usado|usar|use))\b.{0,48}\bprograma de\b|\b(?:necesito|hace falta)\b.{0,24}\b(?:instalar|usar|tener instalado)\b.{0,24}\bprograma de\b)/u;

const EXPLICIT_PROGRAM_INFORMATION_REQUEST_PATTERN =
  /\b(?:necesito|quiero|busco|solicito)\b.{0,24}\b(?:informacion|info|datos|detalles)\b.{0,24}\b(?:del?|sobre(?: el)?)\s+programa de\b/u;

// A person can write a malformed lead-in ("qiero info d") while still
// naming a recognizable course family.  Information language plus a complete
// canonical family token is enough to ask a safe clarification; the token by
// itself is not, so ordinary sentences such as "me gusta fotografía" remain
// outside the commercial catalog flow.
const INFORMATION_REQUEST_CUE_PATTERN =
  /\b(?:info(?:rmacion)?|detalle(?:s)?|datos|quiero saber|contame)\b/u;

// A short availability question is also a clear catalog request even when it
// omits the word "curso" ("tenés algo de fotografía?"). We only use its
// captured subject as a typo-tolerant *family* match, never as an exact SKU.
const INFORMAL_AVAILABILITY_FAMILY_REQUEST_PATTERN =
  /\b(?:ten(?:e|é)s|tienen|ofrecen|hay)\b.{0,16}\b(?:algo|opcion|opciones)\b\s+(?:d|de|sobre)\s+([\p{L}\p{N}]{4,})/u;

// A customer often omits "curso" in a short availability question ("¿Tienen
// Astronomía?").  The grammar is deliberately narrow: routine questions such
// as "¿Tienen horarios los sábados?" contain additional terms and remain
// neutral rather than becoming a false catalog absence.
const BARE_AVAILABILITY_SUBJECT_REQUEST_PATTERN =
  /^(?:tienen|ofrecen|hay)\s+(?:un|una)?\s*[\p{L}\p{N}][\p{L}\p{N}-]{2,}$/u;

const HEDGED_FAMILY_FRAGMENT_PATTERN =
  /^([\p{L}\p{N}]{4,})\s+(?:creo|quizas|capaz)$/u;

const REPAIR_SUBJECT_PATTERN = /\breparacion\b/u;
const COMPUTER_SUBJECT_PATTERN =
  /\b(?:pc|computadora(?:s)?|compu(?:tadora)?s?|informatica(?:s)?)\b/u;

const NEGATED_OFFERING_PREFIX_PATTERN =
  /(?:^|\s)(?:no quiero|no me interesa|no prefiero|no elijo|ya no quiero|descarto|cancelo)(?:\s+(?:hacer|estudiar|aprender|el|la|un|una|curso|programa|de)){0,4}\s*$/u;

function normalizeSpanishCatalogText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/gu, ' ');
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function compareOfferings(left: IndexedOffering, right: IndexedOffering): number {
  return (
    compareText(left.normalizedName, right.normalizedName)
    || compareText(left.normalizedCode, right.normalizedCode)
  );
}

function toMessages(text: string | readonly string[]): string[] {
  const values = typeof text === 'string' ? [text] : text;
  return values
    .map((value) => normalizeSpanishCatalogText(value))
    .filter((value) => value.length > 0);
}

function requestedText(text: string | readonly string[]): string {
  const values = typeof text === 'string' ? [text] : text;
  return values.map((value) => value.trim()).filter(Boolean).join('\n');
}

function explicitCatalogReplacementSubject(text: string | readonly string[]): string | null {
  const values = typeof text === 'string' ? [text] : text;
  const directives = values.flatMap((value) => value.split(/[.!?;\n]/u))
    .map((value) => normalizeSpanishCatalogText(value))
    .filter(Boolean);
  const latest = directives.findLast((directive) => (
    !NEUTRAL_CATALOG_TRAILING_FRAGMENT_PATTERN.test(directive)
  ));
  if (!latest) return null;

  const subject = CATALOG_REPLACEMENT_AFTER_REJECTION_PATTERN.exec(latest)?.[1]?.trim() ?? null;
  if (!subject || /\bno\b/u.test(subject) || CATALOG_REJECTION_PATTERN.test(subject)) return null;
  return subject;
}

function snapshotIsInvalid(snapshot: CatalogResolutionSnapshot): boolean {
  if (
    !Array.isArray(snapshot.offerings)
    || snapshot.offerings.length === 0
    || !Number.isInteger(snapshot.offerings_truncated)
    || snapshot.offerings_truncated < 0
  ) {
    return true;
  }

  const codes = new Set<string>();
  const canonicalIdentities = new Set<string>();
  for (const offering of snapshot.offerings) {
    const normalizedCode = typeof offering?.code === 'string'
      ? normalizeSpanishCatalogText(offering.code)
      : '';
    const normalizedName = typeof offering?.display_name === 'string'
      ? normalizeSpanishCatalogText(offering.display_name)
      : '';
    if (
      offering === null
      || typeof offering !== 'object'
      || typeof offering.code !== 'string'
      || normalizedCode.length === 0
      || typeof offering.display_name !== 'string'
      || normalizedName.length === 0
      || (offering.academy !== null && typeof offering.academy !== 'string')
      || (offering.aliases !== undefined && (
        !Array.isArray(offering.aliases)
        || offering.aliases.some((alias: unknown) => typeof alias !== 'string')
      ))
      || codes.has(normalizedCode)
    ) {
      return true;
    }
    codes.add(normalizedCode);
    canonicalIdentities.add(normalizedCode);
    canonicalIdentities.add(normalizedName);
  }

  for (const offering of snapshot.offerings) {
    const aliases: readonly string[] = offering.aliases ?? [];
    const normalizedAliases = aliases.map((alias) => normalizeSpanishCatalogText(alias));
    if (
      normalizedAliases.some((alias) => alias.length === 0 || canonicalIdentities.has(alias))
      || new Set(normalizedAliases).size !== normalizedAliases.length
    ) {
      return true;
    }
  }
  return false;
}

function indexOfferings(snapshot: CatalogResolutionSnapshot): IndexedOffering[] {
  const indexed: IndexedOffering[] = [];
  for (const source of snapshot.offerings) {
    const normalizedName = normalizeSpanishCatalogText(source.display_name);
    const normalizedCode = normalizeSpanishCatalogText(source.code);
    if (normalizedName.length === 0 || normalizedCode.length === 0) continue;

    const normalizedAliases = [...new Set(
      (source.aliases ?? [])
        .map((alias) => normalizeSpanishCatalogText(alias))
        .filter((alias) => (
          alias.length > 0
          && alias !== normalizedName
          && alias !== normalizedCode
        )),
    )];

    indexed.push({
      source,
      candidate: {
        sku: source.code,
        name: source.display_name,
        academy: source.academy,
      },
      normalizedName,
      normalizedCode,
      normalizedAliases,
    });
  }
  return indexed.sort(compareOfferings);
}

function termOccurrences(text: string, term: string): Array<{ start: number; end: number }> {
  const occurrences: Array<{ start: number; end: number }> = [];
  let from = 0;
  while (from <= text.length - term.length) {
    const start = text.indexOf(term, from);
    if (start < 0) break;
    const end = start + term.length;
    const startsAtBoundary = start === 0 || text[start - 1] === ' ';
    const endsAtBoundary = end === text.length || text[end] === ' ';
    if (startsAtBoundary && endsAtBoundary) occurrences.push({ start, end });
    from = start + 1;
  }
  return occurrences;
}

function addTermHits(
  hits: LiteralHit[],
  messages: readonly string[],
  offering: IndexedOffering,
  term: string,
  method: LiteralMatchMethod,
): void {
  for (let messageIndex = 0; messageIndex < messages.length; messageIndex += 1) {
    for (const occurrence of termOccurrences(messages[messageIndex], term)) {
      hits.push({ messageIndex, offering, method, ...occurrence });
    }
  }
}

function literalHits(
  messages: readonly string[],
  offerings: readonly IndexedOffering[],
): LiteralHit[] {
  const hits: LiteralHit[] = [];
  for (const offering of offerings) {
    addTermHits(hits, messages, offering, offering.normalizedName, 'canonical_name');
    if (offering.normalizedCode !== offering.normalizedName) {
      addTermHits(hits, messages, offering, offering.normalizedCode, 'canonical_sku');
    }
    for (const alias of offering.normalizedAliases) {
      addTermHits(hits, messages, offering, alias, 'alias');
    }
  }

  return hits.filter((hit) => !hits.some((other) => {
    if (other === hit || other.messageIndex !== hit.messageIndex) return false;
    if (other.offering.candidate.sku === hit.offering.candidate.sku) return false;
    const contains = other.start <= hit.start && other.end >= hit.end;
    if (!contains) return false;
    const otherLength = other.end - other.start;
    const hitLength = hit.end - hit.start;
    return otherLength > hitLength
      || (otherLength === hitLength && METHOD_PRIORITY[other.method] > METHOD_PRIORITY[hit.method]);
  }));
}

function positiveLiteralHits(
  messages: readonly string[],
  hits: readonly LiteralHit[],
): LiteralHit[] {
  return hits.filter((hit) => {
    const prefix = messages[hit.messageIndex].slice(0, hit.start);
    return !NEGATED_OFFERING_PREFIX_PATTERN.test(prefix);
  });
}

function latestMessageCancelsSelection(
  messages: readonly string[],
  positiveHits: readonly LiteralHit[],
): boolean {
  const latestIndex = messages.length - 1;
  if (latestIndex < 0 || !CATALOG_REJECTION_PATTERN.test(messages[latestIndex])) return false;
  return !positiveHits.some((hit) => hit.messageIndex === latestIndex);
}

function bestLiteralMethod(hits: readonly LiteralHit[]): LiteralMatchMethod {
  return hits.reduce<LiteralMatchMethod>((best, hit) => (
    METHOD_PRIORITY[hit.method] > METHOD_PRIORITY[best] ? hit.method : best
  ), hits[0].method);
}

function distinctLiteralMatches(hits: readonly LiteralHit[]): OfferingMatch[] {
  const bySku = new Map<string, LiteralHit[]>();
  for (const hit of hits) {
    const sku = hit.offering.candidate.sku;
    bySku.set(sku, [...(bySku.get(sku) ?? []), hit]);
  }
  return [...bySku.values()]
    .map((offeringHits) => ({
      offering: offeringHits[0].offering,
      method: bestLiteralMethod(offeringHits),
    }))
    .sort((left, right) => compareOfferings(left.offering, right.offering));
}

function explicitSelection(
  messages: readonly string[],
  hits: readonly LiteralHit[],
): OfferingMatch | null {
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const cues = [...messages[messageIndex].matchAll(SELECTION_CUE_PATTERN)];
    const cue = cues.at(-1);
    if (!cue || cue.index === undefined) continue;
    const cueEnd = cue.index + cue[0].length;
    const tailHits = hits.filter((hit) => (
      hit.messageIndex === messageIndex && hit.start >= cueEnd
    ));
    const matches = distinctLiteralMatches(tailHits);
    if (matches.length === 1) return matches[0];
  }
  return null;
}

function levenshteinDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
    }
    for (let index = 0; index < current.length; index += 1) previous[index] = current[index];
  }
  return previous[right.length];
}

function typoDistanceLimit(normalizedName: string): number {
  const characters = normalizedName.replace(/\s/gu, '').length;
  if (characters < 5) return 0;
  return Math.min(3, Math.max(1, Math.floor(characters * 0.15)));
}

function phraseWindows(message: string, targetTokenCount: number): string[] {
  const tokens = message.split(' ');
  const windows: string[] = [];
  for (
    let windowSize = Math.max(1, targetTokenCount - 1);
    windowSize <= Math.min(tokens.length, targetTokenCount + 1);
    windowSize += 1
  ) {
    for (let start = 0; start <= tokens.length - windowSize; start += 1) {
      windows.push(tokens.slice(start, start + windowSize).join(' '));
    }
  }
  return windows;
}

function typoMatches(
  messages: readonly string[],
  offerings: readonly IndexedOffering[],
): IndexedOffering[] {
  return offerings.filter((offering) => {
    const limit = typoDistanceLimit(offering.normalizedName);
    if (limit === 0) return false;
    const targetTokenCount = offering.normalizedName.split(' ').length;
    let best = Number.POSITIVE_INFINITY;
    for (const message of messages) {
      for (const phrase of phraseWindows(message, targetTokenCount)) {
        best = Math.min(best, levenshteinDistance(offering.normalizedName, phrase));
      }
    }
    return best > 0 && best <= limit;
  });
}

function partialSubjectMatches(
  text: string | readonly string[],
  offerings: readonly IndexedOffering[],
): IndexedOffering[] {
  const values = typeof text === 'string' ? [text] : text;
  const subjects = values.flatMap((value) => value.split(/[.!?;,\n]/u)).flatMap((clause) => {
    const normalized = normalizeSpanishCatalogText(clause);
    if (
      NON_CATALOG_PROGRAM_CONTEXT_PATTERN.test(normalized)
      && !EXPLICIT_PROGRAM_INFORMATION_REQUEST_PATTERN.test(normalized)
    ) return [];

    // Keep the whole requested subject, including its qualifiers. Searching
    // arbitrary words would turn "fotografía forense" into an available
    // course, or confuse "fot" with "fotovoltaica". A bare title fragment is
    // also a subject; surrounding unrelated prose is not stripped from it.
    const cues = [...normalized.matchAll(
      /\b(?:cursos?|diplomados?|capacitaciones|capacitacion|formaciones|formacion|programas?|estudiar|aprender|busco|quiero|me interesa|me interesan|informacion sobre)\s+(?:(?:el|la|un|una|de)\s+)*/gu,
    )];
    const cue = cues.at(-1);
    const subject = (cue?.index === undefined
      ? normalized
      : normalized.slice(cue.index + cue[0].length))
      .replace(/\s+(?:tienen|ofrecen|hay|esta disponible|estan disponibles)$/u, '')
      .trim();
    return subject ? [subject] : [];
  });

  return offerings.filter((offering) => subjects.some((subject) => (
    offering.normalizedName.startsWith(`${subject} `)
  )));
}

function computerRepairMatches(
  messages: readonly string[],
  offerings: readonly IndexedOffering[],
): IndexedOffering[] {
  const subject = messages.join(' ');
  if (!REPAIR_SUBJECT_PATTERN.test(subject) || !COMPUTER_SUBJECT_PATTERN.test(subject)) {
    return [];
  }
  return offerings.filter((offering) => {
    const identities = [
      offering.normalizedName,
      offering.normalizedCode,
      ...offering.normalizedAliases,
    ];
    return identities.some((identity) => (
      REPAIR_SUBJECT_PATTERN.test(identity) && /(?:^| )pc(?: |$)/u.test(identity)
    ));
  });
}

function informationalFamilyMatches(
  messages: readonly string[],
  offerings: readonly IndexedOffering[],
): IndexedOffering[] {
  if (!messages.some((message) => INFORMATION_REQUEST_CUE_PATTERN.test(message))) return [];
  const matched = new Map<string, IndexedOffering>();
  for (const offering of offerings) {
    const terms = [offering.normalizedName, ...offering.normalizedAliases]
      .map((value) => value.split(' ')[0] ?? '')
      .filter((value) => value.length >= 4);
    const matchesCompleteFamily = terms.some((term) => messages.some((message) => (
      termOccurrences(message, term).some((occurrence) => {
        // This is a family request, not a longer unknown course that merely
        // starts with the same word ("Marketing de Afiliados").
        return /^(?:\d+)?$/u.test(message.slice(occurrence.end).trim());
      })
    )));
    if (matchesCompleteFamily) {
      matched.set(offering.source.code, offering);
    }
  }
  return [...matched.values()].sort(compareOfferings);
}

function availabilityFamilyMatches(
  messages: readonly string[],
  offerings: readonly IndexedOffering[],
): IndexedOffering[] {
  const requestedFamilies = messages.flatMap((message) => {
    const matched = INFORMAL_AVAILABILITY_FAMILY_REQUEST_PATTERN.exec(message)?.[1];
    return matched ? [matched] : [];
  });
  if (requestedFamilies.length === 0) return [];

  const matched = new Map<string, IndexedOffering>();
  for (const offering of offerings) {
    const familyTerms = [offering.normalizedName, ...offering.normalizedAliases]
      .map((value) => value.split(' ')[0] ?? '')
      .filter((value) => value.length >= 5);
    if (familyTerms.some((term) => requestedFamilies.some((requested) => {
      const distance = levenshteinDistance(term, requested);
      return distance <= typoDistanceLimit(term);
    }))) {
      matched.set(offering.source.code, offering);
    }
  }
  return [...matched.values()].sort(compareOfferings);
}

function hedgedFamilyFragmentMatches(
  messages: readonly string[],
  offerings: readonly IndexedOffering[],
): IndexedOffering[] {
  const requestedFamilies = messages.flatMap((message) => {
    const matched = HEDGED_FAMILY_FRAGMENT_PATTERN.exec(message)?.[1];
    return matched ? [matched] : [];
  });
  if (requestedFamilies.length === 0) return [];
  return offerings.filter((offering) => (
    [offering.normalizedName, ...offering.normalizedAliases]
      .map((value) => value.split(' ')[0] ?? '')
      .filter((value) => value.length >= 5)
      .some((term) => requestedFamilies.some((requested) => (
        levenshteinDistance(term, requested) <= typoDistanceLimit(term)
      )))
  ));
}

function hasCatalogIntent(messages: readonly string[]): boolean {
  return messages.some((message) => (
    (
      CATALOG_INTENT_PATTERN.test(message)
      && (
        !NON_CATALOG_PROGRAM_CONTEXT_PATTERN.test(message)
        || EXPLICIT_PROGRAM_INFORMATION_REQUEST_PATTERN.test(message)
      )
    )
    || (
      BARE_COURSE_SELECTION_PATTERN.test(message)
      && !(
        PAYMENT_OR_LINK_CONTEXT_PATTERN.test(message)
        && !EXPLICIT_COURSE_NOUN_PATTERN.test(message)
      )
    )
    || INFORMAL_AVAILABILITY_FAMILY_REQUEST_PATTERN.test(message)
    || BARE_AVAILABILITY_SUBJECT_REQUEST_PATTERN.test(message)
  ));
}

/**
 * Historical course identity may be inherited only through a truly neutral
 * follow-up. A rejection/correction is deliberately not encoded as a new
 * positive catalog selection, but it must still form a boundary that prevents
 * an older course from being revived.
 */
export function isCatalogRequestNeutral(text: string | readonly string[]): boolean {
  const messages = toMessages(text);
  return !hasCatalogIntent(messages)
    && !messages.some((message) => CATALOG_REJECTION_PATTERN.test(message));
}

interface ExplicitAcademy {
  readonly normalized: string;
  readonly displayName: string;
}

function explicitAcademy(
  messages: readonly string[],
  offerings: readonly IndexedOffering[],
): ExplicitAcademy | null {
  const mentioned = new Map<string, string>();
  for (const offering of offerings) {
    if (offering.source.academy === null) continue;
    const normalizedAcademy = normalizeSpanishCatalogText(offering.source.academy);
    if (
      normalizedAcademy.length > 0
      && messages.some((message) => termOccurrences(message, normalizedAcademy).length > 0)
    ) {
      if (!mentioned.has(normalizedAcademy)) {
        mentioned.set(normalizedAcademy, offering.source.academy);
      }
    }
  }
  if (mentioned.size !== 1) return null;
  const [normalized, displayName] = [...mentioned.entries()][0];
  return { normalized, displayName };
}

function alternativeCodes(
  offerings: readonly IndexedOffering[],
  preferredAcademy: ExplicitAcademy | null,
): string[] {
  return offerings
    .slice()
    .sort((left, right) => {
      if (preferredAcademy !== null) {
        const leftPreferred = normalizeSpanishCatalogText(left.source.academy ?? '')
          === preferredAcademy.normalized;
        const rightPreferred = normalizeSpanishCatalogText(right.source.academy ?? '')
          === preferredAcademy.normalized;
        if (leftPreferred !== rightPreferred) return leftPreferred ? -1 : 1;
      }
      return compareOfferings(left, right);
    })
    .slice(0, 3)
    .map((offering) => offering.source.code);
}

function exact(offering: IndexedOffering, match: CatalogMatchMethod): CatalogResolution {
  return {
    kind: 'exact',
    offeringCode: offering.source.code,
    displayName: offering.source.display_name,
    academy: offering.source.academy,
    match,
  };
}

function ambiguous(
  request: string,
  offerings: readonly IndexedOffering[],
): CatalogResolution {
  const sorted = offerings.slice().sort(compareOfferings).slice(0, 3);
  const names = new Set(sorted.map((offering) => offering.normalizedName));
  const academies = new Set(
    sorted
      .map((offering) => normalizeSpanishCatalogText(offering.source.academy ?? ''))
      .filter(Boolean),
  );
  return {
    kind: 'ambiguous',
    requestedText: request,
    candidateCodes: sorted.map((offering) => offering.source.code),
    clarification: names.size === 1 && academies.size > 1 ? 'choose_area' : 'choose_offering',
  };
}

export function resolveCatalogRequest(
  text: string | readonly string[],
  snapshot: CatalogResolutionSnapshot | null,
): CatalogResolution {
  const request = requestedText(text);
  const messages = toMessages(text);
  const replacementSubject = explicitCatalogReplacementSubject(text);
  const explicitCatalogIntent = hasCatalogIntent(messages) || replacementSubject !== null;

  if (snapshot === null) {
    return explicitCatalogIntent
      ? { kind: 'unavailable', reason: 'snapshot_missing' }
      : { kind: 'no_catalog_intent' };
  }
  if (snapshotIsInvalid(snapshot)) {
    return explicitCatalogIntent
      ? { kind: 'unavailable', reason: 'snapshot_invalid' }
      : { kind: 'no_catalog_intent' };
  }

  const offerings = indexOfferings(snapshot);
  const resolutionMessages = replacementSubject === null ? messages : [replacementSubject];
  const hits = literalHits(resolutionMessages, offerings);
  const positiveHits = positiveLiteralHits(resolutionMessages, hits);
  const literalMatches = distinctLiteralMatches(positiveHits);

  if (replacementSubject === null && (
    latestMessageCancelsSelection(messages, positiveHits)
    || (hits.length > 0 && positiveHits.length === 0)
    || (positiveHits.length === 0 && messages.some((message) => CATALOG_REJECTION_PATTERN.test(message)))
  )) {
    return { kind: 'no_catalog_intent' };
  }

  if (literalMatches.length > 0) {
    // Even a literal name or SKU can collide with an omitted homonym. A
    // truncated snapshot cannot prove identity, so never declare it exact.
    if (snapshot.offerings_truncated > 0) {
      return { kind: 'unavailable', reason: 'snapshot_truncated' };
    }
    if (literalMatches.length === 1) {
      return exact(literalMatches[0].offering, 'canonical');
    }
    const namedAcademy = explicitAcademy(
      resolutionMessages,
      literalMatches.map((match) => match.offering),
    );
    if (namedAcademy !== null) {
      const academyMatches = literalMatches.filter((match) => (
        normalizeSpanishCatalogText(match.offering.source.academy ?? '')
        === namedAcademy.normalized
      ));
      if (academyMatches.length === 1) {
        return exact(academyMatches[0].offering, 'canonical');
      }
    }
    const selected = explicitSelection(resolutionMessages, positiveHits);
    if (selected !== null) return exact(selected.offering, 'canonical');
    return ambiguous(request, literalMatches.map((match) => match.offering));
  }

  const computerRepair = computerRepairMatches(resolutionMessages, offerings);
  if (computerRepair.length > 0) {
    if (snapshot.offerings_truncated > 0) {
      return { kind: 'unavailable', reason: 'snapshot_truncated' };
    }
    return computerRepair.length === 1
      ? exact(computerRepair[0], 'canonical')
      : ambiguous(request, computerRepair);
  }

  const partialMatches = partialSubjectMatches(replacementSubject ?? text, offerings);
  if (partialMatches.length > 0) {
    if (snapshot.offerings_truncated > 0) {
      return { kind: 'unavailable', reason: 'snapshot_truncated' };
    }
    // A partial title narrows the clarification, never establishes identity,
    // even when the current complete snapshot has just one matching course.
    return ambiguous(request, partialMatches);
  }

  const familyMatches = informationalFamilyMatches(resolutionMessages, offerings);
  if (familyMatches.length > 0) {
    if (snapshot.offerings_truncated > 0) {
      return { kind: 'unavailable', reason: 'snapshot_truncated' };
    }
    return ambiguous(request, familyMatches);
  }

  const availabilityMatches = availabilityFamilyMatches(resolutionMessages, offerings);
  if (availabilityMatches.length > 0) {
    if (snapshot.offerings_truncated > 0) {
      return { kind: 'unavailable', reason: 'snapshot_truncated' };
    }
    return ambiguous(request, availabilityMatches);
  }

  const hedgedMatches = hedgedFamilyFragmentMatches(resolutionMessages, offerings);
  if (hedgedMatches.length > 0 && explicitCatalogIntent) {
    if (snapshot.offerings_truncated > 0) {
      return { kind: 'unavailable', reason: 'snapshot_truncated' };
    }
    return ambiguous(request, hedgedMatches);
  }

  // A nearby word is not enough to create commercial intent. Fuzzy matching
  // is only a spelling aid after the customer explicitly asked about catalog.
  if (!explicitCatalogIntent) return { kind: 'no_catalog_intent' };

  const fuzzyMatches = typoMatches(resolutionMessages, offerings);
  if (fuzzyMatches.length > 1) return ambiguous(request, fuzzyMatches);
  if (fuzzyMatches.length === 1) {
    // A truncated snapshot cannot establish that a fuzzy candidate is unique.
    if (snapshot.offerings_truncated > 0) {
      return { kind: 'unavailable', reason: 'snapshot_truncated' };
    }
    return exact(fuzzyMatches[0], 'unique_typo');
  }

  if (snapshot.offerings_truncated > 0) {
    return { kind: 'unavailable', reason: 'snapshot_truncated' };
  }

  const requestedArea = explicitAcademy(messages, offerings);
  return {
    kind: 'not_found',
    requestedText: request,
    requestedArea: requestedArea?.displayName ?? null,
    alternativeCodes: alternativeCodes(offerings, requestedArea),
  };
}
