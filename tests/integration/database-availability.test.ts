import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inspectLocalTestDatabaseUrl, openLocalTestDatabase } from '../helpers/db';

const inspection = inspectLocalTestDatabaseUrl(process.env.TEST_DATABASE_URL);
const describeWithLocalDatabase = inspection.allowed ? describe : describe.skip;

describeWithLocalDatabase('local Supabase integration harness', () => {
  let sql: ReturnType<typeof openLocalTestDatabase>;

  beforeAll(() => {
    sql = openLocalTestDatabase();
  });

  afterAll(async () => {
    await sql.end();
  });

  it('connects only to the disposable local database and sees the core schema', async () => {
    const connection = await sql<{ host: string; port: number; database: string }[]>`
      SELECT
        inet_server_addr()::text AS host,
        inet_server_port() AS port,
        current_database() AS database
    `;
    // PostgreSQL sees its container port (usually 5432); the URL guard already verifies
    // that the host-side target is exactly 127.0.0.1:54322.
    expect(connection[0].port).toBeGreaterThan(0);
    expect(connection[0].database).toBe(new URL(process.env.TEST_DATABASE_URL!).pathname.slice(1));

    const tables = await sql<{ name: string | null }[]>`
      SELECT to_regclass('public.contacts')::text AS name
      UNION ALL
      SELECT to_regclass('public.conversations')::text
      UNION ALL
      SELECT to_regclass('public.messages')::text
      UNION ALL
      SELECT to_regclass('public.message_embeddings')::text
      UNION ALL
      SELECT to_regclass('public.audit_log')::text
    `;

    expect(tables.map((row) => row.name)).toEqual([
      'contacts',
      'conversations',
      'messages',
      'message_embeddings',
      'audit_log',
    ]);
  });
});
