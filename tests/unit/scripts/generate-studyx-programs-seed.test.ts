import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  COURSE_NAMES,
  buildSources,
  generateSql,
  splitPage,
} from '../../../scripts/generate-studyx-programs-seed.mjs';

const root = join(import.meta.dirname, '../../..');
const data = JSON.parse(
  readFileSync(join(root, 'supabase/seed/data/programas-studyx-pdf.json'), 'utf8'),
);

describe('StudyX official programme knowledge seed', () => {
  it('covers all 28 programmes exactly once', () => {
    expect(data.program_count).toBe(28);
    expect(data.programs).toHaveLength(28);
    expect(new Set(data.programs.map((program: { slug: string }) => program.slug)).size).toBe(28);
    expect(Object.keys(COURSE_NAMES)).toHaveLength(28);
    const names: Record<string, string> = COURSE_NAMES;
    for (const program of data.programs as Array<{ slug: string }>) {
      expect(names[program.slug]).toBeTruthy();
    }
  });

  it('creates bounded, attributable retrieval sources for every programme', () => {
    const sources = buildSources(data);
    const covered = new Set(sources.map((source) => source.metadata.course_slug));
    expect(covered.size).toBe(28);
    expect(sources.length).toBeGreaterThan(100);
    for (const source of sources) {
      expect(source.content.length).toBeLessThanOrEqual(1_200);
      expect(source.content).toContain('Fuente oficial: programa StudyX');
      expect(source.content).toContain('Programa completo: https://mystudyx.com/diplomado/');
      expect(source.content).not.toMatch(/\$\s*[\d.,]+|\bUSD\b|\bd[oó]lares\b/i);
    }
  });

  it('keeps substantive first pages from the newer short programmes', () => {
    const sources = buildSources(data);
    for (const slug of [
      'auxiliar-de-farmacia',
      'curso-de-electricista',
      'home-maintenance',
      'plomeria',
      'real-estate',
    ]) {
      expect(sources.some((source) =>
        source.metadata.course_slug === slug && source.metadata.source_page === 1
      )).toBe(true);
    }
  });

  it('chunks long pages without losing their text', () => {
    const text = `${'a'.repeat(700)}\n${'b'.repeat(700)}`;
    const chunks = splitPage(text, 850);
    expect(chunks).toHaveLength(2);
    expect(chunks.join('\n')).toBe(text);
  });

  it('generates idempotent SQL without removing the currently indexed syllabi', () => {
    const sql = generateSql(data);
    expect(sql).toContain('ON CONFLICT (workspace_id, title, version) DO UPDATE');
    expect(sql).not.toContain("title LIKE 'Temario — %'");
    expect(sql).not.toContain("SET status = 'archived'");
  });

  it('wires the generated programmes into the canonical database seed entrypoint', () => {
    const seedEntrypoint = readFileSync(join(root, 'supabase/seed.sql'), 'utf8');
    expect(seedEntrypoint).toContain('\\ir seed/studyx-programas.sql');
  });
});
