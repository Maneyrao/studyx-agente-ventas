const LOCAL_PORTS = new Set(['55432', '55433', '55434', '55435']);

export function resolveLocalQueueDatabaseUrl(
  env: Record<string, string | undefined> = process.env,
): string {
  const raw = env.TEST_DATABASE_URL;
  if (!raw) throw new Error('TEST_DATABASE_URL is required; DATABASE_URL is never used by queue runners.');

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('TEST_DATABASE_URL must be a valid PostgreSQL URL.');
  }
  const postgresProtocol = parsed.protocol === 'postgres:' || parsed.protocol === 'postgresql:';
  if (!postgresProtocol || parsed.hostname !== '127.0.0.1' || !LOCAL_PORTS.has(parsed.port)) {
    throw new Error('Queue runners require disposable local PostgreSQL on 127.0.0.1:55432-55435.');
  }
  if (parsed.pathname !== '/studyx_test') {
    throw new Error('Queue runners require the disposable studyx_test database.');
  }
  return raw;
}

export function requireGeminiApiKey(
  env: Record<string, string | undefined> = process.env,
): void {
  if (!env.GEMINI_API_KEY?.trim()) {
    throw new Error('GEMINI_API_KEY is required before a queue runner may claim work.');
  }
}

interface QueuePass {
  claimed: number;
  completed: number;
  failed: number;
  skipped: number;
  lease_lost?: number;
}

export async function drainDurableQueue(
  run: (workerId: string) => Promise<QueuePass>,
  workerId: string,
): Promise<QueuePass & { rounds: number }> {
  const totals: QueuePass & { rounds: number } = {
    claimed: 0,
    completed: 0,
    failed: 0,
    skipped: 0,
    lease_lost: 0,
    rounds: 0,
  };
  for (let round = 0; round < 100; round++) {
    const result = await run(workerId);
    totals.rounds += 1;
    totals.claimed += result.claimed;
    totals.completed += result.completed;
    totals.failed += result.failed;
    totals.skipped += result.skipped;
    totals.lease_lost = (totals.lease_lost ?? 0) + (result.lease_lost ?? 0);
    if (result.claimed === 0) return totals;
  }
  throw new Error('QUEUE_DRAIN_ROUND_LIMIT_EXCEEDED');
}
