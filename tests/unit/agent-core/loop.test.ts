import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AGENT_LOOP_DEADLINE_MS,
  MAX_TOOL_ROUNDS,
  runAgentTurnV3,
} from '../../../agent-core/src/loop';
import type {
  ModelOutputV3,
  ModelProvider,
  ToolDefinitionV3,
} from '../../../agent-core/src/ports/model-provider';
import type { ToolExecutor } from '../../../agent-core/src/ports/tool-executor';

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

function provider(script: ModelOutputV3[]) {
  let index = 0;
  return {
    generate: vi.fn(async (input: Parameters<ModelProvider['generate']>[0]) => {
      void input;
      return script[index++]!;
    }),
  };
}

describe('runAgentTurnV3', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

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
    expect(firstCall.deadline_ms).toBe(AGENT_LOOP_DEADLINE_MS);
    expect(firstCall.signal).toBeInstanceOf(AbortSignal);
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

  it('normalizes one rejected tool without discarding the successful result', async () => {
    const model = provider([
      { tool_calls: [
        { call_id: 'ok', name: 'search_catalog', arguments: '{}' },
        { call_id: 'failed', name: 'prepare_payment_link', arguments: '{}' },
      ] },
      { decision },
    ]);
    const execute = vi.fn(async (call: { name: string }) => {
      if (call.name === 'prepare_payment_link') throw new Error('private adapter details');
      return {
        tool: call.name, success: true, canonical_data: { offerings: [] },
        error_code: null, recoverable: false,
        idempotency_result: 'not_applicable' as const, preparation_id: null,
      };
    });

    await runAgentTurnV3(
      { model, tools: { execute }, now: () => 0 },
      { instructions: 'x', conversation: [], toolDefinitions },
    );

    const returned = JSON.stringify(model.generate.mock.calls[1]![0].conversation);
    expect(returned).toContain('offerings');
    expect(returned).toContain('TOOL_EXECUTION_FAILED');
    expect(returned).not.toContain('private adapter details');
  });

  it('executes at most four calls and starts the selected calls in parallel', async () => {
    const calls = Array.from({ length: 5 }, (_, index) => ({
      call_id: `c${index + 1}`,
      name: `tool_${index + 1}`,
      arguments: '{}',
    }));
    const model = provider([{ tool_calls: calls }, { decision }]);
    const started: string[] = [];
    const pending: Array<() => void> = [];
    const execute = vi.fn((call: { name: string }) => new Promise<{
      tool: string; success: true; canonical_data: object; error_code: null;
      recoverable: false; idempotency_result: 'not_applicable'; preparation_id: null;
    }>((resolve) => {
      started.push(call.name);
      pending.push(() => resolve({
        tool: call.name, success: true, canonical_data: {}, error_code: null,
        recoverable: false, idempotency_result: 'not_applicable', preparation_id: null,
      }));
      if (started.length === 4) pending.forEach((finish) => finish());
    }));

    const result = await runAgentTurnV3(
      { model, tools: { execute }, now: () => 0 },
      { instructions: 'x', conversation: [], toolDefinitions },
    );

    expect(result).toEqual({ outcome: 'decided', decision, rounds: 1 });
    expect(started).toEqual(['tool_1', 'tool_2', 'tool_3', 'tool_4']);
    expect(execute).toHaveBeenCalledTimes(4);
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
    expect(model.generate.mock.calls[2]![0]).toMatchObject({
      toolDefinitions: [],
      force_final: true,
    });
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

  it('rejects a decision returned after the hard deadline', async () => {
    let clock = 0;
    const model = {
      generate: vi.fn(async () => {
        clock = 7_000;
        return { decision };
      }),
    };
    const result = await runAgentTurnV3(
      { model, tools: { execute: vi.fn() }, now: () => clock },
      { instructions: 'x', conversation: [], toolDefinitions },
    );
    expect(result).toEqual({ outcome: 'exhausted', reason: 'DEADLINE' });
  });

  it('aborts a model promise that never settles at the hard wall deadline', async () => {
    vi.useFakeTimers();
    const model = {
      generate: vi.fn(async (_input: Parameters<ModelProvider['generate']>[0]) => (
        new Promise<ModelOutputV3>(() => undefined)
      )),
    };
    const running = runAgentTurnV3(
      { model, tools: { execute: vi.fn() }, now: () => Date.now() },
      { instructions: 'x', conversation: [], toolDefinitions },
    );
    await vi.advanceTimersByTimeAsync(AGENT_LOOP_DEADLINE_MS);
    await expect(running).resolves.toEqual({ outcome: 'exhausted', reason: 'DEADLINE' });
    expect(model.generate.mock.calls[0]![0].signal.aborted).toBe(true);
  });

  it('aborts a tool promise that never settles at the hard wall deadline', async () => {
    vi.useFakeTimers();
    const model = provider([{
      tool_calls: [{ call_id: 'c1', name: 'search_catalog', arguments: '{}' }],
    }]);
    const execute = vi.fn(async (
      _call: Parameters<ToolExecutor['execute']>[0],
      _context: Parameters<ToolExecutor['execute']>[1],
    ) => new Promise<never>(() => undefined));
    const running = runAgentTurnV3(
      { model, tools: { execute }, now: () => Date.now() },
      { instructions: 'x', conversation: [], toolDefinitions },
    );
    await vi.advanceTimersByTimeAsync(AGENT_LOOP_DEADLINE_MS);
    await expect(running).resolves.toEqual({ outcome: 'exhausted', reason: 'DEADLINE' });
    expect(execute.mock.calls[0]![1].signal.aborted).toBe(true);
  });

  it.each([
    {},
    { decision, tool_calls: [] },
  ])('fails closed for a malformed provider output: %j', async (malformed) => {
    const model = {
      generate: vi.fn(async () => malformed as unknown as ModelOutputV3),
    };
    const result = await runAgentTurnV3(
      { model, tools: { execute: vi.fn() }, now: () => 0 },
      { instructions: 'x', conversation: [], toolDefinitions },
    );
    expect(result).toEqual({ outcome: 'exhausted', reason: 'MAX_ROUNDS' });
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
