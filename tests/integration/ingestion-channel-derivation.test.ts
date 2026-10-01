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

async function storedThreads(externalConversationId: string) {
  const rows = await db!<Array<{
    channel: string;
    metadata: Record<string, unknown>;
  }>>`
    SELECT channel, metadata FROM channel_threads WHERE external_conversation_id = ${externalConversationId}
  `;
  return rows;
}

run('inbound channel derivation', () => {
  it('keeps filing a WhatsApp inbound as whatsapp', async () => {
    const inbound = envelope({ channel: 'whatsapp' });
    await processInboundMessage(inbound);
    expect((await storedThreads(inbound.external_conversation_id)).map((row) => row.channel)).toEqual(['whatsapp']);
  });

  it('keeps immutable first-touch Meta attribution and refreshes last-touch', async () => {
    const first = envelope({
      message: {
        type: 'text', text: 'hola', occurred_at: '2026-10-01T12:00:00.000Z',
        reply_to_external_message_id: null, audio_reference: null,
        metadata: {
          meta_source_id: 'ad-1', meta_source_type: 'ad',
          meta_headline: 'Curso de Inglés', meta_ctwa_clid: 'click-1',
        },
      },
    });
    const accepted = await processInboundMessage(first);
    await processInboundMessage(envelope({
      external_conversation_id: first.external_conversation_id,
      external_user_id: first.external_user_id,
      phone_e164: first.phone_e164,
      message: {
        type: 'text', text: 'también vi fotografía', occurred_at: '2026-10-01T12:05:00.000Z',
        reply_to_external_message_id: null, audio_reference: null,
        metadata: {
          meta_source_id: 'ad-2', meta_source_type: 'ad',
          meta_headline: 'Curso de Fotografía', meta_ctwa_clid: 'click-2',
        },
      },
    }));

    const rows = await db!<Array<{ metadata: Record<string, unknown> }>>`
      SELECT metadata FROM workspace_contacts WHERE contact_id = ${accepted.contact.id}::uuid
    `;
    expect(rows[0].metadata).toMatchObject({
      attribution: {
        first_touch: { source_id: 'ad-1', headline: 'Curso de Inglés', ctwa_clid: 'click-1' },
        last_touch: { source_id: 'ad-2', headline: 'Curso de Fotografía', ctwa_clid: 'click-2' },
      },
    });
  });

  // The emulator simulates a WhatsApp conversation. Giving it a channel of its
  // own would change the meaning of every row already stored under it.
  it('still maps the emulator to whatsapp, unchanged', async () => {
    const inbound = envelope({ channel: 'emulator' });
    await processInboundMessage(inbound);
    expect((await storedThreads(inbound.external_conversation_id)).map((row) => row.channel)).toEqual(['whatsapp']);
  });

  it('files a Telegram inbound as telegram, so it can be replied to there', async () => {
    const inbound = envelope({ channel: 'telegram' });
    const accepted = await processInboundMessage(inbound);
    expect((await storedThreads(inbound.external_conversation_id)).map((row) => row.channel)).toEqual(['telegram']);
    await expect(db!`SELECT channel FROM conversations WHERE id = ${accepted.conversation_id}::uuid`)
      .resolves.toEqual([{ channel: 'telegram' }]);
    await expect(db!`
      SELECT channel FROM contact_channel_permissions
      WHERE contact_id = ${accepted.contact.id}::uuid
    `).resolves.toEqual([{ channel: 'telegram' }]);
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
    expect(await storedThreads(first.external_conversation_id)).toHaveLength(1);
  });

  it('persists and refreshes the Botpress routing identity needed by proactive follow-up', async () => {
    const first = envelope({
      botpress_conversation_id: 'bp-conversation-old',
      botpress_user_id: 'bp-user-old',
    });
    await processInboundMessage(first);

    await processInboundMessage(envelope({
      external_conversation_id: first.external_conversation_id,
      external_user_id: first.external_user_id,
      phone_e164: first.phone_e164,
      botpress_conversation_id: 'bp-conversation-current',
      botpress_user_id: 'bp-user-current',
    }));

    expect(await storedThreads(first.external_conversation_id)).toEqual([
      expect.objectContaining({
        metadata: expect.objectContaining({
          external_user_id: first.external_user_id,
          botpress_conversation_id: 'bp-conversation-current',
          botpress_user_id: 'bp-user-current',
        }),
      }),
    ]);
  });
});
