#!/usr/bin/env node
/**
 * Copies the official programme PDFs into <targetDir>/public/programas/<slug>.pdf
 * for a deploy, verifying each sha256 against supabase/seed/data/programas-studyx-pdf.json.
 * The PDFs are not in git. Fails on any missing file or hash mismatch.
 *
 *   node scripts/stage-course-programs.mjs <targetDir> [sourceDir] [imagesDir]
 *   sourceDir defaults to STUDYX_PROGRAMS_SOURCE_DIR; imagesDir to STUDYX_MATERIAL_IMAGES_DIR.
 *
 * Since 2026-11-05 it also stages the course images (public/material/imagenes/<code>.png, from imagesDir) and the
 * manual ficha PDFs (public/material/fichas/<code>.pdf, from git), verifying the sha256 registered in
 * src/shared/catalog/course-material.generated.ts.
 *
 * Since 2026-11-09 it runs as the npm `prebuild` hook (`--build`): it stages into this checkout's public/ and the
 * build fails when any declared file is missing or altered. A file already in public/ with the registered
 * sha256 is kept, so a build without the source folders passes only when public/ was already staged.
 * Sources: STUDYX_PROGRAMS_SOURCE_DIR / STUDYX_MATERIAL_IMAGES_DIR, else the sibling folders of the main
 * checkout (`<parent>/programas-studyx`, `<parent>/studyx-material-whatsapp/imagenes`).
 */
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function registryRows() {
  const text = readFileSync(join(ROOT, 'src/shared/catalog/course-material.generated.ts'), 'utf8');
  return [...text.matchAll(/^  \[(.+)\],$/gmu)].map(match => [...match[1].matchAll(/'((?:[^'\\]|\\.)*)'|null/gu)].map(token => (token[1] === undefined ? null : token[1].replace(/\\'/gu, "'"))));
}

const sha256Of = path => createHash('sha256').update(readFileSync(path)).digest('hex');

/** Keeps a valid staged file; otherwise copies the source after checking its sha256. Returns a problem or null. */
function ensureStaged(source, sha, target, tag) {
  if (existsSync(target) && sha256Of(target) === sha) return null;
  const suffix = tag ? `_${tag}` : '';
  if (!source || !existsSync(source)) return `MISSING${suffix}`;
  if (sha256Of(source) !== sha) return `SHA256_MISMATCH${suffix}`;
  copyFileSync(source, target);
  return null;
}

export function stageCourseMaterial(targetDir, imagesDir) {
  if (!targetDir) throw new Error('USAGE: stage-course-programs.mjs <targetDir> <programsDir> <imagesDir|STUDYX_MATERIAL_IMAGES_DIR>');
  const imageOut = join(resolve(targetDir), 'public', 'material', 'imagenes');
  const fichaOut = join(resolve(targetDir), 'public', 'material', 'fichas');
  mkdirSync(imageOut, { recursive: true });
  mkdirSync(fichaOut, { recursive: true });
  const problems = [];
  let staged = 0;
  for (const [code, , imageFile, imageSha, fichaFile, fichaSha] of registryRows()) {
    const image = imagesDir ? join(resolve(imagesDir), imageFile) : null;
    const ficha = join(ROOT, 'docs/authority/material-gabi-2026-11-03/fichas_pdf', fichaFile);
    for (const [source, sha, target, tag] of [[image, imageSha, join(imageOut, `${code}.png`), 'IMAGE'], [ficha, fichaSha, join(fichaOut, `${code}.pdf`), 'FICHA']]) {
      const problem = ensureStaged(source, sha, target, tag);
      if (problem) problems.push(`${problem}:${code}`); else staged += 1;
    }
  }
  if (problems.length) throw new Error(`STAGING_FAILED:${problems.join(',')}`);
  return staged;
}

export function stageCoursePrograms(targetDir, sourceDir) {
  if (!targetDir) throw new Error('USAGE: stage-course-programs.mjs <targetDir> <sourceDir|STUDYX_PROGRAMS_SOURCE_DIR>');
  const data = JSON.parse(readFileSync(join(ROOT, 'supabase/seed/data/programas-studyx-pdf.json'), 'utf8'));
  const outDir = join(resolve(targetDir), 'public', 'programas');
  mkdirSync(outDir, { recursive: true });
  const problems = [];
  let staged = 0;
  for (const program of data.programs) {
    const source = sourceDir ? join(resolve(sourceDir), `${program.slug}.pdf`) : null;
    const problem = ensureStaged(source, program.sha256, join(outDir, `${program.slug}.pdf`), '');
    if (problem) problems.push(`${problem}:${program.slug}`); else staged += 1;
  }
  if (problems.length) throw new Error(`STAGING_FAILED:${problems.join(',')}`);
  return staged;
}

/** Folder that holds the main checkout (worktrees resolve to the main one); null outside git. */
function materialParentDir() {
  try {
    const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return dirname(dirname(common));
  } catch { return null; }
}

/** Every path the backend serves (src/shared/catalog/course-programs.ts): the PDF and the image of each course. */
export function declaredMaterialPaths() {
  return registryRows().flatMap(([code, , , , , , programSlug, programSha]) => [
    programSlug !== null && programSha !== null ? `programas/${programSlug}.pdf` : `material/fichas/${code}.pdf`,
    `material/imagenes/${code}.png`,
  ]);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    const build = process.argv[2] === '--build';
    const parent = build ? materialParentDir() : null;
    const target = build ? ROOT : process.argv[2];
    const programsDir = (build ? undefined : process.argv[3]) ?? process.env.STUDYX_PROGRAMS_SOURCE_DIR ?? (parent && join(parent, 'programas-studyx'));
    const imagesDir = (build ? undefined : process.argv[4]) ?? process.env.STUDYX_MATERIAL_IMAGES_DIR ?? (parent && join(parent, 'studyx-material-whatsapp', 'imagenes'));
    const count = stageCoursePrograms(target, programsDir);
    const material = stageCourseMaterial(target, imagesDir);
    const declared = declaredMaterialPaths();
    const absent = declared.filter(path => !existsSync(join(resolve(target), 'public', path)));
    if (absent.length) throw new Error(`STAGING_FAILED:DECLARED_PATH_ABSENT:${absent.join(',')}`);
    console.log(`staged ${count} programmes, ${material} material files (images + fichas); ${declared.length}/${declared.length} declared paths present`);
  } catch (error) {
    console.error(`COURSE_MATERIAL ${error instanceof Error ? error.message : 'FAILED'}`);
    process.exitCode = 1;
  }
}
