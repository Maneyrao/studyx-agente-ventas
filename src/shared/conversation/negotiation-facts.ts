/** Observations only. These fields never authorize an offer or choose a sales step. */
export const PRICE_ONLY_BARRIER_MEMORY_KEY = 'price_only_barrier';
export const PRICE_ONLY_BARRIER_STATUSES = ['confirmed', 'other_barriers_reported'] as const;
export type PriceOnlyBarrierStatusV1 = typeof PRICE_ONLY_BARRIER_STATUSES[number];

export interface RecordedPriceOnlyBarrierV1 {
  readonly status: PriceOnlyBarrierStatusV1;
  readonly offering_code: string | null;
  readonly source_turn_id: string;
  readonly source_message_id: string;
  readonly source_quote: string;
  readonly recorded_at: string;
  readonly interpretation_source: 'committed_agent_observation';
}

export interface RecordedNegotiationFactsV1 {
  /** Uncapped conversation total of distinct prior recorded customer interventions. */
  readonly price_objection_count: number;
  /** Bounded provenance, not the complete list counted above. */
  readonly latest_price_objection_source_turn_ids: readonly string[];
  readonly latest_legacy_price_objection_source_message_ids?: readonly string[];
  readonly price_only_barrier: RecordedPriceOnlyBarrierV1 | { readonly status: 'unknown' };
}

export interface AgentANegotiationContextV1 {
  readonly price_objections: {
    readonly count: number | null;
    readonly scope: 'conversation_prior_recorded_sources';
    readonly latest_source_turn_ids: readonly string[];
    readonly latest_legacy_source_message_ids: readonly string[];
  };
  readonly price_only_barrier: RecordedNegotiationFactsV1['price_only_barrier'];
  readonly call_invitation: {
    readonly status: 'not_offered' | 'offered' | 'accepted' | 'declined';
    readonly count: 0 | 1 | 2;
    readonly authorization: 'authorized' | 'not_authorized';
  };
  /** Offer messages delivered to the customer, not proof of enrollment/activation. */
  readonly delivered_bonus_offers: readonly { readonly code: string; readonly display_name: string; readonly position: number }[] | null;
}
