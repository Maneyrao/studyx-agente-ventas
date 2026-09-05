import { describe, expect, it, vi } from 'vitest';
import {
  runAgentTurnWithIntegrityV3,
  type AgentTurnWithIntegrityResultV3,
} from '../../agent-core/src/loop';
import type { AgentTurnDecisionV3 } from '../../agent-core/src/ports/model-provider';
import { commitAgentTurnV3 } from '@/features/conversation/application/commit-agent-turn-v3';
import { sql } from '@/lib/db/orchestrator';
import { seedConversationForAgentTurn } from '../helpers/agent-turn-fixtures';

const rejection = {
  rejection_id: 'prompt-binding-rejection',
  attempt: 1 as const,
  violations: [{ code: 'NARRATIVE_CONTAINS_AMOUNT', subject: 'blocks.0' }],
  authorized_alternatives: {
    fact_ids: [],
    preparations: [],
    missing_information: [],
  },
};

function decision(stateVersion: number, text = 'Seguimos.'): AgentTurnDecisionV3 {
  return {
    schema_version: 3,
    blocks: [{ type: 'narrative', text }],
    commit_preparations: [],
    used_memory_ids: [],
    state_patch: { expected_state_version: stateVersion, set: {} },
    response_type: 'commercial_reply',
  };
}

async function persistedPromptSha256(decisionId: string): Promise<string | null> {
  const [row] = await sql<Array<{ prompt_sha256: string | null }>>`
    SELECT release_manifest ->> 'prompt_sha256' AS prompt_sha256
    FROM agent_decisions
    WHERE id = ${decisionId}::uuid
  `;
  return row?.prompt_sha256 ?? null;
}

async function durableProof(seeded: Awaited<ReturnType<typeof seedConversationForAgentTurn>>) {
  const [proof] = await sql<Array<{ decisions: number; outbounds: number; version: number }>>`
    SELECT
      (SELECT count(*)::int FROM agent_decisions
        WHERE turn_id = ${seeded.turn_id}::uuid) AS decisions,
      (SELECT count(*)::int FROM messages
        WHERE in_reply_to = ${seeded.turn_id}::uuid AND direction = 'outbound') AS outbounds,
      state.version
    FROM conversation_sales_context_states_v1 AS state
    WHERE state.conversation_id = ${seeded.conversation_id}::uuid
  `;
  return proof;
}

async function commitResult(
  seeded: Awaited<ReturnType<typeof seedConversationForAgentTurn>>,
  result: AgentTurnWithIntegrityResultV3,
) {
  const releaseManifest = {
    ...seeded.release_manifest,
    prompt_sha256: result.prompt_sha256,
  };
  return result.outcome === 'decided'
    ? commitAgentTurnV3(sql, {
        turn_id: seeded.turn_id,
        trace_id: seeded.trace_id,
        decision: result.decision,
        effective_prompt_sha256: result.prompt_sha256,
        release_manifest: releaseManifest,
      })
    : commitAgentTurnV3(sql, {
        turn_id: seeded.turn_id,
        trace_id: seeded.trace_id,
        fallback: result,
        effective_prompt_sha256: result.prompt_sha256,
        release_manifest: releaseManifest,
      });
}

describe('agent loop prompt evidence binding', () => {
  it('persists the exact first-attempt prompt hash', async () => {
    const seeded = await seedConversationForAgentTurn();
    const result = await runAgentTurnWithIntegrityV3({
      model: { generate: vi.fn(async () => ({ decision: decision(seeded.state_version) })) },
      tools: { execute: vi.fn() },
      now: () => 0,
      check: vi.fn(() => ({ ok: true as const })),
    }, { instructions: 'first', conversation: [], toolDefinitions: [] });

    expect(result).toMatchObject({ outcome: 'decided', repaired: false });
    const committed = await commitResult(seeded, result);
    expect(await persistedPromptSha256(committed.decision_id)).toBe(result.prompt_sha256);
  });

  it('persists the exact repair prompt hash', async () => {
    const seeded = await seedConversationForAgentTurn();
    let generation = 0;
    const result = await runAgentTurnWithIntegrityV3({
      model: {
        generate: vi.fn(async () => ({
          decision: generation++ === 0
            ? decision(seeded.state_version, 'Sale USD 47.')
            : decision(seeded.state_version),
        })),
      },
      tools: { execute: vi.fn() },
      now: () => 0,
      check: vi.fn((candidate) => (
        candidate.blocks[0]?.type === 'narrative' && candidate.blocks[0].text === 'Seguimos.'
          ? { ok: true as const }
          : { ok: false as const, rejection }
      )),
    }, { instructions: 'repair', conversation: [], toolDefinitions: [] });

    expect(result).toMatchObject({ outcome: 'decided', repaired: true });
    const committed = await commitResult(seeded, result);
    expect(await persistedPromptSha256(committed.decision_id)).toBe(result.prompt_sha256);
  });

  it('accepts the budget fallback directly and binds its prompt hash', async () => {
    const seeded = await seedConversationForAgentTurn();
    const result = await runAgentTurnWithIntegrityV3({
      model: { generate: vi.fn(async () => ({ tool_calls: [] })) },
      tools: { execute: vi.fn() },
      now: () => 0,
      check: vi.fn(),
    }, { instructions: 'budget', conversation: [], toolDefinitions: [] });

    expect(result).toMatchObject({
      outcome: 'fallback',
      reason: 'AGENT_LOOP_BUDGET_EXHAUSTED',
      rejection: null,
    });
    const committed = await commitResult(seeded, result);
    expect(await persistedPromptSha256(committed.decision_id)).toBe(result.prompt_sha256);
  });

  it('persists and replays explicit prompt absence only when no model request began', async () => {
    const seeded = await seedConversationForAgentTurn();
    const times = [0, 0, 6_500];
    const model = { generate: vi.fn(async () => ({ decision: decision(seeded.state_version) })) };
    const result = await runAgentTurnWithIntegrityV3({
      model,
      tools: { execute: vi.fn() },
      now: () => times.shift() ?? 6_500,
      check: vi.fn(() => ({ ok: true as const })),
    }, { instructions: 'no request', conversation: [], toolDefinitions: [] });

    expect(result).toMatchObject({
      outcome: 'fallback',
      reason: 'AGENT_LOOP_BUDGET_EXHAUSTED',
      prompt_sha256: null,
      trace: { model_request_prompt_sha256s: [] },
    });
    expect(model.generate).not.toHaveBeenCalled();

    const first = await commitResult(seeded, result);
    const replay = await commitResult(seeded, result);
    expect(replay).toEqual(first);
    expect(await persistedPromptSha256(first.decision_id)).toBeNull();
    await expect(durableProof(seeded)).resolves.toMatchObject({ decisions: 1, outbounds: 1 });
  });

  it('persists an observed prompt hash when the provider throws', async () => {
    const seeded = await seedConversationForAgentTurn();
    const model = { generate: vi.fn(async () => { throw new Error('provider unavailable'); }) };
    const result = await runAgentTurnWithIntegrityV3({
      model,
      tools: { execute: vi.fn() },
      now: () => 0,
      check: vi.fn(),
    }, { instructions: 'provider failure', conversation: [], toolDefinitions: [] });

    expect(result).toMatchObject({
      outcome: 'fallback',
      reason: 'AGENT_LOOP_BUDGET_EXHAUSTED',
    });
    if (result.outcome !== 'fallback' || result.prompt_sha256 === null) {
      throw new Error('expected observed budget fallback');
    }
    expect(result.trace.model_request_prompt_sha256s).toEqual([result.prompt_sha256]);
    const committed = await commitResult(seeded, result);
    expect(await persistedPromptSha256(committed.decision_id)).toBe(result.prompt_sha256);
  });

  it('accepts the integrity fallback directly and binds its repair prompt hash', async () => {
    const seeded = await seedConversationForAgentTurn();
    const rejected = decision(seeded.state_version, 'Sale USD 47.');
    const result = await runAgentTurnWithIntegrityV3({
      model: { generate: vi.fn(async () => ({ decision: rejected })) },
      tools: { execute: vi.fn() },
      now: () => 0,
      check: vi.fn(() => ({ ok: false as const, rejection })),
    }, { instructions: 'integrity', conversation: [], toolDefinitions: [] });

    expect(result).toMatchObject({
      outcome: 'fallback',
      reason: 'AGENT_LOOP_INTEGRITY_FAILED',
      rejection,
    });
    const committed = await commitResult(seeded, result);
    expect(await persistedPromptSha256(committed.decision_id)).toBe(result.prompt_sha256);
  });

  it('rejects a valid hash from another prompt before creating any durable effect', async () => {
    const seeded = await seedConversationForAgentTurn();
    const result = await runAgentTurnWithIntegrityV3({
      model: { generate: vi.fn(async () => ({ decision: decision(seeded.state_version) })) },
      tools: { execute: vi.fn() },
      now: () => 0,
      check: vi.fn(() => ({ ok: true as const })),
    }, { instructions: 'authoritative prompt', conversation: [], toolDefinitions: [] });
    if (result.outcome !== 'decided') throw new Error('expected decision');
    const alienSha256 = result.prompt_sha256 === 'f'.repeat(64)
      ? 'e'.repeat(64)
      : 'f'.repeat(64);

    await expect(commitAgentTurnV3(sql, {
      turn_id: seeded.turn_id,
      trace_id: seeded.trace_id,
      decision: result.decision,
      effective_prompt_sha256: result.prompt_sha256,
      release_manifest: { ...seeded.release_manifest, prompt_sha256: alienSha256 },
    })).rejects.toThrow('AGENT_TURN_V3_PROMPT_SHA_MISMATCH');

    await expect(durableProof(seeded)).resolves.toEqual({
      decisions: 0, outbounds: 0, version: seeded.state_version,
    });
  });

  it('rejects null prompt evidence when its budget trace contains a model request', async () => {
    const seeded = await seedConversationForAgentTurn();
    const invalid = {
      turn_id: seeded.turn_id,
      trace_id: seeded.trace_id,
      effective_prompt_sha256: null,
      release_manifest: { ...seeded.release_manifest, prompt_sha256: null },
      fallback: {
        reason: 'AGENT_LOOP_BUDGET_EXHAUSTED',
        rejection: null,
        prompt_sha256: null,
        trace: {
          model_request_prompt_sha256s: ['a'.repeat(64)],
          attempt_hashes: { first: 'b'.repeat(64), second: null },
          rejections: [],
          tools_requested: [],
          tools_executed: [],
        },
      },
    } as unknown as Parameters<typeof commitAgentTurnV3>[1];

    await expect(commitAgentTurnV3(sql, invalid))
      .rejects.toThrow('AGENT_TURN_V3_INVALID_FALLBACK_TRACE');
    await expect(durableProof(seeded)).resolves.toEqual({
      decisions: 0, outbounds: 0, version: seeded.state_version,
    });
  });

  it('rejects null prompt evidence for an integrity fallback before durable effects', async () => {
    const seeded = await seedConversationForAgentTurn();
    const generated = await runAgentTurnWithIntegrityV3({
      model: { generate: vi.fn(async () => ({
        decision: decision(seeded.state_version, 'Sale USD 47.'),
      })) },
      tools: { execute: vi.fn() },
      now: () => 0,
      check: vi.fn(() => ({ ok: false as const, rejection })),
    }, { instructions: 'invalid integrity evidence', conversation: [], toolDefinitions: [] });
    if (generated.outcome !== 'fallback' || generated.reason !== 'AGENT_LOOP_INTEGRITY_FAILED') {
      throw new Error('expected integrity fallback');
    }
    const invalid = {
      turn_id: seeded.turn_id,
      trace_id: seeded.trace_id,
      effective_prompt_sha256: null,
      release_manifest: { ...seeded.release_manifest, prompt_sha256: null },
      fallback: { ...generated, prompt_sha256: null },
    } as unknown as Parameters<typeof commitAgentTurnV3>[1];

    await expect(commitAgentTurnV3(sql, invalid))
      .rejects.toThrow('AGENT_TURN_V3_INVALID_FALLBACK_TRACE');
    await expect(durableProof(seeded)).resolves.toEqual({
      decisions: 0, outbounds: 0, version: seeded.state_version,
    });
  });

  it('rejects null prompt evidence for an accepted decision before durable effects', async () => {
    const seeded = await seedConversationForAgentTurn();
    const invalid = {
      turn_id: seeded.turn_id,
      trace_id: seeded.trace_id,
      effective_prompt_sha256: null,
      release_manifest: { ...seeded.release_manifest, prompt_sha256: null },
      decision: decision(seeded.state_version),
    } as unknown as Parameters<typeof commitAgentTurnV3>[1];

    await expect(commitAgentTurnV3(sql, invalid))
      .rejects.toThrow('AGENT_TURN_V3_PROMPT_SHA_REQUIRED');
    await expect(durableProof(seeded)).resolves.toEqual({
      decisions: 0, outbounds: 0, version: seeded.state_version,
    });
  });
});
