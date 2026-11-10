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

/**
 * Persisted facts the bonus motive check needs (AGENTS.md "Bonificación por
 * motivo actual"). A persisted price objection is NOT among them: the motive
 * must come from the current message. `retention_used`: the single retention
 * offer of this conversation was already granted.
 * `previous_turn_asked_price_question`: the previous agent turn declared, as a
 * structured memory, that it asked the price question.
 */
export interface CourseBonusLadderV1 {
  readonly retention_used: boolean;
  readonly previous_turn_asked_price_question: boolean;
  /** An earlier agent message of this conversation stated the paid course price (fact, not interpretation). */
  readonly price_presented?: boolean;
  /**
   * Owner 2026-11-10: the promotion follows the customer's main course. Gifts
   * already delivered in this conversation for ANOTHER paid course; when
   * present, the first gift of the current course needs no new motive and the
   * customer is asked whether to keep the same gift or choose another.
   */
  readonly carried_over_bonus_offerings?: Array<{ code: string; display_name: string }>;
}
