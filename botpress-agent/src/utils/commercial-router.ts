import type { ClaimedTurn, Decision } from '../schemas/contracts'
import { renderCatalogOptions } from './canonical-commercial-copy'
import {
  CALL_HANDOFF_FAST_PATH_MODEL,
  matchCallHandoffFastPath,
} from './call-handoff-fast-path'
import { suppress } from './decision-policy'
import {
  GREETING_FAST_PATH_MODEL,
  matchDeterministicGreeting,
} from './greeting'
import {
  PAYMENT_SELECTION_FAST_PATH_MODEL,
  matchPaymentSelectionFastPath,
} from './transaction-fast-path'

export type SuppressedCommercialRouteOrigin =
  | 'automation_disabled'
  | 'contact_blocked'
  | 'opt_out'
  | 'turn_policy'
  | CatalogCommercialRouteOrigin

export type DeterministicCommercialRouteOrigin =
  | 'opt_out_ack'
  | 'call_handoff'
  | 'payment_selection'
  | 'greeting'
  | CatalogCommercialRouteOrigin

export type CatalogCommercialRouteOrigin =
  | 'catalog_navigation'
  | 'catalog_ambiguous'
  | 'catalog_not_found'
  | 'catalog_unavailable'

export type CatalogRouteReason =
  | 'DETERMINISTIC_CATALOG_NAVIGATION'
  | 'DETERMINISTIC_CATALOG_AMBIGUOUS'
  | 'DETERMINISTIC_CATALOG_NOT_FOUND'
  | 'DETERMINISTIC_CATALOG_ALTERNATIVES'
  | 'CATALOG_CANDIDATES_UNAVAILABLE'
  | 'CATALOG_SNAPSHOT_MISSING'
  | 'CATALOG_SNAPSHOT_TRUNCATED'
  | 'CATALOG_SNAPSHOT_INVALID'
  | 'CATALOG_RESPONSE_NOT_ALLOWED'

export const CATALOG_RESOLUTION_FAST_PATH_MODEL =
  'deterministic:catalog-resolution-v1'

export const OPT_OUT_ACK_FAST_PATH_MODEL = 'deterministic:opt-out-ack-v1'

export type CommercialRouteOrigin =
  | SuppressedCommercialRouteOrigin
  | DeterministicCommercialRouteOrigin
  | 'advisory_model'

export type ModelRequiredReason =
  | 'MULTI_MESSAGE_BATCH'
  | 'NEGATIVE_SIGNAL_REQUIRES_MODEL'
  | 'OPEN_CATALOG_REQUIRES_SALES_MODEL'
  | 'ADVISORY_REQUIRES_SALES_MODEL'
  | 'COURSE_FACT_REQUIRES_SALES_MODEL'
  | 'OBJECTION_REQUIRES_SALES_MODEL'
  | 'CALL_DECLINE_REQUIRES_SALES_MODEL'
  | 'NO_DETERMINISTIC_MATCH'

export type CommercialRouteResult =
  | {
      readonly kind: 'deterministic'
      readonly origin: DeterministicCommercialRouteOrigin
      readonly reason: string
      readonly model: string
      readonly decision: Decision
      readonly authorizedOfferingCode?: string
    }
  | {
      readonly kind: 'model_required'
      readonly origin: 'advisory_model'
      readonly reason: ModelRequiredReason
    }
  | {
      readonly kind: 'suppressed'
      readonly origin: SuppressedCommercialRouteOrigin
      readonly reason: string
      readonly model: string
      readonly decision: Decision
    }

export interface CommercialRouterInput {
  readonly automationEnabled: boolean
  readonly claimed: ClaimedTurn
}

type CatalogResolution = ClaimedTurn['catalog_resolution']
type BusinessOffering = NonNullable<ClaimedTurn['business_context']>['offerings'][number]
type CatalogResponseType = 'clarification' | 'commercial_reply' | 'technical_fallback'

const CATALOG_RETRIEVAL_NONE = {
  kb: false,
  long_term_memory: false,
  summary_version: null,
} as const

const CATALOG_INTENT_PATTERN =
  /(?:\b(?:cursos|diplomados|capacitaciones|formaciones|programas|catalogo|oferta academica|academia|estudiar|aprender|inscribirme|inscribime|anotarme|anotame|busco)\b|\b(?:curso|diplomado|capacitacion|formacion|programa)\s+de\s+[a-z0-9]|\b(?:tienen|ofrecen|hay)\b.{0,24}\b(?:curso|diplomado|capacitacion|formacion|programa)\b)/u

const BARE_COURSE_SELECTION_PATTERN =
  // Clitic forms (pagarlo, abonarla…) must stay payment cues, not course
  // selections. Mirror of src/features/orchestration/domain/catalog-resolution.ts.
  /\b(?:quiero|prefiero|elijo|elegi|selecciono|me quedo con|voy con|cambio a)\s+(?!(?:que|pagar(?:l[oa]s?)?|abonar(?:l[oa]s?)?|comprar(?:l[oa]s?)?|hablar|llamar|una llamada|un llamado|saber|consultar|confirmar|verificar|revisar|continuar|seguir|el plan|un plan|plan|cuotas?|por chat|mas informacion|informacion|info|es[ae]|est[ae]|aquel(?:la)?|(?:(?:el|la|un|una)\s+)?(?:opcion|alternativa))\b)(?:el|la|un|una)?\s*[a-z][a-z0-9]*(?:\s+[a-z0-9]+){0,4}\b/u

const PAYMENT_OR_LINK_CONTEXT_PATTERN =
  /\b(?:pag(?:o|ar|arlo|arla|arlos|arlas)?|cuotas?|dolares?|usd|link|plan(?:es)?|mensual(?:es)?|mes(?:es)?|pensar(?:lo|la)?|decidir)\b/u

const EXPLICIT_COURSE_NOUN_PATTERN =
  /\b(?:curso|diplomado|capacitacion|formacion|programa)\b/u

const NON_CATALOG_PROGRAM_CONTEXT_PATTERN =
  /(?:\b(?:sin (?:haber )?(?:usado|usar)|nunca (?:haber )?(?:usado|usar|use))\b.{0,48}\bprograma de\b|\b(?:necesito|hace falta)\b.{0,24}\b(?:instalar|usar|tener instalado)\b.{0,24}\bprograma de\b)/u

const EXPLICIT_PROGRAM_INFORMATION_REQUEST_PATTERN =
  /\b(?:necesito|quiero|busco|solicito)\b.{0,24}\b(?:informacion|info|datos|detalles)\b.{0,24}\b(?:del?|sobre(?: el)?)\s+programa de\b/u

/**
 * "Lo más parecido", "algo similar", "¿qué alternativas tienen?" — a request
 * for the closest offer to something the catalog does not have. Left to the
 * model this reliably produces invented courses (observed live: Groq offered
 * "Desarrollo Web Full Stack" and "Programación en JavaScript", neither in
 * the snapshot), so it must resolve deterministically from snapshot data.
 */
const ALTERNATIVES_REQUEST_PATTERN =
  /\b(?:(?:lo|el|la) mas parecid[oa]|mas parecido que (?:tienen|ofrecen|haya|tengan)|algo (?:parecido|similar|asi)|alguna alternativa|que alternativas?|opciones (?:parecidas|similares)|que otr[oa]s? (?:cursos?|cosas?|opciones?) (?:tienen|ofrecen|hay))\b/u

const CATALOG_NAVIGATION_PATTERN =
  /\b(?:(?:que|cuales) (?:cursos?|diplomados?|capacitaciones?|programas?) (?:tienen|tenes|tienes|ofrecen|hay)(?: disponibles?)?|(?:quiero|quisiera|me gustaria) (?:conocer|ver|saber)(?: cuales son)? (?:los )?(?:cursos?|diplomados?|capacitaciones?|programas?)(?: disponibles?)?|mostrar?me (?:los )?(?:cursos?|diplomados?|catalogo)|catalogo|oferta academica)\b/u

// Only retain a deterministic not-found route when the customer explicitly
// names an unknown program. Open-ended commercial language belongs to Gemini;
// this guard prevents the old keyword router from answering it as a missing
// course.
const EXPLICIT_UNKNOWN_COURSE_PATTERN =
  /\b(?:informaci[oó]n|info|detalles?|datos?)\b.{0,24}\b(?:del?|sobre)\s+(?:el\s+)?(?:curso|diplomado|capacitaci[oó]n|formaci[oó]n|programa)\s+de\s+[\p{L}\p{N}]{4,}/u

const UNAVAILABLE_REASON_CODES: Readonly<Record<
  Extract<CatalogResolution, { kind: 'unavailable' }>['reason'],
  CatalogRouteReason
>> = {
  snapshot_missing: 'CATALOG_SNAPSHOT_MISSING',
  snapshot_truncated: 'CATALOG_SNAPSHOT_TRUNCATED',
  snapshot_invalid: 'CATALOG_SNAPSHOT_INVALID',
}

function suppressedRoute(
  origin: SuppressedCommercialRouteOrigin,
  reason: string,
  model: string,
): CommercialRouteResult {
  return {
    kind: 'suppressed',
    origin,
    reason,
    model,
    decision: suppress(reason),
  }
}

function deterministicRoute(
  origin: DeterministicCommercialRouteOrigin,
  model: string,
  decision: Decision,
  authorizedOfferingCode?: string,
): CommercialRouteResult {
  return {
    kind: 'deterministic',
    origin,
    reason: decision.reason_code,
    model,
    decision,
    ...(authorizedOfferingCode ? { authorizedOfferingCode } : {}),
  }
}

function optOutAcknowledgement(): Decision {
  return {
    schema_version: 4,
    intent: 'opt_out',
    kind: 'reply',
    response: 'Listo, no te enviaremos más mensajes.',
    response_type: 'opt_out_ack',
    confidence: 1,
    reason_code: 'EXPLICIT_OPT_OUT_ACK',
    business_action: null,
    memory_candidates: [],
    missing_information: [],
    next_state: 'completed',
    retrieval_used: CATALOG_RETRIEVAL_NONE,
  }
}

function normalizedSignalText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
}

function containsCatalogIntent(claimed: ClaimedTurn): boolean {
  return claimed.context.batch_messages.some((message) => {
    if (message.message_type !== 'text') return false
    const normalized = normalizedSignalText(message.content)
    return (
      CATALOG_INTENT_PATTERN.test(normalized)
      && (
        !NON_CATALOG_PROGRAM_CONTEXT_PATTERN.test(normalized)
        || EXPLICIT_PROGRAM_INFORMATION_REQUEST_PATTERN.test(normalized)
      )
    )
      || (
        BARE_COURSE_SELECTION_PATTERN.test(normalized)
        && !(
          PAYMENT_OR_LINK_CONTEXT_PATTERN.test(normalized)
          && !EXPLICIT_COURSE_NOUN_PATTERN.test(normalized)
        )
      )
  })
}

function authorizedOfferingsByCode(
  claimed: ClaimedTurn,
  codes: readonly string[],
): BusinessOffering[] {
  if (!claimed.business_context_available || !claimed.business_context) return []
  const byCode = new Map(
    claimed.business_context.offerings.map((offering) => [offering.code, offering]),
  )
  const seen = new Set<string>()
  const authorized: BusinessOffering[] = []
  for (const code of codes) {
    if (seen.has(code)) continue
    seen.add(code)
    const offering = byCode.get(code)
    if (offering) authorized.push(offering)
  }
  return authorized
}

function catalogResponseType(claimed: ClaimedTurn): CatalogResponseType | null {
  const allowed = claimed.policy.allowed_response_types
  if (allowed.includes('clarification')) return 'clarification'
  if (allowed.includes('commercial_reply')) return 'commercial_reply'
  if (allowed.includes('technical_fallback')) return 'technical_fallback'
  return null
}

function catalogDecision(
  claimed: ClaimedTurn,
  response: string,
  reason: CatalogRouteReason,
  missingInformation: string,
): Decision | null {
  const responseType = catalogResponseType(claimed)
  if (!responseType) return null
  const clarify = responseType === 'clarification'
  return {
    schema_version: 4,
    intent: 'commercial',
    kind: clarify ? 'clarify' : 'reply',
    response,
    response_type: responseType,
    confidence: 1,
    reason_code: reason,
    business_action: null,
    memory_candidates: [],
    missing_information: clarify ? [missingInformation] : [],
    next_state: 'waiting_user',
    retrieval_used: CATALOG_RETRIEVAL_NONE,
  }
}

function catalogDecisionRoute(
  claimed: ClaimedTurn,
  origin: CatalogCommercialRouteOrigin,
  reason: CatalogRouteReason,
  response: string,
  missingInformation: string,
): CommercialRouteResult {
  const decision = catalogDecision(claimed, response, reason, missingInformation)
  if (!decision) {
    return suppressedRoute(
      origin,
      'CATALOG_RESPONSE_NOT_ALLOWED',
      'policy:catalog-response-not-allowed',
    )
  }
  return deterministicRoute(origin, CATALOG_RESOLUTION_FAST_PATH_MODEL, decision)
}

function unavailableCatalogRoute(
  claimed: ClaimedTurn,
  reason: CatalogRouteReason,
): CommercialRouteResult {
  return catalogDecisionRoute(
    claimed,
    'catalog_unavailable',
    reason,
    'No puedo confirmar el catálogo ahora. ¿Querés que lo revisemos más tarde?',
    'catalog_availability',
  )
}

function routeCatalogNavigationRequest(claimed: ClaimedTurn): CommercialRouteResult | null {
  if (claimed.catalog_resolution.kind !== 'no_catalog_intent'
    && claimed.catalog_resolution.kind !== 'not_found') return null
  if (claimed.sales_context.offering_code !== null) return null
  if (claimed.batch.message_count !== 1 || claimed.context.batch_messages.length !== 1) return null
  const message = claimed.context.batch_messages[0]
  if (!message || message.message_type !== 'text') return null
  const normalized = normalizedSignalText(message.content)
  if (!CATALOG_NAVIGATION_PATTERN.test(normalized)) return null
  if (!claimed.business_context_available || !claimed.business_context) {
    return unavailableCatalogRoute(claimed, 'CATALOG_SNAPSHOT_MISSING')
  }

  const academies = [...new Set(
    claimed.business_context.offerings
      .map((offering) => offering.academy)
      .filter((academy): academy is string => Boolean(academy)),
  )]
  const requestedAcademy = academies.find((academy) => {
    const canonical = normalizedSignalText(academy)
    const concise = canonical.replace(/^(?:academia|area)(?: de)? /u, '')
    return normalized.includes(canonical) || (concise.length >= 4 && normalized.includes(concise))
  })

  if (requestedAcademy) {
    const offerings = claimed.business_context.offerings
      .filter((offering) => offering.academy === requestedAcademy)
      .slice(0, 3)
    if (offerings.length === 0) {
      return unavailableCatalogRoute(claimed, 'CATALOG_CANDIDATES_UNAVAILABLE')
    }
    return catalogDecisionRoute(
      claimed,
      'catalog_navigation',
      'DETERMINISTIC_CATALOG_NAVIGATION',
      renderCatalogOptions({
        area: requestedAcademy,
        names: offerings.map((offering) => offering.display_name),
        maxItems: 3,
      }),
      'catalog_offering_choice',
    )
  }

  const visibleAcademies = academies.slice(0, 3)
  if (visibleAcademies.length === 0) {
    return unavailableCatalogRoute(claimed, 'CATALOG_CANDIDATES_UNAVAILABLE')
  }
  return catalogDecisionRoute(
    claimed,
    'catalog_navigation',
    'DETERMINISTIC_CATALOG_NAVIGATION',
    `Podemos orientarte por estas áreas: ${visibleAcademies.join(', ')}. ¿Cuál te interesa?`,
    'catalog_area',
  )
}

/**
 * Deterministic answer for a closest-match request that nothing in the
 * current message resolves. Every name in the reply comes from the snapshot
 * (distinct academies, catalog order); the model never composes it. With a
 * course already confirmed the request is contextual advisory and falls
 * through to the existing routes.
 */
function routeCatalogAlternativesRequest(claimed: ClaimedTurn): CommercialRouteResult | null {
  const resolution = claimed.catalog_resolution
  if (resolution.kind !== 'no_catalog_intent' && resolution.kind !== 'not_found') return null
  if (claimed.sales_context.offering_code !== null) return null
  if (claimed.batch.message_count !== 1 || claimed.context.batch_messages.length !== 1) return null
  const message = claimed.context.batch_messages[0]
  if (!message || message.message_type !== 'text') return null
  if (!ALTERNATIVES_REQUEST_PATTERN.test(normalizedSignalText(message.content))) return null

  if (!claimed.business_context_available || !claimed.business_context) {
    return unavailableCatalogRoute(claimed, 'CATALOG_SNAPSHOT_MISSING')
  }
  const academies: string[] = []
  for (const offering of claimed.business_context.offerings) {
    if (offering.academy && !academies.includes(offering.academy)) {
      academies.push(offering.academy)
    }
    if (academies.length === 3) break
  }
  if (academies.length === 0) {
    return unavailableCatalogRoute(claimed, 'CATALOG_CANDIDATES_UNAVAILABLE')
  }

  return catalogDecisionRoute(
    claimed,
    'catalog_not_found',
    'DETERMINISTIC_CATALOG_ALTERNATIVES',
    `No tengo un curso así en el catálogo actual. Nuestras áreas incluyen ${academies.join(', ')}. ¿Cuál te interesa? Así te recomiendo opciones reales.`,
    'catalog_area',
  )
}

function routeCatalogResolution(claimed: ClaimedTurn): CommercialRouteResult | null {
  const resolution = claimed.catalog_resolution

  const navigationRequest = routeCatalogNavigationRequest(claimed)
  if (navigationRequest) return navigationRequest

  const alternativesRequest = routeCatalogAlternativesRequest(claimed)
  if (alternativesRequest) return alternativesRequest

  if (resolution.kind === 'ambiguous') {
    const candidates = authorizedOfferingsByCode(claimed, resolution.candidateCodes).slice(0, 3)
    if (candidates.length < 2) {
      return unavailableCatalogRoute(claimed, 'CATALOG_CANDIDATES_UNAVAILABLE')
    }
    const labels = candidates.map((candidate) =>
      resolution.clarification === 'choose_area' && candidate.academy
        ? `${candidate.display_name} (${candidate.academy})`
        : candidate.display_name,
    )
    return catalogDecisionRoute(
      claimed,
      'catalog_ambiguous',
      'DETERMINISTIC_CATALOG_AMBIGUOUS',
      `Encontré varias opciones: ${labels.join(', ')}. ¿Cuál querés revisar?`,
      resolution.clarification === 'choose_area' ? 'catalog_area_choice' : 'catalog_offering_choice',
    )
  }

  if (resolution.kind === 'not_found') {
    if (!containsCatalogIntent(claimed)) return null
    const latestText = claimed.context.batch_messages.at(-1)?.content ?? ''
    if (claimed.batch.message_count === 1
      && claimed.context.batch_messages.length === 1
      && resolution.requestedArea === null
      && !EXPLICIT_UNKNOWN_COURSE_PATTERN.test(normalizedSignalText(latestText))) {
      return null
    }
    if (resolution.requestedArea === null) {
      return catalogDecisionRoute(
        claimed,
        'catalog_not_found',
        'DETERMINISTIC_CATALOG_NOT_FOUND',
        'No pude verificar ese curso. ¿Qué área te interesa?',
        'catalog_area',
      )
    }

    return catalogDecisionRoute(
      claimed,
      'catalog_not_found',
      'DETERMINISTIC_CATALOG_NOT_FOUND',
      'No pude verificar ese curso. ¿Querés que te muestre opciones de esa área?',
      'catalog_alternative',
    )
  }

  if (resolution.kind === 'unavailable') {
    if (!containsCatalogIntent(claimed)) return null
    return unavailableCatalogRoute(claimed, UNAVAILABLE_REASON_CODES[resolution.reason])
  }

  return null
}

/**
 * The payment matcher intentionally accepts a one-message view. For a batch
 * that would otherwise be consumed by a catalog fail-closed route, preserve
 * every message in one immutable composite and clear course identity. The
 * shared decision policy remains responsible for requiring an offering, so
 * this route can select a plan but can never preserve or invent a SKU.
 */
function matchCatalogCompetingPaymentSelection(claimed: ClaimedTurn): Decision | null {
  if (claimed.batch.message_count <= 1 || claimed.context.batch_messages.length <= 1) return null
  if (claimed.context.batch_messages.some((message) => message.message_type !== 'text')) return null
  const first = claimed.context.batch_messages[0]
  if (!first) return null

  const projected: ClaimedTurn = {
    ...claimed,
    batch: { ...claimed.batch, message_count: 1 },
    context: {
      ...claimed.context,
      batch_messages: [{
        ...first,
        content: claimed.context.batch_messages.map((message) => message.content).join('\n'),
      }],
    },
    sales_context: {
      ...claimed.sales_context,
      course_of_interest: null,
      offering_code: null,
    },
  }
  return matchPaymentSelectionFastPath(projected)
}

/**
 * Claim policy remains the primary opt-out authority. These deliberately
 * narrow phrases are a final batch-level precedence guard: even a stale or
 * inconsistent claim cannot let a positive call/payment signal outrank the
 * customer's explicit request to stop written contact. Artifact-specific
 * deferrals such as "no me mandes el link todavía" are intentionally absent.
 */
/**
 * A call refusal is not a messaging opt-out. When the existing close matcher
 * cannot render the whole composite message safely, require the model instead
 * of allowing a positive call/payment fast path to discard the refusal.
 */
function containsCallDecline(claimed: ClaimedTurn): boolean {
  const patterns = [
    /\bno me llames?\b/u,
    /\bno llames?\b/u,
    /\bno quiero (?:una |la )?llamadas?\b/u,
    /\bdeja de llamarme\b/u,
    /\b(?:prefiero|quiero) seguir por chat\b/u,
  ]
  return claimed.context.batch_messages.some((message) => {
    const normalized = normalizedSignalText(message.content)
    return patterns.some((pattern) => pattern.test(normalized))
  })
}

function containsCommercialDecline(claimed: ClaimedTurn): boolean {
  const patterns = [
    /\bno quiero (?:comprar|anotarme|inscribirme)\b/u,
    /\bno (?:voy|me voy) a (?:comprar|anotarme|inscribirme)\b/u,
    /\bno me interesa (?:comprar|anotarme|inscribirme|el curso|la oferta)\b/u,
    /\bel (?:curso|programa) no me convence\b/u,
  ]
  return claimed.context.batch_messages.some((message) => {
    const normalized = normalizedSignalText(message.content)
    return patterns.some((pattern) => pattern.test(normalized))
  })
}

export function routeCommercialTurn(input: CommercialRouterInput): CommercialRouteResult {
  const claimed = input.claimed
  const eligibleOptOutInBatch = claimed.context.batch_messages.some(
    (message) => message.opt_out_ack_eligible === true,
  )

  if (!input.automationEnabled) {
    return suppressedRoute(
      'automation_disabled',
      'AUTOMATION_DISABLED',
      'policy:automation-disabled',
    )
  }

  // TurnPolicy intentionally allows one acknowledgement for the opt-out that
  // happened in this batch, even though ingest has already persisted the
  // contact as blocked/revoked. It must precede those durable-state gates and
  // is never inferred from an old revocation alone.
  if (
    eligibleOptOutInBatch
    && claimed.policy.may_respond
    && claimed.policy.allowed_response_types.includes('opt_out_ack')
  ) {
    return deterministicRoute(
      'opt_out_ack',
      OPT_OUT_ACK_FAST_PATH_MODEL,
      optOutAcknowledgement(),
    )
  }

  if (claimed.contact.blocked) {
    return suppressedRoute(
      'contact_blocked',
      claimed.policy.reason ?? 'CONTACT_BLOCKED',
      'policy:contact-blocked',
    )
  }

  if (
    claimed.contact.consent_status === 'revoked'
    || claimed.policy.allowed_response_types.includes('opt_out_ack')
  ) {
    return suppressedRoute(
      'opt_out',
      claimed.policy.reason ?? 'CONSENT_REVOKED',
      'policy:opt-out',
    )
  }

  if (eligibleOptOutInBatch) {
    return suppressedRoute(
      'opt_out',
      'EXPLICIT_OPT_OUT_IN_BATCH',
      'policy:opt-out',
    )
  }

  if (!claimed.policy.may_respond) {
    return suppressedRoute(
      'turn_policy',
      claimed.policy.reason ?? 'POLICY_SUPPRESSED',
      'policy:suppressed',
    )
  }

  const hasNegativeSignal = containsCallDecline(claimed)
    || containsCommercialDecline(claimed)
  const callHandoff = hasNegativeSignal ? null : matchCallHandoffFastPath(claimed)

  // The backend classified direct and accepted calls from the whole burst.
  // Those authorized actions are conclusive even when catalog resolution
  // also observed a course phrase. A clarification is not: it still obeys
  // the generic multi-message gate below.
  if (callHandoff?.business_action?.type === 'request_call_now') {
    return deterministicRoute('call_handoff', CALL_HANDOFF_FAST_PATH_MODEL, callHandoff)
  }

  const isMultiMessageBatch = claimed.batch.message_count !== 1
    || claimed.context.batch_messages.length !== 1

  if (isMultiMessageBatch) {
    if (hasNegativeSignal) {
      return {
        kind: 'model_required',
        origin: 'advisory_model',
        reason: containsCallDecline(claimed)
          ? 'CALL_DECLINE_REQUIRES_SALES_MODEL'
          : 'NEGATIVE_SIGNAL_REQUIRES_MODEL',
      }
    }
    const paymentSelection = matchCatalogCompetingPaymentSelection(claimed)
    if (paymentSelection) {
      return deterministicRoute('payment_selection', PAYMENT_SELECTION_FAST_PATH_MODEL, paymentSelection)
    }
    return {
      kind: 'model_required',
      origin: 'advisory_model',
      reason: 'MULTI_MESSAGE_BATCH',
    }
  }

  if (hasNegativeSignal) {
    return {
      kind: 'model_required',
      origin: 'advisory_model',
      reason: containsCallDecline(claimed)
        ? 'CALL_DECLINE_REQUIRES_SALES_MODEL'
        : 'NEGATIVE_SIGNAL_REQUIRES_MODEL',
    }
  }

  if (callHandoff) {
    return deterministicRoute('call_handoff', CALL_HANDOFF_FAST_PATH_MODEL, callHandoff)
  }

  const paymentSelection = matchPaymentSelectionFastPath(claimed)
  if (paymentSelection) {
    return deterministicRoute(
      'payment_selection',
      PAYMENT_SELECTION_FAST_PATH_MODEL,
      paymentSelection,
    )
  }

  const greeting = matchDeterministicGreeting(claimed)
  if (greeting) {
    return deterministicRoute('greeting', GREETING_FAST_PATH_MODEL, greeting)
  }

  const latest = normalizedSignalText(claimed.context.batch_messages.at(-1)?.content ?? '')
  if (CATALOG_NAVIGATION_PATTERN.test(latest)) {
    return { kind: 'model_required', origin: 'advisory_model', reason: 'OPEN_CATALOG_REQUIRES_SALES_MODEL' }
  }
  if (containsCatalogIntent(claimed) && !/\b(?:orientame|orientá|recomend(?:ame|á)|no s[eé])\b/u.test(latest)) {
    return { kind: 'model_required', origin: 'advisory_model', reason: 'OPEN_CATALOG_REQUIRES_SALES_MODEL' }
  }
  if (EXPLICIT_COURSE_NOUN_PATTERN.test(latest)) {
    return { kind: 'model_required', origin: 'advisory_model', reason: 'COURSE_FACT_REQUIRES_SALES_MODEL' }
  }
  if (/\b(?:clases?|duraci[oó]n|cu[aá]ntas?)\b/u.test(latest)) {
    return { kind: 'model_required', origin: 'advisory_model', reason: 'COURSE_FACT_REQUIRES_SALES_MODEL' }
  }
  if (/\b(?:caro|cara|conviene|objeci[oó]n)\b/u.test(latest)) {
    return { kind: 'model_required', origin: 'advisory_model', reason: 'OBJECTION_REQUIRES_SALES_MODEL' }
  }
  if (containsCatalogIntent(claimed)) {
    return { kind: 'model_required', origin: 'advisory_model', reason: 'ADVISORY_REQUIRES_SALES_MODEL' }
  }
  if (PAYMENT_OR_LINK_CONTEXT_PATTERN.test(latest)) {
    return { kind: 'model_required', origin: 'advisory_model', reason: 'ADVISORY_REQUIRES_SALES_MODEL' }
  }
  return {
    kind: 'model_required',
    origin: 'advisory_model',
    reason: 'NO_DETERMINISTIC_MATCH',
  }
}
