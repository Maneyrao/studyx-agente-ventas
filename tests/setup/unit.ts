process.env.TZ = 'UTC';

// Unit workflow suites replace external actions; evidence uses the same signed
// HTTP boundary. Real persistence is exercised by integration/golden tests.
import { vi } from 'vitest';
vi.mock('../../botpress-agent/src/lib/observability/persist-turn-evidence', () => ({
  persistTurnEvidence: async () => undefined,
}));
