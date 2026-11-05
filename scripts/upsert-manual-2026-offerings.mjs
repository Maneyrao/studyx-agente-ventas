#!/usr/bin/env node
/**
 * Brings the shared catalog to the 57 courses of the 2026 manual (owner decision 2026-11-05):
 * upserts the 12 courses that did not exist and reactivates the 5 that were inactive (the 17 NUEVO),
 * all USD 360 (1 / 6x60 / 12x30), and links the official programme PDF knowledge sources.
 * It never deactivates anything: active offerings outside the manual are only reported.
 *
 * Offerings live only in the database. DRY-RUN by default; the target must be given explicitly and the
 * script never reads any .env file. Only the host is printed.
 *
 *   STUDYX_CATALOG_TARGET_URL=postgresql://... node scripts/upsert-manual-2026-offerings.mjs          # dry-run
 *   STUDYX_CATALOG_TARGET_URL=postgresql://... node scripts/upsert-manual-2026-offerings.mjs --apply  # writes
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import postgres from 'postgres';
import { OFFERING_CODES } from './generate-studyx-programs-seed.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const WORKSPACE_ID = 'b0000000-0000-4000-8000-000000000001';

/** The 12 manual courses that had no offering. Codes follow the existing snake_case convention. */
export const NEW_OFFERING_CODES = Object.freeze([
  'introduccion_pasteleria_reposteria', 'auxiliar_farmacia', 'auxiliar_educacion_especial', 'electricista',
  'estudios_biblicos', 'real_estate', 'diseno_vidrieras_stand', 'plomeria', 'home_maintenance', 'word',
  'ingles_4', 'ceremonial_protocolo',
]);
/** The 5 NUEVO courses that existed as inactive offerings. */
export const REACTIVATED_OFFERING_CODES = Object.freeze([
  'cuidador_adultos_mayores', 'barista', 'masoterapia', 'estetica_integral', 'depilacion_definitiva',
]);
/** Trades with a state license in the US: the guardrails say so explicitly. */
const LICENSED = new Set(['electricista', 'plomeria', 'auxiliar_farmacia', 'real_estate']);
const ALIASES = Object.freeze({
  introduccion_pasteleria_reposteria: ['pastelería', 'repostería', 'pasteleria', 'reposteria'],
  auxiliar_farmacia: ['farmacia', 'auxiliar de farmacia'],
  auxiliar_educacion_especial: ['educación especial', 'educacion especial'],
  electricista: ['electricista', 'electricidad'],
  estudios_biblicos: ['biblia', 'estudios bíblicos', 'estudios biblicos'],
  real_estate: ['real estate', 'bienes raíces', 'bienes raices', 'inmobiliaria'],
  diseno_vidrieras_stand: ['vidrieras', 'stand'],
  plomeria: ['plomería', 'plomero'],
  home_maintenance: ['mantenimiento del hogar', 'home maintenance'],
  word: ['word', 'microsoft word'],
  ingles_4: ['inglés 4', 'ingles 4', 'inglés iv', 'ingles iv'],
  ceremonial_protocolo: ['protocolo', 'ceremonial'],
});
const FORBIDDEN_PROMISES = [
  'certificación verificada', 'título oficial', 'homologación', 'matrícula profesional', 'salida laboral garantizada',
  'horarios de clases en vivo', 'política de devoluciones',
];

const fichas = JSON.parse(readFileSync(join(ROOT, 'supabase/seed/data/fichas-gabi-2026-11-03.json'), 'utf8'));
export const MANUAL_COURSES = Object.freeze(fichas.courses.map(course => ({
  code: course.offering_code, name: course.manual_name, academy: course.academia,
  classes: course.clases, classes_to_confirm: course.clases_a_confirmar === true, description: course.descripcion,
})));
export const MANUAL_CODES = Object.freeze(MANUAL_COURSES.map(course => course.code));
const MANUAL_SHA256 = createHash('sha256')
  .update(readFileSync(join(ROOT, 'docs/authority/material-gabi-2026-11-03/Manual_Capacitacion_Studyx_2026.pdf'))).digest('hex');
const PROGRAMS = JSON.parse(readFileSync(join(ROOT, 'supabase/seed/data/programas-studyx-pdf.json'), 'utf8')).programs;

const firstSentence = text => text.match(/^.*?[.!?](?:\s|$)/u)?.[0]?.trim() ?? text;

/** The exact row of one manual course. Shape copied from the manual seed (marketing_digital). */
export function buildOffering(code) {
  const course = MANUAL_COURSES.find(item => item.code === code);
  if (!course) throw new Error(`NOT_A_MANUAL_COURSE:${code}`);
  const program = PROGRAMS.find(item => OFFERING_CODES[item.slug] === code);
  const classes = course.classes_to_confirm ? null : course.classes;
  const description = `${course.academy}. ${classes === null ? '' : `${classes} clases. `}${firstSentence(course.description)}`.slice(0, 390).trim();
  const aliases = ALIASES[code];
  return {
    code, display_name: course.name, offering_type: 'course', status: 'active', description, value_proposition: null,
    price_type: 'fixed', price_amount: '360.00', currency: 'USD', billing_interval: 'custom',
    audience: { language: 'Spanish' },
    delivery: { modality: 'online', ...(classes === null ? {} : { classes }), source: 'Manual_Capacitacion_Studyx_2026.pdf' },
    guardrails: { never_invent_price: true,
      forbidden_promises: LICENSED.has(code) ? [...FORBIDDEN_PROMISES, 'licencia estatal'] : FORBIDDEN_PROMISES },
    metadata: {
      canonical_source: 'manual_2026', source_file: 'Manual_Capacitacion_Studyx_2026.pdf', source_sha256: MANUAL_SHA256,
      academy: course.academy, ...(aliases ? { aliases } : {}), ...(classes === null ? {} : { declared_classes: classes }),
      ...(program ? { program_pdf_sha256: program.sha256 } : {}),
      total_price_usd: 360, payment_options_owner_confirmed: true, price_source: 'owner-confirmed 2026-11-05',
    },
  };
}

export async function readCurrent(sql, codes = [...NEW_OFFERING_CODES, ...REACTIVATED_OFFERING_CODES]) {
  const [workspace] = await sql`SELECT id FROM workspaces WHERE id = ${WORKSPACE_ID}::uuid`;
  if (!workspace) throw new Error('WORKSPACE_NOT_FOUND');
  const rows = await sql`SELECT code, display_name, status, price_amount::text AS price_amount, currency, metadata
    FROM offerings WHERE workspace_id = ${WORKSPACE_ID}::uuid AND code = ANY(${codes})`;
  return new Map(rows.map(row => [row.code, row]));
}

/** Per course: create | activate | update | unchanged. */
export function planChanges(current) {
  return [...NEW_OFFERING_CODES, ...REACTIVATED_OFFERING_CODES].map(code => {
    const row = current.get(code);
    if (!row) return { code, action: 'create' };
    const priced = Number(row.price_amount) === 360 && row.currency === 'USD';
    const marked = row.metadata?.price_source === 'owner-confirmed 2026-11-05';
    if (row.status !== 'active') return { code, action: 'activate' };
    return { code, action: priced && marked ? 'unchanged' : 'update' };
  });
}

/** Programme PDF knowledge sources whose offering_code is not the registered one. */
export async function countUnlinkedProgramSources(sql) {
  const [row] = await sql`SELECT count(*)::int AS n FROM knowledge_sources ks
    WHERE ks.workspace_id = ${WORKSPACE_ID}::uuid AND ks.source_type = 'offering' AND ks.metadata->>'source' = 'official_program_pdf'
      AND ks.metadata->>'course_slug' = ANY(${Object.keys(OFFERING_CODES)})
      AND ks.metadata->>'offering_code' IS DISTINCT FROM (${sql.json(OFFERING_CODES)}::jsonb ->> (ks.metadata->>'course_slug'))`;
  return row.n;
}

/** Active offerings that are NOT one of the 57 manual courses (reported, never deactivated). */
export async function activeOutsideManual(sql) {
  const rows = await sql`SELECT code FROM offerings WHERE workspace_id = ${WORKSPACE_ID}::uuid AND status = 'active'
    AND offering_type = 'course' AND NOT (code = ANY(${MANUAL_CODES})) ORDER BY code`;
  return rows.map(row => row.code);
}

export async function activeManualCount(sql) {
  const [row] = await sql`SELECT count(*)::int AS n FROM offerings WHERE workspace_id = ${WORKSPACE_ID}::uuid
    AND status = 'active' AND offering_type = 'course' AND code = ANY(${MANUAL_CODES})`;
  return row.n;
}

export async function applyUpsert(sql) {
  // A caller already inside a transaction (tests) gets a savepoint.
  const transaction = typeof sql.begin === 'function' ? sql.begin.bind(sql) : sql.savepoint.bind(sql);
  return transaction(async (tx) => {
    const [workspace] = await tx`SELECT id FROM workspaces WHERE id = ${WORKSPACE_ID}::uuid FOR SHARE`;
    if (!workspace) throw new Error('WORKSPACE_NOT_FOUND');
    for (const code of [...NEW_OFFERING_CODES, ...REACTIVATED_OFFERING_CODES]) {
      const desired = buildOffering(code);
      const reactivated = REACTIVATED_OFFERING_CODES.includes(code);
      await tx`INSERT INTO offerings (id, workspace_id, code, display_name, offering_type, status, description, value_proposition,
          price_type, price_amount, currency, billing_interval, audience, delivery, guardrails, metadata)
        VALUES (gen_random_uuid(), ${WORKSPACE_ID}::uuid, ${desired.code}, ${desired.display_name}, ${desired.offering_type},
          ${desired.status}, ${desired.description}, ${desired.value_proposition}, ${desired.price_type},
          ${desired.price_amount}::numeric, ${desired.currency}, ${desired.billing_interval},
          ${tx.json(desired.audience)}, ${tx.json(desired.delivery)}, ${tx.json(desired.guardrails)}, ${tx.json(desired.metadata)})
        ON CONFLICT (workspace_id, code) DO UPDATE SET
          status = 'active', price_type = EXCLUDED.price_type, price_amount = EXCLUDED.price_amount, currency = EXCLUDED.currency,
          billing_interval = EXCLUDED.billing_interval,
          ${reactivated ? tx`` : tx`display_name = EXCLUDED.display_name, description = EXCLUDED.description,
          audience = EXCLUDED.audience, delivery = EXCLUDED.delivery, guardrails = EXCLUDED.guardrails,`}
          metadata = (offerings.metadata - 'deactivated_by_catalog_sync' - 'deactivated_at') || EXCLUDED.metadata,
          updated_at = now()`;
    }
    await tx`UPDATE knowledge_sources ks SET
        metadata = ks.metadata || jsonb_build_object('offering_code', (${tx.json(OFFERING_CODES)}::jsonb ->> (ks.metadata->>'course_slug'))),
        updated_at = now()
      WHERE ks.workspace_id = ${WORKSPACE_ID}::uuid AND ks.source_type = 'offering' AND ks.metadata->>'source' = 'official_program_pdf'
        AND ks.metadata->>'course_slug' = ANY(${Object.keys(OFFERING_CODES)})
        AND ks.metadata->>'offering_code' IS DISTINCT FROM (${tx.json(OFFERING_CODES)}::jsonb ->> (ks.metadata->>'course_slug'))`;
    return readCurrent(tx);
  });
}

/** host:port/db only; never the credentials. */
export function describeTarget(rawUrl) {
  const url = new URL(rawUrl);
  return `${url.hostname}:${url.port || '5432'}${url.pathname}`;
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const targetUrl = env.STUDYX_CATALOG_TARGET_URL;
  if (!targetUrl) {
    console.error('REFUSED: set STUDYX_CATALOG_TARGET_URL explicitly (this script never reads .env files).');
    return 2;
  }
  const apply = argv.includes('--apply');
  const unknown = argv.filter((arg) => arg !== '--apply');
  if (unknown.length) { console.error(`REFUSED: unknown arguments ${unknown.join(' ')}`); return 2; }
  const sql = postgres(targetUrl, { max: 1, onnotice: () => {} });
  try {
    console.log(`target: ${describeTarget(targetUrl)}  mode: ${apply ? 'APPLY' : 'dry-run'}`);
    const plan = planChanges(await readCurrent(sql));
    const unlinked = await countUnlinkedProgramSources(sql);
    for (const item of plan.filter(entry => entry.action !== 'unchanged')) console.log(`${item.code}: ${item.action}`);
    console.log(`programme sources to link: ${unlinked}`);
    const pending = plan.some(entry => entry.action !== 'unchanged') || unlinked > 0;
    if (apply && pending) await applyUpsert(sql);
    else if (!apply) console.log('dry-run: nothing written. Re-run with --apply to write.');
    console.log(`${pending ? (apply ? 'applied' : 'pending') : 'already up to date'}; manual courses active: ${await activeManualCount(sql)}/${MANUAL_CODES.length}`);
    const outside = await activeOutsideManual(sql);
    if (outside.length) console.log(`active offerings outside the manual (not touched): ${outside.join(', ')}`);
    return 0;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().then((code) => { process.exitCode = code; }, (error) => {
    console.error(`FAILED: ${error instanceof Error ? error.message : 'unknown error'}`);
    process.exitCode = 1;
  });
}
