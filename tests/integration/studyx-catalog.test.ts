import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { openLocalTestDatabase } from '../helpers/db';

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const db = process.env.TEST_DATABASE_URL ? openLocalTestDatabase() : null;
afterAll(async () => db?.end());

const WS = 'studyx';
const SEED_PATH = resolve(__dirname, '../../supabase/seed/studyx.sql');

// The catalog endpoints are the agent's only sanctioned source of course and
// price facts. This scan targets only the business text fields the agent
// could actually quote to a customer (description / value proposition /
// price message / guardrail text) — never ids, timestamps, or envelope
// metadata, which can legitimately contain these digits as noise (e.g. a
// uuid fragment) without that being a price leak.
const PRICE_LEAK_PATTERN = /699|1[.,]?200/;

function collectQuotableText(item: Record<string, unknown>): string[] {
  const texts: string[] = [];
  if (typeof item.description === 'string') texts.push(item.description);
  if (typeof item.value_proposition === 'string') texts.push(item.value_proposition);
  const policies = item.policies as Record<string, unknown> | undefined;
  if (policies && typeof policies === 'object') {
    if (typeof policies.allowed_promise === 'string') texts.push(policies.allowed_promise);
    if (typeof policies.price_message === 'string') texts.push(policies.price_message);
    if (Array.isArray(policies.forbidden_promises)) {
      for (const promise of policies.forbidden_promises) {
        if (typeof promise === 'string') texts.push(promise);
      }
    }
  }
  return texts;
}

function assertNoNumericPrice(item: Record<string, unknown>) {
  // Structural: the price field itself must be null/absent for every item —
  // there is no field a numeric amount could ride in.
  expect(item.price ?? null).toBeNull();
  expect((item as { price_amount?: unknown }).price_amount ?? null).toBeNull();
  expect(item.price_assertable).toBe(false);
  expect(item.price_type).toBe('quote');
}

function assertNoQuotableLeak(item: Record<string, unknown>) {
  for (const text of collectQuotableText(item)) {
    expect(text).not.toMatch(PRICE_LEAK_PATTERN);
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
  });

  afterEach(() => {
    if (originalSlug === undefined) delete process.env.BUSINESS_WORKSPACE_SLUG;
    else process.env.BUSINESS_WORKSPACE_SLUG = originalSlug;
  });

  it('lista los 14 diplomados', async () => {
    process.env.BUSINESS_WORKSPACE_SLUG = WS;
    const res = await catalogList();
    expect(res.items).toHaveLength(14);
  });

  it('ningún item expone un precio numérico ni los montos del conflicto', async () => {
    process.env.BUSINESS_WORKSPACE_SLUG = WS;
    const res = await catalogList();
    expect(res.prices_assertable).toBe(false);
    for (const item of res.items) {
      assertNoNumericPrice(item);
      assertNoQuotableLeak(item);
    }
  });

  it('el detalle de barista mantiene paridad con la lista y sin precio', async () => {
    process.env.BUSINESS_WORKSPACE_SLUG = WS;
    const detail = await catalogDetail('barista');
    expect(detail.status).toBe(200);
    assertNoNumericPrice(detail.body);
    assertNoQuotableLeak(detail.body);

    const list = await catalogList();
    const listItem = list.items.find((item: { sku: string }) => item.sku === 'barista');
    expect(listItem).toBeDefined();
    for (const key of Object.keys(listItem)) {
      expect(detail.body[key], `field ${key} must match the list item`).toEqual(listItem[key]);
    }
  });
});
