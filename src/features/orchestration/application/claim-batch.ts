import { evaluateTurnPolicy, type TurnPolicy } from '../domain/turn-policy';
import type { BusinessContextView, CatalogIndexView } from '../domain/business-context';
import type { SalesContextState } from '@/features/sales/domain/sales-context';
import type { ConversationStateV1 } from '@/features/conversation/domain/conversation-pipeline';
import {
  isCatalogRequestNeutral,
  resolveCatalogRequest,
  type CatalogResolution,
} from '../domain/catalog-resolution';
import { capRetrievedItems } from '../domain/retrieved-context';
import {
  classifyBatchSalesSignal,
  classifyDeterministicSalesSignal,
} from '../domain/sales-signal';
import { evaluateCallOfferPolicy } from '../domain/call-offer-policy';
import { isTrivial } from '@/lib/heuristics/triviality';
import { isExplicitOptOut } from '@/lib/heuristics/opt-out';
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
  QueryEmbedder,
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
  readonly embedding: QueryEmbedder;
  readonly memory: MemoryRetriever;
  readonly knowledge: KnowledgeRetriever;
  readonly limits: ContextLimits;
  readonly log?: (event: string, fields: Record<string, unknown>) => void;
  /** Monotonic wall clock for PII-free stage timings. */
  readonly monotonicNow?: () => number;
  /** Clock for the call-offer policy's offer-expiry and cooldown math. Defaults to the real time. */
  readonly now?: () => string;
  /**
   * Loads the configured workspace's bounded detail snapshot plus its complete
   * compact identity index. The workspace is fixed by backend configuration —
   * this dependency takes no argument a caller could vary per request.
   */
  readonly business?: {
    load(): Promise<BusinessContextView | null>;
    loadCompleteIndex?(): Promise<CatalogIndexView | null>;
    loadByCode?(code: string): Promise<BusinessContextView | null>;
  };
  /** Durable commercial state. It outranks history/vector but not this batch. */
  readonly sales?: { load(contactId: string): Promise<SalesContextState | null> };
  /** Conversation-scoped V1 state. Read only when its rollout flag is on. */
  readonly conversationState?: {
    load(conversationId: string, contactId: string): Promise<ConversationStateV1 | null>;
  };
  /** Single backend-owned rollout flag projected into the claimed contract. */
  readonly conversationPipelineEnabled?: boolean;
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
  // structured facts it is supposed to lose against. Memory is contact-scoped,
  // so a slightly broader threshold is safe and supports meta-questions such
  // as "¿qué objetivo te conté?" whose wording differs from the stored fact.
  memoryResults: 5,
  memoryMinSimilarity: 0.65,
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
  readonly stage: SalesContextState['stage'];
  readonly course_of_interest: string | null;
  /** Stable catalog identity; display names are not unique across academies. */
  readonly offering_code: string | null;
  /** Durable backend-selected plan; never inferred from semantic memory. */
  readonly selected_payment_plan: SalesContextState['selected_payment_plan'];
  readonly open_call_offer: { readonly decision_id: string; readonly expires_at: string } | null;
  /** Live offer consumed by this turn's explicit acceptance. */
  readonly accepted_call_offer: { readonly decision_id: string; readonly expires_at: string } | null;
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
  readonly features: {
    readonly conversation_pipeline_v1_enabled: boolean;
  };
  readonly conversation_state_v1: Pick<
    ConversationStateV1,
    | 'selected_offering_code'
    | 'selected_payment_plan'
    | 'stage'
    | 'call_preference'
    | 'call_offer_status'
    | 'awaiting_reply'
    | 'version'
  > | null;
  /** Current-batch catalog verdict from the complete compact identity index. */
  readonly catalog_resolution: CatalogResolution;
  /** Complete compact index; detail payload remains separately bounded. */
  readonly catalog_index: CatalogIndexView | null;
  /** Backend-classified route consumed by Botpress; null means a model is required. */
  readonly deterministic_route:
    | 'greeting'
    | 'call_direct_request'
    | 'call_accepted_offer'
    | 'call_acceptance_clarification'
    | null;
  readonly diagnostics: {
    readonly timings: {
      readonly claim_total_ms: number;
      readonly core_db_ms: number;
      readonly shared_embedding_ms: number;
      readonly memory_search_ms: number;
      readonly knowledge_search_ms: number;
      readonly business_snapshot_ms: number;
    };
    readonly counters: {
      readonly embedding_calls: number;
      readonly memory_search_calls: number;
      readonly knowledge_search_calls: number;
      readonly business_snapshot_calls: number;
      readonly catalog_calls: number;
    };
  };
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

const EXACT_GREETINGS = new Set([
  'hola',
  'buenas',
  'buen dia',
  'buenas tardes',
  'buenas noches',
  'hola buenas',
  'hola buen dia',
  'hola buenas tardes',
  'hola buenas noches',
]);

function normalizeGreeting(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9ñ\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * One backend classifier decides whether retrieval/model work is unnecessary.
 * Botpress consumes the resulting enum; it does not maintain a second regex
 * vocabulary that could drift from the claim-time decision.
 */
function deterministicRoute(input: {
  batchMessages: readonly BatchMessage[];
  policy: TurnPolicy;
  salesContext: ClaimedSalesContext;
}): ClaimedTurn['deterministic_route'] {
  if (
    input.policy.allowed_response_types.includes('social_reply')
    && input.batchMessages.length > 0
    && input.batchMessages.every((message) => (
      message.message_type === 'text' && EXACT_GREETINGS.has(normalizeGreeting(message.content))
    ))
  ) {
    return 'greeting';
  }

  if (input.batchMessages.length !== 1) return null;
  const message = input.batchMessages[0];
  if (message.message_type !== 'text') return null;

  const signal = classifyDeterministicSalesSignal(message.content);
  if (
    signal.type === 'direct_call_request'
    && input.salesContext.allowed_actions.includes('request_call_now')
  ) {
    return 'call_direct_request';
  }
  if (signal.type === 'call_acceptance') {
    if (
      input.salesContext.accepted_call_offer
      && input.salesContext.allowed_actions.includes('request_call_now')
    ) {
      return 'call_accepted_offer';
    }
    if (!input.salesContext.accepted_call_offer) return 'call_acceptance_clarification';
  }
  return null;
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
  const acceptedCallOffer = policyResult.acceptedOffer
    ? {
        decision_id: policyResult.acceptedOffer.decisionId,
        expires_at: policyResult.acceptedOffer.expiresAt,
      }
    : null;

  return {
    mode: deriveSalesMode({
      activeCall: input.callFacts.active_call,
      openCallOffer,
      lastCallResult: input.callFacts.last_call_result,
    }),
    stage: 'exploring',
    course_of_interest: null,
    offering_code: null,
    selected_payment_plan: null,
    open_call_offer: openCallOffer,
    accepted_call_offer: acceptedCallOffer,
    active_call: input.callFacts.active_call,
    allowed_actions: policyResult.allowedActions,
    last_call_result: input.callFacts.last_call_result,
  };
}

function resolveCatalogFromSnapshot(
  messageTexts: readonly string[],
  catalogIndex: CatalogIndexView | null,
): CatalogResolution {
  return resolveCatalogRequest(
    messageTexts,
    catalogIndex === null
      ? null
      : {
          offerings: catalogIndex.offerings,
          offerings_truncated: Math.max(0, catalogIndex.offerings_total - catalogIndex.offerings.length),
        },
  );
}

/** Transitional mirror for old in-process doubles/older producer revisions. */
function indexFromBusinessContext(context: BusinessContextView): CatalogIndexView {
  return {
    as_of: context.as_of,
    offerings_total: context.offerings.length + context.offerings_truncated,
    offerings: context.offerings.map((offering) => ({
      code: offering.code,
      display_name: offering.display_name,
      academy: offering.academy,
      aliases: offering.aliases,
    })),
    injection_suspected_count: context.injection_suspected_count,
  };
}

/**
 * Course state is derived, never guessed or persisted in a second state
 * machine. The current batch wins. Only when it contains no catalog intent do
 * we walk recent inbound turns backwards; an ambiguous, missing or unavailable
 * newer request deliberately clears an older course instead of reviving it.
 */
function deriveCourseSelection(input: {
  current: CatalogResolution;
  currentMessageTexts: readonly string[];
  recentTurns: readonly RecentTurn[];
  catalogIndex: CatalogIndexView | null;
}): Pick<ClaimedSalesContext, 'course_of_interest' | 'offering_code'> {
  if (input.current.kind === 'exact') {
    return {
      course_of_interest: input.current.displayName,
      offering_code: input.current.offeringCode,
    };
  }
  if (
    input.current.kind !== 'no_catalog_intent'
    || !isCatalogRequestNeutral(input.currentMessageTexts)
    || input.catalogIndex === null
  ) {
    return { course_of_interest: null, offering_code: null };
  }

  for (const turn of input.recentTurns.slice().reverse()) {
    if (turn.direction !== 'inbound') continue;
    const historical = resolveCatalogFromSnapshot([turn.content], input.catalogIndex);
    if (historical.kind === 'no_catalog_intent') {
      if (isCatalogRequestNeutral(turn.content)) continue;
      return { course_of_interest: null, offering_code: null };
    }
    if (historical.kind === 'exact') {
      return {
        course_of_interest: historical.displayName,
        offering_code: historical.offeringCode,
      };
    }
    return { course_of_interest: null, offering_code: null };
  }
  return { course_of_interest: null, offering_code: null };
}

export async function claimBatch(
  input: ClaimBatchInput,
  deps: ClaimBatchDependencies
): Promise<ClaimBatchResult> {
  const { store, embedding, memory, knowledge, limits } = deps;
  const log = deps.log ?? (() => {});
  const monotonicNow = deps.monotonicNow ?? (() => Date.now());
  const claimStartedAt = monotonicNow();
  const timings = {
    claim_total_ms: 0,
    core_db_ms: 0,
    shared_embedding_ms: 0,
    memory_search_ms: 0,
    knowledge_search_ms: 0,
    business_snapshot_ms: 0,
  };
  const counters = {
    embedding_calls: 0,
    memory_search_calls: 0,
    knowledge_search_calls: 0,
    business_snapshot_calls: 0,
    catalog_calls: 0,
  };

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

  // One inward port call projects facts, current messages and call state from
  // one database snapshot. Claim/decision locks remain untouched; only the
  // read fan-out is consolidated.
  const coreStartedAt = monotonicNow();
  let core;
  try {
    core = await store.loadClaimedBatchContext({
      batch_id: claim.batch_id,
      recent_turns_limit: limits.recentTurns,
    });
  } finally {
    timings.core_db_ms = Math.max(0, monotonicNow() - coreStartedAt);
  }

  if (!core) throw new BatchFactsMissingError(claim.batch_id);
  const { facts, batch_messages: batchMessages, call_facts: callFacts } = core;

  const explicitOptOut = batchMessages.some(
    (message) => (
      message.message_type === 'text'
      && message.opt_out_ack_eligible === true
      && isExplicitOptOut(message.content)
    ),
  );
  const policy = evaluateTurnPolicy({
    contact_status: facts.contact.status,
    lifecycle_status: facts.contact.lifecycle_status,
    deleted_at: facts.contact.deleted_at,
    consent_status: facts.contact.consent_status,
    // Ingest has already persisted the revocation by claim time. Preserve the
    // current batch evidence as well: it is what authorizes the one legal
    // acknowledgement and must not be confused with an older revocation.
    explicit_opt_out: explicitOptOut,
    unsupported_message: facts.unsupported_message,
  });

  const query = retrievalQuery(batchMessages);

  const initialSalesContext = buildSalesContext({
    callFacts,
    // Each message is classified on its own, never joined into one string —
    // concatenation would blur an unambiguous short reply ("sí") into a
    // longer text the classifier must not guess at.
    batchMessageTexts: batchMessages.map((message) => message.content),
    consentRevoked: facts.contact.consent_status === 'revoked',
    blocked: policy.blocked,
    now: (deps.now ?? (() => new Date().toISOString()))(),
  });
  const deterministic_route = deterministicRoute({
    batchMessages,
    policy,
    salesContext: initialSalesContext,
  });
  const optOutAcknowledgementOnly =
    policy.allowed_response_types.length === 1
    && policy.allowed_response_types[0] === 'opt_out_ack';

  // Commercial data is independent from vector retrieval, so start its one
  // bounded statement immediately and join it only before returning the claim.
  let business_context: BusinessContextView | null = null;
  let business_context_available = false;
  let catalog_index: CatalogIndexView | null = null;
  let persisted_sales_context: SalesContextState | null = null;
  let persisted_conversation_state: ConversationStateV1 | null = null;
  const businessTask = (async () => {
    if (!policy.may_respond || optOutAcknowledgementOnly || !deps.business) return;
    counters.business_snapshot_calls += 1;
    const businessStartedAt = monotonicNow();
    try {
      const [contextResult, indexResult, salesContextResult] = await Promise.all([
        deps.business.load(),
        deps.business.loadCompleteIndex
          ? (counters.catalog_calls += 1, deps.business.loadCompleteIndex())
          : Promise.resolve(null),
        deps.sales ? deps.sales.load(facts.contact.id) : Promise.resolve(null),
      ]);
      business_context = contextResult;
      // Compatibility fallback preserves the old producer's explicit
      // truncation signal. A truncated fallback remains unavailable; a full
      // index is never fabricated from a partial detail payload.
      catalog_index = indexResult ?? (
        contextResult !== null ? indexFromBusinessContext(contextResult) : null
      );
      persisted_sales_context = salesContextResult;
      business_context_available = business_context !== null;
      if (business_context === null) {
        log('orchestration.claim.business_context_missing', {
          trace_id: input.trace_id,
          batch_id: claim.batch_id,
        });
      } else if (business_context.offerings_truncated > 0) {
        log('orchestration.claim.business_context_truncated', {
          trace_id: input.trace_id,
          batch_id: claim.batch_id,
          offerings_truncated: business_context.offerings_truncated,
        });
      }
      if (catalog_index === null) {
        log('orchestration.claim.catalog_index_missing', {
          trace_id: input.trace_id,
          batch_id: claim.batch_id,
        });
      } else if (catalog_index.offerings_total !== catalog_index.offerings.length) {
        log('orchestration.claim.catalog_index_incomplete', {
          trace_id: input.trace_id,
          batch_id: claim.batch_id,
          offerings_total: catalog_index.offerings_total,
          offerings_loaded: catalog_index.offerings.length,
        });
        // Preserve the explicit count mismatch for the resolver. It returns
        // `snapshot_truncated` rather than collapsing useful diagnostics into
        // the less actionable `snapshot_missing`.
      }
    } catch (error) {
      log('orchestration.claim.business_context_unavailable', {
        trace_id: input.trace_id,
        batch_id: claim.batch_id,
        error: String(error),
      });
    } finally {
      timings.business_snapshot_ms = Math.max(0, monotonicNow() - businessStartedAt);
    }
  })();
  const conversationStateTask = (async () => {
    if (!deps.conversationPipelineEnabled || !deps.conversationState) return;
    try {
      persisted_conversation_state = await deps.conversationState.load(
        claim.conversation_id!,
        facts.contact.id,
      );
    } catch (error) {
      log('orchestration.claim.conversation_state_v1_unavailable', {
        trace_id: input.trace_id,
        batch_id: claim.batch_id,
        error: String(error),
      });
    }
  })();

  // A suppressed turn produces no answer, so paying for retrieval would be pure
  // waste — and running a vector search for a blocked contact is exactly the
  // kind of work that should never happen.
  const shouldRetrieve =
    policy.may_respond
    && !optOutAcknowledgementOnly
    && query.length > 0
    && deterministic_route === null
    && !isTrivial(query)
    && facts.existing_decision === null;

  let selected_memories: RetrievedMemory[] = [];
  let long_term_memory_available = true;
  let knowledge_base: RetrievedKnowledge[] = [];
  let knowledge_base_available = true;
  let knowledge_base_dropped = 0;
  let injection_suspected_count = 0;

  if (shouldRetrieve) {
    let queryEmbedding: readonly number[];
    counters.embedding_calls += 1;
    const embeddingStartedAt = monotonicNow();
    try {
      queryEmbedding = await embedding.embed(query);
    } catch (error) {
      long_term_memory_available = false;
      knowledge_base_available = false;
      log('orchestration.claim.embedding_unavailable', {
        trace_id: input.trace_id,
        batch_id: claim.batch_id,
        error: String(error),
      });
      queryEmbedding = [];
    } finally {
      timings.shared_embedding_ms = Math.max(0, monotonicNow() - embeddingStartedAt);
    }

    if (
      queryEmbedding.length === 0
      && long_term_memory_available
      && knowledge_base_available
    ) {
      long_term_memory_available = false;
      knowledge_base_available = false;
      log('orchestration.claim.embedding_unavailable', {
        trace_id: input.trace_id,
        batch_id: claim.batch_id,
        error: 'EMPTY_EMBEDDING',
      });
    }

    if (queryEmbedding.length > 0) {
      counters.memory_search_calls += 1;
      counters.knowledge_search_calls += 1;
      const measuredMemorySearch = async () => {
        const startedAt = monotonicNow();
        try {
          return await memory.search({
            contact_id: facts.contact.id,
            embedding: queryEmbedding,
            limit: limits.memoryResults,
            min_similarity: limits.memoryMinSimilarity,
          });
        } finally {
          timings.memory_search_ms = Math.max(0, monotonicNow() - startedAt);
        }
      };
      const measuredKnowledgeSearch = async () => {
        const startedAt = monotonicNow();
        try {
          return await knowledge.search({
            embedding: queryEmbedding,
            limit: limits.knowledgeResults,
            min_similarity: limits.knowledgeMinSimilarity,
          });
        } finally {
          timings.knowledge_search_ms = Math.max(0, monotonicNow() - startedAt);
        }
      };
      const [memoryResult, knowledgeResult] = await Promise.allSettled([
        measuredMemorySearch(),
        measuredKnowledgeSearch(),
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
  }

  await Promise.all([businessTask, conversationStateTask]);
  const catalog_resolution = resolveCatalogFromSnapshot(
    batchMessages
      .filter((message) => message.message_type === 'text')
      .map((message) => message.content),
    catalog_index,
  );

  // The index identifies every real offering without bringing every detailed
  // payload into the prompt. Once a course is exact, load only that detail and
  // merge it into the bounded snapshot for factual answers and protected facts.
  if (catalog_resolution.kind === 'exact' && deps.business?.loadByCode) {
    counters.catalog_calls += 1;
    try {
      const detailContext = await deps.business.loadByCode(catalog_resolution.offeringCode);
      const detail = detailContext?.offerings[0] ?? null;
      if (detail !== null) {
        // TypeScript cannot see the write performed by the joined async task;
        // preserve the runtime value explicitly before choosing the merge path.
        const currentContext = business_context as BusinessContextView | null;
        if (currentContext === null) {
          business_context = detailContext;
          business_context_available = business_context !== null;
        } else if (!currentContext.offerings.some((offering) => offering.code === detail.code)) {
          business_context = {
            ...currentContext,
            offerings: [...currentContext.offerings, detail],
          };
        }
      }
    } catch (error) {
      log('orchestration.claim.catalog_detail_unavailable', {
        trace_id: input.trace_id,
        batch_id: claim.batch_id,
        error: String(error),
      });
    }
  }
  const currentSelection = deriveCourseSelection({
    current: catalog_resolution,
    currentMessageTexts: batchMessages
      .filter((message) => message.message_type === 'text')
      .map((message) => message.content),
    recentTurns: facts.recent_turns,
    catalogIndex: catalog_index,
  });
  // Assigned in the joined commercial-context task; make that async boundary
  // explicit to TypeScript without changing the runtime ordering.
  const persistedState = persisted_sales_context as SalesContextState | null;
  const persistedOffering = persistedState?.selected_offering_code ?? null;
  const resolvedCatalogIndex = catalog_index as CatalogIndexView | null;
  const persistedDisplayName = persistedOffering === null
    ? null
    : resolvedCatalogIndex?.offerings.find((offering) => offering.code === persistedOffering)?.display_name ?? null;
  const selection = currentSelection.offering_code === null && persistedOffering !== null
    ? { course_of_interest: persistedDisplayName, offering_code: persistedOffering }
    : currentSelection;
  const salesContext: ClaimedSalesContext = {
    ...initialSalesContext,
    stage: persistedState?.stage ?? initialSalesContext.stage,
    selected_payment_plan: persistedState?.selected_payment_plan ?? null,
    ...selection,
  };
  const persistedConversationState = persisted_conversation_state as ConversationStateV1 | null;
  const conversationStateV1 = deps.conversationPipelineEnabled
    ? persistedConversationState
      ? {
          selected_offering_code: persistedConversationState.selected_offering_code,
          selected_payment_plan: persistedConversationState.selected_payment_plan,
          stage: persistedConversationState.stage,
          call_preference: persistedConversationState.call_preference,
          call_offer_status: persistedConversationState.call_offer_status,
          awaiting_reply: persistedConversationState.awaiting_reply,
          version: persistedConversationState.version,
        }
      : {
          selected_offering_code: salesContext.offering_code,
          selected_payment_plan: salesContext.selected_payment_plan,
          stage: salesContext.stage,
          call_preference: 'unknown' as const,
          call_offer_status: salesContext.open_call_offer ? 'offered' as const : 'not_offered' as const,
          awaiting_reply: salesContext.open_call_offer ? 'call_or_chat' as const : 'none' as const,
          version: 0,
        }
    : null;
  timings.claim_total_ms = Math.max(0, monotonicNow() - claimStartedAt);

  log('orchestration.claim.timings', {
    trace_id: input.trace_id,
    batch_id: claim.batch_id,
    ...timings,
    ...counters,
  });

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
    catalog_resolution: catalog_resolution.kind,
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
    features: {
      conversation_pipeline_v1_enabled: deps.conversationPipelineEnabled === true,
    },
    conversation_state_v1: conversationStateV1,
    catalog_resolution,
    catalog_index,
    deterministic_route,
    diagnostics: { timings, counters },
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
