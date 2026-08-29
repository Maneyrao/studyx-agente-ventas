import {
  AuthorizedEgressSchema,
  type AuthorizedEgress,
} from '../schemas/contracts'

export type PortableEgressVerification =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'INVALID_MANIFEST' }
  | { readonly ok: false; readonly reason: 'CRYPTO_UNAVAILABLE' }
  | { readonly ok: false; readonly reason: 'HASH_MISMATCH' }
  | {
      readonly ok: false
      readonly reason: 'UNAUTHORIZED_URL'
      readonly unauthorized_urls: readonly string[]
    }
  | {
      readonly ok: false
      readonly reason: 'UNAUTHORIZED_PROTECTED_FACT'
      readonly unauthorized_facts: readonly AuthorizedEgress['protected_facts'][number][]
    }

const DOMAIN_LABEL = String.raw`(?:xn--[a-z0-9-]{1,59}|[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?)`
const DOMAIN_TLD = String.raw`(?:xn--[a-z0-9-]{2,59}|[\p{L}]{2,63})`
const EXPLICIT_URL = String.raw`(?:\b[a-z][a-z0-9+.-]*:\/\/|\b(?:mailto|tel|data|javascript):|\bwww\.)[^\s<>"']+`
const BARE_HOSTNAME = String.raw`(?<![@\p{L}\p{N}_.-])${DOMAIN_LABEL}(?:\.${DOMAIN_LABEL})*\.${DOMAIN_TLD}(?::\d{1,5})?(?:[/?#][^\s<>"']*)?`
const URL_LIKE_PATTERN = new RegExp(`${EXPLICIT_URL}|${BARE_HOSTNAME}`, 'giu')
const MONEY_AMOUNT = String.raw`(?:\d{1,3}(?:[.\s]\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)`
const NUMBER_WORD = String.raw`(?:cero|un[oa]?|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|dieci[\p{L}]+|veinte|veinti[\p{L}]+|treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa|cien(?:to)?|doscient[oa]s?|trescient[oa]s?|cuatrocient[oa]s?|quinient[oa]s?|seiscient[oa]s?|setecient[oa]s?|ochocient[oa]s?|novecient[oa]s?|mil(?:es)?|mill[oó]n(?:es)?)`
const NUMBER_WORD_SEQUENCE = String.raw`${NUMBER_WORD}(?:\s+(?:y\s+)?${NUMBER_WORD}){0,8}`
const CURRENCY_PRICE = String.raw`(?:(?:\b(?:usd|ars|eur|u\$s)\b|[$€£])\s*${MONEY_AMOUNT}|${MONEY_AMOUNT}\s*(?:\b(?:usd|ars|eur|d[oó]lares?|pesos?|euros?)\b|[$€£]))`
const WORD_CURRENCY_PRICE = String.raw`(?:(?:\b(?:usd|ars|eur|u\$s)\b)\s+${NUMBER_WORD_SEQUENCE}|${NUMBER_WORD_SEQUENCE}\s+(?:\b(?:usd|ars|eur|d[oó]lares?|pesos?|euros?)\b))`
const PRICE_PATTERN = new RegExp(
  String.raw`(?:(?:\b(?:no\s+)?(?:cuesta|sale|vale)\s+)?(?:${CURRENCY_PRICE}|${WORD_CURRENCY_PRICE})|\bprecio(?:\s+total)?\s*(?::|es|de)?\s*(?:${MONEY_AMOUNT}|${NUMBER_WORD_SEQUENCE})\b|\b(?:no\s+)?cuesta\s+(?:${MONEY_AMOUNT}|${NUMBER_WORD_SEQUENCE})\b)`,
  'giu',
)
const DURATION_PATTERN = new RegExp(
  String.raw`(?:\bno\s+(?:dura|son|tiene)\s+)?\b(?:\d+(?:[.,]\d+)?|${NUMBER_WORD_SEQUENCE})\s*(?:minutos?|horas?|d[ií]as?|semanas?|mes(?:es)?|a[nñ]os?|clases?|m[oó]dulos?)\b`,
  'giu',
)
const MODALITY_PATTERN = /(?<!asesora )(?<!asesor )\b(?:no\s+(?:es|ser[aá])\s+)?(?:online|presencial(?:es)?|virtual(?:es)?|remot[oa]s?|h[ií]brid[oa]s?|asincr[oó]nic[oa]s?|sincr[oó]nic[oa]s?|autogestionad[oa]s?|a distancia|en l[ií]nea|a tu ritmo)\b/giu
const CERTIFICATION_PATTERN = /(?:(?:la\s+)?certificaci[oó]n\s+(?:no\s+est[aá]\s+(?:especificada|informada)|es\s+desconocida)|(?:no\s+(?:incluye|entrega|otorga)|sin)\s+(?:un\s+)?(?:certificado|certificaci[oó]n|diploma|t[ií]tulo)|(?:incluye|entrega|otorga)\s+(?:un\s+)?(?:certificado|certificaci[oó]n|diploma|t[ií]tulo)|certificaci[oó]n|certificad[oa]s?|diplomas?|t[ií]tulos?)/giu
const OFFERING_PATTERN = /(?:\b(?:s[ií][,:]?\s+)?(?:(?:studyx\s+)?(?:ofrece(?:mos)?|tenemos|brinda(?:mos)?|da|damos|dicta(?:mos)?|contamos\s+con|disponemos\s+de)|studyx\s+tiene)\s+(?:el\s+)?(?:curso\s+de\s+)?[^.!?\n]{2,100}|\bpod[eé]s\s+estudiar\s+[^.!?\n]{2,100}|\b(?:el\s+)?curso(?:\s+de)?\s+[^.!?\n]{2,100}\s+est[aá]\s+disponible\b|\bs[ií][,:]?\s+hay\s+(?:un\s+)?curso(?:\s+de)?\s+[^.!?\n]{2,100}|\bpodemos\s+inscribirte\s+en\s+[^.!?\n]{2,100}|\bte\s+recomiendo\s+(?:nuestro\s+)?curso(?:\s+de)?\s+[^.!?\n]{2,100})/giu
const PROMISE_PATTERN = /(?:\b(?:la\s+)?salida\s+laboral\s+(?:est[aá]\s+)?garantizad[ao]\b|\bhay\s+una\s+beca(?:\s+para\s+(?:vos|ti))?\b|\bte\s+(?:devolvemos\s+(?:la\s+)?(?:plata|dinero)|reembolsamos)\b|\b(?:empleo|trabajo|resultado|resultados|[eé]xito|devoluci[oó]n)\s+(?:est[aá]n?\s+)?(?:garantizad[ao]s?|asegurad[ao]s?)\b|\b(?:vas\s+a\s+conseguir\s+trabajo|sal[ií]s\s+trabajando)\s+seguro\b|\bte\s+aseguramos\s+empleo\b|\b100\s*%\s+de\s+empleabilidad\b|\b\d{1,3}\s*%\s+de\s+descuento\b|\b(?:la\s+)?beca\b[^.!?\n]{0,60}\bm[aá]s\s+barat[oa]\b)/giu

function normalizeFactValue(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim()
}

function canonicalizeManifest(manifest: AuthorizedEgress) {
  const authorized_urls = [...new Set(manifest.authorized_urls)].sort()
  const normalizedFacts = manifest.protected_facts.map((fact) => ({
    kind: fact.kind,
    value: normalizeFactValue(fact.value),
  }))
  const protected_facts = [...new Map(
    normalizedFacts.map((fact) => [`${fact.kind}\u0000${fact.value}`, fact])
  ).values()].sort((left, right) => {
    if (left.kind !== right.kind) return left.kind < right.kind ? -1 : 1
    if (left.value === right.value) return 0
    return left.value < right.value ? -1 : 1
  })

  return { authorized_urls, protected_facts }
}

function trimTrailingUrlPunctuation(candidate: string): string {
  let url = candidate.replace(/[.,!?;:…]+$/u, '')
  const bracketPairs = [
    ['(', ')'],
    ['[', ']'],
    ['{', '}'],
  ] as const

  let changed = true
  while (changed) {
    changed = false
    for (const [opening, closing] of bracketPairs) {
      if (!url.endsWith(closing)) continue
      const openings = [...url].filter((character) => character === opening).length
      const closings = [...url].filter((character) => character === closing).length
      if (closings > openings) {
        url = url.slice(0, -1).replace(/[.,!?;:…]+$/u, '')
        changed = true
      }
    }
  }

  return url
}

function extractUrlCandidates(content: string): string[] {
  return [...content.matchAll(URL_LIKE_PATTERN)]
    .map((match) => trimTrailingUrlPunctuation(match[0]))
}

type PortableProtectedFact = AuthorizedEgress['protected_facts'][number]

function extractFactMatches(
  normalizedContent: string,
  pattern: RegExp,
  kind: PortableProtectedFact['kind'],
): Array<{ readonly fact: PortableProtectedFact; readonly index: number }> {
  return [...normalizedContent.matchAll(pattern)].map((match) => ({
    fact: { kind, value: normalizeFactValue(match[0]) },
    index: match.index,
  }))
}

function extractProtectedFacts(content: string): PortableProtectedFact[] {
  const normalizedContent = normalizeFactValue(content)
  return [
    ...extractFactMatches(normalizedContent, PRICE_PATTERN, 'price'),
    ...extractFactMatches(normalizedContent, DURATION_PATTERN, 'duration'),
    ...extractFactMatches(normalizedContent, MODALITY_PATTERN, 'modality'),
    ...extractFactMatches(normalizedContent, CERTIFICATION_PATTERN, 'certification'),
    ...extractFactMatches(normalizedContent, OFFERING_PATTERN, 'offering'),
    ...extractFactMatches(normalizedContent, PROMISE_PATTERN, 'promise'),
  ]
    .sort((left, right) => left.index - right.index)
    .map(({ fact }) => fact)
}

/** Shared pre-composition check: narrative may carry tone and questions, but
 * every commercial claim and URL must be rendered later from backend facts. */
export function isValueFreeNarrativePortable(content: string): boolean {
  return extractUrlCandidates(content).length === 0
    && extractProtectedFacts(content).length === 0
}

async function sha256Hex(value: string): Promise<string | null> {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) return null
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Botpress-side, framework-portable verification performed at the last
 * possible moment before a physical send. The backend remains the authority
 * that decides which URLs and commercial facts may enter this capability.
 */
export async function verifyAuthorizedEgressPortable(input: {
  readonly content: string
  readonly manifest: unknown
}): Promise<PortableEgressVerification> {
  const parsed = AuthorizedEgressSchema.safeParse(input.manifest)
  if (!parsed.success) return { ok: false, reason: 'INVALID_MANIFEST' }

  const authorization = canonicalizeManifest(parsed.data)
  const hashPayload = JSON.stringify({
    schema_version: 1,
    content: input.content,
    ...authorization,
  })
  const actualHash = await sha256Hex(hashPayload)
  if (actualHash === null) return { ok: false, reason: 'CRYPTO_UNAVAILABLE' }
  if (actualHash !== parsed.data.content_hash) {
    return { ok: false, reason: 'HASH_MISMATCH' }
  }

  const authorizedUrls = new Set(parsed.data.authorized_urls)
  const unauthorized_urls = extractUrlCandidates(input.content)
    .filter((url) => !authorizedUrls.has(url))
  if (unauthorized_urls.length > 0) {
    return { ok: false, reason: 'UNAUTHORIZED_URL', unauthorized_urls }
  }

  const authorizedFacts = new Set(
    parsed.data.protected_facts.map(
      (fact) => `${fact.kind}\u0000${normalizeFactValue(fact.value)}`,
    ),
  )
  const unauthorized_facts = extractProtectedFacts(input.content)
    .filter((fact) => !authorizedFacts.has(`${fact.kind}\u0000${fact.value}`))
  if (unauthorized_facts.length > 0) {
    return {
      ok: false,
      reason: 'UNAUTHORIZED_PROTECTED_FACT',
      unauthorized_facts,
    }
  }

  return { ok: true }
}
