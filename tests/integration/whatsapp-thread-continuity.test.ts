import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { openLocalTestDatabase } from '../helpers/db';
import { processInboundMessage, type InboundEnvelope } from '@/lib/services/ingestion.service';
import { PostgresOrchestrationStore } from '@/features/orchestration/adapters/postgres-orchestration-store';
import { registerMessage } from '@/lib/services/message.service';
import { persistedInboundReceipts } from '@/lib/services/inbound-receipts.service';
import { PostgresChannelIdentityStore } from '@/features/messaging/adapters/postgres-channel-identity-store';
import { BotpressManagedIdentityStore } from '@/features/messaging/adapters/botpress-managed-identity-store';
import { sql } from '@/lib/db/orchestrator';

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const db = process.env.TEST_DATABASE_URL ? openLocalTestDatabase() : null;
afterAll(async () => { await db?.end(); await sql.end(); });

function envelope(): InboundEnvelope {
  const id = randomUUID();
  return { schema_version: 1, source: 'botpress', channel: 'whatsapp',
    integration_id: `continuity-${id}`, external_message_id: `message-${id}`,
    external_conversation_id: `old-${id}`, external_user_id: `user-${id}`,
    botpress_conversation_id: `old-${id}`, phone_e164: `+54911${Math.floor(10_000_000 + Math.random() * 89_999_999)}`,
    trace_id: randomUUID(), message: { type: 'text', text: 'Continuamos inglés',
      occurred_at: new Date().toISOString(), reply_to_external_message_id: null,
      metadata: { bot_phone_number_id: `account-${id}` } } };
}
function next(base: InboundEnvelope, external: string, occurredAt = new Date().toISOString()): InboundEnvelope {
  return { ...base, external_message_id: randomUUID(), external_conversation_id: external,
    botpress_conversation_id: external, trace_id: randomUUID(),
    message: { ...base.message, occurred_at: occurredAt } };
}

async function seedState(conversationId: string, offering: string | null = null) {
  await db!`INSERT INTO conversation_sales_context_states_v1
    (workspace_id, conversation_id, contact_id, selected_offering_code)
    SELECT workspace.id, conversation.id, conversation.contact_id, ${offering}
    FROM workspaces workspace CROSS JOIN conversations conversation
    WHERE workspace.slug = 'studyx' AND conversation.id = ${conversationId}::uuid
    ON CONFLICT (workspace_id, conversation_id) DO UPDATE SET selected_offering_code = EXCLUDED.selected_offering_code`;
}

run('WhatsApp canonical thread continuity', () => {
  it('keeps the conversation and selected course when Botpress replaces the external conversation', async () => {
    const input = envelope();
    const first = await processInboundMessage(input);
    await seedState(first.conversation_id, 'ingles_2');
    const second = await processInboundMessage(next(input, `new-${randomUUID()}`));
    expect(second.conversation_id).toBe(first.conversation_id);
    const [state] = await db!`SELECT selected_offering_code FROM conversation_sales_context_states_v1
      WHERE conversation_id = ${first.conversation_id}::uuid`;
    expect(state.selected_offering_code).toBe('ingles_2');
    const [identity] = await db!`SELECT event.external_conversation_id, event.channel_thread_id,
      conversation.channel_thread_id AS conversation_thread FROM channel_events event
      JOIN messages message ON message.source_event_id = event.id
      JOIN conversations conversation ON conversation.id = message.conversation_id
      WHERE message.id = ${second.turn_id}::uuid`;
    expect(identity.external_conversation_id).not.toBe(input.external_conversation_id);
    expect(identity.channel_thread_id).toBe(identity.conversation_thread);
    const replayEnvelope = next(input, identity.external_conversation_id);
    const replayFirst = await processInboundMessage(replayEnvelope);
    const replay = await processInboundMessage(replayEnvelope);
    expect(replay.conversation_id).toBe(first.conversation_id);
    expect(replay.turn_id).toBe(replayFirst.turn_id);
    const receipts = await persistedInboundReceipts({ integration_id: input.integration_id,
      external_conversation_id: replayEnvelope.external_conversation_id, channel: 'whatsapp',
      external_message_ids: [replayEnvelope.external_message_id] });
    expect(receipts).toContain(replayEnvelope.external_message_id);
  });

  it('never regresses the current destination when an older external conversation arrives late', async () => {
    const input = envelope();
    input.message.occurred_at = new Date(Date.now() - 2 * 60_000).toISOString();
    const first = await processInboundMessage(input);
    const replacement = `new-${randomUUID()}`;
    const replacementTime = new Date(Date.now() - 60_000).toISOString();
    await processInboundMessage(next(input, replacement, replacementTime));
    await processInboundMessage(next(input, input.external_conversation_id, replacementTime));
    await processInboundMessage(next(input, input.external_conversation_id, new Date(Date.now() - 20 * 60_000).toISOString()));
    const [thread] = await db!`SELECT metadata FROM channel_threads WHERE id =
      (SELECT channel_thread_id FROM conversations WHERE id = ${first.conversation_id}::uuid)`;
    expect(thread.metadata.botpress_conversation_id).toBe(replacement);
  });

  it('rejects an external alias presented by another account or contact', async () => {
    const input = envelope();
    const first = await processInboundMessage(input);
    const wrongAccount = next(input, input.external_conversation_id);
    wrongAccount.message.metadata = { bot_phone_number_id: 'another-account' };
    await expect(processInboundMessage(wrongAccount)).rejects.toMatchObject({ code: 'CHANNEL_IDENTITY_CONFLICT' });
    const wrongContact = next(input, input.external_conversation_id);
    wrongContact.phone_e164 = envelope().phone_e164;
    await expect(processInboundMessage(wrongContact)).rejects.toMatchObject({ code: 'CHANNEL_IDENTITY_CONFLICT' });
    const [conversation] = await db!`SELECT status FROM conversations WHERE id = ${first.conversation_id}::uuid`;
    expect(conversation.status).toBe('open');
  });

  it('reads an explicitly recovered closed branch without moving its ledger or duplicating the delivery identity', async () => {
    const input = envelope();
    const first = await processInboundMessage(input);
    await seedState(first.conversation_id, 'ingles_2');
    await registerMessage({ conversation_id: first.conversation_id, direction: 'outbound',
      content: 'Historial original conservado' }, { db: db!, embedding: 'skip' });
    const [canonical] = await db!`SELECT c.channel_thread_id, c.contact_id, b.workspace_id
      FROM conversations c JOIN channel_account_thread_bindings b ON b.canonical_thread_id = c.channel_thread_id
      WHERE c.id = ${first.conversation_id}::uuid`;
    const sourceExternal = `archived-${randomUUID()}`;
    const [sourceThread] = await db!`INSERT INTO channel_threads
      (contact_id, provider, integration_id, channel, external_conversation_id, metadata)
      VALUES (${canonical.contact_id}::uuid, 'botpress', ${input.integration_id}, 'whatsapp', ${sourceExternal},
        ${db!.json({ bot_phone_number_id: input.message.metadata!.bot_phone_number_id,
          botpress_conversation_id: sourceExternal })}) RETURNING id`;
    await db!`UPDATE conversations SET status = 'closed' WHERE id = ${first.conversation_id}::uuid`;
    const [source] = await db!`INSERT INTO conversations (contact_id, channel, channel_thread_id)
      VALUES (${canonical.contact_id}::uuid, 'whatsapp', ${sourceThread.id}::uuid) RETURNING id`;
    await seedState(source.id);
    const archivedMessage = await registerMessage({ conversation_id: source.id, direction: 'inbound',
      content: 'Mensaje de la rama recuperada', metadata: { occurred_at: new Date(Date.now() - 60_000).toISOString(),
        occurred_at_trusted: true } }, { db: db!, embedding: 'skip' });
    await registerMessage({ conversation_id: source.id, direction: 'outbound',
      content: 'Respuesta ya entregada en rama', in_reply_to: archivedMessage.message.id }, { db: db!, embedding: 'skip' });
    const unsent = await registerMessage({ conversation_id: source.id, direction: 'outbound',
      content: 'BORRADOR NUNCA ENVIADO', in_reply_to: archivedMessage.message.id, part_index: 1 }, { db: db!, embedding: 'skip' });
    await db!`INSERT INTO outbound_deliveries
      (message_id,conversation_id,contact_id,provider,integration_id,channel,destination,idempotency_key)
      VALUES (${unsent.message.id}::uuid,${source.id}::uuid,${canonical.contact_id}::uuid,'botpress',
        ${input.integration_id},'whatsapp',${sourceExternal},${randomUUID()})`;
    await db!`UPDATE conversations SET status = 'closed' WHERE id = ${source.id}::uuid`;
    await db!`UPDATE conversations SET status = 'open' WHERE id = ${first.conversation_id}::uuid`;
    await db!`INSERT INTO channel_thread_aliases
      (provider,integration_id,external_conversation_id,workspace_id,contact_id,channel,bot_phone_number_id,canonical_thread_id)
      VALUES ('botpress', ${input.integration_id}, ${sourceExternal}, ${canonical.workspace_id}::uuid,
        ${canonical.contact_id}::uuid, 'whatsapp', ${input.message.metadata!.bot_phone_number_id}, ${canonical.channel_thread_id}::uuid)`;
    await db!`INSERT INTO conversation_history_recovery_links
      (workspace_id,contact_id,channel,canonical_conversation_id,source_conversation_id,reason)
      VALUES (${canonical.workspace_id}::uuid, ${canonical.contact_id}::uuid, 'whatsapp',
        ${first.conversation_id}::uuid, ${source.id}::uuid, 'INTEGRATION_REINSTALL_RECOVERY')`;
    await db!`UPDATE inbound_batches SET due_at = now() - interval '1 second' WHERE id = ${first.batch.id}::uuid`;
    const store = new PostgresOrchestrationStore(db!);
    const claim = await store.claimBatch({ batch_id: first.batch.id, claimed_by: 'continuity-test' });
    expect(claim.outcome).toBe('claimed');
    const context = await store.loadClaimedBatchContext({ batch_id: first.batch.id, recent_turns_limit: 10 });
    expect(context?.facts.recent_turns.map(turn => turn.content)).toEqual(expect.arrayContaining([
      'Mensaje de la rama recuperada', 'Historial original conservado',
    ]));
    expect(context?.logical_recent_turns?.map(turn => turn.content)).toContain('Respuesta ya entregada en rama');
    const fallback = await store.loadClaimedTurnFacts({ batch_id: first.batch.id, recent_turns_limit: 10 });
    expect(fallback?.recent_turns.map(turn => turn.content)).toEqual([
      'Mensaje de la rama recuperada', 'Historial original conservado', 'Respuesta ya entregada en rama',
    ]);
    expect(context?.facts.recent_turns.map(turn => turn.content)).not.toContain('BORRADOR NUNCA ENVIADO');
    expect(context?.logical_recent_turns?.map(turn => turn.content).join(' ')).not.toContain('BORRADOR NUNCA ENVIADO');
    const [ledger] = await db!`SELECT conversation_id FROM messages WHERE id = ${archivedMessage.message.id}::uuid`;
    expect(ledger.conversation_id).toBe(source.id);
    const identities = await new BotpressManagedIdentityStore(db!).listUsableIdentities(canonical.workspace_id, canonical.contact_id);
    expect(identities).toHaveLength(1);
    expect(identities[0].destination).toBe(input.external_conversation_id);
    const directIdentities = await new PostgresChannelIdentityStore(db!).listUsableIdentities(canonical.workspace_id, canonical.contact_id);
    expect(directIdentities).toHaveLength(1);
  });
  it('rejects reuse of an external alias in another active workspace', async () => {
    const input = envelope();
    const first = await processInboundMessage(input);
    const slug = `other-${randomUUID()}`;
    await db!`INSERT INTO workspaces (slug,display_name) VALUES (${slug},'Other isolated tenant')`;
    const previous = process.env.BUSINESS_WORKSPACE_SLUG;
    process.env.BUSINESS_WORKSPACE_SLUG = slug;
    try {
      await expect(processInboundMessage(next(input, input.external_conversation_id)))
        .rejects.toMatchObject({ code: 'CHANNEL_IDENTITY_CONFLICT' });
    } finally {
      if (previous === undefined) delete process.env.BUSINESS_WORKSPACE_SLUG;
      else process.env.BUSINESS_WORKSPACE_SLUG = previous;
    }
    const [conversation] = await db!`SELECT status FROM conversations WHERE id = ${first.conversation_id}::uuid`;
    expect(conversation.status).toBe('open');
  });

  it('requires exact workspace/account/contact foreign keys and immutable binding proofs', async () => {
    const input = envelope();
    const first = await processInboundMessage(input);
    const [binding] = await db!`SELECT b.* FROM channel_account_thread_bindings b
      JOIN conversations c ON c.channel_thread_id = b.canonical_thread_id
      WHERE c.id = ${first.conversation_id}::uuid`;
    const wrongWorkspace = randomUUID();
    await expect(db!`INSERT INTO channel_thread_aliases
      (provider,integration_id,external_conversation_id,workspace_id,contact_id,channel,bot_phone_number_id,canonical_thread_id)
      VALUES ('botpress', ${input.integration_id}, ${randomUUID()}, ${wrongWorkspace}::uuid,
        ${binding.contact_id}::uuid, 'whatsapp', ${binding.bot_phone_number_id}, ${binding.canonical_thread_id}::uuid)`)
      .rejects.toMatchObject({ code: '23503' });
    await expect(db!`UPDATE channel_account_thread_bindings SET bot_phone_number_id = 'different'
      WHERE canonical_thread_id = ${binding.canonical_thread_id}::uuid`).rejects.toMatchObject({ code: '23514' });
    await expect(db!`INSERT INTO channel_account_thread_bindings
      (workspace_id,contact_id,provider,integration_id,channel,bot_phone_number_id,canonical_thread_id,reason)
      VALUES (${binding.workspace_id}::uuid,${binding.contact_id}::uuid,'botpress',${input.integration_id},'whatsapp',
        'wrong-account',${binding.canonical_thread_id}::uuid,'INVALID_PROOF')`).rejects.toMatchObject({ code: '23514' });
    await expect(db!`INSERT INTO conversation_history_recovery_links
      (workspace_id,contact_id,channel,canonical_conversation_id,source_conversation_id,reason)
      VALUES (${wrongWorkspace}::uuid,${binding.contact_id}::uuid,'whatsapp',
        ${first.conversation_id}::uuid,${randomUUID()}::uuid,'INVALID_PROOF')`).rejects.toMatchObject({ code: '23514' });
  });

  it('accepts an explicit legacy account binding only when its immutable source event proves the account', async () => {
    const input = envelope();
    const first = await processInboundMessage(input);
    const [existing] = await db!`SELECT b.* FROM channel_account_thread_bindings b
      JOIN conversations c ON c.channel_thread_id = b.canonical_thread_id
      WHERE c.id = ${first.conversation_id}::uuid`;
    const legacyExternal = `legacy-${randomUUID()}`;
    const [legacy] = await db!`INSERT INTO channel_threads
      (contact_id,provider,integration_id,channel,external_conversation_id,metadata)
      VALUES (${existing.contact_id}::uuid,'botpress',${input.integration_id},'whatsapp',${legacyExternal},'{}'::jsonb) RETURNING id`;
    await db!`INSERT INTO channel_events
      (provider,integration_id,channel,direction,external_event_id,external_message_id,external_conversation_id,
        payload_hash,payload,contact_id,channel_thread_id)
      VALUES ('botpress',${input.integration_id},'whatsapp','inbound',${randomUUID()},${randomUUID()},${legacyExternal},
        decode(repeat('00',32),'hex'),${db!.json({ message: { metadata: { bot_phone_number_id: 'verified-legacy-account' } } })},
        ${existing.contact_id}::uuid,${legacy.id}::uuid)`;
    await expect(db!`INSERT INTO channel_account_thread_bindings
      (workspace_id,contact_id,provider,integration_id,channel,bot_phone_number_id,canonical_thread_id,reason)
      VALUES (${existing.workspace_id}::uuid,${existing.contact_id}::uuid,'botpress',${input.integration_id},'whatsapp',
        'wrong-legacy-account',${legacy.id}::uuid,'INVALID_PROOF')`).rejects.toMatchObject({ code: '23514' });
    await db!`INSERT INTO channel_account_thread_bindings
      (workspace_id,contact_id,provider,integration_id,channel,bot_phone_number_id,canonical_thread_id,reason)
      VALUES (${existing.workspace_id}::uuid,${existing.contact_id}::uuid,'botpress',${input.integration_id},'whatsapp',
        'verified-legacy-account',${legacy.id}::uuid,'AUDITED_INTEGRATION_REINSTALL')`;
    const [bound] = await db!`SELECT canonical_thread_id FROM channel_account_thread_bindings
      WHERE bot_phone_number_id = 'verified-legacy-account' AND integration_id = ${input.integration_id}`;
    expect(bound.canonical_thread_id).toBe(legacy.id);
  });

});
