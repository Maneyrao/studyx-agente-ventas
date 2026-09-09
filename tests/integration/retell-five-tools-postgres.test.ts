import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { FakePaymentProvider } from '@/features/payments/adapters/fake-payment-provider';
import { PostgresRetellOrchestrationStore } from '@/features/calls/adapters/postgres-retell-orchestration-store';
import { hashCallContext } from '@/features/calls/domain/call-context';
import { openLocalTestDatabase } from '../helpers/db';

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const db = process.env.TEST_DATABASE_URL ? openLocalTestDatabase() : null;
afterAll(async () => db?.end());

async function fixture(input: { readonly planMode?: 'payment' | 'subscription'; readonly omitOneTime?: boolean } = {}) {
  const workspaceSlug = `retell-five-${randomUUID()}`;
  const paymentOptions = [
    {
      code: 'monthly_12', currency: 'USD', total_amount: '360.00', installments: 12,
      installment_amount: '30.00', payment_link: 'https://buy.stripe.com/14A5kC31I3Nwfbq67Fdwc0f',
    },
    {
      code: 'monthly_6', currency: 'USD', total_amount: '360.00', installments: 6,
      installment_amount: '60.00', payment_link: 'https://buy.stripe.com/4gMdR8cCi97Q7IYdA7dwc0a',
    },
    {
      code: 'one_time', currency: 'USD', total_amount: '360.00', installments: 1,
      installment_amount: '360.00', payment_link: 'https://buy.stripe.com/9B64gy7hYesaaVa1Rpdwc0j',
    },
  ];
  const workspaces = await db!<Array<{ id: string }>>`
    INSERT INTO workspaces (slug, display_name, metadata)
    VALUES (${workspaceSlug}, 'Retell five tools', ${db!.json({
      human_available: false,
      payment_options: input.omitOneTime ? paymentOptions.slice(0, 2) : paymentOptions,
    })})
    RETURNING id
  `;
  const workspaceId = workspaces[0].id;
  const contacts = await db!<Array<{ id: string }>>`
    INSERT INTO contacts (phone, channel_origin, email)
    VALUES (${`+54911${randomUUID().replace(/\D/gu, '').padEnd(8, '1').slice(0, 8)}`}, 'whatsapp', 'lead@example.test')
    RETURNING id
  `;
  const contactId = contacts[0].id;
  await db!`INSERT INTO workspace_contacts (workspace_id, contact_id) VALUES (${workspaceId}::uuid, ${contactId}::uuid)`;
  const offerings = await db!<Array<{ id: string }>>`
    INSERT INTO offerings (
      workspace_id, code, display_name, offering_type, status, description,
      price_type, price_amount, currency, billing_interval
    ) VALUES (
      ${workspaceId}::uuid, 'retell_course', 'Retell Course', 'course', 'active', 'Canonical course',
      'fixed', 360, 'USD', 'custom'
    ) RETURNING id
  `;
  await db!`
    INSERT INTO offering_payment_configs (offering_id, provider, checkout_mode, environment, status)
    VALUES (${offerings[0].id}::uuid, 'fake', ${input.planMode ?? 'payment'}, 'test', 'active')
  `;
  return { workspaceId, workspaceSlug, contactId, offeringId: offerings[0].id };
}

function sender() {
  const calls: Array<Record<string, unknown>> = [];
  const settledKeys = new Set<string>();
  return {
    calls,
    send: async (input: Record<string, unknown>) => {
      const key = String(input.idempotencyKey);
      if (settledKeys.has(key)) {
        return { outcome: 'sent' as const, channel: 'whatsapp' as const, providerMessageId: 'wamid.test', deliveryId: `delivery-replay-${key}`, reason: null };
      }
      settledKeys.add(key);
      calls.push(input);
      return { outcome: 'sent' as const, channel: 'whatsapp' as const, providerMessageId: 'wamid.test', deliveryId: `delivery-${calls.length}`, reason: null };
    },
  };
}

async function callFixture() {
  const ids = await fixture();
  const conversations = await db!<Array<{ id: string }>>`
    INSERT INTO conversations (contact_id, channel) VALUES (${ids.contactId}::uuid, 'whatsapp') RETURNING id
  `;
  const conversationId = conversations[0].id;
  const messages = await db!<Array<{ id: string }>>`
    INSERT INTO messages (conversation_id, contact_id, direction, content, conversation_seq)
    VALUES (${conversationId}::uuid, ${ids.contactId}::uuid, 'inbound', 'Llamame', 1) RETURNING id
  `;
  await db!`
    INSERT INTO conversation_sales_context_states_v1 (workspace_id, conversation_id, contact_id)
    VALUES (${ids.workspaceId}::uuid, ${conversationId}::uuid, ${ids.contactId}::uuid)
  `;
  const callId = randomUUID();
  const context = {
    call_id: callId, nombre_lead: '', curso_interes: '', pais: '', email_lead: '',
    resumen_whatsapp: '', prompt_version: 'test',
  };
  await db!`
    INSERT INTO call_sessions (
      id, source_turn_id, contact_id, conversation_id, provider, provider_call_id,
      request_idempotency_key, status, consent_source_message_id, context_snapshot,
      context_hash, prompt_version
    ) VALUES (
      ${callId}::uuid, ${messages[0].id}::uuid, ${ids.contactId}::uuid, ${conversationId}::uuid,
      'retell', ${`retell:${callId}`}, ${`retell-test:${callId}`}, 'provider_accepted',
      ${messages[0].id}::uuid, ${db!.json(context)}, decode(${hashCallContext(context)}, 'hex'), 'test'
    )
  `;
  return { ...ids, callId };
}

run('Retell five tools PostgreSQL adapter', () => {
  it('enforces canonical plan authority and makes payment/send replay idempotent', async () => {
    const ids = await fixture();
    const provider = new FakePaymentProvider();
    const outbound = sender();
    const store = new PostgresRetellOrchestrationStore(db!, { paymentProvider: provider, sendOutbound: outbound.send });
    await expect(store.createPaymentLink({
      callId: randomUUID(), contactId: ids.contactId, workspaceSlug: ids.workspaceSlug,
      courses: ['retell_course'], plan: 'cuotas', email: 'lead@example.test', channel: 'whatsapp',
    })).resolves.toMatchObject({ sent: false, reason: 'PAYMENT_PLAN_CHOICE_REQUIRED' });
    const callId = randomUUID();
    const first = await store.createPaymentLink({ callId, contactId: ids.contactId, workspaceSlug: ids.workspaceSlug, courses: ['retell_course'], plan: 'contado', email: 'lead@example.test', channel: 'whatsapp' });
    const replay = await store.createPaymentLink({ callId, contactId: ids.contactId, workspaceSlug: ids.workspaceSlug, courses: ['retell_course'], plan: 'contado', email: 'lead@example.test', channel: 'whatsapp' });
    expect(first).toMatchObject({ sent: true });
    expect(replay).toEqual(first);
    expect(provider.calls).toHaveLength(1);
    expect(outbound.calls).toHaveLength(1);
    await expect(db!<{ count: string }[]>`SELECT count(*) FROM payments WHERE workspace_id = ${ids.workspaceId}::uuid`).resolves.toEqual([{ count: '1' }]);
    const withoutOneTime = await fixture({ omitOneTime: true });
    await expect(store.createPaymentLink({
      callId: randomUUID(), contactId: withoutOneTime.contactId, workspaceSlug: withoutOneTime.workspaceSlug,
      courses: ['retell_course'], plan: 'contado', email: 'lead@example.test', channel: 'whatsapp',
    })).resolves.toMatchObject({ sent: false, reason: 'PAYMENT_PLAN_UNAVAILABLE' });
  });

  it('scopes payment references to the correlated workspace/contact and returns missing proof as failure', async () => {
    const one = await fixture();
    const two = await fixture();
    const payment = await db!<Array<{ id: string }>>`
      INSERT INTO payments (workspace_id, contact_id, offering_id, amount, currency, status, provider, environment, checkout_mode, idempotency_key, paid_at)
      VALUES (${two.workspaceId}::uuid, ${two.contactId}::uuid, ${two.offeringId}::uuid, 360, 'USD', 'paid', 'fake', 'test', 'payment', ${`test:${randomUUID()}`}, now())
      RETURNING id
    `;
    const store = new PostgresRetellOrchestrationStore(db!);
    await expect(store.verifyPayment({ callId: randomUUID(), contactId: one.contactId, workspaceSlug: one.workspaceSlug, reference: payment[0].id }))
      .resolves.toEqual({ found: false, reason: 'PAYMENT_NOT_FOUND' });
    await expect(store.verifyPayment({ callId: randomUUID(), contactId: one.contactId, workspaceSlug: one.workspaceSlug }))
      .resolves.toEqual({ found: false, reason: 'PAYMENT_NOT_FOUND' });
  });

  it('sends approved material only when exact canonical URL/fact authorization passes', async () => {
    const ids = await fixture();
    const outbound = sender();
    const content = 'Temario oficial. Modalidad online. https://studyx.example/temario';
    const sources = await db!<Array<{ id: string }>>`
      INSERT INTO knowledge_sources (workspace_id, source_type, title, content, metadata)
      VALUES (${ids.workspaceId}::uuid, 'offering', 'retell material', ${content}, ${db!.json({ material_type: 'temario', course_code: 'retell_course', authorized_urls: ['https://studyx.example/temario'], protected_facts: [{ kind: 'modality', value: 'online' }] })})
      RETURNING id
    `;
    const store = new PostgresRetellOrchestrationStore(db!, { sendOutbound: outbound.send });
    await expect(store.sendMaterial({ callId: randomUUID(), contactId: ids.contactId, workspaceSlug: ids.workspaceSlug, type: 'temario', course: 'retell_course' })).resolves.toMatchObject({ sent: true });
    expect(outbound.calls).toHaveLength(1);
    await db!`UPDATE knowledge_sources SET content = 'Temario https://foreign.example/nope' WHERE id = ${sources[0].id}::uuid`;
    await expect(store.sendMaterial({ callId: randomUUID(), contactId: ids.contactId, workspaceSlug: ids.workspaceSlug, type: 'temario', course: 'retell_course' })).resolves.toMatchObject({ sent: false, reason: 'MATERIAL_UNAVAILABLE' });
  });

  it('keeps follow-up/handoff replay stable and rejects cross-tenant request inserts', async () => {
    const ids = await callFixture();
    const store = new PostgresRetellOrchestrationStore(db!);
    const first = await store.scheduleFollowup({ callId: ids.callId, contactId: ids.contactId, workspaceSlug: ids.workspaceSlug, whenText: 'mañana a las 6', channel: 'llamada', reason: 'cobra el viernes' });
    const replay = await store.scheduleFollowup({ callId: ids.callId, contactId: ids.contactId, workspaceSlug: ids.workspaceSlug, whenText: 'el lunes', channel: 'whatsapp', reason: 'otro motivo' });
    expect(replay).toEqual(first);
    const handoff = await store.requestHumanHandoff({ callId: ids.callId, contactId: ids.contactId, workspaceSlug: ids.workspaceSlug, reason: 'pedido_explicito', detail: 'Necesita una persona.', urgency: 'normal' });
    const handoffReplay = await store.requestHumanHandoff({ callId: ids.callId, contactId: ids.contactId, workspaceSlug: ids.workspaceSlug, reason: 'reclamo', detail: 'Texto nuevo.', urgency: 'alta' });
    expect(handoffReplay).toEqual(handoff);
    const other = await fixture();
    await expect(db!`
      INSERT INTO retell_followup_requests (workspace_id, contact_id, call_id, when_text, channel, reason)
      VALUES (${other.workspaceId}::uuid, ${ids.contactId}::uuid, ${ids.callId}::uuid, 'x', 'llamada', 'cross tenant')
    `).rejects.toThrow();
  });
});
