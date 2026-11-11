import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sources(path) : /\.(ts|tsx)$/u.test(name) ? [path] : [];
  });
}

describe('advisory locks under transaction pooling', () => {
  it('uses only transaction-level advisory locks and never reserves a session connection', () => {
    const offenders = sources(join(process.cwd(), 'src')).filter(path => {
      const text = readFileSync(path, 'utf8');
      return /pg_advisory_lock\b|pg_advisory_unlock|pg_try_advisory_lock\b|\.reserve\(\)/u.test(text);
    });
    expect(offenders).toEqual([]);
  });
});
