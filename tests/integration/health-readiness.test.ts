import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { openLocalTestDatabase } from '../helpers/db';
import {
  probeDerivedBacklog,
  probeGeminiEmbedding,
  probePgvector,
  probePostgres,
} from '@/features/observability/adapters/probes';
import { evaluateReadiness } from '@/features/observability/domain/readiness';
import { sql } from '@/lib/db/orchestrator';
import { EMBEDDING_EPOCH, EmbeddingProviderError } from '@/lib/embeddings/gemini';

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
    const detail = JSON.parse(probe.detail ?? '{}');
    expect(detail).toMatchObject({ embedding_epoch: EMBEDDING_EPOCH });
    expect(detail.message_queue).toEqual(expect.objectContaining({
      claimable: expect.any(Number),
      leased: expect.any(Number),
      dead_letter: expect.any(Number),
    }));
    expect(detail.message_queue).toHaveProperty('oldest_age_seconds');
    expect(detail.message_queue).toHaveProperty('last_error');
    expect(detail.selected_memory_queue).toEqual(expect.objectContaining({
      claimable: expect.any(Number),
      leased: expect.any(Number),
      dead_letter: expect.any(Number),
    }));
    expect(detail.knowledge_queue).toEqual(expect.objectContaining({
      claimable: expect.any(Number),
      leased: expect.any(Number),
      dead_letter: expect.any(Number),
    }));
    expect(detail.epoch_coverage).toEqual(expect.objectContaining({
      messages_current: expect.any(Number),
      messages_legacy: expect.any(Number),
      selected_current: expect.any(Number),
      selected_legacy: expect.any(Number),
      knowledge_current: expect.any(Number),
      knowledge_legacy: expect.any(Number),
    }));
  });

  it('keeps the process ready when only degradable dependencies are down', async () => {
    const downGemini = async () => {
      throw new EmbeddingProviderError('GEMINI_EMBED_HTTP_401', 'terminal_configuration', 401);
    };
    const verdict = evaluateReadiness([
      await probePostgres(sql),
      { ...(await probePgvector(sql)), status: 'down', detail: 'simulated outage' },
      await probeGeminiEmbedding(downGemini),
    ]);

    expect(verdict.ready).toBe(true);
    expect(verdict.status).toBe('degraded');
    expect(verdict.degraded).toContain('pgvector');
    expect(verdict.degraded).toContain('gemini_embedding');
  });

  it('refuses traffic when PostgreSQL cannot answer', async () => {
    const unreachable = (() => {
      throw new Error('ECONNREFUSED');
    }) as unknown as Parameters<typeof probePostgres>[0];

    const probe = await probePostgres(unreachable);
    expect(probe.status).toBe('down');
    expect(evaluateReadiness([probe])).toMatchObject({ ready: false, http_status: 503 });
  });

  // `studyx_test` was seeded with 23 pending `knowledge_projection_jobs`
  // (RED per §6: a real, unprojected backlog must never read as healthy).
  // The seeded jobs may already have been drained by the time this test
  // suite runs (this task's own drain, another agent's runner, ...), so the
  // fixture inserts and cleans up its own claimable job instead of asserting
  // on ambient global state.
  it('reports the derived backlog as not-ok while a knowledge source is still unprojected', async () => {
    const [source] = await sql<Array<{ id: string; workspace_id: string }>>`
      SELECT id, workspace_id FROM knowledge_sources LIMIT 1
    `;
    if (!source) throw new Error('fixture requires at least one seeded knowledge_source');
    const [job] = await sql<Array<{ id: string }>>`
      INSERT INTO knowledge_projection_jobs (workspace_id, source_id, source_version, status, available_at)
      VALUES (${source.workspace_id}, ${source.id}, 999999, 'pending', now())
      RETURNING id
    `;
    try {
      const probe = await probeDerivedBacklog(sql);
      const detail = JSON.parse(probe.detail ?? '{}');
      expect(detail.knowledge_queue.claimable).toBeGreaterThan(0);
      // A healthy-empty read here — 'ok' while real work sits unclaimed — is
      // exactly the false positive the memory contract forbids.
      expect(probe.status).not.toBe('ok');
      expect(probe.status).toBe('degraded');
    } finally {
      await sql`DELETE FROM knowledge_projection_jobs WHERE id = ${job.id}`;
    }
  });
});

describe('probeGeminiEmbedding — real, bounded smoke instead of a config check', () => {
  it('reports ok with the current epoch on a healthy embedding', async () => {
    const fakeEmbed = async () => Array.from({ length: 768 }, () => 0.01);
    const probe = await probeGeminiEmbedding(fakeEmbed);
    expect(probe.status).toBe('ok');
    const detail = JSON.parse(probe.detail ?? '{}');
    expect(detail).toMatchObject({ epoch: EMBEDDING_EPOCH, smoke: 'ok' });
  });

  // RED: a 401 (revoked/invalid key) must show as unavailable — never as a
  // healthy-empty probe. `probeGemini` (config-presence-only) cannot catch
  // this; this is exactly the gap it leaves open.
  it('reports a 401 as unavailable, never as healthy-empty', async () => {
    const fakeEmbed = async () => {
      throw new EmbeddingProviderError('GEMINI_EMBED_HTTP_401', 'terminal_configuration', 401);
    };
    const probe = await probeGeminiEmbedding(fakeEmbed);
    expect(probe.status).not.toBe('ok');
    expect(probe.status).toBe('down');
    const detail = JSON.parse(probe.detail ?? '{}');
    expect(detail).toMatchObject({ epoch: EMBEDDING_EPOCH, smoke: 'unavailable' });
    expect(detail.reason).toBe('GEMINI_EMBED_HTTP_401');
    // The key itself is never surfaced anywhere in the probe.
    const serialized = JSON.stringify(probe);
    expect(serialized).not.toContain('x-goog-api-key');
    expect(serialized.toLowerCase()).not.toContain('apikey');
  });

  it('reports a transient failure as degraded rather than down', async () => {
    const fakeEmbed = async () => {
      throw new EmbeddingProviderError('GEMINI_EMBED_TIMEOUT', 'retryable');
    };
    const probe = await probeGeminiEmbedding(fakeEmbed);
    expect(probe.status).toBe('degraded');
  });

  // Real network call, gated on an actual key so the suite never depends on
  // outbound network access unless one is present.
  const geminiRun = process.env.GEMINI_API_KEY ? it : it.skip;
  geminiRun('performs one real bounded call against Gemini when a key is present', async () => {
    const probe = await probeGeminiEmbedding();
    expect(probe.status).toBe('ok');
    const detail = JSON.parse(probe.detail ?? '{}');
    expect(detail.epoch).toBe(EMBEDDING_EPOCH);
    expect(JSON.stringify(probe)).not.toContain(process.env.GEMINI_API_KEY as string);
  });
});

// Fix (coordinator review, task 1): probeGeminiEmbedding existed but was dead
// code from the production surface — /api/diagnostics still called the
// presence-only probeGemini, so a revoked key kept reporting `gemini: ok` on
// the live endpoint. These exercise the actual route composition, not just
// the probe in isolation.
run('GET /api/diagnostics — Gemini reflects a real embedding smoke, not key presence', () => {
  const originalCronSecret = process.env.CRON_SECRET;
  const originalGeminiKey = process.env.GEMINI_API_KEY;
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    process.env.CRON_SECRET = 'diagnostics-test-secret';
    process.env.GEMINI_API_KEY = 'test-diagnostics-key';
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    if (originalCronSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = originalCronSecret;
    if (originalGeminiKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalGeminiKey;
    vi.unstubAllGlobals();
  });

  function diagnosticsRequest(): NextRequest {
    return new NextRequest('http://localhost/api/diagnostics', {
      headers: { authorization: 'Bearer diagnostics-test-secret' },
    });
  }

  function findProbe(body: { probes: Array<{ name: string }> }, name: string) {
    const probe = body.probes.find((p) => p.name === name);
    if (!probe) throw new Error(`probe "${name}" missing from /api/diagnostics response`);
    return probe as { name: string; status: string; detail: string | null };
  }

  // RED: with the presence-only probe still wired in, this reports `ok`
  // (the key is set) even though every real call 401s — exactly the
  // healthy-empty false positive §6 forbids.
  it('reports gemini as down/unavailable on a 401, never ok', async () => {
    fetchMock.mockResolvedValue(new Response('unauthorized', { status: 401 }));
    const { GET } = await import('@/app/api/diagnostics/route');
    const response = await GET(diagnosticsRequest());
    const body = await response.json();

    const gemini = findProbe(body, 'gemini_embedding');
    expect(gemini.status).not.toBe('ok');
    const detail = JSON.parse(gemini.detail ?? '{}');
    expect(detail).toMatchObject({ epoch: EMBEDDING_EPOCH, smoke: 'unavailable' });
    expect(body.degraded).toContain('gemini_embedding');
    // Never the stale, presence-only probe alongside the real one.
    expect(body.probes.some((p: { name: string }) => p.name === 'gemini')).toBe(false);
  });

  it('reports gemini as ok with the current epoch on a healthy embedding', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      embedding: { values: Array.from({ length: 768 }, () => 0.01) },
    }), { status: 200 }));
    const { GET } = await import('@/app/api/diagnostics/route');
    const response = await GET(diagnosticsRequest());
    const body = await response.json();

    const gemini = findProbe(body, 'gemini_embedding');
    expect(gemini.status).toBe('ok');
    const detail = JSON.parse(gemini.detail ?? '{}');
    expect(detail).toMatchObject({ epoch: EMBEDDING_EPOCH, smoke: 'ok' });
    // The synthetic test key is never surfaced in the response body.
    expect(JSON.stringify(body)).not.toContain('test-diagnostics-key');
  });
});
