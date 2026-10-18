import { describe, expect, it } from 'vitest';
import { createOrchestratorSql } from '@/lib/db/orchestrator';
import { inspectLocalTestDatabaseUrl } from '../helpers/db';

const database = inspectLocalTestDatabaseUrl(process.env.TEST_DATABASE_URL);
const run = database.allowed ? describe : describe.skip;

run('orchestrator database concurrency', () => {
  it('queues concurrent work behind an occupied single-connection pool without cancelling either query', async () => {
    if (!database.allowed) return;
    const sql = createOrchestratorSql(database.url, 1);

    try {
      const first = sql<Array<{ label: string }>>`
        SELECT pg_sleep(1.7), 'first'::text AS label
      `;
      await new Promise((resolve) => setTimeout(resolve, 50));
      const second = sql<Array<{ label: string }>>`
        SELECT 'second'::text AS label
      `;

      const [firstRows, secondRows] = await Promise.all([first, second]);

      expect(firstRows[0]?.label).toBe('first');
      expect(secondRows[0]?.label).toBe('second');
    } finally {
      await sql.end({ timeout: 1 });
    }
  }, 5_000);
});
