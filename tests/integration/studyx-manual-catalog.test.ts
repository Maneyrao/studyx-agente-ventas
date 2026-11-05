import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  buildBusinessContextView,
  DEFAULT_BUSINESS_CONTEXT_LIMITS,
} from '@/features/orchestration/domain/business-context';
import { resolveCatalogRequest } from '@/features/orchestration/domain/catalog-resolution';
import { PostgresBusinessContextStore } from '@/features/orchestration/adapters/postgres-business-context';
import { openLocalTestDatabase } from '../helpers/db';

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const db = process.env.TEST_DATABASE_URL ? openLocalTestDatabase() : null;
afterAll(async () => db?.end());

const WS = 'studyx';
const BASE_SEED_PATH = resolve(__dirname, '../../supabase/seed/studyx.sql');
const MANUAL_SEED_PATH = resolve(__dirname, '../../supabase/seed/studyx-manual.sql');
const MANUAL_DATA_PATH = resolve(__dirname, '../../supabase/seed/data/studyx-manual.json');

interface ManualCourse {
  code: string;
  name: string;
  academy: string;
  classes: number;
  description: string;
}

const manual = JSON.parse(readFileSync(MANUAL_DATA_PATH, 'utf8')) as {
  source_sha256: string;
  courses: ManualCourse[];
};

run('StudyX official manual catalog', () => {
  beforeAll(async () => {
    await db!.unsafe(readFileSync(BASE_SEED_PATH, 'utf8'));
    await db!.unsafe(readFileSync(MANUAL_SEED_PATH, 'utf8'));
  });

  it('pins the reviewed manual data and generated SQL to one source hash', () => {
    expect(manual.courses).toHaveLength(40);
    expect(new Set(manual.courses.map((course) => course.code)).size).toBe(40);
    const generated = readFileSync(MANUAL_SEED_PATH, 'utf8');
    expect(generated).toContain(`SHA-256: ${manual.source_sha256}`);
    expect(createHash('sha256').update(JSON.stringify(manual.courses)).digest('hex')).toHaveLength(64);
  });

  // 2026-11-05: the 5 formerly deactivated legacy courses are NUEVO in the 2026 manual and stay active (45 from the seed;
  // the other 12 arrive through scripts/upsert-manual-2026-offerings.mjs).
  const REACTIVATED = ['barista', 'cuidador_adultos_mayores', 'depilacion_definitiva', 'estetica_integral', 'masoterapia'];
  const seededCodes = [...manual.courses.map((course) => course.code), ...REACTIVATED].sort();

  it('makes the 40 catalogued manual courses plus the 5 reactivated ones active', async () => {
    const rows = await db!<Array<{
      code: string;
      display_name: string;
      price_amount: string;
      delivery: { classes: number };
      metadata: { canonical_source: string; academy: string; source_sha256: string };
    }>>`
      SELECT o.code, o.display_name, o.price_amount, o.delivery, o.metadata
      FROM offerings o JOIN workspaces w ON w.id = o.workspace_id
      WHERE w.slug = ${WS} AND o.status = 'active'
      ORDER BY o.code
    `;

    expect(rows).toHaveLength(45);
    expect(rows.map((row) => row.code)).toEqual(seededCodes);
    for (const course of manual.courses) {
      const row = rows.find((candidate) => candidate.code === course.code)!;
      expect(row.display_name).toBe(course.name);
      expect(Number(row.price_amount)).toBe(360);
      expect(row.delivery.classes).toBe(course.classes);
      expect(row.metadata).toMatchObject({
        canonical_source: 'studyx_manual_1',
        academy: course.academy,
        source_sha256: manual.source_sha256,
      });
    }
  });

  it('no longer deactivates any legacy course (the 5 are in the 2026 manual)', async () => {
    const rows = await db!<Array<{ code: string; status: string }>>`
      SELECT o.code, o.status
      FROM offerings o JOIN workspaces w ON w.id = o.workspace_id
      WHERE w.slug = ${WS}
        AND o.metadata ->> 'deactivated_by_catalog_sync' = 'studyx_manual_1'
      ORDER BY o.code
    `;
    expect(rows).toEqual([]);
  });

  it('stores every course description as canonical retrievable knowledge', async () => {
    const rows = await db!<Array<{ title: string; content: string; metadata: { course_code?: string } }>>`
      SELECT k.title, k.content, k.metadata
      FROM knowledge_sources k JOIN workspaces w ON w.id = k.workspace_id
      WHERE w.slug = ${WS}
        AND k.status = 'active'
        AND k.metadata ->> 'canonical_source' = 'studyx_manual_1'
    `;

    expect(rows).toHaveLength(43);
    for (const course of manual.courses) {
      const source = rows.find((row) => row.metadata.course_code === course.code);
      expect(source?.title).toBe(`Manual StudyX — ${course.name}`);
      expect(source?.content).toContain(course.description);
    }
  });

  it('records the Ceremonial y Protocolo ambiguity without selling it', async () => {
    const offerings = await db!`
      SELECT o.id FROM offerings o JOIN workspaces w ON w.id = o.workspace_id
      WHERE w.slug = ${WS} AND o.code = 'ceremonial_protocolo' AND o.status = 'active'
    `;
    expect(offerings).toHaveLength(0);

    const sources = await db!<Array<{ content: string }>>`
      SELECT k.content FROM knowledge_sources k JOIN workspaces w ON w.id = k.workspace_id
      WHERE w.slug = ${WS}
        AND k.title = 'Manual StudyX — Ambigüedades que requieren confirmación'
        AND k.status = 'active'
    `;
    expect(sources).toHaveLength(1);
    expect(sources[0].content).toContain('no_ofrecer_hasta_confirmacion');
  });

  it('does not truncate the complete active catalog from Agent A context', async () => {
    expect(DEFAULT_BUSINESS_CONTEXT_LIMITS.maxOfferings).toBeGreaterThanOrEqual(40);
    // 2026-11-04: 40 active + Real Estate must fit (readiness probe catalog_truncated).
    expect(DEFAULT_BUSINESS_CONTEXT_LIMITS.maxOfferings).toBeGreaterThanOrEqual(41);
    const raw = await new PostgresBusinessContextStore(db!).loadBusinessContext(WS);
    expect(raw).not.toBeNull();
    const view = buildBusinessContextView(raw!);
    expect(view.offerings).toHaveLength(45);
    expect(view.offerings_truncated).toBe(0);
  });

  it.each([
    ['Quiero saber todo sobre el curso de AutoCAD', 'autocad_interiores'],
    ['ola quiero aprender a reparar celu', 'reparacion_celulares'],
    ['Me interesa publicidad redes', 'publicidad_redes_sociales'],
    ['El de sacar fotos de productos con el celu', 'fotografia_celulares_tiendas_online'],
    ['Quiero aprender Illustrator', 'diseno_illustrator'],
  ])('resolves customer language %s to canonical course %s', async (message, code) => {
    const raw = await new PostgresBusinessContextStore(db!).loadBusinessContext(WS);
    expect(raw).not.toBeNull();
    const view = buildBusinessContextView(raw!);

    expect(resolveCatalogRequest(message, view)).toMatchObject({
      kind: 'exact',
      offeringCode: code,
    });
  });

  it('exposes all 45 identities through the complete compact index independently of detail limits', async () => {
    const index = await new PostgresBusinessContextStore(db!).loadCompleteIndex(WS);
    expect(index?.offerings_total).toBe(45);
    expect(index?.offerings.map((offering) => offering.code)).toEqual(seededCodes);
    const tail = seededCodes.at(-1)!;
    const detail = await new PostgresBusinessContextStore(db!).loadByCode(WS, tail);
    expect(detail?.offerings).toHaveLength(1);
    expect(detail?.offerings[0]?.code).toBe(tail);
  });

  it('is idempotent when the manual seed is replayed', async () => {
    await db!.unsafe(readFileSync(MANUAL_SEED_PATH, 'utf8'));
    const rows = await db!<Array<{ offerings: number; sources: number }>>`
      SELECT
        (SELECT count(*)::int FROM offerings o JOIN workspaces w ON w.id = o.workspace_id
          WHERE w.slug = ${WS} AND o.status = 'active') AS offerings,
        (SELECT count(*)::int FROM knowledge_sources k JOIN workspaces w ON w.id = k.workspace_id
          WHERE w.slug = ${WS} AND k.status = 'active'
            AND k.metadata ->> 'canonical_source' = 'studyx_manual_1') AS sources
    `;
    expect(rows[0]).toMatchObject({ offerings: 45 });
  });
});
