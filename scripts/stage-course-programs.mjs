#!/usr/bin/env node
/**
 * Copies the official programme PDFs into <targetDir>/public/programas/<slug>.pdf
 * for a deploy, verifying each sha256 against supabase/seed/data/programas-studyx-pdf.json.
 * The PDFs are not in git. Fails on any missing file or hash mismatch.
 *
 *   node scripts/stage-course-programs.mjs <targetDir> [sourceDir]
 *   sourceDir defaults to STUDYX_PROGRAMS_SOURCE_DIR.
 */
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export function stageCoursePrograms(targetDir, sourceDir) {
  if (!targetDir || !sourceDir) throw new Error('USAGE: stage-course-programs.mjs <targetDir> <sourceDir|STUDYX_PROGRAMS_SOURCE_DIR>');
  const data = JSON.parse(readFileSync(join(ROOT, 'supabase/seed/data/programas-studyx-pdf.json'), 'utf8'));
  const outDir = join(resolve(targetDir), 'public', 'programas');
  mkdirSync(outDir, { recursive: true });
  const problems = [];
  let staged = 0;
  for (const program of data.programs) {
    const source = join(resolve(sourceDir), `${program.slug}.pdf`);
    if (!existsSync(source)) { problems.push(`MISSING:${program.slug}`); continue; }
    const sha = createHash('sha256').update(readFileSync(source)).digest('hex');
    if (sha !== program.sha256) { problems.push(`SHA256_MISMATCH:${program.slug}`); continue; }
    copyFileSync(source, join(outDir, `${program.slug}.pdf`));
    staged += 1;
  }
  if (problems.length) throw new Error(`STAGING_FAILED:${problems.join(',')}`);
  return staged;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    const count = stageCoursePrograms(process.argv[2], process.argv[3] ?? process.env.STUDYX_PROGRAMS_SOURCE_DIR);
    console.log(`staged ${count} programmes`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'FAILED');
    process.exitCode = 1;
  }
}
