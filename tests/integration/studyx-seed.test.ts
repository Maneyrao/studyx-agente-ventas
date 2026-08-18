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

  // El precio cargado es el que cobra el checkout ($1.200 en los 30 productos
  // de la tienda), no el que publican las fichas ($699). Si alguna vez se
  // invierte, el agente cotiza un número que el pago desmiente — que es
  // exactamente el hallazgo #1 del análisis.
  it('siembra 14 offerings al precio que realmente se cobra, no al publicado', async () => {
    const rows = await db!`
      SELECT o.code, o.price_type, o.price_amount, o.currency, o.guardrails, o.metadata
      FROM offerings o JOIN workspaces w ON w.id = o.workspace_id
      WHERE w.slug = ${WS}`;
    expect(rows).toHaveLength(14);
    for (const r of rows) {
      expect(r.price_type).toBe('fixed');
      expect(Number(r.price_amount)).toBe(1200);
      expect(r.currency).toBe('USD');
      expect(r.guardrails.never_invent_price).toBe(true);
      // La beca queda como dato, nunca como precio cotizable.
      expect(Number(r.metadata.beca_price_usd)).toBe(699);
      expect(r.guardrails.beca_amount_gated).toBe(true);
      // La equivalencia beca↔$699 sigue sin confirmar (pregunta E.1 del
      // análisis); si alguien la da por hecha, este assert lo frena.
      expect(r.metadata.beca_hypothesis_unconfirmed).toBe(true);
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

  it('siembra las 9 fuentes de conocimiento del análisis', async () => {
    const rows = await db!<Array<{ title: string }>>`
      SELECT k.title FROM knowledge_sources k JOIN workspaces w ON w.id = k.workspace_id
      WHERE w.slug = ${WS}`;
    // Ambos lados con el mismo comparador: los títulos llevan acentos y el
    // orden por code units no coincide con el alfabético.
    expect(rows.map((r) => r.title).sort()).toEqual(
      [
        'Beca StudyX y cierre',
        'Consentimiento: qué canal está cubierto',
        'Devoluciones: los documentos se contradicen',
        'Límites comerciales (T&C literales)',
        'Modalidad: qué se puede afirmar sobre las clases',
        'Prueba social publicada y programa Enterprise',
        'Qué vende StudyX',
        'Quién cobra y bajo qué ley',
        'Tamaño real del catálogo y qué no afirmar',
      ].sort()
    );
  });

  it('la política comercial cita los límites de los T&C', async () => {
    const rows = await db!`
      SELECT content FROM knowledge_sources k JOIN workspaces w ON w.id = k.workspace_id
      WHERE w.slug = ${WS} AND k.source_type = 'policy'`;
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0].content).toContain('No somos una entidad educativa con licencia');
  });

  // Ahora que $1.200 es un precio legítimo y cotizable, el monto que NO puede
  // aparecer en texto recuperable es el de la beca. El sitio dice que la beca
  // la aplica "únicamente el departamento de inscripciones", así que si $699
  // entra a un knowledge_source, `search_knowledge_base` se lo sirve al prompt
  // y el agente termina regalando un descuento que no le corresponde otorgar.
  it('ningún knowledge_source filtra el monto de la beca', async () => {
    const rows = await db!<{ title: string; content: string }[]>`
      SELECT k.title, k.content FROM knowledge_sources k JOIN workspaces w ON w.id = k.workspace_id
      WHERE w.slug = ${WS}`;
    expect(rows.length).toBeGreaterThan(0);

    const beca = /\b699\b/;
    const leaks = rows.filter((row) => beca.test(row.content)).map((row) => row.title);
    expect(leaks).toEqual([]);
  });
});
