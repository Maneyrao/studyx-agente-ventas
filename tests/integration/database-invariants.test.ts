import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { openIndependentLocalTestDatabases, openLocalTestDatabase } from '../helpers/db';

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const db = process.env.TEST_DATABASE_URL ? openLocalTestDatabase() : null;

afterAll(async () => db?.end());

run('database invariants under replay and bad integration writes', () => {
  it('returns one event identity to ten independent replaying connections', async () => {
    const externalId = `ten-replays-${randomUUID()}`;
    const clients = openIndependentLocalTestDatabases(10);
    try {
      const results = await Promise.all(clients.map((client) => client<Array<{
        event_id: string;
        was_created: boolean;
        payload_matches: boolean;
      }>>`
        SELECT event_id, was_created, payload_matches
        FROM reserve_inbound_channel_event(
          'botpress_emulator',
          'vitest-concurrency',
          'whatsapp',
          ${externalId},
          ${externalId},
          ${externalId},
          decode(${''.padStart(64, 'b')}, 'hex'),
          '{"content":"same"}'::jsonb
        )
      `));
      const rows = results.flat();
      expect(new Set(rows.map((row) => row.event_id)).size).toBe(1);
      expect(rows.filter((row) => row.was_created)).toHaveLength(1);
      expect(rows.every((row) => row.payload_matches)).toBe(true);
    } finally {
      await Promise.all(clients.map((client) => client.end()));
    }
  });

  it('exposes changed replay payload as a conflict without adding another event', async () => {
    const externalId = `payload-conflict-${randomUUID()}`;
    const first = await db!`
      SELECT * FROM reserve_inbound_channel_event(
        'botpress_emulator', 'vitest-concurrency', 'whatsapp',
        ${externalId}, ${externalId}, ${externalId},
        decode(${''.padStart(64, 'c')}, 'hex'), '{"version":1}'::jsonb
      )
    `;
    const second = await db!<Array<{ event_id: string; payload_matches: boolean }>>`
      SELECT event_id, payload_matches FROM reserve_inbound_channel_event(
        'botpress_emulator', 'vitest-concurrency', 'whatsapp',
        ${externalId}, ${externalId}, ${externalId},
        decode(${''.padStart(64, 'd')}, 'hex'), '{"version":2}'::jsonb
      )
    `;
    expect(second[0].event_id).toBe(first[0].event_id);
    expect(second[0].payload_matches).toBe(false);
    const count = await db!<Array<{ count: number }>>`
      SELECT count(*)::integer AS count FROM channel_events WHERE external_message_id = ${externalId}
    `;
    expect(count[0].count).toBe(1);
  });

  it('rejects an embedding that claims another contact', async () => {
    const suffix = Math.floor(10_000_000 + Math.random() * 89_999_999);
    const contacts = await db!<Array<{ id: string }>>`
      INSERT INTO contacts (phone, channel_origin)
      VALUES (${`+54911${suffix}`}, 'whatsapp'), (${`+54912${suffix}`}, 'whatsapp')
      RETURNING id
    `;
    const conversations = await db!<Array<{ id: string }>>`
      INSERT INTO conversations (contact_id, channel)
      VALUES (${contacts[0].id}::uuid, 'whatsapp')
      RETURNING id
    `;
    const messages = await db!<Array<{ id: string }>>`
      INSERT INTO messages (conversation_id, contact_id, direction, content)
      VALUES (${conversations[0].id}::uuid, ${contacts[0].id}::uuid, 'inbound', 'aislamiento')
      RETURNING id
    `;
    await expect(db!`
      INSERT INTO message_embeddings (message_id, contact_id, embedding, status)
      VALUES (
        ${messages[0].id}::uuid,
        ${contacts[1].id}::uuid,
        (ARRAY[1] || array_fill(0, ARRAY[1535]))::extensions.vector,
        'indexed'
      )
    `).rejects.toMatchObject({ code: '23503' });
  });

  it('allows only one of five embedding workers to claim one source message', async () => {
    await db!`
      UPDATE embedding_jobs
      SET status = 'skipped', completed_at = now()
      WHERE status IN ('pending', 'leased', 'failed_retryable')
    `;
    const phone = `+54913${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
    const contacts = await db!<Array<{ id: string }>>`
      INSERT INTO contacts (phone, channel_origin) VALUES (${phone}, 'whatsapp') RETURNING id
    `;
    const conversations = await db!<Array<{ id: string }>>`
      INSERT INTO conversations (contact_id, channel)
      VALUES (${contacts[0].id}::uuid, 'whatsapp') RETURNING id
    `;
    const messages = await db!<Array<{ id: string }>>`
      INSERT INTO messages (conversation_id, contact_id, direction, content)
      VALUES (${conversations[0].id}::uuid, ${contacts[0].id}::uuid, 'inbound', 'job único')
      RETURNING id
    `;
    await db!`
      INSERT INTO message_embeddings (message_id, contact_id, embedding, status)
      VALUES (${messages[0].id}::uuid, ${contacts[0].id}::uuid, NULL, 'pending')
    `;

    const clients = openIndependentLocalTestDatabases(5);
    try {
      const claims = (await Promise.all(clients.map((client, index) => client<Array<{ message_id: string }>>`
        SELECT message_id FROM claim_embedding_jobs(${`embedding-worker-${index}`}, 1, 60)
      `))).flat();
      expect(claims).toHaveLength(1);
      expect(claims[0].message_id).toBe(messages[0].id);
    } finally {
      await Promise.all(clients.map((client) => client.end()));
    }
  });

  it('allows only one of five outbox workers to claim one delivery', async () => {
    await db!`
      UPDATE outbox_events SET state = 'cancelled'
      WHERE state IN ('pending', 'leased', 'failed_retryable')
    `;
    await db!`
      UPDATE outbound_deliveries SET state = 'cancelled'
      WHERE state IN ('pending', 'leased', 'failed_retryable')
    `;
    const phone = `+54914${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
    const contacts = await db!<Array<{ id: string }>>`
      INSERT INTO contacts (phone, channel_origin) VALUES (${phone}, 'whatsapp') RETURNING id
    `;
    const conversations = await db!<Array<{ id: string }>>`
      INSERT INTO conversations (contact_id, channel)
      VALUES (${contacts[0].id}::uuid, 'whatsapp') RETURNING id
    `;
    const inbound = await db!<Array<{ id: string }>>`
      INSERT INTO messages (conversation_id, contact_id, direction, content)
      VALUES (${conversations[0].id}::uuid, ${contacts[0].id}::uuid, 'inbound', 'pregunta')
      RETURNING id
    `;
    const outbound = await db!<Array<{ id: string }>>`
      INSERT INTO messages (conversation_id, contact_id, direction, content, in_reply_to)
      VALUES (
        ${conversations[0].id}::uuid,
        ${contacts[0].id}::uuid,
        'outbound',
        'respuesta',
        ${inbound[0].id}::uuid
      )
      RETURNING id
    `;
    const queued = await db!<Array<{ outbox_id: string }>>`
      SELECT outbox_id FROM enqueue_outbound_delivery(
        ${outbound[0].id}::uuid,
        'botpress_emulator',
        'vitest-workers',
        'whatsapp',
        'conversational',
        ${phone},
        ${`outbound:${outbound[0].id}`},
        ${JSON.stringify({ outbound_id: outbound[0].id })}::jsonb,
        3
      )
    `;

    const clients = openIndependentLocalTestDatabases(5);
    try {
      const claims = (await Promise.all(clients.map((client, index) => client<Array<{ id: string }>>`
        SELECT id FROM claim_outbox_events(${`outbox-worker-${index}`}, 1, 60)
      `))).flat();
      expect(claims).toHaveLength(1);
      expect(claims[0].id).toBe(queued[0].outbox_id);
    } finally {
      await Promise.all(clients.map((client) => client.end()));
    }
  });

  it('keeps the orchestrator role inside its least-privilege boundary', async () => {
    const contacts = await db!<Array<{ id: string }>>`SELECT id FROM contacts LIMIT 1`;
    const eventKey = `role-boundary-${randomUUID()}`;
    await db!.begin(async (tx) => {
      await tx`SET LOCAL ROLE orchestrator_role`;
      await tx`
        SELECT append_audit_event_atomic(
          'orchestrator',
          'role.boundary.checked',
          'contact',
          ${contacts[0].id}::uuid,
          '{}'::jsonb,
          ${eventKey},
          NULL,
          NULL,
          NULL
        )
      `;
      await tx`SELECT id FROM channel_events LIMIT 1`;
    });
    const audit = await db!`SELECT id FROM audit_log WHERE event_key = ${eventKey}`;
    expect(audit).toHaveLength(1);

    await expect(db!.begin(async (tx) => {
      await tx`SET LOCAL ROLE orchestrator_role`;
      await tx`SELECT id FROM audit_log LIMIT 1`;
    })).rejects.toMatchObject({ code: '42501' });

    await expect(db!.begin(async (tx) => {
      await tx`SET LOCAL ROLE orchestrator_role`;
      await tx`DELETE FROM contacts WHERE id = ${contacts[0].id}::uuid`;
    })).rejects.toMatchObject({ code: '42501' });
  });
});
