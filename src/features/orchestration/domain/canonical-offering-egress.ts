import {
  buildAuthorizedEgress,
  verifyAuthorizedEgress,
  type ProtectedFactRef,
} from './egress-guard';
import {
  renderCourseDuration,
  renderCourseDurationValue,
  renderCourseModality,
  renderCoursePrice,
  renderUnknownCertification,
} from './canonical-commercial-copy';

/**
 * Small domain projection of the canonical offering fields that may authorize
 * customer-facing commercial facts. It deliberately has no database or HTTP
 * types: adapters may populate it only after resolving one exact offering.
 */
export interface CanonicalOfferingFactSource {
  readonly display_name?: string;
  readonly price_type: 'fixed' | 'quote' | 'free';
  readonly price_amount: string | null;
  readonly currency: string | null;
  readonly delivery: Readonly<Record<string, unknown>>;
}

export interface CanonicalCatalogOfferingSource {
  readonly code: string;
  readonly display_name: string;
}

function normalize(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function canonicalAmount(value: string | null): string | null {
  if (value === null || !/^\d+(?:\.\d+)?$/u.test(value)) return null;
  const withoutTrailingZeros = value.replace(/(\.\d*?[1-9])0+$/u, '$1').replace(/\.0+$/u, '');
  return withoutTrailingZeros.length > 0 ? withoutTrailingZeros : null;
}

function positiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}

function candidateFacts(offering: CanonicalOfferingFactSource): ProtectedFactRef[] {
  const facts: ProtectedFactRef[] = [];
  const amount = offering.price_type === 'fixed' ? canonicalAmount(offering.price_amount) : null;
  const currency = offering.currency?.trim() ?? '';
  if (amount !== null && currency.length > 0) {
    facts.push(
      { kind: 'price', value: `${currency} ${amount}` },
      { kind: 'price', value: `${amount} ${currency}` },
    );
  }

  const classes = positiveInteger(offering.delivery.classes);
  if (classes !== null) {
    facts.push({ kind: 'duration', value: `${classes} ${classes === 1 ? 'clase' : 'clases'}` });
  }
  const modules = positiveInteger(offering.delivery.modules);
  if (modules !== null) {
    facts.push({ kind: 'duration', value: `${modules} ${modules === 1 ? 'módulo' : 'módulos'}` });
  }
  const hoursPerMonth = positiveInteger(offering.delivery.hours_per_month);
  if (hoursPerMonth !== null) {
    facts.push({ kind: 'duration', value: `${hoursPerMonth} horas por mes` });
  }

  if (typeof offering.delivery.modality === 'string' && offering.delivery.modality.trim().length > 0) {
    facts.push({ kind: 'modality', value: offering.delivery.modality.trim() });
  }

  if (offering.delivery.certification === true) {
    facts.push(
      { kind: 'certification', value: 'incluye certificado' },
      { kind: 'certification', value: 'incluye un certificado' },
      { kind: 'certification', value: 'entrega certificado' },
      { kind: 'certification', value: 'entrega un certificado' },
      { kind: 'certification', value: 'otorga certificado' },
      { kind: 'certification', value: 'otorga un certificado' },
    );
  } else if (offering.delivery.certification === false) {
    facts.push(
      { kind: 'certification', value: 'no incluye certificado' },
      { kind: 'certification', value: 'no incluye un certificado' },
      { kind: 'certification', value: 'sin certificado' },
    );
  } else {
    facts.push(
      { kind: 'certification', value: 'la certificación no está especificada' },
      { kind: 'certification', value: 'la certificación no está informada' },
      { kind: 'certification', value: 'certificación' },
    );
  }

  return [...new Map(facts.map((fact) => [`${fact.kind}\u0000${normalize(fact.value)}`, fact])).values()];
}

/**
 * A catalog value authorizes a complete, bounded assertion — never the same
 * token embedded inside a different claim ("desde USD 360", "16 clases
 * adicionales", etc.). Keeping this grammar deliberately small makes an
 * unfamiliar model phrasing fail closed and pushes normal commercial facts
 * through the deterministic templates.
 */
function isFullyCanonicalOfferingAssertion(
  fact: ProtectedFactRef,
  offerings: readonly CanonicalCatalogOfferingSource[],
): boolean {
  let remainder = normalize(fact.value);
  let matchedNames = 0;
  const names = offerings
    .map((offering) => normalize(offering.display_name))
    .filter(Boolean)
    .sort((left, right) => right.length - left.length);

  for (const name of names) {
    const pattern = new RegExp(escapeRegExp(name), 'gu');
    const matches = [...remainder.matchAll(pattern)].length;
    if (matches === 0) continue;
    matchedNames += matches;
    remainder = remainder.replace(pattern, ' ');
  }

  remainder = remainder
    .replace(/\b(?:s[ií]|studyx|ofrece(?:mos)?|tiene|tenemos|brinda(?:mos)?|da|damos|dicta(?:mos)?|contamos|con|disponemos|de|pod[eé]s|estudiar|el|la|los|las|un|una|curso|est[aá]|disponible|hay|podemos|inscribirte|en|te|recomiendo|nuestro|nuestra|y|e|o|para|vos|ti)\b/gu, ' ')
    .replace(/[,;:()\[\]{}\-–—/]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();

  return matchedNames > 0 && remainder.length === 0;
}

function maskCanonicalNames(content: string, names: readonly string[]): string {
  return names
    .filter((name) => name.trim().length > 0)
    .sort((left, right) => right.length - left.length)
    .reduce(
      (masked, name) => masked.replace(new RegExp(escapeRegExp(name), 'giu'), 'curso autorizado'),
      content,
    );
}

function occurrenceRanges(content: string, value: string): Array<{ start: number; end: number }> {
  return [...content.matchAll(new RegExp(escapeRegExp(value), 'gu'))]
    .map((match) => ({ start: match.index, end: match.index + value.length }));
}

function factOccursOnlyInsideCanonicalNames(
  content: string,
  fact: ProtectedFactRef,
  offerings: readonly CanonicalCatalogOfferingSource[],
): boolean {
  const normalizedContent = normalize(content);
  const factValue = normalize(fact.value);
  const factRanges = occurrenceRanges(normalizedContent, factValue);
  if (factRanges.length === 0) return false;
  const nameRanges = offerings.flatMap((offering) =>
    occurrenceRanges(normalizedContent, normalize(offering.display_name)),
  );
  return factRanges.every((factRange) => nameRanges.some((nameRange) => (
    nameRange.start <= factRange.start && nameRange.end >= factRange.end
  )));
}

function canonicalRendererStatements(offering: CanonicalOfferingFactSource): string[] {
  const displayName = offering.display_name?.trim();
  if (!displayName) return [];
  const statements: string[] = [];
  const amount = offering.price_type === 'fixed' ? canonicalAmount(offering.price_amount) : null;
  const currency = offering.currency?.trim() ?? '';
  if (amount !== null && currency.length > 0) {
    statements.push(renderCoursePrice({ displayName, currency, amount }));
  }
  const classes = positiveInteger(offering.delivery.classes);
  if (classes !== null) {
    statements.push(renderCourseDuration({ displayName, classes }));
  }
  const modules = positiveInteger(offering.delivery.modules);
  if (modules !== null) {
    statements.push(renderCourseDurationValue({
      displayName,
      duration: `${modules} ${modules === 1 ? 'módulo' : 'módulos'}`,
    }));
  }
  const hoursPerMonth = positiveInteger(offering.delivery.hours_per_month);
  if (hoursPerMonth !== null) {
    statements.push(renderCourseDurationValue({
      displayName,
      duration: `${hoursPerMonth} horas por mes`,
    }));
  }
  if (typeof offering.delivery.modality === 'string' && offering.delivery.modality.trim().length > 0) {
    statements.push(renderCourseModality({
      displayName,
      modality: offering.delivery.modality.trim(),
    }));
  }
  if (offering.delivery.certification !== true && offering.delivery.certification !== false) {
    statements.push(renderUnknownCertification({ displayName }));
  }
  return statements;
}

function usesOnlyCanonicalRendererStatements(
  content: string,
  detectedFacts: readonly ProtectedFactRef[],
  statements: readonly string[],
): boolean {
  const normalizedContent = normalize(content);
  const statementRanges = statements.flatMap((statement) => (
    occurrenceRanges(normalizedContent, normalize(statement))
  ));
  if (statementRanges.length === 0) return false;
  return detectedFacts.every((fact) => {
    const factRanges = occurrenceRanges(normalizedContent, normalize(fact.value));
    return factRanges.length > 0 && factRanges.every((factRange) => (
      statementRanges.some((statementRange) => (
        statementRange.start <= factRange.start && statementRange.end >= factRange.end
      ))
    ));
  });
}

function inspectWithNoCapabilities(content: string) {
  const manifest = buildAuthorizedEgress({
    content,
    authorized_urls: [],
    protected_facts: [],
  });
  return verifyAuthorizedEgress({ content, manifest });
}

/** True only when the current lexical guard found a protected commercial fact. */
export function responseNeedsOfferingFactAuthorization(content: string): boolean {
  const inspection = inspectWithNoCapabilities(content);
  return !inspection.ok && inspection.reason === 'UNAUTHORIZED_PROTECTED_FACT';
}

/**
 * Materialize only protected fragments already present in `content` and fully
 * backed by one exact canonical offering. The guard itself supplies the
 * detected fragments, so this module does not maintain a second detector.
 * Any extra/unmatched fact makes the whole authorization empty (fail closed).
 */
export function materializeCanonicalOfferingFacts(input: {
  readonly content: string;
  readonly offering: CanonicalOfferingFactSource;
}): readonly ProtectedFactRef[] {
  const displayName = input.offering.display_name?.trim();
  if (!displayName) return [];
  const inspectedContent = maskCanonicalNames(input.content, [displayName]);
  const inspection = inspectWithNoCapabilities(inspectedContent);
  if (inspection.ok || inspection.reason !== 'UNAUTHORIZED_PROTECTED_FACT') return [];
  const supportedFacts = inspection.unauthorized_facts.filter(
    (fact) => fact.kind !== 'offering' && fact.kind !== 'promise',
  );
  if (supportedFacts.length === 0) return [];
  const rendererStatements = canonicalRendererStatements(input.offering)
    .map((statement) => maskCanonicalNames(statement, [displayName]));
  if (!usesOnlyCanonicalRendererStatements(
    inspectedContent,
    supportedFacts,
    rendererStatements,
  )) return [];

  const candidates = candidateFacts(input.offering);
  const candidateKeys = new Set(
    candidates.map((fact) => `${fact.kind}\u0000${normalize(fact.value)}`),
  );
  return supportedFacts.every(
    (fact) => candidateKeys.has(`${fact.kind}\u0000${normalize(fact.value)}`),
  ) ? supportedFacts : [];
}

/** Authorize only an entire availability/list assertion whose every named
 * offering resolves exactly in the backend's active catalog snapshot. */
export function materializeCanonicalCatalogFacts(input: {
  readonly content: string;
  readonly offerings: readonly CanonicalCatalogOfferingSource[];
}): readonly ProtectedFactRef[] {
  const inspection = inspectWithNoCapabilities(input.content);
  if (inspection.ok || inspection.reason !== 'UNAUTHORIZED_PROTECTED_FACT') return [];
  const offeringFacts = inspection.unauthorized_facts.filter((fact) => fact.kind === 'offering');
  if (!offeringFacts.every((fact) => isFullyCanonicalOfferingAssertion(fact, input.offerings))) {
    return [];
  }
  const canonicalNameFacts = inspection.unauthorized_facts.filter((fact) => (
    fact.kind === 'modality'
    && factOccursOnlyInsideCanonicalNames(input.content, fact, input.offerings)
  ));
  return [...offeringFacts, ...canonicalNameFacts];
}
