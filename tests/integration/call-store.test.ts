import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { hashCallContext } from '@/features/calls/domain/call-context';
import { PostgresCallStore } from '@/features/calls/adapters/postgres-call-store';
import { openIndependentLocalTestDatabases, openLocalTestDatabase } from '../helpers/db';

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const db = process.env.TEST_DATABASE_URL ? openLocalTestDatabase() : null;
afterAll(async () => db?.end());

async function fixture() {
  const callId = randomUUID();
  const phone = `+999${Math.floor(10_000_000 + Math.random() * 89_999_999).toString().padStart(10, '0')}`;
  const contacts = await db!<Array<{ id: string }>>`INSERT INTO contacts (phone, channel_origin) VALUES (${phone}, 'whatsapp') RETURNING id`;
  const conversations = await db!<Array<{ id: string }>>`INSERT INTO conversations (contact_id, channel) VALUES (${contacts[0].id}::uuid, 'whatsapp') RETURNING id`;
  const messages = await db!<Array<{ id: string }>>`INSERT INTO messages (conversation_id, contact_id, direction, content) VALUES (${conversations[0].id}::uuid, ${contacts[0].id}::uuid, 'inbound', 'Llamame') RETURNING id`;
  const context = { call_id: callId, nombre_lead: '', curso_interes: 'Python', pais: '', email_lead: '', resumen_whatsapp: 'Llamada preautorizada.', prompt_version: 'agent-b-v1' };
  await db!`
    INSERT INTO call_sessions (
      id, source_turn_id, contact_id, conversation_id, provider, request_idempotency_key,
      status, consent_source_message_id, context_snapshot, context_hash, prompt_version
    ) VALUES (
      ${callId}::uuid, ${messages[0].id}::uuid, ${contacts[0].id}::uuid, ${conversations[0].id}::uuid,
      'telegram_sandbox', ${`voice-call:${callId}`}, 'requested', ${messages[0].id}::uuid,
      ${db!.json(context)}, decode(${hashCallContext(context)}, 'hex'), 'agent-b-v1'
    )
  `;
  return { callId };
}

run('PostgresCallStore', () => {
  it('fences concurrent dispatch claims and returns the accepted replay', async () => {
    const { callId } = await fixture();
    const clients = openIndependentLocalTestDatabases(2);
    try {
      const [first, second] = await Promise.all([
        new PostgresCallStore(clients[0]).claimDispatch(callId, 'worker-1'),
        new PostgresCallStore(clients[1]).claimDispatch(callId, 'worker-2'),
      ]);
      expect([first.outcome, second.outcome].sort()).toEqual(['busy', 'claimed']);
      const owner = first.outcome === 'claimed' ? new PostgresCallStore(clients[0]) : new PostgresCallStore(clients[1]);
      const providerCallId = `telegram:test:${randomUUID()}`;
      await owner.attachProviderCall(callId, providerCallId, '2026-08-16T12:00:00.000Z');
      await expect(new PostgresCallStore(clients[0]).claimDispatch(callId, 'worker-3'))
        .resolves.toEqual({ outcome: 'provider_accepted', providerCallId });
    } finally {
      await Promise.all(clients.map((client) => client.end()));
    }
  });

  it('deduplicates an identical event and rejects a changed replay', async () => {
    const { callId } = await fixture();
    const store = new PostgresCallStore(db!);
    const event = {
      schema_version: 1 as const, event_id: `started:${randomUUID()}`, call_id: callId,
      event_type: 'started' as const, sequence: 1, occurred_at: '2026-08-16T12:00:00.000Z',
      provider: 'telegram_sandbox' as const,
      payload: { event_type: 'started' as const, started_at: '2026-08-16T12:00:00.000Z' },
    };
    await expect(store.appendEvent(event)).resolves.toBe('recorded');
    await expect(store.appendEvent(event)).resolves.toBe('duplicate');
    await expect(store.appendEvent({ ...event, sequence: 2 })).rejects.toThrow('CALL_EVENT_REPLAY_CONFLICT');
  });
});
