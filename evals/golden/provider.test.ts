import { describe, expect, it } from 'vitest';

import { createGoldenResponsesProviderV1 } from './provider';

function responsesRequest(body: Record<string, unknown>, signal?: AbortSignal): Request {
  return new Request('https://api.deepseek.com/responses', {
    method: 'POST',
    headers: {
      authorization: 'Bearer must-not-be-forwarded',
      'content-type': 'application/json',
      'x-deepseek-test': 'must-not-be-forwarded',
    },
    body: JSON.stringify(body),
    signal,
  });
}

function nimResponse(input: {
  readonly content?: string | null;
  readonly model?: string;
  readonly status?: number;
  readonly usage?: Record<string, unknown> | null;
  readonly headers?: Record<string, string>;
} = {}): Response {
  return new Response(JSON.stringify({
    id: 'chatcmpl-golden',
    model: input.model ?? 'deepseek-ai/deepseek-v4.1-flash',
    choices: [{
      index: 0,
      message: { role: 'assistant', content: input.content ?? '{"ok":true}' },
      finish_reason: 'stop',
    }],
    ...(input.usage === null ? {} : {
      usage: input.usage ?? { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
    }),
  }), {
    status: input.status ?? 200,
    headers: { 'content-type': 'application/json', ...(input.headers ?? {}) },
  });
}

function fakeTime() {
  let current = 0;
  const sleeps: number[] = [];
  return {
    now: () => current,
    sleeps,
    sleep: async (milliseconds: number, signal?: AbortSignal) => {
      if (signal?.aborted) throw new DOMException('The operation was aborted', 'AbortError');
      sleeps.push(milliseconds);
      await Promise.resolve();
      current += milliseconds;
    },
  };
}

function provider(input: {
  readonly fetchImpl: typeof fetch;
  readonly maxRequestsPerMinute?: number;
  readonly maxAttempts?: number;
  readonly now?: () => number;
  readonly sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
}) {
  return createGoldenResponsesProviderV1({
    provider: 'nvidia_nim',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    model: 'deepseek-ai/deepseek-v4.1-flash',
    apiKey: 'nim-secret-that-must-never-be-recorded',
    maxRequestsPerMinute: input.maxRequestsPerMinute ?? 40,
    maxAttempts: input.maxAttempts ?? 4,
    retryBaseDelayMs: 250,
  }, {
    fetchImpl: input.fetchImpl,
    now: input.now,
    sleep: input.sleep,
  });
}

describe('NVIDIA NIM golden Responses adapter', () => {
  it('translates the Responses envelope, forwards only safe headers, and restores the Responses shape', async () => {
    const requests: Array<{ url: string; headers: Headers; body: Record<string, unknown> }> = [];
    const adapter = provider({
      fetchImpl: async (request, init) => {
        requests.push({
          url: request instanceof Request ? request.url : String(request),
          headers: new Headers(init?.headers),
          body: JSON.parse(String(init?.body)) as Record<string, unknown>,
        });
        return nimResponse();
      },
    });

    const response = await adapter.fetch(responsesRequest({
      model: 'deepseek-v4-flash',
      instructions: 'System instructions',
      input: '{"lead":"synthetic"}',
      temperature: 0.2,
      max_output_tokens: 321,
      text: { format: {
        type: 'json_schema',
        name: 'studyx_agent_a_turn_proposal_v1',
        schema: { type: 'object', additionalProperties: false },
      } },
    }));

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe('https://integrate.api.nvidia.com/v1/chat/completions');
    expect(requests[0]?.headers.get('authorization')).toBe('Bearer nim-secret-that-must-never-be-recorded');
    expect(requests[0]?.headers.get('x-deepseek-test')).toBeNull();
    expect(requests[0]?.body).toMatchObject({
      model: 'deepseek-ai/deepseek-v4.1-flash',
      messages: [
        { role: 'system', content: 'System instructions' },
        { role: 'user', content: '{"lead":"synthetic"}' },
      ],
      temperature: 0.2,
      max_tokens: 321,
      stream: false,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'studyx_agent_a_turn_proposal_v1',
          strict: true,
          schema: { type: 'object', additionalProperties: false },
        },
      },
    });
    expect(await response.json()).toMatchObject({
      model: 'deepseek-ai/deepseek-v4.1-flash',
      output_text: '{"ok":true}',
      output: [{ content: [{ type: 'output_text', text: '{"ok":true}' }] }],
      usage: { input_tokens: 11, output_tokens: 7, total_tokens: 18 },
    });

    const report = adapter.report();
    expect(report).toMatchObject({
      provider: 'nvidia_nim',
      model: 'deepseek-ai/deepseek-v4.1-flash',
      logical_calls: 1,
      attempts: 1,
      usage_missing_attempts: 0,
      tokens: { input: 11, output: 7, total: 18 },
    });
    expect(JSON.stringify(report)).not.toContain('nim-secret-that-must-never-be-recorded');
    expect(report.records[0]).toMatchObject({
      role: 'agent',
      requested_model: 'deepseek-v4-flash',
      returned_model: 'deepseek-ai/deepseek-v4.1-flash',
      status: 200,
      response_content: '{"ok":true}',
    });
  });

  it('uses one serialized 40 RPM gate for concurrent calls', async () => {
    const time = fakeTime();
    const starts: number[] = [];
    const adapter = provider({
      now: time.now,
      sleep: time.sleep,
      fetchImpl: async () => {
        starts.push(time.now());
        return nimResponse();
      },
    });

    await Promise.all(Array.from({ length: 4 }, () => adapter.fetch(responsesRequest({
      model: 'deepseek-v4-flash', input: 'synthetic',
    }))));

    expect(starts).toEqual([0, 1_500, 3_000, 4_500]);
    expect(time.sleeps).toEqual([1_500, 1_500, 1_500]);
    expect(adapter.report().records.map((record) => record.rate_limit_wait_ms))
      .toEqual([0, 1_500, 1_500, 1_500]);
  });

  it('honors Retry-After, retries only transient failures, and records every attempt', async () => {
    const time = fakeTime();
    let calls = 0;
    const adapter = provider({
      now: time.now,
      sleep: time.sleep,
      fetchImpl: async () => {
        calls += 1;
        if (calls === 1) {
          return new Response('{"error":"rate limited and intentionally not persisted"}', {
            status: 429,
            headers: { 'retry-after': '2', 'content-type': 'application/json' },
          });
        }
        return nimResponse();
      },
    });

    expect((await adapter.fetch(responsesRequest({ model: 'deepseek-v4-flash', input: 'synthetic' }))).ok)
      .toBe(true);
    expect(calls).toBe(2);
    expect(time.sleeps).toContain(2_000);
    expect(adapter.report()).toMatchObject({ logical_calls: 1, attempts: 2 });
    expect(adapter.report().records).toMatchObject([
      { attempt: 1, status: 429, retry_wait_ms: 2_000, error_code: 'NIM_HTTP_429' },
      { attempt: 2, status: 200, retry_wait_ms: 0, error_code: null },
    ]);
    expect(JSON.stringify(adapter.report())).not.toContain('rate limited and intentionally not persisted');
  });

  it('does not retry authentication or model errors', async () => {
    for (const status of [400, 401, 403, 404, 422]) {
      let calls = 0;
      const adapter = provider({
        fetchImpl: async () => {
          calls += 1;
          return new Response('{"error":"sensitive provider detail"}', { status });
        },
      });
      const response = await adapter.fetch(responsesRequest({ model: 'deepseek-v4-flash', input: 'synthetic' }));
      expect(response.status).toBe(status);
      expect(calls).toBe(1);
      expect(JSON.stringify(adapter.report())).not.toContain('sensitive provider detail');
    }
  });

  it('does not invent usage and preserves invalid or truncated model content verbatim', async () => {
    for (const content of ['not-json', '', '{"truncated":']) {
      const adapter = provider({ fetchImpl: async () => nimResponse({ content, usage: null }) });
      const response = await adapter.fetch(responsesRequest({
        model: 'deepseek-v4-flash', input: 'synthetic',
        text: { format: { type: 'json_schema', name: 'studyx_golden_semantic_turn_judge_v2', schema: {} } },
      }));
      const payload = await response.json() as { output_text?: string; usage?: unknown };
      expect(payload.output_text).toBe(content);
      expect(payload).not.toHaveProperty('usage');
      expect(adapter.report()).toMatchObject({ usage_missing_attempts: 1, tokens: null });
      expect(adapter.report().records[0]).toMatchObject({ role: 'judge', response_content: content, tokens: null });
    }
  });

  it('respects abort while waiting for the shared rate gate', async () => {
    const time = fakeTime();
    const adapter = provider({
      now: time.now,
      sleep: time.sleep,
      fetchImpl: async () => nimResponse(),
    });
    await adapter.fetch(responsesRequest({ model: 'deepseek-v4-flash', input: 'first' }));
    const controller = new AbortController();
    controller.abort();

    await expect(adapter.fetch(responsesRequest(
      { model: 'deepseek-v4-flash', input: 'second' }, controller.signal,
    ))).rejects.toMatchObject({ name: 'AbortError' });
    expect(adapter.report()).toMatchObject({ logical_calls: 2, attempts: 1 });
  });

  it('records an abort that happens after the HTTP request was dispatched', async () => {
    const adapter = provider({
      fetchImpl: async () => {
        throw new DOMException('The operation was aborted', 'AbortError');
      },
    });

    await expect(adapter.fetch(responsesRequest(
      { model: 'deepseek-v4-flash', input: 'synthetic' },
    ))).rejects.toMatchObject({ name: 'AbortError' });
    expect(adapter.report()).toMatchObject({ logical_calls: 1, attempts: 1 });
    expect(adapter.report().records[0]).toMatchObject({
      attempt: 1,
      status: null,
      error_code: 'NIM_ABORTED',
      tokens: null,
    });
  });

  it('persists incremental telemetry after every provider attempt', async () => {
    const snapshots: number[] = [];
    let calls = 0;
    const adapter = createGoldenResponsesProviderV1({
      provider: 'nvidia_nim',
      baseUrl: 'https://integrate.api.nvidia.com/v1',
      model: 'deepseek-ai/deepseek-v4.1-flash',
      apiKey: 'nim-secret-that-must-never-be-recorded',
      maxRequestsPerMinute: 40,
      maxAttempts: 2,
      retryBaseDelayMs: 0,
    }, {
      fetchImpl: async () => {
        calls += 1;
        return calls === 1 ? new Response('{}', { status: 503 }) : nimResponse();
      },
      sleep: async () => undefined,
      now: () => 0,
      onReport: async (report) => { snapshots.push(report.attempts); },
    });

    await adapter.fetch(responsesRequest({ model: 'deepseek-v4-flash', input: 'synthetic' }));
    expect(snapshots).toEqual([1, 2]);
  });
});
