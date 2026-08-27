import type { ClaimedTurn } from '../schemas/contracts'
import { renderCatalogOptions } from './canonical-commercial-copy'

type CatalogOffering = {
  readonly code: string
  readonly display_name: string
  readonly academy: string | null
}

export type CatalogGuidance = {
  readonly kind: 'generic' | 'selection'
  readonly response: string
  readonly missingInformation: 'catalog_area' | 'catalog_offering_choice'
}

const GENERIC_CATALOG_WITH_NOUN_PATTERN =
  /(?:\b(?:info|informacion|datos|detalles|ver|conocer|saber|mostrarme|mostrame|pasame|pasarme|ofrecen|tienen|hay|que|cuales)\b.{0,36}\b(?:cursos|diplomados|capacitaciones|formaciones|programas|catalogo|oferta academica)\b|\b(?:cursos|diplomados|capacitaciones|formaciones|programas)\b.{0,24}\b(?:disponibles|ofrecen|tienen|hay|ver|conocer)\b)/u

const GENERIC_CATALOG_WITHOUT_NOUN_PATTERN =
  /^(?:que ofrecen|cuales hay disponibles|quiero (?:estudiar|aprender) algo)$/u

const NEGATED_SELECTION_PATTERN =
  /\b(?:no|sin|distint[oa]|diferente|otra cosa)\b/u

const NEGATED_TOPIC_PATTERN =
  /\b(?:no (?:tenga|tiene) que ver con|sin|algo (?:distinto|diferente)(?: de| a)?|no (?:quiero|me interesa))\s+([a-z0-9 ]{3,40})$/u

const SELECTION_LEAD_PATTERN =
  /^(?:(?:me interesa|quiero|quisiera|prefiero|busco|elijo|me gustaria|algo de|sobre)\s+)+/u

const SELECTION_STOP_WORDS = new Set([
  'algo',
  'aprender',
  'curso',
  'cursos',
  'de',
  'del',
  'el',
  'en',
  'estudiar',
  'interesa',
  'la',
  'las',
  'lo',
  'los',
  'me',
  'sobre',
  'un',
  'una',
  'quiero',
]);

export function normalizeCatalogGuidanceText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
}

function catalogOfferings(claimed: ClaimedTurn): readonly CatalogOffering[] {
  const index = claimed.catalog_index?.offerings ?? []
  if (index.length > 0) return index
  return claimed.business_context?.offerings ?? []
}

function academyLabel(academy: string): string {
  return academy.replace(/^Academia(?: de)?\s+/iu, '').trim()
}

function joinSpanish(values: readonly string[]): string {
  if (values.length <= 1) return values[0] ?? ''
  if (values.length === 2) return `${values[0]} y ${values[1]}`
  return `${values.slice(0, -1).join(', ')} y ${values.at(-1)}`
}

function containsTerm(text: string, term: string): boolean {
  return (` ${text} `).includes(` ${term} `)
}

function selectedAcademy(
  messages: readonly string[],
  academies: readonly string[],
): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (NEGATED_SELECTION_PATTERN.test(message)) continue
    const matches = academies.filter((academy) => {
      const canonical = normalizeCatalogGuidanceText(academy)
      const concise = normalizeCatalogGuidanceText(academyLabel(academy))
      return containsTerm(message, canonical) || containsTerm(message, concise)
    })
    if (matches.length === 1) return matches[0]
  }
  return null
}

function selectedTopicOfferings(
  messages: readonly string[],
  offerings: readonly CatalogOffering[],
): readonly CatalogOffering[] {
  const latest = messages.at(-1) ?? ''
  if (latest.length === 0 || NEGATED_SELECTION_PATTERN.test(latest)) return []
  const selection = latest.replace(SELECTION_LEAD_PATTERN, '').trim()
  const terms = selection
    .split(' ')
    .filter((term) => term.length >= 3 && !SELECTION_STOP_WORDS.has(term))
  if (terms.length === 0 || terms.length > 3) return []

  const matches = offerings.filter((offering) => {
    const name = normalizeCatalogGuidanceText(offering.display_name)
    return terms.every((term) => containsTerm(name, term))
  })
  return matches.length >= 2 ? matches.slice(0, 3) : []
}

function negatedCatalogTopic(
  messages: readonly string[],
  offerings: readonly CatalogOffering[],
): string | null {
  const match = messages.at(-1)?.match(NEGATED_TOPIC_PATTERN)
  const topic = match?.[1]?.trim() ?? ''
  const terms = topic
    .split(' ')
    .filter((term) => term.length >= 3 && !SELECTION_STOP_WORDS.has(term))
  if (terms.length === 0 || terms.length > 3) return null
  const existsInCatalog = offerings.some((offering) => {
    const name = normalizeCatalogGuidanceText(offering.display_name)
    return terms.every((term) => containsTerm(name, term))
  })
  return existsInCatalog ? topic : null
}

function isGenericCatalogRequest(messages: readonly string[]): boolean {
  return messages.some((message) => (
    GENERIC_CATALOG_WITH_NOUN_PATTERN.test(message)
    || GENERIC_CATALOG_WITHOUT_NOUN_PATTERN.test(
      message.replace(/^(?:hola|buenas|buen dia|buenas tardes|buenas noches)\s+/u, ''),
    )
  ))
}

export function hasGenericCatalogGuidanceIntent(claimed: ClaimedTurn): boolean {
  const messages = claimed.context.batch_messages
    .filter((message) => message.message_type === 'text')
    .map((message) => normalizeCatalogGuidanceText(message.content))
    .filter(Boolean)
  return isGenericCatalogRequest(messages)
}

export function catalogGuidanceForTurn(claimed: ClaimedTurn): CatalogGuidance | null {
  const offerings = catalogOfferings(claimed)
  if (offerings.length === 0) return null
  const messages = claimed.context.batch_messages
    .filter((message) => message.message_type === 'text')
    .map((message) => normalizeCatalogGuidanceText(message.content))
    .filter(Boolean)
  if (messages.length === 0) return null

  const academies = [...new Set(
    offerings
      .map((offering) => offering.academy)
      .filter((academy): academy is string => Boolean(academy)),
  )]
  const excludedTopic = negatedCatalogTopic(messages, offerings)
  if (excludedTopic && academies.length > 0) {
    return {
      kind: 'generic',
      response: `Perfecto, dejamos ${excludedTopic} de lado. Tenemos opciones en ${joinSpanish(academies.map(academyLabel))}. ¿Qué te gustaría aprender?`,
      missingInformation: 'catalog_area',
    }
  }
  const academy = selectedAcademy(messages, academies)
  if (academy) {
    const names = offerings
      .filter((offering) => offering.academy === academy)
      .slice(0, 3)
      .map((offering) => offering.display_name)
    if (names.length > 0) {
      return {
        kind: 'selection',
        response: renderCatalogOptions({ area: academyLabel(academy), names, maxItems: 3 }),
        missingInformation: 'catalog_offering_choice',
      }
    }
  }

  const topicOfferings = selectedTopicOfferings(messages, offerings)
  if (topicOfferings.length > 0) {
    const topic = messages.at(-1)?.replace(SELECTION_LEAD_PATTERN, '').trim() ?? 'esa opción'
    return {
      kind: 'selection',
      response: renderCatalogOptions({
        area: topic,
        names: topicOfferings.map((offering) => offering.display_name),
        maxItems: 3,
      }),
      missingInformation: 'catalog_offering_choice',
    }
  }

  if (!isGenericCatalogRequest(messages) || academies.length === 0) return null
  const labels = academies.map(academyLabel)
  return {
    kind: 'generic',
    response: `Tenemos opciones en ${joinSpanish(labels)}. ¿Qué te gustaría aprender?`,
    missingInformation: 'catalog_area',
  }
}
