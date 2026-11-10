import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openLocalTestDatabase } from '../helpers/db';
import { offerBonusWithMotive } from '../helpers/offer-bonus';
import { seedPriorModelNegotiation } from '../helpers/record-model-negotiation-facts';
import { seedConversationForAgentTurn } from '../helpers/agent-turn-fixtures';
import { acceptDirectCourseBonusV1 } from '@/features/promotions/application/direct-course-bonus-service';
import { commitAgentDecision } from '@/lib/services/decision.service';
import { processInboundMessage } from '@/lib/services/ingestion.service';

/**
 * Live 2026-11-10 (Community Manager + one_time): the model identified course and
 * plan and asked for the link, but neither was persisted. The decision commit must
 * persist both choices and later create the checkout from a recovered (null) state,
 * keeping the promotion. Exact-catalog and paid-mention rules stay enforced.
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

const COURSE = 'community_manager';

async function seed(selected: string | null = null) {
  const f = await seedConversationForAgentTurn({ selected_offering_code: selected, intake_complete: true });
  await seedPriorModelNegotiation(db!, f);
  const [contact] = await db!`SELECT phone FROM contacts WHERE id=${f.contact_id}`;
  const next = (text: string) => processInboundMessage({ schema_version: 1, source: 'botpress', channel: 'whatsapp',
    integration_id: 'vitest-agent-turn-fixture', external_message_id: randomUUID(),
    external_conversation_id: `agent-turn-fixture-${f.trace_id}`, external_user_id: `agent-turn-fixture-user-${f.trace_id}`,
    phone_e164: contact.phone, trace_id: randomUUID(), identity_owner: 'agent_a_v1',
    message: { type: 'text', text, occurred_at: new Date().toISOString(), reply_to_external_message_id: null } });
  const commit = (turnId: string, input: { move: string; secondary?: string[]; plan: string; course_reference?: string | null;
    action: Record<string, unknown>; message: string; mentions?: Array<{ offering_code: string; role: string }> }) =>
    commitAgentDecision({ turn_id: turnId, trace_id: randomUUID(), supports_multi_outbound: true,
      agent_turn_v2: { schema_version: 2, proposal: { ...f.proposalWithCallOfferAndFalsePrice,
        move: { schema_version: 1, move: input.move, secondary_moves: input.secondary ?? [], vetoes: [], confidence: 1,
          course_reference: input.course_reference ?? null, payment_plan: input.plan },
        proposed_action: input.action,
        course_mentions: input.mentions ?? [{ offering_code: COURSE, role: 'paid' }],
        response: { messages: [input.message], call_offer: null } } as never },
      decision: f.placeholderDecision as never, model: f.model as never });
  const salesState = async () => (await db!`SELECT selected_offering_code,selected_payment_plan,stage
    FROM conversation_sales_context_states_v1 WHERE conversation_id=${f.conversation_id}`)[0];
  return { f, next, commit, salesState };
}

run('link request from a null course/plan state (live 2026-11-10)', () => {
  it('persists a confirmed course and a plan chosen with no action, then creates the link from the persisted choice', async () => {
    const { f, next, commit, salesState } = await seed();
    const choice = await commit(f.second_turn_id, { move: 'select_course', secondary: ['select_payment_plan'], plan: 'one_time',
      course_reference: COURSE, action: { type: 'none' }, message: 'Perfecto, en un solo pago.' });
    expect(choice.status).toBe('committed');
    expect(await salesState()).toMatchObject({ selected_offering_code: COURSE, selected_payment_plan: 'one_time' });

    const request = await next('dale, mandame el link');
    await db!`UPDATE conversation_sales_context_states_v1 SET awaiting_reply='payment_confirmation'
      WHERE conversation_id=${f.conversation_id}`;
    const linked = await commit(request.turn_id, { move: 'request_payment_link', plan: 'one_time',
      action: { type: 'send_payment_link', offering_code: COURSE, payment_plan: 'one_time' }, message: 'Te paso el enlace.' });
    expect(linked.status).toBe('committed');
    const [payment] = await db!`SELECT plan_code,checkout_url FROM payments WHERE idempotency_key=${`agent-a-payment-link:${request.turn_id}`}`;
    expect(payment.plan_code).toBe('one_time');
    expect(linked.outbounds[0].content).toContain(payment.checkout_url);
    expect(await salesState()).toMatchObject({ selected_offering_code: COURSE, selected_payment_plan: 'one_time', stage: 'payment_link_sent' });
  });

  it('recovers a null course and plan from request_payment_link + send_payment_link declared paid and persists both', async () => {
    const { next, commit, salesState } = await seed();
    expect(await salesState()).toMatchObject({ selected_offering_code: null, selected_payment_plan: null });
    const request = await next('dale, mandame el link en un solo pago');
    const linked = await commit(request.turn_id, { move: 'request_payment_link', plan: 'one_time',
      action: { type: 'send_payment_link', offering_code: COURSE, payment_plan: 'one_time' }, message: 'Te paso el enlace.' });
    expect(linked.status).toBe('committed');
    const [payment] = await db!`SELECT plan_code,checkout_url FROM payments WHERE idempotency_key=${`agent-a-payment-link:${request.turn_id}`}`;
    expect(payment.plan_code).toBe('one_time');
    expect(linked.outbounds[0].content).toContain(payment.checkout_url);
    expect(await salesState()).toMatchObject({ selected_offering_code: COURSE, selected_payment_plan: 'one_time', stage: 'payment_link_sent' });
  });

  it('keeps rejecting an invented course, a course not declared paid and an invented plan', async () => {
    const { next, commit, salesState } = await seed();
    const request = await next('dale, mandame el link en un solo pago');
    const attempt = (over: Parameters<typeof commit>[1]) => commit(request.turn_id, over);
    const invented = await attempt({ move: 'request_payment_link', plan: 'one_time', mentions: [{ offering_code: 'curso_inventado', role: 'paid' }],
      action: { type: 'send_payment_link', offering_code: 'curso_inventado', payment_plan: 'one_time' }, message: 'Te paso el enlace.' }).catch(error => error);
    const notPaid = await attempt({ move: 'request_payment_link', plan: 'one_time', mentions: [{ offering_code: COURSE, role: 'alternative' }],
      action: { type: 'send_payment_link', offering_code: COURSE, payment_plan: 'one_time' }, message: 'Te paso el enlace.' }).catch(error => error);
    const plan = await attempt({ move: 'request_payment_link', plan: 'monthly_99',
      action: { type: 'send_payment_link', offering_code: COURSE, payment_plan: 'monthly_99' }, message: 'Te paso el enlace.' }).catch(error => error);
    for (const outcome of [invented, notPaid, plan]) {
      expect(outcome instanceof Error || outcome?.status !== 'committed' || outcome?.outbounds?.[0]?.content.includes('https://') === false).toBe(true);
    }
    expect(await db!`SELECT id FROM payments WHERE idempotency_key=${`agent-a-payment-link:${request.turn_id}`}`).toEqual([]);
    expect((await salesState()).stage).not.toBe('payment_link_sent');
  });

  it('keeps the promotion linked to the checkout created from the recovered state', async () => {
    const { f, next, commit, salesState } = await seed(COURSE);
    const identity = { workspace_id: f.workspace_id, contact_id: f.contact_id, conversation_id: f.conversation_id, paid_offering_code: COURSE };
    const outboundId = randomUUID();
    const offer = await offerBonusWithMotive(db!, { ...identity, source_turn_id: f.turn_id, expected_offer_version: 0,
      bonus_offering_codes: ['marketing_digital'], outbound: { id: outboundId, content: 'Bonus', provider: 'test',
        integration_id: 'test', channel: 'whatsapp', destination: 'test', idempotency_key: outboundId } });
    if (!offer.ok) throw new Error(offer.reason);
    await db!`UPDATE outbound_deliveries SET state='leased' WHERE message_id=${outboundId}`;
    await db!`UPDATE outbound_deliveries SET state='submitted',submitted_at=now() WHERE message_id=${outboundId}`;
    await db!`UPDATE outbound_deliveries SET state='delivered',delivered_at=now() WHERE message_id=${outboundId}`;
    await db!`UPDATE messages SET created_at=clock_timestamp(),metadata=metadata-'occurred_at_trusted' WHERE id=${f.second_turn_id}`;
    expect(await acceptDirectCourseBonusV1(db!, { ...identity, ...offer, source_turn_id: f.second_turn_id,
      expected_offer_version: 1 })).toMatchObject({ ok: true });
    // The durable course and plan were never persisted (the live failure).
    await db!`UPDATE conversation_sales_context_states_v1 SET selected_offering_code=NULL,selected_payment_plan=NULL,awaiting_reply='none'
      WHERE conversation_id=${f.conversation_id}`;
    const request = await next('dale, mandame el link en un solo pago');
    const linked = await commit(request.turn_id, { move: 'request_payment_link', plan: 'one_time',
      action: { type: 'send_payment_link', offering_code: COURSE, payment_plan: 'one_time', promotion_code: offer.promotion_code },
      message: 'Te paso el enlace.' });
    expect(linked.status).toBe('committed');
    const [payment] = await db!`SELECT id,plan_code,promotion_offer_id,checkout_url FROM payments
      WHERE idempotency_key=${`agent-a-payment-link:${request.turn_id}`}`;
    expect(payment).toMatchObject({ plan_code: 'one_time', promotion_offer_id: offer.offer_id });
    expect(await db!`SELECT offering_code_snapshot FROM payment_bonus_offerings WHERE payment_id=${payment.id}`)
      .toEqual([{ offering_code_snapshot: 'marketing_digital' }]);
    expect(await salesState()).toMatchObject({ selected_offering_code: COURSE, selected_payment_plan: 'one_time', stage: 'payment_link_sent' });
  });
});
