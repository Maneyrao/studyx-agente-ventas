import { describe, expect, it, vi } from 'vitest';
import {
  runAgentTurnWithIntegrityV3,
  type AgentTurnWithIntegrityResultV3,
} from '../../../agent-core/src/loop';
import type {
  AgentTurnDecisionV3,
  ModelProvider,
} from '../../../agent-core/src/ports/model-provider';

type GenerateInput = Parameters<ModelProvider['generate']>[0];

const good: AgentTurnDecisionV3 = {
  schema_version: 3,
  blocks: [{ type: 'narrative', text: 'Listo.' }],
  commit_preparations: [],
  used_memory_ids: [],
  state_patch: { expected_state_version: 1, set: {} },
  response_type: 'commercial_reply',
};
const bad: AgentTurnDecisionV3 = {
  ...good,
  blocks: [{ type: 'narrative', text: 'Sale USD 47.' }],
};
const rejection = {
  rejection_id: 'r-1',
  attempt: 1 as const,
  violations: [{ code: 'NARRATIVE_CONTAINS_AMOUNT', subject: 'narrative' }],
  authorized_alternatives: {
    fact_ids: ['fact:price:one_time'],
    preparations: [],
    missing_information: [],
  },
};

function deps(decisions: AgentTurnDecisionV3[], checks: boolean[]) {
  let decisionIndex = 0;
  let checkIndex = 0;
  return {
    model: {
      generate: vi.fn(async (_input: GenerateInput) => ({
        decision: decisions[decisionIndex++]!,
      })),
    },
    tools: { execute: vi.fn() },
    now: () => 0,
    check: vi.fn(() => (
      checks[checkIndex++] ? { ok: true as const } : { ok: false as const, rejection }
    )),
  };
}

describe('runAgentTurnWithIntegrityV3', () => {
  it('returns the decision untouched when integrity accepts it', async () => {
    const result = await runAgentTurnWithIntegrityV3(
      deps([good], [true]),
      { instructions: 'x', conversation: [], toolDefinitions: [] },
    );
    expect(result).toEqual({ outcome: 'decided', decision: good, repaired: false });
  });

  it('gives the rejection back as an orchestrator item, never a tool result', async () => {
    const dependencies = deps([bad, good], [false, true]);
    const result = await runAgentTurnWithIntegrityV3(dependencies, {
      instructions: 'x', conversation: [], toolDefinitions: [],
    });
    expect(result).toEqual({ outcome: 'decided', decision: good, repaired: true });

    const second = dependencies.model.generate.mock.calls[1]![0];
    const injected = second.conversation.at(-1)!;
    expect(injected.role).toBe('developer');
    expect(injected).not.toHaveProperty('call_id');
    expect(String(injected.content)).toContain('NARRATIVE_CONTAINS_AMOUNT');
  });

  it('never offers integrity_check as a callable tool', async () => {
    const dependencies = deps([good], [true]);
    await runAgentTurnWithIntegrityV3(dependencies, {
      instructions: 'x',
      conversation: [],
      toolDefinitions: [{
        type: 'function',
        name: 'search_catalog',
        description: 'Search',
        parameters: { type: 'object' },
      }],
    });
    const offered = dependencies.model.generate.mock.calls[0]![0];
    expect(JSON.stringify(offered.toolDefinitions)).not.toContain('integrity_check');
  });

  it('emits a complete fallback after one failed repair without rejected text', async () => {
    const result: AgentTurnWithIntegrityResultV3 = await runAgentTurnWithIntegrityV3(
      deps([bad, bad], [false, false]),
      { instructions: 'x', conversation: [], toolDefinitions: [] },
    );
    expect(result).toEqual({
      outcome: 'fallback',
      reason: 'AGENT_LOOP_INTEGRITY_FAILED',
      rejection,
    });
    expect(JSON.stringify(result)).not.toContain('USD 47');
  });

  it('repairs only once', async () => {
    const dependencies = deps([bad, bad], [false, false]);
    await runAgentTurnWithIntegrityV3(
      dependencies,
      { instructions: 'x', conversation: [], toolDefinitions: [] },
    );
    expect(dependencies.model.generate).toHaveBeenCalledTimes(2);
  });

  it('keeps the repair inside the original hard deadline', async () => {
    let clock = 0;
    const model = {
      generate: vi.fn(async (_input: GenerateInput) => {
        clock = model.generate.mock.calls.length === 1 ? 6_400 : 6_600;
        return { decision: model.generate.mock.calls.length === 1 ? bad : good };
      }),
    };
    const result = await runAgentTurnWithIntegrityV3({
      model,
      tools: { execute: vi.fn() },
      now: () => clock,
      check: vi.fn(() => ({ ok: false as const, rejection })),
    }, {
      instructions: 'x', conversation: [], toolDefinitions: [],
    });

    expect(model.generate.mock.calls[1]![0]!.deadline_ms).toBe(6_500);
    expect(result).toEqual({
      outcome: 'fallback',
      reason: 'AGENT_LOOP_INTEGRITY_FAILED',
      rejection,
    });
  });

  it('falls back with the budget reason when the loop never decides', async () => {
    const result = await runAgentTurnWithIntegrityV3({
      model: { generate: vi.fn(async (_input: GenerateInput) => ({ tool_calls: [] })) },
      tools: { execute: vi.fn() },
      now: () => 0,
      check: vi.fn(),
    }, {
      instructions: 'x', conversation: [], toolDefinitions: [],
    });
    expect(result).toEqual({
      outcome: 'fallback',
      reason: 'AGENT_LOOP_BUDGET_EXHAUSTED',
      rejection: null,
    });
  });
});
