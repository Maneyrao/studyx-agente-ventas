#!/usr/bin/env node
/**
 * Projects the 28 official StudyX programme PDFs into small, retrieval-safe
 * knowledge_sources. The extracted text is committed so production seeding
 * never depends on the website or a PDF parser being available.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WORKSPACE_ID = 'b0000000-0000-4000-8000-000000000001';
const MAX_BODY_CHARS = 850;

export const COURSE_NAMES = {
  'asistente-cuidador-adultos-mayores': 'Asistente y Cuidador de Adultos Mayores',
  'auxiliar-de-farmacia': 'Auxiliar de Farmacia en Estados Unidos',
  barista: 'Barista',
  'curso-de-electricista': 'Curso de Electricista',
  'decoracion-interiores': 'Decoración de Interiores',
  'diseno-grafico-con-ilustrator': 'Diseño Gráfico con Illustrator',
  'diseno-grafico-en-coreldraw': 'Diseño Gráfico con CorelDraw',
  'diseno-grafico-en-photoshop': 'Diseño Gráfico con Photoshop',
  'energia-solar-fotovoltaica': 'Energía Solar Fotovoltaica',
  'entrenamiento-funcional': 'Entrenamiento Funcional',
  'estudios-biblicos-para-la-vida-diaria': 'Estudios Bíblicos para la Vida Diaria',
  'fotografia-profesional': 'Fotografía Profesional',
  'home-maintenance': 'Home Maintenance',
  'introduccion-a-la-pasteleria-reposteria': 'Introducción a la Pastelería y Repostería',
  'introduccion-al-vino-la-cata-y-el-maridaje': 'Introducción al Vino, la Cata y el Maridaje',
  'maquillaje-profesional': 'Maquillaje Profesional',
  'marketing-digital': 'Marketing Digital',
  masoterapia: 'Masoterapia',
  'nutricion-y-alimentacion-saludable': 'Nutrición y Alimentación Saludable',
  'organizador-profesional-de-eventos-sociales': 'Organizador Profesional de Eventos Sociales',
  'paisajismo-jardineria': 'Paisajismo y Jardinería',
  plomeria: 'Plomería',
  'publicidad-en-las-redes-sociales': 'Publicidad en las Redes Sociales',
  'real-estate': 'Real Estate',
  'sushi-para-principiantes': 'Sushi para Principiantes',
  'tecnica-o-en-depilacion-definitiva': 'Técnica/o en Depilación Definitiva',
  'tecnica-o-en-estetica-integral': 'Técnica/o en Estética Integral',
  'unas-gelificadas': 'Uñas Gelificadas',
};

export const OFFERING_CODES = {
  'asistente-cuidador-adultos-mayores': 'cuidador_adultos_mayores',
  barista: 'barista',
  'decoracion-interiores': 'decoracion_de_interiores',
  'diseno-grafico-con-ilustrator': 'diseno_illustrator',
  'diseno-grafico-en-coreldraw': 'diseno_corel_draw',
  'diseno-grafico-en-photoshop': 'diseno_photoshop',
  'energia-solar-fotovoltaica': 'energia_solar_fotovoltaica',
  'entrenamiento-funcional': 'entrenamiento_funcional',
  'fotografia-profesional': 'fotografia_profesional',
  'introduccion-al-vino-la-cata-y-el-maridaje': 'vino_cata_maridaje',
  'maquillaje-profesional': 'maquillaje_profesional',
  'marketing-digital': 'marketing_digital',
  masoterapia: 'masoterapia',
  'nutricion-y-alimentacion-saludable': 'nutricion_alimentacion',
  'organizador-profesional-de-eventos-sociales': 'organizador_eventos_sociales',
  'paisajismo-jardineria': 'paisajismo_jardineria',
  'publicidad-en-las-redes-sociales': 'publicidad_redes_sociales',
  'real-estate': 'real_estate',
  'auxiliar-de-farmacia': 'auxiliar_farmacia',
  'curso-de-electricista': 'electricista',
  'estudios-biblicos-para-la-vida-diaria': 'estudios_biblicos',
  'home-maintenance': 'home_maintenance',
  'introduccion-a-la-pasteleria-reposteria': 'introduccion_pasteleria_reposteria',
  plomeria: 'plomeria',
  'sushi-para-principiantes': 'sushi_principiantes',
  'tecnica-o-en-depilacion-definitiva': 'depilacion_definitiva',
  'tecnica-o-en-estetica-integral': 'estetica_integral',
  'unas-gelificadas': 'unas_gelificadas',
};

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function stableUuid(key) {
  const hex = createHash('sha256').update(key).digest('hex').slice(0, 32).split('');
  hex[12] = '4';
  hex[16] = ['8', '9', 'a', 'b'][Number.parseInt(hex[16], 16) % 4];
  return `${hex.slice(0, 8).join('')}-${hex.slice(8, 12).join('')}-${hex.slice(12, 16).join('')}-${hex.slice(16, 20).join('')}-${hex.slice(20).join('')}`;
}

function sanitizeCommercialText(text) {
  return text
    .replace(/\bUSD\b/gi, 'moneda informada en el catálogo comercial')
    .replace(/\bd[oó]lares\b/gi, 'dinero')
    .replace(/\bprecio[- ]calidad\b/gi, 'calidad y valor')
    .replace(/\$\s*[\d.,]+/g, '[importe omitido: consultar catálogo comercial]');
}

function isGenericStudyxPage(text) {
  const normalized = text.toLocaleLowerCase('es');
  return normalized.includes('studyx es la nueva tendencia en')
    && normalized.includes('miles de alumnos nos eligen');
}

export function splitPage(text, maxChars = MAX_BODY_CHARS) {
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  const chunks = [];
  let current = '';
  for (const line of lines) {
    if (line.length > maxChars) {
      if (current) chunks.push(current);
      current = '';
      for (let start = 0; start < line.length; start += maxChars) {
        chunks.push(line.slice(start, start + maxChars));
      }
      continue;
    }
    const candidate = current ? `${current}\n${line}` : line;
    if (candidate.length > maxChars) {
      chunks.push(current);
      current = line;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

export function buildSources(data) {
  if (data.program_count !== 28 || data.programs.length !== 28) {
    throw new Error(`PROGRAM_COVERAGE: expected 28 programmes, got ${data.programs.length}`);
  }
  const seen = new Set();
  const sources = [];
  for (const program of data.programs) {
    const courseName = COURSE_NAMES[program.slug];
    if (!courseName) throw new Error(`UNKNOWN_PROGRAMME:${program.slug}`);
    if (seen.has(program.slug)) throw new Error(`DUPLICATE_PROGRAMME:${program.slug}`);
    seen.add(program.slug);

    for (const page of program.pages) {
      // Most brochures use page 1 as a short cover, but the newer four-page
      // programmes start teaching content there. Length distinguishes those
      // real pages without maintaining a fragile filename whitelist.
      if ((page.page === 1 && page.text.length < 300) || isGenericStudyxPage(page.text)) continue;
      const pageChunks = splitPage(sanitizeCommercialText(page.text));
      pageChunks.forEach((body, index) => {
        const part = index + 1;
        const title = `Programa — ${courseName} — página ${page.page} — parte ${part}`;
        const content = [
          `Curso: ${courseName}.`,
          `Fuente oficial: programa StudyX, página ${page.page} de ${program.page_count}.`,
          body,
          `Programa completo: ${program.catalog_url}`,
        ].join('\n');
        const metadata = {
          source: 'official_program_pdf',
          course_slug: program.slug,
          offering_code: OFFERING_CODES[program.slug] ?? null,
          catalog_url: program.catalog_url,
          pdf_sha256: program.sha256,
          source_page: page.page,
          source_part: part,
          extracted_at: data.extracted_at,
        };
        sources.push({
          id: stableUuid(`studyx-program:${program.slug}:${page.page}:${part}`),
          title,
          content,
          metadata,
        });
      });
    }
  }
  return sources;
}

export function generateSql(data) {
  const sources = buildSources(data);
  const rows = sources.map((source) => [
    `(${sqlString(source.id)},${sqlString(WORKSPACE_ID)},'offering',`,
    ` ${sqlString(source.title)},`,
    ` ${sqlString(source.content)},`,
    ` 'active',1,${sqlString(JSON.stringify(source.metadata))}::jsonb)`,
  ].join('\n'));

  return `-- GENERADO POR scripts/generate-studyx-programs-seed.mjs — NO EDITAR A MANO.\n` +
`-- 28 programas oficiales extraídos el ${data.extracted_at}. Sin precios: la verdad comercial vive en offerings.\n\n` +
`-- Aplicar después de supabase/seed/studyx.sql, que crea el workspace StudyX.\n` +
`-- Después, drenar knowledge_projection_jobs y verificar 28 cursos indexados.\n\n` +
`BEGIN;\nSET search_path TO public;\n\n` +
`INSERT INTO knowledge_sources (id, workspace_id, source_type, title, content, status, version, metadata) VALUES\n` +
`${rows.join(',\n')}\n` +
`ON CONFLICT (workspace_id, title, version) DO UPDATE SET\n` +
`  source_type = EXCLUDED.source_type, content = EXCLUDED.content,\n` +
`  status = EXCLUDED.status, metadata = EXCLUDED.metadata, updated_at = now();\n\n` +
`-- No archivar todavía las 14 fichas parciales. knowledge_sources es canónico,\n` +
`-- pero las fuentes nuevas sólo quedan disponibles después de que el worker\n` +
`-- complete sus embeddings. El cutover se hace tras verificar la cola.\n\n` +
`COMMIT;\n`;
}

function main() {
  const dataPath = join(ROOT, 'supabase/seed/data/programas-studyx-pdf.json');
  const outputPath = join(ROOT, 'supabase/seed/studyx-programas.sql');
  const data = JSON.parse(readFileSync(dataPath, 'utf8'));
  const sources = buildSources(data);
  writeFileSync(outputPath, generateSql(data));
  console.log(`${data.programs.length} programas / ${sources.length} fuentes → ${outputPath}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
