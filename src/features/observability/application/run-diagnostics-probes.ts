import type { DependencyProbe } from '../domain/readiness';

export interface DiagnosticsProbeSet {
  readonly postgres: () => Promise<DependencyProbe>;
  readonly pgvector: () => Promise<DependencyProbe>;
  readonly backlog: () => Promise<DependencyProbe>;
  readonly gemini: () => Promise<DependencyProbe>;
}

/**
 * The serverless DB pool intentionally has one connection. Database probes
 * therefore run in sequence; starting them with Promise.all only queues them
 * behind that socket, makes their independent deadlines expire, and can leave
 * a timed-out PendingQuery occupying the warm instance. Gemini uses no DB and
 * may overlap the whole sequence safely.
 */
export async function runDiagnosticsProbes(
  probes: DiagnosticsProbeSet,
): Promise<DependencyProbe[]> {
  const geminiPromise = probes.gemini();
  const postgres = await probes.postgres();
  const pgvector = await probes.pgvector();
  const backlog = await probes.backlog();
  const gemini = await geminiPromise;
  return [postgres, pgvector, backlog, gemini];
}
