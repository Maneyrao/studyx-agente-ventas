#!/usr/bin/env node
/**
 * Idempotent upsert of the `real_estate` offering (owner decision 2026-11-04:
 * active, USD 360, plans 1 / 6x60 / 12x30 like every other course).
 *
 * Offerings live only in the database. This script is DRY-RUN by default and
 * never reads any .env file: the target must be given explicitly.
 *
 *   STUDYX_CATALOG_TARGET_URL=postgresql://... node scripts/upsert-real-estate-offering.mjs          # dry-run
 *   STUDYX_CATALOG_TARGET_URL=postgresql://... node scripts/upsert-real-estate-offering.mjs --apply  # writes
 *
 * Without STUDYX_CATALOG_TARGET_URL it refuses to run. Credentials are never printed.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import postgres from 'postgres';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const WORKSPACE_ID = 'b0000000-0000-4000-8000-000000000001';
export const OFFERING_CODE = 'real_estate';
export const PROGRAM_SLUG = 'real-estate';

export function loadProgram() {
  const data = JSON.parse(readFileSync(join(ROOT, 'supabase/seed/data/programas-studyx-pdf.json'), 'utf8'));
  const program = data.programs.find((item) => item.slug === PROGRAM_SLUG);
  if (!program) throw new Error(`PROGRAM_NOT_FOUND:${PROGRAM_SLUG}`);
  return program;
}

/** The exact row. Shape copied from the manual seed (e.g. marketing_digital); source = the official programme PDF. */
export function buildOffering(program = loadProgram()) {
  return {
    code: OFFERING_CODE,
    display_name: 'Real Estate',
    offering_type: 'course',
    status: 'active',
    description: 'Curso Integral de Real Estate para Latinos en Estados Unidos. Programa online para trabajar, invertir o emprender en el mercado inmobiliario de Estados Unidos: conceptos legales y financieros, marketing, administración de propiedades y marca personal.',
    value_proposition: null,
    price_type: 'fixed',
    price_amount: '360.00',
    currency: 'USD',
    billing_interval: 'custom',
    audience: { language: 'Spanish' },
    delivery: { modality: 'online', source: 'Programa Académico – Curso Integral de Real Estate para Latinos en Estados Unidos' },
    guardrails: {
      never_invent_price: true,
      forbidden_promises: [
        'certificación verificada', 'título oficial', 'homologación', 'matrícula profesional',
        'licencia inmobiliaria estatal', 'salida laboral garantizada', 'horarios de clases en vivo',
        'política de devoluciones',
      ],
    },
    metadata: {
      canonical_source: 'official_program_pdf',
      course_slug: program.slug,
      catalog_url: program.catalog_url,
      source_sha256: program.sha256,
      total_price_usd: 360,
      payment_options_owner_confirmed: true,
      price_source: 'owner-confirmed 2026-11-04',
    },
  };
}

export async function readCurrent(sql) {
  const [workspace] = await sql`SELECT id FROM workspaces WHERE id = ${WORKSPACE_ID}::uuid`;
  if (!workspace) throw new Error('WORKSPACE_NOT_FOUND');
  const [current] = await sql`SELECT code, display_name, offering_type, status, price_type, price_amount::text AS price_amount,
      currency, billing_interval, description, audience, delivery, guardrails, metadata
    FROM offerings WHERE workspace_id = ${WORKSPACE_ID}::uuid AND code = ${OFFERING_CODE}`;
  return current ?? null;
}

/** Programme knowledge sources (official PDF text) not yet linked to the offering code, as the seed does. */
export async function countUnlinkedProgramSources(sql) {
  const [row] = await sql`SELECT count(*)::int AS n FROM knowledge_sources
    WHERE workspace_id = ${WORKSPACE_ID}::uuid AND source_type = 'offering'
      AND metadata->>'source' = 'official_program_pdf' AND metadata->>'course_slug' = ${PROGRAM_SLUG}
      AND metadata->>'offering_code' IS DISTINCT FROM ${OFFERING_CODE}`;
  return row.n;
}

const FIELDS = ['display_name', 'offering_type', 'status', 'price_type', 'price_amount', 'currency', 'billing_interval',
  'description', 'audience', 'delivery', 'guardrails', 'metadata'];

/** jsonb does not keep key order: compare canonical forms. */
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}

/** Fields that differ from the desired row; `null` current means the row would be created. */
export function planChanges(current, desired) {
  if (!current) return { action: 'create', fields: FIELDS };
  const fields = FIELDS.filter((field) => JSON.stringify(canonical(current[field])) !== JSON.stringify(canonical(desired[field]))
    && !(field === 'price_amount' && Number(current.price_amount) === Number(desired.price_amount)));
  return { action: fields.length ? 'update' : 'unchanged', fields };
}

export async function applyUpsert(sql, desired = buildOffering()) {
  // A caller already inside a transaction (tests) gets a savepoint.
  const transaction = typeof sql.begin === 'function' ? sql.begin.bind(sql) : sql.savepoint.bind(sql);
  return transaction(async (tx) => {
    const [workspace] = await tx`SELECT id FROM workspaces WHERE id = ${WORKSPACE_ID}::uuid FOR SHARE`;
    if (!workspace) throw new Error('WORKSPACE_NOT_FOUND');
    await tx`INSERT INTO offerings (id, workspace_id, code, display_name, offering_type, status, description, value_proposition,
        price_type, price_amount, currency, billing_interval, audience, delivery, guardrails, metadata)
      VALUES (gen_random_uuid(), ${WORKSPACE_ID}::uuid, ${desired.code}, ${desired.display_name}, ${desired.offering_type},
        ${desired.status}, ${desired.description}, ${desired.value_proposition}, ${desired.price_type},
        ${desired.price_amount}::numeric, ${desired.currency}, ${desired.billing_interval},
        ${tx.json(desired.audience)}, ${tx.json(desired.delivery)}, ${tx.json(desired.guardrails)}, ${tx.json(desired.metadata)})
      ON CONFLICT (workspace_id, code) DO UPDATE SET
        display_name = EXCLUDED.display_name, offering_type = EXCLUDED.offering_type, status = EXCLUDED.status,
        description = EXCLUDED.description, value_proposition = EXCLUDED.value_proposition, price_type = EXCLUDED.price_type,
        price_amount = EXCLUDED.price_amount, currency = EXCLUDED.currency, billing_interval = EXCLUDED.billing_interval,
        audience = EXCLUDED.audience, delivery = EXCLUDED.delivery, guardrails = EXCLUDED.guardrails,
        metadata = EXCLUDED.metadata, updated_at = now()`;
    await tx`UPDATE knowledge_sources SET metadata = metadata || jsonb_build_object('offering_code', ${OFFERING_CODE}::text), updated_at = now()
      WHERE workspace_id = ${WORKSPACE_ID}::uuid AND source_type = 'offering'
        AND metadata->>'source' = 'official_program_pdf' AND metadata->>'course_slug' = ${PROGRAM_SLUG}
        AND metadata->>'offering_code' IS DISTINCT FROM ${OFFERING_CODE}`;
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
    const desired = buildOffering();
    const plan = planChanges(await readCurrent(sql), desired);
    console.log(`target: ${describeTarget(targetUrl)}  mode: ${apply ? 'APPLY' : 'dry-run'}`);
    const unlinked = await countUnlinkedProgramSources(sql);
    console.log(`programme sources to link to real_estate: ${unlinked}`);
    console.log(`real_estate: ${plan.action}${plan.fields.length && plan.action !== 'unchanged' ? ` (${plan.fields.join(', ')})` : ''}`);
    if (!apply) { console.log('dry-run: nothing written. Re-run with --apply to write.'); return 0; }
    if (plan.action === 'unchanged' && unlinked === 0) { console.log('already up to date.'); return 0; }
    await applyUpsert(sql, desired);
    console.log('applied.');
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
