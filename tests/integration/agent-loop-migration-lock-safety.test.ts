import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterAll, describe, expect, it } from 'vitest';
import { openLocalTestDatabase } from '../helpers/db';

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const db = process.env.TEST_DATABASE_URL ? openLocalTestDatabase() : null;

const migrations = [
  {
    name: '20260905000002_outbound_deferred_state_patch.sql',
    table: 'outbound_deliveries',
    constraint: 'outbound_deliveries_deferred_patch_applied_on_check',
  },
  {
    name: '20260905000007_agent_loop_prepared_memory_in_txn_supersede.sql',
    table: 'public.selected_memories',
    constraint: 'selected_memories_status_check',
  },
  {
    name: '20260905000009_outbound_deferred_lead_projection.sql',
    table: 'outbound_deliveries',
    constraint: 'outbound_deliveries_deferred_lead_projection_applied_on_check',
  },
] as const;

const indexMigrations = [
  {
    name: '20260905000004_agent_turn_preparations.sql',
    indexes: [
      { name: 'messages_id_conversation_uq', unique: true },
      { name: 'agent_turn_preparations_idempotency_key', unique: true },
    ],
    retiredIndexes: [],
  },
  {
    name: '20260905000005_agent_loop_commit_trace.sql',
    indexes: [
      { name: 'conversation_sales_context_events_v1_source_idx', unique: false },
    ],
    retiredIndexes: ['conversation_sales_context_events_v1_source_unique'],
  },
] as const;

function withoutLineComments(source: string): string {
  return source.replace(/--[^\n]*/gu, ' ');
}

function escaped(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function applyLocalMigration(name: string): void {
  const databaseUrl = process.env.TEST_DATABASE_URL;
  if (!databaseUrl) throw new Error('TEST_DATABASE_URL_REQUIRED');
  const parsed = new URL(databaseUrl);
  if (!['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname)) {
    throw new Error('LOCAL_TEST_DATABASE_REQUIRED');
  }
  execFileSync('psql', [
    databaseUrl,
    '-v', 'ON_ERROR_STOP=1',
    '-X',
    '-q',
    '-f', resolve(process.cwd(), 'supabase/migrations', name),
  ], { stdio: 'pipe' });
}

afterAll(async () => db?.end());

run('Agent Loop additive CHECK migrations', () => {
  it.each(migrations)(
    '$name adds the CHECK without a table scan under ACCESS EXCLUSIVE and validates it afterwards',
    ({ name, table, constraint }) => {
      const source = withoutLineComments(
        readFileSync(resolve(process.cwd(), 'supabase/migrations', name), 'utf8'),
      );
      const addNotValid = new RegExp(
        `ALTER\\s+TABLE\\s+${escaped(table)}\\s+ADD\\s+CONSTRAINT\\s+${constraint}`
          + '[\\s\\S]*?CHECK\\s*\\([\\s\\S]*?\\)\\s+NOT\\s+VALID\\s*;',
        'u',
      );
      const validate = new RegExp(
        `ALTER\\s+TABLE\\s+${escaped(table)}\\s+VALIDATE\\s+CONSTRAINT\\s+${constraint}\\s*;`,
        'u',
      );

      expect(source).toMatch(addNotValid);
      expect(source).toMatch(validate);
      expect(source.search(addNotValid)).toBeLessThan(source.search(validate));
    },
  );

  it.each(indexMigrations)(
    '$name builds every index concurrently outside a transaction',
    ({ name, indexes, retiredIndexes }) => {
      const source = withoutLineComments(
        readFileSync(resolve(process.cwd(), 'supabase/migrations', name), 'utf8'),
      );
      expect(source).toMatch(/SET\s+lock_timeout\s*=\s*'5s'\s*;/u);
      expect(source).toMatch(/RESET\s+lock_timeout\s*;/u);
      expect(source).not.toMatch(/\b(?:BEGIN|COMMIT)\s*;/u);

      const allCreates = source.match(/CREATE\s+(?:UNIQUE\s+)?INDEX\b/gu) ?? [];
      const concurrentCreates = source.match(
        /CREATE\s+(?:UNIQUE\s+)?INDEX\s+CONCURRENTLY\b/gu,
      ) ?? [];
      expect(concurrentCreates).toHaveLength(allCreates.length);

      for (const index of indexes) {
        const statement = new RegExp(
          `CREATE\\s+${index.unique ? 'UNIQUE\\s+' : ''}INDEX\\s+CONCURRENTLY\\s+IF\\s+NOT\\s+EXISTS\\s+${index.name}\\b`,
          'u',
        );
        expect(source).toMatch(statement);
        expect(source).toMatch(new RegExp(
          `class\\.relname\\s*=\\s*'${index.name}'[\\s\\S]*?NOT\\s+index\\.indisvalid[\\s\\S]*?DROP\\s+INDEX\\s+public\\.${index.name}`,
          'u',
        ));
      }
      for (const retired of retiredIndexes) {
        const replacement = indexes[0]!.name;
        const createAt = source.search(new RegExp(`CREATE[\\s\\S]*?${replacement}\\b`, 'u'));
        const drop = new RegExp(
          `DROP\\s+INDEX\\s+CONCURRENTLY\\s+IF\\s+EXISTS\\s+${retired}\\s*;`,
          'u',
        );
        expect(source).toMatch(drop);
        expect(createAt).toBeLessThan(source.search(drop));
      }
    },
  );

  it('validates every scanning constraint in 00004 after adding it NOT VALID', () => {
    const source = withoutLineComments(readFileSync(
      resolve(
        process.cwd(),
        'supabase/migrations/20260905000004_agent_turn_preparations.sql',
      ),
      'utf8',
    ));
    const constraints = [
      'agent_turn_preparations_turn_conversation_fk',
      'agent_turn_preparations_tool_check',
      'agent_turn_preparations_canonical_key_check',
      'agent_turn_preparations_canonical_data_check',
      'agent_turn_preparations_committed_at_check',
    ];

    for (const constraint of constraints) {
      expect(source).toMatch(new RegExp(
        `ADD\\s+CONSTRAINT\\s+${constraint}[\\s\\S]*?NOT\\s+VALID\\s*;`,
        'u',
      ));
      expect(source).toMatch(new RegExp(
        `VALIDATE\\s+CONSTRAINT\\s+${constraint}\\s*;`,
        'u',
      ));
    }
  });

  it('reapplies every migration and leaves every constraint validated', async () => {
    for (const migration of migrations) {
      const source = readFileSync(
        resolve(process.cwd(), 'supabase/migrations', migration.name),
        'utf8',
      );
      await db!.unsafe(source);
      await db!.unsafe(source);
    }

    const constraints = await db!<Array<{
      conname: string;
      convalidated: boolean;
      definition: string;
    }>>`
      SELECT conname, convalidated, pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conname IN (
        'selected_memories_status_check',
        'outbound_deliveries_deferred_patch_applied_on_check',
        'outbound_deliveries_deferred_lead_projection_applied_on_check'
      )
      ORDER BY conname
    `;
    expect(constraints).toEqual([
      {
        conname: 'outbound_deliveries_deferred_lead_projection_applied_on_check',
        convalidated: true,
        definition: expect.stringMatching(
          /deferred_lead_projection_applied_on IS NULL[\s\S]*'accepted'::text/u,
        ),
      },
      {
        conname: 'outbound_deliveries_deferred_patch_applied_on_check',
        convalidated: true,
        definition: expect.stringMatching(
          /deferred_patch_applied_on IS NULL[\s\S]*'accepted'::text[\s\S]*'delivered'::text/u,
        ),
      },
      {
        conname: 'selected_memories_status_check',
        convalidated: true,
        definition: expect.stringMatching(
          /'proposed'::text[\s\S]*'active'::text[\s\S]*'pending_supersession'::text[\s\S]*'expired'::text/u,
        ),
      },
    ]);
  });

  it('reapplies concurrent index migrations and preserves replacement semantics', async () => {
    for (const migration of indexMigrations) {
      applyLocalMigration(migration.name);
      applyLocalMigration(migration.name);
    }

    const indexes = await db!<Array<{
      name: string;
      unique: boolean;
      valid: boolean;
      definition: string;
    }>>`
      SELECT class.relname AS name, index.indisunique AS unique, index.indisvalid AS valid,
             pg_get_indexdef(index.indexrelid) AS definition
      FROM pg_index AS index
      JOIN pg_class AS class ON class.oid = index.indexrelid
      WHERE class.relname IN (
        'messages_id_conversation_uq',
        'agent_turn_preparations_idempotency_key',
        'conversation_sales_context_events_v1_source_idx',
        'conversation_sales_context_events_v1_source_unique'
      )
      ORDER BY class.relname
    `;
    expect(indexes).toEqual([
      {
        name: 'agent_turn_preparations_idempotency_key',
        unique: true,
        valid: true,
        definition: expect.stringMatching(
          /\(conversation_id, tool, canonical_key\)$/u,
        ),
      },
      {
        name: 'conversation_sales_context_events_v1_source_idx',
        unique: false,
        valid: true,
        definition: expect.stringMatching(
          /\(workspace_id, conversation_id, source_turn_id, state_version\) WHERE \(source_turn_id IS NOT NULL\)$/u,
        ),
      },
      {
        name: 'messages_id_conversation_uq',
        unique: true,
        valid: true,
        definition: expect.stringMatching(/\(id, conversation_id\)$/u),
      },
    ]);
  });
});
