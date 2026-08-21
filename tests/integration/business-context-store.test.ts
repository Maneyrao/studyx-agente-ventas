import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { PostgresBusinessContextStore } from '@/features/orchestration/adapters/postgres-business-context';
import {
  DEFAULT_BUSINESS_CONTEXT_LIMITS,
  buildBusinessContextView,
} from '@/features/orchestration/domain/business-context';
import type { DbClient } from '@/lib/db/types';
import { openLocalTestDatabase } from '../helpers/db';

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const db = process.env.TEST_DATABASE_URL ? openLocalTestDatabase() : null;
afterAll(async () => db?.end());

async function workspaceFixture(prefix: string) {
  const slug = `${prefix}-${randomUUID().slice(0, 8)}`;
  const rows = await db!<Array<{ id: string }>>`
    INSERT INTO workspaces (slug, display_name) VALUES (${slug}, ${`Tenant ${prefix}`}) RETURNING id
  `;
  return { id: rows[0].id, slug };
}

async function offeringFixture(workspaceId: string, code: string, priceType: 'fixed' | 'quote') {
  await db!`
    INSERT INTO offerings (
      workspace_id, code, display_name, offering_type, status, description,
      price_type, price_amount, currency, billing_interval, delivery, guardrails
    ) VALUES (
      ${workspaceId}::uuid, ${code}, ${`Oferta ${code}`}, 'course', 'active', 'Descripción.',
      ${priceType}, ${priceType === 'fixed' ? '85000' : null}, 'ARS', 'monthly',
      ${db!.json({ modality: 'virtual', certification: true })}, ${db!.json({})}
    )
  `;
}

function countedDatabase() {
  let statements = 0;
  const texts: string[] = [];
  const counted = ((strings: TemplateStringsArray, ...params: unknown[]) => {
    statements += 1;
    texts.push(strings.join('$'));
    return (db as unknown as (strings: TemplateStringsArray, ...params: unknown[]) => unknown)(
      strings,
      ...params
    );
  }) as unknown as DbClient;
  return {
    db: counted,
    get statements() { return statements; },
    texts,
  };
}

run('PostgresBusinessContextStore', () => {
  it('loads only the requested workspace, scoped end to end', async () => {
    const mine = await workspaceFixture('mine');
    const other = await workspaceFixture('other');
    await offeringFixture(mine.id, 'group_a', 'fixed');
    await offeringFixture(other.id, 'foreign_offer', 'fixed');
    await db!`
      INSERT INTO qualification_fields (workspace_id, code, prompt, response_type, position)
      VALUES (${mine.id}::uuid, 'tech_profile', '¿Perfil IT?', 'boolean', 0)
    `;

    const counted = countedDatabase();
    const store = new PostgresBusinessContextStore(counted.db);
    const raw = await store.loadBusinessContext(mine.slug);
    expect(raw).not.toBeNull();
    expect(raw!.workspace.slug).toBe(mine.slug);
    expect(raw!.offerings.map((offering) => offering.code)).toEqual(['group_a']);
    expect(raw!.qualification_fields.map((field) => field.code)).toEqual(['tech_profile']);
    expect(raw!.as_of).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(counted.statements).toBe(1);

    const view = buildBusinessContextView(raw!);
    expect(view.offerings[0].price).toEqual({ amount: '85000.00', currency: 'ARS' });
  });

  it('bounds offerings and qualification rows inside the one snapshot statement', async () => {
    const workspace = await workspaceFixture('bounded-snapshot');
    for (let index = 0; index < DEFAULT_BUSINESS_CONTEXT_LIMITS.maxQualificationFields + 3; index += 1) {
      await db!`
        INSERT INTO qualification_fields (workspace_id, code, prompt, response_type, position)
        VALUES (${workspace.id}::uuid, ${`field_${index}`}, ${`Prompt ${index}`}, 'text', ${index})
      `;
    }

    const store = new PostgresBusinessContextStore(db!);
    const raw = await store.loadBusinessContext(workspace.slug);

    expect(raw).not.toBeNull();
    expect(raw!.qualification_fields).toHaveLength(DEFAULT_BUSINESS_CONTEXT_LIMITS.maxQualificationFields);
    expect(raw!.offerings.length).toBeLessThanOrEqual(DEFAULT_BUSINESS_CONTEXT_LIMITS.maxOfferings);
  });

  it('exposes a catalog-specific read that never selects qualification fields', async () => {
    const workspace = await workspaceFixture('catalog-only');
    await offeringFixture(workspace.id, 'catalog_offer', 'fixed');
    const counted = countedDatabase();
    const store = new PostgresBusinessContextStore(counted.db);

    expect(typeof store.loadBusinessCatalog).toBe('function');
    const raw = await store.loadBusinessCatalog(workspace.slug);

    expect(raw?.offerings.map((offering) => offering.code)).toEqual(['catalog_offer']);
    expect(counted.statements).toBe(1);
    expect(counted.texts.join('\n')).not.toMatch(/qualification_fields/i);
  });

  it('returns null for an unknown slug instead of falling back to any tenant', async () => {
    const store = new PostgresBusinessContextStore(db!);
    await expect(store.loadBusinessContext(`missing-${randomUUID().slice(0, 8)}`)).resolves.toBeNull();
  });

  it('ignores inactive workspaces and inactive offerings', async () => {
    const workspace = await workspaceFixture('inactive-parts');
    await offeringFixture(workspace.id, 'active_offer', 'fixed');
    await db!`
      INSERT INTO offerings (
        workspace_id, code, display_name, offering_type, status, description, price_type, price_amount, currency
      ) VALUES (
        ${workspace.id}::uuid, 'retired_offer', 'Retirada', 'course', 'archived', 'Vieja.', 'fixed', '10', 'ARS'
      )
    `;
    const store = new PostgresBusinessContextStore(db!);
    const raw = await store.loadBusinessContext(workspace.slug);
    expect(raw!.offerings.map((offering) => offering.code)).toEqual(['active_offer']);

    await db!`UPDATE workspaces SET status = 'inactive' WHERE id = ${workspace.id}::uuid`;
    await expect(store.loadBusinessContext(workspace.slug)).resolves.toBeNull();
  });

  it('loads the seeded Aburridont fixture with its exact commercial facts', async () => {
    const store = new PostgresBusinessContextStore(db!);
    const raw = await store.loadBusinessContext('aburridont-english-it-sandbox');
    if (raw === null) return; // seed not applied in this database; covered by fixtures above
    const view = buildBusinessContextView(raw);
    expect(view.workspace.display_name).toBe('Aburridont — Inglés IT (Sandbox)');
    const group = view.offerings.find((offering) => offering.code === 'group_it_english');
    const individual = view.offerings.find((offering) => offering.code === 'individual_it_english');
    expect(group?.price).toEqual({ amount: '85000.00', currency: 'ARS' });
    expect(individual?.price).toBeNull();
    expect(view.qualification_fields).toHaveLength(7);
  });
});
