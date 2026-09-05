import { describe, expect, it, vi } from 'vitest';
import {
  modelPromptSha256V3,
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
      generate: vi.fn(async (input: GenerateInput) => {
        void input;
        return { decision: decisions[decisionIndex++]! };
      }),
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
    const dependencies = deps([good], [true]);
    const result = await runAgentTurnWithIntegrityV3(
      dependencies,
      { instructions: 'x', conversation: [], toolDefinitions: [] },
    );
    expect(result).toMatchObject({ outcome: 'decided', decision: good, repaired: false });
    const request = dependencies.model.generate.mock.calls[0]![0];
    expect(result.prompt_sha256).toBe(modelPromptSha256V3(request));
  });

  it('gives the rejection back as an orchestrator item, never a tool result', async () => {
    const dependencies = deps([bad, good], [false, true]);
    const result = await runAgentTurnWithIntegrityV3(dependencies, {
      instructions: 'x', conversation: [], toolDefinitions: [],
    });
    expect(result).toMatchObject({ outcome: 'decided', decision: good, repaired: true });

    const second = dependencies.model.generate.mock.calls[1]![0];
    const injected = second.conversation.at(-1)!;
    expect(injected.role).toBe('developer');
    expect(injected).not.toHaveProperty('call_id');
    expect(String(injected.content)).toContain('NARRATIVE_CONTAINS_AMOUNT');
    expect(result.prompt_sha256).toBe(modelPromptSha256V3(second));
  });

  it('changes the exact prompt hash when the effective conversation changes', () => {
    const base = {
      instructions: 'x',
      toolDefinitions: [] as const,
      force_final: false,
    };
    expect(modelPromptSha256V3({ ...base, conversation: [] }))
      .not.toBe(modelPromptSha256V3({
        ...base,
        conversation: [{ role: 'user', content: 'Hola' }],
      }));
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
    expect(result).toMatchObject({
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
      generate: vi.fn(async (input: GenerateInput) => {
        void input;
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
    expect(result).toMatchObject({
      outcome: 'fallback',
      reason: 'AGENT_LOOP_INTEGRITY_FAILED',
      rejection,
    });
  });

  it('keeps the first observed prompt when the deadline expires before repair starts', async () => {
    const times = [0, 0, 0, 0, 6_500];
    const model = {
      generate: vi.fn(async (input: GenerateInput) => {
        void input;
        return { decision: bad };
      }),
    };
    const result = await runAgentTurnWithIntegrityV3({
      model,
      tools: { execute: vi.fn() },
      now: () => times.shift() ?? 6_500,
      check: vi.fn(() => ({ ok: false as const, rejection })),
    }, { instructions: 'x', conversation: [], toolDefinitions: [] });

    expect(model.generate).toHaveBeenCalledTimes(1);
    const observedPromptSha256 = modelPromptSha256V3(model.generate.mock.calls[0]![0]);
    expect(result).toMatchObject({
      outcome: 'fallback',
      reason: 'AGENT_LOOP_INTEGRITY_FAILED',
      prompt_sha256: observedPromptSha256,
      trace: { model_request_prompt_sha256s: [observedPromptSha256] },
    });
  });

  it('reports explicit prompt absence when the deadline expires before any generation', async () => {
    const times = [0, 0, 6_500];
    const model = { generate: vi.fn(async () => ({ decision: good })) };
    const result = await runAgentTurnWithIntegrityV3({
      model,
      tools: { execute: vi.fn() },
      now: () => times.shift() ?? 6_500,
      check: vi.fn(() => ({ ok: true as const })),
    }, { instructions: 'x', conversation: [], toolDefinitions: [] });

    expect(model.generate).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      outcome: 'fallback',
      reason: 'AGENT_LOOP_BUDGET_EXHAUSTED',
      prompt_sha256: null,
      trace: { model_request_prompt_sha256s: [] },
    });
  });

  it('forces the repair to one final generation and never executes requested tools', async () => {
    const model = {
      generate: vi.fn(async (input: GenerateInput) => {
        void input;
        return model.generate.mock.calls.length === 1
          ? { decision: bad }
          : {
              tool_calls: [{
                call_id: 'repair-tool',
                name: 'search_catalog',
                arguments: '{}',
              }],
            };
      }),
    };
    const execute = vi.fn();
    const result = await runAgentTurnWithIntegrityV3({
      model,
      tools: { execute },
      now: () => 0,
      check: vi.fn(() => ({ ok: false as const, rejection })),
    }, {
      instructions: 'x',
      conversation: [],
      toolDefinitions: [{
        type: 'function', name: 'search_catalog', description: 'Search',
        parameters: { type: 'object' },
      }],
    });

    expect(result).toMatchObject({
      outcome: 'fallback',
      reason: 'AGENT_LOOP_INTEGRITY_FAILED',
      trace: {
        tools_requested: [{ attempt: 2, name: 'search_catalog', call_id: 'repair-tool' }],
        tools_executed: [],
      },
    });
    expect(model.generate).toHaveBeenCalledTimes(2);
    expect(model.generate.mock.calls[1]![0]).toMatchObject({
      force_final: true,
      toolDefinitions: [],
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('repairs with the first tool results and rejected decision still in context', async () => {
    const outputs = [
      { tool_calls: [{ call_id: 'catalog-1', name: 'search_catalog', arguments: '{}' }] },
      { decision: bad },
      { decision: good },
    ];
    const model = {
      generate: vi.fn(async (input: GenerateInput) => {
        void input;
        return outputs.shift()!;
      }),
    };
    const execute = vi.fn(async () => ({
      tool: 'search_catalog',
      success: true,
      canonical_data: { offerings: [{ code: 'course' }] },
      error_code: null,
      recoverable: false,
      idempotency_result: 'not_applicable' as const,
      preparation_id: null,
    }));
    const check = vi.fn((decision: AgentTurnDecisionV3) => (
      decision === good ? { ok: true as const } : { ok: false as const, rejection }
    ));

    const result = await runAgentTurnWithIntegrityV3({
      model, tools: { execute }, now: () => 0, check,
    }, {
      instructions: 'x',
      conversation: [{ role: 'user', content: 'Hola' }],
      toolDefinitions: [{
        type: 'function', name: 'search_catalog', description: 'Search',
        parameters: { type: 'object' },
      }],
    });

    expect(result).toMatchObject({ outcome: 'decided', decision: good, repaired: true });
    const repairConversation = model.generate.mock.calls[2]![0]!.conversation;
    expect(repairConversation).toContainEqual(expect.objectContaining({
      role: 'tool',
      call_id: 'catalog-1',
      content: expect.stringContaining('"code":"course"'),
    }));
    expect(repairConversation).toContainEqual({
      role: 'assistant',
      content: JSON.stringify(bad),
    });
    expect(repairConversation.at(-1)).toEqual({
      role: 'developer',
      content: JSON.stringify(rejection),
    });
  });

  it('traces both rejected attempts by hash and preserves both verdicts', async () => {
    const secondRejection = {
      ...rejection,
      rejection_id: 'r-2',
      violations: [{ code: 'UNRESOLVED_REFERENCE', subject: 'blocks.1' }],
    };
    let checks = 0;
    const result = await runAgentTurnWithIntegrityV3({
      model: {
        generate: vi.fn(async (input: GenerateInput) => {
          void input;
          return { decision: bad };
        }),
      },
      tools: { execute: vi.fn() },
      now: () => 0,
      check: vi.fn(() => ({
        ok: false as const,
        rejection: checks++ === 0 ? rejection : secondRejection,
      })),
    }, { instructions: 'x', conversation: [], toolDefinitions: [] });

    expect(result).toMatchObject({
      outcome: 'fallback',
      trace: { rejections: [rejection, secondRejection] },
    });
    if (result.outcome !== 'fallback') throw new Error('expected fallback');
    expect(result.trace.attempt_hashes.first).toMatch(/^[a-f0-9]{64}$/u);
    expect(result.trace.attempt_hashes.second).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('falls back with the budget reason when the loop never decides', async () => {
    const result = await runAgentTurnWithIntegrityV3({
      model: { generate: vi.fn(async (input: GenerateInput) => {
        void input;
        return { tool_calls: [] };
      }) },
      tools: { execute: vi.fn() },
      now: () => 0,
      check: vi.fn(),
    }, {
      instructions: 'x', conversation: [], toolDefinitions: [],
    });
    expect(result).toMatchObject({
      outcome: 'fallback',
      reason: 'AGENT_LOOP_BUDGET_EXHAUSTED',
      rejection: null,
    });
  });

  it('emits a technical fallback when the provider fails on the first generation', async () => {
    const providerMessage = 'provider secret failure';
    const model = { generate: vi.fn(async (input: GenerateInput) => {
      void input;
      throw new Error(providerMessage);
    }) };
    const result = await runAgentTurnWithIntegrityV3({
      model,
      tools: { execute: vi.fn() },
      now: () => 0,
      check: vi.fn(),
    }, { instructions: 'x', conversation: [], toolDefinitions: [] });

    expect(result).toMatchObject({
      outcome: 'fallback',
      reason: 'AGENT_LOOP_BUDGET_EXHAUSTED',
      rejection: null,
    });
    const observedPromptSha256 = modelPromptSha256V3(model.generate.mock.calls[0]![0]);
    expect(result.prompt_sha256).toBe(observedPromptSha256);
    if (result.outcome !== 'fallback') throw new Error('expected fallback');
    expect(result.trace.model_request_prompt_sha256s).toEqual([observedPromptSha256]);
    expect(JSON.stringify(result)).not.toContain(providerMessage);
  });

  it('emits the integrity fallback when the provider fails during repair', async () => {
    const providerMessage = 'provider secret repair failure';
    let calls = 0;
    const result = await runAgentTurnWithIntegrityV3({
      model: {
        generate: vi.fn(async () => {
          calls += 1;
          if (calls === 1) return { decision: bad };
          throw new Error(providerMessage);
        }),
      },
      tools: { execute: vi.fn() },
      now: () => 0,
      check: vi.fn(() => ({ ok: false as const, rejection })),
    }, { instructions: 'x', conversation: [], toolDefinitions: [] });

    expect(result).toMatchObject({
      outcome: 'fallback',
      reason: 'AGENT_LOOP_INTEGRITY_FAILED',
      rejection,
      trace: { rejections: [rejection] },
    });
    expect(JSON.stringify(result)).not.toContain(providerMessage);
  });
});
