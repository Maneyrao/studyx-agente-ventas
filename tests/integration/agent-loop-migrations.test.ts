import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { openLocalTestDatabase } from '../helpers/db';

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const db = process.env.TEST_DATABASE_URL ? openLocalTestDatabase() : null;

const migrationSql = [
  '20260905000001_agent_decisions_release_manifest.sql',
  '20260905000002_outbound_deferred_state_patch.sql',
  '20260905000003_agent_loop_rollout_v3.sql',
].map((name) => readFileSync(resolve(process.cwd(), 'supabase/migrations', name), 'utf8'));

afterAll(async () => db?.end());

interface RolloutFixture {
  readonly workspaceId: string;
  readonly otherWorkspaceId: string;
  readonly contactId: string;
  readonly cleanup: () => Promise<void>;
}

async function rolloutFixture(): Promise<RolloutFixture> {
  const suffix = randomUUID();
  const phoneSuffix = BigInt(`0x${suffix.replaceAll('-', '').slice(0, 12)}`)
    .toString()
    .padStart(10, '0')
    .slice(-10);
  const workspaces = await db!<Array<{ id: string }>>`
    INSERT INTO workspaces (slug, display_name)
    VALUES
      (${`migration-review-${suffix}-a`}, 'Migration Review A'),
      (${`migration-review-${suffix}-b`}, 'Migration Review B')
    RETURNING id
  `;
  const [contact] = await db!<Array<{ id: string }>>`
    INSERT INTO contacts (phone, channel_origin)
    VALUES (${`+1${phoneSuffix}`}, 'whatsapp')
    RETURNING id
  `;
  await db!`
    INSERT INTO workspace_contacts (workspace_id, contact_id)
    VALUES (${workspaces[0]!.id}::uuid, ${contact!.id}::uuid)
  `;

  return {
    workspaceId: workspaces[0]!.id,
    otherWorkspaceId: workspaces[1]!.id,
    contactId: contact!.id,
    cleanup: async () => {
      await db!`DELETE FROM outbound_deliveries WHERE contact_id = ${contact!.id}::uuid`;
      await db!`DELETE FROM messages WHERE contact_id = ${contact!.id}::uuid`;
      await db!`DELETE FROM conversations WHERE contact_id = ${contact!.id}::uuid`;
      await db!`DELETE FROM agent_loop_rollout_v3 WHERE workspace_id IN (${workspaces[0]!.id}::uuid, ${workspaces[1]!.id}::uuid)`;
      await db!`DELETE FROM workspace_contacts WHERE contact_id = ${contact!.id}::uuid`;
      await db!`DELETE FROM contacts WHERE id = ${contact!.id}::uuid`;
      await db!`DELETE FROM workspaces WHERE id IN (${workspaces[0]!.id}::uuid, ${workspaces[1]!.id}::uuid)`;
    },
  };
}

async function expectSqlState(operation: Promise<unknown>, code: string): Promise<void> {
  await expect(operation).rejects.toMatchObject({ code });
}

async function insertDeliveryWithProof(
  fixture: RolloutFixture,
  proof: string,
): Promise<void> {
  const [conversation] = await db!<Array<{ id: string }>>`
    INSERT INTO conversations (contact_id, channel, status)
    VALUES (${fixture.contactId}::uuid, 'whatsapp', 'open')
    RETURNING id
  `;
  const [message] = await db!<Array<{ id: string }>>`
    INSERT INTO messages (conversation_id, contact_id, direction, content)
    VALUES (${conversation!.id}::uuid, ${fixture.contactId}::uuid, 'outbound', 'migration proof')
    RETURNING id
  `;
  await db!`
    INSERT INTO outbound_deliveries (
      message_id, conversation_id, contact_id, provider, integration_id,
      channel, destination, idempotency_key, deferred_patch_applied_on
    ) VALUES (
      ${message!.id}::uuid, ${conversation!.id}::uuid, ${fixture.contactId}::uuid,
      'test', 'migration-test', 'whatsapp', ${`destination-${randomUUID()}`},
      ${`migration-proof-${randomUUID()}`}, ${proof}
    )
  `;
}

run('agent loop migrations', () => {
  it('creates the exact additive column types, nullability and defaults', async () => {
    const rows = await db!<Array<{
      table_name: string;
      column_name: string;
      data_type: string;
      is_nullable: string;
      column_default: string | null;
    }>>`
      SELECT table_name, column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE (table_name = 'agent_decisions' AND column_name = 'release_manifest')
         OR (table_name = 'outbound_deliveries'
             AND column_name IN ('deferred_state_patch', 'deferred_patch_applied_on'))
         OR table_name = 'agent_loop_rollout_v3'
      ORDER BY table_name, ordinal_position
    `;

    expect(rows).toEqual([
      {
        table_name: 'agent_decisions', column_name: 'release_manifest',
        data_type: 'jsonb', is_nullable: 'YES', column_default: null,
      },
      {
        table_name: 'agent_loop_rollout_v3', column_name: 'workspace_id',
        data_type: 'uuid', is_nullable: 'NO', column_default: null,
      },
      {
        table_name: 'agent_loop_rollout_v3', column_name: 'contact_id',
        data_type: 'uuid', is_nullable: 'YES', column_default: null,
      },
      {
        table_name: 'agent_loop_rollout_v3', column_name: 'mode',
        data_type: 'text', is_nullable: 'NO', column_default: null,
      },
      {
        table_name: 'agent_loop_rollout_v3', column_name: 'updated_at',
        data_type: 'timestamp with time zone', is_nullable: 'NO', column_default: 'now()',
      },
      {
        table_name: 'outbound_deliveries', column_name: 'deferred_state_patch',
        data_type: 'jsonb', is_nullable: 'YES', column_default: null,
      },
      {
        table_name: 'outbound_deliveries', column_name: 'deferred_patch_applied_on',
        data_type: 'text', is_nullable: 'YES', column_default: null,
      },
    ]);
  });

  it('enforces the rollout mode and deferred proof-level checks', async () => {
    const fixture = await rolloutFixture();
    try {
      await db!`
        INSERT INTO agent_loop_rollout_v3 (workspace_id, contact_id, mode)
        VALUES (${fixture.workspaceId}::uuid, NULL, 'off')
      `;
      await db!`
        UPDATE agent_loop_rollout_v3 SET mode = 'shadow'
        WHERE workspace_id = ${fixture.workspaceId}::uuid AND contact_id IS NULL
      `;
      await db!`
        UPDATE agent_loop_rollout_v3 SET mode = 'authoritative'
        WHERE workspace_id = ${fixture.workspaceId}::uuid AND contact_id IS NULL
      `;
      await expectSqlState(db!`
        UPDATE agent_loop_rollout_v3 SET mode = 'bananas'
        WHERE workspace_id = ${fixture.workspaceId}::uuid AND contact_id IS NULL
      `, '23514');
      await expectSqlState(insertDeliveryWithProof(fixture, 'queued'), '23514');

      const [proofCheck] = await db!<Array<{ definition: string }>>`
        SELECT pg_get_constraintdef(oid) AS definition
        FROM pg_constraint
        WHERE conrelid = 'outbound_deliveries'::regclass
          AND conname = 'outbound_deliveries_deferred_patch_applied_on_check'
      `;
      expect(proofCheck!.definition).toContain("'accepted'::text");
      expect(proofCheck!.definition).toContain("'delivered'::text");
    } finally {
      await fixture.cleanup();
    }
  });

  it('enforces one workspace default and one row per workspace/contact', async () => {
    const fixture = await rolloutFixture();
    try {
      await db!`
        INSERT INTO agent_loop_rollout_v3 (workspace_id, contact_id, mode)
        VALUES (${fixture.workspaceId}::uuid, NULL, 'off')
      `;
      await expectSqlState(db!`
        INSERT INTO agent_loop_rollout_v3 (workspace_id, contact_id, mode)
        VALUES (${fixture.workspaceId}::uuid, NULL, 'shadow')
      `, '23505');

      await db!`
        INSERT INTO agent_loop_rollout_v3 (workspace_id, contact_id, mode)
        VALUES (${fixture.workspaceId}::uuid, ${fixture.contactId}::uuid, 'shadow')
      `;
      await expectSqlState(db!`
        INSERT INTO agent_loop_rollout_v3 (workspace_id, contact_id, mode)
        VALUES (${fixture.workspaceId}::uuid, ${fixture.contactId}::uuid, 'authoritative')
      `, '23505');
    } finally {
      await fixture.cleanup();
    }
  });

  it('requires a real workspace/contact membership and cascades its removal', async () => {
    const fixture = await rolloutFixture();
    try {
      await expectSqlState(db!`
        INSERT INTO agent_loop_rollout_v3 (workspace_id, contact_id, mode)
        VALUES (${fixture.otherWorkspaceId}::uuid, ${fixture.contactId}::uuid, 'authoritative')
      `, '23503');

      await db!`
        INSERT INTO agent_loop_rollout_v3 (workspace_id, contact_id, mode)
        VALUES (${fixture.workspaceId}::uuid, ${fixture.contactId}::uuid, 'shadow')
      `;
      await db!`
        DELETE FROM workspace_contacts
        WHERE workspace_id = ${fixture.workspaceId}::uuid
          AND contact_id = ${fixture.contactId}::uuid
      `;
      const [afterMembershipDelete] = await db!<Array<{ n: number }>>`
        SELECT count(*)::int AS n FROM agent_loop_rollout_v3
        WHERE workspace_id = ${fixture.workspaceId}::uuid
          AND contact_id = ${fixture.contactId}::uuid
      `;
      expect(afterMembershipDelete!.n).toBe(0);

      await db!`
        INSERT INTO agent_loop_rollout_v3 (workspace_id, contact_id, mode)
        VALUES (${fixture.otherWorkspaceId}::uuid, NULL, 'off')
      `;
      await db!`DELETE FROM workspaces WHERE id = ${fixture.otherWorkspaceId}::uuid`;
      const [afterWorkspaceDelete] = await db!<Array<{ n: number }>>`
        SELECT count(*)::int AS n FROM agent_loop_rollout_v3
        WHERE workspace_id = ${fixture.otherWorkspaceId}::uuid
      `;
      expect(afterWorkspaceDelete!.n).toBe(0);
    } finally {
      await fixture.cleanup();
    }
  });

  it('grants the minimum runtime operations through an RLS policy', async () => {
    const fixture = await rolloutFixture();
    try {
      const [security] = await db!<Array<{
        rls: boolean;
        can_select: boolean;
        can_insert: boolean;
        can_update: boolean;
        can_delete: boolean;
        policy_exists: boolean;
      }>>`
        SELECT
          class.relrowsecurity AS rls,
          has_table_privilege('orchestrator_role', class.oid, 'SELECT') AS can_select,
          has_table_privilege('orchestrator_role', class.oid, 'INSERT') AS can_insert,
          has_table_privilege('orchestrator_role', class.oid, 'UPDATE') AS can_update,
          has_table_privilege('orchestrator_role', class.oid, 'DELETE') AS can_delete,
          EXISTS (
            SELECT 1 FROM pg_policies
            WHERE schemaname = 'public'
              AND tablename = 'agent_loop_rollout_v3'
              AND policyname = 'orchestrator_access'
              AND 'orchestrator_role' = ANY(roles)
          ) AS policy_exists
        FROM pg_class AS class
        WHERE class.oid = 'agent_loop_rollout_v3'::regclass
      `;
      expect(security).toEqual({
        rls: true,
        can_select: true,
        can_insert: true,
        can_update: true,
        can_delete: false,
        policy_exists: true,
      });

      await db!.begin(async (tx) => {
        await tx.unsafe('SET LOCAL ROLE orchestrator_role');
        await tx`
          INSERT INTO agent_loop_rollout_v3 (workspace_id, contact_id, mode)
          VALUES (${fixture.workspaceId}::uuid, NULL, 'off')
        `;
        await tx`
          UPDATE agent_loop_rollout_v3 SET mode = 'shadow'
          WHERE workspace_id = ${fixture.workspaceId}::uuid AND contact_id IS NULL
        `;
        const rows = await tx<Array<{ mode: string }>>`
          SELECT mode FROM agent_loop_rollout_v3
          WHERE workspace_id = ${fixture.workspaceId}::uuid AND contact_id IS NULL
        `;
        expect(rows).toEqual([{ mode: 'shadow' }]);
      });
    } finally {
      await fixture.cleanup();
    }
  });

  it('repairs the previous rollout table and remains idempotent on reapplication', async () => {
    const rollback = new Error('ROLLBACK_MIGRATION_REPAIR_TEST');
    let assertionsCompleted = false;

    try {
      await db!.begin(async (tx) => {
        await tx.unsafe(`
          ALTER TABLE agent_loop_rollout_v3 DISABLE ROW LEVEL SECURITY;
          DROP POLICY IF EXISTS orchestrator_access ON agent_loop_rollout_v3;
          REVOKE ALL ON agent_loop_rollout_v3 FROM orchestrator_role;
          ALTER TABLE agent_loop_rollout_v3
            DROP CONSTRAINT IF EXISTS agent_loop_rollout_v3_workspace_contact_membership_fk;
        `);

        for (const source of migrationSql) await tx.unsafe(source);
        for (const source of migrationSql) await tx.unsafe(source);

        const [repaired] = await tx<Array<{
          rls: boolean;
          can_select: boolean;
          can_insert: boolean;
          can_update: boolean;
          membership_fk: boolean;
        }>>`
          SELECT
            class.relrowsecurity AS rls,
            has_table_privilege('orchestrator_role', class.oid, 'SELECT') AS can_select,
            has_table_privilege('orchestrator_role', class.oid, 'INSERT') AS can_insert,
            has_table_privilege('orchestrator_role', class.oid, 'UPDATE') AS can_update,
            EXISTS (
              SELECT 1 FROM pg_constraint
              WHERE conrelid = class.oid
                AND conname = 'agent_loop_rollout_v3_workspace_contact_membership_fk'
                AND contype = 'f'
                AND confdeltype = 'c'
            ) AS membership_fk
          FROM pg_class AS class
          WHERE class.oid = 'agent_loop_rollout_v3'::regclass
        `;
        expect(repaired).toEqual({
          rls: true,
          can_select: true,
          can_insert: true,
          can_update: true,
          membership_fk: true,
        });
        assertionsCompleted = true;
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    }

    expect(assertionsCompleted).toBe(true);
  });
});
