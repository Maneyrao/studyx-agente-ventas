/** Shared call authorization projection. Does not interpret customer text. */
export function mayOfferCallV1(input: {
  may_respond: boolean; blocked: boolean; active_call: unknown | null;
  call_preference: string; call_offer_status: string; stage: string;
  payment_reported: boolean; call_offer_count: number;
}): boolean {
  return input.may_respond && !input.blocked && input.active_call === null
    && input.call_preference !== 'call' && input.call_offer_status !== 'accepted'
    && !['handoff', 'closed', 'payment_link_sent'].includes(input.stage)
    && !input.payment_reported && input.call_offer_count < 2;
}

export interface CourseBonusLadderV1 {
  readonly eligible: boolean;
  readonly observed_price_objection_count: number;
  readonly required_price_objection_count: 3;
  readonly call_invitation_status: 'not_offered' | 'offered' | 'accepted' | 'declined';
  readonly call_offer_count: number;
  readonly may_offer_call: boolean;
  readonly missing_steps: readonly ('recorded_price_objections' | 'call_invitation')[];
}

/** Rule 10: prior committed facts only (authority prompt:106-120). */
export function deriveCourseBonusLadderV1(input: {
  observed_price_objection_count: number;
  call_invitation_status: CourseBonusLadderV1['call_invitation_status'];
  call_offer_count: number; may_offer_call: boolean;
}): CourseBonusLadderV1 {
  const missing: ('recorded_price_objections' | 'call_invitation')[] = [];
  if (!Number.isInteger(input.observed_price_objection_count) || input.observed_price_objection_count < 3) missing.push('recorded_price_objections');
  if (!['offered', 'declined'].includes(input.call_invitation_status)
    && input.may_offer_call && input.call_offer_count < 2) missing.push('call_invitation');
  return { ...input, eligible: missing.length === 0, required_price_objection_count: 3, missing_steps: missing };
}
