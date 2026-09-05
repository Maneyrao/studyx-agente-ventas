import { describe, expect, it, vi } from 'vitest';
import { MAX_TOOL_ROUNDS, runAgentTurnV3 } from '../../../agent-core/src/loop';
import type {
  ModelProvider,
  ToolDefinitionV3,
} from '../../../agent-core/src/ports/model-provider';

const decision = {
  schema_version: 3 as const,
  blocks: [{ type: 'narrative' as const, text: 'Listo.' }],
  commit_preparations: [],
  used_memory_ids: [],
  state_patch: { expected_state_version: 1, set: {} },
  response_type: 'commercial_reply',
};

const toolDefinitions = [{
  type: 'function',
  name: 'search_catalog',
  description: 'Busca el catálogo canónico.',
  parameters: { type: 'object', properties: {} },
}] satisfies readonly ToolDefinitionV3[];

function provider(script: Array<{
  tool_calls?: Array<{ call_id: string; name: string; arguments: string }>;
  decision?: typeof decision;
}>) {
  let index = 0;
  return {
    generate: vi.fn(async (input: Parameters<ModelProvider['generate']>[0]) => {
      void input;
      return script[index++]!;
    }),
  };
}

describe('runAgentTurnV3', () => {
  it('returns the decision when the model answers without tools', async () => {
    const model = provider([{ decision }]);
    const result = await runAgentTurnV3(
      { model, tools: { execute: vi.fn() }, now: () => 0 },
      { instructions: 'x', conversation: [], toolDefinitions },
    );
    expect(result).toEqual({ outcome: 'decided', decision, rounds: 0 });
    expect(model.generate).toHaveBeenCalledTimes(1);
    const firstCall = model.generate.mock.calls[0]![0];
    expect(firstCall.toolDefinitions).toEqual(toolDefinitions);
    expect(firstCall.toolDefinitions[0]).not.toHaveProperty('function');
    expect(firstCall.force_final).toBe(false);
  });

  it('feeds tool results back and then returns the decision', async () => {
    const model = provider([
      { tool_calls: [{ call_id: 'c1', name: 'search_catalog', arguments: '{}' }] },
      { decision },
    ]);
    const execute = vi.fn(async () => ({
      tool: 'search_catalog', success: true, canonical_data: { offerings: [] },
      error_code: null, recoverable: false,
      idempotency_result: 'not_applicable' as const, preparation_id: null,
    }));
    const result = await runAgentTurnV3(
      { model, tools: { execute }, now: () => 0 },
      { instructions: 'x', conversation: [], toolDefinitions },
    );
    expect(execute).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ outcome: 'decided', decision, rounds: 1 });
  });

  it('gives a failed tool result back to the agent instead of hiding it', async () => {
    const model = provider([
      { tool_calls: [{ call_id: 'c1', name: 'prepare_payment_link', arguments: '{}' }] },
      { decision },
    ]);
    const execute = vi.fn(async () => ({
      tool: 'prepare_payment_link', success: false, canonical_data: null,
      error_code: 'LINK_CONFIG_MISSING', recoverable: true,
      idempotency_result: 'not_applicable' as const, preparation_id: null,
    }));
    await runAgentTurnV3(
      { model, tools: { execute }, now: () => 0 },
      { instructions: 'x', conversation: [], toolDefinitions },
    );
    const secondCall = model.generate.mock.calls[1]![0];
    expect(JSON.stringify(secondCall.conversation)).toContain('LINK_CONFIG_MISSING');
  });

  it('stops after MAX_TOOL_ROUNDS instead of looping forever', async () => {
    const call = { tool_calls: [{ call_id: 'c', name: 'search_catalog', arguments: '{}' }] };
    const model = provider([call, call, call, call]);
    const execute = vi.fn(async () => ({
      tool: 'search_catalog', success: true, canonical_data: {}, error_code: null,
      recoverable: false, idempotency_result: 'not_applicable' as const, preparation_id: null,
    }));
    const result = await runAgentTurnV3(
      { model, tools: { execute }, now: () => 0 },
      { instructions: 'x', conversation: [], toolDefinitions },
    );
    expect(result).toEqual({ outcome: 'exhausted', reason: 'MAX_ROUNDS' });
    expect(model.generate).toHaveBeenCalledTimes(MAX_TOOL_ROUNDS + 1);
    expect(execute).toHaveBeenCalledTimes(MAX_TOOL_ROUNDS);
  });

  it('forces a final response without tools after the first round exceeds the soft deadline', async () => {
    let clock = 0;
    const model = provider([
      { tool_calls: [{ call_id: 'c1', name: 'search_catalog', arguments: '{}' }] },
      { decision },
    ]);
    const result = await runAgentTurnV3(
      { model, tools: { execute: vi.fn(async () => { clock = 3_000; return {
        tool: 'search_catalog', success: true, canonical_data: {}, error_code: null,
        recoverable: false, idempotency_result: 'not_applicable' as const, preparation_id: null,
      }; }) }, now: () => clock },
      { instructions: 'x', conversation: [], toolDefinitions },
    );
    expect(result).toEqual({ outcome: 'decided', decision, rounds: 1 });
    expect(model.generate).toHaveBeenCalledTimes(2);
    expect(model.generate.mock.calls[1]![0]).toMatchObject({
      toolDefinitions: [],
      force_final: true,
    });
  });

  it('reports DEADLINE when the budget is gone before any decision', async () => {
    let clock = 0;
    const model = {
      generate: vi.fn(async (input: Parameters<ModelProvider['generate']>[0]) => {
        void input;
        clock = 7_000;
        return { tool_calls: [{ call_id: 'c1', name: 'search_catalog', arguments: '{}' }] };
      }),
    };
    const result = await runAgentTurnV3(
      { model, tools: { execute: vi.fn() }, now: () => clock },
      { instructions: 'x', conversation: [], toolDefinitions },
    );
    expect(result).toEqual({ outcome: 'exhausted', reason: 'DEADLINE' });
  });

  it('does not ask the model again after tools exhaust the hard deadline', async () => {
    let clock = 0;
    const model = provider([
      { tool_calls: [{ call_id: 'c1', name: 'search_catalog', arguments: '{}' }] },
      { decision },
    ]);
    const result = await runAgentTurnV3(
      { model, tools: { execute: vi.fn(async () => {
        clock = 7_000;
        return {
          tool: 'search_catalog', success: true, canonical_data: {}, error_code: null,
          recoverable: false, idempotency_result: 'not_applicable' as const, preparation_id: null,
        };
      }) }, now: () => clock },
      { instructions: 'x', conversation: [], toolDefinitions },
    );
    expect(result).toEqual({ outcome: 'exhausted', reason: 'DEADLINE' });
    expect(model.generate).toHaveBeenCalledTimes(1);
  });
});
