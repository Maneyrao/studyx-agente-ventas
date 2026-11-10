import { offerBonusWithMotive } from '../helpers/offer-bonus';
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openLocalTestDatabase } from '../helpers/db';
import { seedConversationForAgentTurn } from '../helpers/agent-turn-fixtures';
import { recordDeliveryReport } from '@/lib/services/decision.service';
import { readCourseBonusCapabilityV1 } from '@/features/promotions/application/read-course-bonus-capability';
import { hashCallContext } from '@/features/calls/domain/call-context';
import { recordModelPriceObjection, seedPriorModelNegotiation } from '../helpers/record-model-negotiation-facts';

/** Owner "Emma vende" (2026-11-03), live 07:38/07:41: the customer chooses the
 * gift or swaps the only gift while the package is open. Same literal detector
 * in the capability and the durable service; the old cycle is kept, cancelled. */
const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const db = process.env.TEST_DATABASE_URL ? openLocalTestDatabase() : null;
afterAll(async () => db?.end());
beforeEach(() => {
  vi.stubEnv('COURSE_BONUS_FLOW_MODE', 'direct');
  vi.stubEnv('COURSE_BONUS_MAX_COURSES', '3');
  vi.stubEnv('CENTRAL_CARGA_BONUS_ENABLED', 'true');
});
afterEach(() => vi.unstubAllEnvs());

const paid = 'ingles_1';
const outbound = (id: string) => ({ id, content: `oferta ${id}`, provider: 'test', integration_id: 'test',
  channel: 'whatsapp', destination: 'test', idempotency_key: id });

async function deliver(id: string): Promise<void> {
  await db!`INSERT INTO outbox_events(topic,aggregate_type,aggregate_id,delivery_id,deduplication_key,payload)
    SELECT 'botpress.outbound','message',d.message_id,d.id,${`test:${id}`},'{}'::jsonb
    FROM outbound_deliveries d WHERE d.message_id=${id}::uuid`;
  await db!`UPDATE outbound_deliveries SET attempt_count=1 WHERE message_id=${id}::uuid`;
  const trace = randomUUID(); const bp = `bp-${randomUUID()}`;
  await recordDeliveryReport({ outbound_id: id, trace_id: trace, status: 'submitted_to_botpress',
    botpress_message_id: bp, replayed: false, error_code: null, delivery_attempt: 1 });
  await recordDeliveryReport({ outbound_id: id, trace_id: trace, status: 'delivered',
    botpress_message_id: bp, replayed: false, error_code: null, delivery_attempt: 1, delivered_at: null });
}

async function offeredWithIngles2() {
  const f = await seedConversationForAgentTurn({ selected_offering_code: paid, first_message: 'Me parece caro' });
  // The model recorded the price objection of the first turn: persisted price evidence.
  await recordModelPriceObjection(db!, f.turn_id, { source_quote: 'Me parece caro' });
  // Owner 2026-11-10: the first gift needs a second objection; an earlier one was answered.
  await seedPriorModelNegotiation(db!, f, 1);
  const first = randomUUID();
  const offer = await offerBonusWithMotive(db!, { workspace_id: f.workspace_id, contact_id: f.contact_id,
    conversation_id: f.conversation_id, paid_offering_code: paid, source_turn_id: f.turn_id,
    expected_offer_version: 0, bonus_offering_codes: ['ingles_2'], outbound: outbound(first) });
  if (!offer.ok) throw new Error(`first offer rejected: ${offer.reason}`);
  await deliver(first);
  return { f, offer };
}

async function customerSays(f: Awaited<ReturnType<typeof seedConversationForAgentTurn>>, text: string) {
  await db!`UPDATE messages SET content=${text}, created_at=clock_timestamp(),
    metadata=metadata-'occurred_at_trusted' WHERE id=${f.second_turn_id}::uuid`;
}

run('customer-chosen bonus', () => {
  it('swaps the only gift into a new cycle, keeps the old one cancelled, and replays exactly', async () => {
    const { f, offer } = await offeredWithIngles2();
    await customerSays(f, 'osea no puedo cambiar ingles 2 por armado y reparacion de pc?');
    const capability = await readCourseBonusCapabilityV1({ workspace_slug: 'studyx', contact_id: f.contact_id,
      conversation_id: f.conversation_id, channel: 'text', selected_offering_code: paid, source_turn_id: f.second_turn_id }, { db: db! });
    expect(capability).toMatchObject({ rule_bonus: { bonus_offering_code: 'armado_reparacion_pc', source: 'customer_request',
      replaces_offering_code: 'ingles_2', position: 1 } });
    const window = new Date(Date.now() + 3 * 86_400_000);
    await db!`UPDATE promotion_offers SET expires_at=${window} WHERE promotion_cycle_id=${offer.promotion_cycle_id}::uuid`;
    const swapId = randomUUID();
    const input = { workspace_id: f.workspace_id, contact_id: f.contact_id, conversation_id: f.conversation_id,
      paid_offering_code: paid, source_turn_id: f.second_turn_id, expected_offer_version: 1,
      promotion_code: offer.promotion_code, promotion_cycle_id: offer.promotion_cycle_id,
      bonus_offering_codes: ['armado_reparacion_pc'], outbound: outbound(swapId) };
    const swapped = await offerBonusWithMotive(db!, input);
    expect(swapped).toMatchObject({ ok: true, offer_version: 1, outbound_message_id: swapId });
    if (!swapped.ok) throw new Error();
    expect(swapped.promotion_cycle_id).not.toBe(offer.promotion_cycle_id);
    expect(await offerBonusWithMotive(db!, input)).toEqual(swapped);
    const [replacement] = await db!<Array<{ expires_at: Date }>>`SELECT expires_at FROM promotion_offers
      WHERE promotion_cycle_id=${swapped.promotion_cycle_id}::uuid`;
    expect(replacement?.expires_at.getTime()).toBe(window.getTime());
    const cycles = await db!<Array<{ status: string; cancel_reason: string | null; gifts: string[] }>>`
      SELECT o.status,o.cancel_reason,ARRAY(SELECT b.offering_code_snapshot FROM promotion_offer_bonus_offerings b
        WHERE b.offer_id=o.id ORDER BY b.position) gifts
      FROM promotion_offers o WHERE o.conversation_id=${f.conversation_id}::uuid ORDER BY o.created_at`;
    expect(cycles).toEqual([
      { status: 'cancelled', cancel_reason: 'CUSTOMER_REPLACED_BONUS', gifts: ['ingles_2'] },
      { status: 'offered', cancel_reason: null, gifts: ['armado_reparacion_pc'] },
    ]);
  });

  it('swaps with no persisted selection or interest: the live package identifies the paid course (golden 24)', async () => {
    const { f, offer } = await offeredWithIngles2();
    await db!`UPDATE conversation_sales_context_states_v1 SET selected_offering_code=NULL WHERE conversation_id=${f.conversation_id}::uuid`;
    await db!`DELETE FROM conversation_promotion_context_v1 WHERE conversation_id=${f.conversation_id}::uuid`;
    await customerSays(f, 'osea no puedo cambiar ingles 2 por armado y reparacion de pc?');
    const capability = await readCourseBonusCapabilityV1({ workspace_slug: 'studyx', contact_id: f.contact_id,
      conversation_id: f.conversation_id, channel: 'text', selected_offering_code: null, source_turn_id: f.second_turn_id }, { db: db! });
    expect(capability).toMatchObject({ interest_offering_code: paid,
      rule_bonus: { bonus_offering_code: 'armado_reparacion_pc', replaces_offering_code: 'ingles_2' } });
    expect(await offerBonusWithMotive(db!, { workspace_id: f.workspace_id, contact_id: f.contact_id,
      conversation_id: f.conversation_id, paid_offering_code: paid, source_turn_id: f.second_turn_id,
      expected_offer_version: 1, promotion_code: offer.promotion_code, promotion_cycle_id: offer.promotion_cycle_id,
      bonus_offering_codes: ['armado_reparacion_pc'], outbound: outbound(randomUUID()) })).toMatchObject({ ok: true, offer_version: 1 });
  });

  it('a course the customer names literally is a valid next gift when the customer asks for it explicitly (better_promotion_request quoted from this message)', async () => {
    const { f, offer } = await offeredWithIngles2();
    await customerSays(f, 'y si yo tengo el curso de ingles 1 y armado y reparacion de pc, me bonificas uno de los dos?');
    const added = await offerBonusWithMotive(db!, { workspace_id: f.workspace_id, contact_id: f.contact_id,
      conversation_id: f.conversation_id, paid_offering_code: paid, source_turn_id: f.second_turn_id, expected_offer_version: 1,
      promotion_code: offer.promotion_code, promotion_cycle_id: offer.promotion_cycle_id,
      bonus_offering_codes: ['armado_reparacion_pc'], outbound: outbound(randomUUID()),
      motive: { kind: 'better_promotion_request', quote: 'me bonificas uno de los dos?' }, declared_moves: ['explicit_promotion_request'] });
    expect(added).toMatchObject({ ok: true, offer_version: 2, promotion_cycle_id: offer.promotion_cycle_id });
  });

  it('never accepts an unrequested off-table course, and never swaps during a live call', async () => {
    const { f, offer } = await offeredWithIngles2();
    await customerSays(f, 'me parece caro');
    const base = { workspace_id: f.workspace_id, contact_id: f.contact_id, conversation_id: f.conversation_id,
      paid_offering_code: paid, source_turn_id: f.second_turn_id, expected_offer_version: 1,
      promotion_code: offer.promotion_code, promotion_cycle_id: offer.promotion_cycle_id };
    expect(await offerBonusWithMotive(db!, { ...base, bonus_offering_codes: ['armado_reparacion_pc'],
      outbound: outbound(randomUUID()) })).toMatchObject({ ok: false, reason: 'invalid_offering' });
    await customerSays(f, 'cambiame ingles 2 por armado y reparacion de pc');
    const callId = randomUUID();
    const callContext = { call_id: callId, nombre_lead: 'Ana', curso_interes: paid, pais: 'AR',
      email_lead: 'ana@example.test', resumen_whatsapp: '', prompt_version: 'agent-b-v1' };
    await db!`INSERT INTO call_sessions (id, source_turn_id, contact_id, conversation_id, workspace_id,
      provider, provider_call_id, request_idempotency_key, status, consent_source_message_id,
      context_snapshot, context_hash, prompt_version)
      VALUES (${callId}::uuid, ${f.turn_id}::uuid, ${f.contact_id}::uuid, ${f.conversation_id}::uuid,
        ${f.workspace_id}::uuid, 'retell', ${`retell:${callId}`}, ${`bonus-call:${callId}`}, 'in_progress',
        ${f.turn_id}::uuid, ${db!.json(callContext)}, decode(${hashCallContext(callContext)}, 'hex'), 'agent-b-v1')`;
    expect(await offerBonusWithMotive(db!, { ...base, bonus_offering_codes: ['armado_reparacion_pc'],
      outbound: outbound(randomUUID()) })).toMatchObject({ ok: false, reason: 'stale_offer_version' });
  });
});
