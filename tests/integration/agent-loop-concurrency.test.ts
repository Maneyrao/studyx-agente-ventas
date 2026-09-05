import { describe, expect, it } from 'vitest';
import { commitAgentTurnV3 } from '@/features/conversation/application/commit-agent-turn-v3';
import { sql } from '@/lib/db/orchestrator';
import { seedConversationForAgentTurn } from '../helpers/agent-turn-fixtures';
import { openIndependentLocalTestDatabases } from '../helpers/db';

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

run('Agent Loop optimistic concurrency', () => {
  it('lets one concurrent turn commit, rejects the stale peer, and accepts its retry on the new version', async () => {
    const seeded = await seedConversationForAgentTurn();
    const decision = (
      turnId: string,
      expectedVersion: number,
      stage: 'qualified' | 'course_selected',
    ) => ({
      turn_id: turnId,
      trace_id: seeded.trace_id,
      effective_prompt_sha256: seeded.release_manifest.prompt_sha256,
      release_manifest: seeded.release_manifest,
      decision: {
        schema_version: 3 as const,
        blocks: [{ type: 'narrative' as const, text: 'Dale, seguimos.' }],
        commit_preparations: [],
        used_memory_ids: [],
        state_patch: {
          expected_state_version: expectedVersion,
          set: { stage },
        },
        response_type: 'commercial_reply' as const,
      },
    });
    const connections = openIndependentLocalTestDatabases(2);
    let results: PromiseSettledResult<Awaited<ReturnType<typeof commitAgentTurnV3>>>[] = [];
    try {
      results = await Promise.allSettled([
        commitAgentTurnV3(
          connections[0],
          decision(seeded.turn_id, seeded.state_version, 'qualified'),
        ),
        commitAgentTurnV3(
          connections[1],
          decision(seeded.second_turn_id, seeded.state_version, 'course_selected'),
        ),
      ]);
    } finally {
      await Promise.all(connections.map((connection) => connection.end()));
    }

    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(fulfilled[0]).toMatchObject({ value: { outbound_id: expect.any(String) } });
    expect(rejected[0]).toMatchObject({ reason: {
      code: 'AGENT_TURN_V3_REJECTED',
      rejection: {
        violations: [{ code: 'STATE_VERSION_CONFLICT' }],
      },
    } });

    const winnerTurn = results[0]?.status === 'fulfilled'
      ? seeded.turn_id
      : seeded.second_turn_id;
    const loserTurn = winnerTurn === seeded.turn_id
      ? seeded.second_turn_id
      : seeded.turn_id;
    const [afterConflict] = await sql<Array<{ version: number }>>`
      SELECT version FROM conversation_sales_context_states_v1
      WHERE workspace_id = ${seeded.workspace_id}::uuid
        AND conversation_id = ${seeded.conversation_id}::uuid
    `;
    expect(afterConflict?.version).toBe(seeded.state_version + 1);

    const retry = await commitAgentTurnV3(
      sql,
      decision(loserTurn, afterConflict!.version, 'course_selected'),
    );
    expect(retry.outbound_id).toBeTruthy();

    const [proof] = await sql<Array<{
      version: number;
      stage: string;
      decisions: number;
      outbounds: number;
    }>>`
      SELECT
        state.version,
        state.stage,
        (SELECT count(*)::int FROM agent_decisions AS decision
          WHERE decision.turn_id IN (
            ${seeded.turn_id}::uuid,
            ${seeded.second_turn_id}::uuid
          )) AS decisions,
        (SELECT count(*)::int FROM messages AS outbound
          WHERE outbound.in_reply_to IN (
            ${seeded.turn_id}::uuid,
            ${seeded.second_turn_id}::uuid
          ) AND outbound.direction = 'outbound') AS outbounds
      FROM conversation_sales_context_states_v1 AS state
      WHERE state.workspace_id = ${seeded.workspace_id}::uuid
        AND state.conversation_id = ${seeded.conversation_id}::uuid
    `;
    expect(proof).toEqual({
      version: seeded.state_version + 2,
      stage: 'course_selected',
      decisions: 2,
      outbounds: 2,
    });
  });
});
