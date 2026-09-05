import { afterEach, describe, expect, it } from 'vitest';
import {
  claimBatch,
  DEFAULT_CONTEXT_LIMITS,
} from '@/features/orchestration/application/claim-batch';
import { PostgresAgentLoopRolloutReaderV3 } from '@/features/orchestration/adapters/postgres-agent-loop-rollout';
import { PostgresOrchestrationStore } from '@/features/orchestration/adapters/postgres-orchestration-store';
import { sql } from '@/lib/db/orchestrator';
import { seedConversationForAgentTurn } from '../helpers/agent-turn-fixtures';

const touchedContacts: string[] = [];

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
  for (const contactId of touchedContacts.splice(0)) {
    await sql`DELETE FROM agent_loop_rollout_v3 WHERE contact_id = ${contactId}::uuid`;
  }
});

describe('agent loop runtime mode in a real claimed batch', () => {
  it('defaults to off and projects one contact override as authoritative', async () => {
    const offSeed = await seedConversationForAgentTurn();
    touchedContacts.push(offSeed.contact_id);
    await sql`DELETE FROM agent_loop_rollout_v3 WHERE contact_id = ${offSeed.contact_id}::uuid`;

    const before = await claimSeededBatch(offSeed);
    expect(before.outcome).toBe('claimed');
    if (before.outcome !== 'claimed') return;
    expect(before.features.agent_loop_v3_mode).toBe('off');

    const authoritativeSeed = await seedConversationForAgentTurn();
    touchedContacts.push(authoritativeSeed.contact_id);
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
});
