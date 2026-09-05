import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { prepareMemoryToolV1 } from '@/features/conversation/application/agent-tools-prepare';
import {
  AgentTurnV3RejectedError,
  commitAgentTurnV3,
} from '@/features/conversation/application/commit-agent-turn-v3';
import {
  projectAgentAMemories,
  reclaimStrandedMemorySupersessions,
} from '@/features/memory/application/project-agent-a-memories';
import { PostgresMemoryStore } from '@/features/orchestration/adapters/postgres-memory-store';
import { jsonbParam } from '@/lib/db/json';
import { sql } from '@/lib/db/orchestrator';
import { auditLog } from '@/lib/audit/logger';
import { processInboundMessage } from '@/lib/services/ingestion.service';
import { seedConversationForAgentTurn, type SeededAgentTurn } from '../helpers/agent-turn-fixtures';

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

afterAll(async () => sql.end());

async function projectMemoryJob(decisionId: string): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await sql.begin(async (transaction) => {
      await transaction`SET LOCAL ROLE orchestrator_role`;
      await projectAgentAMemories({ limit: 100 }, { db: transaction });
    });
    const [job] = await sql<Array<{ status: string }>>`
      SELECT status FROM agent_a_memory_projection_jobs WHERE decision_id = ${decisionId}::uuid
    `;
    if (job?.status === 'completed') return;
  }
  throw new Error('MEMORY_JOB_DID_NOT_COMPLETE');
}

/**
 * Contacts are global; workspace membership is a join
 * (`workspace_contacts`). This seeds a SECOND workspace and gives the SAME
 * global contact from `seeded` an open conversation and turn inside it — the
 * exact shape the re-review report reproduces: "the same global contact
 * belongs to both [workspaces]".
 *
 * `processInboundMessage` resolves the contact purely by phone (E.164), and
 * when it sees the existing OPEN conversation is bound to a DIFFERENT
 * `channel_thread_id` than the one this call creates, it closes that old
 * conversation and opens a brand new one — see
 * `src/lib/services/ingestion.service.ts:433-458`. No manual conversation
 * plumbing is needed.
 */
async function seedSecondWorkspaceConversation(seeded: SeededAgentTurn): Promise<{
  readonly workspace_id: string;
  readonly conversation_id: string;
  readonly turn_id: string;
  readonly state_version: number;
}> {
  const [contactRow] = await sql<Array<{ phone: string }>>`
    SELECT phone FROM contacts WHERE id = ${seeded.contact_id}::uuid
  `;
  if (!contactRow) throw new Error('WORKSPACE_B_FIXTURE_CONTACT_MISSING');
  const suffix = randomUUID();

  const [workspaceB] = await sql<Array<{ id: string }>>`
    INSERT INTO workspaces (slug, display_name, status, environment)
    VALUES (${`workspace-b-${suffix}`}, ${`Workspace B ${suffix}`}, 'active', 'sandbox')
    RETURNING id
  `;
  if (!workspaceB) throw new Error('WORKSPACE_B_FIXTURE_INSERT_FAILED');

  await sql`
    INSERT INTO workspace_contacts (workspace_id, contact_id, lifecycle_status)
    VALUES (${workspaceB.id}::uuid, ${seeded.contact_id}::uuid, 'active')
    ON CONFLICT DO NOTHING
  `;

  const inbound = await processInboundMessage({
    schema_version: 1 as const,
    source: 'botpress' as const,
    channel: 'emulator' as const,
    integration_id: 'vitest-agent-loop-workspace-b-fixture',
    external_message_id: `agent-loop-workspace-b-${suffix}-1`,
    external_conversation_id: `agent-loop-workspace-b-${suffix}`,
    external_user_id: `agent-loop-workspace-b-user-${suffix}`,
    phone_e164: contactRow.phone,
    trace_id: randomUUID(),
    message: {
      type: 'text' as const,
      text: 'Hola, te escribo desde otra sede',
      occurred_at: new Date().toISOString(),
      reply_to_external_message_id: null,
    },
  });

  await sql`
    INSERT INTO conversation_sales_context_states_v1 (
      workspace_id, conversation_id, contact_id, selected_offering_code,
      selected_payment_plan, stage, call_preference, call_offer_status,
      call_offer_count, awaiting_reply
    ) VALUES (
      ${workspaceB.id}::uuid, ${inbound.conversation_id}::uuid, ${seeded.contact_id}::uuid,
      NULL, NULL, 'exploring', 'unknown', 'not_offered', 0, 'none'
    )
    ON CONFLICT (workspace_id, conversation_id) DO NOTHING
  `;
  const [state] = await sql<Array<{ version: number }>>`
    SELECT version FROM conversation_sales_context_states_v1
    WHERE workspace_id = ${workspaceB.id}::uuid AND conversation_id = ${inbound.conversation_id}::uuid
  `;
  if (!state) throw new Error('WORKSPACE_B_FIXTURE_STATE_MISSING');

  return {
    workspace_id: workspaceB.id,
    conversation_id: inbound.conversation_id,
    turn_id: inbound.turn_id,
    state_version: Number(state.version),
  };
}

run('Agent Loop memory workspace isolation', () => {
  it('fails closed when a workspace-B conversation tries to supersede a workspace-A memory of the same global contact', async () => {
    const seeded = await seedConversationForAgentTurn();
    await sql`
      UPDATE messages SET content = 'Quiero estudiar marketing'
      WHERE id = ${seeded.turn_id}::uuid
    `;
    const original = await prepareMemoryToolV1({
      db: sql,
      turn_id: seeded.turn_id,
      conversation_id: seeded.conversation_id,
    }, {
      candidates: [{ text: 'Quiero estudiar marketing', type: 'study_goal', supersedes: [] }],
    });
    expect(original.success).toBe(true);
    const originalId = original.canonical_data!.accepted[0]!.id;
    const firstCommit = await commitAgentTurnV3(sql, {
      turn_id: seeded.turn_id,
      trace_id: randomUUID(),
      effective_prompt_sha256: seeded.release_manifest.prompt_sha256,
      release_manifest: seeded.release_manifest,
      decision: {
        schema_version: 3,
        blocks: [{ type: 'narrative', text: 'Perfecto, ya quedó registrado.' }],
        commit_preparations: [original.preparation_id!],
        used_memory_ids: [],
        state_patch: { expected_state_version: seeded.state_version, set: {} },
        response_type: 'commercial_reply',
      },
    });
    await projectMemoryJob(firstCommit.decision_id);
    await expect(sql<Array<{ status: string }>>`
      SELECT status FROM selected_memories WHERE id = ${originalId}::uuid
    `).resolves.toEqual([{ status: 'active' }]);

    // Same GLOBAL contact, now also a member of a totally different
    // workspace, engaging through its OWN conversation/turn.
    const workspaceB = await seedSecondWorkspaceConversation(seeded);
    await sql`
      UPDATE messages SET content = 'En realidad quiero estudiar finanzas'
      WHERE id = ${workspaceB.turn_id}::uuid
    `;
    const crossWorkspaceSuccessor = await prepareMemoryToolV1({
      db: sql,
      turn_id: workspaceB.turn_id,
      conversation_id: workspaceB.conversation_id,
    }, {
      candidates: [{
        text: 'En realidad quiero estudiar finanzas',
        type: 'study_goal',
        supersedes: [originalId],
      }],
    });
    // The prepare-time check now also validates origin workspace (not just
    // `workspace_contacts` membership, which the contact genuinely has for
    // workspace B too) and rejects fail-fast.
    expect(crossWorkspaceSuccessor.success).toBe(false);
    expect(crossWorkspaceSuccessor.error_code).toBe('MEMORY_SUPERSEDES_NOT_AUTHORIZED');

    // Defense in depth: even if some other path produced a preparation the
    // prepare-time gate never saw, `commitAgentTurnV3` must independently
    // reject it — it must never trust that `commit_preparations` was already
    // authorized upstream.
    const [bypassPreparation] = await sql<Array<{ id: string }>>`
      INSERT INTO agent_turn_preparations (turn_id, conversation_id, tool, canonical_key, canonical_data)
      VALUES (
        ${workspaceB.turn_id}::uuid,
        ${workspaceB.conversation_id}::uuid,
        'prepare_memory',
        'memory:bypass-cross-workspace',
        ${jsonbParam(sql, {
          accepted: [{
            id: randomUUID(),
            text: 'En realidad quiero estudiar finanzas',
            type: 'study_goal',
            supersedes: [originalId],
          }],
          rejected: [],
          supersedes: [originalId],
        })}
      )
      RETURNING id
    `;
    if (!bypassPreparation) throw new Error('BYPASS_PREPARATION_INSERT_FAILED');

    let commitError: unknown;
    try {
      await commitAgentTurnV3(sql, {
        turn_id: workspaceB.turn_id,
        trace_id: randomUUID(),
        effective_prompt_sha256: seeded.release_manifest.prompt_sha256,
        release_manifest: seeded.release_manifest,
        decision: {
          schema_version: 3,
          blocks: [{ type: 'narrative', text: 'Listo, anotado.' }],
          commit_preparations: [bypassPreparation.id],
          used_memory_ids: [],
          state_patch: { expected_state_version: workspaceB.state_version, set: {} },
          response_type: 'commercial_reply',
        },
      });
    } catch (error) {
      commitError = error;
    }
    expect(commitError).toBeInstanceOf(AgentTurnV3RejectedError);
    expect((commitError as AgentTurnV3RejectedError).rejection.violations).toEqual([
      expect.objectContaining({ code: 'MEMORY_SUPERSEDES_NOT_COMMITTABLE' }),
    ]);

    // Workspace A's memory must never have moved, and no job for the
    // cross-workspace attempt should exist to race the worker later.
    await expect(sql<Array<{ status: string; superseded_by_memory_id: string | null }>>`
      SELECT status, superseded_by_memory_id FROM selected_memories WHERE id = ${originalId}::uuid
    `).resolves.toEqual([{ status: 'active', superseded_by_memory_id: null }]);
    await expect(sql<Array<{ decision_id: string }>>`
      SELECT decision_id FROM agent_a_memory_projection_jobs
      WHERE turn_id = ${workspaceB.turn_id}::uuid
    `).resolves.toHaveLength(0);
  });

  it('never reclaims a workspace-A predecessor from a terminal workspace-B job for the same contact', async () => {
    const seeded = await seedConversationForAgentTurn();
    await sql`
      UPDATE messages SET content = 'Quiero estudiar marketing'
      WHERE id = ${seeded.turn_id}::uuid
    `;
    const original = await prepareMemoryToolV1({
      db: sql,
      turn_id: seeded.turn_id,
      conversation_id: seeded.conversation_id,
    }, {
      candidates: [{ text: 'Quiero estudiar marketing', type: 'study_goal', supersedes: [] }],
    });
    expect(original.success).toBe(true);
    const originalId = original.canonical_data!.accepted[0]!.id;
    const firstCommit = await commitAgentTurnV3(sql, {
      turn_id: seeded.turn_id,
      trace_id: randomUUID(),
      effective_prompt_sha256: seeded.release_manifest.prompt_sha256,
      release_manifest: seeded.release_manifest,
      decision: {
        schema_version: 3,
        blocks: [{ type: 'narrative', text: 'Perfecto, ya quedó registrado.' }],
        commit_preparations: [original.preparation_id!],
        used_memory_ids: [],
        state_patch: { expected_state_version: seeded.state_version, set: {} },
        response_type: 'commercial_reply',
      },
    });
    await projectMemoryJob(firstCommit.decision_id);

    // Reproduce the predecessor's limbo state without manufacturing a false
    // cross-workspace successor through the guarded commit path. The hostile
    // terminal job below is durable evidence from workspace B and merely
    // names this workspace-A UUID in candidate JSON.
    await sql`
      UPDATE selected_memories
      SET status = 'pending_supersession', embedding = NULL,
          embedding_state = 'skip', embedding_updated_at = now()
      WHERE id = ${originalId}::uuid
    `;

    const workspaceB = await seedSecondWorkspaceConversation(seeded);
    await sql`
      UPDATE messages SET content = 'Prefiero estudiar por la noche'
      WHERE id = ${workspaceB.turn_id}::uuid
    `;
    const workspaceBMemory = await prepareMemoryToolV1({
      db: sql,
      turn_id: workspaceB.turn_id,
      conversation_id: workspaceB.conversation_id,
    }, {
      candidates: [{ text: 'Prefiero estudiar por la noche', type: 'preference', supersedes: [] }],
    });
    expect(workspaceBMemory.success).toBe(true);
    const workspaceBCommit = await commitAgentTurnV3(sql, {
      turn_id: workspaceB.turn_id,
      trace_id: randomUUID(),
      effective_prompt_sha256: seeded.release_manifest.prompt_sha256,
      release_manifest: seeded.release_manifest,
      decision: {
        schema_version: 3,
        blocks: [{ type: 'narrative', text: 'Anotado.' }],
        commit_preparations: [workspaceBMemory.preparation_id!],
        used_memory_ids: [],
        state_patch: { expected_state_version: workspaceB.state_version, set: {} },
        response_type: 'commercial_reply',
      },
    });
    await sql`
      UPDATE agent_a_memory_projection_jobs
      SET candidate = jsonb_set(
            candidate,
            '{supersedes}',
            to_jsonb(ARRAY[${originalId}::text])
          ),
          status = 'failed', attempt_count = 3, available_at = now(),
          lease_until = NULL, last_error_code = 'MEMORY_CANDIDATE_INVALID'
      WHERE decision_id = ${workspaceBCommit.decision_id}::uuid
    `;

    await reclaimStrandedMemorySupersessions({}, { db: sql, audit: auditLog });

    await expect(sql<Array<{ status: string }>>`
      SELECT status FROM selected_memories WHERE id = ${originalId}::uuid
    `).resolves.toEqual([{ status: 'pending_supersession' }]);
    await expect(sql<Array<{ count: string }>>`
      SELECT count(*)::text AS count
      FROM audit_log
      WHERE event_key = ${`memory:${originalId}:supersession_reclaimed`}
    `).resolves.toEqual([{ count: '0' }]);
  });

  it('rejects a cross-workspace supersede at the SQL function itself, independent of the app-layer gate', async () => {
    // Defense in depth for the exact contract gap the report names:
    // `record_prepared_agent_memory_v1` used to receive and validate only
    // `contact_id`. This exercises the store adapter (and therefore the SQL
    // function) directly with real, durable FKs from a genuine workspace-B
    // decision, bypassing `commitAgentTurnV3`'s own gate entirely.
    const seeded = await seedConversationForAgentTurn();
    await sql`
      UPDATE messages SET content = 'Quiero estudiar programación'
      WHERE id = ${seeded.turn_id}::uuid
    `;
    const original = await prepareMemoryToolV1({
      db: sql,
      turn_id: seeded.turn_id,
      conversation_id: seeded.conversation_id,
    }, {
      candidates: [{ text: 'Quiero estudiar programación', type: 'study_goal', supersedes: [] }],
    });
    expect(original.success).toBe(true);
    const originalId = original.canonical_data!.accepted[0]!.id;
    const firstCommit = await commitAgentTurnV3(sql, {
      turn_id: seeded.turn_id,
      trace_id: randomUUID(),
      effective_prompt_sha256: seeded.release_manifest.prompt_sha256,
      release_manifest: seeded.release_manifest,
      decision: {
        schema_version: 3,
        blocks: [{ type: 'narrative', text: 'Perfecto, ya quedó registrado.' }],
        commit_preparations: [original.preparation_id!],
        used_memory_ids: [],
        state_patch: { expected_state_version: seeded.state_version, set: {} },
        response_type: 'commercial_reply',
      },
    });
    await projectMemoryJob(firstCommit.decision_id);

    const workspaceB = await seedSecondWorkspaceConversation(seeded);
    // A legitimate, unrelated memory in workspace B, committed and
    // materialized normally, so we have real FKs (decision_id,
    // conversation_id, source_message_id) that genuinely belong to workspace
    // B to attack the SQL function with.
    await sql`
      UPDATE messages SET content = 'Prefiere horarios nocturnos'
      WHERE id = ${workspaceB.turn_id}::uuid
    `;
    const workspaceBOwn = await prepareMemoryToolV1({
      db: sql,
      turn_id: workspaceB.turn_id,
      conversation_id: workspaceB.conversation_id,
    }, {
      candidates: [{ text: 'Prefiere horarios nocturnos', type: 'preference', supersedes: [] }],
    });
    expect(workspaceBOwn.success).toBe(true);
    const workspaceBCommit = await commitAgentTurnV3(sql, {
      turn_id: workspaceB.turn_id,
      trace_id: randomUUID(),
      effective_prompt_sha256: seeded.release_manifest.prompt_sha256,
      release_manifest: seeded.release_manifest,
      decision: {
        schema_version: 3,
        blocks: [{ type: 'narrative', text: 'Anotado.' }],
        commit_preparations: [workspaceBOwn.preparation_id!],
        used_memory_ids: [],
        state_patch: { expected_state_version: workspaceB.state_version, set: {} },
        response_type: 'commercial_reply',
      },
    });
    await projectMemoryJob(workspaceBCommit.decision_id);

    const [job] = await sql<Array<{
      turn_id: string;
      candidate: { source_message_id?: string };
    }>>`
      SELECT turn_id, candidate FROM agent_a_memory_projection_jobs
      WHERE decision_id = ${workspaceBCommit.decision_id}::uuid
    `;
    if (!job) throw new Error('WORKSPACE_B_OWN_JOB_MISSING');

    const store = new PostgresMemoryStore(sql);
    await expect(store.recordPreparedAccepted({
      memory_id: randomUUID(),
      supersedes_memory_ids: [originalId],
      workspace_id: workspaceB.workspace_id,
      contact_id: seeded.contact_id,
      conversation_id: workspaceB.conversation_id,
      source_message_id: workspaceB.turn_id,
      source_batch_id: null,
      decision_id: workspaceBCommit.decision_id,
      memory_type: 'study_goal',
      memory_key: 'agent_loop_study_goal_attack',
      value_normalized: 'ataque cross-workspace',
      source_quote: 'Prefiere horarios nocturnos',
      confidence: 1,
      dedupe_hash: 'a'.repeat(64),
      ttl_days: null,
      trace_id: randomUUID(),
    // Pinned to the exact SQLSTATE `record_prepared_agent_memory_v1` raises
    // for an unauthorized `supersedes` target (20260905000008) — a bare
    // `.rejects.toThrow()` would also pass if an unrelated regression made
    // the function fail for the wrong reason (e.g. a bad FK or a NOT NULL
    // violation), silently losing this test's coverage of the cross-workspace
    // guard itself.
    })).rejects.toMatchObject({ code: '42501' });

    await expect(sql<Array<{ status: string }>>`
      SELECT status FROM selected_memories WHERE id = ${originalId}::uuid
    `).resolves.toEqual([{ status: 'active' }]);
  });
});
