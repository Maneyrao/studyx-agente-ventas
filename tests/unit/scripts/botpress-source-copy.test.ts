import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The *.source.json files are non-executable literal copies of the TypeScript sources.
// They must be regenerated whenever the source changes (same shape: format/executable/generated_from/purpose/source).
describe.each([
  'botpress-agent/src/workflows/processInboundTurn.source.json',
  'botpress-agent/src/channels/telegram.channel.source.json',
])('literal source copy %s', (copyPath) => {
  const copy = JSON.parse(readFileSync(copyPath, 'utf8')) as {
    format: string; executable: boolean; generated_from: string; purpose: string; source: string;
  };
  it('has the agreed shape and is not executable', () => {
    expect(Object.keys(copy)).toEqual(['format', 'executable', 'generated_from', 'purpose', 'source']);
    expect(copy.format).toBe('source-copy');
    expect(copy.executable).toBe(false);
  });
  it('is byte-for-byte the current source', () => {
    expect(copy.source).toBe(readFileSync(copy.generated_from, 'utf8'));
  });
});
