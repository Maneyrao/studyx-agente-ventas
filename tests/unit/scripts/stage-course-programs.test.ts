import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { declaredMaterialPaths } from '../../../scripts/stage-course-programs.mjs';
import { COURSE_PROGRAM_ASSETS_V1 } from '../../../src/shared/catalog/course-programs';

const ROOT = join(__dirname, '../../..');

describe('course material staging at build time (owner 2026-11-09)', () => {
  it('declares exactly the 114 paths the backend serves: one PDF and one image per course', () => {
    const served = [...COURSE_PROGRAM_ASSETS_V1.values()].flatMap(asset => [asset.document.path, asset.image.path]);
    const declared: string[] = declaredMaterialPaths();
    expect(served).toHaveLength(114);
    expect(new Set(declared).size).toBe(114);
    expect([...declared].sort()).toEqual([...served].sort());
  });

  it('runs before every build and travels to the remote builder', () => {
    const scripts = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).scripts;
    expect(scripts.prebuild).toBe('node scripts/stage-course-programs.mjs --build');
    const vercelignore = readFileSync(join(ROOT, '.vercelignore'), 'utf8');
    expect(vercelignore).toContain('!scripts/stage-course-programs.mjs');
    expect(vercelignore).not.toMatch(/^public/mu);
  });
});
