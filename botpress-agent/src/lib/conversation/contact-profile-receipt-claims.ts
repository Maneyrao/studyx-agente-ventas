import type { AgentAContextV1, AgentATurnProposalV1 } from '../../schemas/agent-a-brain'

type RejectedUpdateV1 = NonNullable<NonNullable<AgentAContextV1['customer']['contact_profile']>['rejected_updates']>[number]

function digitRuns(text: string): string[] {
  return (text.match(/\+?\d[\d\s().-]{6,}\d/gu) ?? []).map((run) => run.replace(/\D/gu, ''))
}

/** Value comparison against the profile receipt, never phrase matching. */
export function textMentionsRejectedValueV1(text: string, update: RejectedUpdateV1): boolean {
  if (update.field === 'telefono') {
    const tail = update.value.replace(/\D/gu, '').slice(-8)
    return tail.length === 8 && digitRuns(text).some((run) => run.length >= 8 && run.endsWith(tail))
  }
  if (update.field === 'correo') return text.toLowerCase().includes(update.value.toLowerCase())
  return false
}

/**
 * Rejected values the reply repeats. A phone candidate may be shown only while
 * the same proposal asks the customer to confirm it (structured clarify request);
 * a rejected email is never echoed back: the customer must resend it.
 */
export function rejectedProfileValuesInReplyV1(input: {
  readonly proposal: AgentATurnProposalV1
  readonly context: AgentAContextV1
}): RejectedUpdateV1[] {
  const rejected = input.context.customer?.contact_profile?.rejected_updates ?? []
  if (rejected.length === 0) return []
  const clarifiesPhone = (input.proposal.profile_requests ?? [])
    .some((request) => request.mode === 'clarify' && request.fields.includes('telefono'))
  const texts = [...input.proposal.response.messages, input.proposal.response.call_offer ?? '']
  return rejected.filter((update) => !(update.field === 'telefono' && clarifiesPhone)
    && input.context.customer.contact_intake?.[update.field] !== update.value
    && texts.some((text) => textMentionsRejectedValueV1(text, update)))
}
