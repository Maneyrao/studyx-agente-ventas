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
 */
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function registryRows() {
  const text = readFileSync(join(ROOT, 'src/shared/catalog/course-material.generated.ts'), 'utf8');
  return [...text.matchAll(/^  \[(.+)\],$/gmu)].map(match => [...match[1].matchAll(/'((?:[^'\\]|\\.)*)'|null/gu)].map(token => (token[1] === undefined ? null : token[1].replace(/\\'/gu, "'"))));
}

export function stageCourseMaterial(targetDir, imagesDir) {
  if (!targetDir || !imagesDir) throw new Error('USAGE: stage-course-programs.mjs <targetDir> <programsDir> <imagesDir|STUDYX_MATERIAL_IMAGES_DIR>');
  const imageOut = join(resolve(targetDir), 'public', 'material', 'imagenes');
  const fichaOut = join(resolve(targetDir), 'public', 'material', 'fichas');
  mkdirSync(imageOut, { recursive: true });
  mkdirSync(fichaOut, { recursive: true });
  const problems = [];
  let staged = 0;
  for (const [code, , imageFile, imageSha, fichaFile, fichaSha] of registryRows()) {
    const image = join(resolve(imagesDir), imageFile);
    const ficha = join(ROOT, 'docs/authority/material-gabi-2026-11-03/fichas_pdf', fichaFile);
    for (const [source, sha, target, tag] of [[image, imageSha, join(imageOut, `${code}.png`), 'IMAGE'], [ficha, fichaSha, join(fichaOut, `${code}.pdf`), 'FICHA']]) {
      if (!existsSync(source)) { problems.push(`MISSING_${tag}:${code}`); continue; }
      if (createHash('sha256').update(readFileSync(source)).digest('hex') !== sha) { problems.push(`SHA256_MISMATCH_${tag}:${code}`); continue; }
      copyFileSync(source, target);
      staged += 1;
    }
  }
  if (problems.length) throw new Error(`STAGING_FAILED:${problems.join(',')}`);
  return staged;
}

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
    const material = stageCourseMaterial(process.argv[2], process.argv[4] ?? process.env.STUDYX_MATERIAL_IMAGES_DIR);
    console.log(`staged ${count} programmes, ${material} material files (images + fichas)`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'FAILED');
    process.exitCode = 1;
  }
}
