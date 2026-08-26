import type { ClaimedTurn, Decision } from '../schemas/contracts'
import {
  renderCourseDuration,
  renderCourseModality,
  renderCoursePrice,
  renderUnknownCertification,
} from './canonical-commercial-copy'
import { derivePaymentChoiceFromBatch } from './payment-choice'

export const PAYMENT_SELECTION_FAST_PATH_MODEL = 'deterministic:payment-selection-fast-path-v1'
export const PAYMENT_COMPARISON_FAST_PATH_MODEL = 'deterministic:payment-comparison-fast-path-v1'
export const CONTACT_CAPTURE_FAST_PATH_MODEL = 'deterministic:contact-capture-fast-path-v1'
export const COURSE_FACTS_FAST_PATH_MODEL = 'deterministic:course-facts-fast-path-v1'
export const COURSE_DISCOVERY_FAST_PATH_MODEL = 'deterministic:course-discovery-fast-path-v1'
export const CONVERSATION_CLOSE_FAST_PATH_MODEL = 'deterministic:conversation-close-fast-path-v1'

const RETRIEVAL_NONE = { kb: false, long_term_memory: false, summary_version: null }
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu

function normalizeCourse(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, ' ')
    .trim()
}

function courseNameFromKnowledgeTitle(title: string): string | null {
  const match = title.match(/^(?:manual\s+studyx|studyx|curso|temario)\s*(?:—|-|:)\s*(.+)$/iu)
  const name = match?.[1]?.trim() ?? ''
  return name.length > 0 && name.length <= 128 ? name : null
}

const GENERIC_COURSE_WORDS = new Set([
  'curso', 'introduccion', 'especialista', 'profesional', 'orientado',
  'diseno', 'interiores', 'integral', 'formacion', 'programa',
])

function uniqueCourseAliasFromHistory(
  normalizedHistory: string,
  canonicalNames: readonly string[],
): string | null {
  const historyTokens = new Set(normalizedHistory.split(' ').filter(Boolean))
  const owners = new Map<string, Set<string>>()
  for (const displayName of canonicalNames) {
    for (const rawToken of displayName.split(/[^\p{L}\p{N}]+/u).filter(Boolean)) {
      const token = normalizeCourse(rawToken)
      if (token.length < 5 || GENERIC_COURSE_WORDS.has(token)) continue
      const current = owners.get(token) ?? new Set<string>()
      current.add(displayName)
      owners.set(token, current)
    }
  }

  const scores = new Map<string, number>()
  for (const sourceToken of historyTokens) {
    if (sourceToken.length < 4 || GENERIC_COURSE_WORDS.has(sourceToken)) continue
    const possibleOwners = new Set<string>()
    for (const [catalogToken, tokenOwners] of owners) {
      const fuzzyMatch = sourceToken === catalogToken
        || (catalogToken.length >= 4
          && (sourceToken.startsWith(catalogToken.slice(0, 4))
            || catalogToken.startsWith(sourceToken.slice(0, 4))))
      if (fuzzyMatch) for (const owner of tokenOwners) possibleOwners.add(owner)
    }
    for (const displayName of possibleOwners) {
      scores.set(displayName, (scores.get(displayName) ?? 0) + 1)
    }
  }
  const ranked = [...scores.entries()].sort((left, right) => right[1] - left[1])
  if (ranked.length === 0 || (ranked[1]?.[1] ?? 0) === ranked[0][1]) return null
  const [winner, winningScore] = ranked[0]
  const hasUniqueExactToken = [...historyTokens].some((token) => {
    const exactOwners = owners.get(token)
    return exactOwners?.size === 1 && exactOwners.has(winner)
  })
  if (winningScore < 2 && !hasUniqueExactToken) return null
  return winner
}

function canonicalCourseFromValue(
  value: string,
  canonicalNames: readonly string[],
): string | null {
  const normalizedValue = normalizeCourse(value)
  const literalMatches = canonicalNames.filter((name) =>
    normalizedValue.includes(normalizeCourse(name)),
  )
  if (literalMatches.length === 1) return literalMatches[0]
  return uniqueCourseAliasFromHistory(normalizedValue, canonicalNames)
}

export interface CourseFactsFastPathMatch {
  readonly decision: Decision
  readonly offeringCode: string | null
}

export function matchCourseFactsFastPathMatch(
  claimed: ClaimedTurn,
): CourseFactsFastPathMatch | null {
  if (!claimed.policy.may_respond || claimed.contact.blocked) return null
  if (!claimed.policy.allowed_response_types.includes('commercial_reply')) return null
  if (claimed.batch.message_count !== 1 || claimed.context.batch_messages.length !== 1) return null
  const message = claimed.context.batch_messages[0]
  if (message.message_type !== 'text') return null

  const normalizedQuestion = normalizeCourse(message.content)
  const asksClasses = /\b(?:cuantas? clases|cantidad de clases|clases (?:tiene|son|incluye))\b/u
    .test(normalizedQuestion)
  const asksRequirements = /\b(?:requisit\w*|necesit\w*|saber antes|experiencia previa|conocimiento previo|software|sin haber usado|nunca (?:use|hice|estudie|trabaje))\b/u
    .test(normalizedQuestion)
  const asksOrientation = /\b(?:especific\w*|generic\w*|orientad\w*)\b/u.test(normalizedQuestion)
  const asksPrice = /\b(?:precio|cuesta|valor|sale)\b/u.test(normalizedQuestion)
  const asksPaymentOptions = /\b(?:(?:como|komo) pago|formas? de pago|opciones? de pago|poca plata)\b/u
    .test(normalizedQuestion)
  const asksRefund = /\b(?:devolucion|reembolso|garantia de reembolso)\b/u.test(normalizedQuestion)
  const asksCertification = /\b(?:certificad\w*|titulo oficial|homolog\w*|entidad)\b/u
    .test(normalizedQuestion)
  const asksSchedule = /\b(?:horarios?|hora fija|cuando quiera|cuando puedo|dias? y horarios?)\b/u
    .test(normalizedQuestion)
  if (!asksClasses && !asksRequirements && !asksOrientation && !asksPrice && !asksPaymentOptions
    && !asksRefund && !asksCertification && !asksSchedule) return null


  const inboundMessages = [
    ...claimed.context.recent_turns
      .filter((turn) => turn.direction === 'inbound')
      .map((turn) => turn.content),
    message.content,
  ].map(normalizeCourse)
  let courseName = claimed.sales_context.course_of_interest
  if (
    courseName
    && claimed.business_context
    && /\b(?:el|la) otr[oa]\b/u.test(normalizedQuestion)
  ) {
    const offeringNames = claimed.business_context.offerings.map((offering) => offering.display_name)
    const normalizedCurrent = normalizeCourse(courseName)
    for (const historicalMessage of inboundMessages.slice(0, -1).reverse()) {
      const named = offeringNames.filter((name) => historicalMessage.includes(normalizeCourse(name)))
      const alternatives = named.filter((name) => normalizeCourse(name) !== normalizedCurrent)
      if (named.length > 1 && alternatives.length === 1) {
        courseName = alternatives[0]
        break
      }
    }
  }
  if (courseName && claimed.business_context) {
    courseName = canonicalCourseFromValue(
      courseName,
      claimed.business_context.offerings.map((offering) => offering.display_name),
    ) ?? courseName
  }
  if (!courseName && claimed.business_context) {
    const offeringNames = claimed.business_context.offerings.map((offering) => offering.display_name)
    for (const historicalMessage of inboundMessages.slice().reverse()) {
      courseName = canonicalCourseFromValue(historicalMessage, offeringNames)
      if (courseName) break
    }
  }
  if (!courseName && claimed.context.knowledge_base_available) {
    const knowledgeNames = claimed.context.knowledge_base
      .map((item) => courseNameFromKnowledgeTitle(item.title))
      .filter((name): name is string => Boolean(name))
    for (const historicalMessage of inboundMessages.slice().reverse()) {
      courseName = canonicalCourseFromValue(historicalMessage, knowledgeNames)
      if (courseName) break
    }
  }
  if (!courseName) return null

  const orientationMatch = courseName.match(/\borientad[oa]\s+(al|a la)\s+(.+)$/iu)
  if (asksOrientation && !orientationMatch) return null

  const normalizedCourseName = normalizeCourse(courseName)
  const offering = claimed.business_context?.offerings.find(
    (candidate) => normalizeCourse(candidate.display_name) === normalizedCourseName,
  )
  let classes = offering?.classes ?? null
  let usedKnowledge = false
  if (classes === null) {
    const knowledge = claimed.context.knowledge_base.find((item) =>
      normalizeCourse(`${item.title} ${item.content}`).includes(normalizedCourseName),
    )
    const match = knowledge?.content.match(/\b(\d{1,3})\s+clases\b/iu)
    if (match) {
      classes = Number(match[1])
      usedKnowledge = true
    }
  }
  if (asksClasses && (!Number.isSafeInteger(classes) || classes! <= 0 || classes! > 999)) return null
  if (asksPrice && (
    !claimed.business_context?.prices_assertable
    || !offering?.price_assertable
    || !offering.price
  )) return null

  const requestedFacts = [
    asksClasses ? renderCourseDuration({ displayName: courseName, classes: classes! }) : null,
    asksRequirements
      ? `Los requisitos previos para ${courseName} no están especificados en la información disponible.`
      : null,
    asksOrientation
      ? `Sí: el curso está orientado específicamente ${orientationMatch![1]} ${orientationMatch![2]}.`
      : null,
    asksPrice
      ? renderCoursePrice({
          displayName: courseName,
          currency: offering!.price!.currency,
          amount: offering!.price!.amount,
        })
      : null,
    asksPaymentOptions ? 'Podés elegir 12 cuotas, 6 cuotas o un pago único.' : null,
    asksRefund
      ? `La política de devolución o reembolso para ${courseName} no está especificada en la información disponible.`
      : null,
    asksCertification
      ? renderUnknownCertification({ displayName: courseName })
      : null,
    asksSchedule
      ? (offering?.schedules.length
          ? `Los horarios publicados para ${courseName} son ${offering.schedules.map((item) => `${item.days.join('/')} ${item.start ?? ''}-${item.end ?? ''}`.trim()).join(', ')}.`
          : `Los horarios fijos y la disponibilidad libre para ${courseName} no están especificados en la información disponible.`)
      : null,
  ].filter((fact): fact is string => fact !== null).slice(0, 2)
  const cta = asksPrice
    ? '¿Preferís 12 cuotas, 6 cuotas o un pago único?'
    : asksPaymentOptions
      ? '¿Cuál te conviene más?'
      : '¿Querés que revisemos otro dato?'
  return {
    offeringCode: offering?.code ?? null,
    decision: {
      schema_version: 4,
      intent: 'commercial',
      kind: 'reply',
      response: `${requestedFacts.join(' ')} ${cta}`,
      response_type: 'commercial_reply',
      confidence: 1,
      reason_code: 'DETERMINISTIC_COURSE_FACTS',
      business_action: null,
      memory_candidates: [],
      missing_information: [],
      next_state: 'waiting_user',
      retrieval_used: {
        kb: usedKnowledge,
        long_term_memory: Boolean(claimed.sales_context.course_of_interest),
        summary_version: null,
      },
    },
  }
}

export function matchCourseFactsFastPath(claimed: ClaimedTurn): Decision | null {
  return matchCourseFactsFastPathMatch(claimed)?.decision ?? null
}

export interface CourseDiscoveryFastPathMatch {
  readonly decision: Decision
  readonly offeringCode: string
}

export function matchCourseDiscoveryFastPathMatch(
  claimed: ClaimedTurn,
): CourseDiscoveryFastPathMatch | null {
  if (!claimed.policy.may_respond || claimed.contact.blocked) return null
  if (claimed.batch.message_count !== 1 || claimed.context.batch_messages.length !== 1) return null
  if (!claimed.business_context_available || !claimed.business_context) return null
  const message = claimed.context.batch_messages[0]
  if (message.message_type !== 'text') return null

  const offeringNames = claimed.business_context.offerings.map((offering) => offering.display_name)
  const canonicalName = canonicalCourseFromValue(message.content, offeringNames)
  if (!canonicalName) return null
  const offering = claimed.business_context.offerings.find(
    (candidate) => candidate.display_name === canonicalName,
  )
  if (!offering) return null

  const facts = [
    Number.isSafeInteger(offering.classes) && offering.classes! > 0
      ? renderCourseDuration({ displayName: canonicalName, classes: offering.classes! })
      : null,
    offering.modality
      ? renderCourseModality({ displayName: canonicalName, modality: offering.modality })
      : null,
    offering.price_assertable && offering.price
      ? renderCoursePrice({
          displayName: canonicalName,
          currency: offering.price.currency,
          amount: offering.price.amount,
        })
      : null,
  ].filter((fact): fact is string => Boolean(fact)).slice(0, 2)
  const details = facts.length > 0 ? ` ${facts.join(' ')}` : ''
  const mayOfferCall = claimed.sales_context.allowed_actions.includes('offer_call')
    && !/\b(?:no (?:me gustan?|quiero|puedo) las? llamadas?|prefiero (?:texto|chat)|seguimos? por (?:aca|aqui|chat))\b/u
      .test(normalizeCourse(message.content))
  const response = mayOfferCall
    ? `Te cuento sobre ${canonicalName}.${details} Si querés, podemos coordinar una llamada ahora con nuestra asesora virtual; si preferís, seguimos por chat. ¿Cómo querés avanzar?`
    : `Te cuento sobre ${canonicalName}.${details} ¿Qué te gustaría saber?`

  return {
    offeringCode: offering.code,
    decision: {
      schema_version: 4,
      intent: 'commercial',
      kind: 'reply',
      response,
      response_type: mayOfferCall ? 'call_offer' : 'commercial_reply',
      confidence: 1,
      reason_code: 'DETERMINISTIC_COURSE_DISCOVERY',
      business_action: null,
      memory_candidates: [],
      missing_information: [],
      next_state: 'waiting_user',
      retrieval_used: RETRIEVAL_NONE,
    },
  }
}

export function matchCourseDiscoveryFastPath(claimed: ClaimedTurn): Decision | null {
  return matchCourseDiscoveryFastPathMatch(claimed)?.decision ?? null
}

export function matchConversationCloseFastPath(claimed: ClaimedTurn): Decision | null {
  if (!claimed.policy.may_respond || claimed.contact.blocked) return null
  if (!claimed.policy.allowed_response_types.includes('commercial_reply')) return null
  if (claimed.batch.message_count !== 1 || claimed.context.batch_messages.length !== 1) return null
  const message = claimed.context.batch_messages[0]
  if (message.message_type !== 'text') return null
  const normalized = normalizeCourse(message.content)
  const isDeferredClose = /\b(?:lo voy a pensar|no me voy a anotar|averiguar nomas|por ahora no|lo voy a consultar|despues me anoto|dejame pensarlo|quiero pensarlo)\b/u
    .test(normalized)
  const isCallDecline = /\b(?:(?:cancela|cancelo|cancelar|no|mejor)\b.{0,30}\bllamada|seguimos? por (?:aca|aqui|chat))\b/u
    .test(normalized)
  const asksAboutCourse = (
    /[?¿]/u.test(message.content)
    && /\b(?:curso|diplomado|clases|requisit\w*|precio|pago|devolucion|certificad\w*|horarios?|modalidad)\b/u.test(normalized)
  ) || /\b(?:que|cuales|cuantas|cuantos|como|cuando)\b.{0,60}\b(?:curso|diplomado|clases|requisit\w*|precio|pago|devolucion|certificad\w*|horarios?|modalidad)\b/u
    .test(normalized)
  if (!isDeferredClose && !isCallDecline) return null
  if (isCallDecline && asksAboutCourse) return null

  return {
    schema_version: 4,
    intent: 'commercial_decline',
    kind: 'reply',
    response: isCallDecline
      ? 'Entendido, no avanzamos con la llamada y seguimos por chat. ¿Qué te gustaría saber?'
      : 'Entendido. Cuando quieras retomarlo o tengas otra duda, seguimos por acá.',
    response_type: 'commercial_reply',
    confidence: 1,
    reason_code: 'DETERMINISTIC_DEFERRED_CLOSE',
    business_action: null,
    memory_candidates: [],
    missing_information: [],
    next_state: 'completed',
    retrieval_used: RETRIEVAL_NONE,
  }
}

export function matchPaymentSelectionFastPath(claimed: ClaimedTurn): Decision | null {
  if (!claimed.policy.may_respond || claimed.contact.blocked) return null
  if (!claimed.policy.allowed_response_types.includes('commercial_reply')) return null
  if (claimed.batch.message_count !== 1 || claimed.context.batch_messages.length !== 1) return null
  if (!claimed.business_context_available || !claimed.business_context?.prices_assertable) return null

  const planCode = derivePaymentChoiceFromBatch(
    claimed.context.batch_messages.map((message) => ({ content: message.content })),
  )
  if (!planCode) return null
  if (!claimed.business_context.workspace.payment_options.some((option) => option.code === planCode)) {
    return null
  }
  const selectedCourse = claimed.sales_context.course_of_interest
  const selectedOfferingCode = claimed.sales_context.offering_code
  const canonicalSelectedCourse = selectedCourse
    ? canonicalCourseFromValue(
        selectedCourse,
        claimed.business_context.offerings.map((offering) => offering.display_name),
      )
    : null
  const offeringByCode = selectedOfferingCode
    ? claimed.business_context.offerings.find((offering) => (
        offering.code === selectedOfferingCode
        && (!selectedCourse
          || normalizeCourse(offering.display_name) === normalizeCourse(selectedCourse))
      )) ?? null
    : null
  const offeringsByName = canonicalSelectedCourse
    ? claimed.business_context.offerings.filter(
        (offering) => normalizeCourse(offering.display_name) === normalizeCourse(canonicalSelectedCourse),
      )
    : []
  const offeringSku = offeringByCode?.code
    ?? (offeringsByName.length === 1 ? offeringsByName[0].code : null)

  const label = planCode === 'monthly_12'
    ? '12 cuotas mensuales'
    : planCode === 'monthly_6'
      ? '6 cuotas mensuales'
      : 'un pago único'
  return {
    schema_version: 4,
    intent: 'commercial',
    kind: 'reply',
    response: `Perfecto, elegiste ${label}. Te comparto el link seguro para continuar.`,
    response_type: 'commercial_reply',
    confidence: 1,
    reason_code: 'DETERMINISTIC_PAYMENT_SELECTION',
    business_action: {
      type: 'send_payment_link',
      plan_code: planCode,
      offering_sku: offeringSku,
    },
    memory_candidates: [],
    missing_information: [],
    next_state: 'completed',
    retrieval_used: RETRIEVAL_NONE,
  }
}

export function matchPaymentComparisonFastPath(claimed: ClaimedTurn): Decision | null {
  if (!claimed.policy.may_respond || claimed.contact.blocked) return null
  if (!claimed.policy.allowed_response_types.includes('commercial_reply')) return null
  if (claimed.batch.message_count !== 1 || claimed.context.batch_messages.length !== 1) return null
  if (!claimed.business_context_available || !claimed.business_context) return null
  const message = claimed.context.batch_messages[0]
  if (message.message_type !== 'text') return null

  const availablePlans = new Set(
    claimed.business_context.workspace.payment_options.map((option) => option.code),
  )
  if (!availablePlans.has('monthly_12') || !availablePlans.has('monthly_6')) return null

  const normalized = normalizeCourse(message.content)
  const asksOneTimeAdvantage = (
    /\b(?:pago de una|una sola vez|pago unico)\b/u.test(normalized)
    && /\b(?:ventaja|beneficio|conviene)\b/u.test(normalized)
  )
  if (asksOneTimeAdvantage) {
    if (!availablePlans.has('one_time')) return null
    return {
      schema_version: 4,
      intent: 'commercial',
      kind: 'reply',
      response: 'No tengo confirmada una ventaja adicional por pagar de una; lo que cambia es la forma de pago. Podés elegir pago único, 6 cuotas o 12 cuotas. ¿Con cuál querés avanzar?',
      response_type: 'commercial_reply',
      confidence: 1,
      reason_code: 'DETERMINISTIC_PAYMENT_COMPARISON',
      business_action: null,
      memory_candidates: [],
      missing_information: [],
      next_state: 'waiting_user',
      retrieval_used: RETRIEVAL_NONE,
    }
  }
  const comparesShortAndLong = (
    /\bplan corto\b.{0,80}\bplan largo\b/u.test(normalized)
    || /\bplan largo\b.{0,80}\bplan corto\b/u.test(normalized)
    || /\b(?:6|seis)\b.{0,80}\b(?:12|doce)\b/u.test(normalized)
    || /\b(?:12|doce)\b.{0,80}\b(?:6|seis)\b/u.test(normalized)
  )
  const asksComparison = /\b(?:diferencia|comparar|comparacion|cambia|conviene)\b/u.test(normalized)
  if (!comparesShortAndLong || !asksComparison) return null

  return {
    schema_version: 4,
    intent: 'commercial',
    kind: 'reply',
    response: 'El plan largo reparte el total en más cuotas y deja una cuota mensual más baja; el corto lo concentra en menos cuotas. ¿Cuál preferís?',
    response_type: 'commercial_reply',
    confidence: 1,
    reason_code: 'DETERMINISTIC_PAYMENT_COMPARISON',
    business_action: null,
    memory_candidates: [],
    missing_information: [],
    next_state: 'waiting_user',
    retrieval_used: RETRIEVAL_NONE,
  }
}

export function matchContactCaptureFastPath(claimed: ClaimedTurn): Decision | null {
  if (!claimed.policy.may_respond || claimed.contact.blocked) return null
  if (!claimed.policy.allowed_response_types.includes('commercial_reply')) return null
  if (claimed.batch.message_count !== 1 || claimed.context.batch_messages.length !== 1) return null
  if (!claimed.contact.name) return null

  const message = claimed.context.batch_messages[0]
  if (message.message_type !== 'text') return null
  if (!EMAIL.test(message.content)) return null

  return {
    schema_version: 4,
    intent: 'commercial',
    kind: 'reply',
    response: 'Perfecto, ya tengo tus datos. Si querés, seguimos por acá con cualquier duda.',
    response_type: 'commercial_reply',
    confidence: 1,
    reason_code: 'DETERMINISTIC_CONTACT_CAPTURE',
    business_action: null,
    memory_candidates: [],
    missing_information: [],
    next_state: 'waiting_user',
    retrieval_used: RETRIEVAL_NONE,
  }
}
