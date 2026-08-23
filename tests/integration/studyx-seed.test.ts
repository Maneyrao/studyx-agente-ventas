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

  it('siembra 14 offerings con el total y las tres opciones confirmadas por el dueño', async () => {
    const rows = await db!`
      SELECT o.code, o.price_type, o.price_amount, o.currency, o.guardrails, o.metadata
      FROM offerings o JOIN workspaces w ON w.id = o.workspace_id
      WHERE w.slug = ${WS}`;
    expect(rows).toHaveLength(14);
    for (const r of rows) {
      expect(r.price_type).toBe('fixed');
      expect(Number(r.price_amount)).toBe(360);
      expect(r.currency).toBe('USD');
      expect(r.guardrails.never_invent_price).toBe(true);
      expect(r.metadata.total_price_usd).toBe(360);
      expect(r.metadata.payment_options_owner_confirmed).toBe(true);
    }
  });

  it('expone únicamente los tres links y cuotas de pago autorizados', async () => {
    const rows = await db!<{ metadata: { payment_options?: unknown[] } }[]>`
      SELECT metadata FROM workspaces WHERE slug = ${WS}`;
    const plans = rows[0].metadata.payment_options as Array<Record<string, unknown>>;
    expect(plans).toHaveLength(3);
    expect(plans.map((plan) => plan.code)).toEqual(['monthly_12', 'monthly_6', 'one_time']);
    expect(plans.map((plan) => plan.installment_amount)).toEqual(['30.00', '60.00', '360.00']);
    expect(plans.every((plan) => plan.total_amount === '360.00')).toBe(true);
    expect(plans.every((plan) => typeof plan.payment_link === 'string' && plan.payment_link.startsWith('https://buy.stripe.com/'))).toBe(true);
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

  it('cada offering carga la configuración comercial confirmada por el dueño (USD 360, 20-ago-2026)', async () => {
    // La migración 20260820113000 superseded al seed: el precio hipotético
    // 1200/699 fue reemplazado por la realidad confirmada (total USD 360,
    // tres opciones de pago). El invariante vigente es que TODAS las
    // offerings del workspace llevan esa marca — no la proveniencia
    // source_url del seed original, que esa migración retiró.
    const rows = await db!<Array<{ code: string; metadata: Record<string, unknown> }>>`
      SELECT o.code, o.metadata FROM offerings o JOIN workspaces w ON w.id = o.workspace_id
      WHERE w.slug = ${WS}`;
    expect(rows).toHaveLength(14);
    for (const r of rows) {
      expect(r.metadata.payment_options_owner_confirmed, `owner flag for ${r.code}`).toBe(true);
      expect(Number(r.metadata.total_price_usd), `total for ${r.code}`).toBe(360);
    }
  });

  it('siembra las 9 fuentes de conocimiento del análisis', async () => {
    // El workspace además carga 14 temarios como source_type='offering'
    // (seed studyx-temarios.sql); las 9 fuentes del análisis son las de los
    // demás tipos.
    const rows = await db!<Array<{ title: string }>>`
      SELECT k.title FROM knowledge_sources k JOIN workspaces w ON w.id = k.workspace_id
      WHERE w.slug = ${WS} AND k.source_type <> 'offering'`;
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

  it('la política comercial cita los límites confirmados por el dueño', async () => {
    // La migración 20260820113000 reescribió esta fuente con la
    // configuración comercial confirmada (USD 360, tres opciones). El texto
    // literal del T&C del seed original ya no es el contenido vigente.
    const rows = await db!<Array<{ content: string }>>`
      SELECT content FROM knowledge_sources k JOIN workspaces w ON w.id = k.workspace_id
      WHERE w.slug = ${WS} AND k.title = 'Límites comerciales (T&C literales)'`;
    expect(rows).toHaveLength(1);
    expect(rows[0].content).toContain('USD 360');
    expect(rows[0].content).toContain('NUNCA promete');
  });

  it('la política recuperable nombra únicamente los tres pagos autorizados', async () => {
    const rows = await db!<{ title: string; content: string }[]>`
      SELECT k.title, k.content FROM knowledge_sources k JOIN workspaces w ON w.id = k.workspace_id
      WHERE w.slug = ${WS}`;
    expect(rows.length).toBeGreaterThan(0);

    const policy = rows.find((row) => row.title === 'Límites comerciales (T&C literales)');
    expect(policy?.content).toContain('12 pagos mensuales de USD 30');
    expect(policy?.content).toContain('6 pagos mensuales de USD 60');
    expect(policy?.content).toContain('pago único de USD 360');
    expect(policy?.content).not.toContain('USD 1.200');
    expect(policy?.content).not.toContain('USD 699');
  });
});
