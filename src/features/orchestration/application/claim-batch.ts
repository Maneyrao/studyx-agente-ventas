import { evaluateTurnPolicy, type TurnPolicy } from '../domain/turn-policy';
import type {
  BatchMessage,
  ClaimOutcome,
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
}

export interface ContextLimits {
  readonly recentTurns: number;
  readonly memoryResults: number;
  readonly memoryMinSimilarity: number;
  readonly knowledgeResults: number;
  readonly knowledgeMinSimilarity: number;
  readonly leaseMs: number;
}

export const DEFAULT_CONTEXT_LIMITS: ContextLimits = {
  recentTurns: 10,
  memoryResults: 5,
  memoryMinSimilarity: 0.75,
  knowledgeResults: 5,
  knowledgeMinSimilarity: 0.75,
  leaseMs: 120_000,
};

export interface ClaimBatchInput {
  readonly batch_id: string;
  readonly claimed_by: string;
  readonly trace_id: string;
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
  };
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

  const [facts, batchMessages] = await Promise.all([
    store.loadClaimedTurnFacts({
      batch_id: claim.batch_id,
      recent_turns_limit: limits.recentTurns,
    }),
    store.listBatchMessages(claim.batch_id),
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
      selected_memories = memoryResult.value.slice(0, limits.memoryResults);
    } else {
      long_term_memory_available = false;
      log('orchestration.claim.memory_unavailable', {
        trace_id: input.trace_id,
        batch_id: claim.batch_id,
        error: String(memoryResult.reason),
      });
    }

    if (knowledgeResult.status === 'fulfilled') {
      knowledge_base = knowledgeResult.value.slice(0, limits.knowledgeResults);
    } else {
      knowledge_base_available = false;
      log('orchestration.claim.knowledge_unavailable', {
        trace_id: input.trace_id,
        batch_id: claim.batch_id,
        error: String(knowledgeResult.reason),
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
    },
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
