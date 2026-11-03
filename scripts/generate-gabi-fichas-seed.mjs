#!/usr/bin/env node
/**
 * Generates supabase/seed/data/fichas-gabi-2026-11-03.json from Gabi's manual
 * (docs/authority/material-gabi-2026-11-03/) and its index CSV.
 *
 * The ficha of a course reaches the model as an authorized catalog fact, so
 * this script exits non-zero (it never warns) when any extracted text carries
 * a list price, a currency amount or the scholarship: "699", "beca", "$", "USD".
 * Those belong to the manual's pricing and closing chapters, which are never
 * parsed here. Mirrors scripts/generate-temarios-seed.mjs.
 *
 * Mapping manual name -> catalog offering code is explicit below. A manual
 * course with no code is listed under `unmapped` and is never activated;
 * the runtime also projects a ficha only for an ACTIVE offering.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MANUAL_PATH = 'docs/authority/material-gabi-2026-11-03/Manual_Capacitacion_Studyx_2026.txt';
const INDEX_PATH = 'docs/authority/material-gabi-2026-11-03/indice_para_el_agente.csv';
const OUTPUT_PATH = 'supabase/seed/data/fichas-gabi-2026-11-03.json';

/** The same hard stop the temarios generator applies: no price, no scholarship. */
export const FORBIDDEN_PATTERNS = [/\b699\b/, /beca/i, /\$/, /\bUSD\b/i];

/** Manual name (as printed, without the NUEVO badge) -> catalog offering code, or null. */
export const OFFERING_CODE_BY_MANUAL_NAME = Object.freeze({
  'Introducción al Vino, la Cata y el Maridaje': 'vino_cata_maridaje',
  'Introducción al Catering': 'introduccion_catering',
  'Sushi para Principiantes': 'sushi_principiantes',
  'Introducción a la Pastelería y Repostería': null,
  'Barista': 'barista',
  'Entrenamiento Funcional': 'entrenamiento_funcional',
  'Nutrición y Alimentación Saludable': 'nutricion_alimentacion',
  'Masoterapia': 'masoterapia',
  'Asistente y Cuidador de Adultos Mayores': 'cuidador_adultos_mayores',
  'Auxiliar de Farmacia': null,
  'Auxiliar de Educación Especial': null,
  'Marketing Digital': 'marketing_digital',
  'Community Manager': 'community_manager',
  'Especialista en Marketing': 'especialista_marketing',
  'Introducción al E-commerce': 'introduccion_ecommerce',
  'Fotografía con Celulares para Tiendas Online': 'fotografia_celulares_tiendas_online',
  'Influencers y Creadores de Contenidos': 'influencers_creadores_contenidos',
  'Publicidad en Redes Sociales': 'publicidad_redes_sociales',
  'Maquillaje Profesional': 'maquillaje_profesional',
  'Uñas Gelificadas': 'unas_gelificadas',
  'Técnico/a en Estética Integral': 'estetica_integral',
  'Técnico/a en Depilación Definitiva': 'depilacion_definitiva',
  'Instalación y Configuración de Cámaras de Seguridad': 'camaras_seguridad',
  'Instalación de Aires Acondicionados': 'aires_acondicionados',
  'Energía Solar Fotovoltaica (Paneles Solares)': 'energia_solar_fotovoltaica',
  'Armado y Reparación de PC': 'armado_reparacion_pc',
  'Reparación de Celulares': 'reparacion_celulares',
  'Redes Informáticas': 'redes_informaticas',
  'Curso de Electricista': null,
  'Estudios Bíblicos para la Vida Diaria': null,
  'Real Estate': null,
  'Decoración de Interiores': 'decoracion_de_interiores',
  'Fotografía Profesional': 'fotografia_profesional',
  'Organizador Profesional de Eventos Sociales': 'organizador_eventos_sociales',
  'Organización de Baby Showers': 'organizacion_baby_shower',
  'Estrategias para Emprender': 'estrategias_emprender',
  'Diseño de Vidrieras y Stand': null,
  'Instagram para Emprendedores': 'instagram_emprendedores',
  'Plomería': null,
  'Home Maintenance': null,
  'Paisajismo y Jardinería': 'paisajismo_jardineria',
  'Diseño Gráfico con CorelDRAW': 'diseno_corel_draw',
  'Diseño Gráfico con Photoshop': 'diseno_photoshop',
  'Diseño Gráfico con Illustrator': 'diseno_illustrator',
  'AutoCAD (orientado al Diseño de Interiores)': 'autocad_interiores',
  'Excel Integral': 'excel_integral',
  'Especialista en Ventas': 'especialista_ventas',
  'Coaching y Liderazgo': 'coaching_liderazgo',
  'Comunicación Interna en Empresas': 'comunicacion_interna_empresas',
  'Introducción a las Criptomonedas': 'introduccion_criptomonedas',
  'Word': null,
  'Oratoria': 'oratoria',
  'Inglés I (Básico)': 'ingles_1',
  'Inglés II (Intermedio)': 'ingles_2',
  'Inglés III': 'ingles_3',
  'Inglés IV': null,
  'Ceremonial y Protocolo': null,
});

const clean = (value) => value.replace(/\s+/gu, ' ').trim();

function parseCsvLine(line) {
  const cells = [];
  let cell = '';
  let quoted = false;
  for (const char of line) {
    if (char === '"') quoted = !quoted;
    else if (char === ',' && !quoted) { cells.push(cell); cell = ''; } else cell += char;
  }
  cells.push(cell);
  return cells;
}

/** Splits on commas that are not inside parentheses. */
function splitList(text) {
  const items = [];
  let depth = 0;
  let current = '';
  for (const char of text.replace(/\.\s*$/u, '')) {
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (char === ',' && depth === 0) { items.push(current); current = ''; } else current += char;
  }
  items.push(current);
  return items.map(clean).filter(Boolean);
}

export function parseManual(text) {
  const lines = text.split(/\r?\n/u);
  const start = lines.findIndex((line, index) => /^Academia /u.test(line) && /^\d+ diplomados ·/u.test(lines[index + 1] ?? ''));
  const end = lines.findIndex((line) => line.startsWith('No vendemos un curso'));
  if (start < 0 || end < 0) throw new Error('MANUAL_CATALOG_SECTION_NOT_FOUND');
  const catalog = lines.slice(start, end);

  const courses = [];
  let academia = null;
  for (let index = 0; index < catalog.length; index += 1) {
    const line = catalog[index];
    if (/^\d+ diplomados ·/u.test(catalog[index + 1] ?? '') && /^Academia /u.test(line)) { academia = line.trim(); continue; }
    if (!/^Clases: /u.test(catalog[index + 1] ?? '')) continue;
    const badges = line.match(/\s{2,}(NUEVO|·|NO PUBLICADO EN LA WEB)(.*)$/u);
    const manualName = clean(badges ? line.slice(0, badges.index) : line);
    const clasesLine = catalog[index + 1];
    const clasesMatch = clasesLine.match(/^Clases: (.*?)\s{2,}Evaluación: (.*)$/u);
    if (!clasesMatch) throw new Error(`MANUAL_CLASSES_LINE:${manualName}`);
    const body = [];
    let cursor = index + 2;
    while (cursor < catalog.length && !/^Lo más importante que verá:/u.test(catalog[cursor])) { body.push(catalog[cursor]); cursor += 1; }
    const highlights = [];
    cursor += 1;
    while (cursor < catalog.length && /^\s*•/u.test(catalog[cursor])) { highlights.push(clean(catalog[cursor].replace(/^\s*•/u, ''))); cursor += 1; }
    if (catalog[cursor] !== 'CLIENTE IDEAL') throw new Error(`MANUAL_IDEAL_CUSTOMER:${manualName}`);
    const ideal = clean(catalog[cursor + 1]);
    if (catalog[cursor + 2] !== 'COMBINALO CON') throw new Error(`MANUAL_COMBINE_WITH:${manualName}`);
    const combine = clean(catalog[cursor + 3]);
    const clasesNumber = clasesMatch[1].match(/^(\d+) clases?$/u);
    courses.push({
      manual_name: manualName,
      academia,
      clases: clasesNumber ? Number(clasesNumber[1]) : null,
      clases_a_confirmar: !clasesNumber,
      evaluacion: clasesMatch[2].startsWith('A confirmar') ? null : clean(clasesMatch[2]),
      descripcion: clean(body.join(' ')),
      lo_mas_importante: highlights,
      cliente_ideal: ideal,
      combinalo_con: splitList(combine),
      nuevo: Boolean(badges && /NUEVO/u.test(line)),
      publicado_en_web: !/NO PUBLICADO EN LA WEB/u.test(line),
    });
  }
  return courses;
}

export function parseRoutes(text) {
  const lines = text.split(/\r?\n/u);
  const header = lines.findIndex((line, index) => line === 'Ruta' && lines[index + 1] === 'Diplomados' && lines[index + 3] === 'Argumento de venta');
  const end = lines.findIndex((line) => line.startsWith('Los comodines'));
  if (header < 0 || end < 0) throw new Error('MANUAL_ROUTES_SECTION_NOT_FOUND');
  const rows = lines.slice(header + 4, end).map(clean).filter(Boolean);
  if (rows.length % 4 !== 0) throw new Error(`MANUAL_ROUTES_ROWS:${rows.length}`);
  const routes = [];
  for (let index = 0; index < rows.length; index += 4) {
    const [name, courseList, forWhom, argument] = rows.slice(index, index + 4);
    routes.push({
      name,
      // "(+ X)" marks an optional extra; keep it in the route but as a plain member.
      manual_courses: courseList.replace(/\(\+\s*/gu, '+ ').replace(/\)/gu, '').split('+').map(clean).filter(Boolean),
      para_quien: forWhom,
      argumento: argument,
    });
  }
  return routes;
}

/** Resolves a manual course label from a route, tolerating the shorter spellings it uses. */
const ROUTE_NAME_ALIASES = Object.freeze({
  'Pastelería y Repostería': 'Introducción a la Pastelería y Repostería',
  'Catering': 'Introducción al Catering',
  'Sushi para Principiantes': 'Sushi para Principiantes',
  'Vino, Cata y Maridaje': 'Introducción al Vino, la Cata y el Maridaje',
  'Organizador Profesional de Eventos': 'Organizador Profesional de Eventos Sociales',
  'Organización de Baby Showers': 'Organización de Baby Showers',
  'Estética Integral': 'Técnico/a en Estética Integral',
  'Depilación Definitiva': 'Técnico/a en Depilación Definitiva',
  'Técnico/a en Estética Integral': 'Técnico/a en Estética Integral',
  'Maquillaje Profesional': 'Maquillaje Profesional',
  'Nutrición y Alimentación Saludable': 'Nutrición y Alimentación Saludable',
  'Cámaras de Seguridad': 'Instalación y Configuración de Cámaras de Seguridad',
  'Aires Acondicionados': 'Instalación de Aires Acondicionados',
  'Energía Solar Fotovoltaica': 'Energía Solar Fotovoltaica (Paneles Solares)',
  'Influencers y Creadores de Contenidos': 'Influencers y Creadores de Contenidos',
  'Introducción al E-commerce': 'Introducción al E-commerce',
  'Photoshop': 'Diseño Gráfico con Photoshop',
  'Illustrator': 'Diseño Gráfico con Illustrator',
  'CorelDRAW': 'Diseño Gráfico con CorelDRAW',
  'AutoCAD': 'AutoCAD (orientado al Diseño de Interiores)',
  'Inglés': null,
  'Inglés I': 'Inglés I (Básico)',
  'Inglés II': 'Inglés II (Intermedio)',
  'Inglés III': 'Inglés III',
  'Inglés IV': 'Inglés IV',
  // "Inglés I + II + III + IV" splits into bare numerals.
  'II': 'Inglés II (Intermedio)',
  'III': 'Inglés III',
  'IV': 'Inglés IV',
  'Fotografía con Celulares': 'Fotografía con Celulares para Tiendas Online',
  'Paisajismo': 'Paisajismo y Jardinería',
  'Comunicación Interna': 'Comunicación Interna en Empresas',
});

function resolveRouteCourse(label) {
  if (Object.hasOwn(ROUTE_NAME_ALIASES, label)) return ROUTE_NAME_ALIASES[label];
  if (Object.hasOwn(OFFERING_CODE_BY_MANUAL_NAME, label)) return label;
  return undefined;
}

export function assertNoForbiddenText(value, where = 'fichas') {
  const stack = [[where, value]];
  while (stack.length) {
    const [path, item] = stack.pop();
    if (typeof item === 'string') {
      const hit = FORBIDDEN_PATTERNS.find((pattern) => pattern.test(item));
      if (hit) throw new Error(`FICHA_FORBIDDEN_TEXT:${path}:${hit}`);
    } else if (Array.isArray(item)) item.forEach((entry, index) => stack.push([`${path}[${index}]`, entry]));
    else if (item && typeof item === 'object') for (const [key, entry] of Object.entries(item)) stack.push([`${path}.${key}`, entry]);
  }
}

export function buildFichas(manualText, indexText) {
  const parsed = parseManual(manualText);
  const indexRows = indexText.replace(/^﻿/u, '').split(/\r?\n/u).slice(1).filter(Boolean).map(parseCsvLine)
    .filter(([name]) => !name.startsWith('(General)'));
  const manualNames = parsed.map((course) => course.manual_name);
  const missingFromIndex = manualNames.filter((name) => !indexRows.some(([indexName]) => clean(indexName).startsWith(name.split(' (')[0])));
  if (indexRows.length !== parsed.length || missingFromIndex.length) {
    throw new Error(`MANUAL_INDEX_MISMATCH:${parsed.length}:${indexRows.length}:${missingFromIndex.join('|')}`);
  }
  for (const course of parsed) {
    if (!Object.hasOwn(OFFERING_CODE_BY_MANUAL_NAME, course.manual_name)) throw new Error(`MANUAL_NAME_NOT_MAPPED:${course.manual_name}`);
  }
  const courses = parsed.map((course) => ({ ...course, offering_code: OFFERING_CODE_BY_MANUAL_NAME[course.manual_name] }));
  const routes = parseRoutes(manualText).map((route) => {
    const members = route.manual_courses.map((label) => ({ label, manual_name: resolveRouteCourse(label) }));
    const unknown = members.filter((member) => member.manual_name === undefined);
    if (unknown.length) throw new Error(`ROUTE_COURSE_NOT_RESOLVED:${route.name}:${unknown.map((member) => member.label).join('|')}`);
    return {
      name: route.name,
      courses: members.filter((member) => member.manual_name).map((member) => ({
        manual_name: member.manual_name,
        offering_code: OFFERING_CODE_BY_MANUAL_NAME[member.manual_name],
      })),
      para_quien: route.para_quien,
      argumento: route.argumento,
    };
  });
  const result = {
    source: MANUAL_PATH,
    index: INDEX_PATH,
    generated_by: 'scripts/generate-gabi-fichas-seed.mjs',
    note: 'Authorized catalog facts. Projected only for ACTIVE offerings; never carries price, scholarship or amounts.',
    unmapped: courses.filter((course) => course.offering_code === null).map((course) => course.manual_name),
    courses,
    routes,
  };
  assertNoForbiddenText(result);
  return result;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const result = buildFichas(
    readFileSync(join(ROOT, MANUAL_PATH), 'utf8'),
    readFileSync(join(ROOT, INDEX_PATH), 'utf8'),
  );
  writeFileSync(join(ROOT, OUTPUT_PATH), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  console.log(`fichas: ${result.courses.length} courses, ${result.routes.length} routes, ${result.unmapped.length} unmapped`);
  console.log(`unmapped: ${result.unmapped.join(' | ')}`);
}
