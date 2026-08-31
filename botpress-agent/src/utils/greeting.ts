import type { ClaimedTurn, Decision } from '../schemas/contracts'

/**
 * Deterministic fast path for unambiguous greetings.
 *
 * A batch that is exactly one short greeting does not need a model call: the
 * right answer is fixed, contains no prices and no claims, and skipping the
 * LLM round trip saves several seconds on the most common first message.
 *
 * The backend owns the deliberately narrow classifier and publishes its
 * result as `deterministic_route`. Botpress only renders that decision; it
 * keeps no second greeting vocabulary that could drift from claim-time work.
 *
 * The resulting decision is committed through Next.js exactly like a model
 * decision: same validation, same outbound creation, same single physical
 * send. The fast path changes who authors the decision, never the pipeline.
 */

export const GREETING_FAST_PATH_MODEL = 'deterministic:greeting-fast-path-v2'

/**
 * The identity in the greeting is the configured workspace's display name —
 * already sanitized by the backend — never a hardcoded brand. Without
 * business context the greeting stays brand-neutral instead of guessing.
 */
function buildGreetingResponse(claimed: ClaimedTurn): string {
  const businessName = claimed.business_context?.workspace.display_name ?? null
  const identity = businessName
    ? `Soy la asesora virtual de ${businessName}.`
    : 'Soy la asesora virtual del equipo.'
  const firstName = claimed.contact.name?.trim().split(/\s+/u)[0] || null
  const salutation = firstName ? `¡Hola, ${firstName}!` : '¡Hola!'
  return (
    `${salutation} 😊 ${identity} Puedo darte información sobre nuestros cursos, ` +
    'modalidades y horarios. ¿En qué te puedo ayudar?'
  )
}

export function matchDeterministicGreeting(claimed: ClaimedTurn): Decision | null {
  if (claimed.deterministic_route !== 'greeting') return null
  if (!claimed.policy.allowed_response_types.includes('social_reply')) return null
  if (
    claimed.context.batch_messages.length === 0
    || claimed.context.batch_messages.some((message) => message.message_type !== 'text')
  ) return null

  return {
    schema_version: 4,
    intent: 'social',
    kind: 'reply',
    response: buildGreetingResponse(claimed),
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
