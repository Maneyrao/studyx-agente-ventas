import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { openLocalTestDatabase } from '../../helpers/db';

// `projection.service.ts` imports `@/lib/db/orchestrator` for its default
// `sql` fallback, and that module throws at import time when DATABASE_URL is
// unset — which it deliberately is under `tests/setup/unit.ts` (DATABASE_URL
// is the production Supabase pooler in this repo; see
// .claude/rules/database.md). Every call below passes `{ sql: db! }`
// explicitly, so the fallback is never reached — mock it out so the import
// itself doesn't throw, matching the existing pattern in
// tests/unit/services/knowledge-base-service.test.ts.
vi.mock('@/lib/db/orchestrator', () => ({ sql: undefined }));

const {
  enqueueLeadProjection,
  flushSheetProjections,
  leadProjectionKey,
} = await import('@/lib/services/projection.service');
type LeadProjectionInput = Parameters<typeof enqueueLeadProjection>[0];
const { FakeSheetsProvider } = await import('@/lib/providers/sheets/fake-sheets-provider');

/**
 * RED cases from the A3 plan (docs/contracts/agent-a-operational-mvp.md §5,
 * §8): PostgreSQL is the source of truth, `sheet_projection_rows` is the
 * outbox, and the worker only ever `values.update`s a reserved row_number —
 * never append. This suite exercises the outbox/worker contract end to end
 * against a disposable local database, with a FakeSheetsProvider standing in
 * for Google so a simulated timeout never touches the network.
 */
const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const db = process.env.TEST_DATABASE_URL ? openLocalTestDatabase() : null;
afterAll(async () => db?.end());

const TAB_NAME = 'Leads';

async function workspaceFixture() {
  const slug = `test-projection-${randomUUID()}`;
  const rows = await db!<Array<{ id: string }>>`
    INSERT INTO workspaces (slug, display_name) VALUES (${slug}, 'Proyección Test') RETURNING id
  `;
  return rows[0].id;
}

async function contactFixture() {
  // Unique across repeated runs against the same disposable DB, not just
  // within a single run — a sequential counter collides with contacts left
  // over from an earlier test invocation.
  const digits = randomUUID().replace(/\D/g, '').padEnd(10, '1').slice(0, 10);
  const phone = `+549${digits}`;
  const rows = await db!<Array<{ id: string }>>`
    INSERT INTO contacts (phone, channel_origin) VALUES (${phone}, 'whatsapp') RETURNING id
  `;
  return rows[0].id;
}

function leadInput(
  workspaceId: string,
  contactId: string,
  spreadsheetId: string,
  overrides: Partial<LeadProjectionInput> = {},
): LeadProjectionInput {
  return {
    workspaceId,
    contactId,
    spreadsheetId,
    tabName: TAB_NAME,
    telefono: '+5491100000000',
    nombre: 'Lead Test',
    etapaComercial: 'proposal',
    cursoInteres: 'reparacion-celulares',
    plan: 'monthly_12',
    estadoPago: 'pendiente',
    fechaPago: '',
    callId: '',
    ultimaSenal: 'payment_link_sent',
    traceId: randomUUID(),
    ...overrides,
  };
}

async function outboxRowsFor(spreadsheetId: string, tabName: string) {
  return db!<Array<{
    id: string;
    projection_key: string;
    row_number: number;
    state: string;
    attempt_count: number;
    payload: Record<string, string>;
  }>>`
    SELECT id, projection_key, row_number, state, attempt_count, payload
    FROM sheet_projection_rows
    WHERE spreadsheet_id = ${spreadsheetId} AND tab_name = ${tabName}
    ORDER BY row_number
  `;
}

/**
 * `claim_sheet_projection_rows` scopes by state/availability, not by
 * spreadsheet — drain any pending/failed_retryable row left over from an
 * earlier test in this file before a test relies on exact global claim/
 * completed/failed counts.
 */
async function drainPending() {
  for (let round = 0; round < 20; round++) {
    const result = await flushSheetProjections(
      { worker_id: `drain-${randomUUID()}`, limit: 50 },
      { sql: db!, provider: new FakeSheetsProvider() },
    );
    if (result.claimed === 0) return;
  }
  throw new Error('drainPending: too many rounds');
}

run('sheet projection idempotency', () => {
  it('replaying enqueue 10x for the same lead keeps a single outbox row and a single sheet row', async () => {
    const workspaceId = await workspaceFixture();
    const contactId = await contactFixture();
    const spreadsheetId = randomUUID();

    for (let i = 0; i < 10; i++) {
      await enqueueLeadProjection(leadInput(workspaceId, contactId, spreadsheetId), { sql: db! });
    }

    const rows = await outboxRowsFor(spreadsheetId, TAB_NAME);
    expect(rows).toHaveLength(1);
    expect(rows[0].projection_key).toBe(leadProjectionKey(workspaceId, contactId));

    const provider = new FakeSheetsProvider();
    const result = await flushSheetProjections({ worker_id: 'w1', limit: 5 }, { sql: db!, provider });
    expect(result.completed).toBe(1);
    expect(provider.writtenRowCount).toBe(1);

    // Draining again with no new enqueue call must claim nothing more.
    const second = await flushSheetProjections({ worker_id: 'w2', limit: 5 }, { sql: db!, provider });
    expect(second.claimed).toBe(0);
    expect(provider.writtenRowCount).toBe(1);
  });

  it('two distinct contacts produce two outbox rows with distinct row numbers', async () => {
    const workspaceId = await workspaceFixture();
    const spreadsheetId = randomUUID();
    const contactA = await contactFixture();
    const contactB = await contactFixture();

    const a = await enqueueLeadProjection(leadInput(workspaceId, contactA, spreadsheetId), { sql: db! });
    const b = await enqueueLeadProjection(leadInput(workspaceId, contactB, spreadsheetId), { sql: db! });

    expect(a.rowNumber).not.toBe(b.rowNumber);
    const rows = await outboxRowsFor(spreadsheetId, TAB_NAME);
    expect(rows).toHaveLength(2);
  });

  it('preserves a human-set estado_alta=hecha_por_operador across later re-projections', async () => {
    const workspaceId = await workspaceFixture();
    const spreadsheetId = randomUUID();
    const contactId = await contactFixture();

    const first = await enqueueLeadProjection(leadInput(workspaceId, contactId, spreadsheetId), { sql: db! });
    // Simulates an operator marking the row done: the row's last-known state
    // (our outbox payload) is what a later re-projection reads back from.
    await db!`
      UPDATE sheet_projection_rows
      SET payload = jsonb_set(payload, '{estado_alta}', '"hecha_por_operador"')
      WHERE id = ${first.id}
    `;

    // A new commercial signal re-projects the same row.
    await enqueueLeadProjection(
      leadInput(workspaceId, contactId, spreadsheetId, {
        etapaComercial: 'hot_lead',
        ultimaSenal: 'mark_hot_lead',
      }),
      { sql: db! },
    );

    const rows = await outboxRowsFor(spreadsheetId, TAB_NAME);
    expect(rows).toHaveLength(1);
    expect(rows[0].payload.estado_alta).toBe('hecha_por_operador');
    expect(rows[0].payload.etapa_comercial).toBe('hot_lead');
  });

  it('a provider timeout during flush leaves the outbox row retryable with an incremented attempt count', async () => {
    // `claim_sheet_projection_rows` claims globally across every spreadsheet,
    // not just this test's own — drain whatever the earlier enqueue-only
    // tests in this file left pending so the flush below claims exactly the
    // one row this test cares about.
    await drainPending();

    const workspaceId = await workspaceFixture();
    const spreadsheetId = randomUUID();
    const contactId = await contactFixture();
    await enqueueLeadProjection(leadInput(workspaceId, contactId, spreadsheetId), { sql: db! });

    const provider = new FakeSheetsProvider();
    provider.simulateTimeouts(1);

    const result = await flushSheetProjections({ worker_id: 'timeout-worker', limit: 5 }, { sql: db!, provider });
    expect(result.completed).toBe(0);
    expect(result.failed).toBe(1);

    const rows = await outboxRowsFor(spreadsheetId, TAB_NAME);
    expect(rows).toHaveLength(1);
    expect(rows[0].state).toBe('failed_retryable');
    expect(rows[0].attempt_count).toBe(1);
    expect(provider.writtenRowCount).toBe(0);

    // Retryable means exactly that: forcing availability and flushing again
    // with a healthy provider succeeds, and none of this ever threw into the
    // caller.
    await db!`
      UPDATE sheet_projection_rows SET available_at = now() - interval '1 second' WHERE id = ${rows[0].id}
    `;
    const retry = await flushSheetProjections({ worker_id: 'retry-worker', limit: 5 }, { sql: db!, provider });
    expect(retry.completed).toBe(1);

    const finalRows = await outboxRowsFor(spreadsheetId, TAB_NAME);
    expect(finalRows[0].state).toBe('projected');
    expect(finalRows[0].attempt_count).toBe(2);
  });
});
