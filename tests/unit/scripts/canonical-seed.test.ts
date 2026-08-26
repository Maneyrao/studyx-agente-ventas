import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const seed = readFileSync(resolve(__dirname, '../../../supabase/seed.sql'), 'utf8');

describe('canonical local seed entrypoint', () => {
  it('loads fixtures before the StudyX base and the manual canonical overlay last', () => {
    const dev = seed.indexOf('\\ir seed/dev.sql');
    const base = seed.indexOf('\\ir seed/studyx.sql');
    const temarios = seed.indexOf('\\ir seed/studyx-temarios.sql');
    const manual = seed.indexOf('\\ir seed/studyx-manual.sql');

    expect(dev).toBeGreaterThanOrEqual(0);
    expect(base).toBeGreaterThan(dev);
    expect(temarios).toBeGreaterThan(base);
    expect(manual).toBeGreaterThan(temarios);
  });
});
