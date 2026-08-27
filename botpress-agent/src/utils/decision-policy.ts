import type { ClaimedTurn, Decision } from '../schemas/contracts'
import {
  derivePaymentChoiceFromBatch,
  isExplicitPaymentLinkRequest,
} from './payment-choice'
import {
  catalogGuidanceForTurn,
  normalizeCatalogGuidanceText,
} from './catalog-guidance'

/**
 * Post-model policy: normalization plus the deterministic guardrails a raw
 * model (or fast-path) decision must pass before it may ever be committed.
 *
 * Provider-independent by construction — it consumes only `Decision` and
 * `ClaimedTurn`, never anything provider-specific — so every decision
 * provider (the Botpress-managed model call today, a direct Gemini provider
 * tomorrow) passes through this exact same gate via a single call site in
 * `workflows/processInboundTurn.ts`.
 */

export function suppress(reasonCode: string): Decision {
  return {
    schema_version: 3,
    intent: 'unknown',
    kind: 'suppress',
    response: null,
    response_type: null,
    business_action: null,
    memory_candidates: [],
    missing_information: [],
    next_state: 'completed',
    reason_code: reasonCode,
    confidence: 1,
    retrieval_used: null,
  }
}

export function technicalFallback(): Decision {
  return {
    schema_version: 3,
    intent: 'unknown',
    kind: 'reply',
    response: 'No pude procesar tu consulta en este momento. Por favor, intentá nuevamente más tarde.',
    response_type: 'technical_fallback',
    business_action: null,
    memory_candidates: [],
    missing_information: [],
    next_state: 'completed',
    reason_code: 'MODEL_UNAVAILABLE',
    confidence: 1,
    retrieval_used: null,
  }
}

export function modelUnavailableFallback(claimed: ClaimedTurn): Decision {
  const allowed = claimed.policy.allowed_response_types
  if (!allowed.includes('commercial_reply')) return technicalFallback()
  const guidance = catalogGuidanceForTurn(claimed)
  const course = claimed.sales_context.course_of_interest?.trim()
  const latest = normalizeCatalogGuidanceText(
    claimed.context.batch_messages.at(-1)?.content ?? '',
  )
  const response = guidance?.response
    ?? (/\b(?:prefiero|quiero|sigamos|seguir|continuar)\b.{0,32}\b(?:chat|texto|sin llamada|no quiero llamada)\b/u.test(latest)
      ? 'Seguimos por chat, sin problema. ¿Con qué parte de la compra querés avanzar?'
      : /\b(?:cuanto\s+(?:sale|cuesta)|precio|costo|valor)\b/u.test(latest)
        ? course
          ? `Sigo con ${course}. ¿Querés que confirme el precio y los planes disponibles?`
          : 'Puedo confirmar el precio canónico. ¿De qué curso querés saberlo?'
      : /\b(?:caro|cara|presupuesto|conviene)\b/u.test(latest)
        ? 'Puedo ayudarte a ordenar la consulta según tu presupuesto. ¿Qué te preocupa del precio?'
        : course
          ? `Sigo con ${course}. ¿Qué aspecto querés confirmar?`
          : 'Puedo seguir ayudándote por acá. ¿Podés contarme la consulta en una frase?')
  return {
    schema_version: 4,
    intent: 'commercial',
    kind: 'reply',
    response,
    response_type: 'commercial_reply',
    business_action: null,
    memory_candidates: [],
    missing_information: [],
    next_state: 'waiting_user',
    reason_code: 'MODEL_UNAVAILABLE',
    confidence: 1,
    retrieval_used: null,
  }
}

function allowedTextFallback(claimed: ClaimedTurn, reasonCode: string): Decision {
  const allowed = claimed.policy.allowed_response_types
  const responseType = allowed.includes('technical_fallback')
    ? 'technical_fallback'
    : allowed.includes('commercial_reply')
      ? 'commercial_reply'
      : null

  if (!responseType) return suppress(reasonCode)

  return {
    schema_version: 3,
    intent: 'unknown',
    kind: 'reply',
    response: 'No pude completar esa respuesta. ¿Podés reformularme la consulta?',
    response_type: responseType,
    business_action: null,
    memory_candidates: [],
    missing_information: [],
    next_state: 'waiting_user',
    reason_code: reasonCode,
    confidence: 1,
    retrieval_used: null,
  }
}

function advisorySensitiveFallback(
  claimed: ClaimedTurn,
  action: 'request_call_now' | 'send_payment_link',
): Decision {
  const allowed = claimed.policy.allowed_response_types
  const responseType = allowed.includes('clarification')
    ? 'clarification'
    : allowed.includes('commercial_reply')
      ? 'commercial_reply'
      : null
  if (!responseType) return suppress('MODEL_ADVISORY_ONLY')

  return {
    schema_version: 4,
    intent: 'commercial',
    kind: responseType === 'clarification' ? 'clarify' : 'reply',
    response: action === 'send_payment_link'
      ? 'Para enviarte el enlace correcto, confirmame qué curso y cuál de las tres opciones de pago elegís.'
      : 'Puedo seguir asesorándote por acá. Si querés que gestionemos una llamada, pedímela de forma directa.',
    response_type: responseType,
    business_action: null,
    memory_candidates: [],
    missing_information: responseType === 'clarification'
      ? [action === 'send_payment_link' ? 'payment_authorization' : 'call_authorization']
      : [],
    next_state: 'waiting_user',
    reason_code: 'MODEL_ADVISORY_ONLY',
    confidence: 1,
    retrieval_used: null,
  }
}

/**
 * A language model may interpret and phrase a turn, but it never owns side
 * effects or commercial state. Deterministic routes are the only source of
 * executable actions. Sensitive model proposals are replaced with a useful
 * clarification; internal proposals are retained only as text and stripped.
 */
export function constrainModelToAdvisory(
  decision: Decision,
  claimed: ClaimedTurn,
): Decision {
  const action = decision.business_action
  if (action?.type === 'request_call_now' || action?.type === 'send_payment_link') {
    return advisorySensitiveFallback(claimed, action.type)
  }
  if (decision.response_type === 'call_offer' || decision.response_type === 'call_confirmation') {
    return advisorySensitiveFallback(claimed, 'request_call_now')
  }
  if (action === null) return decision
  return {
    ...decision,
    business_action: null,
    reason_code: 'MODEL_ADVISORY_ONLY',
  }
}

/**
 * Deterministic downgrade for a `send_payment_link` the current batch cannot
 * authorize. Uses only the three canonical plan families by name (no amounts:
 * amounts must come from the snapshot, and this text is static by design).
 */
function paymentPlanClarification(claimed: ClaimedTurn, reasonCode: string): Decision {
  const allowed = claimed.policy.allowed_response_types
  if (!allowed.includes('clarification')) return allowedTextFallback(claimed, reasonCode)
  return {
    schema_version: 4,
    intent: 'commercial',
    kind: 'clarify',
    response:
      'Para enviarte el link de pago necesito que me confirmes cuál de las tres opciones preferís: 12 cuotas mensuales, 6 cuotas mensuales o un pago único. ¿Con cuál avanzamos?',
    response_type: 'clarification',
    business_action: null,
    memory_candidates: [],
    missing_information: ['payment_plan_choice'],
    next_state: 'waiting_user',
    reason_code: reasonCode,
    confidence: 1,
    retrieval_used: null,
  }
}

function paymentCourseClarification(claimed: ClaimedTurn): Decision {
  const reasonCode = 'OFFERING_REQUIRED'
  const allowed = claimed.policy.allowed_response_types
  if (!allowed.includes('clarification')) return allowedTextFallback(claimed, reasonCode)
  return {
    schema_version: 4,
    intent: 'commercial',
    kind: 'clarify',
    response: 'Antes de enviarte el link, confirmame por favor qué curso querés comprar.',
    response_type: 'clarification',
    business_action: null,
    memory_candidates: [],
    missing_information: ['course_of_interest'],
    next_state: 'waiting_user',
    reason_code: reasonCode,
    confidence: 1,
    retrieval_used: null,
  }
}

// Two tiers on purpose: multi-word salutations (buen día, buenas tardes…)
// are unambiguous and may be followed by anything, but the bare one-word
// forms (hola, buenas) only count as a salutation when punctuation follows.
// A bare `buenas\s+` would eat the first word of legitimate replies like
// "Buenas noticias, el diplomado…" → "noticias, el diplomado…".
const LEADING_GREETING =
  /^(?:[¡¿\s]*)?(?:(?:buen\s+d[ií]a|buenas\s+tardes|buenas\s+noches)(?:\s*[,!:.—-]\s*|\s+)|(?:hola|buenas)\s*[,!:.—-]\s*)/iu

function withoutRepeatedGreeting(response: string, claimed: ClaimedTurn): string {
  if (claimed.context.recent_turns.length === 0) return response
  const continuation = response.replace(LEADING_GREETING, '').trim()
  return continuation.length > 0 ? continuation : response
}

function normalizeCatalogText(value: string): string {
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

const GENERIC_COURSE_WORDS = new Set([
  'curso', 'introduccion', 'especialista', 'profesional', 'orientado',
  'diseno', 'interiores', 'integral', 'formacion', 'programa',
])

function uniqueCourseAliasMatch(
  sourceText: string,
  canonicalNames: readonly string[],
): { displayName: string; sourceQuote: string } | null {
  const owners = new Map<string, Set<string>>()
  for (const displayName of canonicalNames) {
    for (const rawToken of displayName.split(/[^\p{L}\p{N}]+/u).filter(Boolean)) {
      const token = normalizeCatalogText(rawToken)
      if (token.length < 5 || GENERIC_COURSE_WORDS.has(token)) continue
      const current = owners.get(token) ?? new Set<string>()
      current.add(displayName)
      owners.set(token, current)
    }
  }
  const sourceTokens = [...sourceText.matchAll(/[\p{L}\p{N}]+/gu)].map((match) => ({
    raw: match[0],
    normalized: normalizeCatalogText(match[0]),
    start: match.index,
    end: match.index + match[0].length,
  }))
  const scores = new Map<string, number>()
  const matchesByOwner = new Map<string, typeof sourceTokens>()
  for (const source of sourceTokens) {
    const sourceToken = source.normalized
    if (sourceToken.length < 4 || GENERIC_COURSE_WORDS.has(sourceToken)) continue
    const possibleOwners = new Set<string>()
    for (const [catalogToken, tokenOwners] of owners) {
      const fuzzyMatch = sourceToken === catalogToken
        || (sourceToken.length >= 4 && catalogToken.length >= 4
          && (sourceToken.startsWith(catalogToken.slice(0, 4))
            || catalogToken.startsWith(sourceToken.slice(0, 4))))
      if (fuzzyMatch) for (const owner of tokenOwners) possibleOwners.add(owner)
    }
    for (const displayName of possibleOwners) {
      scores.set(displayName, (scores.get(displayName) ?? 0) + 1)
      matchesByOwner.set(displayName, [...(matchesByOwner.get(displayName) ?? []), source])
    }
  }
  const ranked = [...scores.entries()].sort((left, right) => right[1] - left[1])
  if (ranked.length === 0 || (ranked[1]?.[1] ?? 0) === ranked[0][1]) return null
  const [displayName, winningScore] = ranked[0]
  const hasUniqueExactToken = sourceTokens.some((source) => {
    const exactOwners = owners.get(source.normalized)
    return exactOwners?.size === 1 && exactOwners.has(displayName)
  })
  if (winningScore < 2 && !hasUniqueExactToken) return null
  const matchingTokens = matchesByOwner.get(displayName) ?? []
  if (matchingTokens.length === 0) return null
  const first = matchingTokens[0]
  const last = matchingTokens[matchingTokens.length - 1]
  const sourceQuote = sourceText.slice(first.start, last.end)
  return { displayName, sourceQuote }
}

function withDeterministicCourseMemory(decision: Decision, claimed: ClaimedTurn): Decision {
  // An opt-out acknowledgement may never create or refresh commercial
  // memory, even when the same batch names a course before asking to stop.
  if (decision.intent === 'opt_out') return decision

  const canonicalCourseNames = [
    ...(claimed.business_context?.offerings.map((offering) => offering.display_name) ?? []),
    ...claimed.context.knowledge_base
      .map((item) => courseNameFromKnowledgeTitle(item.title))
      .filter((name): name is string => Boolean(name)),
  ]
  const distinctCanonicalNames = [...new Set(canonicalCourseNames)]
  if (distinctCanonicalNames.length === 0) return decision
  const matches: Array<{ displayName: string; sourceQuote: string; sourceText: string }> = []
  const nonSelectionExperienceContext =
    /\b(?:nunca|sin)\b.{0,40}\b(?:trabaje|experiencia|use|hice|estudie|vendi)\w*\b/u
  for (const message of claimed.context.batch_messages) {
    if (message.message_type !== 'text') continue
    const normalizedMessage = normalizeCatalogText(message.content)
    let literalMatches = 0
    for (const displayName of distinctCanonicalNames) {
      const normalizedName = normalizeCatalogText(displayName)
      if (normalizedName.length > 0 && normalizedMessage.includes(normalizedName)) {
        const literalCourseName = message.content.match(
          new RegExp(escapeRegExp(displayName), 'iu'),
        )?.[0]
        if (literalCourseName) {
          matches.push({ displayName, sourceQuote: literalCourseName, sourceText: message.content })
          literalMatches += 1
        }
      }
    }
    if (literalMatches === 0 && !nonSelectionExperienceContext.test(normalizedMessage)) {
      const alias = uniqueCourseAliasMatch(message.content, distinctCanonicalNames)
      if (alias) matches.push({ ...alias, sourceText: message.content })
    }
  }
  const distinct = [...new Map(matches.map((match) => [match.displayName, match])).values()]
  if (distinct.length !== 1) return decision
  const selected = distinct[0]
  const normalizedSource = normalizeCatalogText(selected.sourceText)
  if (/\b(?:ya )?no me (?:interesa|sirve|quiero)\b/u.test(normalizedSource)) return decision

  return {
    ...decision,
    memory_candidates: [
      ...decision.memory_candidates.filter(
        (candidate) => !(
          candidate.type === 'study_goal'
          && (
            candidate.key === 'course_interest'
            || candidate.key === 'course_of_interest'
            || candidate.key === 'course_enrollment'
            || candidate.key === 'target_course'
          )
        ),
      ),
      {
        type: 'study_goal',
        key: 'target_course',
        value: selected.sourceQuote,
        source_quote: selected.sourceQuote,
        confidence: 1,
      },
    ],
  }
}

type LiteralMemoryCandidate = Decision['memory_candidates'][number]

const LITERAL_PERSONAL_MEMORY_PATTERNS: ReadonlyArray<{
  readonly type: LiteralMemoryCandidate['type']
  readonly key: string
  readonly pattern: RegExp
}> = [
  {
    type: 'constraint',
    key: 'schedule_constraint',
    pattern: /\b(turnos?\s+rotativos?\s+y\s+s[oó]lo\s+puedo\s+estudiar\s+de\s+noche)\b/iu,
  },
  {
    type: 'constraint',
    key: 'budget_constraint',
    pattern: /\b(presupuesto\s+muy\s+ajustado)\b/iu,
  },
  {
    type: 'contact_preference',
    key: 'preferred_contact_channel',
    pattern: /\b(prefiero\s+seguir\s+por\s+texto\s+y\s+sin\s+llamadas)\b/iu,
  },
  {
    type: 'objection',
    key: 'experience_concern',
    pattern: /\b((?:no\s+tener|sin)\s+experiencia\s+previa)\b/iu,
  },
]

/**
 * Clear, literal customer facts must survive deterministic commercial routes
 * and model timeouts. This only proposes grounded memory candidates; the
 * backend still applies the structural/sensitive-data admission policy before
 * anything reaches selected_memories.
 */
function withLiteralPersonalMemories(decision: Decision, claimed: ClaimedTurn): Decision {
  if (decision.intent === 'opt_out') return decision
  const derived: LiteralMemoryCandidate[] = []
  for (const message of claimed.context.batch_messages) {
    if (message.message_type !== 'text') continue
    for (const rule of LITERAL_PERSONAL_MEMORY_PATTERNS) {
      const sourceQuote = message.content.match(rule.pattern)?.[1]?.trim()
      if (!sourceQuote) continue
      derived.push({
        type: rule.type,
        key: rule.key,
        value: sourceQuote,
        source_quote: sourceQuote,
        confidence: 1,
      })
    }
  }
  if (derived.length === 0) return decision
  const merged = new Map<string, LiteralMemoryCandidate>()
  for (const candidate of [...decision.memory_candidates, ...derived]) {
    merged.set(`${candidate.type}:${candidate.key}:${normalizeCatalogText(candidate.value)}`, candidate)
  }
  return { ...decision, memory_candidates: [...merged.values()].slice(0, 10) }
}

function withDeterministicMemories(decision: Decision, claimed: ClaimedTurn): Decision {
  return withLiteralPersonalMemories(withDeterministicCourseMemory(decision, claimed), claimed)
}

function canonicalPaymentOfferingCode(claimed: ClaimedTurn): string | null {
  const offerings = claimed.business_context?.offerings ?? []
  if (offerings.length === 0) return null

  const resolution = claimed.catalog_resolution
  if (resolution.kind === 'exact') {
    const resolved = offerings.find((offering) => (
      offering.code === resolution.offeringCode
      && normalizeCatalogText(offering.display_name)
        === normalizeCatalogText(resolution.displayName)
    ))
    return resolved?.code ?? null
  }

  if (resolution.kind !== 'no_catalog_intent') return null
  const rememberedCourse = claimed.sales_context.course_of_interest
  const rememberedOfferingCode = claimed.sales_context.offering_code
  if (rememberedOfferingCode) {
    const rememberedOffering = offerings.find((offering) => (
      offering.code === rememberedOfferingCode
      && (!rememberedCourse
        || normalizeCatalogText(offering.display_name) === normalizeCatalogText(rememberedCourse))
    ))
    if (rememberedOffering) return rememberedOffering.code
  }
  if (!rememberedCourse) return null
  const normalizedCourse = normalizeCatalogText(rememberedCourse)
  const matches = offerings.filter(
    (offering) => normalizeCatalogText(offering.display_name) === normalizedCourse,
  )
  return matches.length === 1 ? matches[0].code : null
}

/**
 * Local validation, run before the decision ever leaves this process. Next.js
 * re-validates all of it and holds final authority; doing it here as well is
 * what keeps a bad decision from consuming a turn and a network round trip.
 */
export function applyDecisionPolicy(decision: Decision, claimed: ClaimedTurn): Decision {
  if (decision.kind === 'suppress') return suppress(decision.reason_code)

  if (!decision.response || !decision.response_type) {
    return allowedTextFallback(claimed, 'INVALID_DECISION_SHAPE')
  }
  const response = decision.response

  const standardResponseAllowed = (claimed.policy.allowed_response_types as string[])
    .includes(decision.response_type)
  const callResponseAllowed =
    (decision.response_type === 'call_offer'
      && claimed.sales_context.allowed_actions.includes('offer_call'))
    || (decision.response_type === 'call_confirmation'
      && claimed.sales_context.allowed_actions.includes('request_call_now'))

  if (!standardResponseAllowed && !callResponseAllowed) {
    return allowedTextFallback(claimed, 'RESPONSE_TYPE_NOT_ALLOWED')
  }

  // Local mirror of the backend's payment-choice rule (spec §4.1): a
  // send_payment_link whose CURRENT batch does not deterministically name
  // exactly the same plan would be refused by Next.js with a 422 and leave
  // the customer in silence. Downgrade it here to an explicit clarification:
  // no link goes out, but the turn always answers (P0, informe 2026-08-23).
  if (decision.business_action?.type === 'send_payment_link') {
    const batchMessages = claimed.context.batch_messages.map((message) => ({ content: message.content }))
    const currentPlan = derivePaymentChoiceFromBatch(batchMessages)
    const authorizedPlan = currentPlan
      ?? (isExplicitPaymentLinkRequest(batchMessages)
        ? claimed.sales_context.selected_payment_plan
        : null)
    if (authorizedPlan !== decision.business_action.plan_code) {
      return withDeterministicMemories(paymentPlanClarification(
        claimed,
        authorizedPlan === null ? 'AMBIGUOUS_OR_ABSENT_CHOICE' : 'PLAN_MISMATCH'
      ), claimed)
    }

    const offeringCode = canonicalPaymentOfferingCode(claimed)
    if (!offeringCode) {
      return withDeterministicMemories(paymentCourseClarification(claimed), claimed)
    }
    decision = {
      ...decision,
      business_action: {
        ...decision.business_action,
        offering_sku: offeringCode,
      },
    }
  }

  return withDeterministicMemories({
    ...decision,
    response: withoutRepeatedGreeting(response, claimed),
  }, claimed)
}
