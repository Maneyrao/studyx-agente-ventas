import { afterAll, describe, expect, it } from 'vitest';
import { openLocalTestDatabase } from '../helpers/db';
import {
  probeDerivedBacklog,
  probeGemini,
  probePgvector,
  probePostgres,
} from '@/features/observability/adapters/probes';
import { evaluateReadiness } from '@/features/observability/domain/readiness';
import { sql } from '@/lib/db/orchestrator';

/**
 * Fase 8 against a real database.
 *
 * The property under test is the separation itself: a degradable dependency
 * that is genuinely down must still leave the process ready. A test that only
 * exercised the happy path would pass even if `required` were set on pgvector.
 */

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const db = process.env.TEST_DATABASE_URL ? openLocalTestDatabase() : null;

afterAll(async () => {
  await db?.end();
  await sql.end();
});

run('probes against a live database', () => {
  it('reports PostgreSQL as up, with a latency reading', async () => {
    const probe = await probePostgres(sql);
    expect(probe).toMatchObject({ name: 'postgres', required: true, status: 'ok' });
    expect(probe.latency_ms).toBeGreaterThanOrEqual(0);
  });

  it('reports pgvector as installed and degradable', async () => {
    const probe = await probePgvector(sql);
    expect(probe).toMatchObject({ name: 'pgvector', required: false, status: 'ok' });
  });

  it('reads the derived backlog without failing when it is empty', async () => {
    const probe = await probeDerivedBacklog(sql);
    expect(probe.required).toBe(false);
    expect(probe.detail).toContain('pending_memory_embeddings');
  });

  it('keeps the process ready when only degradable dependencies are down', async () => {
    const verdict = evaluateReadiness([
      await probePostgres(sql),
      { ...(await probePgvector(sql)), status: 'down', detail: 'simulated outage' },
      probeGemini(() => undefined),
    ]);

    expect(verdict.ready).toBe(true);
    expect(verdict.status).toBe('degraded');
    expect(verdict.degraded).toContain('pgvector');
    expect(verdict.degraded).toContain('gemini');
  });

  it('refuses traffic when PostgreSQL cannot answer', async () => {
    const unreachable = (() => {
      throw new Error('ECONNREFUSED');
    }) as unknown as Parameters<typeof probePostgres>[0];

    const probe = await probePostgres(unreachable);
    expect(probe.status).toBe('down');
    expect(evaluateReadiness([probe])).toMatchObject({ ready: false, http_status: 503 });
  });
});
