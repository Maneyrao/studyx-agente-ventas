import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { openLocalTestDatabase } from '../helpers/db';
import { processInboundMessage, type InboundEnvelope } from '@/lib/services/ingestion.service';
import { sql } from '@/lib/db/orchestrator';

/**
 * Feature 007 — ingestion stopped forcing `channel = 'whatsapp'`.
 *
 * That line filed every inbound identity as WhatsApp, which is why a Telegram
 * contact could never be reached on Telegram. Deriving the channel is a
 * one-line change on a path that is already in production, so these tests exist
 * mainly to prove the existing behaviour did not move: `emulator` must keep
 * mapping to `whatsapp`, because every row already stored under it means that.
 */

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const db = process.env.TEST_DATABASE_URL ? openLocalTestDatabase() : null;

afterAll(async () => {
  await db?.end();
  await sql.end();
});

function envelope(overrides: Partial<InboundEnvelope> = {}): InboundEnvelope {
  const identity = randomUUID();
  const digits = identity.replace(/\D/g, '').slice(0, 9).padEnd(9, '1');
  return {
    schema_version: 1,
    source: 'botpress',
    channel: 'whatsapp',
    integration_id: 'vitest-channel-derivation',
    external_message_id: `message-${identity}`,
    external_conversation_id: `conversation-${identity}`,
    external_user_id: `user-${identity}`,
    phone_e164: `+5491${digits}`,
    trace_id: randomUUID(),
    message: {
      type: 'text',
      text: 'hola',
      occurred_at: new Date().toISOString(),
      reply_to_external_message_id: null,
      audio_reference: null,
      metadata: {},
    },
    ...overrides,
  } as InboundEnvelope;
}

async function storedChannels(externalConversationId: string) {
  const rows = await db!<Array<{ channel: string }>>`
    SELECT channel FROM channel_threads WHERE external_conversation_id = ${externalConversationId}
  `;
  return rows.map((row) => row.channel);
}

run('inbound channel derivation', () => {
  it('keeps filing a WhatsApp inbound as whatsapp', async () => {
    const inbound = envelope({ channel: 'whatsapp' });
    await processInboundMessage(inbound);
    expect(await storedChannels(inbound.external_conversation_id)).toEqual(['whatsapp']);
  });

  // The emulator simulates a WhatsApp conversation. Giving it a channel of its
  // own would change the meaning of every row already stored under it.
  it('still maps the emulator to whatsapp, unchanged', async () => {
    const inbound = envelope({ channel: 'emulator' });
    await processInboundMessage(inbound);
    expect(await storedChannels(inbound.external_conversation_id)).toEqual(['whatsapp']);
  });

  it('files a Telegram inbound as telegram, so it can be replied to there', async () => {
    const inbound = envelope({ channel: 'telegram' });
    await processInboundMessage(inbound);
    expect(await storedChannels(inbound.external_conversation_id)).toEqual(['telegram']);
  });

  // FR-030: the identity link is idempotent by construction, via the existing
  // ON CONFLICT on (provider, integration_id, external_conversation_id).
  it('links a repeated Telegram sender only once', async () => {
    const first = envelope({ channel: 'telegram' });
    await processInboundMessage(first);
    await processInboundMessage(envelope({
      channel: 'telegram',
      external_conversation_id: first.external_conversation_id,
      external_user_id: first.external_user_id,
      phone_e164: first.phone_e164,
    }));
    expect(await storedChannels(first.external_conversation_id)).toHaveLength(1);
  });
});
