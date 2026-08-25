import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GenerateDecisionInput } from '../../../botpress-agent/src/lib/decision/decision-generator';
import type { Decision } from '../../../botpress-agent/src/schemas/contracts';
import {
  DEFAULT_GROQ_MODEL,
  GroqDecisionError,
  generateGroqDecision,
} from '../../../botpress-agent/src/lib/decision/groq-direct';

const API_KEY = 'gsk-test-key-never-log';
const fetchMock = vi.fn<typeof fetch>();

const validDecision: Decision = {
  schema_version: 4,
  intent: 'commercial',
  kind: 'reply',
  response: 'Te cuento sobre StudyX.',
  response_type: 'commercial_reply',
  confidence: 0.9,
  reason_code: 'ANSWER',
  business_action: null,
  memory_candidates: [],
  missing_information: [],
  next_state: 'waiting_user',
  retrieval_used: null,
};

function response(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function success(decision: Decision = validDecision): Response {
  return response(200, {
    choices: [{ message: { role: 'assistant', content: JSON.stringify(decision) } }],
  });
}

function input(overrides: Partial<GenerateDecisionInput> = {}): GenerateDecisionInput {
  return {
    instructions: 'System instructions for Agent A',
    apiKey: API_KEY,
    model: DEFAULT_GROQ_MODEL,
    signal: new AbortController().signal,
    timeoutMs: 8_000,
    ...overrides,
  };
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('generateGroqDecision', () => {
  it('uses Groq chat completions with strict JSON Schema and validates the decision', async () => {
    fetchMock.mockResolvedValueOnce(success());

    const result = await generateGroqDecision(input());

    expect(result).toMatchObject({
      decision: validDecision,
      provider: 'groq-direct',
      model: DEFAULT_GROQ_MODEL,
    });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${API_KEY}`);
    const body = JSON.parse(String(init?.body));
    expect(body.messages[0]).toEqual({ role: 'system', content: input().instructions });
    expect(body.response_format).toMatchObject({
      type: 'json_schema',
      json_schema: {
        name: 'studyx_turn_decision',
        strict: true,
        schema: {
          type: 'object',
          additionalProperties: false,
          required: expect.arrayContaining(['schema_version', 'response', 'business_action']),
        },
      },
    });
  });

  it('uses JSON object mode for Groq Compound while retaining local schema validation', async () => {
    fetchMock.mockResolvedValueOnce(success());

    const result = await generateGroqDecision(input({ model: 'groq/compound-mini' }));

    expect(result).toMatchObject({
      decision: validDecision,
      provider: 'groq-direct',
      model: 'groq/compound-mini',
    });
    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body));
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.max_completion_tokens).toBeLessThanOrEqual(1_024);
  });

  it('uses one non-overlapping request_call_now variant and normalizes a null course', async () => {
    fetchMock.mockResolvedValueOnce(response(200, {
      choices: [{
        message: {
          content: JSON.stringify({
            ...validDecision,
            response_type: 'call_confirmation',
            business_action: {
              type: 'request_call_now',
              reason: 'direct_request',
              course_of_interest: null,
            },
          }),
        },
      }],
    }));

    const result = await generateGroqDecision(input());

    expect(result.decision.business_action).toEqual({
      type: 'request_call_now',
      reason: 'direct_request',
    });

    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body));
    const actionVariants = body.response_format.json_schema.schema
      .properties.business_action.anyOf;
    const callVariants = actionVariants.filter((variant: {
      properties?: { type?: { enum?: string[] } };
    }) => variant.properties?.type?.enum?.includes('request_call_now'));
    expect(callVariants).toHaveLength(1);
    expect(callVariants[0].required).toContain('course_of_interest');
  });

  it('repairs a safe clarification shape before canonical validation', async () => {
    fetchMock.mockResolvedValueOnce(response(200, {
      choices: [{
        message: {
          content: JSON.stringify({
            ...validDecision,
            kind: 'clarify',
            response: '¿Qué curso te interesa?',
            response_type: 'commercial_reply',
            business_action: { type: 'mark_hot_lead', score: 0.8 },
            missing_information: [],
            next_state: 'completed',
          }),
        },
      }],
    }));

    const result = await generateGroqDecision(input({ model: 'groq/compound-mini' }));

    expect(result.decision).toMatchObject({
      kind: 'clarify',
      response_type: 'clarification',
      business_action: null,
      missing_information: ['respuesta_del_cliente'],
      next_state: 'waiting_user',
    });
  });

  it('normalizes a suppress decision to the canonical empty shape', async () => {
    fetchMock.mockResolvedValueOnce(response(200, {
      choices: [{
        message: {
          content: JSON.stringify({
            ...validDecision,
            kind: 'suppress',
            response: '',
            response_type: 'commercial_reply',
            business_action: { type: 'mark_hot_lead', score: 0.8 },
            memory_candidates: [{
              type: 'study_goal',
              key: 'objetivo',
              value: 'algo',
              source_quote: 'algo',
              confidence: 1,
            }],
            missing_information: ['anything'],
            next_state: 'waiting_user',
          }),
        },
      }],
    }));

    const result = await generateGroqDecision(input());

    expect(result.decision).toMatchObject({
      kind: 'suppress',
      response: null,
      response_type: null,
      business_action: null,
      memory_candidates: [],
      missing_information: [],
      next_state: 'completed',
    });
  });

  it('fails closed when Groq returns JSON that violates DecisionSchema', async () => {
    fetchMock
      .mockResolvedValueOnce(response(200, {
        choices: [{ message: { content: JSON.stringify({ response: 'incomplete' }) } }],
      }))
      .mockResolvedValueOnce(response(200, {
        choices: [{ message: { content: JSON.stringify({ response: 'still incomplete' }) } }],
      }));

    await expect(generateGroqDecision(input())).rejects.toMatchObject({
      code: 'GROQ_SCHEMA_INVALID',
      retryable: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries exactly once on 429 and succeeds', async () => {
    vi.useFakeTimers();
    fetchMock
      .mockResolvedValueOnce(response(429, { error: { message: 'rate limited' } }))
      .mockResolvedValueOnce(success());

    const pending = generateGroqDecision(input());
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(pending).resolves.toMatchObject({ decision: validDecision });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries a provider json_validate_failed 400 exactly once', async () => {
    vi.useFakeTimers();
    fetchMock
      .mockResolvedValueOnce(response(400, {
        error: { code: 'json_validate_failed', message: 'generated JSON did not satisfy schema' },
      }))
      .mockResolvedValueOnce(success());

    const pending = generateGroqDecision(input());
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(pending).resolves.toMatchObject({ decision: validDecision });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry or expose provider details for an ordinary 400', async () => {
    fetchMock.mockResolvedValueOnce(response(400, {
      error: { code: 'invalid_request_error', message: `secret ${API_KEY}` },
    }));

    await expect(generateGroqDecision(input())).rejects.toMatchObject({
      code: 'GROQ_HTTP_400',
      retryable: false,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('aborts a hanging request at the provider timeout', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementationOnce((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }));

    const pending = generateGroqDecision(input({ timeoutMs: 50 }));
    const expectation = expect(pending).rejects.toMatchObject({ code: 'GROQ_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(50);
    await expectation;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('never leaks the API key through network errors', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError(`failed Bearer ${API_KEY}`));

    let caught: unknown;
    try {
      await generateGroqDecision(input());
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(GroqDecisionError);
    expect(JSON.stringify(caught)).not.toContain(API_KEY);
    expect(String((caught as Error).stack ?? '')).not.toContain(API_KEY);
  });
});
