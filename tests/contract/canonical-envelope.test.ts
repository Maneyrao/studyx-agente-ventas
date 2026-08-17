import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { InboundEnvelopeSchema } from '@/lib/contracts/inbound-envelope';

const FIXTURE_DIR = join(process.cwd(), 'tests/fixtures/canonical-envelopes');

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, name), 'utf-8'));
}

function fixturesMatching(prefix: string): string[] {
  return readdirSync(FIXTURE_DIR)
    .filter((name) => name.startsWith(prefix) && name.endsWith('.json'))
    .sort();
}

describe('canonical inbound envelope — accept fixtures', () => {
  const validFixtures = fixturesMatching('valid-');

  it('discovers at least one valid fixture', () => {
    expect(validFixtures.length).toBeGreaterThan(0);
  });

  it.each(validFixtures)('accepts %s', (name) => {
    const parsed = InboundEnvelopeSchema.safeParse(loadFixture(name));
    expect(parsed.success).toBe(true);
  });
});

describe('canonical inbound envelope — reject fixtures', () => {
  const invalidFixtures = fixturesMatching('invalid-');

  it('discovers at least one invalid fixture', () => {
    expect(invalidFixtures.length).toBeGreaterThan(0);
  });

  it.each(invalidFixtures)('rejects %s', (name) => {
    const parsed = InboundEnvelopeSchema.safeParse(loadFixture(name));
    expect(parsed.success).toBe(false);
  });
});

describe('canonical inbound envelope — specific invariants', () => {
  it('rejects missing schema_version', () => {
    const parsed = InboundEnvelopeSchema.safeParse(loadFixture('invalid-missing-schema-version.json'));
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const issue = parsed.error.issues.find((i) => i.path.join('.') === 'schema_version');
      expect(issue).toBeDefined();
    }
  });

  it('rejects missing external_message_id (idempotency key)', () => {
    const parsed = InboundEnvelopeSchema.safeParse(loadFixture('invalid-missing-external-message-id.json'));
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const issue = parsed.error.issues.find((i) => i.path.join('.') === 'external_message_id');
      expect(issue).toBeDefined();
    }
  });

  it('rejects missing trace_id (correlation key)', () => {
    const parsed = InboundEnvelopeSchema.safeParse(loadFixture('invalid-missing-trace-id.json'));
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const issue = parsed.error.issues.find((i) => i.path.join('.') === 'trace_id');
      expect(issue).toBeDefined();
    }
  });

  it('rejects a trace_id that is not a UUID', () => {
    const parsed = InboundEnvelopeSchema.safeParse(loadFixture('invalid-trace-id-not-uuid.json'));
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const issue = parsed.error.issues.find((i) => i.path.join('.') === 'trace_id');
      expect(issue).toBeDefined();
    }
  });

  it('rejects metadata values that are not string, number, or boolean', () => {
    const parsed = InboundEnvelopeSchema.safeParse(loadFixture('invalid-metadata-wrong-value-type.json'));
    expect(parsed.success).toBe(false);
  });

  it('rejects an audio_reference missing provider_file_id', () => {
    const parsed = InboundEnvelopeSchema.safeParse(loadFixture('invalid-audio-missing-provider-file-id.json'));
    expect(parsed.success).toBe(false);
  });
});

describe('canonical inbound envelope — audio contract', () => {
  it('accepts an audio envelope with full audio_reference', () => {
    const parsed = InboundEnvelopeSchema.safeParse(loadFixture('valid-audio.json'));
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.message.type).toBe('audio');
      expect(parsed.data.message.audio_reference?.transcription_status).toBe('ok');
    }
  });

  it('accepts an audio envelope with a failed transcription and a marker text', () => {
    const parsed = InboundEnvelopeSchema.safeParse(loadFixture('valid-audio-failed-transcription.json'));
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.message.audio_reference?.transcription_status).toBe('failed');
      expect(parsed.data.message.text).toBe('[audio_no_transcrito]');
    }
  });

  it('never permits a URL field in AudioReference (only opaque provider_file_id)', () => {
    const obj = loadFixture('valid-audio.json') as unknown;
    (obj as unknown as {message: {audio_reference: Record<string, string | number>}}).message.audio_reference.url = 'https://api.telegram.org/file/bot123/audio.ogg';
    const parsed = InboundEnvelopeSchema.safeParse(obj);
    expect(parsed.success).toBe(false);
  });
});

describe('canonical inbound envelope — metadata contract', () => {
  it('defaults metadata to an empty object when omitted', () => {
    const withoutMetadata = loadFixture('valid-text.json') as unknown;
    delete (withoutMetadata as unknown as {message: {metadata: unknown}}).message.metadata;
    const parsed = InboundEnvelopeSchema.safeParse(withoutMetadata);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.message.metadata).toEqual({});
    }
  });

  it('accepts string, number and boolean metadata values', () => {
    const envelope = loadFixture('valid-text.json') as unknown;
    (envelope as unknown as {message: {metadata: unknown}}).message.metadata = { source: 'web', retries: 3, urgent: true };
    const parsed = InboundEnvelopeSchema.safeParse(envelope);
    expect(parsed.success).toBe(true);
  });

  it('rejects a metadata key longer than 64 characters', () => {
    const envelope = loadFixture('valid-text.json') as unknown;
    (envelope as unknown as {message: {metadata: unknown}}).message.metadata = { ['x'.repeat(65)]: 'y' };
    const parsed = InboundEnvelopeSchema.safeParse(envelope);
    expect(parsed.success).toBe(false);
  });

  it('rejects a metadata string value longer than 512 characters', () => {
    const envelope = loadFixture('valid-text.json') as unknown;
    (envelope as unknown as {message: {metadata: unknown}}).message.metadata = { big: 'x'.repeat(513) };
    const parsed = InboundEnvelopeSchema.safeParse(envelope);
    expect(parsed.success).toBe(false);
  });
});
