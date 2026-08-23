import { describe, expect, it, vi } from 'vitest';
import { runDiagnosticsProbes } from '@/features/observability/application/run-diagnostics-probes';
import type { DependencyProbe } from '@/features/observability/domain/readiness';

const ok = (name: string, required = false): DependencyProbe => ({
  name,
  required,
  status: 'ok',
  detail: null,
  latency_ms: 1,
});

describe('runDiagnosticsProbes', () => {
  it('serializes database probes while Gemini overlaps independently', async () => {
    let activeDatabaseProbes = 0;
    let maxActiveDatabaseProbes = 0;
    const databaseProbe = (name: string, required = false) => vi.fn(async () => {
      activeDatabaseProbes += 1;
      maxActiveDatabaseProbes = Math.max(maxActiveDatabaseProbes, activeDatabaseProbes);
      await new Promise((resolve) => setTimeout(resolve, 2));
      activeDatabaseProbes -= 1;
      return ok(name, required);
    });

    const probes = await runDiagnosticsProbes({
      postgres: databaseProbe('postgres', true),
      pgvector: databaseProbe('pgvector'),
      backlog: databaseProbe('derived_backlog'),
      gemini: vi.fn(async () => ok('gemini_embedding')),
    });

    expect(maxActiveDatabaseProbes).toBe(1);
    expect(probes.map((probe) => probe.name)).toEqual([
      'postgres', 'pgvector', 'derived_backlog', 'gemini_embedding',
    ]);
  });
});
