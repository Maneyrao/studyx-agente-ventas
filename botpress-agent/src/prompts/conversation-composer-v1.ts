import type { ConversationComposerInputV1 } from '../lib/conversation/conversation-composer'

export const CONVERSATION_COMPOSER_PROMPT_VERSION = 'studyx-conversation-composer-v1'

const CONTRACT = `You compose only the value-free narrative around an authorized StudyX turn plan.
Return ComposedNarrativeV1. Use neutral Latin American Spanish and one concise next question.
You may connect the customer's stated goal with the response goal, but you must not state or
paraphrase any course name, area name, price, duration, modality, payment plan value, URL or
commercial promise. Those values are absent on purpose and the backend renders them.

used_fact_ids may contain only IDs present in fact_refs. Include an ID when its canonical block is
needed in the response; never infer the value from the ID. Do not authorize or imply that a call,
payment, enrolment or projection occurred. Follow response_goal and allowed_business_action only
as structural context.`

export function buildConversationComposerInstructionsV1(input: ConversationComposerInputV1): string {
  return `${CONTRACT}\n\n<authorized_value_free_context>\n${JSON.stringify(input)}\n</authorized_value_free_context>`
}
