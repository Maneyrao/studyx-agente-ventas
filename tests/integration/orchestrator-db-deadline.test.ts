import { afterAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { openLocalTestDatabase } from '../helpers/db';
const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const db = process.env.TEST_DATABASE_URL ? openLocalTestDatabase() : null;
afterAll(async () => { await db?.end(); });
run('orchestrator database deadline', () => {
  it('enforces the deployed role deadline without startup/session settings and leaves its pool usable', async () => {
    // This role has no login in the disposable seed; production provisions its
    // password separately. The helper above refuses any remote test database.
    const [{ rolcanlogin }] = await db!`SELECT rolcanlogin FROM pg_roles WHERE rolname = 'orchestrator_role'`;
    await db!`ALTER ROLE orchestrator_role LOGIN`;
    const url = new URL(process.env.TEST_DATABASE_URL!);
    url.username = 'orchestrator_role';
    const connection = postgres(url.toString(), { max: 1, prepare: false });
    try {
      expect((await connection`SHOW statement_timeout`)[0].statement_timeout).toBe('8s');
      await expect(connection`SELECT pg_sleep(9)`).rejects.toMatchObject({ code: '57014' });
      expect((await connection`SELECT 1 AS healthy`)[0].healthy).toBe(1);
    } finally {
      await connection.end();
      if (!rolcanlogin) await db!`ALTER ROLE orchestrator_role NOLOGIN`;
    }
  }, 12_000);
});
