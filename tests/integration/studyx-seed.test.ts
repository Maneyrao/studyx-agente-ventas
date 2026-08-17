import { afterAll, describe, expect, it } from 'vitest';
import { openLocalTestDatabase } from '../helpers/db';

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const db = process.env.TEST_DATABASE_URL ? openLocalTestDatabase() : null;
afterAll(async () => db?.end());

const WS = 'studyx-sandbox';

run('seed studyx-sandbox', () => {
  it('crea el workspace en environment sandbox', async () => {
    const rows = await db!`SELECT environment, status FROM workspaces WHERE slug = ${WS}`;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ environment: 'sandbox', status: 'active' });
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

  it('la política comercial cita los límites de los T&C', async () => {
    const rows = await db!`
      SELECT content FROM knowledge_sources k JOIN workspaces w ON w.id = k.workspace_id
      WHERE w.slug = ${WS} AND k.source_type = 'policy'`;
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0].content).toContain('No somos una entidad educativa con licencia');
  });
});
