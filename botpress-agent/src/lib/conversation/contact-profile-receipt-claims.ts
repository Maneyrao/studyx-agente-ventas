import type { AgentAContextV1, AgentATurnProposalV1 } from '../../schemas/agent-a-brain'

type RejectedUpdateV1 = NonNullable<NonNullable<AgentAContextV1['customer']['contact_profile']>['rejected_updates']>[number]

const phoneTail = (value: string): string => value.replace(/\D/gu, '').slice(-8)

/** Same value under the field's canonical comparison (phone by last 8 digits, email case-folded). */
export function sameProfileValueV1(field: RejectedUpdateV1['field'], left: string | null | undefined, right: string): boolean {
  if (typeof left !== 'string') return false
  if (field === 'telefono') return phoneTail(left).length === 8 && phoneTail(left) === phoneTail(right)
  return left.trim().toLowerCase() === right.trim().toLowerCase()
}

/** Value comparison against the profile receipt, never phrase matching. */
export function textMentionsRejectedValueV1(text: string, update: RejectedUpdateV1): boolean {
  if (update.field === 'telefono') {
    const tail = phoneTail(update.value)
    // Separators removed per number-like run; `includes` so an adjacent
    // amount ("…4498 - 12 cuotas") cannot hide the number.
    return tail.length === 8 && (text.match(/\d[\d\s().-]*\d/gu) ?? [])
      .some((run) => run.replace(/\D/gu, '').includes(tail))
  }
  if (update.field === 'correo') return text.toLowerCase().includes(update.value.trim().toLowerCase())
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
    && !sameProfileValueV1(update.field, input.context.customer.contact_intake?.[update.field], update.value)
    && texts.some((text) => textMentionsRejectedValueV1(text, update)))
}
