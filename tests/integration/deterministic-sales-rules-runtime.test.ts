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
import type { AgentATurnProposalV1 } from '@/features/conversation/domain/agent-a-brain';

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const db = process.env.TEST_DATABASE_URL ? openLocalTestDatabase() : null;
afterAll(async () => db?.end());
beforeEach(() => {
  vi.stubEnv('COURSE_BONUS_FLOW_MODE', 'direct');
  vi.stubEnv('COURSE_BONUS_MAX_COURSES', '3');
  vi.stubEnv('CENTRAL_CARGA_BONUS_ENABLED', 'true');
});
afterEach(() => vi.unstubAllEnvs());

const paid = 'introduccion_ecommerce';
const bonus = 'fotografia_celulares_tiendas_online';
const fixed = ['Dejame revisar qué te puedo ofrecer, dame un segundo.',
  'Te puedo sumar Fotografía con Celulares para Tiendas Online sin costo; el precio de Introducción al Ecommerce sigue igual. Avanzamos?'];

function proposal(): AgentATurnProposalV1 {
  return { schema_version: 1,
    move: { schema_version: 1, move: 'ask_course_information', course_reference: paid,
      secondary_moves: [], vetoes: [], confidence: 1 },
    response: { messages: fixed, call_offer: null },
    proposed_action: { type: 'offer_course_bonus', interest_offering_code: paid, bonus_offering_code: bonus },
    course_mentions: [{ offering_code: paid, role: 'paid' }, { offering_code: bonus, role: 'bonus' }],
    used_fact_ids: [`offering:${paid}:name:v1`, `offering:${bonus}:name:v1`], used_memory_ids: [],
    memory_candidates: [{ type: 'objection', key: 'price_objection', value: 'precio', source_quote: 'caro', confidence: 1 }],
    confirmed_phone: null, profile_updates: [], profile_requests: [], repair_of: null };
}

run('owner rules at the actual commit and transactional boundaries', () => {
  it('commits both fixed bubbles once and preserves the 20s timing authority on replay', async () => {
    const f = await seedConversationForAgentTurn({ selected_offering_code: paid, first_message: 'me sigue pareciendo caro' });
    await seedPriorModelNegotiation(db!, f, 1);
    const input = { turn_id: f.turn_id, trace_id: f.trace_id, supports_multi_outbound: true,
      agent_turn_v2: { schema_version: 2 as const, proposal: proposal() },
      decision: f.placeholderDecision as never, model: f.model as never };
    const committed = await commitAgentDecision(input);
    expect(committed.status).toBe('committed');
    expect(committed.outbounds.map(part => part.content)).toEqual(fixed);
    expect(committed.outbounds[1]).toMatchObject({ part_index: 1, minimum_delay_before_ms: 20000 });
    const [part] = await db!`SELECT metadata FROM messages WHERE id=${committed.outbounds[1].id}`;
    expect(part.metadata.rule_a_minimum_delay_before_ms).toBe(20000);
    const submittedAt = new Date(Date.now() - 7000);
    await db!`UPDATE outbound_deliveries SET state='submitted',submitted_at=${submittedAt},provider_message_id=${`bp-runtime-rule-a-${randomUUID()}`}
      WHERE message_id=${committed.outbounds[0].id}`;
    const replayed = await commitAgentDecision(input);
    expect(replayed.replayed).toBe(true);
    expect(replayed.outbounds.map(part => part.id)).toEqual(committed.outbounds.map(part => part.id));
    expect(replayed.outbounds[0].status).toBe('submitted_to_botpress');
    expect(replayed.outbounds[1]).toMatchObject({ minimum_delay_before_ms: 20000,
      not_before: new Date(submittedAt.getTime() + 20000).toISOString() });
    const [count] = await db!`SELECT count(*)::int count FROM promotion_offer_bonus_offerings WHERE source_turn_id=${f.turn_id}`;
    expect(count.count).toBe(1);
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
        expected_offer_version: 0, bonus_offering_codes: [bonus], outbound: { id: outbound, content: fixed[1],
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
