import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_GEMINI_MODEL,
  GeminiDecisionError,
  generateGeminiDecision,
} from '../../../botpress-agent/src/lib/decision/gemini-direct';
import type { GenerateDecisionInput } from '../../../botpress-agent/src/lib/decision/decision-generator';
import type { Decision } from '../../../botpress-agent/src/schemas/contracts';

/**
 * TDD RED coverage for the direct-Gemini decision adapter. The adapter is
 * the ONLY thing under test here — no workflow wiring, no prompt
 * composition. `fetch` is fully faked so no network call is ever made and
 * no real backoff time is ever spent. Interactive turns intentionally do not
 * retry a model call: a late retry is worse than a fast safe fallback.
 */

const API_KEY = 'sk-super-secret-gemini-key-do-not-leak';

const validDecision: Decision = {
  schema_version: 4,
  intent: 'commercial',
  kind: 'reply',
  response: 'Te cuento sobre StudyX.',
  response_type: 'commercial_reply',
  confidence: 0.87,
  reason_code: 'ANSWER',
  business_action: null,
  memory_candidates: [],
  missing_information: [],
  next_state: 'waiting_user',
  retrieval_used: null,
};

function geminiPayload(text: string): unknown {
  return {
    candidates: [
      {
        content: {
          role: 'model',
          parts: [{ text }],
        },
      },
    ],
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function baseInput(overrides: Partial<GenerateDecisionInput> = {}): GenerateDecisionInput {
  return {
    instructions: 'Eres el agente de ventas de StudyX. Responde en JSON.',
    apiKey: API_KEY,
    model: DEFAULT_GEMINI_MODEL,
    signal: new AbortController().signal,
    ...overrides,
  };
}

describe('generateGeminiDecision — valid response', () => {
  it('parses the first candidate text, validates with DecisionSchema, and reports latency', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, geminiPayload(JSON.stringify(validDecision))),
    );

    const result = await generateGeminiDecision(baseInput());

    expect(result.decision).toEqual(validDecision);
    expect(result.provider).toBe('google-ai-direct');
    expect(result.model).toBe(DEFAULT_GEMINI_MODEL);
    expect(typeof result.latencyMs).toBe('number');
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('isolates the JSON object when the model wraps it in prose and a code fence', async () => {
    const wrapped = `Aquí está la decisión:\n\`\`\`json\n${JSON.stringify(validDecision)}\n\`\`\`\nListo.`;
    fetchMock.mockResolvedValueOnce(jsonResponse(200, geminiPayload(wrapped)));

    const result = await generateGeminiDecision(baseInput());

    expect(result.decision).toEqual(validDecision);
  });

  it('removes nullable and unrelated Gemini action fields before strict validation', async () => {
    const pollutedPaymentAction = {
      ...validDecision,
      business_action: {
        type: 'send_payment_link',
        plan_code: 'monthly_12',
        offering_sku: null,
        score: 0,
        objection_key: '',
        quote: '',
        reason: 'direct_request',
        course_of_interest: '',
      },
    };
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, geminiPayload(JSON.stringify(pollutedPaymentAction))),
    );

    const result = await generateGeminiDecision(baseInput());

    expect(result.decision.business_action).toEqual({
      type: 'send_payment_link',
      plan_code: 'monthly_12',
      offering_sku: null,
    });
  });

  it('repairs the safe cross-field shape of a non-empty clarification', async () => {
    const clarification = {
      ...validDecision,
      kind: 'clarify',
      response: '¿Cuál opción preferís?',
      response_type: null,
      business_action: null,
      missing_information: [],
      next_state: 'completed',
    };
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, geminiPayload(JSON.stringify(clarification))),
    );

    const result = await generateGeminiDecision(baseInput());

    expect(result.decision).toMatchObject({
      kind: 'clarify',
      response_type: 'clarification',
      missing_information: ['respuesta_del_cliente'],
      next_state: 'waiting_user',
    });
  });

  it('drops an incomplete observational action instead of rejecting the reply', async () => {
    const incompleteHotLead = {
      ...validDecision,
      business_action: { type: 'mark_hot_lead' },
    };
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, geminiPayload(JSON.stringify(incompleteHotLead))),
    );

    const result = await generateGeminiDecision(baseInput());

    expect(result.decision.business_action).toBeNull();
  });

  it('normalizes the provider-authored envelope version to the current v4 contract', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, geminiPayload(JSON.stringify({ ...validDecision, schema_version: 1 }))),
    );

    const result = await generateGeminiDecision(baseInput());

    expect(result.decision.schema_version).toBe(4);
  });

  it('calls the documented endpoint with systemInstruction, temperature 0.1 and JSON mime type', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, geminiPayload(JSON.stringify(validDecision))),
    );

    await generateGeminiDecision(baseInput({ model: 'gemini-3.5-pro' }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = fetchMock.mock.calls[0]!;
    const url = new URL(String(calledUrl));

    expect(url.origin + url.pathname).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-pro:generateContent',
    );
    expect(url.searchParams.get('key')).toBe(API_KEY);

    const body = JSON.parse(String(calledInit?.body));
    expect(body.systemInstruction.parts[0].text).toBe(baseInput().instructions);
    // 'system' is not a documented Content.role value for the Gemini REST
    // API's systemInstruction — only `parts` is expected, no `role`.
    expect(body.systemInstruction.role).toBeUndefined();
    expect(Object.keys(body.systemInstruction)).toEqual(['parts']);
    expect(body.generationConfig.temperature).toBe(0.1);
    expect(body.generationConfig.responseMimeType).toBe('application/json');
    expect(Array.isArray(body.contents)).toBe(true);
    expect(body.contents.length).toBeGreaterThan(0);
  });

  it('sends a responseSchema mirroring DecisionSchema so the model cannot invent field names or enum values', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, geminiPayload(JSON.stringify(validDecision))),
    );

    await generateGeminiDecision(baseInput());

    const [, calledInit] = fetchMock.mock.calls[0]!;
    const body = JSON.parse(String(calledInit?.body));
    const schema = body.generationConfig.responseSchema;

    expect(schema.type).toBe('OBJECT');
    // The exact bug reproduced live against gemini-3.5-flash without a
    // responseSchema: the model returned `text` instead of `response`, an
    // invented `intent` enum value, and omitted `confidence`/`reason_code`
    // entirely. Every one of those fields must now be declared and required.
    expect(schema.required).toEqual(
      expect.arrayContaining([
        'schema_version',
        'intent',
        'kind',
        'response',
        'response_type',
        'confidence',
        'reason_code',
        'business_action',
        'memory_candidates',
        'missing_information',
        'next_state',
        'retrieval_used',
      ]),
    );
    expect(schema.properties.response).toMatchObject({ type: 'STRING', nullable: true });
    expect(schema.properties.confidence).toMatchObject({ type: 'NUMBER' });
    expect(schema.properties.reason_code).toMatchObject({ type: 'STRING' });
    // Must be the exact IntentSchema enum — no room for an invented value
    // like the live "commercial_inquiry" the model returned.
    expect(schema.properties.intent.enum).toEqual([
      'social',
      'commercial',
      'commercial_decline',
      'complaint',
      'human_request',
      'opt_out',
      'out_of_scope',
      'unknown',
    ]);
    // retrieval_used must be typed as an OBJECT — the model previously
    // returned it as an empty array, which DecisionSchema rejects.
    expect(schema.properties.retrieval_used.type).toBe('OBJECT');
    expect(schema.properties.retrieval_used.nullable).toBe(true);
    expect(schema.properties.retrieval_used.properties).toMatchObject({
      kb: { type: 'BOOLEAN' },
      long_term_memory: { type: 'BOOLEAN' },
      summary_version: { type: 'INTEGER', nullable: true },
    });
    // memory_candidates items must use `type`/`key`/`value`/`source_quote`/
    // `confidence` — the model previously invented `fact_type` instead.
    expect(schema.properties.memory_candidates.type).toBe('ARRAY');
    expect(schema.properties.memory_candidates.items.required).toEqual([
      'type',
      'key',
      'value',
      'source_quote',
      'confidence',
    ]);
  });

  it('falls back to the default model when none is provided', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, geminiPayload(JSON.stringify(validDecision))),
    );

    const result = await generateGeminiDecision(baseInput({ model: '' }));

    expect(result.model).toBe(DEFAULT_GEMINI_MODEL);
    const [calledUrl] = fetchMock.mock.calls[0]!;
    expect(String(calledUrl)).toContain(`/models/${DEFAULT_GEMINI_MODEL}:generateContent`);
  });
});

describe('generateGeminiDecision — invalid model output', () => {
  it('fails immediately when the text has no JSON object at all', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, geminiPayload('no json here, sorry')));

    await expect(generateGeminiDecision(baseInput())).rejects.toMatchObject({
      code: 'GEMINI_INVALID_JSON',
      retryable: false,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('fails immediately when the JSON parses but violates DecisionSchema', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, geminiPayload(JSON.stringify({ not: 'a decision' }))),
    );

    await expect(generateGeminiDecision(baseInput())).rejects.toMatchObject({
      code: 'GEMINI_SCHEMA_INVALID',
      retryable: false,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('fails immediately when there are no candidates in the response', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { candidates: [] }));

    await expect(generateGeminiDecision(baseInput())).rejects.toMatchObject({
      code: 'GEMINI_EMPTY_RESPONSE',
      retryable: false,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('generateGeminiDecision — HTTP error taxonomy', () => {
  it('fails immediately on 401 without retrying', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { error: 'unauthorized' }));

    await expect(generateGeminiDecision(baseInput())).rejects.toMatchObject({
      code: 'GEMINI_HTTP_401',
      retryable: false,
      status: 401,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('fails immediately on 400 without retrying', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(400, { error: 'bad request' }));

    await expect(generateGeminiDecision(baseInput())).rejects.toMatchObject({
      code: 'GEMINI_HTTP_400',
      retryable: false,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('fails immediately on 403 without retrying', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(403, { error: 'forbidden' }));

    await expect(generateGeminiDecision(baseInput())).rejects.toMatchObject({
      code: 'GEMINI_HTTP_403',
      retryable: false,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([429, 503])('does not retry interactive Gemini failures (%i)', async (status) => {
    fetchMock.mockResolvedValueOnce(jsonResponse(status, { error: 'transient' }));

    await expect(generateGeminiDecision(baseInput())).rejects.toMatchObject({
      code: `GEMINI_HTTP_${status}`,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('generateGeminiDecision — abort handling', () => {
  it('rejects promptly without calling fetch when already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      generateGeminiDecision(baseInput({ signal: controller.signal })),
    ).rejects.toMatchObject({ code: 'GEMINI_ABORTED' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects promptly when the caller aborts an in-flight request', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    fetchMock.mockImplementationOnce((_url, init) => new Promise((_resolve, reject) => {
      (init?.signal as AbortSignal).addEventListener('abort', () => {
        reject(new DOMException('Aborted', 'AbortError'));
      }, { once: true });
    }));

    const promise = generateGeminiDecision(baseInput({ signal: controller.signal }));
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();

    await expect(promise).rejects.toMatchObject({ code: 'GEMINI_ABORTED' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('aborts an in-flight request at the supplied timeout without a late retry', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementationOnce((_url, init) => new Promise((_resolve, reject) => {
      (init?.signal as AbortSignal).addEventListener('abort', () => {
        reject(new DOMException('Aborted', 'AbortError'));
      }, { once: true });
    }));

    const promise = generateGeminiDecision(baseInput({ timeoutMs: 5_900 }));
    const expectation = expect(promise).rejects.toMatchObject({ code: 'GEMINI_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(5_900);
    await expectation;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('generateGeminiDecision — API key never leaks', () => {
  it('never includes the API key in a network-failure error', async () => {
    const leakyUrl = `https://generativelanguage.googleapis.com/v1beta/models/${DEFAULT_GEMINI_MODEL}:generateContent?key=${API_KEY}`;
    fetchMock.mockRejectedValueOnce(new TypeError(`fetch failed for ${leakyUrl}`));

    let caught: unknown;
    try {
      await generateGeminiDecision(baseInput());
      expect.unreachable('should have thrown');
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(GeminiDecisionError);
    const err = caught as GeminiDecisionError;
    expect(err.message).not.toContain(API_KEY);
    expect(err.code).not.toContain(API_KEY);
    expect(JSON.stringify(err)).not.toContain(API_KEY);
    expect(String(err.stack ?? '')).not.toContain(API_KEY);
  });

  it('never includes the API key in an HTTP-error code or message', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { error: `denied for key=${API_KEY}` }));

    await expect(generateGeminiDecision(baseInput())).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(GeminiDecisionError);
      const err = error as GeminiDecisionError;
      expect(err.message).not.toContain(API_KEY);
      expect(err.code).not.toContain(API_KEY);
      return true;
    });
  });

  it('never includes the API key in a schema-invalid error', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, geminiPayload(JSON.stringify({ apiKeyLeak: API_KEY }))),
    );

    await expect(generateGeminiDecision(baseInput())).rejects.toSatisfy((error: unknown) => {
      const err = error as GeminiDecisionError;
      expect(err.message).not.toContain(API_KEY);
      return true;
    });
  });
});
