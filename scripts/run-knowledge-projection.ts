/**
 * Drains knowledge_projection_jobs from the command line.
 *
 * The worker's only runtime entry point is the Vercel cron route
 * (src/app/api/cron/project-knowledge/route.ts), which needs CRON_SECRET and a
 * running server. That is the right shape for a schedule and the wrong shape
 * for "the queue has a backlog and nobody has ever drained it" — which is
 * exactly the state production was found in on 2026-08-18: 23 pending jobs,
 * zero knowledge_documents, zero knowledge_chunks, so every agent turn
 * retrieved an empty knowledge base.
 *
 * Connection safety follows scripts/provision-stripe-prices.mjs: the URL comes
 * from --database-url or TEST_DATABASE_URL, NEVER from DATABASE_URL, because
 * that variable is the production pooler (see .claude/rules/database.md). A
 * remote host additionally requires --allow-remote and --yes.
 *
 * Usage:
 *   npx tsx scripts/run-knowledge-projection.ts --database-url "postgresql://…"
 *   npx tsx scripts/run-knowledge-projection.ts --database-url "…" --allow-remote --yes
 */
import { randomUUID } from 'node:crypto';

const LOCAL_HOST = '127.0.0.1';
const BOOLEAN_FLAGS = new Set(['allow-remote', 'yes']);
const MAX_ROUNDS = 20;
const BATCH_LIMIT = 20;

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = { 'allow-remote': false, yes: false };
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    if (BOOLEAN_FLAGS.has(key)) {
      out[key] = true;
      continue;
    }
    const next = argv[index + 1];
    if (next === undefined || next.startsWith('--')) continue;
    out[key] = next;
    index++;
  }
  return out;
}

function resolveDatabaseUrl(args: Record<string, string | boolean>): string {
  const rawUrl = (args['database-url'] as string | undefined) ?? process.env.TEST_DATABASE_URL;
  if (!rawUrl) {
    throw new Error(
      'Falta --database-url (o TEST_DATABASE_URL). Nunca se usa DATABASE_URL por defecto.'
    );
  }

  const parsed = new URL(rawUrl);
  if (parsed.hostname !== LOCAL_HOST) {
    if (!args['allow-remote']) {
      throw new Error(
        `Rechazado — host remoto: ${parsed.hostname}. Sin --allow-remote sólo se acepta ${LOCAL_HOST}.`
      );
    }
    if (!args.yes) {
      throw new Error(
        `Vas a correr esto contra un host remoto: ${parsed.hostname}. Confirmá agregando --yes.`
      );
    }
    console.error(`Aviso: corriendo contra host remoto ${parsed.hostname} (--allow-remote --yes confirmado).`);
  }

  return rawUrl;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const databaseUrl = resolveDatabaseUrl(args);

  if (!process.env.GEMINI_API_KEY) {
    throw new Error('Falta GEMINI_API_KEY: la proyección genera embeddings y no puede correr sin ella.');
  }

  // Se pisa SIEMPRE (nunca `??=`) y antes del import dinámico, por la misma
  // razón que tests/setup/integration.ts: si el módulo de db se carga con la
  // variable heredada del shell, el worker escribe en el pooler de producción.
  process.env.DATABASE_URL = databaseUrl;

  const { runKnowledgeProjectionWorker } = await import('../src/lib/services/knowledge-projection.service');

  const workerId = `knowledge-projection-cli:${randomUUID()}`;
  const totals = { claimed: 0, completed: 0, failed: 0, skipped: 0 };

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const result = await runKnowledgeProjectionWorker({ worker_id: workerId, limit: BATCH_LIMIT });
    totals.claimed += result.claimed;
    totals.completed += result.completed;
    totals.failed += result.failed;
    totals.skipped += result.skipped;
    console.error(
      `ronda ${round + 1}: claimed=${result.claimed} completed=${result.completed} failed=${result.failed} skipped=${result.skipped}`
    );
    if (result.claimed === 0) break;
  }

  console.log(JSON.stringify(totals));
  if (totals.failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
