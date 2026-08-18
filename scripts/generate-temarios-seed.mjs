#!/usr/bin/env node
/**
 * Generates supabase/seed/studyx-temarios.sql from the extracted syllabus data
 * in supabase/seed/data/temarios-studyx.json.
 *
 * Why a generator instead of a hand-written seed: the 14 syllabi are ~25k
 * characters of authored text. Transcribing them by hand invites typos and
 * makes a re-extraction expensive; regenerating is one command.
 *
 * The price guard below is the reason this script exits non-zero rather than
 * warning: `offerings.metadata.beca_price_usd` (699) must never reach a
 * knowledge_source, because knowledge_sources project into knowledge_chunks
 * and come back inside the agent's prompt. The same rule is asserted from the
 * other side by BECA_LEAK_PATTERN in tests/integration/studyx-catalog.test.ts.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WORKSPACE_ID = 'b0000000-0000-4000-8000-000000000001';
/** Continues the b4000000-… block the hand-written seed uses for sources 1-9. */
const ID_PREFIX = 'b4000000-0000-4000-8000-0000000000';
const FIRST_ID = 0x10;

/** Any amount at all, not just 699: the agent quotes price from offerings, never from retrieval. */
const PRICE_PATTERNS = [/\$/, /\b699\b/, /\b1[.,]?200\b/, /\bUSD\b/i, /\bd[oó]lar/i, /\bprecio\b/i];

function sqlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function buildContent(course) {
  const lines = [`Temario publicado del diplomado "${course.nombre}" (fuente: mystudyx.com).`];

  const shape = [];
  if (course.clases_declaradas) shape.push(`${course.clases_declaradas} clases declaradas`);
  if (course.modulos) shape.push(`${course.modulos} módulos`);
  if (shape.length > 0) lines.push(`Estructura: ${shape.join(', ')}.`);

  if (course.objetivos) lines.push(`Objetivos: ${course.objetivos}`);

  lines.push(`Contenidos: ${course.temario.join(' | ')}`);

  // The count mismatches are real and published; the agent needs to know the
  // syllabus is partial so it offers the full programme instead of implying
  // this list is exhaustive.
  if (course.temario.length !== course.clases_declaradas) {
    lines.push(
      `Nota: la ficha declara ${course.clases_declaradas} clases y publica ${course.temario.length} ítems de temario. ` +
      'El listado publicado puede ser parcial: ante una consulta de detalle fino, ofrecer el programa completo por inscripciones.'
    );
  }

  return lines.join('\n');
}

const data = JSON.parse(readFileSync(join(ROOT, 'supabase/seed/data/temarios-studyx.json'), 'utf8'));

const rows = data.courses.map((course, index) => {
  const content = buildContent(course);

  for (const pattern of PRICE_PATTERNS) {
    if (pattern.test(content)) {
      throw new Error(
        `PRICE_LEAK: course "${course.nombre}" matched ${pattern}. ` +
        'knowledge_sources must never carry an amount — fix the source JSON.'
      );
    }
  }

  const id = ID_PREFIX + (FIRST_ID + index).toString(16).padStart(2, '0');
  const metadata = JSON.stringify({
    source: `mystudyx.com ${data.extracted_at}`,
    slug: course.slug_sitio,
    declared_classes: course.clases_declaradas,
    syllabus_item_count: course.temario.length,
  });

  return [
    `(${sqlString(id)},${sqlString(WORKSPACE_ID)},'offering',`,
    ` ${sqlString(`Temario — ${course.nombre}`)},`,
    ` ${sqlString(content)},`,
    ` 'active',1,${sqlString(metadata)}::jsonb)`,
  ].join('\n');
});

const sql = `-- GENERADO POR scripts/generate-temarios-seed.mjs — NO EDITAR A MANO.
-- Fuente: supabase/seed/data/temarios-studyx.json (extraído ${data.extracted_at}).
-- Regenerar: node scripts/generate-temarios-seed.mjs
--
-- Temarios de los ${rows.length} diplomados que publican contenido verificable en el
-- sitio. Complementa supabase/seed/studyx.sql, que siembra offerings y las 9
-- knowledge_sources de política. Sin importes: el precio vive en offerings y
-- llega al prompt por business_context, nunca por retrieval.

BEGIN;

-- El pooler de Supabase (modo transacción, :6543) no garantiza un search_path
-- con 'public': el mismo archivo corre en el cluster local y falla contra
-- producción con "relation knowledge_sources does not exist". Fijarlo acá es
-- lo que hace que este seed sea aplicable a las dos bases sin editarlo.
SET search_path TO public;

INSERT INTO knowledge_sources (id, workspace_id, source_type, title, content, status, version, metadata) VALUES
${rows.join(',\n')}
ON CONFLICT (workspace_id, title, version) DO UPDATE SET
  source_type = EXCLUDED.source_type, content = EXCLUDED.content,
  status = EXCLUDED.status, metadata = EXCLUDED.metadata, updated_at = now();

COMMIT;
`;

const outputPath = join(ROOT, 'supabase/seed/studyx-temarios.sql');
writeFileSync(outputPath, sql);
console.log(`${rows.length} temarios → ${outputPath}`);
