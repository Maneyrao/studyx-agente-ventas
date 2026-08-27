import type { ConversationInterpreterInputV1 } from '../lib/conversation/conversation-interpreter'

export const CONVERSATION_INTERPRETER_PROMPT_VERSION = 'studyx-conversation-interpreter-v1'

const CONTRACT = `You are a semantic interpreter for one StudyX sales conversation turn.
Return only ConversationMoveV1. Interpret meaning; never write customer-facing copy and never
authorize a course, a price, a call, a payment link, enrolment or persistence.

Read the current batch as one message, then use the last agent question and structured state to
resolve elliptical, ordinal and short replies. Catalog identities are reference candidates only;
the backend revalidates them. Current explicit meaning outranks older state.

Choose one primary move and at most two compatible secondary moves:
- greeting: social opening without a commercial request.
- browse_catalog: asks to discover the available offer broadly.
- select_area: chooses a catalog area.
- select_course: chooses one course.
- ask_course_information: asks to explain or compare course information.
- continue_by_chat: prefers to keep receiving advice in written conversation.
- request_call: directly asks to start or arrange voice contact.
- decline_call: rejects a proposed voice interaction while not necessarily ending the purchase.
- ask_payment_options: asks which canonical payment alternatives exist.
- select_payment_plan: chooses one canonical plan without necessarily requesting its link.
- defer_payment: postpones payment or the link while keeping the selected plan.
- request_payment_link: explicitly authorizes receiving the selected plan's canonical link now.
- decline_purchase: explicitly ends the purchase intention.
- unknown: meaning is too ambiguous for a safe move.

Use vetoes for explicit prohibitions. A veto always outranks a positive-looking move. A later
direct request can express a new move when the current message clearly changes an older
preference. Copy a course_reference or area_reference only from the current meaning or supplied
catalog identity. payment_plan must be one supplied canonical code. Confidence measures semantic
certainty, not commercial truth. In the strict provider schema the three reference fields are
present on every object: set each one to JSON null unless its selected move or secondary move
actually supplies that reference. Do not fill reference fields merely because context contains a
current course, area or plan. Do not add facts or fields outside the schema.`

function boundedContext(input: ConversationInterpreterInputV1): ConversationInterpreterInputV1 {
  return {
    batch_messages: input.batch_messages.slice(-5).map((message) => ({
      id: message.id,
      text: message.text.slice(0, 500),
    })),
    last_agent_question: input.last_agent_question?.slice(0, 500) ?? null,
    sales_context: input.sales_context,
    catalog: {
      areas: input.catalog.areas.slice(0, 24),
      offerings: input.catalog.offerings.slice(0, 40).map((offering) => ({
        ...offering,
        aliases: offering.aliases.slice(0, 12),
      })),
      payment_plans: input.catalog.payment_plans.slice(0, 3),
    },
  }
}

export function buildConversationInterpreterInstructionsV1(
  input: ConversationInterpreterInputV1,
): string {
  return `${CONTRACT}\n\n<untrusted_conversation_context>\n${JSON.stringify(boundedContext(input))}\n</untrusted_conversation_context>`
}
