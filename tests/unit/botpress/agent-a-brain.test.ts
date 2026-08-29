import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentAContextV1 } from '../../../botpress-agent/src/schemas/agent-a-brain';
import * as agentABrainModule from '../../../botpress-agent/src/lib/conversation/agent-a-brain';
import {
  AGENT_A_BRAIN_DEADLINE_MS,
  AgentABrainError,
  buildSafeAgentABrainCompositionV1,
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
      areas: [{ code: 'tecnologia', fact_id: 'area:tecnologia:name:v1', display_name: 'Tecnología' }],
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

  it('drops semantically inapplicable optional references emitted by the structured provider', () => {
    const parsed = parseAgentATurnProposalV1(proposal({
      move: {
        schema_version: 1,
        move: 'select_course',
        secondary_moves: [],
        vetoes: [],
        course_reference: 'Redes Informáticas',
        area_reference: 'Tecnología',
        payment_plan: null,
        confidence: 0.95,
      },
    }), context());

    expect(parsed.move).toMatchObject({
      move: 'select_course',
      course_reference: 'Redes Informáticas',
    });
    expect(parsed.move).not.toHaveProperty('area_reference');
    expect(parsed.move).not.toHaveProperty('payment_plan');
  });

  it('removes duplicate secondary moves and vetoes without adding authority', () => {
    const parsed = parseAgentATurnProposalV1(proposal({
      move: {
        schema_version: 1,
        move: 'ask_course_information',
        secondary_moves: ['ask_course_information', 'continue_by_chat', 'continue_by_chat'],
        vetoes: ['call', 'call'],
        course_reference: 'Redes Informáticas',
        confidence: 0.95,
      },
    }), context());

    expect(parsed.move.secondary_moves).toEqual(['continue_by_chat']);
    expect(parsed.move.vetoes).toEqual(['call']);
  });

  it('preserves natural sales prose when every commercial value cites an authorized fact', () => {
    const natural = 'Podés estudiar Redes Informáticas con nosotros. Te acompaño a ver si encaja con lo que buscás.';
    const composition = buildSafeAgentABrainCompositionV1({
      proposal: parseAgentATurnProposalV1(proposal({
        response: { messages: [natural, '¿Querés que te cuente cómo se cursa?'] },
        used_fact_ids: ['offering:redes-informaticas:name:v1'],
      }), context()),
      context: context(),
      response_goal: 'explain_selected_course',
      planned_fact_ids: ['offering:redes-informaticas:name:v1'],
    });

    expect(composition.narrative).toEqual({
      opening: natural,
      explanation: '¿Querés que te cuente cómo se cursa?',
      next_question: null,
    });
    expect(composition.used_fact_ids).toEqual(['offering:redes-informaticas:name:v1']);
  });

  it('keeps narrative value-free and delegates all planned facts to canonical rendering', () => {
    const composition = buildSafeAgentABrainCompositionV1({
      proposal: parseAgentATurnProposalV1(proposal({
        response: {
          messages: [
            'Podemos estudiar de forma virtual.',
            'Podemos revisar juntos lo que más te importa.',
          ],
        },
      }), context()),
      context: context(),
      response_goal: 'explain_selected_course',
      planned_fact_ids: [
        'offering:redes-informaticas:name:v1',
        'offering:redes-informaticas:description:v1',
      ],
    });

    expect(composition.narrative).toEqual({
      opening: 'Podemos revisar juntos lo que más te importa.',
      explanation: null,
      next_question: null,
    });
    expect(composition.used_fact_ids).toEqual([
      'offering:redes-informaticas:name:v1',
      'offering:redes-informaticas:description:v1',
    ]);
  });

  it('uses contextual value-free copy when every model message is unsafe', () => {
    const unsafeProposal = parseAgentATurnProposalV1(proposal({
      response: { messages: ['Redes Informáticas dura 10 meses.'] },
    }), context());

    const firstOffer = buildSafeAgentABrainCompositionV1({
      proposal: unsafeProposal,
      context: context(),
      response_goal: 'explain_selected_course',
      planned_fact_ids: [],
    });
    const secondOffer = buildSafeAgentABrainCompositionV1({
      proposal: unsafeProposal,
      context: {
        ...context(),
        commercial_state: { ...context().commercial_state, call_offer_count: 1 },
      },
      response_goal: 'explain_selected_course',
      planned_fact_ids: [],
    });
    const chatContinuation = buildSafeAgentABrainCompositionV1({
      proposal: unsafeProposal,
      context: {
        ...context(),
        commercial_state: {
          ...context().commercial_state,
          call_preference: 'chat',
          call_offer_status: 'declined',
          call_offer_count: 2,
        },
      },
      response_goal: 'continue_course_advice',
      planned_fact_ids: [],
    });

    expect(firstOffer.narrative.opening).not.toBe(secondOffer.narrative.opening);
    expect(secondOffer.narrative.opening).not.toBe(chatContinuation.narrative.opening);
    for (const composition of [firstOffer, secondOffer, chatContinuation]) {
      expect(composition.narrative.opening).not.toMatch(/Redes|10 meses|https?:\/\//iu);
    }
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
    expect(body.reasoning_effort).toBe('low');
    expect(body.max_completion_tokens).toBe(800);
    expect(body.response_format).toMatchObject({
      type: 'json_schema', json_schema: { name: 'studyx_agent_a_turn_proposal_v1', strict: true },
    });
  });

  it('can execute the same brain contract through direct Gemini when Groq is unavailable', async () => {
    const generateWithGemini = (agentABrainModule as unknown as {
      generateGeminiAgentATurnProposalV1?: (input: {
        context: AgentAContextV1;
        apiKey: string;
        signal: AbortSignal;
        model?: string;
      }) => Promise<{
        proposal: ReturnType<typeof parseAgentATurnProposalV1>;
        provider: string;
        model: string;
      }>;
    }).generateGeminiAgentATurnProposalV1;
    expect(generateWithGemini).toBeTypeOf('function');

    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify(proposal()) }] } }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await generateWithGemini!({
      context: context(), apiKey: 'gemini-test-key',
      signal: new AbortController().signal, model: 'gemini-2.5-flash',
    });

    expect(result.provider).toBe('google-ai-direct');
    expect(result.model).toBe('gemini-2.5-flash');
    expect(result.proposal.response.messages).toEqual(proposal().response.messages);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain('/models/gemini-2.5-flash:generateContent');
    const body = JSON.parse(String(init?.body));
    expect(body.systemInstruction.parts[0].text).toContain('canonical_sales_behavior');
    expect(body.generationConfig.responseMimeType).toBe('application/json');
  });

  it('classifies a 429 without retrying when Retry-After exceeds the remaining deadline', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(providerResponse(
      429, { error: { message: 'secret provider body' } }, { 'retry-after': '10' },
    ));
    vi.stubGlobal('fetch', fetchMock);

    await expect(generateAgentATurnProposalV1({
      context: context(), apiKey: 'test-key', signal: new AbortController().signal,
    })).rejects.toEqual(expect.objectContaining<Partial<AgentABrainError>>({
      code: 'BRAIN_RATE_LIMITED',
      retry_after_ms: 10_000,
    }));
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
