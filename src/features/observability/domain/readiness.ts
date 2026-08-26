/**
 * How a set of dependency probes becomes an HTTP verdict.
 *
 * The distinction this module exists to make: **required** dependencies decide
 * whether the process may take traffic, **degradable** ones never do.
 *
 * PostgreSQL is the source of truth, so without it every write is a lie and the
 * only honest answer is 503. Gemini and pgvector are derived and reconstructible
 * — a turn without them still has structured facts, recent messages and the
 * summary, which is exactly the degradation the memory strategy promises. If a
 * pgvector outage returned 503, a load balancer would pull a process that is
 * perfectly capable of holding a conversation.
 *
 * Pure and dependency-free: the probes are run by the adapter, the verdict is
 * decided here, so the whole truth table is testable without a network.
 */

export type ProbeStatus = 'ok' | 'degraded' | 'down';

export interface DependencyProbe {
  readonly name: string;
  /** true = the process cannot serve traffic without it. */
  readonly required: boolean;
  readonly status: ProbeStatus;
  readonly detail: string | null;
  readonly latency_ms: number | null;
}

export type ReadinessStatus = 'ready' | 'degraded' | 'not_ready';

export interface ReadinessVerdict {
  readonly status: ReadinessStatus;
  /** What an orchestrator should do with this process. */
  readonly ready: boolean;
  readonly http_status: 200 | 503;
  readonly probes: DependencyProbe[];
  readonly failed_required: string[];
  readonly degraded: string[];
}

export function evaluateReadiness(probes: readonly DependencyProbe[]): ReadinessVerdict {
  const failed_required = probes
    .filter((probe) => probe.required && probe.status !== 'ok')
    .map((probe) => probe.name);

  const degraded = probes
    .filter((probe) => !probe.required && probe.status !== 'ok')
    .map((probe) => probe.name);

  const status: ReadinessStatus =
    failed_required.length > 0 ? 'not_ready' : degraded.length > 0 ? 'degraded' : 'ready';

  return {
    status,
    // `degraded` is still ready. Pulling a process that can hold a conversation
    // because a derived index is unavailable trades a partial outage for a
    // total one.
    ready: failed_required.length === 0,
    http_status: failed_required.length === 0 ? 200 : 503,
    probes: [...probes],
    failed_required,
    degraded,
  };
}

/**
 * Environment variables the process cannot run without, checked by presence
 * only. Their values are secrets and never appear in a response or a log line.
 */
export const REQUIRED_ENVIRONMENT = AGENT_A_REQUIRED_ENVIRONMENT;

/** Present = the feature works; absent = it degrades, and says so. */
export const DEGRADABLE_ENVIRONMENT = [] as const;

export function probeEnvironment(
  read: (name: string) => string | undefined
): DependencyProbe[] {
  const missingRequired = REQUIRED_ENVIRONMENT.filter((name) => !read(name)?.trim());
  const missingOptional = DEGRADABLE_ENVIRONMENT.filter((name) => !read(name)?.trim());

  return [
    {
      name: 'configuration',
      required: true,
      status: missingRequired.length === 0 ? 'ok' : 'down',
      // Names only. A readiness endpoint that echoed a value would be a
      // credential leak reachable without authentication.
      detail: missingRequired.length === 0 ? null : `missing: ${missingRequired.join(', ')}`,
      latency_ms: null,
    },
    {
      name: 'configuration_optional',
      required: false,
      status: missingOptional.length === 0 ? 'ok' : 'degraded',
      detail: missingOptional.length === 0 ? null : `missing: ${missingOptional.join(', ')}`,
      latency_ms: null,
    },
  ];
}
import { AGENT_A_REQUIRED_ENVIRONMENT } from '@/lib/config';
