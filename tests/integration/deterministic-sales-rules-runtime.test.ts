import { resolveDeterministicRulesTurnV1 } from '../../botpress-agent/src/lib/conversation/deterministic-rules-turn';
import { resolveAgentAPlannerlessProposalV2 } from '../../botpress-agent/src/lib/conversation/resolve-agent-a-plannerless';
import type { AgentAContextV1 } from '../../botpress-agent/src/schemas/agent-a-brain';
import { deriveCourseBonusLadderV1 } from '@/shared/conversation/bonus-ladder';
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
import type { AgentATurnProposalV1 } from '../../botpress-agent/src/schemas/agent-a-brain';

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
  it.each(['continue_by_chat', 'decline_call', 'request_call'] as const)('accounts once for the delivered A+B invitation after a prose rewrite invents %s and vetoes call', async invented => {
    const text = 'Sólo el precio me frena, me parece caro. Ofreceme esa promoción para sumar un curso sin costo.';
    const f = await seedConversationForAgentTurn({ selected_offering_code: paid, first_message: text });
    const current: AgentAContextV1 = {
      schema_version: 1, identity: null, customer: { display_name: null, memories: [] },
      turn: { batch_messages: [{ id: f.turn_id, text }], recent_turns: [{ id: 'previous', direction: 'outbound', content: 'Qué te frena?' }] },
      commercial_state: { selected_offering_code: paid, selected_payment_plan: null, stage: 'course_selected',
        call_preference: 'unknown', call_offer_status: 'not_offered', call_offer_count: 0, awaiting_reply: 'none', payment_reported: false },
      catalog: { selected_offering: { code: paid, display_name: 'Introducción al Ecommerce', area_code: 'marketing',
        facts: [{ id: `offering:${paid}:name:v1`, kind: 'offering_name', value: 'Introducción al Ecommerce' }] },
        available_offerings: [ { code: paid, display_name: 'Introducción al Ecommerce', area_code: 'marketing', fact_id: `offering:${paid}:name:v1` },
          { code: bonus, display_name: 'Fotografía con Celulares para Tiendas Online', area_code: 'marketing', fact_id: `offering:${bonus}:name:v1` } ],
        candidate_offerings: [], areas: [], payment_plans: [] },
      capabilities: { may_reply: true, may_offer_call: true, may_request_call_now: false, may_present_payment_options: false,
        may_send_payment_link: false, authorized_payment_plan: null, intake_status: 'unknown', intake_missing: [],
        course_bonus: { status: 'checkin_available', enabled: true, max_bonus_courses: 3, may_offer_bonus: false,
          may_schedule_checkin: false, may_request_review: false, may_accept_offer: false, may_send_promoted_payment: false,
          package_status: null, promotion_code: null, interest_offering_code: paid, bonus_offerings: [],
          ladder: deriveCourseBonusLadderV1({ observed_price_objection_count: 0, call_invitation_status: 'not_offered', call_offer_count: 0, may_offer_call: true }),
          rule_bonus: { paid_offering_code: paid, paid_display_name: 'Introducción al Ecommerce', bonus_offering_code: bonus,
            display_name: 'Fotografía con Celulares para Tiendas Online', position: 1 } } },
    };
    const initial = proposal();
    initial.move.move = 'defer_payment';
    initial.proposed_action = { type: 'none' };
    initial.response = { messages: ['Te cuento las opciones.'], call_offer: null };
    initial.memory_candidates.push({ type: 'constraint', key: 'price_only_barrier', value: 'confirmed',
      source_quote: 'Sólo el precio me frena', confidence: 1 });
    const generated = (draft: typeof initial) => ({ proposal: draft, provider: 'deepseek-direct' as const,
      model: 'deepseek-v4-flash', latency_ms: 1, attempt_count: 1 as const });
    const invitation = 'Si querés, podemos verlo en una llamada corta. Te sirve?';
    const repair = vi.fn(async () => {
      const repaired = proposal();
      repaired.move = { ...repaired.move, move: invented, secondary_moves: ['continue_by_chat'], vetoes: ['call'] };
      repaired.response = { messages: [fixed[1]], call_offer: invitation };
      return generated(repaired);
    });
    const resolved = await resolveDeterministicRulesTurnV1({ context: current, initial: generated(initial), repair_enabled: true,
      rejection_id: randomUUID, repair, resolve: (candidate, enabled, rejection = randomUUID()) => resolveAgentAPlannerlessProposalV2({
        context: current, initial: candidate, repair_enabled: enabled, rejection_id: rejection, semantic_rejections: 'advisory',
        repair: async () => { throw new Error('NO_EXTRA_GENERATION'); } }) });
    expect(repair).toHaveBeenCalledOnce();
    expect(resolved.record).toMatchObject({ rule_a: 'rewrite', rule_b: 'rewrite' });
    expect(resolved.resolved.effective.proposal.move).toMatchObject({ move: 'defer_payment', secondary_moves: [], vetoes: [] });
    const input = { turn_id: f.turn_id, trace_id: f.trace_id, supports_multi_outbound: true,
      agent_turn_v2: { schema_version: 2 as const, proposal: resolved.resolved.effective.proposal },
      decision: f.placeholderDecision as never, model: f.model as never };
    const committed = await commitAgentDecision(input);
    expect(committed.outbounds.map(part => part.content).join(' ')).toContain(invitation);
    const [state] = await db!`SELECT call_offer_count,call_offer_status,call_preference FROM conversation_sales_context_states_v1 WHERE conversation_id=${f.conversation_id}`;
    expect(state).toMatchObject({ call_offer_count: 1, call_offer_status: 'offered', call_preference: 'unknown' });
    const replay = await commitAgentDecision(input);
    expect(replay.replayed).toBe(true);
    expect(replay.outbounds.map(part => part.id)).toEqual(committed.outbounds.map(part => part.id));
    const [after] = await db!`SELECT call_offer_count FROM conversation_sales_context_states_v1 WHERE conversation_id=${f.conversation_id}`;
    expect(after.call_offer_count).toBe(1);
  });

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

  it('never cancels the fixed bubble that carries the committed offer when the customer writes during the 20s pause', async () => {
    const f = await seedConversationForAgentTurn({ selected_offering_code: paid, first_message: 'me sigue pareciendo caro' });
    await seedPriorModelNegotiation(db!, f, 1);
    const committed = await commitAgentDecision({ turn_id: f.turn_id, trace_id: f.trace_id, supports_multi_outbound: true,
      supports_send_fencing: true, agent_turn_v2: { schema_version: 2 as const, proposal: proposal() },
      decision: f.placeholderDecision as never, model: f.model as never });
    expect(committed.outbounds.map(part => part.content)).toEqual(fixed);
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

  it('still cancels the committed offer bubble when the customer opted out during the pause', async () => {
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

  it.each([['me hacés un descuento?', true], ['no quiero descuento, sólo info', false]] as const)(
    'owner instant promo at the transactional ladder: "%s" → offer %s', async (text, allowed) => {
      const f = await seedConversationForAgentTurn({ selected_offering_code: paid, first_message: text });
      const outbound = randomUUID();
      const result = await offerDirectCourseBonusV1(db!, { workspace_id: f.workspace_id, contact_id: f.contact_id,
        conversation_id: f.conversation_id, paid_offering_code: paid, source_turn_id: f.turn_id,
        expected_offer_version: 0, bonus_offering_codes: [bonus], outbound: { id: outbound, content: fixed[1],
          provider: 'test', integration_id: 'test', channel: 'whatsapp', destination: 'test', idempotency_key: outbound } });
      expect(result.ok).toBe(allowed);
      if (!allowed) expect(result).toMatchObject({ reason: 'ladder_step_pending' });
    });

  it.each(['with_state', 'first_message_without_state'] as const)('owner instant promo names the paid course in the same message: capability and commit offer it at once (%s)', async variant => {
    // Literal golden text: 'tienda online' also hits Fotografía con Celulares para Tiendas Online.
    const text = 'Me interesa Introducción al Ecommerce para vender los productos de mi tienda online. Tenés alguna promoción para sumar un curso gratuito?';
    const f = await seedConversationForAgentTurn({ selected_offering_code: null, first_message: text });
    if (variant === 'first_message_without_state') {
      await db!`DELETE FROM conversation_sales_context_state_events_v1 WHERE conversation_id=${f.conversation_id}::uuid`;
      await db!`DELETE FROM conversation_sales_context_states_v1 WHERE conversation_id=${f.conversation_id}::uuid`;
    }
    const capability = await readCourseBonusCapabilityV1({ workspace_slug: 'studyx', contact_id: f.contact_id,
      conversation_id: f.conversation_id, channel: 'text', selected_offering_code: null, source_turn_id: f.turn_id }, { db: db! });
    expect(capability).toMatchObject({ interest_offering_code: paid, rule_bonus: { bonus_offering_code: bonus } });
    expect(capability.ladder).toMatchObject({ instant_trigger: true, eligible: true });
    if (variant === 'first_message_without_state') {
      // Live golden 76c6447/18: at commit time the model's select_course already names the course.
      const atCommit = await readCourseBonusCapabilityV1({ workspace_slug: 'studyx', contact_id: f.contact_id,
        conversation_id: f.conversation_id, channel: 'text', selected_offering_code: paid, source_turn_id: f.turn_id }, { db: db! });
      // Live commit path: no persisted selection yet (checkoutOfferingCode null).
      const atCommitNoSelection = await readCourseBonusCapabilityV1({ workspace_slug: 'studyx', contact_id: f.contact_id,
        conversation_id: f.conversation_id, channel: 'text', selected_offering_code: null, source_turn_id: f.turn_id }, { db: db! });
      expect(atCommitNoSelection).toMatchObject({ interest_offering_code: paid, ladder: { instant_trigger: true } });
      expect(atCommit.ladder).toMatchObject({ instant_trigger: true, eligible: true });
      expect(atCommit.rule_bonus).toMatchObject({ bonus_offering_code: bonus });
    }
    const committed = await commitAgentDecision({ turn_id: f.turn_id, trace_id: f.trace_id, supports_multi_outbound: true,
      agent_turn_v2: { schema_version: 2 as const, proposal: { ...proposal(), memory_candidates: [],
        move: { ...proposal().move, move: 'select_course', course_reference: paid } } },
      decision: f.placeholderDecision as never, model: f.model as never });
    expect(committed.status).toBe('committed');
    const [count] = await db!`SELECT count(*)::int count FROM promotion_offer_bonus_offerings WHERE source_turn_id=${f.turn_id}`;
    expect(count.count).toBe(1);
    const [state] = await db!`SELECT selected_offering_code, source_turn_id FROM conversation_sales_context_states_v1 WHERE conversation_id=${f.conversation_id}::uuid`;
    expect(state).toMatchObject({ selected_offering_code: paid, source_turn_id: f.turn_id });
  });

  it.each([['Ahora sí, el precio me sigue pareciendo caro y no me alcanza.', true], ['Es caro? Te pregunto.', false]] as const)(
    'with a live offer, a literal price objection is the backend escalation trigger: "%s" → %s', async (text, instant) => {
      const f = await seedConversationForAgentTurn({ selected_offering_code: paid, first_message: 'tenés alguna promo?' });
      const outbound = randomUUID();
      const offer = await offerDirectCourseBonusV1(db!, { workspace_id: f.workspace_id, contact_id: f.contact_id,
        conversation_id: f.conversation_id, paid_offering_code: paid, source_turn_id: f.turn_id,
        expected_offer_version: 0, bonus_offering_codes: [bonus], outbound: { id: outbound, content: fixed[1],
          provider: 'test', integration_id: 'test', channel: 'whatsapp', destination: 'test', idempotency_key: outbound } });
      expect(offer.ok).toBe(true);
      const next = randomUUID();
      await db!`INSERT INTO messages(id,conversation_id,contact_id,direction,content,created_at,conversation_seq)
        VALUES (${next}::uuid,${f.conversation_id}::uuid,${f.contact_id}::uuid,'inbound',${text},now()+interval '2 seconds',
          (SELECT coalesce(max(conversation_seq),0)+1 FROM messages WHERE conversation_id=${f.conversation_id}::uuid))`;
      const { readCourseBonusLadderV1 } = await import('@/features/promotions/application/read-course-bonus-ladder');
      const ladder = await readCourseBonusLadderV1({ workspace_id: f.workspace_id, contact_id: f.contact_id,
        conversation_id: f.conversation_id, source_turn_id: next, selected_offering_code: paid }, db!);
      expect(ladder?.instant_trigger === true).toBe(instant);
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
