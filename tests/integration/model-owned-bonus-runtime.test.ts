import { processInboundMessage } from '@/lib/services/ingestion.service';
import { recordPromotionConversationContextV1, readCourseBonusCapabilityV1 } from '@/features/promotions/application/read-course-bonus-capability';
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openLocalTestDatabase } from '../helpers/db';
import { seedConversationForAgentTurn } from '../helpers/agent-turn-fixtures';
import { recordModelPriceObjection, seedPriorModelNegotiation } from '../helpers/record-model-negotiation-facts';
import { commitAgentDecision } from '@/lib/services/decision.service';
import { offerDirectCourseBonusV1 } from '@/features/promotions/application/direct-course-bonus-service';
import { readNegotiationFactsV1 } from '@/features/conversation/application/read-negotiation-facts';
import { sql as runtimeSql } from '@/lib/db/orchestrator';
import type { AgentATurnProposalV1 } from '../../botpress-agent/src/schemas/agent-a-brain';

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const db = process.env.TEST_DATABASE_URL ? openLocalTestDatabase() : null;
afterAll(async () => { await db?.end(); await runtimeSql.end(); });
beforeEach(() => {
  vi.stubEnv('COURSE_BONUS_FLOW_MODE', 'direct');
  vi.stubEnv('COURSE_BONUS_MAX_COURSES', '3');
  vi.stubEnv('CENTRAL_CARGA_BONUS_ENABLED', 'true');
});
afterEach(() => vi.unstubAllEnvs());

const paid = 'introduccion_ecommerce';
const bonus = 'fotografia_celulares_tiendas_online';
const fixed = ['Mirá, con Introducción al Ecommerce armás tu tienda desde cero.',
  'Te puedo sumar Fotografía con Celulares para Tiendas Online sin costo; el precio de Introducción al Ecommerce sigue igual. Avanzamos?'];

function proposal(): AgentATurnProposalV1 {
  return { schema_version: 1,
    move: { schema_version: 1, move: 'price_objection', secondary_moves: [], vetoes: [], confidence: 1 },
    response: { messages: fixed, call_offer: null },
    proposed_action: { type: 'offer_course_bonus', motive:{kind:'price_objection',quote:'me sigue pareciendo caro'}, interest_offering_code: paid, bonus_offering_code: bonus },
    course_mentions: [{ offering_code: paid, role: 'paid' }, { offering_code: bonus, role: 'bonus' }],
    used_fact_ids: [`offering:${paid}:name:v1`, `offering:${bonus}:name:v1`], used_memory_ids: [],
    memory_candidates: [{ type: 'objection', key: 'price_objection', value: 'precio', source_quote: 'me sigue pareciendo caro', confidence: 1 }],
    confirmed_phone: null, profile_updates: [], profile_requests: [], repair_of: null };
}

run('model-owned bonus at the actual commit and transactional boundaries', () => {
  it.each([
    ['promo_and_objection', 'Contame, qué es lo que más te frena para avanzar?',
      'noo\nquiero saber si hay alguna promo\nme parece caro el precio',
      { type: 'objection', key: 'price_objection', value: 'caro', source_quote: 'me parece caro el precio', confidence: 1 }],
    ['answers_the_price_question', 'Contame, el precio es lo único que te frena o hay algo más que querés saber?',
      'solo el precio',
      { type: 'constraint', key: 'price_only_barrier', value: 'confirmed', source_quote: 'solo el precio', confidence: 1 }],
  ] as const)('live 2026-11-02 18:43: "ingles" without level resolves the promotion to Inglés 1 (%s)', async (_kind, agentAsked, customerReply, evidence) => {
    const f = await seedConversationForAgentTurn({ selected_offering_code: null, first_message: 'ingles\nquiero saber el precio' });
    const first = proposal();
    first.move = { schema_version: 1, move: 'ask_course_information', secondary_moves: [], vetoes: [], confidence: 1 };
    first.response = { messages: ['Inglés tenemos del nivel 1 al 3.', agentAsked], call_offer: null };
    first.proposed_action = { type: 'none' };
    first.course_mentions = [];
    first.used_fact_ids = [];
    // Structured declaration that this turn asked the price question (a later bare reply can quote against it).
    first.memory_candidates = _kind === 'answers_the_price_question'
      ? [{ type: 'constraint', key: 'price_question_asked', value: 'asked', source_quote: 'ingles', confidence: 1 }] : [];
    const firstCommit = await commitAgentDecision({ turn_id: f.turn_id, trace_id: f.trace_id,
      supports_multi_outbound: true, agent_turn_v2: { schema_version: 2 as const, proposal: first },
      decision: f.placeholderDecision as never, model: f.model as never });
    expect(firstCommit.status).toBe('committed');
    await db!`UPDATE messages SET content=${customerReply},created_at=clock_timestamp(),
      metadata=metadata-'occurred_at_trusted' WHERE id=${f.second_turn_id}::uuid`;
    const capability = await readCourseBonusCapabilityV1({ workspace_slug: 'studyx', contact_id: f.contact_id,
      conversation_id: f.conversation_id, channel: 'text', selected_offering_code: null,
      source_turn_id: f.second_turn_id }, { db: db! });
    expect(capability).toMatchObject({ enabled: true, interest_offering_code: 'ingles_1',
      // No persisted evidence: only the current message (quoted in the motive) is a permission.
      // The price question the previous turn declared is read back structurally, never from its text.
      ladder: { retention_used: false, previous_turn_asked_price_question: _kind === 'answers_the_price_question' } });
    expect(capability.bonus_candidates?.map(course => course.code)).toContain('ingles_2');
    const offer = proposal();
    offer.move = { ...offer.move, move: 'price_objection' };
    offer.response = { messages: ['Te lo puedo resolver: si avanzás con Inglés 1, te bonifico Inglés 2. Arrancamos en 12 cuotas de USD 30?'], call_offer: null };
    offer.proposed_action = { type: 'offer_course_bonus', motive:{kind:'price_objection',quote: evidence.source_quote}, interest_offering_code: 'ingles_1', bonus_offering_code: 'ingles_2' };
    offer.course_mentions = [{ offering_code: 'ingles_1', role: 'paid' }, { offering_code: 'ingles_2', role: 'bonus' }];
    offer.used_fact_ids = ['offering:ingles_1:name:v1', 'offering:ingles_2:name:v1', 'payment-workspace:monthly_12:label:v1'];
    offer.memory_candidates = [{ ...evidence }];
    const committed = await commitAgentDecision({ turn_id: f.second_turn_id, trace_id: randomUUID(),
      supports_multi_outbound: true, agent_turn_v2: { schema_version: 2 as const, proposal: offer },
      decision: f.placeholderDecision as never, model: f.model as never });
    expect(committed.status).toBe('committed');
    const gifts = await db!<Array<{ code: string }>>`SELECT b.offering_code_snapshot code FROM promotion_offer_bonus_offerings b
      JOIN promotion_offers o ON o.id=b.offer_id WHERE o.conversation_id=${f.conversation_id}::uuid`;
    expect(gifts.map(gift => gift.code)).toEqual(['ingles_2']);
  });

  it('a first literal objection with no model memory grants no permission, whatever the wording', async () => {
    const f = await seedConversationForAgentTurn({ selected_offering_code: null, first_message: 'ingles' });
    await db!`UPDATE messages SET content='me parece caro',created_at=clock_timestamp(),
      metadata=metadata-'occurred_at_trusted' WHERE id=${f.second_turn_id}::uuid`;
    const capability = await readCourseBonusCapabilityV1({ workspace_slug: 'studyx', contact_id: f.contact_id,
      conversation_id: f.conversation_id, channel: 'text', selected_offering_code: null,
      source_turn_id: f.second_turn_id }, { db: db! });
    expect(capability.ladder).toEqual({ retention_used: false, previous_turn_asked_price_question: false });
  });

  it.each([
    ['no_alcanza', 'No me alcanza, ahora mismo estoy muy justo.', 'No me alcanza'],
    ['discount_wording', 'No me hacés un descuento? USD 360 me parece caro.', 'USD 360 me parece caro'],
  ] as const)('keeps the interest-only course identity through the final bonus commit (%s)', async (_kind, customerReply, quote) => {
    const f = await seedConversationForAgentTurn({ selected_offering_code: null,
      first_message: 'Quiero Marketing Digital para mejorar las ventas de mi emprendimiento. Cuánto cuesta?' });
    const marketing = 'marketing_digital';
    const advertising = 'publicidad_redes_sociales';
    const first = proposal();
    first.move = { ...first.move, move: 'ask_course_information', course_reference: marketing };
    first.response = { messages: [
      'Marketing Digital te sirve para trabajar las ventas de tu emprendimiento.',
      'Qué te gustaría lograr con el curso?',
    ], call_offer: null };
    first.proposed_action = { type: 'none' };
    first.course_mentions = [{ offering_code: marketing, role: 'paid' }];
    first.used_fact_ids = [`offering:${marketing}:name:v1`];
    first.memory_candidates = [];
    // Production starts without a conversation state row. The first ordinary
    // commercial reply must persist the interest-only identity before a later
    // discount request, without turning it into a purchase selection.
    await db!`DELETE FROM conversation_sales_context_state_events_v1
      WHERE conversation_id=${f.conversation_id}::uuid`;
    await db!`DELETE FROM conversation_sales_context_states_v1
      WHERE conversation_id=${f.conversation_id}::uuid`;
    const firstCommit = await commitAgentDecision({ turn_id: f.turn_id, trace_id: f.trace_id,
      supports_multi_outbound: true, agent_turn_v2: { schema_version: 2 as const, proposal: first },
      decision: f.placeholderDecision as never, model: f.model as never });
    expect(firstCommit.status).toBe('committed');
    const [persistedInterest] = await db!`SELECT interest_offering_code
      FROM conversation_promotion_context_v1
      WHERE conversation_id=${f.conversation_id}::uuid`;
    expect(persistedInterest).toMatchObject({ interest_offering_code: marketing });

    await db!`UPDATE messages SET content=${customerReply},created_at=clock_timestamp(),
      metadata=metadata-'occurred_at_trusted'
      WHERE id=${f.second_turn_id}::uuid`;
    const before = await readCourseBonusCapabilityV1({ workspace_slug: 'studyx', contact_id: f.contact_id,
      conversation_id: f.conversation_id, channel: 'text', selected_offering_code: null,
      source_turn_id: f.second_turn_id }, { db: db! });
    expect(before).toMatchObject({ enabled: true, interest_offering_code: marketing, may_offer_bonus: true,
      ladder: { retention_used: false, previous_turn_asked_price_question: false } });
    expect(before.bonus_candidates?.map(course => course.code)).toContain(advertising);

    const bonus = proposal();
    bonus.move = { ...bonus.move, move: 'price_objection' };
    bonus.response = { messages: [
      'El precio de Marketing Digital sigue igual y te sumo Publicidad en Redes Sociales sin costo extra. Avanzamos?',
    ], call_offer: 'Si querés, te llamo un momento y lo vemos juntos.' };
    bonus.proposed_action = { type: 'offer_course_bonus', motive:{kind:'price_objection',quote}, interest_offering_code: marketing,
      bonus_offering_code: advertising };
    bonus.course_mentions = [{ offering_code: marketing, role: 'paid' },
      { offering_code: advertising, role: 'bonus' }];
    bonus.used_fact_ids = [`offering:${marketing}:name:v1`, `offering:${advertising}:name:v1`];
    // The motive quotes this turn's own text.
    bonus.memory_candidates = [{ type: 'objection', key: 'price_objection', value: 'caro', source_quote: quote, confidence: 1 }];
    const committed = await commitAgentDecision({ turn_id: f.second_turn_id, trace_id: randomUUID(),
      supports_multi_outbound: true, agent_turn_v2: { schema_version: 2 as const, proposal: bonus },
      decision: f.placeholderDecision as never, model: f.model as never });
    expect(committed.status).toBe('committed');
    const [offer] = await db!`SELECT paid.code paid_code,o.status,count(gift.id)::int bonus_count
      FROM promotion_offers o JOIN offerings paid ON paid.id=o.paid_offering_id
      JOIN promotion_offer_bonus_offerings gift ON gift.offer_id=o.id
      WHERE o.conversation_id=${f.conversation_id}::uuid GROUP BY paid.code,o.status`;
    expect(offer).toMatchObject({ paid_code: marketing, status: 'offered', bonus_count: 1 });
    const [state] = await db!`SELECT selected_offering_code FROM conversation_sales_context_states_v1
      WHERE conversation_id=${f.conversation_id}::uuid`;
    expect(state.selected_offering_code).toBeNull();
  });

  it('H1: a bonus whose copy does not name the course commits no gift and never marks one delivered', async () => {
    const f = await seedConversationForAgentTurn({ selected_offering_code: paid, first_message: 'me sigue pareciendo caro' });
    await seedPriorModelNegotiation(db!, f, 1);
    const draft = proposal();
    draft.response = { messages: ['Mirá, con Introducción al Ecommerce armás tu tienda.', 'Te sumo otro curso sin costo y el precio sigue igual. Avanzamos?'], call_offer: null };
    draft.course_mentions = [{ offering_code: paid, role: 'paid' }];
    const committed = await commitAgentDecision({ turn_id: f.turn_id, trace_id: f.trace_id, supports_multi_outbound: true,
      supports_send_fencing: true, agent_turn_v2: { schema_version: 2 as const, proposal: draft },
      decision: f.placeholderDecision as never, model: f.model as never });
    expect(committed.status).toBe('committed');
    const gifts = await db!`SELECT 1 FROM promotion_offer_bonus_offerings b JOIN promotion_offers o ON o.id=b.offer_id
      WHERE o.conversation_id=${f.conversation_id}::uuid`;
    expect(gifts).toHaveLength(0);
  });

  it('M5: the capability stops advertising a new bonus once the sale is in checkout', async () => {
    const f = await seedConversationForAgentTurn({ selected_offering_code: paid, first_message: 'me sigue pareciendo caro' });
    await seedPriorModelNegotiation(db!, f, 1);
    const read = () => readCourseBonusCapabilityV1({ workspace_slug: 'studyx', contact_id: f.contact_id,
      conversation_id: f.conversation_id, channel: 'text', selected_offering_code: paid, source_turn_id: f.turn_id }, { db: db! });
    expect((await read()).may_offer_bonus).toBe(true);
    await db!`UPDATE conversation_sales_context_states_v1 SET awaiting_reply='contact_details'
      WHERE conversation_id=${f.conversation_id}::uuid`;
    expect((await read()).may_offer_bonus).toBe(false);
  });

  it('never cancels the bubble that carries the committed offer when the customer writes between bubbles', async () => {
    const f = await seedConversationForAgentTurn({ selected_offering_code: paid, first_message: 'me sigue pareciendo caro' });
    await seedPriorModelNegotiation(db!, f, 1);
    const committed = await commitAgentDecision({ turn_id: f.turn_id, trace_id: f.trace_id, supports_multi_outbound: true,
      supports_send_fencing: true, agent_turn_v2: { schema_version: 2 as const, proposal: proposal() },
      decision: f.placeholderDecision as never, model: f.model as never });
    expect(committed.outbounds.map(part => part.content)).toEqual(fixed);
    expect(committed.outbounds[1]).not.toHaveProperty('minimum_delay_before_ms');
    await db!`UPDATE outbound_deliveries SET state='submitted',submitted_at=now(),provider_message_id=${`bp-pause-${randomUUID()}`}
      WHERE message_id=${committed.outbounds[0].id}`;
    await db!`INSERT INTO messages(id,conversation_id,contact_id,direction,content,created_at,conversation_seq)
      VALUES (${randomUUID()}::uuid,${f.conversation_id}::uuid,${f.contact_id}::uuid,'inbound','dale',now()+interval '1 second',
        (SELECT coalesce(max(conversation_seq),0)+1 FROM messages WHERE conversation_id=${f.conversation_id}::uuid))`;
    const { authorizeDeliveryContinuation } = await import('@/lib/services/delivery-continuation.service');
    expect(await authorizeDeliveryContinuation({ outbound_id: committed.outbounds[1].id, trace_id: f.trace_id,
      delivery_attempt: committed.outbounds[1].delivery_attempt })).toMatchObject({ outcome: 'authorized' });
    const [delivery] = await db!`SELECT state FROM outbound_deliveries WHERE message_id=${committed.outbounds[1].id}`;
    expect(delivery.state).not.toBe('cancelled');
  });

  it('still cancels the committed offer bubble when the customer opted out between bubbles', async () => {
    const f = await seedConversationForAgentTurn({ selected_offering_code: paid, first_message: 'me sigue pareciendo caro' });
    await seedPriorModelNegotiation(db!, f, 1);
    const committed = await commitAgentDecision({ turn_id: f.turn_id, trace_id: f.trace_id, supports_multi_outbound: true,
      supports_send_fencing: true, agent_turn_v2: { schema_version: 2 as const, proposal: proposal() },
      decision: f.placeholderDecision as never, model: f.model as never });
    await db!`UPDATE outbound_deliveries SET state='submitted',submitted_at=now(),provider_message_id=${`bp-optout-${randomUUID()}`}
      WHERE message_id=${committed.outbounds[0].id}`;
    await db!`INSERT INTO messages(id,conversation_id,contact_id,direction,content,created_at,conversation_seq)
      VALUES (${randomUUID()}::uuid,${f.conversation_id}::uuid,${f.contact_id}::uuid,'inbound','no me escribas más',now()+interval '1 second',
        (SELECT coalesce(max(conversation_seq),0)+1 FROM messages WHERE conversation_id=${f.conversation_id}::uuid))`;
    await db!`INSERT INTO contact_channel_permissions(contact_id,channel,consent_status)
      SELECT ${f.contact_id}::uuid, channel, 'revoked' FROM conversations WHERE id=${f.conversation_id}::uuid
      ON CONFLICT (contact_id,channel) DO UPDATE SET consent_status='revoked'`;
    const { authorizeDeliveryContinuation } = await import('@/lib/services/delivery-continuation.service');
    expect(await authorizeDeliveryContinuation({ outbound_id: committed.outbounds[1].id, trace_id: f.trace_id,
      delivery_attempt: committed.outbounds[1].delivery_attempt })).toMatchObject({ outcome: 'superseded' });
  });

  it('commits the next bonus when this reply states a new price complaint (second step)', async () => {
    const f = await seedConversationForAgentTurn({ selected_offering_code: paid, first_message: 'Me parece caro. Tenés alguna promo?' });
    await seedPriorModelNegotiation(db!, f, 1);
    const firstOutbound = randomUUID();
    const first = await offerDirectCourseBonusV1(db!, { workspace_id: f.workspace_id, contact_id: f.contact_id,
      conversation_id: f.conversation_id, paid_offering_code: paid, source_turn_id: f.turn_id,
      expected_offer_version: 0, bonus_offering_codes: [bonus], motive: { kind: 'price_objection', quote: 'Me parece caro' }, declared_moves: ['price_objection'],
      outbound: { id: firstOutbound, content: fixed[1],
        provider: 'test', integration_id: 'test', channel: 'whatsapp', destination: 'test', idempotency_key: firstOutbound } });
    expect(first).toMatchObject({ ok: true, offer_version: 1 });
    await db!`UPDATE outbound_deliveries SET state='leased',leased_by='price-only-test',lease_until=clock_timestamp()+interval '1 minute'
      WHERE message_id=${firstOutbound}::uuid`;
    await db!`UPDATE outbound_deliveries SET state='submitted',submitted_at=clock_timestamp(),
      provider_message_id=${`bp-price-only-${randomUUID()}`} WHERE message_id=${firstOutbound}::uuid`;
    await db!`UPDATE outbound_deliveries SET state='delivered',delivered_at=clock_timestamp()
      WHERE message_id=${firstOutbound}::uuid`;
    const customer = 'Sí, el precio es el único freno.';
    await db!`UPDATE messages SET content=${customer},created_at=clock_timestamp(),
      metadata=metadata-'occurred_at_trusted' WHERE id=${f.second_turn_id}::uuid`;

    const nextCode = 'publicidad_redes_sociales';
    const next = proposal();
    next.move = { ...next.move, move: 'price_objection' };
    next.response = { messages: [
      'Te quedan Introducción al Ecommerce + Fotografía con Celulares para Tiendas Online + Publicidad en Redes Sociales sin costo extra, al mismo precio. Avanzamos?',
    ], call_offer: null };
    next.proposed_action = { type: 'offer_course_bonus', motive:{kind:'price_objection',quote:'el precio es el único freno'}, interest_offering_code: paid, bonus_offering_code: nextCode };
    next.course_mentions = [{ offering_code: paid, role: 'paid' }, { offering_code: bonus, role: 'bonus' },
      { offering_code: nextCode, role: 'bonus' }];
    next.used_fact_ids = [`offering:${paid}:name:v1`, `offering:${bonus}:name:v1`, `offering:${nextCode}:name:v1`];
    next.memory_candidates = [{ type: 'constraint', key: 'price_only_barrier', value: 'confirmed',
      source_quote: 'el precio es el único freno', confidence: 1 }];
    const capability = await readCourseBonusCapabilityV1({ workspace_slug: 'studyx', contact_id: f.contact_id,
      conversation_id: f.conversation_id, channel: 'text', selected_offering_code: paid,
      source_turn_id: f.second_turn_id }, { db: db! });
    expect(capability).toMatchObject({ enabled: true, package_status: 'offered', offer_version: 1 });
    expect(capability.bonus_candidates?.map(course => course.code)).toContain(nextCode);
    const committed = await commitAgentDecision({ turn_id: f.second_turn_id, trace_id: randomUUID(),
      supports_multi_outbound: true, agent_turn_v2: { schema_version: 2 as const, proposal: next },
      decision: f.placeholderDecision as never, model: f.model as never });
    expect(committed.status).toBe('committed');
    const [offer] = await db!`SELECT offer_version FROM promotion_offers WHERE id=${first.ok ? first.offer_id : null}::uuid`;
    expect(offer.offer_version).toBe(2);
    const gifts = await db!<Array<{code:string}>>`SELECT offering_code_snapshot code FROM promotion_offer_bonus_offerings
      WHERE offer_id=${first.ok ? first.offer_id : null}::uuid ORDER BY position`;
    expect(gifts.map(gift => gift.code)).toEqual([bonus, nextCode]);
  });

  describe('the persisted objection no longer re-enables the bonus (real trace 2026-11-04)', () => {
    async function afterFirstBonus() {
      const f = await seedConversationForAgentTurn({ selected_offering_code: paid, first_message: 'Me parece caro. Tenés alguna promo?' });
      await seedPriorModelNegotiation(db!, f, 2);
      const firstOutbound = randomUUID();
      const first = await offerDirectCourseBonusV1(db!, { workspace_id: f.workspace_id, contact_id: f.contact_id,
        conversation_id: f.conversation_id, paid_offering_code: paid, source_turn_id: f.turn_id,
        expected_offer_version: 0, bonus_offering_codes: [bonus], motive: { kind: 'price_objection', quote: 'Me parece caro' },
        declared_moves: ['price_objection'], outbound: { id: firstOutbound, content: fixed[1],
          provider: 'test', integration_id: 'test', channel: 'whatsapp', destination: 'test', idempotency_key: firstOutbound } });
      if (!first.ok) throw new Error(first.reason);
      await db!`UPDATE outbound_deliveries SET state='leased',leased_by='trace-test',lease_until=clock_timestamp()+interval '1 minute' WHERE message_id=${firstOutbound}::uuid`;
      await db!`UPDATE outbound_deliveries SET state='submitted',submitted_at=clock_timestamp(),provider_message_id=${`bp-trace-${randomUUID()}`} WHERE message_id=${firstOutbound}::uuid`;
      await db!`UPDATE outbound_deliveries SET state='delivered',delivered_at=clock_timestamp() WHERE message_id=${firstOutbound}::uuid`;
      const customerTurn = async (text: string) => {
        await db!`UPDATE messages SET content=${text},created_at=clock_timestamp(),metadata=metadata-'occurred_at_trusted' WHERE id=${f.second_turn_id}::uuid`;
      };
      const pkg = async () => (await db!`SELECT o.promotion_cycle_id,o.offer_version,
        (SELECT count(*)::int FROM promotion_offer_bonus_offerings b WHERE b.offer_id=o.id) bonus_count
        FROM promotion_offers o WHERE o.conversation_id=${f.conversation_id}::uuid ORDER BY o.created_at`);
      const attempt = (text: string, p: AgentATurnProposalV1) => commitAgentDecision({ turn_id: f.second_turn_id, trace_id: randomUUID(),
        supports_multi_outbound: true, agent_turn_v2: { schema_version: 2 as const, proposal: p },
        decision: f.placeholderDecision as never, model: f.model as never });
      return { f, customerTurn, pkg, attempt };
    }
    const nextCode = 'publicidad_redes_sociales';
    const offerProposal = (move: string, kind: 'price_objection' | 'better_promotion_request' | 'promotion_rejection', quote: string, messages: string[]) => {
      const p = proposal();
      p.move = { schema_version: 1, move: move as never, secondary_moves: [], vetoes: [], confidence: 0.86 };
      p.response = { messages, call_offer: null };
      p.proposed_action = { type: 'offer_course_bonus', motive: { kind, quote }, interest_offering_code: paid, bonus_offering_code: nextCode };
      p.course_mentions = [{ offering_code: paid, role: 'paid' }, { offering_code: bonus, role: 'bonus' }];
      p.used_fact_ids = []; p.memory_candidates = [];
      return p;
    };
    const noClaim = ['Es un solo curso pago, y el que ya te sumé queda incluido. Cómo seguimos con tu inscripción?'];
    const claims = ['Te sumo Publicidad en Redes Sociales sin costo. Avanzamos?'];

    it('clarification ("osea me regalas otro curso?" + "dos por uno?") with an invalid motive: the package is unchanged and the text is still sent', async () => {
      const { f, customerTurn, pkg, attempt } = await afterFirstBonus();
      await customerTurn('osea me regalas otro curso?\ndos por uno?');
      const before = await pkg();
      const committed = await attempt('', offerProposal('ask_course_information', 'price_objection', 'osea me regalas otro curso?', noClaim));
      expect(committed.status).toBe('committed');
      expect(committed.outbounds.map(part => part.content).join(' ')).toContain('Es un solo curso pago');
      expect(await pkg()).toEqual(before);
      const [decision] = await db!`SELECT business_action FROM agent_decisions WHERE turn_id=${f.second_turn_id}`;
      expect(decision.business_action).toBeNull();
    });

    it('the same trace with copy that claims the gift is rejected for repair, leaving the package untouched', async () => {
      const { customerTurn, pkg, attempt } = await afterFirstBonus();
      await customerTurn('osea me regalas otro curso?\ndos por uno?');
      const before = await pkg();
      await expect(attempt('', offerProposal('ask_course_information', 'price_objection', 'dos por uno?', claims)))
        .rejects.toMatchObject({ subjects: expect.arrayContaining(['direct_bonus:ladder_step_pending', 'bonus_ladder:missing:current_message_motive']) });
      expect(await pkg()).toEqual(before);
    });

    it('a payment question never opens a bonus', async () => {
      const { customerTurn, pkg, attempt } = await afterFirstBonus();
      const before = await pkg();
      await customerTurn('¿cómo sería el pago?');
      const paymentCommit = await attempt('', offerProposal('ask_payment_options', 'price_objection', '¿cómo sería el pago?', noClaim));
      expect(paymentCommit.status).toBe('committed');
      expect(await pkg()).toEqual(before);
    });

    it('explicit_promotion_request whose quote is not in the current batch is rejected', async () => {
      const { customerTurn, pkg, attempt } = await afterFirstBonus();
      const before = await pkg();
      await customerTurn('dale, quiero pagar');
      await expect(attempt('', offerProposal('explicit_promotion_request', 'better_promotion_request', 'me gustaría otra promo', claims)))
        .rejects.toMatchObject({ subjects: expect.arrayContaining(['direct_bonus:ladder_step_pending']) });
      expect(await pkg()).toEqual(before);
    });

    it('a new price complaint declared as price_objection with its quote adds the second bonus', async () => {
      const { customerTurn, pkg, attempt } = await afterFirstBonus();
      await customerTurn('igual sigue siendo caro');
      const p = offerProposal('price_objection', 'price_objection', 'igual sigue siendo caro',
        ['Te quedan Introducción al Ecommerce + Fotografía con Celulares para Tiendas Online + Publicidad en Redes Sociales sin costo extra, al mismo precio. Avanzamos?']);
      p.course_mentions = [{ offering_code: paid, role: 'paid' }, { offering_code: bonus, role: 'bonus' }, { offering_code: nextCode, role: 'bonus' }];
      const committed = await attempt('', p);
      expect(committed.status).toBe('committed');
      expect(await pkg()).toMatchObject([{ offer_version: 2, bonus_count: 2 }]);
    });

    it('"me bonificas Publicidad en Redes Sociales?" with explicit_promotion_request is allowed within limits', async () => {
      const { customerTurn, pkg, attempt } = await afterFirstBonus();
      await customerTurn('me bonificas Publicidad en Redes Sociales?');
      const p = offerProposal('explicit_promotion_request', 'better_promotion_request', 'me bonificas Publicidad en Redes Sociales?',
        ['Claro, te sumo Publicidad en Redes Sociales sin costo extra junto a lo que ya tienes. Avanzamos?']);
      p.course_mentions = [{ offering_code: paid, role: 'paid' }, { offering_code: bonus, role: 'bonus' }, { offering_code: nextCode, role: 'bonus' }];
      expect((await attempt('', p)).status).toBe('committed');
      expect(await pkg()).toMatchObject([{ offer_version: 2, bonus_count: 2 }]);
    });
  });

  // 2026-11-05 (5b138536): llamada terminal, el cliente siguió por chat y pidió
  // una promo explícita. Antes: stage=handoff → may_offer_bonus=false, sin oferta.
  it.each([['completed', true], ['in_progress', false]] as const)(
    'after a call (%s) and "sigamos por acá", a current price objection creates exactly one affine offer only once the call is terminal',
    async (callStatus, creates) => {
      // 18:31:54Z: la queja actual de precio (motivo válido del primer bonificado,
      // AGENTS.md:212) tampoco generó oferta mientras el stage seguía en handoff.
      const quote = 'porque el problema SI es el precio';
      const f = await seedConversationForAgentTurn({ selected_offering_code: paid, first_message: quote });
      await seedPriorModelNegotiation(db!, f, 2);
      await db!`UPDATE conversation_sales_context_states_v1 SET stage='handoff',call_preference='chat',call_offer_status='declined',
        awaiting_reply='none' WHERE conversation_id=${f.conversation_id}::uuid`;
      await db!`INSERT INTO call_sessions(workspace_id,source_turn_id,contact_id,conversation_id,provider,request_idempotency_key,status,
        consent_source_message_id,context_snapshot,context_hash,prompt_version,completed_at)
        VALUES (${f.workspace_id},${f.turn_id},${f.contact_id},${f.conversation_id},'telegram_sandbox',${randomUUID()},${callStatus},
          ${f.turn_id},'{}'::jsonb,decode(repeat('00',32),'hex'),'fixture',${callStatus === 'completed' ? new Date() : null})`;
      const capability = await readCourseBonusCapabilityV1({ workspace_slug: 'studyx', contact_id: f.contact_id,
        conversation_id: f.conversation_id, selected_offering_code: paid, source_turn_id: f.turn_id, channel: 'text' }, { db: db! });
      expect(capability?.may_offer_bonus).toBe(creates);
      // The claim route reads through the resilient runtime client, which runs
      // every tagged call eagerly (replay 8a87f03: a nested fragment broke it).
      const viaRuntime = await readCourseBonusCapabilityV1({ workspace_slug: 'studyx', contact_id: f.contact_id,
        conversation_id: f.conversation_id, selected_offering_code: paid, source_turn_id: f.turn_id, channel: 'text' },
        { db: runtimeSql as never });
      expect(viaRuntime?.may_offer_bonus).toBe(creates);
      const p = proposal();
      p.move = { schema_version: 1, move: 'price_objection', secondary_moves: [], vetoes: [], confidence: 0.9 };
      p.proposed_action = { type: 'offer_course_bonus', motive: { kind: 'price_objection', quote },
        interest_offering_code: paid, bonus_offering_code: bonus };
      p.memory_candidates = [];
      const commit = () => commitAgentDecision({ turn_id: f.turn_id, trace_id: randomUUID(), supports_multi_outbound: true,
        agent_turn_v2: { schema_version: 2 as const, proposal: p }, decision: f.placeholderDecision as never, model: f.model as never });
      if (creates) expect((await commit()).status).toBe('committed');
      else await commit().catch(() => undefined);
      const offers = await db!`SELECT o.id,(SELECT count(*)::int FROM promotion_offer_bonus_offerings b WHERE b.offer_id=o.id) bonus_count
        FROM promotion_offers o WHERE o.conversation_id=${f.conversation_id}::uuid`;
      expect(offers.map(o => o.bonus_count)).toEqual(creates ? [1] : []);
    });

  it.each(['persisted_selection', 'interest_only'] as const)(
    'automatically seals a delivered offered package in the actual payment-link commit, without accept_promotion (%s)', async identityKind => {
      vi.stubEnv('PAYMENT_LINK_CONTADO', 'https://buy.stripe.com/test_rule_a_auto');
      const f = await seedConversationForAgentTurn({ selected_offering_code: identityKind === 'persisted_selection' ? paid : null,
        intake_complete: true });
      await seedPriorModelNegotiation(db!, f, 2);
      if (identityKind === 'interest_only') await recordPromotionConversationContextV1(db!, { ...f,
        source_turn_id: f.turn_id, discussed_offering_code: paid, records_price_objection: false });
      const outbound = randomUUID();
      const offer = await offerDirectCourseBonusV1(db!, { workspace_id: f.workspace_id, contact_id: f.contact_id,
        conversation_id: f.conversation_id, paid_offering_code: paid, source_turn_id: f.turn_id,
        expected_offer_version: 0, bonus_offering_codes: [bonus], motive: { kind: 'price_objection', quote: 'Hola, soy Ana Pérez' }, declared_moves: ['price_objection'],
        outbound: { id: outbound, content: fixed[1],
          provider: 'test', integration_id: 'test', channel: 'whatsapp', destination: 'test', idempotency_key: outbound } });
      if (!offer.ok) throw new Error(offer.reason);
      await db!`UPDATE outbound_deliveries SET state='leased' WHERE message_id=${outbound}`;
      await db!`UPDATE outbound_deliveries SET state='submitted',submitted_at=now() WHERE message_id=${outbound}`;
      await db!`UPDATE outbound_deliveries SET state='delivered',delivered_at=now() WHERE message_id=${outbound}`;
      const [before] = await db!`SELECT status FROM promotion_offers WHERE id=${offer.offer_id}`;
      expect(before.status).toBe('offered');
      const [delivery] = await db!`SELECT delivered_at FROM outbound_deliveries WHERE message_id=${outbound}`;
      const afterDelivery = new Date(new Date(delivery.delivered_at).getTime() + 1000).toISOString();
      const [contact] = await db!`SELECT phone FROM contacts WHERE id=${f.contact_id}`;
      const next = await processInboundMessage({ schema_version: 1, source: 'botpress', channel: 'whatsapp',
        integration_id: 'vitest-agent-turn-fixture', external_message_id: randomUUID(),
        external_conversation_id: `agent-turn-fixture-${f.trace_id}`, external_user_id: `agent-turn-fixture-user-${f.trace_id}`,
        phone_e164: contact.phone, trace_id: randomUUID(), identity_owner: 'agent_a_v1',
        message: { type: 'text', text: 'Quiero Introducción al Ecommerce en un pago. Pasame el link de pago.',
          occurred_at: afterDelivery, reply_to_external_message_id: null } });
      const draft = proposal();
      const input = { turn_id: next.turn_id, trace_id: f.trace_id, supports_multi_outbound: true,
        authorized_offering_code: paid, authorized_payment_plan: 'one_time' as const,
        agent_turn_v2: { schema_version: 2 as const, proposal: { ...draft,
          move: { schema_version: 1 as const, move: 'request_payment_link' as const,
            secondary_moves: ['select_course' as const, 'select_payment_plan' as const], vetoes: [],
            course_reference: paid, payment_plan: 'one_time' as const, confidence: 1 },
          proposed_action: { type: 'send_payment_link' as const, offering_code: paid, payment_plan: 'one_time' as const },
          response: { messages: ['Te comparto el enlace para avanzar.'], call_offer: null },
          course_mentions: [], used_fact_ids: [], memory_candidates: [] } },
        decision: f.placeholderDecision as never, model: f.model as never };
      const capability = await readCourseBonusCapabilityV1({ workspace_slug: 'studyx', contact_id: f.contact_id,
        conversation_id: f.conversation_id, selected_offering_code: paid, source_turn_id: next.turn_id, channel: 'text' }, { db: db! });
      expect(capability, 'fixture must expose the delivered package before checkout').toMatchObject({ may_accept_offer: true, package_status: 'offered' });
      const committed = await commitAgentDecision(input);
      expect(committed.status).toBe('committed');
      expect(committed.outbounds[0].content, 'the commit must authorize a real payment link').toContain('https://buy.stripe.com/test_rule_a_auto');
      const [sealed] = await db!`SELECT status,accepted_source_turn_id,offer_version FROM promotion_offers WHERE id=${offer.offer_id}`;
      expect(sealed.status).toBe('attached');
      expect(sealed.accepted_source_turn_id).toBe(next.turn_id);
      const [payment] = await db!`SELECT id,promotion_offer_id,promotion_cycle_id,accepted_offer_version,checkout_url
        FROM payments WHERE idempotency_key=${`agent-a-payment-link:${next.turn_id}`}`;
      expect(payment).toMatchObject({ promotion_offer_id: offer.offer_id, promotion_cycle_id: offer.promotion_cycle_id,
        accepted_offer_version: 1 });
      expect(await db!`SELECT offering_code_snapshot,position FROM payment_bonus_offerings WHERE payment_id=${payment.id}`)
        .toEqual([{ offering_code_snapshot: bonus, position: 1 }]);
      expect(committed.outbounds[0].content).toContain(payment.checkout_url);
      const replayed = await commitAgentDecision(input);
      expect(replayed.replayed).toBe(true);
      expect(replayed.outbounds.map(part => part.id)).toEqual(committed.outbounds.map(part => part.id));
      expect((await db!`SELECT id FROM payments WHERE idempotency_key=${`agent-a-payment-link:${next.turn_id}`}`).length).toBe(1);
    });

  it.each(['payment_plan', 'payment_confirmation', 'contact_details', 'pending_link', 'payment_link_sent', 'handoff'])(
    'rejects a new transactional bonus throughout checkout: %s', async boundary => {
      const f = await seedConversationForAgentTurn({ selected_offering_code: paid });
      await seedPriorModelNegotiation(db!, f);
      if (boundary === 'pending_link') await db!`UPDATE conversation_sales_context_states_v1 SET payment_link_request=${db!.json({
        status: 'pending', offering_code: paid, payment_plan: 'one_time', requested_by_turn_id: f.turn_id, resolved_by_decision_id: null,
      })} WHERE conversation_id=${f.conversation_id}`;
      else if (boundary === 'payment_link_sent' || boundary === 'handoff') await db!`
        UPDATE conversation_sales_context_states_v1 SET stage=${boundary} WHERE conversation_id=${f.conversation_id}`;
      else await db!`UPDATE conversation_sales_context_states_v1 SET awaiting_reply=${boundary} WHERE conversation_id=${f.conversation_id}`;
      const outbound = randomUUID();
      const result = await offerDirectCourseBonusV1(db!, { workspace_id: f.workspace_id, contact_id: f.contact_id,
        conversation_id: f.conversation_id, paid_offering_code: paid, source_turn_id: f.turn_id,
        expected_offer_version: 0, bonus_offering_codes: [bonus], outbound: { id: outbound, content: fixed[1],
          provider: 'test', integration_id: 'test', channel: 'whatsapp', destination: 'test', idempotency_key: outbound } });
      expect(result).toMatchObject({ ok: false, reason: 'sale_already_closed' });
      expect(await db!`SELECT id FROM promotion_offer_bonus_offerings WHERE source_turn_id=${f.turn_id}`).toEqual([]);
    });

  it.each(['es caro?', 'no es caro', 'no me parece caro'])(
    'does not persist/count a misclassified partial price quote in «%s»', async text => {
      const f = await seedConversationForAgentTurn({ selected_offering_code: paid, first_message: text });
      const draft = proposal();
      const result = await commitAgentDecision({ turn_id: f.turn_id, trace_id: f.trace_id,
        agent_turn_v2: { schema_version: 2, proposal: { ...draft, response: { messages: ['Te cuento las opciones.'] },
          proposed_action: { type: 'none' }, course_mentions: [], used_fact_ids: [] } },
        decision: f.placeholderDecision as never, model: f.model as never });
      expect(result.status).toBe('committed');
      const [recorded] = await db!`SELECT memory_candidates FROM agent_decisions WHERE turn_id=${f.turn_id}`;
      expect(recorded.memory_candidates).toEqual([]);
      const facts = await readNegotiationFactsV1({ workspace_slug: 'studyx', conversation_id: f.conversation_id,
        contact_id: f.contact_id, source_turn_id: f.second_turn_id, selected_offering_code: paid }, { db: db! });
      expect(facts?.price_objection_count).toBe(0);
    });

  it.each(['Me parece caro. No me alcanza.', 'Me parece caro\nNo me alcanza.'])(
    'preserves/counts a literal committed model quote spanning sentences or lines: %s', async text => {
      const f = await seedConversationForAgentTurn({ selected_offering_code: paid, first_message: text });
      const draft = proposal();
      const memory = { ...draft.memory_candidates[0], source_quote: text };
      const result = await commitAgentDecision({ turn_id: f.turn_id, trace_id: f.trace_id,
        agent_turn_v2: { schema_version: 2, proposal: { ...draft, response: { messages: ['Te cuento las opciones.'] },
          proposed_action: { type: 'none' }, course_mentions: [], used_fact_ids: [], memory_candidates: [memory] } },
        decision: f.placeholderDecision as never, model: f.model as never });
      expect(result.status).toBe('committed');
      const [recorded] = await db!`SELECT memory_candidates FROM agent_decisions WHERE turn_id=${f.turn_id}`;
      expect(recorded.memory_candidates).toEqual([memory]);
      const facts = await readNegotiationFactsV1({ workspace_slug: 'studyx', conversation_id: f.conversation_id,
        contact_id: f.contact_id, source_turn_id: f.second_turn_id, selected_offering_code: paid }, { db: db! });
      expect(facts?.price_objection_count).toBe(1);
    });

  it.each(['es caro?', 'no es caro'])(
    'also excludes already committed historical partial price quotes in «%s»', async text => {
      const f = await seedConversationForAgentTurn({ selected_offering_code: paid, first_message: text });
      await recordModelPriceObjection(db!, f.turn_id, { source_quote: 'caro' });
      const facts = await readNegotiationFactsV1({ workspace_slug: 'studyx', conversation_id: f.conversation_id,
        contact_id: f.contact_id, source_turn_id: f.second_turn_id, selected_offering_code: paid }, { db: db! });
      expect(facts?.price_objection_count).toBe(0);
      expect(facts?.latest_price_objection_source_turn_ids).not.toContain(f.turn_id);
    });
});
