import type { ClaimedTurn, Decision } from '../schemas/contracts'

/**
 * Deterministic fast path for unambiguous greetings.
 *
 * A batch that is exactly one short greeting does not need a model call: the
 * right answer is fixed, contains no prices and no claims, and skipping the
 * LLM round trip saves several seconds on the most common first message.
 *
 * The gate is deliberately narrow:
 *   - exactly ONE message in the claimed batch (a burst goes to the model),
 *   - the whole text, normalized, is EXACTLY one known greeting — any extra
 *     word ("hola, precios?") falls through to the model,
 *   - policy must allow social_reply (the caller also checks automation and
 *     may_respond before invoking this).
 *
 * The resulting decision is committed through Next.js exactly like a model
 * decision: same validation, same outbound creation, same single physical
 * send. The fast path changes who authors the decision, never the pipeline.
 */

export const GREETING_FAST_PATH_MODEL = 'deterministic:greeting-fast-path-v1'

const EXACT_GREETINGS = new Set([
  'hola',
  'buenas',
  'buen dia',
  'buenas tardes',
  'buenas noches',
  'hola buenas',
  'hola buen dia',
  'hola buenas tardes',
  'hola buenas noches',
])

const GREETING_RESPONSE =
  '¡Hola! 😊 Soy el asistente de StudyX. Puedo darte información sobre nuestros cursos, ' +
  'modalidades y duración. ¿En qué te puedo ayudar?'

/**
 * Lowercase, strip diacritics, collapse whitespace and drop surrounding
 * punctuation/emoji so "¡Hola!! 👋" still counts as "hola". Any interior
 * alphanumeric content beyond the greeting itself survives normalization and
 * therefore fails the exact-set lookup.
 */
export function normalizeGreetingText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9ñ\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function matchDeterministicGreeting(claimed: ClaimedTurn): Decision | null {
  if (claimed.batch.message_count !== 1) return null
  if (claimed.context.batch_messages.length !== 1) return null
  if (!claimed.policy.allowed_response_types.includes('social_reply')) return null

  const message = claimed.context.batch_messages[0]
  if (message.message_type !== 'text') return null

  const normalized = normalizeGreetingText(message.content)
  if (!EXACT_GREETINGS.has(normalized)) return null

  return {
    schema_version: 3,
    intent: 'social',
    kind: 'reply',
    response: GREETING_RESPONSE,
    response_type: 'social_reply',
    business_action: null,
    memory_candidates: [],
    missing_information: [],
    next_state: 'waiting_user',
    reason_code: 'DETERMINISTIC_GREETING',
    confidence: 1,
    retrieval_used: { kb: false, long_term_memory: false, summary_version: null },
  }
}
