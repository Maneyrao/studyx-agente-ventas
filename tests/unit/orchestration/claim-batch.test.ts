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

/**
 * The use case is exercised entirely through its ports — no database, no HTTP.
 * That is what makes the degradation guarantees testable at all: forcing a
 * pgvector outage against a real cluster is awkward, forcing a rejected promise
 * from a double is trivial.
 */

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
    ...overrides,
  };
}

function buildDeps(options: {
  claimResult?: BatchClaim;
  factsResult?: ClaimedTurnFacts | null;
  callFactsResult?: ClaimedCallFacts;
  memory?: ClaimBatchDependencies['memory'];
  knowledge?: ClaimBatchDependencies['knowledge'];
  now?: () => string;
} = {}): ClaimBatchDependencies & { store: OrchestrationStore } {
  const store: OrchestrationStore = {
    openOrJoinBatch: vi.fn(),
    claimBatch: vi.fn().mockResolvedValue(options.claimResult ?? claim()),
    completeBatch: vi.fn(),
    listBatchMessages: vi.fn().mockResolvedValue([
      { id: 'm1', conversation_seq: 1, content: 'hola', created_at: '2026-08-11T12:00:00.000Z', message_type: 'text' },
      { id: 'm2', conversation_seq: 2, content: '¿cuánto sale el curso?', created_at: '2026-08-11T12:00:01.000Z', message_type: 'text' },
    ]),
    loadClaimedTurnFacts: vi
      .fn()
      .mockResolvedValue(options.factsResult === undefined ? facts() : options.factsResult),
    loadClaimedCallFacts: vi.fn().mockResolvedValue(options.callFactsResult ?? callFacts()),
    expireStaleClaims: vi.fn(),
  };

  return {
    store,
    memory: options.memory ?? { search: vi.fn().mockResolvedValue([]) },
    knowledge: options.knowledge ?? { search: vi.fn().mockResolvedValue([]) },
    limits: DEFAULT_CONTEXT_LIMITS,
    now: options.now,
  };
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

  it('searches with the whole batch, not just the last message', async () => {
    const memory = { search: vi.fn().mockResolvedValue([]) };
    const knowledge = { search: vi.fn().mockResolvedValue([]) };
    await claimBatch(input, buildDeps({ memory, knowledge }));

    expect(memory.search).toHaveBeenCalledWith(
      expect.objectContaining({
        contact_id: 'contact-1',
        query: 'hola\n¿cuánto sale el curso?',
      })
    );
    expect(knowledge.search).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'hola\n¿cuánto sale el curso?' })
    );
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
      open_call_offer: null,
      active_call: null,
      allowed_actions: ['offer_call'],
      last_call_result: null,
    });
  });

  it('scopes the call facts read to the claimed batch\'s own contact and conversation', async () => {
    const deps = buildDeps();
    await claimBatch(input, deps);

    expect(deps.store.loadClaimedCallFacts).toHaveBeenCalledWith({
      contact_id: 'contact-1',
      conversation_id: 'conversation-1',
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
    deps.store.listBatchMessages = vi.fn().mockResolvedValue([
      { id: 'm1', conversation_seq: 1, content: 'llamame por favor', created_at: '2026-08-11T12:00:00.000Z', message_type: 'text' },
    ]);

    const result = await claimBatch(input, deps);
    if (result.outcome !== 'claimed') throw new Error('expected a claim');

    expect(result.sales_context.allowed_actions).toEqual(['request_call_now']);
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
    deps.store.listBatchMessages = vi.fn().mockResolvedValue([
      { id: 'm1', conversation_seq: 1, content: 'llamame ahora', created_at: '2026-08-11T12:00:00.000Z', message_type: 'text' },
    ]);

    const result = await claimBatch(input, deps);
    if (result.outcome !== 'claimed') throw new Error('expected a claim');

    expect(result.sales_context.allowed_actions).toEqual([]);
  });
});
