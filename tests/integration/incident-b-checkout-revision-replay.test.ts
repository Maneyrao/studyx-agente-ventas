import { randomUUID } from 'node:crypto';
import Stripe from 'stripe';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openLocalTestDatabase } from '../helpers/db';
import { offerBonusWithMotive } from '../helpers/offer-bonus';
import { seedPriorModelNegotiation } from '../helpers/record-model-negotiation-facts';
import { seedConversationForAgentTurn } from '../helpers/agent-turn-fixtures';
import { acceptDirectCourseBonusV1 } from '@/features/promotions/application/direct-course-bonus-service';
import { commitAgentDecision } from '@/lib/services/decision.service';
import { processInboundMessage } from '@/lib/services/ingestion.service';
import { processStripeWebhook } from '@/features/payments/application/process-stripe-webhook';

/**
 * Owner incident B (2026-11-10), replayed through the real decision commit:
 * a one-time checkout with an attached gift, the e-mail corrected from .co
 * to .com, then «dale mandame el link de pago» / «en 12 veces». DeepSeek's
 * real proposal shape: request_payment_link + select_payment_plan monthly_12,
 * send_payment_link with the promotion. Before the fix the commit rejected it
 * three times with PROMOTION_NOT_AUTHORIZED.
 */
const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const db = process.env.TEST_DATABASE_URL ? openLocalTestDatabase() : null;
afterAll(async () => db?.end());
beforeEach(() => {
  vi.stubEnv('COURSE_BONUS_FLOW_MODE', 'direct');
  vi.stubEnv('COURSE_BONUS_MAX_COURSES', '3');
  vi.stubEnv('CENTRAL_CARGA_BONUS_ENABLED', 'true');
  vi.stubEnv('PAYMENT_LINK_CONTADO', 'https://buy.stripe.com/test_contado');
  vi.stubEnv('PAYMENT_LINK_12M', 'https://buy.stripe.com/test_doce');
});
afterEach(() => vi.unstubAllEnvs());

run('incident B replay — e-mail correction then «en 12 veces» with an attached gift', () => {
  it('replaces the one-time checkout once, keeps the package and enrolls only the new link', async () => {
    const f = await seedConversationForAgentTurn({ selected_offering_code: 'entrenamiento_funcional', intake_complete: true });
    await db!`UPDATE contacts SET email='ipsj.thiagomaneyro@gmail.co' WHERE id=${f.contact_id}`;
    await seedPriorModelNegotiation(db!, f);
    const identity = { workspace_id: f.workspace_id, contact_id: f.contact_id, conversation_id: f.conversation_id,
      paid_offering_code: 'entrenamiento_funcional' };
    const outboundId = randomUUID();
    const offer = await offerBonusWithMotive(db!, { ...identity, source_turn_id: f.turn_id, expected_offer_version: 0,
      bonus_offering_codes: ['nutricion_alimentacion'], outbound: { id: outboundId, content: 'Bonus', provider: 'test',
        integration_id: 'test', channel: 'whatsapp', destination: 'test', idempotency_key: outboundId } });
    if (!offer.ok) throw new Error(offer.reason);
    await db!`UPDATE outbound_deliveries SET state='leased' WHERE message_id=${outboundId}`;
    await db!`UPDATE outbound_deliveries SET state='submitted',submitted_at=now() WHERE message_id=${outboundId}`;
    await db!`UPDATE outbound_deliveries SET state='delivered',delivered_at=now() WHERE message_id=${outboundId}`;
    await db!`UPDATE messages SET created_at=clock_timestamp(),metadata=metadata-'occurred_at_trusted' WHERE id=${f.second_turn_id}`;
    expect(await acceptDirectCourseBonusV1(db!, { ...identity, ...offer, source_turn_id: f.second_turn_id,
      expected_offer_version: 1 })).toMatchObject({ ok: true });
    await db!`UPDATE conversation_sales_context_states_v1 SET selected_payment_plan='one_time',awaiting_reply='payment_confirmation'
      WHERE workspace_id=${f.workspace_id} AND conversation_id=${f.conversation_id}`;
    const [contact] = await db!`SELECT phone FROM contacts WHERE id=${f.contact_id}`;
    const next = (text: string) => processInboundMessage({ schema_version: 1, source: 'botpress', channel: 'whatsapp',
      integration_id: 'vitest-agent-turn-fixture', external_message_id: randomUUID(),
      external_conversation_id: `agent-turn-fixture-${f.trace_id}`, external_user_id: `agent-turn-fixture-user-${f.trace_id}`,
      phone_e164: contact.phone, trace_id: randomUUID(), identity_owner: 'agent_a_v1',
      message: { type: 'text', text, occurred_at: new Date().toISOString(), reply_to_external_message_id: null } });
    const checkout = (turnId: string, plan: 'one_time' | 'monthly_12', moves: { move: string; secondary: string[] }) =>
      commitAgentDecision({ turn_id: turnId, trace_id: randomUUID(), supports_multi_outbound: true,
        authorized_offering_code: 'entrenamiento_funcional', authorized_payment_plan: plan,
        agent_turn_v2: { schema_version: 2, proposal: { ...f.proposalWithCallOfferAndFalsePrice,
          move: { schema_version: 1, move: moves.move, secondary_moves: moves.secondary, vetoes: [], confidence: 1,
            course_reference: null, payment_plan: plan },
          proposed_action: { type: 'send_payment_link', offering_code: 'entrenamiento_funcional', payment_plan: plan,
            promotion_code: offer.promotion_code },
          response: { messages: ['Te comparto el enlace para pagar.'], call_offer: null } } as never },
        decision: f.placeholderDecision as never, model: f.model as never });

    // 1. Original one-time checkout with the attached gift (e-mail .co).
    const first = await checkout(f.second_turn_id, 'one_time', { move: 'request_payment_link', secondary: [] });
    expect(first.status).toBe('committed');
    const [old] = await db!`SELECT id,checkout_url,registration_email FROM payments
      WHERE idempotency_key=${`agent-a-payment-link:${f.second_turn_id}`}`;
    expect(old.registration_email).toBe('ipsj.thiagomaneyro@gmail.co');

    // 2. The e-mail is corrected through the profile receipt (persisted .com).
    await db!`UPDATE contacts SET email='ipsj.thiagomaneyro@gmail.com' WHERE id=${f.contact_id}`;

    // 3. «dale mandame el link de pago» + «en 12 veces» in one batch.
    const twelve = await next('dale mandame el link de pago en 12 veces');
    const replaced = await checkout(twelve.turn_id, 'monthly_12',
      { move: 'request_payment_link', secondary: ['select_payment_plan'] });
    expect(replaced.status).toBe('committed');
    const [fresh] = await db!`SELECT id,plan_code,registration_email,promotion_offer_id,accepted_offer_version,checkout_url
      FROM payments WHERE idempotency_key=${`agent-a-payment-link:${twelve.turn_id}`}`;
    expect(fresh).toMatchObject({ plan_code: 'monthly_12', registration_email: 'ipsj.thiagomaneyro@gmail.com',
      promotion_offer_id: offer.offer_id, accepted_offer_version: 1 });
    expect(replaced.outbounds[0].content).toContain(fresh.checkout_url);
    expect(replaced.outbounds[0].content).not.toContain(old.checkout_url);
    expect(await db!`SELECT offering_code_snapshot FROM payment_bonus_offerings WHERE payment_id=${fresh.id}`)
      .toEqual([{ offering_code_snapshot: 'nutricion_alimentacion' }]);
    expect(await db!`SELECT reason FROM payment_intent_supersessions WHERE payment_id=${old.id}`)
      .toEqual([{ reason: 'PLAN_CHANGED' }]);
    expect((await db!`SELECT selected_payment_plan,stage FROM conversation_sales_context_states_v1
      WHERE conversation_id=${f.conversation_id}`)[0]).toMatchObject({ selected_payment_plan: 'monthly_12', stage: 'payment_link_sent' });

    // 4. «mandame el link» again with the same plan and data reuses the reference.
    const again = await next('mandame el link de nuevo');
    expect((await checkout(again.turn_id, 'monthly_12', { move: 'request_payment_link', secondary: [] })).status).toBe('committed');
    expect(await db!`SELECT id FROM payments WHERE source_conversation_id=${f.conversation_id}`).toHaveLength(2);
    expect(await db!`SELECT id FROM promotion_offers WHERE contact_id=${f.contact_id} AND status='attached'`).toHaveLength(1);

    // 5. Old link paid late → reconciliation; new link paid → one enrollment.
    const stripe = new Stripe('sk_test_never_network'); const secret = 'whsec_incident_b';
    const paidEvent = (paymentId: string, mode: 'payment' | 'subscription' = 'payment', amount = 36000) => {
      const payload = JSON.stringify({ id: `evt_${randomUUID()}`, object: 'event', livemode: false,
        type: 'checkout.session.completed', created: Math.floor(Date.now() / 1000),
        data: { object: { id: `cs_test_${randomUUID()}`, object: 'checkout.session', client_reference_id: paymentId,
          mode, payment_status: 'paid', amount_total: amount, currency: 'usd', metadata: {} } } });
      return processStripeWebhook(payload, stripe.webhooks.generateTestHeaderString({ payload, secret }),
        { db: db!, stripe, webhookSecret: secret, expectedEnvironment: 'test' });
    };
    expect(await paidEvent(old.id)).toMatchObject({ body: { reconciliation_required: true } });
    expect(await db!`SELECT id FROM fulfillment_jobs WHERE payment_id=${old.id}`).toEqual([]);
    // The new 12-installment link enrolls course and gifts exactly once.
    const freshPaid = await paidEvent(fresh.id, 'subscription', 3000);
    expect(freshPaid.body).toMatchObject({ status: 'paid' });
    expect(freshPaid.body).not.toHaveProperty('reconciliation_required');
    await paidEvent(fresh.id, 'subscription', 3000);
    expect(await db!`SELECT payment_id FROM fulfillment_jobs WHERE payment_id IN (${old.id},${fresh.id})`)
      .toEqual([{ payment_id: fresh.id }]);
  });
});
