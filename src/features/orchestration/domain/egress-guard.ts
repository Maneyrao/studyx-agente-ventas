import { createHash } from 'node:crypto';

export const AUTHORIZED_EGRESS_SCHEMA_VERSION = 1 as const;

export type ProtectedFactKind =
  | 'price'
  | 'duration'
  | 'modality'
  | 'certification'
  | 'offering'
  | 'promise';

export interface ProtectedFactRef {
  readonly kind: ProtectedFactKind;
  /** Canonical lexical fragment; normalized only for case, Unicode and whitespace. */
  readonly value: string;
}

/**
 * Content-addressed authorization produced by trusted backend materializers.
 * The digest binds the exact outbound text and the canonicalized lists below.
 * It is tamper evidence, not a keyed signature or a replacement for custody.
 */
export interface AuthorizedEgressV1 {
  readonly schema_version: typeof AUTHORIZED_EGRESS_SCHEMA_VERSION;
  readonly content_hash: string;
  readonly authorized_urls: readonly string[];
  readonly protected_facts: readonly ProtectedFactRef[];
}

export type AuthorizedEgress = AuthorizedEgressV1;

export interface BuildAuthorizedEgressInput {
  readonly content: string;
  readonly authorized_urls: readonly string[];
  readonly protected_facts: readonly ProtectedFactRef[];
}

export interface VerifyAuthorizedEgressInput {
  readonly content: string;
  readonly manifest: unknown;
}

export interface RetainAuthorizedEgressParagraphsInput {
  readonly content: string;
  readonly authorized_urls: readonly string[];
  readonly protected_facts: readonly ProtectedFactRef[];
}

export interface RetainedAuthorizedEgress {
  readonly content: string;
  readonly manifest: AuthorizedEgressV1;
}

export type AuthorizedEgressVerification =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'INVALID_MANIFEST' }
  | { readonly ok: false; readonly reason: 'HASH_MISMATCH' }
  | {
      readonly ok: false;
      readonly reason: 'UNAUTHORIZED_URL';
      readonly unauthorized_urls: readonly string[];
    }
  | {
      readonly ok: false;
      readonly reason: 'UNAUTHORIZED_PROTECTED_FACT';
      readonly unauthorized_facts: readonly ProtectedFactRef[];
    };

// A manifest may authorize only explicit http(s) URLs. Other schemes and
// autolinkable bare hostnames are still detected, so they fail closed. The
// Unicode branch covers IDNs while `xn--` covers their ASCII representation.
// Matching never normalizes URL semantics: query, fragment, hostname spelling
// and percent encoding remain byte-exact.
const DOMAIN_LABEL = String.raw`(?:xn--[a-z0-9-]{1,59}|[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?)`;
const DOMAIN_TLD = String.raw`(?:xn--[a-z0-9-]{2,59}|[\p{L}]{2,63})`;
const EXPLICIT_URL = String.raw`(?:\b[a-z][a-z0-9+.-]*:\/\/|\b(?:mailto|tel|data|javascript):|\bwww\.)[^\s<>"']+`;
const BARE_HOSTNAME = String.raw`(?<![@\p{L}\p{N}_.-])${DOMAIN_LABEL}(?:\.${DOMAIN_LABEL})*\.${DOMAIN_TLD}(?::\d{1,5})?(?:[/?#][^\s<>"']*)?`;
const URL_LIKE_PATTERN = new RegExp(`${EXPLICIT_URL}|${BARE_HOSTNAME}`, 'giu');
/*
 * This is a lexical safety boundary, not a general hallucination detector.
 * It recognizes currency-associated prices, numeric course/time units, a
 * small modality vocabulary and explicit certification wording. A protected
 * fragment is allowed only when the same kind + normalized fragment appears
 * in the manifest; no synonym expansion or business-catalog inference occurs.
 */
const MONEY_AMOUNT = String.raw`(?:\d{1,3}(?:[.\s]\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)`;
const NUMBER_WORD = String.raw`(?:cero|un[oa]?|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|dieci[\p{L}]+|veinte|veinti[\p{L}]+|treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa|cien(?:to)?|doscient[oa]s?|trescient[oa]s?|cuatrocient[oa]s?|quinient[oa]s?|seiscient[oa]s?|setecient[oa]s?|ochocient[oa]s?|novecient[oa]s?|mil(?:es)?|mill[oó]n(?:es)?)`;
const NUMBER_WORD_SEQUENCE = String.raw`${NUMBER_WORD}(?:\s+(?:y\s+)?${NUMBER_WORD}){0,8}`;
const CURRENCY_PRICE = String.raw`(?:(?:\b(?:usd|ars|eur|u\$s)\b|[$€£])\s*${MONEY_AMOUNT}|${MONEY_AMOUNT}\s*(?:\b(?:usd|ars|eur|d[oó]lares?|pesos?|euros?)\b|[$€£]))`;
const WORD_CURRENCY_PRICE = String.raw`(?:(?:\b(?:usd|ars|eur|u\$s)\b)\s+${NUMBER_WORD_SEQUENCE}|${NUMBER_WORD_SEQUENCE}\s+(?:\b(?:usd|ars|eur|d[oó]lares?|pesos?|euros?)\b))`;
const PRICE_PATTERN = new RegExp(
  String.raw`(?:(?:\b(?:no\s+)?(?:cuesta|sale|vale)\s+)?(?:${CURRENCY_PRICE}|${WORD_CURRENCY_PRICE})|\bprecio(?:\s+total)?\s*(?::|es|de)?\s*(?:${MONEY_AMOUNT}|${NUMBER_WORD_SEQUENCE})\b|\b(?:no\s+)?cuesta\s+(?:${MONEY_AMOUNT}|${NUMBER_WORD_SEQUENCE})\b)`,
  'giu'
);
const DURATION_PATTERN = new RegExp(
  String.raw`(?:\bno\s+(?:dura|son|tiene)\s+)?(?<!\bsus\s)\b(?:\d+(?:[.,]\d+)?|${NUMBER_WORD_SEQUENCE})\s*(?:minutos?|horas?|d[ií]as?|semanas?|mes(?:es)?|a[nñ]os?|clases?|m[oó]dulos?)\b`,
  'giu',
);
const MODALITY_PATTERN = /(?<!asesora )(?<!asesor )\b(?:no\s+(?:es|ser[aá])\s+)?(?:online|presencial(?:es)?|virtual(?:es)?|remot[oa]s?|h[ií]brid[oa]s?|asincr[oó]nic[oa]s?|sincr[oó]nic[oa]s?|autogestionad[oa]s?|a distancia|en l[ií]nea|a tu ritmo)\b/giu;
const CERTIFICATION_PATTERN = /(?:(?:la\s+)?certificaci[oó]n\s+(?:no\s+est[aá]\s+(?:especificada|informada)|es\s+desconocida)|(?:no\s+(?:incluye|entrega|otorga)|sin)\s+(?:un\s+)?(?:certificado|certificaci[oó]n|diploma|t[ií]tulo)|(?:incluye|entrega|otorga)\s+(?:un\s+)?(?:certificado|certificaci[oó]n|diploma|t[ií]tulo)|certificaci[oó]n|certificad[oa]s?|diplomas?|t[ií]tulos?)/giu;
const OFFERING_PATTERN = /(?:\b(?:s[ií][,:]?\s+)?(?:(?:studyx\s+)?(?:ofrece(?:mos)?|tenemos|brinda(?:mos)?|da|damos|dicta(?:mos)?|contamos\s+con|disponemos\s+de)|studyx\s+tiene)\s+(?:el\s+)?(?:curso\s+de\s+)?[^.!?\n]{2,100}|\bpod[eé]s\s+estudiar\s+[^.!?\n]{2,100}|\b(?:el\s+)?curso(?:\s+de)?\s+[^.!?\n]{2,100}\s+est[aá]\s+disponible\b|\bs[ií][,:]?\s+hay\s+(?:un\s+)?curso(?:\s+de)?\s+[^.!?\n]{2,100}|\bpodemos\s+inscribirte\s+en\s+[^.!?\n]{2,100}|\bte\s+recomiendo\s+(?:nuestro\s+)?curso(?:\s+de)?\s+[^.!?\n]{2,100})/giu;
const PROMISE_PATTERN = /(?:\b(?:la\s+)?salida\s+laboral\s+(?:est[aá]\s+)?garantizad[ao]\b|\bhay\s+una\s+beca(?:\s+para\s+(?:vos|ti))?\b|\bte\s+(?:devolvemos\s+(?:la\s+)?(?:plata|dinero)|reembolsamos)\b|\b(?:empleo|trabajo|resultado|resultados|[eé]xito|devoluci[oó]n)\s+(?:est[aá]n?\s+)?(?:garantizad[ao]s?|asegurad[ao]s?)\b|\b(?:vas\s+a\s+conseguir\s+trabajo|sal[ií]s\s+trabajando)\s+seguro\b|\bte\s+aseguramos\s+empleo\b|\b100\s*%\s+de\s+empleabilidad\b|\b\d{1,3}\s*%\s+de\s+descuento\b|\b(?:la\s+)?beca\b[^.!?\n]{0,60}\bm[aá]s\s+barat[oa]\b)/giu;
const MANIFEST_FIELDS = new Set([
  'schema_version',
  'content_hash',
  'authorized_urls',
  'protected_facts',
]);
const PROTECTED_FACT_FIELDS = new Set(['kind', 'value']);
const PROTECTED_FACT_KINDS = new Set<ProtectedFactKind>([
  'price',
  'duration',
  'modality',
  'certification',
  'offering',
  'promise',
]);

function normalizeFactValue(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isExactHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || /\s/u.test(value)) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function isProtectedFactRef(value: unknown): value is ProtectedFactRef {
  if (
    !isRecord(value)
    || Object.keys(value).some((field) => !PROTECTED_FACT_FIELDS.has(field))
    || typeof value.kind !== 'string'
    || !PROTECTED_FACT_KINDS.has(value.kind as ProtectedFactKind)
    || typeof value.value !== 'string'
    || normalizeFactValue(value.value).length === 0
  ) {
    return false;
  }
  return true;
}

function isAuthorizedEgressV1(value: unknown): value is AuthorizedEgressV1 {
  return isRecord(value)
    && Object.keys(value).every((field) => MANIFEST_FIELDS.has(field))
    && value.schema_version === AUTHORIZED_EGRESS_SCHEMA_VERSION
    && typeof value.content_hash === 'string'
    && /^[a-f0-9]{64}$/u.test(value.content_hash)
    && Array.isArray(value.authorized_urls)
    && value.authorized_urls.every(isExactHttpUrl)
    && Array.isArray(value.protected_facts)
    && value.protected_facts.every(isProtectedFactRef);
}

function trimTrailingUrlPunctuation(candidate: string): string {
  let url = candidate.replace(/[.,!?;:…]+$/u, '');
  const bracketPairs = [
    ['(', ')'],
    ['[', ']'],
    ['{', '}'],
  ] as const;

  let changed = true;
  while (changed) {
    changed = false;
    for (const [opening, closing] of bracketPairs) {
      if (!url.endsWith(closing)) continue;
      const openings = [...url].filter((char) => char === opening).length;
      const closings = [...url].filter((char) => char === closing).length;
      if (closings > openings) {
        url = url.slice(0, -1).replace(/[.,!?;:…]+$/u, '');
        changed = true;
      }
    }
  }

  return url;
}

function extractUrlCandidates(content: string): string[] {
  return [...content.matchAll(URL_LIKE_PATTERN)]
    .map((match) => trimTrailingUrlPunctuation(match[0]));
}

interface LocatedProtectedFact {
  readonly fact: ProtectedFactRef;
  readonly index: number;
}

function extractMatches(
  normalizedContent: string,
  pattern: RegExp,
  kind: ProtectedFactKind
): LocatedProtectedFact[] {
  return [...normalizedContent.matchAll(pattern)].map((match) => ({
    fact: { kind, value: normalizeFactValue(match[0]) },
    index: match.index,
  }));
}

function extractProtectedFacts(content: string): ProtectedFactRef[] {
  const normalizedContent = normalizeFactValue(content);
  return [
    ...extractMatches(normalizedContent, PRICE_PATTERN, 'price'),
    ...extractMatches(normalizedContent, DURATION_PATTERN, 'duration'),
    ...extractMatches(normalizedContent, MODALITY_PATTERN, 'modality'),
    ...extractMatches(normalizedContent, CERTIFICATION_PATTERN, 'certification'),
    ...extractMatches(normalizedContent, OFFERING_PATTERN, 'offering'),
    ...extractMatches(normalizedContent, PROMISE_PATTERN, 'promise'),
  ]
    .sort((left, right) => left.index - right.index)
    .map(({ fact }) => fact);
}

function canonicalizeAuthorization(input: BuildAuthorizedEgressInput) {
  const authorized_urls = [...new Set(input.authorized_urls)].sort();
  const normalizedFacts = input.protected_facts.map((fact): ProtectedFactRef => ({
    kind: fact.kind,
    value: normalizeFactValue(fact.value),
  }));
  const protected_facts = [...new Map(
    normalizedFacts.map((fact) => [`${fact.kind}\u0000${fact.value}`, fact])
  ).values()].sort((left, right) => {
    if (left.kind !== right.kind) return left.kind < right.kind ? -1 : 1;
    if (left.value === right.value) return 0;
    return left.value < right.value ? -1 : 1;
  });

  return { authorized_urls, protected_facts };
}

export function buildAuthorizedEgress(input: BuildAuthorizedEgressInput): AuthorizedEgressV1 {
  const authorization = canonicalizeAuthorization(input);
  const hashPayload = JSON.stringify({
    schema_version: AUTHORIZED_EGRESS_SCHEMA_VERSION,
    content: input.content,
    ...authorization,
  });

  return {
    schema_version: AUTHORIZED_EGRESS_SCHEMA_VERSION,
    content_hash: createHash('sha256').update(hashPayload, 'utf8').digest('hex'),
    ...authorization,
  };
}

export function verifyAuthorizedEgress(
  input: VerifyAuthorizedEgressInput
): AuthorizedEgressVerification {
  if (!isAuthorizedEgressV1(input.manifest)) {
    return { ok: false, reason: 'INVALID_MANIFEST' };
  }

  const expected = buildAuthorizedEgress({
    content: input.content,
    authorized_urls: input.manifest.authorized_urls,
    protected_facts: input.manifest.protected_facts,
  });

  if (expected.content_hash !== input.manifest.content_hash) {
    return { ok: false, reason: 'HASH_MISMATCH' };
  }

  const authorizedUrls = new Set(input.manifest.authorized_urls);
  const unauthorized_urls = extractUrlCandidates(input.content)
    .filter((url) => !authorizedUrls.has(url));
  if (unauthorized_urls.length > 0) {
    return { ok: false, reason: 'UNAUTHORIZED_URL', unauthorized_urls };
  }

  const authorizedFacts = new Set(
    input.manifest.protected_facts.map((fact) => `${fact.kind}\u0000${normalizeFactValue(fact.value)}`)
  );
  const unauthorized_facts = extractProtectedFacts(input.content)
    .filter((fact) => !authorizedFacts.has(`${fact.kind}\u0000${fact.value}`));
  if (unauthorized_facts.length > 0) {
    return {
      ok: false,
      reason: 'UNAUTHORIZED_PROTECTED_FACT',
      unauthorized_facts,
    };
  }

  return { ok: true };
}

/**
 * Retains model-authored prose instead of replacing it with canned copy.
 *
 * This recovery is intentionally narrow: it is available only when the
 * complete response failed because of an unauthorized protected fact. URL,
 * manifest and hash failures remain fail-closed. Each retained paragraph must
 * independently pass the same authorization manifest used for the full
 * response, and the resulting text receives a fresh content-bound manifest.
 */
export function retainAuthorizedEgressParagraphs(
  input: RetainAuthorizedEgressParagraphsInput
): RetainedAuthorizedEgress | null {
  const completeManifest = buildAuthorizedEgress(input);
  const completeVerification = verifyAuthorizedEgress({
    content: input.content,
    manifest: completeManifest,
  });
  if (completeVerification.ok) {
    return { content: input.content, manifest: completeManifest };
  }
  if (completeVerification.reason !== 'UNAUTHORIZED_PROTECTED_FACT') return null;

  const authorizedParagraphs = input.content
    .split(/\n\s*\n/gu)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0)
    .filter((paragraph) => {
      const manifest = buildAuthorizedEgress({
        content: paragraph,
        authorized_urls: input.authorized_urls,
        protected_facts: input.protected_facts,
      });
      return verifyAuthorizedEgress({ content: paragraph, manifest }).ok;
    });

  if (authorizedParagraphs.length === 0) return null;
  const content = authorizedParagraphs.join('\n\n');
  const manifest = buildAuthorizedEgress({
    content,
    authorized_urls: input.authorized_urls,
    protected_facts: input.protected_facts,
  });
  return verifyAuthorizedEgress({ content, manifest }).ok
    ? { content, manifest }
    : null;
}
