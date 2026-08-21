import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/orchestrator', () => ({
  sql: Object.assign(() => Promise.resolve([]), {
    begin: async () => [],
    end: async () => {},
  }),
}));

import { runMessageEmbeddingWorker } from '@/lib/services/message-embedding-worker.service';
import type { DbClient } from '@/lib/db/types';

describe('embedding worker hard deadline', () => {
  it('bounds a delayed pool/SQL claim and does not continue after the deadline', async () => {
    let dbCalls = 0;
    const delayed = () => {
      dbCalls += 1;
      return new Promise<never>(() => {});
    };
    const db = Object.assign(delayed, {
      begin: () => {
        dbCalls += 1;
        return new Promise<never>(() => {});
      },
      end: async () => {},
    }) as unknown as DbClient;

    const startedAt = Date.now();
    const result = await runMessageEmbeddingWorker(
      { worker_id: 'delayed-db', limit: 1, deadline_ms: 60 },
      { sql: db as never, embed: async () => [] },
    );

    expect(dbCalls).toBe(1);
    expect(Date.now() - startedAt).toBeLessThan(250);
    expect(result).toMatchObject({ claimed: 0, completed: 0, deadline_reached: true });
  });
});
