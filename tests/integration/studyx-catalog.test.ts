import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_BUSINESS_CONTEXT_LIMITS } from '@/features/orchestration/domain/business-context';
import { openLocalTestDatabase } from '../helpers/db';

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const db = process.env.TEST_DATABASE_URL ? openLocalTestDatabase() : null;
afterAll(async () => db?.end());

const WS = 'studyx';
const SEED_PATH = resolve(__dirname, '../../supabase/seed/studyx.sql');
const MANUAL_SEED_PATH = resolve(__dirname, '../../supabase/seed/studyx-manual.sql');

// El catálogo es la única fuente sancionada de precio para el agente. El dueño
// confirmó USD 360 como total y los tres planes viven en workspace.metadata;
// el catálogo nunca vuelve a exponer el precio histórico de USD 1.200 o la
// antigua hipótesis de beca de USD 699.
const LEGACY_PRICE_LEAK_PATTERN = /\b(?:699|1200|1\.200)\b/;

/**
 * Every string anywhere in the item, walked recursively.
 *
 * This used to enumerate field names — `description`, `value_proposition`,
 * `policies.allowed_promise`, `policies.price_message`,
 * `policies.forbidden_promises[]`. Only the first exists on a
 * `BusinessCatalogItem`, so three of the four branches never ran and the scan
 * quietly covered one field while reading like it covered five. A leak-hunting
 * assertion that silently inspects nothing is worse than no assertion, because
 * it reports safety it never checked.
 *
 * Walking generically means a renamed or newly added text field is covered the
 * day it appears, without anyone remembering to update this list.
 */
function collectQuotableText(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(collectQuotableText);
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).flatMap(collectQuotableText);
  }
  return [];
}

function assertChargedPrice(item: Record<string, unknown>) {
  // El precio expuesto es exactamente el que cobra el checkout. Un item sin
  // precio, o con otro número, significa que el agente va a decir algo que el
  // pago después desmiente.
  expect(item.price_type).toBe('fixed');
  expect(item.price_assertable).toBe(true);
  expect(item.price).toMatchObject({ amount: '360.00', currency: 'USD' });
}

function assertNoBecaLeak(item: Record<string, unknown>) {
  const texts = collectQuotableText(item);
  // Without this the loop below passes on an empty list, which is how the
  // previous version of this scan stayed green while reading nothing. Every
  // catalog item carries at least a sku and a name, so zero strings means the
  // walk broke, not that the item is clean.
  expect(texts.length).toBeGreaterThan(0);
  for (const text of texts) {
    expect(text).not.toMatch(LEGACY_PRICE_LEAK_PATTERN);
  }
}

async function catalogList() {
  const { GET } = await import('@/app/api/agent/tools/catalog/route');
  const response = await GET();
  return response.json();
}

async function catalogDetail(sku: string) {
  const { GET } = await import('@/app/api/agent/tools/catalog/[sku]/route');
  const response = await GET(undefined as never, { params: Promise.resolve({ sku }) });
  return { status: response.status, body: await response.json() };
}

run('catálogo del agente con workspace studyx (production)', () => {
  const originalSlug = process.env.BUSINESS_WORKSPACE_SLUG;

  beforeAll(async () => {
    // Self-contained: apply the real production seed against the local
    // cluster before asserting on it, same approach as studyx-seed.test.ts,
    // so this suite doesn't depend on anyone having seeded by hand.
    const seedSql = readFileSync(SEED_PATH, 'utf8');
    await db!.unsafe(seedSql);
    await db!.unsafe(readFileSync(MANUAL_SEED_PATH, 'utf8'));
  });

  afterEach(() => {
    if (originalSlug === undefined) delete process.env.BUSINESS_WORKSPACE_SLUG;
    else process.env.BUSINESS_WORKSPACE_SLUG = originalSlug;
  });

  it('lista los 40 cursos del catálogo oficial activo', async () => {
    process.env.BUSINESS_WORKSPACE_SLUG = WS;
    const res = await catalogList();
    expect(res.items).toHaveLength(40);
  });

  it('cada item expone el precio cobrable y ninguno filtra el monto de la beca', async () => {
    process.env.BUSINESS_WORKSPACE_SLUG = WS;
    const res = await catalogList();
    expect(res.prices_assertable).toBe(true);
    for (const item of res.items) {
      assertChargedPrice(item);
      assertNoBecaLeak(item);
    }
  });

  it('el detalle de maquillaje profesional mantiene paridad con la lista y expone el precio cobrable', async () => {
    process.env.BUSINESS_WORKSPACE_SLUG = WS;
    const detail = await catalogDetail('maquillaje_profesional');
    expect(detail.status).toBe(200);
    assertChargedPrice(detail.body);
    assertNoBecaLeak(detail.body);

    const list = await catalogList();
    const listItem = list.items.find((item: { sku: string }) => item.sku === 'maquillaje_profesional');
    expect(listItem).toBeDefined();
    for (const key of Object.keys(listItem)) {
      expect(detail.body[key], `field ${key} must match the list item`).toEqual(listItem[key]);
    }
  });

  // The list is capped at `maxOfferings` to bound prompt size. A lookup of one
  // sku puts nothing in a prompt, so the cap must not apply to it: otherwise a
  // course past the cap answers NOT_FOUND and the agent tells a customer that a
  // course StudyX genuinely sells does not exist — the same silent denial the
  // list endpoint was already fixed for.
  it('el detalle encuentra un curso que quedó fuera del tope de la lista', async () => {
    process.env.BUSINESS_WORKSPACE_SLUG = WS;
    const overflow = DEFAULT_BUSINESS_CONTEXT_LIMITS.maxOfferings + 4;
    const workspace = await db!<{ id: string }[]>`SELECT id FROM workspaces WHERE slug = ${WS}`;
    const seeded = await db!<{ n: number }[]>`
      SELECT count(*)::int AS n FROM offerings
      WHERE workspace_id = ${workspace[0].id} AND status = 'active'`;

    // `code` orders the catalog, so a 'zzz_' prefix guarantees these land past
    // the cap and the 14 real diplomados keep their places.
    const fillerCodes = Array.from(
      { length: Math.max(4, overflow - seeded[0].n) },
      (_, index) => `zzz_filler_${String(index).padStart(3, '0')}`
    );
    try {
      for (const code of fillerCodes) {
        await db!`
          INSERT INTO offerings
            (workspace_id, code, display_name, description, price_type, currency, status)
          VALUES (
            ${workspace[0].id}, ${code}, ${`Relleno ${code}`},
            'Oferta de relleno para forzar el truncamiento de la lista.',
            'quote', 'USD', 'active'
          )
          ON CONFLICT (workspace_id, code) DO NOTHING`;
      }

      const list = await catalogList();
      expect(list.count).toBe(DEFAULT_BUSINESS_CONTEXT_LIMITS.maxOfferings);
      expect(list.dropped).toBeGreaterThan(0);

      const droppedCode = fillerCodes[fillerCodes.length - 1];
      expect(list.items.some((item: { sku: string }) => item.sku === droppedCode)).toBe(false);

      const detail = await catalogDetail(droppedCode);
      expect(detail.status).toBe(200);
      expect(detail.body.sku).toBe(droppedCode);
    } finally {
      await db!`
        DELETE FROM offerings
        WHERE workspace_id = ${workspace[0].id} AND code LIKE 'zzz_filler_%'`;
    }
  });
});
