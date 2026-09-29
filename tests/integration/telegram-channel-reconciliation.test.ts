import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { openLocalTestDatabase } from '../helpers/db';
import { processInboundMessage, type InboundEnvelope } from '@/lib/services/ingestion.service';
import { sql } from '@/lib/db/orchestrator';

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const db = process.env.TEST_DATABASE_URL ? openLocalTestDatabase() : null;
const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/20260929010001_reclassify_telegram_sandbox_channel.sql',
);

afterAll(async () => {
  await db?.end();
  await sql.end();
});

function inbound(input: {
  readonly provider: 'telegram_sandbox' | null;
  readonly channel?: 'whatsapp' | 'telegram';
}): InboundEnvelope {
  const identity = randomUUID();
  const digits = identity.replace(/\D/gu, '').slice(0, 10).padEnd(10, '7');
  return {
    schema_version: 1,
    source: 'botpress',
    channel: input.channel ?? 'whatsapp',
    integration_id: input.provider ? 'telegram' : 'whatsapp',
    external_message_id: `message-${identity}`,
    external_conversation_id: input.provider ? `tg:chat:${identity}` : `wa:chat:${identity}`,
    external_user_id: input.provider ? `tg:user:${identity}` : `wa:user:${identity}`,
    phone_e164: input.provider ? `+999${digits}` : `+549${digits}`,
    trace_id: randomUUID(),
    message: {
      type: 'text',
      text: 'Hola',
      occurred_at: new Date().toISOString(),
      reply_to_external_message_id: null,
      audio_reference: null,
      metadata: {},
    },
    sandbox_provider: input.provider,
    botpress_conversation_id: `bp:${identity}`,
    botpress_user_id: `bp-user:${identity}`,
  };
}

async function applyMigration(): Promise<void> {
  const source = existsSync(migrationPath)
    ? readFileSync(migrationPath, 'utf8')
    : 'SELECT 1';
  await db!.unsafe(source);
}

run('Telegram sandbox channel reconciliation migration', () => {
  it('reclassifies only proven Telegram sandbox state and is idempotent', async () => {
    // Reproduce the historical adapter contract: Telegram transport recorded
    // as WhatsApp plus the independent sandbox marker.
    const historical = await processInboundMessage(inbound({
      provider: 'telegram_sandbox',
      channel: 'whatsapp',
    }));
    const realWhatsApp = await processInboundMessage(inbound({ provider: null }));

    const [historicalOutbound] = await db!<Array<{ id: string }>>`
      INSERT INTO messages (
        conversation_id, contact_id, direction, content, conversation_seq
      ) VALUES (
        ${historical.conversation_id}::uuid,
        ${historical.contact.id}::uuid,
        'outbound',
        'Intento histórico',
        2
      )
      RETURNING id
    `;
    const [historicalDelivery] = await db!<Array<{ id: string }>>`
      INSERT INTO outbound_deliveries (
        message_id, conversation_id, contact_id, provider, integration_id,
        channel, purpose, destination, idempotency_key, state
      ) VALUES (
        ${historicalOutbound.id}::uuid,
        ${historical.conversation_id}::uuid,
        ${historical.contact.id}::uuid,
        'botpress',
        'telegram',
        'whatsapp',
        'transactional',
        'bp:historical',
        ${`historical:${randomUUID()}`},
        'submitted'
      )
      RETURNING id
    `;
    await db!`
      INSERT INTO channel_events (
        provider, integration_id, channel, event_kind, direction,
        external_event_id, payload_hash, contact_id, channel_thread_id,
        status, processed_at
      )
      SELECT
        'botpress', 'telegram', 'whatsapp', 'delivery_update', 'outbound',
        ${`delivery:${randomUUID()}`}, digest('historical-delivery', 'sha256'),
        conversation.contact_id, conversation.channel_thread_id,
        'processed', now()
      FROM conversations AS conversation
      WHERE conversation.id = ${historical.conversation_id}::uuid
    `;

    // Exercise the collision branch. A current Telegram permission may already
    // exist after a partial rollout while the historical WhatsApp projection
    // for the same sandbox contact remains.
    await db!`
      INSERT INTO contact_channel_permissions (
        contact_id, channel, consent_status, consent_source,
        reply_window_expires_at, changed_at
      ) VALUES (
        ${historical.contact.id}::uuid, 'telegram', 'granted', 'partial_rollout',
        now() + interval '1 hour', now() + interval '1 second'
      )
    `;

    await applyMigration();
    await applyMigration();

    await expect(db!`
      SELECT channel FROM channel_threads
      WHERE contact_id = ${historical.contact.id}::uuid
    `).resolves.toEqual([{ channel: 'telegram' }]);
    await expect(db!`
      SELECT channel FROM channel_events
      WHERE contact_id = ${historical.contact.id}::uuid
      ORDER BY created_at
    `).resolves.toEqual([{ channel: 'telegram' }, { channel: 'telegram' }]);
    await expect(db!`
      SELECT channel FROM conversations
      WHERE contact_id = ${historical.contact.id}::uuid
    `).resolves.toEqual([{ channel: 'telegram' }]);
    await expect(db!`
      SELECT channel, consent_status FROM contact_channel_permissions
      WHERE contact_id = ${historical.contact.id}::uuid
    `).resolves.toEqual([{ channel: 'telegram', consent_status: 'granted' }]);
    await expect(db!`
      SELECT channel_origin FROM contacts WHERE id = ${historical.contact.id}::uuid
    `).resolves.toEqual([{ channel_origin: 'telegram' }]);
    await expect(db!`
      SELECT source_channel FROM workspace_contacts
      WHERE contact_id = ${historical.contact.id}::uuid
    `).resolves.toEqual([{ source_channel: 'telegram' }]);
    await expect(db!`
      SELECT channel FROM outbound_deliveries
      WHERE id = ${historicalDelivery.id}::uuid
    `).resolves.toEqual([{ channel: 'whatsapp' }]);

    // Positive sandbox evidence is mandatory: real WhatsApp remains unchanged.
    await expect(db!`
      SELECT thread.channel, contact.channel_origin
      FROM channel_threads AS thread
      JOIN contacts AS contact ON contact.id = thread.contact_id
      WHERE thread.contact_id = ${realWhatsApp.contact.id}::uuid
    `).resolves.toEqual([{ channel: 'whatsapp', channel_origin: 'whatsapp' }]);

    await expect(db!`
      SELECT count(*)::integer AS count
      FROM channel_threads
      WHERE provider = 'telegram_sandbox' AND channel = 'whatsapp'
    `).resolves.toEqual([{ count: 0 }]);
  });
});
