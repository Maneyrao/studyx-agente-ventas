import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openLocalTestDatabase } from '../helpers/db';

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const db = process.env.TEST_DATABASE_URL ? openLocalTestDatabase() : null;
afterAll(async () => db?.end());

const WS = 'studyx';
const SEED_PATH = resolve(__dirname, '../../supabase/seed/studyx.sql');

// code -> classes, from the task brief's table B.2. Sorted keys documented as
// the exact set of 14 offerings that must exist for this workspace.
const EXPECTED_CLASSES: Record<string, number> = {
  maquillaje_profesional: 38,
  entrenamiento_funcional: 36,
  decoracion_de_interiores: 34,
  unas_gelificadas: 25,
  masoterapia: 24,
  paisajismo_jardineria: 24,
  fotografia_profesional: 41,
  estetica_integral: 20,
  vino_cata_maridaje: 19,
  nutricion_alimentacion: 16,
  cuidador_adultos_mayores: 14,
  barista: 12,
  sushi_principiantes: 10,
  depilacion_definitiva: 7,
};

const EXPECTED_CODES = Object.keys(EXPECTED_CLASSES).sort();

// The eight mandated phrases from the plan's Global Constraints / análisis Parte D.2.
const MANDATED_FORBIDDEN_PROMISES = [
  'certificación verificada',
  'título oficial',
  'homologación',
  'matrícula profesional',
  'cuotas o financiación',
  'más de 50 diplomados',
  'horarios de clases en vivo',
  'política de devoluciones',
];

run('seed studyx (production)', () => {
  // Self-contained: apply supabase/seed/studyx.sql against the local cluster
  // (TEST_DATABASE_URL, validated as loopback-only by openLocalTestDatabase)
  // before asserting on it, so this suite doesn't depend on anyone having run
  // the seed by hand first. sql.unsafe() uses the simple query protocol, so
  // the file's BEGIN/COMMIT and multiple statements run as-is, same as psql -f.
  beforeAll(async () => {
    const seedSql = readFileSync(SEED_PATH, 'utf8');
    await db!.unsafe(seedSql);
  });

  it('crea el workspace studyx en environment production', async () => {
    const rows = await db!`SELECT environment, status FROM workspaces WHERE slug = ${WS}`;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ environment: 'production', status: 'active' });
  });

  it('siembra 14 offerings, todas sin precio numérico', async () => {
    const rows = await db!`
      SELECT code, price_type, price_amount, currency, guardrails
      FROM offerings o JOIN workspaces w ON w.id = o.workspace_id
      WHERE w.slug = ${WS}`;
    expect(rows).toHaveLength(14);
    for (const r of rows) {
      expect(r.price_type).toBe('quote');
      expect(r.price_amount).toBeNull();
      expect(r.currency).toBe('USD');
      expect(r.guardrails.never_invent_price).toBe(true);
    }
  });

  it('el set exacto de 14 codes coincide con la tabla del brief', async () => {
    const rows = await db!<Array<{ code: string }>>`
      SELECT code FROM offerings o JOIN workspaces w ON w.id = o.workspace_id
      WHERE w.slug = ${WS}`;
    const actualCodes = rows.map((r) => r.code).sort();
    expect(actualCodes).toEqual(EXPECTED_CODES);
  });

  it('delivery.classes de cada offering coincide con la tabla B.2 del brief', async () => {
    const rows = await db!<Array<{ code: string; delivery: { classes: number } }>>`
      SELECT code, delivery FROM offerings o JOIN workspaces w ON w.id = o.workspace_id
      WHERE w.slug = ${WS}`;
    expect(rows).toHaveLength(14);
    for (const r of rows) {
      expect(r.delivery.classes, `classes for ${r.code}`).toBe(EXPECTED_CLASSES[r.code]);
    }
  });

  it('cada offering prohíbe las ocho promesas mandatadas, sin excepción por fila', async () => {
    const rows = await db!<Array<{ code: string; guardrails: { forbidden_promises: string[] } }>>`
      SELECT code, guardrails FROM offerings o JOIN workspaces w ON w.id = o.workspace_id
      WHERE w.slug = ${WS}`;
    expect(rows).toHaveLength(14);
    for (const r of rows) {
      for (const phrase of MANDATED_FORBIDDEN_PROMISES) {
        expect(
          r.guardrails.forbidden_promises,
          `offering ${r.code} must forbid "${phrase}"`,
        ).toContain(phrase);
      }
    }
  });

  it('exactamente una offering (barista) tiene source_url en metadata', async () => {
    const rows = await db!<Array<{ code: string }>>`
      SELECT o.code FROM offerings o JOIN workspaces w ON w.id = o.workspace_id
      WHERE w.slug = ${WS} AND o.metadata ? 'source_url'`;
    expect(rows).toHaveLength(1);
    expect(rows[0].code).toBe('barista');
  });

  it('siembra exactamente 3 knowledge_sources', async () => {
    const rows = await db!`
      SELECT k.id FROM knowledge_sources k JOIN workspaces w ON w.id = k.workspace_id
      WHERE w.slug = ${WS}`;
    expect(rows).toHaveLength(3);
  });

  it('la política comercial cita los límites de los T&C', async () => {
    const rows = await db!`
      SELECT content FROM knowledge_sources k JOIN workspaces w ON w.id = k.workspace_id
      WHERE w.slug = ${WS} AND k.source_type = 'policy'`;
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0].content).toContain('No somos una entidad educativa con licencia');
  });
});
