import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import {
  claimBatch,
  DEFAULT_CONTEXT_LIMITS,
} from '@/features/orchestration/application/claim-batch';
import { PostgresAgentLoopRolloutReaderV3 } from '@/features/orchestration/adapters/postgres-agent-loop-rollout';
import { PostgresOrchestrationStore } from '@/features/orchestration/adapters/postgres-orchestration-store';
import { resolveAgentLoopModeV3 } from '@/features/orchestration/domain/agent-loop-rollout';
import { sql } from '@/lib/db/orchestrator';
import type { DbClient } from '@/lib/db/types';
import {
  seedConversationForAgentTurn,
  type SeededAgentTurn,
} from '../helpers/agent-turn-fixtures';

const touchedSeeds: SeededAgentTurn[] = [];

async function cleanSeed(seed: SeededAgentTurn): Promise<void> {
  await sql`DELETE FROM agent_loop_rollout_v3 WHERE contact_id = ${seed.contact_id}::uuid`;
  await sql`DELETE FROM agent_a_memory_projection_jobs WHERE turn_id IN (
    SELECT id FROM messages WHERE contact_id = ${seed.contact_id}::uuid
  )`;
  await sql`DELETE FROM agent_turn_preparations WHERE conversation_id = ${seed.conversation_id}::uuid`;
  await sql`DELETE FROM selected_memories WHERE contact_id = ${seed.contact_id}::uuid`;
  await sql`DELETE FROM embedding_jobs WHERE contact_id = ${seed.contact_id}::uuid`;
  await sql`DELETE FROM message_embeddings WHERE contact_id = ${seed.contact_id}::uuid`;
  await sql`DELETE FROM conversation_sales_context_state_events_v1
    WHERE conversation_id = ${seed.conversation_id}::uuid`;
  await sql`DELETE FROM conversation_sales_context_states_v1
    WHERE conversation_id = ${seed.conversation_id}::uuid`;
  await sql`DELETE FROM sales_context_state_events WHERE contact_id = ${seed.contact_id}::uuid`;
  await sql`DELETE FROM sales_context_states WHERE contact_id = ${seed.contact_id}::uuid`;
  await sql`UPDATE messages SET batch_id = NULL WHERE contact_id = ${seed.contact_id}::uuid`;
  await sql`DELETE FROM inbound_batches WHERE contact_id = ${seed.contact_id}::uuid`;
  await sql`DELETE FROM messages WHERE contact_id = ${seed.contact_id}::uuid`;
  await sql`DELETE FROM conversations WHERE contact_id = ${seed.contact_id}::uuid`;
  await sql`DELETE FROM consent_events WHERE contact_id = ${seed.contact_id}::uuid`;
  await sql`DELETE FROM audit_log WHERE source_event_id IN (
    SELECT id FROM channel_events WHERE contact_id = ${seed.contact_id}::uuid
  )`;
  await sql`DELETE FROM channel_events WHERE contact_id = ${seed.contact_id}::uuid`;
  await sql`DELETE FROM channel_threads WHERE contact_id = ${seed.contact_id}::uuid`;
  await sql`DELETE FROM contact_channel_permissions WHERE contact_id = ${seed.contact_id}::uuid`;
  await sql`DELETE FROM workspace_contacts WHERE contact_id = ${seed.contact_id}::uuid`;
  await sql`DELETE FROM contacts WHERE id = ${seed.contact_id}::uuid`;
}

async function claimSeededBatch(seeded: Awaited<ReturnType<typeof seedConversationForAgentTurn>>) {
  await sql`
    UPDATE inbound_batches
    SET due_at = now() - interval '1 second',
        hard_deadline_at = now() + interval '30 seconds'
    WHERE id = ${seeded.second_batch_id}::uuid
  `;

  return claimBatch(
    {
      batch_id: seeded.second_batch_id,
      trace_id: seeded.trace_id,
      claimed_by: `rollout-test:${seeded.trace_id}`,
    },
    {
      store: new PostgresOrchestrationStore(sql),
      embedding: { embed: async () => [0.1] },
      memory: { search: async () => [] },
      knowledge: { search: async () => [] },
      limits: DEFAULT_CONTEXT_LIMITS,
      agentLoopRollout: new PostgresAgentLoopRolloutReaderV3('studyx', sql),
      contactIntake: async () => ({
        nombre: null,
        apellido: null,
        correo: null,
        telefono: null,
      }),
    },
  );
}

afterEach(async () => {
  for (const seed of touchedSeeds.splice(0)) {
    await cleanSeed(seed);
  }
});

describe('agent loop runtime mode in a real claimed batch', () => {
  it('projects explicit per-contact off and authoritative modes independently of the workspace default', async () => {
    const offSeed = await seedConversationForAgentTurn();
    touchedSeeds.push(offSeed);
    await sql`
      INSERT INTO agent_loop_rollout_v3 (workspace_id, contact_id, mode)
      VALUES (${offSeed.workspace_id}::uuid, ${offSeed.contact_id}::uuid, 'off')
    `;

    const before = await claimSeededBatch(offSeed);
    expect(before.outcome).toBe('claimed');
    if (before.outcome !== 'claimed') return;
    expect(before.features.agent_loop_v3_mode).toBe('off');

    const authoritativeSeed = await seedConversationForAgentTurn();
    touchedSeeds.push(authoritativeSeed);
    await sql`
      INSERT INTO agent_loop_rollout_v3 (workspace_id, contact_id, mode)
      VALUES (
        ${authoritativeSeed.workspace_id}::uuid,
        ${authoritativeSeed.contact_id}::uuid,
        'authoritative'
      )
    `;

    const after = await claimSeededBatch(authoritativeSeed);
    expect(after.outcome).toBe('claimed');
    if (after.outcome !== 'claimed') return;
    expect(after.features.agent_loop_v3_mode).toBe('authoritative');
  });

  it('isolates workspace, contact and membership in the real SQL reader', async () => {
    const rollback = new Error('ROLLBACK_AGENT_LOOP_READER_PROBE');

    try {
      await sql.begin(async (tx) => {
        const suffix = randomUUID();
        const phoneBase = BigInt(`0x${suffix.replaceAll('-', '').slice(0, 12)}`)
          .toString()
          .padStart(10, '0')
          .slice(-10, -1);
        const [workspaceA, workspaceB] = await tx<Array<{ id: string }>>`
          INSERT INTO workspaces (slug, display_name)
          VALUES
            (${`rollout-reader-${suffix}-a`}, 'Rollout Reader A'),
            (${`rollout-reader-${suffix}-b`}, 'Rollout Reader B')
          RETURNING id
        `;
        const [contactA, contactB, nonMember] = await tx<Array<{ id: string }>>`
          INSERT INTO contacts (phone, channel_origin)
          VALUES
            (${`+1${phoneBase}1`}, 'whatsapp'),
            (${`+1${phoneBase}2`}, 'whatsapp'),
            (${`+1${phoneBase}3`}, 'whatsapp')
          RETURNING id
        `;
        await tx`
          INSERT INTO workspace_contacts (workspace_id, contact_id)
          VALUES
            (${workspaceA!.id}::uuid, ${contactA!.id}::uuid),
            (${workspaceA!.id}::uuid, ${contactB!.id}::uuid),
            (${workspaceB!.id}::uuid, ${contactA!.id}::uuid)
        `;

        const reader = new PostgresAgentLoopRolloutReaderV3(
          `rollout-reader-${suffix}-a`,
          tx as DbClient,
        );
        const emptyRows = await reader.load(contactA!.id);
        expect(emptyRows).toEqual([]);
        expect(resolveAgentLoopModeV3(emptyRows, contactA!.id)).toBe('off');

        await tx`
          INSERT INTO agent_loop_rollout_v3 (workspace_id, contact_id, mode)
          VALUES
            (${workspaceA!.id}::uuid, NULL, 'shadow'),
            (${workspaceA!.id}::uuid, ${contactA!.id}::uuid, 'authoritative'),
            (${workspaceA!.id}::uuid, ${contactB!.id}::uuid, 'off'),
            (${workspaceB!.id}::uuid, NULL, 'authoritative'),
            (${workspaceB!.id}::uuid, ${contactA!.id}::uuid, 'off')
        `;

        const contactARows = await reader.load(contactA!.id);
        const contactBRows = await reader.load(contactB!.id);
        const nonMemberRows = await reader.load(nonMember!.id);

        expect(contactARows).toHaveLength(2);
        expect(resolveAgentLoopModeV3(contactARows, contactA!.id)).toBe('authoritative');
        expect(contactBRows).toHaveLength(2);
        expect(resolveAgentLoopModeV3(contactBRows, contactB!.id)).toBe('off');
        expect(nonMemberRows).toEqual([]);
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    }
  });
});
