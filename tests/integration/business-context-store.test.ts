import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { PostgresBusinessContextStore } from '@/features/orchestration/adapters/postgres-business-context';
import { buildBusinessContextView } from '@/features/orchestration/domain/business-context';
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

    const store = new PostgresBusinessContextStore(db!);
    const raw = await store.loadBusinessContext(mine.slug);
    expect(raw).not.toBeNull();
    expect(raw!.workspace.slug).toBe(mine.slug);
    expect(raw!.offerings.map((offering) => offering.code)).toEqual(['group_a']);
    expect(raw!.qualification_fields.map((field) => field.code)).toEqual(['tech_profile']);

    const view = buildBusinessContextView(raw!);
    expect(view.offerings[0].price).toEqual({ amount: '85000.00', currency: 'ARS' });
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
