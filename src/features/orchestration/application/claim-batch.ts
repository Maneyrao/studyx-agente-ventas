import { evaluateTurnPolicy, type TurnPolicy } from '../domain/turn-policy';
import type { BusinessContextView } from '../domain/business-context';
import { capRetrievedItems } from '../domain/retrieved-context';
import { classifyBatchSalesSignal } from '../domain/sales-signal';
import { evaluateCallOfferPolicy } from '../domain/call-offer-policy';
import type {
  ActiveCallFact,
  BatchMessage,
  ClaimedCallFacts,
  ClaimOutcome,
  LastCallResultFact,
  OrchestrationStore,
  RecentTurn,
} from '../ports/orchestration-store';
import type {
  KnowledgeRetriever,
  MemoryRetriever,
  RetrievedKnowledge,
  RetrievedMemory,
} from '../ports/retrieval';

/**
 * Claim a batch and, only if this caller won it, build the one controlled
 * context the model is allowed to see.
 *
 * Two rules shape this use case:
 *
 * 1. Nothing derived happens before the claim. A losing caller must cost
 *    nothing — no embedding, no summary, no knowledge lookup — otherwise a
 *    five-message burst pays five times for one answer.
 * 2. Retrieval is advisory. pgvector or Gemini failing degrades the context and
 *    flags it; it never fails the turn. Structured facts and recent messages
 *    are always present, which is what the contradiction priority order in the
 *    memory strategy depends on.
 */

export interface ClaimBatchDependencies {
  readonly store: OrchestrationStore;
  readonly memory: MemoryRetriever;
  readonly knowledge: KnowledgeRetriever;
  readonly limits: ContextLimits;
  readonly log?: (event: string, fields: Record<string, unknown>) => void;
  /** Clock for the call-offer policy's offer-expiry and cooldown math. Defaults to the real time. */
  readonly now?: () => string;
  /**
   * Loads the configured workspace's business context. Optional and
   * degradable like retrieval: absence or failure yields
   * `business_context: null` with the availability flag down, never a
   * blocked turn. The workspace is fixed by backend configuration — this
   * dependency takes no argument a caller could vary per request.
   */
  readonly business?: { load(): Promise<BusinessContextView | null> };
}

export interface ContextLimits {
  readonly recentTurns: number;
  readonly memoryResults: number;
  readonly memoryMinSimilarity: number;
  readonly memoryMaxChars: number;
  readonly knowledgeResults: number;
  readonly knowledgeMinSimilarity: number;
  readonly knowledgeMaxCharsPerItem: number;
  readonly knowledgeMaxTotalChars: number;
  readonly leaseMs: number;
}

export const DEFAULT_CONTEXT_LIMITS: ContextLimits = {
  recentTurns: 10,
  // 2-5 memories. Beyond that the recalled text starts outweighing the
  // structured facts it is supposed to lose against.
  memoryResults: 5,
  memoryMinSimilarity: 0.75,
  memoryMaxChars: 512,
  knowledgeResults: 5,
  knowledgeMinSimilarity: 0.75,
  knowledgeMaxCharsPerItem: 1_200,
  knowledgeMaxTotalChars: 4_000,
  leaseMs: 120_000,
};

export interface ClaimBatchInput {
  readonly batch_id: string;
  readonly claimed_by: string;
  readonly trace_id: string;
}

/**
 * The controlled sales/call context handed to Agent A on every claimed turn.
 *
 * `allowed_actions` is the only thing this shape grants — it is always the
 * pure call-offer policy's output, never re-derived or widened here. `mode`
 * is a coarse label over the same underlying facts (open offer, active call,
 * last call result) so the prompt can describe where the conversation is
 * without re-deriving it. `course_of_interest` has no source in this task:
 * a later task lets Agent A's own decision supply it, so it stays `null`
 * until then — inventing a heuristic for it here would be a guess, not a fact.
 */
export interface ClaimedSalesContext {
  readonly mode: 'advising' | 'awaiting_call_consent' | 'call_pending' | 'in_call' | 'post_call';
  readonly course_of_interest: string | null;
  readonly open_call_offer: { readonly decision_id: string; readonly expires_at: string } | null;
  readonly active_call: { readonly call_id: string; readonly status: string } | null;
  readonly allowed_actions: Array<'offer_call' | 'request_call_now'>;
  readonly last_call_result: { readonly call_id: string; readonly result: string | null; readonly ended_at: string } | null;
}

export interface ClaimedTurn {
  readonly outcome: 'claimed';
  readonly trace_id: string;
  readonly batch: {
    readonly id: string;
    readonly claim_token: string;
    readonly conversation_id: string;
    readonly contact_id: string;
    readonly lease_until: string;
    readonly hard_deadline_at: string;
    readonly message_count: number;
    readonly stolen: boolean;
  };
  readonly turn_id: string;
  readonly policy: TurnPolicy;
  readonly contact: {
    readonly id: string;
    readonly status: 'prospecto' | 'cliente' | 'inactivo';
    readonly name: string | null;
    readonly blocked: boolean;
    readonly consent_status: 'allowed' | 'revoked' | 'unknown';
    readonly opted_in_at: string;
  };
  readonly context: {
    /** The messages this decision must answer, in stable order. */
    readonly batch_messages: BatchMessage[];
    readonly recent_turns: RecentTurn[];
    readonly summary: { text: string | null; version: number; updated_at: string | null };
    readonly selected_memories: RetrievedMemory[];
    readonly long_term_memory_available: boolean;
    readonly knowledge_base: RetrievedKnowledge[];
    readonly knowledge_base_available: boolean;
    /** Results the budget refused. Reported so a cap is never a silent omission. */
    readonly knowledge_base_dropped: number;
    /** Retrieved documents that tried to read as instructions. */
    readonly injection_suspected_count: number;
  };
  readonly sales_context: ClaimedSalesContext;
  /** Configured workspace's commercial facts; null when unavailable. */
  readonly business_context: BusinessContextView | null;
  readonly business_context_available: boolean;
  readonly existing_result: {
    readonly decision_id: string;
    readonly outbound_id: string | null;
    readonly delivery_status: string | null;
    readonly next_state: 'completed' | 'waiting_user';
  } | null;
}

export interface UnclaimedTurn {
  readonly outcome: Exclude<ClaimOutcome, 'claimed'>;
  readonly trace_id: string;
  readonly batch_id: string;
  readonly retry_after_ms: number;
}

export type ClaimBatchResult = ClaimedTurn | UnclaimedTurn;

export class BatchFactsMissingError extends Error {
  readonly code = 'BATCH_FACTS_MISSING';
  constructor(batch_id: string) {
    super(`Claimed batch has no readable facts: ${batch_id}`);
    this.name = 'BatchFactsMissingError';
  }
}

function mapDeliveryStatus(state: string | null): string | null {
  if (state === 'submitted' || state === 'delivered') return 'submitted_to_botpress';
  if (state === 'failed_retryable' || state === 'dead_letter' || state === 'cancelled') return 'failed';
  return state;
}

/**
 * The retrieval query is the batch as the customer wrote it. Using only the
 * last message would miss the burst's actual subject ("hola" / "sobre el curso"
 * / "cuánto sale").
 */
function retrievalQuery(messages: BatchMessage[]): string {
  return messages
    .map((message) => message.content)
    .join('\n')
    .slice(0, 4096)
    .trim();
}

/**
 * A call in one of the ledger's active statuses is `in_progress` (the call is
 * actually connected) or one of the other active statuses (still being set
 * up). Everything else about the status string is opaque to this layer.
 */
function deriveSalesMode(input: {
  activeCall: ActiveCallFact | null;
  openCallOffer: { decision_id: string; expires_at: string } | null;
  lastCallResult: LastCallResultFact | null;
}): ClaimedSalesContext['mode'] {
  if (input.activeCall) {
    return input.activeCall.status === 'in_progress' ? 'in_call' : 'call_pending';
  }
  if (input.openCallOffer) return 'awaiting_call_consent';
  // A call happened and nothing newer (offer or call) has started since.
  // The turn that actually delivers the handback is a later task's job; this
  // context only reports that the most recent sales event was a finished call.
  if (input.lastCallResult) return 'post_call';
  return 'advising';
}

/**
 * Combine the raw call facts with the deterministic policy from Task 1 into
 * the bounded shape Agent A is allowed to see. This is the only place that
 * calls `evaluateCallOfferPolicy` — the adapter never touches policy, and the
 * policy itself never touches SQL.
 */
function buildSalesContext(input: {
  callFacts: ClaimedCallFacts;
  batchMessageTexts: readonly string[];
  consentRevoked: boolean;
  blocked: boolean;
  now: string;
}): ClaimedSalesContext {
  // The whole burst is classified, newest decisive message first: a direct
  // "llamame" buried under a trailing "gracias" still opens the call path,
  // and a decline after an earlier request still wins.
  const signal = classifyBatchSalesSignal(input.batchMessageTexts);
  const policyResult = evaluateCallOfferPolicy({
    now: input.now,
    signal,
    openOffer: input.callFacts.open_offer
      ? { decisionId: input.callFacts.open_offer.decision_id, offeredAt: input.callFacts.open_offer.offered_at }
      : null,
    // The durable decline marker (intent = 'commercial_decline') loaded with
    // the other call facts; drives the 30-minute cooldown across turns.
    lastDeclineAt: input.callFacts.last_decline_at,
    optedOut: input.consentRevoked,
    blocked: input.blocked,
    activeCall: input.callFacts.active_call !== null,
  });

  const openCallOffer = policyResult.openOffer
    ? { decision_id: policyResult.openOffer.decisionId, expires_at: policyResult.openOffer.expiresAt }
    : null;

  return {
    mode: deriveSalesMode({
      activeCall: input.callFacts.active_call,
      openCallOffer,
      lastCallResult: input.callFacts.last_call_result,
    }),
    course_of_interest: null,
    open_call_offer: openCallOffer,
    active_call: input.callFacts.active_call,
    allowed_actions: policyResult.allowedActions,
    last_call_result: input.callFacts.last_call_result,
  };
}

export async function claimBatch(
  input: ClaimBatchInput,
  deps: ClaimBatchDependencies
): Promise<ClaimBatchResult> {
  const { store, memory, knowledge, limits } = deps;
  const log = deps.log ?? (() => {});

  const claim = await store.claimBatch({
    batch_id: input.batch_id,
    claimed_by: input.claimed_by,
    lease_ms: limits.leaseMs,
  });

  if (claim.outcome !== 'claimed') {
    log('orchestration.claim.not_owner', {
      trace_id: input.trace_id,
      batch_id: input.batch_id,
      outcome: claim.outcome,
    });
    return {
      outcome: claim.outcome,
      trace_id: input.trace_id,
      batch_id: claim.batch_id,
      retry_after_ms: claim.retry_after_ms,
    };
  }

  const [facts, batchMessages, callFacts] = await Promise.all([
    store.loadClaimedTurnFacts({
      batch_id: claim.batch_id,
      recent_turns_limit: limits.recentTurns,
    }),
    store.listBatchMessages(claim.batch_id),
    // Scoped to this batch's own contact and conversation, same as every
    // other claim-time read. A database outage here is fatal, like any other
    // store call — it is deliberately not wrapped in try/catch.
    store.loadClaimedCallFacts({ contact_id: claim.contact_id!, conversation_id: claim.conversation_id! }),
  ]);

  if (!facts) throw new BatchFactsMissingError(claim.batch_id);

  const policy = evaluateTurnPolicy({
    contact_status: facts.contact.status,
    lifecycle_status: facts.contact.lifecycle_status,
    deleted_at: facts.contact.deleted_at,
    consent_status: facts.contact.consent_status,
    // The opt-out itself is recorded at ingest, which is what revokes consent;
    // by claim time the revocation is the structured fact we trust.
    explicit_opt_out: false,
    unsupported_message: facts.unsupported_message,
  });

  const query = retrievalQuery(batchMessages);

  // A suppressed turn produces no answer, so paying for retrieval would be pure
  // waste — and running a vector search for a blocked contact is exactly the
  // kind of work that should never happen.
  const shouldRetrieve = policy.may_respond && query.length > 0;

  let selected_memories: RetrievedMemory[] = [];
  let long_term_memory_available = true;
  let knowledge_base: RetrievedKnowledge[] = [];
  let knowledge_base_available = true;
  let knowledge_base_dropped = 0;
  let injection_suspected_count = 0;

  if (shouldRetrieve) {
    const [memoryResult, knowledgeResult] = await Promise.allSettled([
      memory.search({
        contact_id: facts.contact.id,
        query,
        limit: limits.memoryResults,
        min_similarity: limits.memoryMinSimilarity,
      }),
      knowledge.search({
        query,
        limit: limits.knowledgeResults,
        min_similarity: limits.knowledgeMinSimilarity,
      }),
    ]);

    if (memoryResult.status === 'fulfilled') {
      // Memories were already validated structurally at write time, so the cap
      // here is purely a budget: a long recalled value must not crowd out the
      // structured facts that outrank it.
      selected_memories = memoryResult.value
        .slice(0, limits.memoryResults)
        .map((memory) => ({
          ...memory,
          value: memory.value.slice(0, limits.memoryMaxChars),
          source_quote: memory.source_quote.slice(0, limits.memoryMaxChars),
        }));
    } else {
      long_term_memory_available = false;
      log('orchestration.claim.memory_unavailable', {
        trace_id: input.trace_id,
        batch_id: claim.batch_id,
        error: String(memoryResult.reason),
      });
    }

    if (knowledgeResult.status === 'fulfilled') {
      // A knowledge chunk is authored third-party text. It gets a hard budget
      // and its structural injection tricks removed before it can reach a
      // prompt; what survives stays data, never an instruction.
      const capped = capRetrievedItems(knowledgeResult.value, (item) => item.content, {
        maxItems: limits.knowledgeResults,
        maxCharsPerItem: limits.knowledgeMaxCharsPerItem,
        maxTotalChars: limits.knowledgeMaxTotalChars,
      });
      knowledge_base = capped.kept.map((entry) => ({ ...entry.item, content: entry.text }));
      knowledge_base_dropped = capped.dropped;
      injection_suspected_count = capped.injection_suspected_count;
      if (capped.injection_suspected_count > 0) {
        log('orchestration.claim.knowledge_injection_suspected', {
          trace_id: input.trace_id,
          batch_id: claim.batch_id,
          suspected: capped.injection_suspected_count,
          sources: capped.kept
            .filter((entry) => entry.injection_suspected)
            .map((entry) => entry.item.source_uri),
        });
      }
    } else {
      knowledge_base_available = false;
      log('orchestration.claim.knowledge_unavailable', {
        trace_id: input.trace_id,
        batch_id: claim.batch_id,
        error: String(knowledgeResult.reason),
      });
    }
  }

  const salesContext = buildSalesContext({
    callFacts,
    // Each message is classified on its own, never joined into one string —
    // concatenation would blur an unambiguous short reply ("sí") into a
    // longer text the classifier must not guess at.
    batchMessageTexts: batchMessages.map((message) => message.content),
    consentRevoked: facts.contact.consent_status === 'revoked',
    blocked: policy.blocked,
    now: (deps.now ?? (() => new Date().toISOString()))(),
  });

  // Business context is advisory like retrieval: a missing workspace or a
  // failed read degrades the turn, it never blocks it. Suppressed turns skip
  // the read entirely — no prompt will be built, so the data has no consumer.
  let business_context: BusinessContextView | null = null;
  let business_context_available = false;
  if (policy.may_respond && deps.business) {
    try {
      business_context = await deps.business.load();
      business_context_available = business_context !== null;
      if (!business_context_available) {
        log('orchestration.claim.business_context_missing', {
          trace_id: input.trace_id,
          batch_id: claim.batch_id,
        });
      }
    } catch (error) {
      log('orchestration.claim.business_context_unavailable', {
        trace_id: input.trace_id,
        batch_id: claim.batch_id,
        error: String(error),
      });
    }
  }

  log('orchestration.claim.claimed', {
    trace_id: input.trace_id,
    batch_id: claim.batch_id,
    contact_id: facts.contact.id,
    message_count: batchMessages.length,
    stolen: claim.stolen,
    may_respond: policy.may_respond,
    long_term_memory_available,
    knowledge_base_available,
    knowledge_base_dropped,
    injection_suspected_count,
    business_context_available,
  });

  return {
    outcome: 'claimed',
    trace_id: input.trace_id,
    batch: {
      id: claim.batch_id,
      claim_token: claim.claim_token!,
      conversation_id: claim.conversation_id!,
      contact_id: claim.contact_id!,
      lease_until: claim.lease_until!,
      hard_deadline_at: claim.hard_deadline_at!,
      message_count: batchMessages.length,
      stolen: claim.stolen,
    },
    turn_id: facts.representative_turn_id,
    policy,
    contact: {
      id: facts.contact.id,
      status: facts.contact.status,
      name: facts.contact.name,
      blocked: policy.blocked,
      consent_status:
        facts.contact.consent_status === 'granted' ? 'allowed' : facts.contact.consent_status,
      opted_in_at: facts.contact.opted_in_at,
    },
    context: {
      batch_messages: batchMessages,
      recent_turns: facts.recent_turns,
      summary: facts.summary,
      selected_memories,
      long_term_memory_available,
      knowledge_base,
      knowledge_base_available,
      knowledge_base_dropped,
      injection_suspected_count,
    },
    sales_context: salesContext,
    business_context,
    business_context_available,
    existing_result: facts.existing_decision
      ? {
          decision_id: facts.existing_decision.decision_id,
          outbound_id: facts.existing_decision.outbound_id,
          delivery_status: mapDeliveryStatus(facts.existing_decision.delivery_state),
          next_state: facts.existing_decision.next_state,
        }
      : null,
  };
}
