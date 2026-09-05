import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { openLocalTestDatabase } from '../helpers/db';

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const db = process.env.TEST_DATABASE_URL ? openLocalTestDatabase() : null;

const migrations = [
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

function withoutLineComments(source: string): string {
  return source.replace(/--[^\n]*/gu, ' ');
}

function escaped(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
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

  it('reapplies both migrations and leaves both constraints validated', async () => {
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
        conname: 'selected_memories_status_check',
        convalidated: true,
        definition: expect.stringMatching(
          /'proposed'::text[\s\S]*'active'::text[\s\S]*'pending_supersession'::text[\s\S]*'expired'::text/u,
        ),
      },
    ]);
  });
});
