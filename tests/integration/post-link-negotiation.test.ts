import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openLocalTestDatabase } from '../helpers/db';
import { recordModelPriceObjection, seedPriorModelNegotiation } from '../helpers/record-model-negotiation-facts';
import { offerDirectCourseBonusV1, acceptDirectCourseBonusV1 } from '@/features/promotions/application/direct-course-bonus-service';
import { readCourseBonusCapabilityV1 } from '@/features/promotions/application/read-course-bonus-capability';
import { reservePaymentLink } from '@/features/payments/application/reserve-payment-link';
import { recordPaymentEvent } from '@/features/payments/application/record-payment-event';
import { runEnrollmentWorker } from '@/features/fulfillment/central-carga/worker';
import { replacePendingCheckoutV1 } from '@/features/payments/application/replace-pending-checkout';
import type { OfferDirectCourseBonusInputV1, DirectCourseBonusResultV1 } from '@/features/promotions/application/direct-course-bonus-service';

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const db = process.env.TEST_DATABASE_URL ? openLocalTestDatabase() : null;
const competitor = process.env.TEST_DATABASE_URL ? openLocalTestDatabase() : null;
afterAll(async () => { await db?.end(); await competitor?.end(); });
beforeEach(() => {
  vi.stubEnv('COURSE_BONUS_FLOW_MODE', 'direct');
  vi.stubEnv('COURSE_BONUS_MAX_COURSES', '3');
  vi.stubEnv('CENTRAL_CARGA_BONUS_ENABLED', 'true');
});
afterEach(() => vi.unstubAllEnvs());

async function fixture(gifts = 0) {
  const slug = randomUUID();
  const [w] = await db!`INSERT INTO workspaces(slug,display_name) VALUES (${slug},'Negociación') RETURNING id`;
  const [c] = await db!`INSERT INTO contacts(phone,email,name,channel_origin,status) VALUES
    (${'+' + String(Math.floor(100000000000 + Math.random() * 800000000000))},'prueba@example.com','Alumno Prueba','whatsapp','prospecto') RETURNING id`;
  await db!`INSERT INTO workspace_contacts(workspace_id,contact_id,source_channel) VALUES (${w.id},${c.id},'whatsapp')`;
  const [v] = await db!`INSERT INTO conversations(contact_id,channel) VALUES (${c.id},'whatsapp') RETURNING id`;
  const courses = await db!`INSERT INTO offerings(workspace_id,code,display_name,offering_type,status,description,price_type,price_amount,currency,billing_interval)
    SELECT ${w.id},(ARRAY['introduccion_ecommerce','fotografia_celulares_tiendas_online','publicidad_redes_sociales','instagram_emprendedores','ingles_1'])[n+1],
      'Curso ' || n,'course','active','Curso de prueba','fixed',360,'USD','annual' FROM generate_series(0,4) n RETURNING id,code`;
  const identity = { workspace_id: w.id as string, contact_id: c.id as string, conversation_id: v.id as string,
    paid_offering_code: courses[0].code as string };
  await db!`INSERT INTO conversation_sales_context_states_v1(workspace_id,contact_id,conversation_id,selected_offering_code,selected_payment_plan)
    VALUES (${w.id},${c.id},${v.id},${identity.paid_offering_code},'one_time')`;
  await seedPriorModelNegotiation(db!, identity);
  async function inbound() {
    const [m] = await db!`INSERT INTO messages(conversation_id,contact_id,direction,content)
      VALUES (${v.id},${c.id},'inbound','me parece muy caro') RETURNING id`;
    await recordModelPriceObjection(db!, m.id);
    return m.id as string;
  }
  async function delivered(id: string) {
    await db!`UPDATE outbound_deliveries SET state='leased' WHERE message_id=${id}::uuid`;
    await db!`UPDATE outbound_deliveries SET state='submitted',submitted_at=clock_timestamp() WHERE message_id=${id}::uuid`;
    await db!`UPDATE outbound_deliveries SET state='delivered',delivered_at=clock_timestamp() WHERE message_id=${id}::uuid`;
  }
  type Offer = { offer_id: string; promotion_code: string; promotion_cycle_id: string; offer_version: number };
  let previous: Offer | undefined;
  const history: Array<{input:OfferDirectCourseBonusInputV1;result:DirectCourseBonusResultV1}> = [];
  async function proposal(index: number, turn?: string, prior = previous) {
    const id = randomUUID();
    return { ...identity, source_turn_id: turn ?? await inbound(), expected_offer_version: prior?.offer_version ?? 0,
      ...(prior ? { promotion_code: prior.promotion_code, promotion_cycle_id: prior.promotion_cycle_id } : {}),
      bonus_offering_codes: [courses[index].code as string],
      motive: { kind: 'price_objection' as const, quote: 'me parece muy caro' }, declared_moves: ['price_objection'],
      outbound: { id, content: `Te bonifico ${courses[index].code}.`, provider: 'test', integration_id: 'test', channel: 'whatsapp',
        destination: 'test', idempotency_key: id } };
  }
  for (let index = 1; index <= gifts; index++) {
    const input = await proposal(index);
    const result = await offerDirectCourseBonusV1(db!, input);
    if (!result.ok) throw new Error(result.reason);
    previous = result;
    history.push({input,result});
    await delivered(result.outbound_message_id);
  }
  if (previous) {
    expect(await acceptDirectCourseBonusV1(db!, { ...identity, ...previous,
      source_turn_id: await inbound(), expected_offer_version: previous.offer_version })).toMatchObject({ ok: true });
  }
  const paymentInput = { workspace_id: w.id as string, contact_id: c.id as string, conversation_id: v.id as string,
    offering_id: courses[0].id as string, plan_code: 'one_time' as const, payment_link_url: 'https://buy.stripe.com/test_reopen',
    idempotency_key: randomUUID(), ...(previous ? { promotion_code: previous.promotion_code,
      promotion_cycle_id: previous.promotion_cycle_id, accepted_offer_version: previous.offer_version } : {}) };
  const payment = await reservePaymentLink(db!, paymentInput);
  await db!`UPDATE conversation_sales_context_states_v1 SET stage='payment_link_sent',awaiting_reply='payment_confirmation'
    WHERE conversation_id=${v.id}::uuid`;
  async function pay(id: string, connection = db!) {
    for (const type of ['checkout_creation_started','checkout_created'] as const) await recordPaymentEvent(connection,{
      payment_id:id,provider:'internal',provider_event_id:randomUUID(),event:{type},payload:{}});
    return recordPaymentEvent(connection,{payment_id:id,provider:'stripe',provider_event_id:randomUUID(),
      event:{type:'checkout_completed_paid'},payload:{}});
  }
  async function pending(id: string) {
    for (const type of ['checkout_creation_started','checkout_created','checkout_completed_unpaid'] as const) {
      await recordPaymentEvent(db!,{payment_id:id,provider:'stripe',provider_event_id:randomUUID(),event:{type},payload:{}});
    }
  }
  return { slug, identity, courses, previous, paymentInput, payment, inbound, proposal, delivered, pay, pending, history };
}

run('negociación posterior al enlace, antes del pago', () => {
  it('pagar sólo el enlace sucesor completa el alta con todos los regalos prometidos', async () => {
    const f = await fixture(2);
    const result = await offerDirectCourseBonusV1(db!,await f.proposal(3));
    if (!result.ok) throw new Error(result.reason);
    await f.delivered(result.outbound_message_id);
    expect(await acceptDirectCourseBonusV1(db!,{...f.identity,...result,source_turn_id:await f.inbound(),expected_offer_version:3}))
      .toMatchObject({ok:true});
    const successor = await reservePaymentLink(db!,{...f.paymentInput,idempotency_key:randomUUID(),promotion_code:result.promotion_code,
      promotion_cycle_id:result.promotion_cycle_id,accepted_offer_version:3});
    await db!`UPDATE payments SET provider_session_id=${'cs_test_'+successor.payment_id} WHERE id=${successor.payment_id}::uuid`;
    await f.pay(successor.payment_id);
    const external = vi.fn(async (_input:unknown,init?:RequestInit) => {
      const request = JSON.parse(String(init?.body));
      expect(request.bonus_offerings.map((course:{code:string})=>course.code)).toEqual(f.courses.slice(1,4).map(course=>course.code));
      return new Response(JSON.stringify({payment_id:successor.payment_id,enrollment_id:'enr_successor',student_id:'stu_successor',
        enrollment_status:'active',student_was_created:true,access:{login_email:'prueba@example.com',welcome_sent:true},
        created_at:new Date().toISOString(),bonus_enrollments:f.courses.slice(1,4).map(course=>({offering_code:course.code,enrollment_status:'active'}))}),
        {status:201,headers:{'content-type':'application/json'}});
    });
    expect(await runEnrollmentWorker({limit:1,scoped:true,payment_id:successor.payment_id},{sql:db!,fetchImpl:external,
      config:{enabled:true,baseUrl:'https://central.test/central-carga',signingSecret:'integration-secret-0123456789',
        environment:'test',paidAfter:new Date('2026-01-01T00:00:00Z'),allowSandboxContacts:true}})).toMatchObject({completed:1});
    expect(external).toHaveBeenCalledTimes(1);
    expect(await db!`SELECT offering_code FROM central_bonus_enrollment_items WHERE payment_id=${successor.payment_id}::uuid ORDER BY position`)
      .toEqual(f.courses.slice(1,4).map(course=>({offering_code:course.code})));
  });

  it('un pago pendiente en el enlace retirado bloquea aceptar y reservar otro cobro', async () => {
    const f = await fixture();
    const result = await offerDirectCourseBonusV1(db!,await f.proposal(1));
    if (!result.ok) throw new Error(result.reason);
    await f.delivered(result.outbound_message_id);
    await f.pending(f.payment.payment_id);
    const turn = await f.inbound();
    expect(await acceptDirectCourseBonusV1(db!,{...f.identity,...result,source_turn_id:turn,expected_offer_version:1}))
      .toMatchObject({ok:false,reason:'sale_already_closed'});
    expect(await readCourseBonusCapabilityV1({workspace_slug:f.slug,channel:'text',...f.identity,
      selected_offering_code:f.identity.paid_offering_code,source_turn_id:turn},{db:db!}))
      .toMatchObject({may_offer_bonus:false,may_accept_offer:false,may_send_promoted_payment:false});
    await expect(reservePaymentLink(db!,{...f.paymentInput,idempotency_key:randomUUID()}))
      .rejects.toMatchObject({code:'PAYMENT_RECONCILIATION_REQUIRED'});
  });

  it.each(['pending','paid'] as const)('cambiar plan o correo no evita el bloqueo del antecesor (%s)', async evidence => {
    const f = await fixture();
    const result = await offerDirectCourseBonusV1(db!,await f.proposal(1));
    if (!result.ok) throw new Error(result.reason);
    await f.delivered(result.outbound_message_id);
    expect(await acceptDirectCourseBonusV1(db!,{...f.identity,...result,source_turn_id:await f.inbound(),expected_offer_version:1}))
      .toMatchObject({ok:true});
    const next = await reservePaymentLink(db!,{...f.paymentInput,idempotency_key:randomUUID(),promotion_code:result.promotion_code,
      promotion_cycle_id:result.promotion_cycle_id,accepted_offer_version:1});
    if (evidence==='paid') await f.pay(f.payment.payment_id); else await f.pending(f.payment.payment_id);
    await db!`UPDATE contacts SET email='corregido@example.com' WHERE id=${f.identity.contact_id}::uuid`;
    for (const plan of ['one_time','monthly_12'] as const) {
      await expect(replacePendingCheckoutV1(db!,{...f.paymentInput,previous_payment_id:next.payment_id,
        promotion_code:result.promotion_code,plan_code:plan,idempotency_key:randomUUID(),source_turn_id:await f.inbound()}))
        .rejects.toMatchObject({code:'PAYMENT_RECONCILIATION_REQUIRED'});
    }
    expect(await db!`SELECT id FROM payments WHERE source_conversation_id=${f.identity.conversation_id}::uuid`).toHaveLength(2);
  });

  it('el replay histórico mantiene su ciclo original después de dos sucesores', async () => {
    const f = await fixture(1);
    let prior = f.previous!;
    for (const index of [2,3]) {
      const result = await offerDirectCourseBonusV1(db!,await f.proposal(index,await f.inbound(),prior));
      if (!result.ok) throw new Error(result.reason);
      await f.delivered(result.outbound_message_id);
      expect(await acceptDirectCourseBonusV1(db!,{...f.identity,...result,source_turn_id:await f.inbound(),
        expected_offer_version:result.offer_version})).toMatchObject({ok:true});
      await reservePaymentLink(db!,{...f.paymentInput,idempotency_key:randomUUID(),promotion_code:result.promotion_code,
        promotion_cycle_id:result.promotion_cycle_id,accepted_offer_version:result.offer_version});
      await db!`UPDATE conversation_sales_context_states_v1 SET stage='payment_link_sent' WHERE conversation_id=${f.identity.conversation_id}::uuid`;
      expect(await offerDirectCourseBonusV1(db!,f.history[0]!.input)).toEqual(f.history[0]!.result);
      prior = result;
    }
  });

  it('dos ejecuciones concurrentes del mismo turno producen una única reapertura', async () => {
    const f = await fixture(1);
    const input = await f.proposal(2);
    const results = await Promise.all([offerDirectCourseBonusV1(db!,input),offerDirectCourseBonusV1(competitor!,input)]);
    expect(results[0]).toMatchObject({ok:true,offer_version:2});
    expect(results[1]).toEqual(results[0]);
    expect(await db!`SELECT id FROM payment_intent_supersessions WHERE payment_id=${f.payment.payment_id}::uuid`).toHaveLength(1);
  });

  it('un fallo al guardar la salida revierte el retiro del enlace y la cancelación del paquete', async () => {
    const f = await fixture(1);
    const input = await f.proposal(2);
    const [existing] = await db!`SELECT d.idempotency_key FROM outbound_deliveries d
      JOIN messages m ON m.id=d.message_id WHERE m.conversation_id=${f.identity.conversation_id}::uuid LIMIT 1`;
    expect(await offerDirectCourseBonusV1(db!,{...input,outbound:{...input.outbound,idempotency_key:existing.idempotency_key}}))
      .toMatchObject({ok:false});
    expect(await db!`SELECT id FROM payment_intent_supersessions WHERE payment_id=${f.payment.payment_id}::uuid`).toEqual([]);
    expect((await db!`SELECT status FROM promotion_offers WHERE id=${f.previous!.offer_id}::uuid`)[0]).toEqual({status:'attached'});
  });

  it('un pago y una oferta concurrentes conservan un único resultado financiero coherente', async () => {
    const f = await fixture();
    const input = await f.proposal(1);
    const [offered,paid] = await Promise.all([offerDirectCourseBonusV1(db!,input),f.pay(f.payment.payment_id,competitor!)]);
    if (offered.ok) {
      expect(paid).toMatchObject({reconciliation_required:true});
      expect(await db!`SELECT id FROM fulfillment_jobs WHERE payment_id=${f.payment.payment_id}::uuid`).toEqual([]);
    } else {
      expect(offered).toMatchObject({reason:'sale_already_closed'});
      expect(await db!`SELECT id FROM payment_intent_supersessions WHERE payment_id=${f.payment.payment_id}::uuid`).toEqual([]);
      expect(await db!`SELECT id FROM fulfillment_jobs WHERE payment_id=${f.payment.payment_id}::uuid`).toHaveLength(1);
    }
  });

  it.each([0, 1, 2])('permite proponer una bonificación con %i regalos previos sin reescribir lo prometido', async (gifts) => {
    const f = await fixture(gifts);
    const original = await db!`SELECT * FROM payment_bonus_offerings WHERE payment_id=${f.payment.payment_id}::uuid ORDER BY position`;
    const turn = await f.inbound();
    const cap = await readCourseBonusCapabilityV1({ workspace_slug: f.slug, channel: 'text', ...f.identity,
      selected_offering_code: f.identity.paid_offering_code, source_turn_id: turn }, { db: db! });
    expect(cap).toMatchObject({ may_offer_bonus: true, may_reopen_negotiation: true });
    const input = await f.proposal(gifts + 1, turn);
    const result = await offerDirectCourseBonusV1(db!, input);
    expect(result).toMatchObject({ ok: true, offer_version: gifts + 1 });
    if (!result.ok) return;
    expect(await db!`SELECT reason FROM payment_intent_supersessions WHERE payment_id=${f.payment.payment_id}::uuid`)
      .toEqual([{ reason: 'NEGOTIATION_REOPENED' }]);
    expect(await db!`SELECT * FROM payment_bonus_offerings WHERE payment_id=${f.payment.payment_id}::uuid ORDER BY position`).toEqual(original);
    expect(await db!`SELECT offering_code_snapshot FROM promotion_offer_bonus_offerings WHERE offer_id=${result.offer_id}::uuid ORDER BY position`)
      .toEqual(f.courses.slice(1, gifts + 2).map(course => ({ offering_code_snapshot: course.code })));
    if (f.previous) {
      expect(result.offer_id).not.toBe(f.previous.offer_id);
      expect((await db!`SELECT status,bonus_snapshot_sealed_at FROM promotion_offers WHERE id=${f.previous.offer_id}::uuid`)[0])
        .toMatchObject({ status: 'cancelled', bonus_snapshot_sealed_at: expect.any(Date) });
    }
    expect(await offerDirectCourseBonusV1(db!, input)).toEqual(result);
    await f.delivered(result.outbound_message_id);
    const acceptance = await acceptDirectCourseBonusV1(db!, { ...f.identity, ...result,
      source_turn_id: await f.inbound(), expected_offer_version: result.offer_version });
    expect(acceptance).toMatchObject({ ok: true });
    const next = await reservePaymentLink(db!, { ...f.paymentInput, idempotency_key: randomUUID(),
      promotion_code: result.promotion_code, promotion_cycle_id: result.promotion_cycle_id, accepted_offer_version: result.offer_version });
    expect(next.payment_id).not.toBe(f.payment.payment_id);
    expect(await db!`SELECT offering_code_snapshot FROM payment_bonus_offerings WHERE payment_id=${next.payment_id}::uuid ORDER BY position`)
      .toEqual(f.courses.slice(1, gifts + 2).map(course => ({ offering_code_snapshot: course.code })));
  });

  it('una propuesta inválida conserva el enlace y el paquete anterior', async () => {
    const f = await fixture(1);
    const input = await f.proposal(2);
    expect(await offerDirectCourseBonusV1(db!, { ...input, bonus_offering_codes: [f.identity.paid_offering_code] }))
      .toMatchObject({ ok: false });
    expect(await db!`SELECT id FROM payment_intent_supersessions WHERE payment_id=${f.payment.payment_id}::uuid`).toEqual([]);
    expect((await db!`SELECT status FROM promotion_offers WHERE id=${f.previous!.offer_id}::uuid`)[0]).toEqual({ status: 'attached' });
  });

  it('mantiene el máximo de tres aunque el paquete esté adjunto a un enlace', async () => {
    const f = await fixture(3);
    expect(await offerDirectCourseBonusV1(db!, await f.proposal(4))).toMatchObject({ ok: false });
    expect(await db!`SELECT id FROM payment_intent_supersessions WHERE payment_id=${f.payment.payment_id}::uuid`).toEqual([]);
  });

  it('un pago que llegó primero impide reabrir la negociación', async () => {
    const f = await fixture();
    await f.pay(f.payment.payment_id);
    expect(await offerDirectCourseBonusV1(db!, await f.proposal(1))).toMatchObject({ ok: false, reason: 'sale_already_closed' });
    expect(await db!`SELECT id FROM payment_intent_supersessions WHERE payment_id=${f.payment.payment_id}::uuid`).toEqual([]);
  });

  it('un pago tardío del enlace retirado abre conciliación y bloquea aceptar o cobrar otro paquete', async () => {
    const f = await fixture();
    const result = await offerDirectCourseBonusV1(db!, await f.proposal(1));
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    await f.delivered(result.outbound_message_id);
    const paid = await f.pay(f.payment.payment_id);
    expect(paid).toMatchObject({ reconciliation_required: true });
    expect(await db!`SELECT id FROM fulfillment_jobs WHERE payment_id=${f.payment.payment_id}::uuid`).toEqual([]);
    expect(await acceptDirectCourseBonusV1(db!, { ...f.identity, ...result,
      source_turn_id: await f.inbound(), expected_offer_version: result.offer_version })).toMatchObject({ ok: false });
    await expect(reservePaymentLink(db!, { ...f.paymentInput, idempotency_key: randomUUID() })).rejects.toMatchObject({ code: 'PAYMENT_RECONCILIATION_REQUIRED' });
  });

  it.each(['old_first','successor_first'] as const)('dos pagos del linaje requieren conciliación sin alta duplicada (%s)', async order => {
    const f = await fixture();
    const result = await offerDirectCourseBonusV1(db!,await f.proposal(1));
    if (!result.ok) throw new Error(result.reason);
    await f.delivered(result.outbound_message_id);
    expect(await acceptDirectCourseBonusV1(db!,{...f.identity,...result,source_turn_id:await f.inbound(),
      expected_offer_version:result.offer_version})).toMatchObject({ok:true});
    const successor = await reservePaymentLink(db!,{...f.paymentInput,idempotency_key:randomUUID(),
      promotion_code:result.promotion_code,promotion_cycle_id:result.promotion_cycle_id,accepted_offer_version:result.offer_version});
    const pay = f.pay;
    if (order==='old_first') { await pay(f.payment.payment_id); expect(await pay(successor.payment_id)).toMatchObject({reconciliation_required:true}); }
    else { await pay(successor.payment_id); await pay(f.payment.payment_id); }
    expect(await db!`SELECT id FROM fulfillment_jobs WHERE payment_id=${f.payment.payment_id}::uuid`).toEqual([]);
    const external = vi.fn(async()=>{throw new Error('no debería llamarse a Central');});
    await runEnrollmentWorker({limit:1,scoped:true,payment_id:successor.payment_id},{sql:db!,fetchImpl:external,
      config:{enabled:true,baseUrl:'https://central.test/central-carga',signingSecret:'integration-secret-0123456789',
        environment:'test',paidAfter:new Date('2026-01-01T00:00:00Z'),allowSandboxContacts:true}});
    expect(external).not.toHaveBeenCalled();
    expect(await db!`SELECT id FROM central_enrollments WHERE payment_id=${successor.payment_id}::uuid`).toEqual([]);
  });
});
