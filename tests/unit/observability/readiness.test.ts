import { describe, expect, it } from 'vitest';
import {
  DEGRADABLE_ENVIRONMENT,
  REQUIRED_ENVIRONMENT,
  evaluateReadiness,
  probeEnvironment,
  probeAgentABrainConfiguration,
  type DependencyProbe,
} from '@/features/observability/domain/readiness';

function probe(overrides: Partial<DependencyProbe> = {}): DependencyProbe {
  return { name: 'postgres', required: true, status: 'ok', detail: null, latency_ms: 3, ...overrides };
}

describe('evaluateReadiness', () => {
  it('is ready when everything answers', () => {
    expect(evaluateReadiness([probe(), probe({ name: 'pgvector', required: false })])).toMatchObject({
      status: 'ready',
      ready: true,
      http_status: 200,
    });
  });

  it('refuses traffic when a required dependency is down', () => {
    const verdict = evaluateReadiness([probe({ status: 'down', detail: 'connection refused' })]);
    expect(verdict).toMatchObject({ status: 'not_ready', ready: false, http_status: 503 });
    expect(verdict.failed_required).toEqual(['postgres']);
  });

  it('stays ready — and says degraded — when only a degradable dependency fails', () => {
    const verdict = evaluateReadiness([
      probe(),
      probe({ name: 'gemini', required: false, status: 'down', detail: 'no api key' }),
      probe({ name: 'pgvector', required: false, status: 'degraded' }),
    ]);
    // Pulling a process that can still hold a conversation, because a derived
    // index is unavailable, turns a partial outage into a total one.
    expect(verdict).toMatchObject({ status: 'degraded', ready: true, http_status: 200 });
    expect(verdict.degraded).toEqual(['gemini', 'pgvector']);
    expect(verdict.failed_required).toEqual([]);
  });

  it('treats a required dependency that merely degrades as not ready', () => {
    expect(evaluateReadiness([probe({ status: 'degraded' })]).ready).toBe(false);
  });

  it('is ready with no probes at all rather than inventing a failure', () => {
    expect(evaluateReadiness([])).toMatchObject({ status: 'ready', ready: true });
  });
});

describe('probeAgentABrainConfiguration', () => {
  it('marks enabled plus shadow as a required configuration failure', () => {
    expect(probeAgentABrainConfiguration({ enabled: true, shadow: true, mode: 'invalid', ready: false }))
      .toMatchObject({ name: 'agent_a_brain_configuration', required: true, status: 'down' });
  });

  it('does not expose flags as a failure in any valid rollout mode', () => {
    expect(probeAgentABrainConfiguration({ enabled: false, shadow: true, mode: 'shadow', ready: true }))
      .toMatchObject({ status: 'ok', detail: null });
  });
});

describe('probeEnvironment', () => {
  const present = (names: readonly string[]) => (name: string) =>
    names.includes(name) ? 'value' : undefined;

  it('passes when every required variable is set', () => {
    const probes = probeEnvironment(present([...REQUIRED_ENVIRONMENT, ...DEGRADABLE_ENVIRONMENT]));
    expect(probes.every((entry) => entry.status === 'ok')).toBe(true);
  });

  it('names the missing required variables without revealing any value', () => {
    const probes = probeEnvironment(present([]));
    const configuration = probes.find((entry) => entry.name === 'configuration')!;
    expect(configuration.status).toBe('down');
    for (const name of REQUIRED_ENVIRONMENT) {
      expect(configuration.detail).toContain(name);
    }
    expect(configuration.detail).not.toContain('value');
  });

  it('treats an empty string as missing', () => {
    const probes = probeEnvironment((name) => (name === 'DATABASE_URL' ? '   ' : 'value'));
    expect(probes.find((entry) => entry.name === 'configuration')!.status).toBe('down');
  });

  it('treats Gemini and commercial configuration as required for Agent A', () => {
    const probes = probeEnvironment(present(REQUIRED_ENVIRONMENT.filter((name) => name !== 'GEMINI_API_KEY')));
    const configuration = probes.find((entry) => entry.name === 'configuration')!;
    expect(configuration).toMatchObject({ required: true, status: 'down' });
    expect(configuration.detail).toContain('GEMINI_API_KEY');
  });
});
