// Disposable local integration fixture only. Never calls an embedding provider.
import { openLocalTestDatabase } from '../../tests/helpers/db';
import { runKnowledgeProjectionWorker } from '../../src/lib/services/knowledge-projection.service';

async function main() {
  globalThis.fetch = async () => { throw new Error('OFFLINE_FIXTURE_NETWORK_FORBIDDEN'); };
  const db = openLocalTestDatabase();
  const totals = { claimed: 0, completed: 0, failed: 0, skipped: 0 };
  try {
    for (let i = 0; i < 1_000; i++) {
      const result = await runKnowledgeProjectionWorker({ worker_id: 'offline-integration-fixture', limit: 20 }, {
        sql: db, embed: async () => Array.from({ length: 768 }, () => 0.001),
      });
      for (const key of Object.keys(totals) as Array<keyof typeof totals>) totals[key] += result[key];
      if (!result.claimed) {
        if (totals.failed) throw new Error('OFFLINE_FIXTURE_PROJECTION_FAILED');
        console.log(JSON.stringify(totals));
        return;
      }
    }
    throw new Error('OFFLINE_FIXTURE_QUEUE_NOT_DRAINED');
  } finally { await db.end({ timeout: 5 }); }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
