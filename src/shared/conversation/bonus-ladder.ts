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
 * Bonus permission evidence (AGENTS.md "Venta interpretada por el modelo").
 * `price_evidence`: a persisted objection/price_objection or constraint/
 * price_only_barrier memory, or this turn's memory quoted literally from the
 * batch. `retention_used`: the single retention offer of this conversation was
 * already granted. The backend validates a proposal; it never chooses it.
 */
export interface CourseBonusLadderV1 {
  readonly eligible: boolean;
  readonly price_evidence: boolean;
  /** A model-declared purchase decline, quoted from this batch, with the retention offer still unused. */
  readonly retention_decline: boolean;
  readonly retention_used: boolean;
  readonly missing_steps: readonly 'price_evidence'[];
}

export function deriveCourseBonusLadderV1(input: {
  readonly price_evidence: boolean; readonly retention_decline?: boolean; readonly retention_used: boolean;
}): CourseBonusLadderV1 {
  const retentionDecline = input.retention_decline === true && !input.retention_used;
  const eligible = input.price_evidence || retentionDecline;
  return { eligible, price_evidence: input.price_evidence, retention_decline: retentionDecline,
    retention_used: input.retention_used, missing_steps: eligible ? [] : ['price_evidence'] };
}
