import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { openLocalTestDatabase } from '../helpers/db';
import { processInboundMessage, type InboundEnvelope } from '@/lib/services/ingestion.service';
import { sql } from '@/lib/db/orchestrator';
import { PostgresChannelIdentityStore } from '@/features/messaging/adapters/postgres-channel-identity-store';
import { PostCallBotpressIdentityStore } from '@/features/calls/adapters/post-call-botpress-identity-store';

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const db = process.env.TEST_DATABASE_URL ? openLocalTestDatabase() : null;

afterAll(async () => {
  await db?.end();
  await sql.end();
});

run('post-call Botpress egress identity', () => {
  it('allows only the Botpress-managed sandbox conversation without weakening the generic lock', async () => {
    const identity = randomUUID();
    const externalUserId = `tg:user:${identity}`;
    const externalConversationId = `tg:chat:${identity}`;
    const inbound: InboundEnvelope = {
      schema_version: 1,
      source: 'botpress',
      channel: 'whatsapp',
      integration_id: 'telegram',
      external_message_id: `message:${identity}`,
      external_conversation_id: externalConversationId,
      external_user_id: externalUserId,
      phone_e164: `+999${identity.replace(/\D/gu, '').slice(0, 10).padEnd(10, '1')}`,
      trace_id: randomUUID(),
      message: {
        type: 'text', text: 'hola', occurred_at: new Date().toISOString(),
        reply_to_external_message_id: null, audio_reference: null, metadata: {},
      },
      sandbox_provider: 'telegram_sandbox',
      botpress_conversation_id: 'bp-conversation-safe',
      botpress_user_id: 'bp-user-safe',
    };
    const ingested = await processInboundMessage(inbound);
    const [membership] = await db!<Array<{ workspace_id: string }>>`
      SELECT workspace_id FROM workspace_contacts WHERE contact_id = ${ingested.contact.id}::uuid
    `;

    const generic = new PostgresChannelIdentityStore(db!);
    const postCall = new PostCallBotpressIdentityStore(db!);
    await expect(generic.loadEligibilityFacts(membership.workspace_id, ingested.contact.id))
      .resolves.toMatchObject({ sandboxLocked: true });
    await expect(postCall.loadEligibilityFacts(membership.workspace_id, ingested.contact.id))
      .resolves.toMatchObject({ sandboxLocked: false });
    await expect(postCall.listUsableIdentities(membership.workspace_id, ingested.contact.id))
      .resolves.toEqual([
        expect.objectContaining({
          channel: 'whatsapp',
          provider: 'telegram_sandbox',
          destination: 'bp-conversation-safe',
        }),
      ]);
  });
});
