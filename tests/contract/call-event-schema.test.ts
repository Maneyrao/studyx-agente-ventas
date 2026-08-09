import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CallEventSchema } from '@/lib/contracts/call-event';

const FIXTURE_DIR = join(process.cwd(), 'tests/fixtures/call-events');

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, name), 'utf-8'));
}

function fixturesMatching(prefix: string): string[] {
  return readdirSync(FIXTURE_DIR)
    .filter((name) => name.startsWith(prefix) && name.endsWith('.json'))
    .sort();
}

describe('call event schema — accept fixtures', () => {
  const valid = fixturesMatching('valid-');

  it('has at least one valid fixture per event type', () => {
    const eventTypes = valid.map((name) => name.replace(/^valid-/, '').replace(/\.json$/, ''));
    for (const t of ['requested', 'started', 'ended', 'analyzed']) {
      expect(eventTypes).toContain(t);
    }
  });

  it.each(valid)('accepts %s', (name) => {
    const parsed = CallEventSchema.safeParse(loadFixture(name));
    expect(parsed.success).toBe(true);
  });
});

describe('call event schema — reject fixtures', () => {
  const invalid = fixturesMatching('invalid-');

  it('discovers at least one invalid fixture', () => {
    expect(invalid.length).toBeGreaterThan(0);
  });

  it.each(invalid)('rejects %s', (name) => {
    const parsed = CallEventSchema.safeParse(loadFixture(name));
    expect(parsed.success).toBe(false);
  });
});

describe('call event schema — invariants', () => {
  it('rejects missing event_id (idempotency)', () => {
    const parsed = CallEventSchema.safeParse(loadFixture('invalid-missing-event-id.json'));
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((i) => i.path.join('.') === 'event_id')).toBe(true);
    }
  });

  it('rejects when event_type does not match payload.event_type', () => {
    const parsed = CallEventSchema.safeParse(loadFixture('invalid-event-type-payload-mismatch.json'));
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(
        parsed.error.issues.some((i) => i.message === 'EVENT_TYPE_PAYLOAD_MISMATCH'),
      ).toBe(true);
    }
  });

  it('rejects a provider outside the enum', () => {
    const parsed = CallEventSchema.safeParse(loadFixture('invalid-provider-not-in-enum.json'));
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((i) => i.path.join('.') === 'provider')).toBe(true);
    }
  });

  it('rejects an analysis result outside the 9 allowed values', () => {
    const parsed = CallEventSchema.safeParse(loadFixture('invalid-analysis-bad-result.json'));
    expect(parsed.success).toBe(false);
  });

  it('rejects a sequence that is not an integer >= 0', () => {
    const evt = loadFixture('valid-started.json') as any;
    evt.sequence = -1;
    expect(CallEventSchema.safeParse(evt).success).toBe(false);
    evt.sequence = 1.5;
    expect(CallEventSchema.safeParse(evt).success).toBe(false);
  });
});

describe('call event schema — derived states are NOT emitted', () => {
  it('rejects a webhook-emitted "failed" event_type (derived, not provider-emitted)', () => {
    const evt = loadFixture('valid-started.json') as any;
    evt.event_type = 'failed';
    evt.payload = { event_type: 'failed', reason: 'call_did_not_connect' };
    const parsed = CallEventSchema.safeParse(evt);
    expect(parsed.success).toBe(false);
  });

  it('rejects a webhook-emitted "ringing" event_type (not part of the provider model)', () => {
    const evt = loadFixture('valid-started.json') as any;
    evt.event_type = 'ringing';
    evt.payload = { event_type: 'ringing' };
    const parsed = CallEventSchema.safeParse(evt);
    expect(parsed.success).toBe(false);
  });
});
