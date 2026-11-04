import { afterAll, describe, expect, it, vi } from 'vitest';
import { openLocalTestDatabase } from '../helpers/db';
import * as script from '../../scripts/upsert-real-estate-offering.mjs';

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const db = process.env.TEST_DATABASE_URL ? openLocalTestDatabase() : null;
afterAll(async () => db?.end());

describe('upsert-real-estate-offering (no database)', () => {
  it('refuses without an explicit target and never reads env files', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await script.main([], {} as never)).toBe(2);
    expect(await script.main(['--apply'], {} as never)).toBe(2);
    error.mockRestore();
  });
  it('builds the agreed row from the official programme PDF', () => {
    const row = script.buildOffering();
    expect(row).toMatchObject({ code: 'real_estate', display_name: 'Real Estate', status: 'active', offering_type: 'course',
      price_amount: '360.00', currency: 'USD' });
    expect(row.metadata).toMatchObject({ total_price_usd: 360, payment_options_owner_confirmed: true,
      source_sha256: 'f7631135a630119e0c07fb9602d42c57b62bd1a821a70d46c6690dde7fa0e6bc' });
    expect(row.guardrails.forbidden_promises).toContain('licencia inmobiliaria estatal');
  });
  it('describes the target without credentials', () => {
    expect(script.describeTarget('postgresql://user:secret@db.example.com:6543/postgres')).toBe('db.example.com:6543/postgres');
  });
});

run('upsert-real-estate-offering against the local cluster', () => {
  it('dry-run plans without writing; apply is idempotent and leaves one active USD 360 row', async () => {
    await expect(db!.begin(async (tx) => {
      const before = await tx`SELECT count(*)::int n FROM offerings WHERE workspace_id=${script.WORKSPACE_ID}::uuid AND code='real_estate'`;
      expect(before[0]!.n).toBe(0);
      expect(script.planChanges(await script.readCurrent(tx), script.buildOffering()).action).toBe('create');
      expect((await tx`SELECT count(*)::int n FROM offerings WHERE code='real_estate'`)[0]!.n).toBe(0);
      await script.applyUpsert(tx);
      await script.applyUpsert(tx);
      const rows = await tx`SELECT status, price_amount::text price, currency, display_name FROM offerings WHERE workspace_id=${script.WORKSPACE_ID}::uuid AND code='real_estate'`;
      expect(rows).toEqual([{ status: 'active', price: '360.00', currency: 'USD', display_name: 'Real Estate' }]);
      expect(script.planChanges(await script.readCurrent(tx), script.buildOffering()).action).toBe('unchanged');
      await tx`UPDATE offerings SET status='inactive' WHERE workspace_id=${script.WORKSPACE_ID}::uuid AND code='real_estate'`;
      expect(script.planChanges(await script.readCurrent(tx), script.buildOffering())).toEqual({ action: 'update', fields: ['status'] });
      throw new Error('ROLLBACK_FIXTURE');
    })).rejects.toThrow('ROLLBACK_FIXTURE');
    expect((await db!`SELECT count(*)::int n FROM offerings WHERE code='real_estate'`)[0]!.n).toBe(0);
  });
});
