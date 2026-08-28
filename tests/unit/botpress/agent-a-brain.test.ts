import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentAContextV1 } from '../../../botpress-agent/src/schemas/agent-a-brain';
import {
  AGENT_A_BRAIN_DEADLINE_MS,
  AgentABrainError,
  generateAgentATurnProposalV1,
  parseAgentATurnProposalV1,
} from '../../../botpress-agent/src/lib/conversation/agent-a-brain';

function context(): AgentAContextV1 {
  return {
    schema_version: 1,
    turn: { batch_messages: [{ id: 'message-1', text: 'Contame sobre Redes' }], recent_turns: [] },
    customer: {
      display_name: null,
      memories: [{
        id: 'memory-1', type: 'study_goal', key: 'career_goal', value: 'busca trabajo', confidence: 0.9,
      }],
    },
    commercial_state: {
      selected_offering_code: 'redes-informaticas', selected_payment_plan: null,
      stage: 'course_selected', call_preference: 'unknown', call_offer_status: 'not_offered',
      call_offer_count: 0, awaiting_reply: 'none',
    },
    catalog: {
      selected_offering: {
        code: 'redes-informaticas', display_name: 'Redes Informáticas', area_code: 'tecnologia',
        facts: [{ id: 'offering:redes-informaticas:name:v1', kind: 'offering_name', value: 'Redes Informáticas' }],
      },
      areas: [{ code: 'tecnologia', display_name: 'Tecnología' }],
      candidate_offerings: [],
      payment_plans: [{ code: 'monthly_12', label: '12 pagos mensuales de USD 30' }],
    },
    capabilities: {
      may_reply: true, may_offer_call: true, may_request_call_now: false,
      may_present_payment_options: true, may_send_payment_link: false, authorized_payment_plan: null,
    },
  };
}

function proposal(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: 1,
    move: {
      schema_version: 1, move: 'ask_course_information', secondary_moves: [], vetoes: [],
      course_reference: 'Redes Informáticas', confidence: 0.95,
    },
    response: { messages: ['Te cuento sobre el curso.', '¿Lo buscás para trabajar o para formación personal?'] },
    proposed_action: { type: 'none' },
    used_fact_ids: ['offering:redes-informaticas:name:v1'],
    used_memory_ids: ['memory-1'],
    memory_candidates: [],
    ...overrides,
  };
}

function providerResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function successBody(value: unknown) {
  return { choices: [{ message: { content: JSON.stringify(value) } }] };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('Agent A Brain V1', () => {
  it('parses a natural multi-message proposal against authorized facts and memories', () => {
    expect(parseAgentATurnProposalV1(proposal(), context()).response.messages).toHaveLength(2);
  });

  it('rejects a model URL and evidence IDs outside the supplied context', () => {
    expect(() => parseAgentATurnProposalV1(proposal({
      response: { messages: ['Pagá en https://buy.stripe.com/model-link'] },
    }), context())).toThrowError(expect.objectContaining({ code: 'BRAIN_INVALID_SCHEMA' }));
    expect(() => parseAgentATurnProposalV1(proposal({ used_fact_ids: ['fact-not-supplied'] }), context()))
      .toThrowError(expect.objectContaining({ code: 'BRAIN_UNKNOWN_FACT_ID' }));
    expect(() => parseAgentATurnProposalV1(proposal({ used_memory_ids: ['memory-not-supplied'] }), context()))
      .toThrowError(expect.objectContaining({ code: 'BRAIN_UNKNOWN_MEMORY_ID' }));
  });

  it('makes one strict structured request with the required budget', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(providerResponse(200, successBody(proposal())));
    vi.stubGlobal('fetch', fetchMock);

    const result = await generateAgentATurnProposalV1({
      context: context(), apiKey: 'test-key', signal: new AbortController().signal,
    });

    expect(result.proposal.response.messages).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body));
    expect(body.temperature).toBe(0.2);
    expect(body.max_completion_tokens).toBe(1_500);
    expect(body.response_format).toMatchObject({
      type: 'json_schema', json_schema: { name: 'studyx_agent_a_turn_proposal_v1', strict: true },
    });
  });

  it('classifies a 429 without retrying when Retry-After exceeds the remaining deadline', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(providerResponse(
      429, { error: { message: 'secret provider body' } }, { 'retry-after': '10' },
    ));
    vi.stubGlobal('fetch', fetchMock);

    await expect(generateAgentATurnProposalV1({
      context: context(), apiKey: 'test-key', signal: new AbortController().signal,
    })).rejects.toEqual(expect.objectContaining<Partial<AgentABrainError>>({ code: 'BRAIN_RATE_LIMITED' }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries one transient 5xx only when Retry-After fits inside the deadline', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(providerResponse(503, {}, { 'retry-after': '0' }))
      .mockResolvedValueOnce(providerResponse(200, successBody(proposal())));
    vi.stubGlobal('fetch', fetchMock);

    await expect(generateAgentATurnProposalV1({
      context: context(), apiKey: 'test-key', signal: new AbortController().signal,
    })).resolves.toMatchObject({ attempt_count: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('classifies timeout and malformed provider JSON separately', async () => {
    vi.useFakeTimers();
    const hangingFetch = vi.fn<typeof fetch>().mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }));
    vi.stubGlobal('fetch', hangingFetch);
    const pending = generateAgentATurnProposalV1({
      context: context(), apiKey: 'test-key', signal: new AbortController().signal,
    });
    const timeoutAssertion = expect(pending).rejects.toEqual(
      expect.objectContaining<Partial<AgentABrainError>>({ code: 'BRAIN_TIMEOUT' }),
    );
    await vi.advanceTimersByTimeAsync(AGENT_A_BRAIN_DEADLINE_MS + 1);
    await timeoutAssertion;
    vi.useRealTimers();

    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(providerResponse(200, {
      choices: [{ message: { content: '{not-json' } }],
    })));
    await expect(generateAgentATurnProposalV1({
      context: context(), apiKey: 'test-key', signal: new AbortController().signal,
    })).rejects.toEqual(expect.objectContaining<Partial<AgentABrainError>>({ code: 'BRAIN_INVALID_JSON' }));
  });
});
