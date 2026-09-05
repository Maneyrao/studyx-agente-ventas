import { describe, expect, it } from 'vitest';
import { buildSmokeRequest, classifySmokeOutcome, TOOLS } from '../../../scripts/smoke-deepseek-tools.mjs';

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

// DeepSeek's /responses endpoint returned HTTP 400 "Failed to deserialize
// the JSON body into the target type: tools[0]: missing field `name`" when
// TOOLS used the Chat Completions nested shape ({type:'function',
// function:{name, description, parameters}}). It only accepts the flat
// Responses API shape (name/description/parameters as top-level properties
// of the tool object, no `function` wrapper). Discovered live, at the cost
// of two paid API calls — see docs/evidence/2026-09-05-deepseek-tools-smoke.jsonl
// for the raw error body. This test pins that shape so a well-meaning
// "fix" back to the more familiar nested form fails fast, for free.
describe('DeepSeek /responses requires the flat tool shape, not the Chat Completions nested form', () => {
  it('every tool has type function with name/description/parameters as its own top-level properties, and no nested function property', () => {
    expect(TOOLS.length).toBeGreaterThan(0);
    for (const tool of TOOLS) {
      expect(tool.type).toBe('function');
      expect(typeof tool.name).toBe('string');
      expect(tool.name.length).toBeGreaterThan(0);
      expect(typeof tool.description).toBe('string');
      expect(tool.description.length).toBeGreaterThan(0);
      expect(typeof tool.parameters).toBe('object');
      expect(tool.parameters).not.toBeNull();
      expect(tool).not.toHaveProperty('function');
    }
  });

  it('every tool\'s parameters is a JSON-Schema object type with a properties object', () => {
    for (const tool of TOOLS) {
      expect(tool.parameters.type).toBe('object');
      expect(typeof tool.parameters.properties).toBe('object');
      expect(tool.parameters.properties).not.toBeNull();
    }
  });
});
