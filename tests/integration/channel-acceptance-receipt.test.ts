import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openLocalTestDatabase } from '../helpers/db';
import { seedConversationForAgentTurn } from '../helpers/agent-turn-fixtures';
import { recordDeliveryReport } from '@/lib/services/decision.service';
import { offerDirectCourseBonusV1 } from '@/features/promotions/application/direct-course-bonus-service';
import { readCourseBonusCapabilityV1 } from '@/features/promotions/application/read-course-bonus-capability';
import { recordModelPriceObjection } from '../helpers/record-model-negotiation-facts';

/** 2026-11-02: the WhatsApp channel sends no delivery webhook, so every live
 * outbound stayed `submitted` and Rule A escalation (gated on a confirmed
 * delivery) never fired. Botpress now reports channel acceptance as the
 * receipt right after createMessage; Botpress' clock may lag this server. */
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


/** The commit path creates the outbox event; the direct service under test does not. */
async function withOutbox(outbound: string): Promise<void> {
  await db!`INSERT INTO outbox_events(topic,aggregate_type,aggregate_id,delivery_id,deduplication_key,payload)
    SELECT 'botpress.outbound','message',d.message_id,d.id,${`test:${outbound}`},'{}'::jsonb
    FROM outbound_deliveries d WHERE d.message_id=${outbound}::uuid`;
  await db!`UPDATE outbound_deliveries SET attempt_count=1 WHERE message_id=${outbound}::uuid`;
}

run('channel acceptance receipt', () => {
  it('accepts a lagging receipt bounded to submitted_at and unlocks the next bonus', async () => {
    const f = await seedConversationForAgentTurn({ selected_offering_code: paid, first_message: 'Me parece caro' });
    await recordModelPriceObjection(db!, f.turn_id, { source_quote: 'Me parece caro' });
    const outbound = randomUUID();
    const offer = await offerDirectCourseBonusV1(db!, { workspace_id: f.workspace_id, contact_id: f.contact_id,
      conversation_id: f.conversation_id, paid_offering_code: paid, source_turn_id: f.turn_id,
      expected_offer_version: 0, bonus_offering_codes: [bonus], outbound: { id: outbound, content: 'oferta',
        provider: 'test', integration_id: 'test', channel: 'whatsapp', destination: 'test', idempotency_key: outbound } });
    expect(offer.ok).toBe(true);
    await withOutbox(outbound);
    const botpressMessageId = `bp-${randomUUID()}`;
    const trace = randomUUID();
    await recordDeliveryReport({ outbound_id: outbound, trace_id: trace, status: 'submitted_to_botpress',
      botpress_message_id: botpressMessageId, replayed: false, error_code: null, delivery_attempt: 1 });
    // Botpress clock one minute behind the backend.
    const lagging = new Date(Date.now() - 60_000).toISOString();
    const report = { outbound_id: outbound, trace_id: trace, status: 'delivered' as const,
      botpress_message_id: botpressMessageId, replayed: false, error_code: null, delivery_attempt: 1, delivered_at: lagging };
    await recordDeliveryReport(report);
    expect(await recordDeliveryReport(report)).toMatchObject({ status: 'duplicate' });
    await expect(recordDeliveryReport({ ...report, delivered_at: '2000-01-01T00:00:00.000Z' }))
      .rejects.toMatchObject({ code: 'DELIVERY_REPORT_CONFLICT' });

    const [delivery] = await db!<Array<{ state: string; ordered: boolean }>>`
      SELECT state, delivered_at >= submitted_at AND delivered_at <= now() AS ordered
      FROM outbound_deliveries WHERE message_id=${outbound}::uuid`;
    expect(delivery).toEqual({ state: 'delivered', ordered: true });
    const [gift] = await db!<Array<{ delivered: boolean }>>`
      SELECT delivered_at IS NOT NULL AS delivered FROM promotion_offer_bonus_offerings
      WHERE offered_outbound_message_id=${outbound}::uuid`;
    expect(gift.delivered).toBe(true);

    await db!`UPDATE messages SET content='me sigue pareciendo caro', created_at=clock_timestamp()+interval '1 second',
      metadata=metadata-'occurred_at_trusted' WHERE id=${f.second_turn_id}::uuid`;
    const capability = await readCourseBonusCapabilityV1({ workspace_slug: 'studyx', contact_id: f.contact_id,
      conversation_id: f.conversation_id, channel: 'text', selected_offering_code: paid,
      source_turn_id: f.second_turn_id }, { db: db! });
    // The delivered, answered first bonus unlocks the next one; the model picks among the candidates.
    expect(capability).toMatchObject({ package_status: 'offered', may_offer_bonus: true,
      delivered_bonus_offerings: [{ code: bonus }] });
    expect(capability.bonus_candidates?.map(course => course.code)).toContain('publicidad_redes_sociales');
    expect(capability.bonus_candidates?.map(course => course.code)).not.toContain(bonus);
  });

  it('stamps a timeless acceptance receipt with submitted_at and replays it exactly', async () => {
    const f = await seedConversationForAgentTurn({ selected_offering_code: paid, first_message: 'Me parece caro' });
    await recordModelPriceObjection(db!, f.turn_id, { source_quote: 'Me parece caro' });
    const outbound = randomUUID();
    const offer = await offerDirectCourseBonusV1(db!, { workspace_id: f.workspace_id, contact_id: f.contact_id,
      conversation_id: f.conversation_id, paid_offering_code: paid, source_turn_id: f.turn_id,
      expected_offer_version: 0, bonus_offering_codes: [bonus], outbound: { id: outbound, content: 'oferta',
        provider: 'test', integration_id: 'test', channel: 'whatsapp', destination: 'test', idempotency_key: outbound } });
    expect(offer.ok).toBe(true);
    await withOutbox(outbound);
    const botpressMessageId = `bp-${randomUUID()}`;
    const trace = randomUUID();
    await recordDeliveryReport({ outbound_id: outbound, trace_id: trace, status: 'submitted_to_botpress',
      botpress_message_id: botpressMessageId, replayed: false, error_code: null, delivery_attempt: 1 });
    const acceptance = { outbound_id: outbound, trace_id: trace, status: 'delivered' as const,
      botpress_message_id: botpressMessageId, replayed: false, error_code: null, delivery_attempt: 1, delivered_at: null };
    expect(await recordDeliveryReport(acceptance)).toMatchObject({ status: 'recorded' });
    expect(await recordDeliveryReport(acceptance)).toMatchObject({ status: 'duplicate' });
    const [row] = await db!<Array<{ state: string; same: boolean }>>`
      SELECT state, delivered_at = submitted_at AS same FROM outbound_deliveries WHERE message_id=${outbound}::uuid`;
    expect(row).toEqual({ state: 'delivered', same: true });
  });

  it('still rejects a receipt for a bubble that was never submitted', async () => {
    const f = await seedConversationForAgentTurn({ selected_offering_code: paid, first_message: 'Me parece caro' });
    await recordModelPriceObjection(db!, f.turn_id, { source_quote: 'Me parece caro' });
    const outbound = randomUUID();
    const offer = await offerDirectCourseBonusV1(db!, { workspace_id: f.workspace_id, contact_id: f.contact_id,
      conversation_id: f.conversation_id, paid_offering_code: paid, source_turn_id: f.turn_id,
      expected_offer_version: 0, bonus_offering_codes: [bonus], outbound: { id: outbound, content: 'oferta',
        provider: 'test', integration_id: 'test', channel: 'whatsapp', destination: 'test', idempotency_key: outbound } });
    expect(offer.ok).toBe(true);
    await withOutbox(outbound);
    await expect(recordDeliveryReport({ outbound_id: outbound, trace_id: randomUUID(), status: 'delivered',
      botpress_message_id: 'bp-never-submitted', replayed: false, error_code: null, delivery_attempt: 1,
      delivered_at: new Date().toISOString() })).rejects.toThrow();
  });
});
