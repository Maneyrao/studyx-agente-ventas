import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { openLocalTestDatabase } from '../helpers/db';
import { processInboundMessage, type InboundEnvelope } from '@/lib/services/ingestion.service';
import { sql } from '@/lib/db/orchestrator';
import { createSandboxLookup } from '@/lib/repositories/sandbox-identity.repository';
import { GoogleSheetsProvider } from '@/lib/providers/sheets/google-sheets-provider';
import { SHEET_COLUMN_ORDER, type SheetRowValues } from '@/lib/providers/sheets/sheets-provider';

const googleBoundary = vi.hoisted(() => {
  const update = vi.fn().mockResolvedValue({});
  return { update, client: vi.fn(() => ({ spreadsheets: { values: { update } } })) };
});
vi.mock('googleapis', () => ({
  google: {
    sheets: googleBoundary.client,
    auth: { JWT: class {}, GoogleAuth: class {} },
  },
}));

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const db = process.env.TEST_DATABASE_URL ? openLocalTestDatabase() : null;

afterAll(async () => { await db?.end(); await sql.end(); });
beforeEach(() => vi.clearAllMocks());

function envelope(overrides: Partial<InboundEnvelope> = {}): InboundEnvelope {
  const identity = randomUUID();
  const digits = identity.replace(/\D/g, '').slice(0, 10).padEnd(10, '7');
  return {
    schema_version: 1, source: 'botpress', channel: 'whatsapp',
    integration_id: 'vitest-telegram-sandbox-intake',
    external_message_id: `message-${identity}`,
    external_conversation_id: `conversation-${identity}`,
    external_user_id: digits,
    phone_e164: `+999${digits}`,
    trace_id: randomUUID(), sandbox_provider: 'telegram_sandbox',
    message: { type: 'text', text: 'Hola', occurred_at: new Date().toISOString(),
      reply_to_external_message_id: null, audio_reference: null, metadata: {} },
    ...overrides,
  } as InboundEnvelope;
}

function nextMessage(first: InboundEnvelope, overrides: Partial<InboundEnvelope> = {}): InboundEnvelope {
  return { ...first, external_message_id: `message-${randomUUID()}`, trace_id: randomUUID(), ...overrides };
}

run('Telegram sandbox intake boundary', () => {
  it('commits the sandbox lock with the first inbound and keeps it idempotent on replay and follow-up', async () => {
    const first = envelope();
    const accepted = await processInboundMessage(first);
    const rows = await db!`SELECT provider, external_user_id, contact_id, synthetic_phone
      FROM sandbox_identities WHERE contact_id = ${accepted.contact.id}::uuid`;
    expect(rows).toEqual([{ provider: 'telegram_sandbox', external_user_id: first.external_user_id,
      contact_id: accepted.contact.id, synthetic_phone: first.phone_e164 }]);
    const replay = await processInboundMessage({ ...first, trace_id: randomUUID() });
    const followUp = await processInboundMessage(nextMessage(first));
    expect(replay.status).toBe('duplicate');
    expect(followUp.contact.id).toBe(accepted.contact.id);
    expect(await db!`SELECT id FROM sandbox_identities WHERE contact_id = ${accepted.contact.id}::uuid`).toHaveLength(1);
  });

  it('blocks a real Sheets adapter before client construction or network after sandbox intake', async () => {
    const accepted = await processInboundMessage(envelope());
    const provider = new GoogleSheetsProvider(createSandboxLookup(db!));
    const values = Object.fromEntries(SHEET_COLUMN_ORDER.map(column => [column, ''])) as SheetRowValues;
    await expect(provider.updateRow({ contactId: accepted.contact.id, spreadsheetId: 'fixture-sheet',
      tabName: 'Fixture', rowNumber: 2, values })).rejects.toMatchObject({ code: 'CONTACT_IS_SANDBOX' });
    expect(googleBoundary.client).not.toHaveBeenCalled();
    expect(googleBoundary.update).not.toHaveBeenCalled();
  });

  it('does not infer sandbox status from a synthetic-looking phone without the explicit provider', async () => {
    const accepted = await processInboundMessage(envelope({ sandbox_provider: null }));
    expect(await db!`SELECT id FROM sandbox_identities WHERE contact_id = ${accepted.contact.id}::uuid`).toHaveLength(0);
  });

  it('locks an existing contact when a new explicit sandbox inbound resolves that contact', async () => {
    const first = envelope({ sandbox_provider: null });
    const prior = await processInboundMessage(first);
    const sandbox = await processInboundMessage(nextMessage(first, { sandbox_provider: 'telegram_sandbox' }));
    expect(sandbox.contact.id).toBe(prior.contact.id);
    expect(await createSandboxLookup(db!).findSandboxProvider(prior.contact.id)).toBe('telegram_sandbox');
  });

  it('fails closed and rolls back an inbound whose sandbox user is already bound to another contact', async () => {
    const first = envelope();
    const original = await processInboundMessage(first);
    const conflicting = nextMessage(first, { phone_e164: envelope().phone_e164,
      external_conversation_id: `conversation-${randomUUID()}` });
    await expect(processInboundMessage(conflicting)).rejects.toThrow('SANDBOX_IDENTITY_CONFLICT');
    expect(await db!`SELECT id FROM contacts WHERE phone = ${conflicting.phone_e164}`).toHaveLength(0);
    expect(await createSandboxLookup(db!).findSandboxProvider(original.contact.id)).toBe('telegram_sandbox');
  });
});
