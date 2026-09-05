import { describe, expect, it } from 'vitest';
import { buildSmokeRequest, classifySmokeOutcome } from '../../../scripts/smoke-deepseek-tools.mjs';

describe('smoke request', () => {
  it('never carries the api key inside the request body', () => {
    const body = buildSmokeRequest({ model: 'deepseek-v4-flash', tools: [] });
    expect(JSON.stringify(body)).not.toMatch(/sk-|api[_-]?key/i);
  });

  it('asks for enough output tokens for a two-round tool loop', () => {
    expect(buildSmokeRequest({ model: 'deepseek-v4-flash', tools: [] }).max_output_tokens)
      .toBeGreaterThanOrEqual(1600);
  });
});

describe('smoke outcome', () => {
  it('detects a function_call item and its call_id', () => {
    expect(classifySmokeOutcome({
      status: 'completed',
      output: [{ type: 'function_call', call_id: 'c1', name: 'search_catalog', arguments: '{}' }],
    })).toEqual({ kind: 'function_call', call_ids: ['c1'], reason: null });
  });

  it('detects a plain message as the end of the loop', () => {
    expect(classifySmokeOutcome({
      status: 'completed',
      output: [{ type: 'message', content: [{ type: 'output_text', text: 'listo' }] }],
    })).toEqual({ kind: 'message', call_ids: [], reason: null });
  });

  it('surfaces a truncated response instead of pretending it finished', () => {
    expect(classifySmokeOutcome({
      status: 'incomplete',
      incomplete_details: { reason: 'max_output_tokens' },
      output: [],
    })).toEqual({ kind: 'incomplete', call_ids: [], reason: 'max_output_tokens' });
  });
});
