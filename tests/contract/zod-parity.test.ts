import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { InboundEnvelopeSchema } from '@/lib/contracts/inbound-envelope';
import { CallEventSchema } from '@/lib/contracts/call-event';

const REPO_ROOT = process.cwd();
const ENVELOPE_DIR = join(REPO_ROOT, 'tests/fixtures/canonical-envelopes');
const CALL_EVENT_DIR = join(REPO_ROOT, 'tests/fixtures/call-events');

/**
 * PARITY MECHANISM
 *
 * The Botpress side uses `import { z } from '@botpress/runtime'`, a bundled
 * runtime that pulls in @opentelemetry and cannot be require()d outside the ADK
 * bundler. So we cannot spawn a plain Node process that imports
 * `botpress-agent/src/schemas/*.ts` directly.
 *
 * Parity is instead enforced by three independent gates:
 *
 * 1. This test exercises every fixture against the Next.js Zod and asserts the
 *    expected accept/reject verdict encoded in the file name prefix
 *    ('valid-' → accept; 'invalid-' → reject). The Botpress side must produce
 *    the same verdicts when the ADK runtime processes those payloads.
 *
 * 2. `specs/004-sales-orchestration/contracts.md` is the human-readable source
 *    of truth. Both Zod files must match it field-by-field.
 *
 * 3. During Phase 1/2 the ADK dev server can be fed each `valid-*.json` fixture
 *    via `adk chat` and `valid-audio.json` via the emulator; failures indicate
 *    Botpress-side drift.
 */

function verdictFromName(name: string): 'accept' | 'reject' {
  if (name.startsWith('valid-')) return 'accept';
  if (name.startsWith('invalid-')) return 'reject';
  throw new Error(`fixture ${name} must start with 'valid-' or 'invalid-'`);
}

function classify(schema: { safeParse: (v: unknown) => { success: boolean } }, dir: string) {
  const rows: Array<{ name: string; expected: 'accept' | 'reject'; actual: 'accept' | 'reject' }> = [];
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith('.json')) continue;
    const raw = JSON.parse(readFileSync(join(dir, name), 'utf-8'));
    const actual = schema.safeParse(raw).success ? 'accept' : 'reject';
    rows.push({ name, expected: verdictFromName(name), actual });
  }
  return rows;
}

describe('canonical envelope — fixture verdict matches file-name convention', () => {
  const rows = classify(InboundEnvelopeSchema, ENVELOPE_DIR);

  it('has at least six fixtures (valid + invalid)', () => {
    expect(rows.length).toBeGreaterThanOrEqual(6);
  });

  it.each(rows)('$name → $expected', ({ expected, actual }) => {
    expect(actual).toBe(expected);
  });
});

describe('call event — fixture verdict matches file-name convention', () => {
  const rows = classify(CallEventSchema, CALL_EVENT_DIR);

  it('has at least six fixtures (valid + invalid)', () => {
    expect(rows.length).toBeGreaterThanOrEqual(6);
  });

  it.each(rows)('$name → $expected', ({ expected, actual }) => {
    expect(actual).toBe(expected);
  });
});
