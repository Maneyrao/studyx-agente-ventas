import { describe, expect, it } from 'vitest';

import { createGoldenOfficialResponsesProviderV1 } from './provider';
import { AGENT_A_DEEPSEEK_MODEL, resolveAgentADeepSeekModelV1 } from '../../botpress-agent/src/config/agent-a-model';

const body = (role: 'agent' | 'judge' | 'post_sale') => ({
  model: 'deepseek-v4-flash', instructions: 'unchanged instructions', input: 'synthetic context',
  reasoning: { effort: 'none' }, temperature: 0.2, stream: false, max_output_tokens: 1600,
  text: { format: { type: 'json_schema', name: role === 'agent' ? 'studyx_agent_a_turn_proposal_v1'
    : role === 'judge' ? 'studyx_golden_semantic_turn_judge_v2' : 'studyx_post_sale_narrative',
  schema: { type: 'object' } } },
});

describe('official DeepSeek adapter confined to golden evaluation', () => {
  it.each(['deepseek-v4-flash', 'deepseek-v4-pro'])('maps only the agent model to %s and preserves signal, headers and response', async (agentModel) => {
    const signal = new AbortController().signal;
    const headers = { authorization: 'Bearer synthetic-eval-secret', 'content-type': 'application/json' };
    const response = new Response(JSON.stringify({ model: agentModel, output_text: '{"unchanged":true}',
      usage: { input_tokens: 12, input_tokens_details: { cached_tokens: 8 }, output_tokens: 4, total_tokens: 16 } }),
    { status: 200, headers: { 'x-original': 'retained' } });
    const requests: RequestInit[] = [];
    const adapter = createGoldenOfficialResponsesProviderV1({ agentModel, judgeModel: 'deepseek-v4-flash' }, {
      fetchImpl: async (_request, init) => { requests.push(init!); return response; },
    });
    const original = body('agent');
    const actual = await adapter.fetch('https://api.deepseek.com/responses', {
      method: 'POST', headers, signal, body: JSON.stringify(original),
    });
    expect(JSON.parse(String(requests[0].body))).toEqual({ ...original, model: agentModel });
    expect(requests[0].signal).toBe(signal);
    expect(requests[0].headers).toBe(headers);
    expect(actual).toBe(response);
    expect(await actual.json()).toMatchObject({ output_text: '{"unchanged":true}' });
    expect(adapter.report()).toMatchObject({ provider: 'deepseek', model: agentModel, judge_model: 'deepseek-v4-flash',
      logical_calls: 1, attempts: 1, tokens: { input: 12, cached: 8, output: 4, total: 16 } });
    expect(adapter.report().records[0]).toMatchObject({ role: 'agent', source_model: 'deepseek-v4-flash',
      requested_model: agentModel, returned_model: agentModel, status: 200 });
    expect(JSON.stringify(adapter.report())).not.toContain('synthetic-eval-secret');
  });

  it('does not relax the production model guard for Pro', () => {
    expect(AGENT_A_DEEPSEEK_MODEL).toBe('deepseek-v4-flash');
    expect(() => resolveAgentADeepSeekModelV1('deepseek-v4-pro')).toThrow('MODEL_MISMATCH');
  });

  it('keeps the same Flash judge for the Pro evaluation and leaves post-sale model untouched', async () => {
    const models: string[] = [];
    const adapter = createGoldenOfficialResponsesProviderV1({ agentModel: 'deepseek-v4-pro', judgeModel: 'deepseek-v4-flash' }, {
      fetchImpl: async (_request, init) => { models.push(JSON.parse(String(init?.body)).model);
        return new Response(JSON.stringify({ model: models.at(-1), output_text: '{}' })); },
    });
    for (const role of ['judge', 'post_sale'] as const) {
      await adapter.fetch('https://api.deepseek.com/responses', { method: 'POST', body: JSON.stringify(body(role)) });
    }
    expect(models).toEqual(['deepseek-v4-flash', 'deepseek-v4-flash']);
    expect(adapter.report().records.map(record => record.role)).toEqual(['judge', 'post_sale']);
  });

  it('records errors and in-flight attempts without adding retries or changing failures', async () => {
    const failure = new DOMException('synthetic abort', 'AbortError');
    let calls = 0;
    const progress: number[] = [];
    const adapter = createGoldenOfficialResponsesProviderV1({ agentModel: 'deepseek-v4-flash', judgeModel: 'deepseek-v4-flash' }, {
      fetchImpl: async () => { calls += 1; throw failure; },
      onReport: async report => { progress.push(report.attempts); },
    });
    await expect(adapter.fetch('https://api.deepseek.com/responses', { body: JSON.stringify(body('agent')) })).rejects.toBe(failure);
    expect(calls).toBe(1);
    expect(progress).toEqual([1, 1]);
    expect(adapter.report()).toMatchObject({ attempts: 1, usage_missing_attempts: 1 });
    expect(adapter.report().records[0]).toMatchObject({ error_code: 'DEEPSEEK_ABORTED' });
  });

  it('rejects unsupported model, non-Flash judge, unknown roles and nonofficial origins before fetching', async () => {
    const dependencies = { fetchImpl: async () => { throw new Error('must not fetch'); } };
    expect(() => createGoldenOfficialResponsesProviderV1({ agentModel: 'arbitrary-model', judgeModel: 'deepseek-v4-flash' }, dependencies)).toThrow('MODEL');
    expect(() => createGoldenOfficialResponsesProviderV1({ agentModel: 'deepseek-v4-pro', judgeModel: 'deepseek-v4-pro' }, dependencies)).toThrow('JUDGE');
    const adapter = createGoldenOfficialResponsesProviderV1({ agentModel: 'deepseek-v4-pro', judgeModel: 'deepseek-v4-flash' }, dependencies);
    await expect(adapter.fetch('https://example.invalid/responses', { body: JSON.stringify(body('agent')) })).rejects.toThrow('ORIGIN');
    await expect(adapter.fetch('https://api.deepseek.com/responses', { body: JSON.stringify({ model: 'deepseek-v4-flash' }) })).rejects.toThrow('ROLE');
  });
});
