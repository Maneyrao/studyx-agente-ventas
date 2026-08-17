import type { ClaimedTurn, Decision } from '../schemas/contracts'

/**
 * Deterministic fast path for the call handoff.
 *
 * A single-message batch whose text is an unambiguous call signal does not
 * need catalog, embeddings or a model call: the right decision is fixed by
 * `sales_context.allowed_actions` (computed by the backend at claim time)
 * and the backend re-validates consent on commit anyway. The gate mirrors
 * the backend's own bounded classifier (`sales-signal.ts`) on purpose — the
 * two must agree, and anything outside the bounded patterns falls through
 * to the model.
 *
 *   - "llamame" with request_call_now allowed  → immediate v4 request.
 *   - exact "sí"/"dale" with an open offer and request_call_now allowed
 *     → immediate v4 request (accepted_offer).
 *   - exact "sí" without an open offer → one clarification, never a call.
 *   - any decline or opt-out wording → null: this path never requests a
 *     call on a negation, and the reply stays with the normal pipeline.
 *
 * The confirmation copy never claims the call is connected — the backend
 * only reserved it; dispatch and provider acceptance come later.
 */

export const CALL_HANDOFF_FAST_PATH_MODEL = 'deterministic:call-handoff-fast-path-v1'

export const CALL_CONFIRMATION_RESPONSE =
  'Perfecto. Registré la llamada; nuestra asesora virtual intenta comunicarse ahora.'

const CALL_CLARIFICATION_RESPONSE =
  '¿Me confirmás a qué te referís? Contame qué curso o información estás buscando.'

// Mirrors src/features/orchestration/domain/sales-signal.ts — negations are
// evaluated FIRST so "sí, pero no me llames" can never read as consent.
const OPT_OUT_PATTERNS: RegExp[] = [
  /\bno me escribas? mas\b/,
  /\bno me contactes? mas\b/,
  /\bdejen? de (escribirme|contactarme|molestarme)\b/,
  /\bno quiero (recibir )?mas mensajes\b/,
  /\bbasta de mensajes\b/,
  /\bdarme de baja\b/,
  /\bunsubscribe\b/,
]

const CALL_DECLINE_PATTERNS: RegExp[] = [/\bno me llames?\b/, /\bno llames?\b/]

const DIRECT_CALL_REQUEST_PATTERNS: RegExp[] = [
  /\bllamame\b/,
  /\bllamenme\b/,
  /\bpodes llamarme\b/,
]

const SHORT_ACCEPTANCE_REPLIES = new Set(['si', 'dale', 'de una'])

function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

function stripPunctuation(text: string): string {
  return text.replace(/[!¡¿?.,;:]/g, '').trim()
}

const RETRIEVAL_NONE = { kb: false, long_term_memory: false, summary_version: null }

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
  // A burst needs answer-first treatment from the model; the fast path only
  // owns the unambiguous single-message case.
  if (claimed.context.batch_messages.length !== 1) return null

  const text = normalize(claimed.context.batch_messages[0]?.content ?? '')
  if (text === '') return null

  // Negations first: this path never requests a call on a decline/opt-out.
  if (OPT_OUT_PATTERNS.some((p) => p.test(text))) return null
  if (CALL_DECLINE_PATTERNS.some((p) => p.test(text))) return null

  const allowed = claimed.sales_context.allowed_actions
  const course = claimed.sales_context.course_of_interest

  if (DIRECT_CALL_REQUEST_PATTERNS.some((p) => p.test(text))) {
    if (!allowed.includes('request_call_now')) return null
    return callConfirmation('direct_request', course)
  }

  if (SHORT_ACCEPTANCE_REPLIES.has(stripPunctuation(text))) {
    if (allowed.includes('request_call_now') && claimed.sales_context.open_call_offer) {
      return callConfirmation('accepted_offer', course)
    }
    if (!claimed.sales_context.open_call_offer) {
      return ambiguousAcceptanceClarification()
    }
    return null
  }

  return null
}
