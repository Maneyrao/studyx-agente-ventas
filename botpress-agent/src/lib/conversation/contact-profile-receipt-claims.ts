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

/** Rejected values the reply repeats outside a structured request for the same field. */
export function rejectedProfileValuesInReplyV1(input: {
  readonly proposal: AgentATurnProposalV1
  readonly context: AgentAContextV1
}): RejectedUpdateV1[] {
  const rejected = input.context.customer?.contact_profile?.rejected_updates ?? []
  if (rejected.length === 0) return []
  // Asking for the field again is not a claim that it was saved: a phone may be
  // shown inside that request; an email only as the customer wrote it (never
  // an agent-made correction such as gmail,com → gmail.com).
  const requested = new Set((input.proposal.profile_requests ?? []).flatMap((request) => request.fields))
  const customerTexts = (input.context.turn?.batch_messages ?? []).map((message) => message.text.toLowerCase())
  const exempt = (update: RejectedUpdateV1) => requested.has(update.field) && (update.field === 'telefono'
    || customerTexts.some((text) => text.includes(update.value.trim().toLowerCase())))
  const texts = [...input.proposal.response.messages, input.proposal.response.call_offer ?? '']
  return rejected.filter((update) => !exempt(update)
    && !sameProfileValueV1(update.field, input.context.customer.contact_intake?.[update.field], update.value)
    && texts.some((text) => textMentionsRejectedValueV1(text, update)))
}
