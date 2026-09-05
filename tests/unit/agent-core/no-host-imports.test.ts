import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return tsFiles(full);
    return full.endsWith('.ts') ? [full] : [];
  });
}

describe('agent-core isolation', () => {
  it('never imports from the Botpress agent, the Next app or the database', () => {
    const offenders = tsFiles('agent-core/src').filter((file) => (
      /from\s+['"](?:@\/|.*botpress-agent\/|.*\/src\/lib\/db|postgres|next)/u.test(
        readFileSync(file, 'utf8'),
      )
    ));
    expect(offenders).toEqual([]);
  });
});
