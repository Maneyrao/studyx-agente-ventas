import { describe, expect, it, vi } from 'vitest';
import {
  claimBatch,
  BatchFactsMissingError,
  DEFAULT_CONTEXT_LIMITS,
  type ClaimBatchDependencies,
} from '@/features/orchestration/application/claim-batch';
import type {
  BatchClaim,
  ClaimedCallFacts,
  ClaimedTurnFacts,
  OrchestrationStore,
} from '@/features/orchestration/ports/orchestration-store';
import type { BusinessContextView } from '@/features/orchestration/domain/business-context';
import { matchCallHandoffFastPath } from '../../../botpress-agent/src/utils/call-handoff-fast-path';
import {
  ClaimedTurnSchema,
  type ClaimedTurn as BotpressClaimedTurn,
} from '../../../botpress-agent/src/schemas/contracts';

/**
 * The use case is exercised entirely through its ports — no database, no HTTP.
 * That is what makes the degradation guarantees testable at all: forcing a
 * pgvector outage against a real cluster is awkward, forcing a rejected promise
 * from a double is trivial.
 */

describe('default retrieval thresholds', () => {
  it('keeps contact-scoped memory recall broader than tenant knowledge recall', () => {
    expect(DEFAULT_CONTEXT_LIMITS.memoryMinSimilarity).toBe(0.65);
    expect(DEFAULT_CONTEXT_LIMITS.knowledgeMinSimilarity).toBe(0.75);
  });
});

function claim(overrides: Partial<BatchClaim> = {}): BatchClaim {
  return {
    outcome: 'claimed',
    batch_id: 'batch-1',
    claim_token: 'token-1',
    conversation_id: 'conversation-1',
    contact_id: 'contact-1',
    due_at: '2026-08-11T12:00:02.000Z',
    hard_deadline_at: '2026-08-11T12:00:04.000Z',
    lease_until: '2026-08-11T12:02:00.000Z',
    retry_after_ms: 0,
    message_count: 2,
    stolen: false,
    ...overrides,
  };
}

function facts(overrides: Partial<ClaimedTurnFacts> = {}): ClaimedTurnFacts {
  return {
    contact: {
      id: 'contact-1',
      status: 'prospecto',
      name: 'Ana',
      lifecycle_status: 'active',
      deleted_at: null,
      consent_status: 'granted',
      opted_in_at: '2026-08-01T00:00:00.000Z',
      pending_turns: 3,
    },
    summary: { text: 'Consultó por el curso de ventas.', version: 4, updated_at: '2026-08-10T00:00:00.000Z' },
    recent_turns: [{ direction: 'inbound', content: 'hola', created_at: '2026-08-11T11:59:00.000Z' }],
    representative_turn_id: 'turn-1',
    unsupported_message: false,
    existing_decision: null,
    ...overrides,
  };
}

function callFacts(overrides: Partial<ClaimedCallFacts> = {}): ClaimedCallFacts {
  return {
    open_offer: null,
    active_call: null,
    last_call_result: null,
    last_decline_at: null,
    ...overrides,
  };
}

type ClaimedResult = Extract<Awaited<ReturnType<typeof claimBatch>>, { outcome: 'claimed' }>;

function withWireUuids(result: ClaimedResult) {
  return {
    ...result,
    trace_id: '00000000-0000-4000-8000-000000000001',
    turn_id: '00000000-0000-4000-8000-000000000002',
    batch: {
      ...result.batch,
      id: '00000000-0000-4000-8000-000000000003',
      claim_token: '00000000-0000-4000-8000-000000000004',
      conversation_id: '00000000-0000-4000-8000-000000000005',
      contact_id: '00000000-0000-4000-8000-000000000006',
    },
    contact: { ...result.contact, id: '00000000-0000-4000-8000-000000000006' },
    context: {
      ...result.context,
      batch_messages: result.context.batch_messages.map((message, index) => ({
        ...message,
        id: `00000000-0000-4000-8000-${String(index + 10).padStart(12, '0')}`,
      })),
    },
  };
}

function buildDeps(options: {
  claimResult?: BatchClaim;
  factsResult?: ClaimedTurnFacts | null;
  callFactsResult?: ClaimedCallFacts;
  messagesResult?: Array<{
    id: string;
    conversation_seq: number;
    content: string;
    created_at: string;
    message_type: string;
    opt_out_ack_eligible?: boolean;
  }>;
  embedding?: { embed(query: string): Promise<readonly number[]> };
  memory?: ClaimBatchDependencies['memory'];
  knowledge?: ClaimBatchDependencies['knowledge'];
  now?: () => string;
} = {}): ClaimBatchDependencies & { store: OrchestrationStore } {
  const messages = options.messagesResult ?? [
    { id: 'm1', conversation_seq: 1, content: 'hola', created_at: '2026-08-11T12:00:00.000Z', message_type: 'text' },
    { id: 'm2', conversation_seq: 2, content: '¿cuánto sale el curso?', created_at: '2026-08-11T12:00:01.000Z', message_type: 'text' },
  ];
  const selectedFacts = options.factsResult === undefined ? facts() : options.factsResult;
  const selectedCallFacts = options.callFactsResult ?? callFacts();
  const store = {
    openOrJoinBatch: vi.fn(),
    claimBatch: vi.fn().mockResolvedValue(options.claimResult ?? claim()),
    completeBatch: vi.fn(),
    listBatchMessages: vi.fn().mockResolvedValue(messages),
    loadClaimedTurnFacts: vi
      .fn()
      .mockResolvedValue(selectedFacts),
    loadClaimedCallFacts: vi.fn().mockResolvedValue(selectedCallFacts),
    loadClaimedBatchContext: vi.fn().mockResolvedValue(
      selectedFacts === null
        ? null
        : { facts: selectedFacts, batch_messages: messages, call_facts: selectedCallFacts }
    ),
    expireStaleClaims: vi.fn(),
  } as unknown as OrchestrationStore;

  return {
    store,
    embedding: options.embedding ?? { embed: vi.fn().mockResolvedValue([0.125, -0.25, 0.5]) },
    memory: options.memory ?? { search: vi.fn().mockResolvedValue([]) },
    knowledge: options.knowledge ?? { search: vi.fn().mockResolvedValue([]) },
    limits: DEFAULT_CONTEXT_LIMITS,
    now: options.now,
  } as ClaimBatchDependencies & { store: OrchestrationStore };
}

const input = { batch_id: 'batch-1', claimed_by: 'workflow-1', trace_id: 'trace-1' };

describe('claimBatch', () => {
  it('returns the controlled context to the caller that owns the batch', async () => {
    const deps = buildDeps();
    const result = await claimBatch(input, deps);

    expect(result.outcome).toBe('claimed');
    if (result.outcome !== 'claimed') return;

    expect(result.batch.claim_token).toBe('token-1');
    expect(result.turn_id).toBe('turn-1');
    expect(result.context.batch_messages.map((m) => m.conversation_seq)).toEqual([1, 2]);
    expect(result.context.summary.version).toBe(4);
    expect(result.context.recent_turns).toHaveLength(1);
  });

  it('loads facts, batch messages and call facts through one core snapshot port', async () => {
    const deps = buildDeps();

    await claimBatch(input, deps);

    expect(deps.store.loadClaimedBatchContext).toHaveBeenCalledTimes(1);
    expect(deps.store.loadClaimedBatchContext).toHaveBeenCalledWith({
      batch_id: 'batch-1',
      recent_turns_limit: DEFAULT_CONTEXT_LIMITS.recentTurns,
    });
    expect(deps.store.loadClaimedTurnFacts).not.toHaveBeenCalled();
    expect(deps.store.listBatchMessages).not.toHaveBeenCalled();
    expect(deps.store.loadClaimedCallFacts).not.toHaveBeenCalled();
  });

  it.each(['waiting', 'absorbed', 'completed', 'abandoned', 'not_found'] as const)(
    'does no derived work when the outcome is %s',
    async (outcome) => {
      const memory = { search: vi.fn().mockResolvedValue([]) };
      const knowledge = { search: vi.fn().mockResolvedValue([]) };
      const deps = buildDeps({
        claimResult: claim({ outcome, claim_token: null, retry_after_ms: 1500 }),
        memory,
        knowledge,
      });

      const result = await claimBatch(input, deps);

      expect(result.outcome).toBe(outcome);
      // A losing workflow must cost nothing: no embedding, no context read.
      expect(memory.search).not.toHaveBeenCalled();
      expect(knowledge.search).not.toHaveBeenCalled();
      expect(deps.store.loadClaimedBatchContext).not.toHaveBeenCalled();
      expect(deps.store.loadClaimedTurnFacts).not.toHaveBeenCalled();
      expect(deps.store.listBatchMessages).not.toHaveBeenCalled();
      expect(deps.store.loadClaimedCallFacts).not.toHaveBeenCalled();
    }
  );

  it('passes the retry delay through so a waiting caller sleeps the right amount', async () => {
    const deps = buildDeps({
      claimResult: claim({ outcome: 'waiting', claim_token: null, retry_after_ms: 1350 }),
    });
    const result = await claimBatch(input, deps);

    expect(result.outcome).toBe('waiting');
    if (result.outcome === 'claimed') return;
    expect(result.retry_after_ms).toBe(1350);
  });

  it('embeds the whole nontrivial batch exactly once and shares that vector by identity', async () => {
    const vector = [0.125, -0.25, 0.5] as const;
    const embedding = { embed: vi.fn().mockResolvedValue(vector) };
    const memory = { search: vi.fn().mockResolvedValue([]) };
    const knowledge = { search: vi.fn().mockResolvedValue([]) };
    await claimBatch(input, buildDeps({ embedding, memory, knowledge }));

    expect(embedding.embed).toHaveBeenCalledTimes(1);
    expect(embedding.embed).toHaveBeenCalledWith('hola\n¿cuánto sale el curso?');
    expect(memory.search).toHaveBeenCalledWith(
      expect.objectContaining({
        contact_id: 'contact-1',
        embedding: vector,
      })
    );
    expect(knowledge.search).toHaveBeenCalledWith(
      expect.objectContaining({ embedding: vector })
    );
    expect(vi.mocked(memory.search).mock.calls[0][0].embedding).toBe(vector);
    expect(vi.mocked(knowledge.search).mock.calls[0][0].embedding).toBe(vector);
  });

  it('emits PII-free claim timings and structural call counters', async () => {
    const log = vi.fn();
    const result = await claimBatch(input, {
      ...buildDeps(),
      business: { load: vi.fn().mockResolvedValue(businessContextView()) },
      log,
    });

    if (result.outcome !== 'claimed') throw new Error('expected a claim');
    expect(result.diagnostics.timings).toEqual({
      claim_total_ms: expect.any(Number),
      core_db_ms: expect.any(Number),
      shared_embedding_ms: expect.any(Number),
      memory_search_ms: expect.any(Number),
      knowledge_search_ms: expect.any(Number),
      business_snapshot_ms: expect.any(Number),
    });
    expect(result.diagnostics.counters).toEqual({
      embedding_calls: 1,
      memory_search_calls: 1,
      knowledge_search_calls: 1,
      business_snapshot_calls: 1,
      catalog_calls: 0,
    });

    const timingEvent = log.mock.calls.find(([event]) => event === 'orchestration.claim.timings');
    expect(timingEvent).toBeDefined();
    const serialized = JSON.stringify(timingEvent?.[1] ?? {});
    expect(serialized).not.toContain('Ana');
    expect(serialized).not.toContain('contact-1');
    expect(serialized).not.toContain('¿cuánto sale el curso?');
  });

  it('lets new Botpress parse a legacy backend claim without hot-path fields', async () => {
    const result = await claimBatch(input, buildDeps());
    if (result.outcome !== 'claimed') throw new Error('expected a claim');

    const legacyBackendPayload: Record<string, unknown> = { ...withWireUuids(result) };
    delete legacyBackendPayload.deterministic_route;
    delete legacyBackendPayload.diagnostics;

    const parsed = ClaimedTurnSchema.parse(legacyBackendPayload);
    expect(parsed.deterministic_route).toBeNull();
    expect(parsed.diagnostics).toEqual({
      timings: {
        claim_total_ms: 0,
        core_db_ms: 0,
        shared_embedding_ms: 0,
        memory_search_ms: 0,
        knowledge_search_ms: 0,
        business_snapshot_ms: 0,
      },
      counters: {
        embedding_calls: 0,
        memory_search_calls: 0,
        knowledge_search_calls: 0,
        business_snapshot_calls: 0,
        catalog_calls: 0,
      },
    });
  });

  it('lets new Botpress parse a legacy non-null business snapshot fail closed', async () => {
    const result = await claimBatch(input, {
      ...buildDeps(),
      business: { load: vi.fn().mockResolvedValue(businessContextView()) },
    });
    if (result.outcome !== 'claimed') throw new Error('expected a claim');

    const wireResult = withWireUuids(result);
    if (!wireResult.business_context) throw new Error('expected business context');
    const legacyBusinessContext: Record<string, unknown> = { ...wireResult.business_context };
    delete legacyBusinessContext.as_of;
    delete legacyBusinessContext.prices_assertable;

    const parsed = ClaimedTurnSchema.parse({
      ...wireResult,
      business_context: legacyBusinessContext,
      business_context_available: true,
    });

    expect(parsed.business_context?.as_of).toBeNull();
    expect(parsed.business_context?.prices_assertable).toBe(false);
  });

  it('accepts additive future diagnostics without invalidating a claim', async () => {
    const result = await claimBatch(input, buildDeps());
    if (result.outcome !== 'claimed') throw new Error('expected a claim');

    const wireResult = withWireUuids(result);
    const parsed = ClaimedTurnSchema.parse({
      ...wireResult,
      diagnostics: {
        ...wireResult.diagnostics,
        schema_version: 2,
        timings: { ...wireResult.diagnostics.timings, provider_queue_ms: 7 },
        counters: { ...wireResult.diagnostics.counters, snapshot_cache_hits: 1 },
      },
    });

    expect((parsed.diagnostics as unknown as Record<string, unknown>).schema_version).toBe(2);
    expect(
      (parsed.diagnostics.timings as unknown as Record<string, unknown>).provider_queue_ms,
    ).toBe(7);
    expect(
      (parsed.diagnostics.counters as unknown as Record<string, unknown>).snapshot_cache_hits,
    ).toBe(1);
  });

  it('degrades to structured context when the memory index fails', async () => {
    const memory = { search: vi.fn().mockRejectedValue(new Error('pgvector down')) };
    const result = await claimBatch(input, buildDeps({ memory }));

    expect(result.outcome).toBe('claimed');
    if (result.outcome !== 'claimed') return;

    expect(result.context.long_term_memory_available).toBe(false);
    expect(result.context.selected_memories).toEqual([]);
    // The facts that outrank memory are still there — the turn is answerable.
    expect(result.context.summary.text).toContain('curso de ventas');
    expect(result.context.recent_turns).toHaveLength(1);
    expect(result.context.batch_messages).toHaveLength(2);
  });

  it('degrades independently when only the knowledge base fails', async () => {
    const knowledge = { search: vi.fn().mockRejectedValue(new Error('kb down')) };
    const memory = {
      search: vi.fn().mockResolvedValue([
        {
          memory_id: 'mem-1',
          type: 'preference',
          key: 'interest',
          value: 'ventas',
          source_quote: 'quiero el curso de ventas',
          similarity: 0.9,
          recorded_at: '2026-08-01T00:00:00.000Z',
        },
      ]),
    };
    const result = await claimBatch(input, buildDeps({ memory, knowledge }));

    if (result.outcome !== 'claimed') throw new Error('expected a claim');
    expect(result.context.knowledge_base_available).toBe(false);
    expect(result.context.long_term_memory_available).toBe(true);
    expect(result.context.selected_memories).toHaveLength(1);
  });

  it('keeps knowledge results when only the memory database search fails', async () => {
    const memory = { search: vi.fn().mockRejectedValue(new Error('memory db down')) };
    const knowledge = {
      search: vi.fn().mockResolvedValue([
        {
          source_uri: 'kb://course/python',
          title: 'Python',
          content: 'Curso de Python.',
          similarity: 0.91,
        },
      ]),
    };

    const result = await claimBatch(input, buildDeps({ memory, knowledge }));

    if (result.outcome !== 'claimed') throw new Error('expected a claim');
    expect(result.context.long_term_memory_available).toBe(false);
    expect(result.context.knowledge_base_available).toBe(true);
    expect(result.context.knowledge_base).toHaveLength(1);
  });

  it('marks both vector sources unavailable when their one shared embedding fails', async () => {
    const embedding = { embed: vi.fn().mockRejectedValue(new Error('embedding provider down')) };
    const memory = { search: vi.fn().mockResolvedValue([]) };
    const knowledge = { search: vi.fn().mockResolvedValue([]) };

    const result = await claimBatch(input, buildDeps({ embedding, memory, knowledge }));

    if (result.outcome !== 'claimed') throw new Error('expected a claim');
    expect(embedding.embed).toHaveBeenCalledTimes(1);
    expect(memory.search).not.toHaveBeenCalled();
    expect(knowledge.search).not.toHaveBeenCalled();
    expect(result.context.long_term_memory_available).toBe(false);
    expect(result.context.knowledge_base_available).toBe(false);
  });

  it('treats an empty shared embedding as unavailable instead of a successful empty search', async () => {
    const embedding = { embed: vi.fn().mockResolvedValue([]) };
    const memory = { search: vi.fn().mockResolvedValue([]) };
    const knowledge = { search: vi.fn().mockResolvedValue([]) };

    const result = await claimBatch(input, buildDeps({ embedding, memory, knowledge }));

    if (result.outcome !== 'claimed') throw new Error('expected a claim');
    expect(memory.search).not.toHaveBeenCalled();
    expect(knowledge.search).not.toHaveBeenCalled();
    expect(result.context.long_term_memory_available).toBe(false);
    expect(result.context.knowledge_base_available).toBe(false);
  });

  it.each([
    { label: 'an unequivocal greeting', messages: ['hola'] },
    { label: 'a deterministic direct call request', messages: ['llamame ahora'] },
  ])('skips embeddings for $label', async ({ messages }) => {
    const embedding = { embed: vi.fn().mockResolvedValue([0.1, 0.2]) };
    const memory = { search: vi.fn().mockResolvedValue([]) };
    const knowledge = { search: vi.fn().mockResolvedValue([]) };
    const deps = buildDeps({
      embedding,
      memory,
      knowledge,
      messagesResult: messages.map((content, index) => ({
        id: `m${index + 1}`,
        conversation_seq: index + 1,
        content,
        created_at: '2026-08-11T12:00:00.000Z',
        message_type: 'text',
      })),
    });

    const result = await claimBatch(input, deps);

    if (result.outcome !== 'claimed') throw new Error('expected a claim');
    expect(result.deterministic_route).not.toBeNull();
    expect(result.diagnostics.counters.embedding_calls).toBe(0);
    expect(embedding.embed).not.toHaveBeenCalled();
    expect(memory.search).not.toHaveBeenCalled();
    expect(knowledge.search).not.toHaveBeenCalled();
  });

  it('never retrieves for a blocked contact', async () => {
    const memory = { search: vi.fn().mockResolvedValue([]) };
    const knowledge = { search: vi.fn().mockResolvedValue([]) };
    const deps = buildDeps({
      factsResult: facts({
        contact: { ...facts().contact, lifecycle_status: 'blocked' },
      }),
      memory,
      knowledge,
    });

    const result = await claimBatch(input, deps);

    if (result.outcome !== 'claimed') throw new Error('expected a claim');
    expect(result.policy.may_respond).toBe(false);
    expect(result.policy.reason).toBe('CONTACT_BLOCKED');
    expect(result.contact.blocked).toBe(true);
    expect(memory.search).not.toHaveBeenCalled();
    expect(knowledge.search).not.toHaveBeenCalled();
  });

  it('never retrieves once consent is revoked', async () => {
    const memory = { search: vi.fn().mockResolvedValue([]) };
    const deps = buildDeps({
      factsResult: facts({ contact: { ...facts().contact, consent_status: 'revoked' } }),
      memory,
    });

    const result = await claimBatch(input, deps);

    if (result.outcome !== 'claimed') throw new Error('expected a claim');
    expect(result.policy.reason).toBe('CONSENT_REVOKED');
    expect(result.contact.consent_status).toBe('revoked');
    expect(memory.search).not.toHaveBeenCalled();
  });

  it('preserves the one opt-out acknowledgement for the batch that revoked consent', async () => {
    const embedding = { embed: vi.fn().mockResolvedValue([0.125, -0.25]) };
    const memory = { search: vi.fn().mockResolvedValue([]) };
    const knowledge = { search: vi.fn().mockResolvedValue([]) };
    const deps = buildDeps({
      factsResult: facts({
        contact: {
          ...facts().contact,
          lifecycle_status: 'blocked',
          consent_status: 'revoked',
        },
      }),
      messagesResult: [{
        id: 'm1',
        conversation_seq: 1,
        content: 'Redes Informáticas, dame de baja',
        created_at: '2026-08-11T12:00:00.000Z',
        message_type: 'text',
        opt_out_ack_eligible: true,
      }],
      embedding,
      memory,
      knowledge,
    });

    const result = await claimBatch(input, deps);

    if (result.outcome !== 'claimed') throw new Error('expected a claim');
    expect(result.policy).toMatchObject({
      may_respond: true,
      allowed_response_types: ['opt_out_ack'],
      reason: 'EXPLICIT_OPT_OUT_ACK_ONLY',
      blocked: true,
    });
    expect(embedding.embed).not.toHaveBeenCalled();
    expect(memory.search).not.toHaveBeenCalled();
    expect(knowledge.search).not.toHaveBeenCalled();
  });

  it('does not acknowledge a repeated opt-out whose transition was already confirmed', async () => {
    const memory = { search: vi.fn().mockResolvedValue([]) };
    const deps = buildDeps({
      factsResult: facts({ contact: { ...facts().contact, consent_status: 'revoked' } }),
      messagesResult: [{
        id: 'm1',
        conversation_seq: 1,
        content: 'Sacame de la lista definitivamente',
        created_at: '2026-08-11T12:00:00.000Z',
        message_type: 'text',
        opt_out_ack_eligible: false,
      }],
      memory,
    });

    const result = await claimBatch(input, deps);

    if (result.outcome !== 'claimed') throw new Error('expected a claim');
    expect(result.policy).toMatchObject({
      may_respond: false,
      allowed_response_types: [],
      reason: 'CONSENT_REVOKED',
    });
    expect(memory.search).not.toHaveBeenCalled();
  });

  it('clamps retrieval to the configured maximums', async () => {
    const many = Array.from({ length: 12 }, (_, index) => ({
      memory_id: `mem-${index}`,
      type: 'preference',
      key: 'interest',
      value: `v${index}`,
      source_quote: `q${index}`,
      similarity: 0.9,
      recorded_at: '2026-08-01T00:00:00.000Z',
    }));
    const deps = buildDeps({ memory: { search: vi.fn().mockResolvedValue(many) } });

    const result = await claimBatch(input, deps);
    if (result.outcome !== 'claimed') throw new Error('expected a claim');
    expect(result.context.selected_memories).toHaveLength(DEFAULT_CONTEXT_LIMITS.memoryResults);
  });

  it('surfaces an existing decision so a replay never answers twice', async () => {
    const deps = buildDeps({
      factsResult: facts({
        existing_decision: {
          decision_id: 'decision-1',
          outbound_id: 'outbound-1',
          delivery_state: 'submitted',
          next_state: 'completed',
        },
      }),
    });

    const result = await claimBatch(input, deps);
    if (result.outcome !== 'claimed') throw new Error('expected a claim');
    expect(result.existing_result).toEqual({
      decision_id: 'decision-1',
      outbound_id: 'outbound-1',
      delivery_status: 'submitted_to_botpress',
      next_state: 'completed',
    });
  });

  it('refuses to hand back a claim it cannot describe', async () => {
    const deps = buildDeps({ factsResult: null });
    await expect(claimBatch(input, deps)).rejects.toBeInstanceOf(BatchFactsMissingError);
  });

  it('narrows the policy when the whole batch is unreadable', async () => {
    const deps = buildDeps({ factsResult: facts({ unsupported_message: true }) });
    const result = await claimBatch(input, deps);

    if (result.outcome !== 'claimed') throw new Error('expected a claim');
    expect(result.policy.allowed_response_types).toEqual(['out_of_scope', 'technical_fallback']);
  });

  it('reports a stolen lease so the caller knows it is a recovery', async () => {
    const deps = buildDeps({ claimResult: claim({ stolen: true }) });
    const result = await claimBatch(input, deps);

    if (result.outcome !== 'claimed') throw new Error('expected a claim');
    expect(result.batch.stolen).toBe(true);
  });
});

function businessContextView(overrides: Partial<BusinessContextView> = {}): BusinessContextView {
  return {
    as_of: '2026-08-11T12:00:00.000Z',
    prices_assertable: false,
    workspace: {
      slug: 'studyx',
      display_name: 'StudyX',
      environment: 'production',
      default_locale: 'es-AR',
      timezone: 'America/Argentina/Buenos_Aires',
      payment_options: [],
    },
    offerings: [],
    qualification_fields: [],
    injection_suspected_count: 0,
    offerings_truncated: 0,
    ...overrides,
  };
}

function businessOffering(
  code: string,
  displayName: string,
  academy: string | null,
): BusinessContextView['offerings'][number] {
  return {
    code,
    display_name: displayName,
    aliases: [],
    academy,
    offering_type: 'course',
    description: null,
    value_proposition: null,
    price_type: 'fixed',
    price: { amount: '360.00', currency: 'USD' },
    price_assertable: true,
    billing_interval: null,
    modality: null,
    schedules: [],
    certification: null,
    hours_per_month: null,
    classes: null,
    modules: null,
    includes: [],
    syllabus_published: null,
    language: null,
    min_age: null,
    policies: {
      allowed_promise: null,
      forbidden_promises: [],
      price_message: null,
    },
  };
}

describe('claimBatch business context', () => {
  it('does not log a truncation event when every offering fits the cap', async () => {
    const log = vi.fn();
    const deps = {
      ...buildDeps(),
      business: { load: vi.fn().mockResolvedValue(businessContextView({ offerings_truncated: 0 })) },
      log,
    };

    await claimBatch(input, deps);

    expect(log).not.toHaveBeenCalledWith(
      'orchestration.claim.business_context_truncated',
      expect.anything()
    );
  });

  it('logs when the business context silently dropped offerings past the cap, so the agent missing real courses is a detectable failure, not a silent one', async () => {
    const log = vi.fn();
    const deps = {
      ...buildDeps(),
      business: { load: vi.fn().mockResolvedValue(businessContextView({ offerings_truncated: 3 })) },
      log,
    };

    const result = await claimBatch(input, deps);

    if (result.outcome !== 'claimed') throw new Error('expected a claim');
    // The truncated context still reaches the agent's prompt (advisory, not
    // blocking) — but the loss must be loud.
    expect(result.business_context?.offerings_truncated).toBe(3);
    expect(log).toHaveBeenCalledWith('orchestration.claim.business_context_truncated', {
      trace_id: input.trace_id,
      batch_id: 'batch-1',
      offerings_truncated: 3,
    });
  });

  it('resolves the current catalog request from the already-loaded snapshot without another catalog call', async () => {
    const messages = [{
      id: 'm1',
      conversation_seq: 1,
      content: 'Quiero el curso de Inglés Nivel 3',
      created_at: '2026-08-11T12:00:00.000Z',
      message_type: 'text',
    }];
    const deps = {
      ...buildDeps({ messagesResult: messages }),
      business: {
        load: vi.fn().mockResolvedValue(businessContextView({
          offerings: [
            businessOffering('ingles_3', 'Inglés Nivel 3', 'Idiomas'),
            businessOffering('diseno_interiores', 'Diseño de Interiores', 'Diseño'),
          ],
        })),
      },
    };

    const result = await claimBatch(input, deps);

    if (result.outcome !== 'claimed') throw new Error('expected a claim');
    expect(result.catalog_resolution).toEqual({
      kind: 'exact',
      offeringCode: 'ingles_3',
      displayName: 'Inglés Nivel 3',
      academy: 'Idiomas',
      match: 'canonical',
    });
    expect(result.sales_context.course_of_interest).toBe('Inglés Nivel 3');
    expect(result.diagnostics.counters.catalog_calls).toBe(0);
    expect(deps.business.load).toHaveBeenCalledTimes(1);
    expect(ClaimedTurnSchema.parse(withWireUuids(result)).catalog_resolution).toEqual(
      result.catalog_resolution,
    );
  });

  it('distinguishes a real not-found result from an incomplete catalog', async () => {
    const messages = [{
      id: 'm1',
      conversation_seq: 1,
      content: 'Quiero aprender Python',
      created_at: '2026-08-11T12:00:00.000Z',
      message_type: 'text',
    }];
    const complete = businessContextView({
      offerings: [businessOffering('ingles_3', 'Inglés Nivel 3', 'Idiomas')],
    });
    const completeResult = await claimBatch(input, {
      ...buildDeps({ messagesResult: messages }),
      business: { load: vi.fn().mockResolvedValue(complete) },
    });
    if (completeResult.outcome !== 'claimed') throw new Error('expected a claim');
    expect(completeResult.catalog_resolution).toMatchObject({
      kind: 'not_found',
      requestedText: 'Quiero aprender Python',
    });
    expect(completeResult.sales_context.course_of_interest).toBeNull();

    const truncatedResult = await claimBatch(input, {
      ...buildDeps({ messagesResult: messages }),
      business: {
        load: vi.fn().mockResolvedValue({ ...complete, offerings_truncated: 1 }),
      },
    });
    if (truncatedResult.outcome !== 'claimed') throw new Error('expected a claim');
    expect(truncatedResult.catalog_resolution).toEqual({
      kind: 'unavailable',
      reason: 'snapshot_truncated',
    });
    expect(truncatedResult.sales_context.course_of_interest).toBeNull();
  });

  it('does not revive a historical course when the current batch selects an unknown course', async () => {
    const messages = [{
      id: 'm1',
      conversation_seq: 1,
      content: 'Quiero Python',
      created_at: '2026-08-11T12:00:00.000Z',
      message_type: 'text',
    }];
    const result = await claimBatch(input, {
      ...buildDeps({
        messagesResult: messages,
        factsResult: facts({
          recent_turns: [{
            direction: 'inbound',
            content: 'Quiero Inglés Nivel 3',
            created_at: '2026-08-11T11:59:00.000Z',
          }],
        }),
      }),
      business: {
        load: vi.fn().mockResolvedValue(businessContextView({
          offerings: [businessOffering('ingles_3', 'Inglés Nivel 3', 'Idiomas')],
        })),
      },
    });

    if (result.outcome !== 'claimed') throw new Error('expected a claim');
    expect(result.catalog_resolution).toMatchObject({
      kind: 'not_found',
      requestedText: 'Quiero Python',
    });
    expect(result.sales_context.course_of_interest).toBeNull();
    expect(result.sales_context.offering_code).toBeNull();
  });

  it('does not preserve a historical course after an explicit course negation', async () => {
    const messages = [{
      id: 'm1',
      conversation_seq: 1,
      content: 'No quiero Marketing Digital',
      created_at: '2026-08-11T12:00:00.000Z',
      message_type: 'text',
    }];
    const result = await claimBatch(input, {
      ...buildDeps({
        messagesResult: messages,
        factsResult: facts({
          recent_turns: [{
            direction: 'inbound',
            content: 'Quiero Marketing Digital',
            created_at: '2026-08-11T11:59:00.000Z',
          }],
        }),
      }),
      business: {
        load: vi.fn().mockResolvedValue(businessContextView({
          offerings: [businessOffering('marketing_digital', 'Marketing Digital', 'Marketing')],
        })),
      },
    });

    if (result.outcome !== 'claimed') throw new Error('expected a claim');
    expect(result.catalog_resolution).toEqual({ kind: 'no_catalog_intent' });
    expect(result.sales_context.course_of_interest).toBeNull();
    expect(result.sales_context.offering_code).toBeNull();
  });

  it('does not preserve a batch course after the latest message cancels it', async () => {
    const messages = [
      {
        id: 'm1',
        conversation_seq: 1,
        content: 'Quiero Marketing Digital',
        created_at: '2026-08-11T12:00:00.000Z',
        message_type: 'text',
      },
      {
        id: 'm2',
        conversation_seq: 2,
        content: 'No mejor no',
        created_at: '2026-08-11T12:00:01.000Z',
        message_type: 'text',
      },
    ];
    const result = await claimBatch(input, {
      ...buildDeps({ messagesResult: messages }),
      business: {
        load: vi.fn().mockResolvedValue(businessContextView({
          offerings: [businessOffering('marketing_digital', 'Marketing Digital', 'Marketing')],
        })),
      },
    });

    if (result.outcome !== 'claimed') throw new Error('expected a claim');
    expect(result.catalog_resolution).toEqual({ kind: 'no_catalog_intent' });
    expect(result.sales_context.course_of_interest).toBeNull();
    expect(result.sales_context.offering_code).toBeNull();
  });

  it('does not preserve a course identity when the current snapshot is truncated', async () => {
    const messages = [{
      id: 'm1',
      conversation_seq: 1,
      content: 'Quiero Marketing Digital',
      created_at: '2026-08-11T12:00:00.000Z',
      message_type: 'text',
    }];
    const result = await claimBatch(input, {
      ...buildDeps({ messagesResult: messages }),
      business: {
        load: vi.fn().mockResolvedValue(businessContextView({
          offerings: [businessOffering('marketing_digital', 'Marketing Digital', 'Marketing')],
          offerings_truncated: 1,
        })),
      },
    });

    if (result.outcome !== 'claimed') throw new Error('expected a claim');
    expect(result.catalog_resolution).toEqual({
      kind: 'unavailable',
      reason: 'snapshot_truncated',
    });
    expect(result.sales_context.course_of_interest).toBeNull();
    expect(result.sales_context.offering_code).toBeNull();
  });

  it('derives the last canonical course for a plan-only follow-up without treating the plan as a catalog request', async () => {
    const messages = [{
      id: 'm1',
      conversation_seq: 1,
      content: 'Elijo 12 cuotas',
      created_at: '2026-08-11T12:00:00.000Z',
      message_type: 'text',
    }];
    const deps = {
      ...buildDeps({
        messagesResult: messages,
        factsResult: facts({
          recent_turns: [{
            direction: 'inbound',
            content: 'Quiero hacer Inglés Nivel 3',
            created_at: '2026-08-11T11:59:00.000Z',
          }],
        }),
      }),
      business: {
        load: vi.fn().mockResolvedValue(businessContextView({
          offerings: [businessOffering('ingles_3', 'Inglés Nivel 3', 'Idiomas')],
        })),
      },
    };

    const result = await claimBatch(input, deps);

    if (result.outcome !== 'claimed') throw new Error('expected a claim');
    expect(result.catalog_resolution).toEqual({ kind: 'no_catalog_intent' });
    expect(result.sales_context.course_of_interest).toBe('Inglés Nivel 3');
    expect(result.sales_context.offering_code).toBe('ingles_3');
  });

  it.each([
    {
      name: 'referential fact follow-up',
      history: ['Quiero Decoración de Interiores'],
      current: '¿Cuántas clases tiene el programa?',
      expectedCode: 'decoracion_de_interiores',
      expectedName: 'Decoración de Interiores',
    },
    {
      name: 'payment confirmation',
      history: ['Quiero Decoración de Interiores'],
      current: 'Confirmo 6 cuotas',
      expectedCode: 'decoracion_de_interiores',
      expectedName: 'Decoración de Interiores',
    },
    {
      name: 'explicit course switch',
      history: ['Quiero Decoración de Interiores'],
      current: 'Mejor Marketing Digital',
      expectedCode: 'marketing_digital',
      expectedName: 'Marketing Digital',
    },
    {
      name: 'referential rejection',
      history: ['Quiero Decoración de Interiores'],
      current: 'No quiero ese curso',
      expectedCode: null,
      expectedName: null,
    },
    {
      name: 'ambiguous new selection',
      history: ['Quiero Decoración de Interiores'],
      current: 'Quiero Fotografía',
      expectedCode: null,
      expectedName: null,
    },
  ])('enforces exact cross-turn SKU precedence for $name', async ({
    history,
    current,
    expectedCode,
    expectedName,
  }) => {
    const result = await claimBatch(input, {
      ...buildDeps({
        messagesResult: [{
          id: 'm1',
          conversation_seq: 1,
          content: current,
          created_at: '2026-08-11T12:00:00.000Z',
          message_type: 'text',
        }],
        factsResult: facts({
          recent_turns: history.map((content) => ({
            direction: 'inbound' as const,
            content,
            created_at: '2026-08-11T11:59:00.000Z',
          })),
        }),
      }),
      business: {
        load: vi.fn().mockResolvedValue(businessContextView({
          offerings: [
            businessOffering(
              'decoracion_de_interiores',
              'Decoración de Interiores',
              'Diseño',
            ),
            businessOffering('marketing_digital', 'Marketing Digital', 'Marketing'),
            businessOffering('fotografia_profesional', 'Fotografía Profesional', 'Fotografía'),
            businessOffering(
              'fotografia_celulares',
              'Fotografía con Celulares para Tiendas Online',
              'Fotografía',
            ),
          ],
        })),
      },
    });

    if (result.outcome !== 'claimed') throw new Error('expected a claim');
    expect(result.sales_context.offering_code).toBe(expectedCode);
    expect(result.sales_context.course_of_interest).toBe(expectedName);
  });

  it('does not revive a historical SKU after a generic course correction', async () => {
    const result = await claimBatch(input, {
      ...buildDeps({
        messagesResult: [{
          id: 'm1',
          conversation_seq: 1,
          content: 'Cambiemos de curso.',
          created_at: '2026-08-11T12:00:00.000Z',
          message_type: 'text',
        }],
        factsResult: facts({
          recent_turns: [{
            direction: 'inbound',
            content: 'Quiero Decoración de Interiores',
            created_at: '2026-08-11T11:59:00.000Z',
          }],
        }),
      }),
      business: {
        load: vi.fn().mockResolvedValue(businessContextView({
          offerings: [businessOffering(
            'decoracion_de_interiores',
            'Decoración de Interiores',
            'Diseño',
          )],
        })),
      },
    });

    if (result.outcome !== 'claimed') throw new Error('expected a claim');
    expect(result.sales_context.offering_code).toBeNull();
    expect(result.sales_context.course_of_interest).toBeNull();
  });

  it('does not revive a historical SKU for a newly requested unavailable program', async () => {
    const current = 'Necesito información del programa de Astronomía';
    const result = await claimBatch(input, {
      ...buildDeps({
        messagesResult: [{
          id: 'm1',
          conversation_seq: 1,
          content: current,
          created_at: '2026-08-11T12:00:00.000Z',
          message_type: 'text',
        }],
        factsResult: facts({
          recent_turns: [{
            direction: 'inbound',
            content: 'Quiero Decoración de Interiores',
            created_at: '2026-08-11T11:59:00.000Z',
          }],
        }),
      }),
      business: {
        load: vi.fn().mockResolvedValue(businessContextView({
          offerings: [businessOffering(
            'decoracion_de_interiores',
            'Decoración de Interiores',
            'Diseño',
          )],
        })),
      },
    });

    if (result.outcome !== 'claimed') throw new Error('expected a claim');
    expect(result.catalog_resolution).toMatchObject({ kind: 'not_found', requestedText: current });
    expect(result.sales_context.offering_code).toBeNull();
    expect(result.sales_context.course_of_interest).toBeNull();
  });

  it.each([
    '¿Se puede hacer sin usar un programa de diseño?',
    'Nunca usé un programa de diseño, ¿igual puedo hacer el curso?',
  ])('preserves exact historical SKU for a program-requirement follow-up: %s', async (current) => {
    const result = await claimBatch(input, {
      ...buildDeps({
        messagesResult: [{
          id: 'm1',
          conversation_seq: 1,
          content: current,
          created_at: '2026-08-11T12:00:00.000Z',
          message_type: 'text',
        }],
        factsResult: facts({
          recent_turns: [{
            direction: 'inbound',
            content: 'Quiero Decoración de Interiores',
            created_at: '2026-08-11T11:59:00.000Z',
          }],
        }),
      }),
      business: {
        load: vi.fn().mockResolvedValue(businessContextView({
          offerings: [businessOffering(
            'decoracion_de_interiores',
            'Decoración de Interiores',
            'Diseño',
          )],
        })),
      },
    });

    if (result.outcome !== 'claimed') throw new Error('expected a claim');
    expect(result.catalog_resolution).toEqual({ kind: 'no_catalog_intent' });
    expect(result.sales_context).toMatchObject({
      offering_code: 'decoracion_de_interiores',
      course_of_interest: 'Decoración de Interiores',
    });
  });

  it('preserves the exact historical SKU when homonymous courses exist', async () => {
    const messages = [{
      id: 'm1',
      conversation_seq: 1,
      content: 'Elijo 12 cuotas',
      created_at: '2026-08-11T12:00:00.000Z',
      message_type: 'text',
    }];
    const result = await claimBatch(input, {
      ...buildDeps({
        messagesResult: messages,
        factsResult: facts({
          recent_turns: [{
            direction: 'inbound',
            content: 'Quiero ingles_sur',
            created_at: '2026-08-11T11:59:00.000Z',
          }],
        }),
      }),
      business: {
        load: vi.fn().mockResolvedValue(businessContextView({
          offerings: [
            businessOffering('ingles_norte', 'Inglés Inicial', 'Academia Norte'),
            businessOffering('ingles_sur', 'Inglés Inicial', 'Academia Sur'),
          ],
        })),
      },
    });

    if (result.outcome !== 'claimed') throw new Error('expected a claim');
    expect(result.catalog_resolution).toEqual({ kind: 'no_catalog_intent' });
    expect(result.sales_context.course_of_interest).toBe('Inglés Inicial');
    expect(result.sales_context.offering_code).toBe('ingles_sur');
  });

  it('clears historical SKU identity when the current selection is ambiguous', async () => {
    const messages = [{
      id: 'm1',
      conversation_seq: 1,
      content: 'Quiero Inglés Inicial',
      created_at: '2026-08-11T12:00:00.000Z',
      message_type: 'text',
    }];
    const result = await claimBatch(input, {
      ...buildDeps({
        messagesResult: messages,
        factsResult: facts({
          recent_turns: [{
            direction: 'inbound',
            content: 'Quiero ingles_sur',
            created_at: '2026-08-11T11:59:00.000Z',
          }],
        }),
      }),
      business: {
        load: vi.fn().mockResolvedValue(businessContextView({
          offerings: [
            businessOffering('ingles_norte', 'Inglés Inicial', 'Academia Norte'),
            businessOffering('ingles_sur', 'Inglés Inicial', 'Academia Sur'),
          ],
        })),
      },
    });

    if (result.outcome !== 'claimed') throw new Error('expected a claim');
    expect(result.catalog_resolution.kind).toBe('ambiguous');
    expect(result.sales_context.course_of_interest).toBeNull();
    expect(result.sales_context.offering_code).toBeNull();
  });

  it('does not let a neutral typo-like sentence replace historical course identity', async () => {
    const messages = [{
      id: 'm1',
      conversation_seq: 1,
      content: 'El oratorio está cerrado',
      created_at: '2026-08-11T12:00:00.000Z',
      message_type: 'text',
    }];
    const result = await claimBatch(input, {
      ...buildDeps({
        messagesResult: messages,
        factsResult: facts({
          recent_turns: [{
            direction: 'inbound',
            content: 'Quiero Marketing Digital',
            created_at: '2026-08-11T11:59:00.000Z',
          }],
        }),
      }),
      business: {
        load: vi.fn().mockResolvedValue(businessContextView({
          offerings: [
            businessOffering('oratoria', 'Oratoria', 'Comunicación'),
            businessOffering('marketing_digital', 'Marketing Digital', 'Marketing'),
          ],
        })),
      },
    });

    if (result.outcome !== 'claimed') throw new Error('expected a claim');
    expect(result.catalog_resolution).toEqual({ kind: 'no_catalog_intent' });
    expect(result.sales_context.course_of_interest).toBe('Marketing Digital');
    expect(result.sales_context.offering_code).toBe('marketing_digital');
  });

  it('preserves historical course identity through a generic schedule question', async () => {
    const messages = [{
      id: 'm1',
      conversation_seq: 1,
      content: '¿Tienen horarios los sábados?',
      created_at: '2026-08-11T12:00:00.000Z',
      message_type: 'text',
    }];
    const result = await claimBatch(input, {
      ...buildDeps({
        messagesResult: messages,
        factsResult: facts({
          recent_turns: [{
            direction: 'inbound',
            content: 'Quiero Marketing Digital',
            created_at: '2026-08-11T11:59:00.000Z',
          }],
        }),
      }),
      business: {
        load: vi.fn().mockResolvedValue(businessContextView({
          offerings: [businessOffering('marketing_digital', 'Marketing Digital', 'Marketing')],
        })),
      },
    });

    if (result.outcome !== 'claimed') throw new Error('expected a claim');
    expect(result.catalog_resolution).toEqual({ kind: 'no_catalog_intent' });
    expect(result.sales_context.course_of_interest).toBe('Marketing Digital');
    expect(result.sales_context.offering_code).toBe('marketing_digital');
  });

  it('treats a greeting as neutral when the business snapshot is unavailable', async () => {
    const messages = [{
      id: 'm1',
      conversation_seq: 1,
      content: 'Hola',
      created_at: '2026-08-11T12:00:00.000Z',
      message_type: 'text',
    }];
    const result = await claimBatch(input, {
      ...buildDeps({ messagesResult: messages }),
      business: { load: vi.fn().mockResolvedValue(null) },
    });

    if (result.outcome !== 'claimed') throw new Error('expected a claim');
    expect(result.catalog_resolution).toEqual({ kind: 'no_catalog_intent' });
    expect(result.sales_context.course_of_interest).toBeNull();
    expect(result.sales_context.offering_code).toBeNull();
  });

  it('carries academy-qualified homonym identity into sales context', async () => {
    const messages = [{
      id: 'm1',
      conversation_seq: 1,
      content: 'Quiero Inglés Inicial en Academia Norte',
      created_at: '2026-08-11T12:00:00.000Z',
      message_type: 'text',
    }];
    const result = await claimBatch(input, {
      ...buildDeps({ messagesResult: messages }),
      business: {
        load: vi.fn().mockResolvedValue(businessContextView({
          offerings: [
            businessOffering('ingles_norte', 'Inglés Inicial', 'Academia Norte'),
            businessOffering('ingles_sur', 'Inglés Inicial', 'Academia Sur'),
          ],
        })),
      },
    });

    if (result.outcome !== 'claimed') throw new Error('expected a claim');
    expect(result.catalog_resolution).toMatchObject({
      kind: 'exact',
      offeringCode: 'ingles_norte',
    });
    expect(result.sales_context.course_of_interest).toBe('Inglés Inicial');
    expect(result.sales_context.offering_code).toBe('ingles_norte');
  });
});

describe('claimBatch sales_context', () => {
  it('defaults to advising with no open offer, no active call and no history', async () => {
    const deps = buildDeps();
    const result = await claimBatch(input, deps);

    if (result.outcome !== 'claimed') throw new Error('expected a claim');
    // The double's last batch message ("¿cuánto sale el curso?") settles
    // nothing on its own, so the policy is free to offer.
    expect(result.sales_context).toEqual({
      mode: 'advising',
      course_of_interest: null,
      offering_code: null,
      open_call_offer: null,
      accepted_call_offer: null,
      active_call: null,
      allowed_actions: ['offer_call'],
      last_call_result: null,
    });
  });

  it('scopes the core snapshot read to the claimed batch identity', async () => {
    const deps = buildDeps();
    await claimBatch(input, deps);

    expect(deps.store.loadClaimedBatchContext).toHaveBeenCalledWith({
      batch_id: 'batch-1',
      recent_turns_limit: DEFAULT_CONTEXT_LIMITS.recentTurns,
    });
  });

  it('surfaces a live open offer as awaiting_call_consent', async () => {
    const deps = buildDeps({
      callFactsResult: callFacts({
        open_offer: { decision_id: 'decision-offer-1', offered_at: '2026-08-11T11:58:00.000Z' },
      }),
      now: () => '2026-08-11T12:00:00.000Z',
    });

    const result = await claimBatch(input, deps);
    if (result.outcome !== 'claimed') throw new Error('expected a claim');

    expect(result.sales_context.mode).toBe('awaiting_call_consent');
    expect(result.sales_context.open_call_offer).toEqual({
      decision_id: 'decision-offer-1',
      expires_at: '2026-08-11T12:13:00.000Z',
    });
    // The current message is an unrelated question, not a settling reply,
    // so no action is granted while the offer is still pending a response.
    expect(result.sales_context.allowed_actions).toEqual([]);
  });

  it('carries accepted-offer identity through claim into one Botpress call request', async () => {
    const wireIds = {
      trace: '00000000-0000-4000-8000-000000000001',
      batch: '00000000-0000-4000-8000-000000000002',
      claimToken: '00000000-0000-4000-8000-000000000003',
      conversation: '00000000-0000-4000-8000-000000000004',
      contact: '00000000-0000-4000-8000-000000000005',
      turn: '00000000-0000-4000-8000-000000000006',
      message: '00000000-0000-4000-8000-000000000007',
      offer: '00000000-0000-4000-8000-000000000008',
    };
    const messages = [
      {
        id: wireIds.message,
        conversation_seq: 1,
        content: 'dale',
        created_at: '2026-08-11T12:00:00.000Z',
        message_type: 'text',
      },
    ];
    const deps = buildDeps({
      claimResult: claim({
        batch_id: wireIds.batch,
        claim_token: wireIds.claimToken,
        conversation_id: wireIds.conversation,
        contact_id: wireIds.contact,
      }),
      factsResult: facts({
        contact: { ...facts().contact, id: wireIds.contact },
        representative_turn_id: wireIds.turn,
      }),
      messagesResult: messages,
      callFactsResult: callFacts({
        open_offer: {
          decision_id: wireIds.offer,
          offered_at: '2026-08-11T11:58:00.000Z',
        },
      }),
      now: () => '2026-08-11T12:00:00.000Z',
    });

    const result = await claimBatch(
      { batch_id: wireIds.batch, claimed_by: 'workflow-1', trace_id: wireIds.trace },
      deps,
    );
    if (result.outcome !== 'claimed') throw new Error('expected a claim');

    expect(result.deterministic_route).toBe('call_accepted_offer');
    expect(result.sales_context.open_call_offer).toBeNull();
    expect(
      (result.sales_context as unknown as {
        accepted_call_offer: { decision_id: string; expires_at: string } | null;
      }).accepted_call_offer,
    ).toEqual({
      decision_id: wireIds.offer,
      expires_at: '2026-08-11T12:13:00.000Z',
    });

    const wireClaim = ClaimedTurnSchema.parse(result) as BotpressClaimedTurn;
    expect(wireClaim.sales_context.accepted_call_offer).toEqual({
      decision_id: wireIds.offer,
      expires_at: '2026-08-11T12:13:00.000Z',
    });
    const decision = matchCallHandoffFastPath(wireClaim);
    expect(decision).toMatchObject({
      response_type: 'call_confirmation',
      business_action: {
        type: 'request_call_now',
        reason: 'accepted_offer',
      },
    });
    expect(decision?.business_action).not.toBeNull();
  });

  it('lets an expired offer fall back to advising and eligible for a new one', async () => {
    const deps = buildDeps({
      callFactsResult: callFacts({
        open_offer: { decision_id: 'decision-offer-1', offered_at: '2026-08-11T11:00:00.000Z' },
      }),
      now: () => '2026-08-11T12:00:00.000Z',
    });

    const result = await claimBatch(input, deps);
    if (result.outcome !== 'claimed') throw new Error('expected a claim');

    expect(result.sales_context.mode).toBe('advising');
    expect(result.sales_context.open_call_offer).toBeNull();
    expect(result.sales_context.allowed_actions).toEqual(['offer_call']);
  });

  it('grants request_call_now for a direct call request regardless of any offer', async () => {
    const deps = buildDeps();
    const messages = [
      { id: 'm1', conversation_seq: 1, content: 'llamame por favor', created_at: '2026-08-11T12:00:00.000Z', message_type: 'text' },
    ];
    deps.store.listBatchMessages = vi.fn().mockResolvedValue(messages);
    deps.store.loadClaimedBatchContext = vi.fn().mockResolvedValue({
      facts: facts(), batch_messages: messages, call_facts: callFacts(),
    });

    const result = await claimBatch(input, deps);
    if (result.outcome !== 'claimed') throw new Error('expected a claim');

    expect(result.sales_context.allowed_actions).toEqual(['request_call_now']);
  });

  it('grants request_call_now when the direct request sits mid-batch under trailing text', async () => {
    const deps = buildDeps();
    const messages = [
      { id: 'm1', conversation_seq: 1, content: 'llamame por favor', created_at: '2026-08-11T12:00:00.000Z', message_type: 'text' },
      { id: 'm2', conversation_seq: 2, content: 'gracias', created_at: '2026-08-11T12:00:05.000Z', message_type: 'text' },
    ];
    deps.store.listBatchMessages = vi.fn().mockResolvedValue(messages);
    deps.store.loadClaimedBatchContext = vi.fn().mockResolvedValue({
      facts: facts(), batch_messages: messages, call_facts: callFacts(),
    });

    const result = await claimBatch(input, deps);
    if (result.outcome !== 'claimed') throw new Error('expected a claim');

    expect(result.sales_context.allowed_actions).toEqual(['request_call_now']);
  });

  it('withholds offer_call while a persisted decline is inside the 30-minute cooldown', async () => {
    const deps = buildDeps({
      callFactsResult: callFacts({ last_decline_at: '2026-08-11T11:50:00.000Z' }),
      now: () => '2026-08-11T12:00:00.000Z',
    });

    const result = await claimBatch(input, deps);
    if (result.outcome !== 'claimed') throw new Error('expected a claim');

    expect(result.sales_context.allowed_actions).toEqual([]);
  });

  it('does not proactively re-offer a call later in the same conversation', async () => {
    const deps = buildDeps({
      callFactsResult: callFacts({ last_decline_at: '2026-08-11T11:20:00.000Z' }),
      now: () => '2026-08-11T12:00:00.000Z',
    });

    const result = await claimBatch(input, deps);
    if (result.outcome !== 'claimed') throw new Error('expected a claim');

    expect(result.sales_context.allowed_actions).toEqual([]);
  });

  it('reports in_call and grants no sales action while a call is connected', async () => {
    const deps = buildDeps({
      callFactsResult: callFacts({ active_call: { call_id: 'call-1', status: 'in_progress' } }),
    });

    const result = await claimBatch(input, deps);
    if (result.outcome !== 'claimed') throw new Error('expected a claim');

    expect(result.sales_context.mode).toBe('in_call');
    expect(result.sales_context.active_call).toEqual({ call_id: 'call-1', status: 'in_progress' });
    expect(result.sales_context.allowed_actions).toEqual([]);
  });

  it('reports call_pending for a call still being set up', async () => {
    const deps = buildDeps({
      callFactsResult: callFacts({ active_call: { call_id: 'call-1', status: 'dispatching' } }),
    });

    const result = await claimBatch(input, deps);
    if (result.outcome !== 'claimed') throw new Error('expected a claim');

    expect(result.sales_context.mode).toBe('call_pending');
    expect(result.sales_context.allowed_actions).toEqual([]);
  });

  it('reports post_call when the most recent sales event was a finished call', async () => {
    const deps = buildDeps({
      callFactsResult: callFacts({
        last_call_result: { call_id: 'call-1', result: 'interested', ended_at: '2026-08-11T11:30:00.000Z' },
      }),
    });

    const result = await claimBatch(input, deps);
    if (result.outcome !== 'claimed') throw new Error('expected a claim');

    expect(result.sales_context.mode).toBe('post_call');
    expect(result.sales_context.last_call_result).toEqual({
      call_id: 'call-1',
      result: 'interested',
      ended_at: '2026-08-11T11:30:00.000Z',
    });
    // Nothing newer than the finished call has started, but the policy still
    // decides whether a new offer may be made.
    expect(result.sales_context.allowed_actions).toEqual(['offer_call']);
  });

  it('never grants a sales action for a blocked contact', async () => {
    const deps = buildDeps({
      factsResult: facts({ contact: { ...facts().contact, lifecycle_status: 'blocked' } }),
    });

    const result = await claimBatch(input, deps);
    if (result.outcome !== 'claimed') throw new Error('expected a claim');

    expect(result.sales_context.allowed_actions).toEqual([]);
  });

  it('never grants a sales action once consent is revoked', async () => {
    const deps = buildDeps({
      factsResult: facts({ contact: { ...facts().contact, consent_status: 'revoked' } }),
    });

    const result = await claimBatch(input, deps);
    if (result.outcome !== 'claimed') throw new Error('expected a claim');

    expect(result.sales_context.allowed_actions).toEqual([]);
  });

  it('never grants a sales action while a call is already active, even on a direct request', async () => {
    const deps = buildDeps({
      callFactsResult: callFacts({ active_call: { call_id: 'call-1', status: 'in_progress' } }),
    });
    const messages = [
      { id: 'm1', conversation_seq: 1, content: 'llamame ahora', created_at: '2026-08-11T12:00:00.000Z', message_type: 'text' },
    ];
    deps.store.listBatchMessages = vi.fn().mockResolvedValue(messages);
    deps.store.loadClaimedBatchContext = vi.fn().mockResolvedValue({
      facts: facts(), batch_messages: messages,
      call_facts: callFacts({ active_call: { call_id: 'call-1', status: 'in_progress' } }),
    });

    const result = await claimBatch(input, deps);
    if (result.outcome !== 'claimed') throw new Error('expected a claim');

    expect(result.sales_context.allowed_actions).toEqual([]);
  });
});
