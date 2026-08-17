import { createHash, randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { openLocalTestDatabase } from '../helpers/db';

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const db = process.env.TEST_DATABASE_URL ? openLocalTestDatabase() : null;
afterAll(async () => db?.end());

async function createFixture() {
  const suffix = Math.floor(10_000_000 + Math.random() * 89_999_999);
  const contacts = await db!<Array<{ id: string }>>`
    INSERT INTO contacts (phone, channel_origin, name)
    VALUES (${`+999${suffix.toString().padStart(10, '0')}`}, 'whatsapp', 'Sandbox')
    RETURNING id
  `;
  const conversations = await db!<Array<{ id: string }>>`
    INSERT INTO conversations (contact_id, channel)
    VALUES (${contacts[0].id}::uuid, 'whatsapp') RETURNING id
  `;
  const messages = await db!<Array<{ id: string }>>`
    INSERT INTO messages (conversation_id, contact_id, direction, content)
    VALUES (${conversations[0].id}::uuid, ${contacts[0].id}::uuid, 'inbound', 'Llamame')
    RETURNING id
  `;
  return { contactId: contacts[0].id, conversationId: conversations[0].id, turnId: messages[0].id };
}

async function insertCall(fixture: Awaited<ReturnType<typeof createFixture>>, overrides: { sourceTurnId?: string; idempotencyKey?: string } = {}) {
  const id = randomUUID();
  const context = {
    call_id: id, nombre_lead: 'Sandbox', curso_interes: 'Python', pais: 'AR', email_lead: '',
    resumen_whatsapp: 'Pidió llamada.', prompt_version: 'agent-b-v1',
  };
  const rows = await db!<Array<{ id: string }>>`
    INSERT INTO call_sessions (
      id, source_turn_id, contact_id, conversation_id, provider,
      request_idempotency_key, status, analysis_status, consent_source_message_id,
      context_snapshot, context_hash, prompt_version
    ) VALUES (
      ${id}::uuid, ${overrides.sourceTurnId ?? fixture.turnId}::uuid,
      ${fixture.contactId}::uuid, ${fixture.conversationId}::uuid, 'telegram_sandbox',
      ${overrides.idempotencyKey ?? `voice-call:${id}`}, 'requested', 'pending', ${fixture.turnId}::uuid,
      ${db!.json(context)}, decode(${'a'.repeat(64)}, 'hex'), 'agent-b-v1'
    ) RETURNING id
  `;
  return { id: rows[0].id, context };
}

run('Agent B durable call ledger', () => {
  it('allows only one active call per contact and one call per source turn', async () => {
    const fixture = await createFixture();
    await insertCall(fixture);
    const secondTurn = await db!<Array<{ id: string }>>`
      INSERT INTO messages (conversation_id, contact_id, direction, content)
      VALUES (${fixture.conversationId}::uuid, ${fixture.contactId}::uuid, 'inbound', 'Otra vez') RETURNING id
    `;
    await expect(insertCall(fixture, { sourceTurnId: secondTurn[0].id })).rejects.toMatchObject({ code: '23505' });

    const other = await createFixture();
    await insertCall(other);
    await expect(insertCall(other, { idempotencyKey: `other:${randomUUID()}` })).rejects.toMatchObject({ code: '23505' });
  });

  it('keeps context identity immutable and terminal state terminal', async () => {
    const fixture = await createFixture();
    const call = await insertCall(fixture);
    await expect(db!`UPDATE call_sessions SET context_snapshot = '{}'::jsonb WHERE id = ${call.id}::uuid`)
      .rejects.toMatchObject({ code: '23514' });
    await db!`UPDATE call_sessions SET status = 'completed', completed_at = now() WHERE id = ${call.id}::uuid`;
    await expect(db!`UPDATE call_sessions SET status = 'dispatching' WHERE id = ${call.id}::uuid`)
      .rejects.toMatchObject({ code: '23514' });
  });

  it('deduplicates provider events and makes their payload append-only', async () => {
    const fixture = await createFixture();
    const call = await insertCall(fixture);
    const eventId = `telegram:started:${randomUUID()}`;
    await db!`
      INSERT INTO call_events (call_id, provider, event_id, event_type, sequence, occurred_at, payload, payload_hash)
      VALUES (${call.id}::uuid, 'telegram_sandbox', ${eventId}, 'started', 1, now(),
        '{"event_type":"started","started_at":"2026-08-16T12:00:00.000Z"}'::jsonb,
        decode(${'b'.repeat(64)}, 'hex'))
    `;
    await expect(db!`
      INSERT INTO call_events (call_id, provider, event_id, event_type, sequence, occurred_at, payload, payload_hash)
      VALUES (${call.id}::uuid, 'telegram_sandbox', ${eventId}, 'started', 1, now(), '{}'::jsonb, decode(${'c'.repeat(64)}, 'hex'))
    `).rejects.toMatchObject({ code: '23505' });
    await expect(db!`UPDATE call_events SET payload = '{}'::jsonb WHERE event_id = ${eventId}`)
      .rejects.toMatchObject({ code: '23514' });
  });

  it('reserves one context receipt per idempotency key and nonce hash', async () => {
    const fixture = await createFixture();
    const call = await insertCall(fixture);
    const idempotencyKey = `receipt:${call.id}`;
    const nonceHash = createHash('sha256').update(randomUUID()).digest('hex');
    const ack = {
      schema_version: 1, event: 'context_loaded', call_id: call.id, context_hash: 'a'.repeat(64),
      received_fields: ['call_id', 'nombre_lead', 'curso_interes', 'pais', 'email_lead', 'resumen_whatsapp', 'prompt_version'],
      missing_fields: [], status: 'accepted', loaded_at: '2026-08-16T12:00:00.000Z',
    };
    await db!`
      INSERT INTO call_context_receipts (
        call_id, idempotency_key, context_hash, ack, delivery_status,
        telegram_chat_id, telegram_user_id, nonce_hash, expires_at
      ) VALUES (
        ${call.id}::uuid, ${idempotencyKey}, decode(${'a'.repeat(64)}, 'hex'), ${db!.json(ack)},
        'pending', 'chat-1', 'user-1', decode(${nonceHash}, 'hex'), now() + interval '15 minutes'
      )
    `;
    await expect(db!`
      INSERT INTO call_context_receipts (
        call_id, idempotency_key, context_hash, ack, delivery_status,
        telegram_chat_id, telegram_user_id, nonce_hash, expires_at
      ) VALUES (
        ${call.id}::uuid, ${idempotencyKey}, decode(${'a'.repeat(64)}, 'hex'), ${db!.json(ack)},
        'pending', 'chat-1', 'user-1', decode(${nonceHash}, 'hex'), now() + interval '15 minutes'
      )
    `).rejects.toMatchObject({ code: '23505' });
  });
});
