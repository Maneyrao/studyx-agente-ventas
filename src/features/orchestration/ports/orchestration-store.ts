/**
 * Port for the canonical orchestration store.
 *
 * The application layer talks to batching, membership and claims only through
 * this interface. It names no driver, no SQL and no Supabase type, so a use
 * case can be exercised against an in-memory double, and so the Postgres
 * adapter stays the single place that knows about `inbound_batches`.
 */

export type BatchState = 'waiting' | 'claimed' | 'completed' | 'abandoned';

export type ClaimOutcome =
  | 'claimed'
  | 'waiting'
  | 'absorbed'
  | 'completed'
  | 'abandoned'
  | 'not_found';

export interface BatchMembership {
  readonly batch_id: string;
  /** false when this message opened the batch, true when it joined an open one. */
  readonly joined: boolean;
  readonly state: BatchState;
  readonly due_at: string;
  readonly hard_deadline_at: string;
  readonly conversation_seq: number;
  readonly message_count: number;
}

export interface BatchClaim {
  readonly outcome: ClaimOutcome;
  readonly batch_id: string;
  /** Present only for `claimed`. Proof of ownership for every later write. */
  readonly claim_token: string | null;
  readonly conversation_id: string | null;
  readonly contact_id: string | null;
  readonly due_at: string | null;
  readonly hard_deadline_at: string | null;
  readonly lease_until: string | null;
  /** How long a `waiting` caller should sleep before asking again. */
  readonly retry_after_ms: number;
  readonly message_count: number;
  /** true when this claim took over an expired lease from a dead owner. */
  readonly stolen: boolean;
}

export type CompleteBatchOutcome = 'completed' | 'duplicate' | 'stale_claim' | 'not_found';

export interface BatchCompletion {
  readonly outcome: CompleteBatchOutcome;
  readonly batch_id: string;
  readonly state: BatchState | null;
}

export interface BatchMessage {
  readonly id: string;
  readonly conversation_seq: number;
  readonly content: string;
  readonly created_at: string;
  readonly message_type: string;
}

export interface StaleClaim {
  readonly batch_id: string;
  readonly conversation_id: string;
  readonly claim_attempt_count: number;
  readonly action: 'abandoned' | 'reclaimable';
}

export interface OpenOrJoinBatchInput {
  readonly conversation_id: string;
  readonly contact_id: string;
  readonly message_id: string;
  readonly window_ms?: number;
  readonly hard_deadline_ms?: number;
}

export interface ClaimBatchInput {
  readonly batch_id: string;
  readonly claimed_by: string;
  readonly lease_ms?: number;
}

export interface CompleteBatchInput {
  readonly batch_id: string;
  readonly claim_token: string;
  readonly last_error_code?: string | null;
}

export interface RecentTurn {
  readonly direction: 'inbound' | 'outbound';
  readonly content: string;
  readonly created_at: string;
}

/**
 * Everything structured a decision may rely on, read once at claim time and
 * scoped by the batch's own contact and conversation. These are the facts that
 * outrank the summary and any retrieved memory when they disagree.
 */
export interface ClaimedTurnFacts {
  readonly contact: {
    readonly id: string;
    readonly status: 'prospecto' | 'cliente' | 'inactivo';
    readonly name: string | null;
    readonly lifecycle_status: 'active' | 'blocked' | 'deleted' | null;
    readonly deleted_at: string | null;
    readonly consent_status: 'unknown' | 'granted' | 'revoked';
    readonly opted_in_at: string;
    readonly pending_turns: number;
  };
  readonly summary: {
    readonly text: string | null;
    readonly version: number;
    readonly updated_at: string | null;
  };
  readonly recent_turns: RecentTurn[];
  readonly representative_turn_id: string;
  readonly unsupported_message: boolean;
  readonly existing_decision: {
    readonly decision_id: string;
    readonly outbound_id: string | null;
    readonly delivery_state: string | null;
    readonly next_state: 'completed' | 'waiting_user';
  } | null;
}

/**
 * The most recent unresolved offer to call the customer, as recorded by the
 * latest immutable `agent_decisions` row with `response_type = 'call_offer'`.
 * Whether it is still live (or has expired) is the call-offer policy's job,
 * not this store's — the adapter reports the raw fact only.
 */
export interface CallOfferFact {
  readonly decision_id: string;
  readonly offered_at: string;
}

/** A call currently in one of `call_sessions`' active statuses for this contact. */
export interface ActiveCallFact {
  readonly call_id: string;
  readonly status: string;
}

/** The most recently ended call for this contact, if any. */
export interface LastCallResultFact {
  readonly call_id: string;
  readonly result: string | null;
  readonly ended_at: string;
}

/**
 * Raw sales/call facts for a claimed batch's own contact and conversation.
 * Deliberately bounded: no phone, no provider credentials, no transcript, no
 * unbounded call analysis. Turning these facts into `allowed_actions` is the
 * pure call-offer policy's job, applied in the application layer — this
 * store never decides anything, it only reports what is durably true.
 */
export interface ClaimedCallFacts {
  readonly open_offer: CallOfferFact | null;
  readonly active_call: ActiveCallFact | null;
  readonly last_call_result: LastCallResultFact | null;
}

export interface OrchestrationStore {
  /**
   * Attach a freshly persisted inbound to the conversation's open window,
   * opening one if none is live. Idempotent per message.
   */
  openOrJoinBatch(input: OpenOrJoinBatchInput): Promise<BatchMembership>;

  /**
   * Take ownership of a batch. At most one caller ever receives `claimed` for a
   * given window; every other concurrent caller receives `absorbed`.
   */
  claimBatch(input: ClaimBatchInput): Promise<BatchClaim>;

  completeBatch(input: CompleteBatchInput): Promise<BatchCompletion>;

  /** Batch members in stable order, scoped to the batch's own conversation. */
  listBatchMessages(batch_id: string): Promise<BatchMessage[]>;

  /** Structured facts for a claimed batch. Never widens beyond its contact. */
  loadClaimedTurnFacts(input: {
    batch_id: string;
    recent_turns_limit: number;
  }): Promise<ClaimedTurnFacts | null>;

  /**
   * Sales/call facts for the claimed batch's own contact and conversation.
   * Never widens beyond either scope. A missing table or query failure is
   * fatal, like any other store read; only an empty result set means "no
   * offer and no call yet" and produces the default advising context.
   */
  loadClaimedCallFacts(input: {
    contact_id: string;
    conversation_id: string;
  }): Promise<ClaimedCallFacts>;

  /** Reconciliation sweep over claims whose lease ran out. */
  expireStaleClaims(input?: {
    max_claim_attempts?: number;
    limit?: number;
  }): Promise<StaleClaim[]>;
}
