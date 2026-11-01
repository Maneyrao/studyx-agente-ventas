import type { ClaimedTurn, Decision } from '../schemas/contracts'

/**
 * Deterministic fast path for the call handoff.
 *
 * A single-message batch whose text is an unambiguous call signal does not
 * need catalog, embeddings or a model call: the right decision is fixed by
 * `sales_context.allowed_actions` and the complete contact intake returned by
 * the backend at claim time; the backend re-validates consent on commit too. The backend owns the
 * bounded classifier and exposes `deterministic_route`; Botpress renders the
 * route and keeps no duplicated regular-expression vocabulary.
 *
 *   - "llamame" with request_call_now allowed  → immediate v4 request.
 *   - exact "sí"/"dale" after the separate availability question and with
 *     request_call_now allowed → immediate v4 request (accepted_offer).
 *   - exact "sí" without an open offer → one clarification, never a call.
 *   - any decline or opt-out wording → null: this path never requests a
 *     call on a negation, and the reply stays with the normal pipeline.
 *
 * The confirmation copy never claims the call is connected — the backend
 * only reserved it; dispatch and provider acceptance come later.
 */

export const CALL_HANDOFF_FAST_PATH_MODEL = 'deterministic:call-handoff-fast-path-v1'

export const CALL_CONFIRMATION_RESPONSE =
  'Recibí tu solicitud de llamada.'

const CALL_CLARIFICATION_RESPONSE =
  '¿Me confirmás a qué te referís? Contame qué curso o información estás buscando.'

const CALL_ALREADY_ACTIVE_RESPONSE =
  'La llamada ya está en proceso. Atendé el teléfono y seguimos por ahí.'

const RETRIEVAL_NONE = { kb: false, long_term_memory: false, summary_version: null }

function hasCompleteCallIdentity(claimed: ClaimedTurn): boolean {
  return claimed.call_intake_readiness?.status === 'ready'
}

function callConfirmation(
  reason: 'direct_request' | 'accepted_offer',
  courseOfInterest: string | null,
): Decision {
  return {
    schema_version: 4,
    intent: 'commercial',
    kind: 'reply',
    response: CALL_CONFIRMATION_RESPONSE,
    response_type: 'call_confirmation',
    confidence: 1,
    reason_code: reason === 'direct_request' ? 'CALL_DIRECT_REQUEST' : 'CALL_CONSENT_ACCEPTED',
    business_action: {
      type: 'request_call_now',
      reason,
      ...(courseOfInterest ? { course_of_interest: courseOfInterest } : {}),
    },
    memory_candidates: [],
    missing_information: [],
    next_state: 'completed',
    retrieval_used: RETRIEVAL_NONE,
  }
}

function ambiguousAcceptanceClarification(): Decision {
  return {
    schema_version: 4,
    intent: 'commercial',
    kind: 'clarify',
    response: CALL_CLARIFICATION_RESPONSE,
    response_type: 'clarification',
    confidence: 1,
    reason_code: 'CALL_CONSENT_AMBIGUOUS',
    business_action: null,
    memory_candidates: [],
    missing_information: ['call_consent_confirmation'],
    next_state: 'waiting_user',
    retrieval_used: RETRIEVAL_NONE,
  }
}

export function matchCallHandoffFastPath(claimed: ClaimedTurn): Decision | null {
  const allowed = claimed.sales_context.allowed_actions
  const course = claimed.sales_context.course_of_interest

  if (claimed.deterministic_route === 'call_already_active') {
    return {
      schema_version: 4,
      intent: 'commercial',
      kind: 'reply',
      response: CALL_ALREADY_ACTIVE_RESPONSE,
      response_type: 'commercial_reply',
      confidence: 1,
      reason_code: 'CALL_ALREADY_ACTIVE',
      business_action: null,
      memory_candidates: [],
      missing_information: [],
      next_state: 'completed',
      retrieval_used: RETRIEVAL_NONE,
    }
  }

  if (claimed.deterministic_route === 'call_direct_request') {
    if (!allowed.includes('request_call_now') || !hasCompleteCallIdentity(claimed)) return null
    return callConfirmation('direct_request', course)
  }

  if (claimed.deterministic_route === 'call_accepted_offer') {
    // An open invitation and a later availability question share the same
    // linguistic answer ("sí") but not the same durable state. Only the
    // accepted+awaiting combination proves the latter was actually asked.
    const state = claimed.conversation_state_v1
    if (state?.call_preference !== 'call'
      || state.call_offer_status !== 'accepted'
      || state.awaiting_reply !== 'call_or_chat') return null
    if (
      !allowed.includes('request_call_now')
      || !claimed.sales_context.accepted_call_offer
      || !hasCompleteCallIdentity(claimed)
    ) return null
    return callConfirmation('accepted_offer', course)
  }

  if (claimed.deterministic_route === 'call_acceptance_clarification') {
    if (claimed.sales_context.accepted_call_offer) return null
    return ambiguousAcceptanceClarification()
  }

  return null
}
