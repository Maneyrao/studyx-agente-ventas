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
  /** Prior committed turns plus the current committed turn (Rule A, owner 2026-11-02). */
  readonly observed_price_objection_count: number;
  readonly required_price_objection_count: 2;
  readonly call_invitation_status: 'not_offered' | 'offered' | 'accepted' | 'declined';
  readonly call_offer_count: number;
  readonly may_offer_call: boolean;
  /** `call_invitation` is retained in the wire enum for old snapshots; Rule A never emits it. */
  readonly missing_steps: readonly ('recorded_price_objections' | 'call_invitation')[];
  readonly price_only_barrier_confirmed?: boolean;
  /** This turn's committed model memory recorded a price objection (escalation needs it). */
  readonly current_turn_price_objection?: boolean;
  /** Promo/discount request or confirmed price probe this turn (owner 2026-11-02). */
  readonly instant_trigger?: boolean;
}

/** Rule A trigger (AGENTS.md, owner decision 2026-11-02): a second recorded
 * price objection, or the customer confirmed price is the only barrier.
 * Model memory only; never customer-text heuristics. No call prerequisite. */
export function deriveCourseBonusLadderV1(input: {
  observed_price_objection_count: number;
  call_invitation_status: CourseBonusLadderV1['call_invitation_status'];
  call_offer_count: number; may_offer_call: boolean;
  price_only_barrier_confirmed?: boolean;
}): CourseBonusLadderV1 {
  const priceOnly = input.price_only_barrier_confirmed === true;
  const missing: ('recorded_price_objections' | 'call_invitation')[] = [];
  if (!priceOnly && (!Number.isInteger(input.observed_price_objection_count) || input.observed_price_objection_count < 2)) {
    missing.push('recorded_price_objections');
  }
  return { ...input, price_only_barrier_confirmed: priceOnly, eligible: missing.length === 0,
    required_price_objection_count: 2, missing_steps: missing };
}
