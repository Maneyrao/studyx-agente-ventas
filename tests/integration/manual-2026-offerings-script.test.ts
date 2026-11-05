import { afterAll, describe, expect, it, vi } from 'vitest';
import { openLocalTestDatabase } from '../helpers/db';
import * as script from '../../scripts/upsert-manual-2026-offerings.mjs';

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const db = process.env.TEST_DATABASE_URL ? openLocalTestDatabase() : null;
afterAll(async () => db?.end());

describe('upsert-manual-2026-offerings (no database)', () => {
  it('refuses without an explicit target and never reads env files', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await script.main([], {} as never)).toBe(2);
    expect(await script.main(['--apply'], {} as never)).toBe(2);
    error.mockRestore();
  });
  it('covers exactly the 57 manual courses: 12 new + 5 reactivated + the 40 already active', () => {
    expect(script.MANUAL_CODES).toHaveLength(57);
    expect(new Set(script.MANUAL_CODES).size).toBe(57);
    expect(script.NEW_OFFERING_CODES).toHaveLength(12);
    expect(script.REACTIVATED_OFFERING_CODES).toHaveLength(5);
    for (const code of [...script.NEW_OFFERING_CODES, ...script.REACTIVATED_OFFERING_CODES]) expect(script.MANUAL_CODES).toContain(code);
  });
  it('builds USD 360 rows with the marketing_digital metadata shape and no invented class counts', () => {
    for (const code of script.NEW_OFFERING_CODES) {
      const row = script.buildOffering(code);
      expect(row).toMatchObject({ code, status: 'active', price_amount: '360.00', currency: 'USD', offering_type: 'course' });
      expect(row.metadata).toMatchObject({ total_price_usd: 360, payment_options_owner_confirmed: true, price_source: 'owner-confirmed 2026-11-05',
        canonical_source: 'manual_2026' });
      expect(JSON.stringify(row)).not.toMatch(/\b699\b|beca/iu);
    }
    for (const code of ['auxiliar_educacion_especial', 'diseno_vidrieras_stand', 'word', 'ingles_4', 'ceremonial_protocolo']) {
      expect(script.buildOffering(code).delivery).not.toHaveProperty('classes');   // "a confirmar" in the manual
      expect(script.buildOffering(code).description).not.toMatch(/\d+ clases/u);
    }
    expect(script.buildOffering('plomeria').guardrails.forbidden_promises).toContain('licencia estatal');
    expect(script.buildOffering('real_estate').metadata.program_pdf_sha256).toBe('f7631135a630119e0c07fb9602d42c57b62bd1a821a70d46c6690dde7fa0e6bc');
  });
  it('describes the target without credentials', () => {
    expect(script.describeTarget('postgresql://user:secret@db.example.com:6543/postgres')).toBe('db.example.com:6543/postgres');
  });
});

run('upsert-manual-2026-offerings against the local cluster', () => {
  it('dry-run plans without writing; apply leaves the 57 manual courses active, idempotently, and reports extras', async () => {
    await expect(db!.begin(async (tx) => {
      const before = await script.activeManualCount(tx);
      const plan = script.planChanges(await script.readCurrent(tx));
      expect(plan.filter(item => item.action === 'create')).toHaveLength(12);
      expect((await tx`SELECT count(*)::int n FROM offerings WHERE code = ANY(${script.NEW_OFFERING_CODES})`)[0]!.n).toBe(0);
      await script.applyUpsert(tx);
      await script.applyUpsert(tx);
      expect(await script.activeManualCount(tx)).toBe(57);
      expect(before).toBeLessThan(57);
      expect(script.planChanges(await script.readCurrent(tx)).every(item => item.action === 'unchanged')).toBe(true);
      const rows = await tx`SELECT code, status, price_amount::text price, currency FROM offerings
        WHERE workspace_id=${script.WORKSPACE_ID}::uuid AND code = ANY(${[...script.NEW_OFFERING_CODES, ...script.REACTIVATED_OFFERING_CODES]})`;
      expect(rows).toHaveLength(17);
      expect(rows.every(row => row.status === 'active' && row.price === '360.00' && row.currency === 'USD')).toBe(true);
      // Nothing is deactivated: an unrelated active offering is only reported.
      await tx`INSERT INTO offerings (id, workspace_id, code, display_name, offering_type, status, description, price_type, price_amount, currency)
        VALUES (gen_random_uuid(), ${script.WORKSPACE_ID}::uuid, 'zz_outside_manual', 'Outside', 'course', 'active', 'x', 'fixed', 1, 'USD')`;
      await script.applyUpsert(tx);
      expect(await script.activeOutsideManual(tx)).toContain('zz_outside_manual');
      expect((await tx`SELECT status FROM offerings WHERE code='zz_outside_manual'`)[0]!.status).toBe('active');
      // Programme sources are linked to their offering code.
      await tx`UPDATE knowledge_sources SET metadata = metadata || '{"offering_code": null}'::jsonb
        WHERE workspace_id=${script.WORKSPACE_ID}::uuid AND metadata->>'source'='official_program_pdf' AND metadata->>'course_slug' IN ('real-estate','plomeria')`;
      const unlinked = await script.countUnlinkedProgramSources(tx);
      expect(unlinked).toBeGreaterThan(0);
      await script.applyUpsert(tx);
      expect(await script.countUnlinkedProgramSources(tx)).toBe(0);
      throw new Error('ROLLBACK_FIXTURE');
    })).rejects.toThrow('ROLLBACK_FIXTURE');
    expect((await db!`SELECT count(*)::int n FROM offerings WHERE code = ANY(${script.NEW_OFFERING_CODES})`)[0]!.n).toBe(0);
  });
});
