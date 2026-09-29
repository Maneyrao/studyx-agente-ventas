import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { processInboundMessage, type InboundEnvelope } from '@/lib/services/ingestion.service';
import { hashCallContext } from '@/features/calls/domain/call-context';
import { PostgresRetellOrchestrationStore } from '@/features/calls/adapters/postgres-retell-orchestration-store';
import { createManagedOutboundSender } from '@/features/messaging/adapters/managed-outbound';
import { openLocalTestDatabase } from '../helpers/db';
import { sql } from '@/lib/db/orchestrator';

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const db = process.env.TEST_DATABASE_URL ? openLocalTestDatabase() : null;
const originalManagedEnv = {
  token: process.env.BOTPRESS_MANAGED_EGRESS_TOKEN,
  botId: process.env.BOTPRESS_MANAGED_EGRESS_BOT_ID,
  apiUrl: process.env.BOTPRESS_MANAGED_EGRESS_API_URL,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(async () => {
  if (originalManagedEnv.token === undefined) delete process.env.BOTPRESS_MANAGED_EGRESS_TOKEN;
  else process.env.BOTPRESS_MANAGED_EGRESS_TOKEN = originalManagedEnv.token;
  if (originalManagedEnv.botId === undefined) delete process.env.BOTPRESS_MANAGED_EGRESS_BOT_ID;
  else process.env.BOTPRESS_MANAGED_EGRESS_BOT_ID = originalManagedEnv.botId;
  if (originalManagedEnv.apiUrl === undefined) delete process.env.BOTPRESS_MANAGED_EGRESS_API_URL;
  else process.env.BOTPRESS_MANAGED_EGRESS_API_URL = originalManagedEnv.apiUrl;
  await db?.end();
  await sql.end();
});

function telegramInbound(identity: string): InboundEnvelope {
  return {
    schema_version: 1,
    source: 'botpress',
    channel: 'telegram',
    integration_id: 'telegram',
    external_message_id: `message:${identity}`,
    external_conversation_id: `tg:chat:${identity}`,
    external_user_id: `tg:user:${identity}`,
    phone_e164: `+999${identity.replace(/\D/gu, '').slice(0, 10).padEnd(10, '1')}`,
    trace_id: randomUUID(),
    message: {
      type: 'text',
      text: 'Quiero que me llamen',
      occurred_at: new Date().toISOString(),
      reply_to_external_message_id: null,
      audio_reference: null,
      metadata: {},
    },
    sandbox_provider: 'telegram_sandbox',
    botpress_conversation_id: `bp-conversation:${identity}`,
    botpress_user_id: `bp-user:${identity}`,
  };
}

run('Retell managed egress', () => {
  it('sends one payment link through the same Botpress-owned Telegram conversation', async () => {
    process.env.BOTPRESS_MANAGED_EGRESS_TOKEN = 'managed-token';
    process.env.BOTPRESS_MANAGED_EGRESS_BOT_ID = 'studyx-bot';
    process.env.BOTPRESS_MANAGED_EGRESS_API_URL = 'https://api.botpress.test';
    const identity = randomUUID();
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      message: {
        id: `bp-payment-link:${identity}`,
        createdAt: '2026-09-29T10:00:00.000Z',
        direction: 'outgoing',
      },
    }), { status: 201, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const inbound = await processInboundMessage(telegramInbound(identity));
    const [membership] = await db!<Array<{ workspace_id: string; workspace_slug: string }>>`
      SELECT membership.workspace_id, workspace.slug AS workspace_slug
      FROM workspace_contacts AS membership
      JOIN workspaces AS workspace ON workspace.id = membership.workspace_id
      WHERE membership.contact_id = ${inbound.contact.id}::uuid
    `;
    const course = `managed_${identity.replace(/-/gu, '').slice(0, 12)}`;
    await db!`
      INSERT INTO offerings (
        workspace_id, code, display_name, offering_type, status, description,
        price_type, price_amount, currency, billing_interval
      ) VALUES (
        ${membership.workspace_id}::uuid, ${course}, 'Curso administrado',
        'course', 'active', 'Curso de prueba', 'fixed', 360, 'USD', 'custom'
      )
    `;
    await db!`
      INSERT INTO conversation_sales_context_states_v1 (
        workspace_id, conversation_id, contact_id,
        selected_offering_code, selected_payment_plan
      ) VALUES (
        ${membership.workspace_id}::uuid, ${inbound.conversation_id}::uuid,
        ${inbound.contact.id}::uuid, ${course}, 'one_time'
      )
    `;
    const [source] = await db!<Array<{ id: string }>>`
      SELECT id FROM messages
      WHERE conversation_id = ${inbound.conversation_id}::uuid
      ORDER BY conversation_seq DESC LIMIT 1
    `;
    const callId = randomUUID();
    const context = {
      call_id: callId,
      nombre_lead: '',
      curso_interes: course,
      pais: '',
      email_lead: '',
      resumen_whatsapp: '',
      prompt_version: 'managed-egress-test',
    };
    await db!`
      INSERT INTO call_sessions (
        id, source_turn_id, contact_id, conversation_id, provider,
        provider_call_id, request_idempotency_key, status,
        consent_source_message_id, context_snapshot, context_hash, prompt_version
      ) VALUES (
        ${callId}::uuid, ${source.id}::uuid, ${inbound.contact.id}::uuid,
        ${inbound.conversation_id}::uuid, 'retell', ${`retell:${callId}`},
        ${`managed-egress:${callId}`}, 'provider_accepted', ${source.id}::uuid,
        ${db!.json(context)}, decode(${hashCallContext(context)}, 'hex'), 'managed-egress-test'
      )
    `;

    const store = new PostgresRetellOrchestrationStore(db!, {
      sendOutbound: createManagedOutboundSender(db!),
      paymentLinkResolver: { resolve: () => 'https://buy.stripe.com/managed-test' },
    });
    const request = {
      callId,
      contactId: inbound.contact.id,
      conversationId: inbound.conversation_id,
      workspaceSlug: membership.workspace_slug,
      course,
      paymentPlan: 'one_time' as const,
    };

    const first = await store.requestAgentAPaymentLink(request);
    const replay = await store.requestAgentAPaymentLink(request);

    expect(first).toMatchObject({ sent: true, channel: 'telegram' });
    expect(replay).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.botpress.test/v1/chat/messages',
      expect.objectContaining({
        body: expect.stringContaining(`\"conversationId\":\"bp-conversation:${identity}\"`),
      }),
    );
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    expect(body).not.toHaveProperty('origin');
    await expect(db!`
      SELECT count(*)::integer AS count
      FROM audit_log
      WHERE entity_id = ${inbound.contact.id}::uuid
        AND action = 'outbound_send_refused'
        AND payload->>'reason' = 'SANDBOX_LOCKED'
    `).resolves.toEqual([{ count: 0 }]);
    await expect(db!`
      SELECT
        count(*)::integer AS count,
        max(channel) AS channel,
        max(provider) AS provider,
        max(state) AS state,
        max(provider_message_id) AS provider_message_id,
        bool_and(delivered_at IS NULL) AS not_physically_confirmed
      FROM outbound_deliveries
      WHERE idempotency_key = ${`agent-a:retell-payment-link:${callId}`}
    `).resolves.toEqual([{
      count: 1,
      channel: 'telegram',
      provider: 'botpress',
      state: 'submitted',
      provider_message_id: `bp-payment-link:${identity}`,
      not_physically_confirmed: true,
    }]);
  });
});
