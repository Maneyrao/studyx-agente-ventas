import { describe, expect, it } from 'vitest';
import { sql } from '@/lib/db/orchestrator';

async function columnExists(table: string, column: string): Promise<boolean> {
  const rows = await sql<Array<{ n: number }>>`
    SELECT count(*)::int AS n FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${table} AND column_name = ${column}
  `;
  return rows[0]!.n === 1;
}

describe('agent loop migrations', () => {
  it('adds the release manifest to decisions', async () => {
    expect(await columnExists('agent_decisions', 'release_manifest')).toBe(true);
  });

  it('adds the deferred patch and its proof level to deliveries', async () => {
    expect(await columnExists('outbound_deliveries', 'deferred_state_patch')).toBe(true);
    expect(await columnExists('outbound_deliveries', 'deferred_patch_applied_on')).toBe(true);
  });

  it('creates the rollout table with a workspace default row shape', async () => {
    const rows = await sql<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'agent_loop_rollout_v3'
    `;
    expect(rows[0]!.n).toBe(1);
  });

  it('refuses an invalid rollout mode', async () => {
    await expect(sql`
      INSERT INTO agent_loop_rollout_v3 (workspace_id, contact_id, mode)
      SELECT id, NULL, 'bananas' FROM workspaces WHERE slug = 'studyx'
    `).rejects.toMatchObject({ code: '23514' });
  });
});
