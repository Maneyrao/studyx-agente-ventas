import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openLocalTestDatabase } from '../helpers/db';
import { recordModelPriceObjection, seedPriorModelNegotiation } from '../helpers/record-model-negotiation-facts';
import { offerDirectCourseBonusV1, acceptDirectCourseBonusV1 } from '@/features/promotions/application/direct-course-bonus-service';
import { readCourseBonusCapabilityV1 } from '@/features/promotions/application/read-course-bonus-capability';
import { reservePaymentLink, reserveStripeVerificationLink } from '@/features/payments/application/reserve-payment-link';
import { recordPaymentEvent } from '@/features/payments/application/record-payment-event';
import { runEnrollmentWorker } from '@/features/fulfillment/central-carga/worker';
import { replacePendingCheckoutV1 } from '@/features/payments/application/replace-pending-checkout';
import { readPriorAlreadySaidV1 } from '@/features/conversation/application/read-prior-already-said';
import { lockPaymentSaleV1, readNegotiationPaymentStateV1 } from '@/features/payments/application/negotiation-payment-state';
import { reserveStripeVerificationLink as reserveVerification } from '@/features/payments/application/reserve-payment-link';
import { resolveSaleContinuityV1, materializeSaleContinuityV1 } from '@/features/payments/application/resolve-sale-continuity';
import { cancelOpenCourseBonusOffersForCourseChangeV1 } from '@/features/promotions/application/commercial-followup-service';
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

/** A verified continuity proof: closed source (the fixture's conversation) + open canonical, same contact. */
async function linkedFixture(gifts = 0, options: { link?: boolean; seedCanonical?: boolean } = {}) {
  const f = await fixture(gifts);
  const { workspace_id: ws, contact_id: contact, conversation_id: source } = f.identity;
  const bot = `acct-${randomUUID()}`, integration = `int-${randomUUID()}`;
  const [canonThread] = await db!`INSERT INTO channel_threads(contact_id,provider,integration_id,channel,external_conversation_id,metadata)
    VALUES (${contact},'botpress',${integration},'whatsapp',${'new-' + randomUUID()},${db!.json({ bot_phone_number_id: bot })}) RETURNING id`;
  const sourceExternal = `old-${randomUUID()}`;
  const [sourceThread] = await db!`INSERT INTO channel_threads(contact_id,provider,integration_id,channel,external_conversation_id,metadata)
    VALUES (${contact},'botpress',${integration},'whatsapp',${sourceExternal},${db!.json({ bot_phone_number_id: bot })}) RETURNING id`;
  await db!`UPDATE conversations SET channel_thread_id=${sourceThread.id}::uuid WHERE id=${source}::uuid`;
  await db!`UPDATE conversations SET status='closed' WHERE id=${source}::uuid`;
  const [canonical] = await db!`INSERT INTO conversations(contact_id,channel,channel_thread_id)
    VALUES (${contact},'whatsapp',${canonThread.id}::uuid) RETURNING id`;
  await db!`INSERT INTO conversation_sales_context_states_v1(workspace_id,contact_id,conversation_id) VALUES (${ws},${contact},${canonical.id})`;
  if (options.link !== false) {
    await db!`INSERT INTO channel_account_thread_bindings(workspace_id,contact_id,provider,integration_id,channel,bot_phone_number_id,canonical_thread_id,reason)
      VALUES (${ws},${contact},'botpress',${integration},'whatsapp',${bot},${canonThread.id}::uuid,'test')`;
    await db!`INSERT INTO channel_thread_aliases(provider,integration_id,external_conversation_id,workspace_id,contact_id,channel,bot_phone_number_id,canonical_thread_id)
      VALUES ('botpress',${integration},${sourceExternal},${ws},${contact},'whatsapp',${bot},${canonThread.id}::uuid)`;
    await db!`INSERT INTO conversation_history_recovery_links(workspace_id,contact_id,channel,canonical_conversation_id,source_conversation_id,reason)
      VALUES (${ws},${contact},'whatsapp',${canonical.id}::uuid,${source}::uuid,'TEST_CONTINUITY')`;
  }
  const canon = { ...f.identity, conversation_id: canonical.id as string };
  const input = { workspace_id: ws, contact_id: contact, conversation_id: canon.conversation_id };
  async function inboundC(content = 'me parece muy caro') {
    const [m] = await db!`INSERT INTO messages(conversation_id,contact_id,direction,content)
      VALUES (${canon.conversation_id},${contact},'inbound',${content}) RETURNING id`;
    if (content === 'me parece muy caro') await recordModelPriceObjection(db!, m.id);
    return m.id as string;
  }
  async function proposalC(index: number, prior?: { promotion_code: string; promotion_cycle_id: string; offer_version: number }, turn?: string) {
    const id = randomUUID();
    return { ...canon, source_turn_id: turn ?? await inboundC(), expected_offer_version: prior?.offer_version ?? 0,
      ...(prior ? { promotion_code: prior.promotion_code, promotion_cycle_id: prior.promotion_cycle_id } : {}),
      bonus_offering_codes: [f.courses[index].code as string],
      motive: { kind: 'price_objection' as const, quote: 'me parece muy caro' }, declared_moves: ['price_objection'],
      outbound: { id, content: `Te bonifico ${f.courses[index].code}.`, provider: 'test', integration_id: 'test', channel: 'whatsapp',
        destination: 'test', idempotency_key: id } };
  }
  async function capability(turn: string) {
    return readCourseBonusCapabilityV1({ workspace_slug: f.slug, channel: 'text', ...canon,
      selected_offering_code: f.identity.paid_offering_code, source_turn_id: turn }, { db: db! });
  }
  async function counts() {
    const [row] = await db!`SELECT (SELECT count(*) FROM payments WHERE contact_id=${contact})::int payments,
      (SELECT count(*) FROM promotion_offers WHERE contact_id=${contact})::int offers,
      (SELECT count(*) FROM payment_intent_supersessions WHERE contact_id=${contact})::int supersessions,
      (SELECT count(*) FROM promotion_offer_bonus_offerings b JOIN promotion_offers o ON o.id=b.offer_id WHERE o.contact_id=${contact})::int bonuses`;
    return row;
  }
  if (options.seedCanonical !== false) await seedPriorModelNegotiation(db!, canon);
  async function reopenInCanonical(index: number, prior?: { promotion_code: string; promotion_cycle_id: string; offer_version: number }) {
    const result = await offerDirectCourseBonusV1(db!, await proposalC(index, prior));
    if (!result.ok) throw new Error(result.reason);
    await f.delivered(result.outbound_message_id);
    expect(await acceptDirectCourseBonusV1(db!, { ...canon, ...result, source_turn_id: await inboundC(), expected_offer_version: result.offer_version }))
      .toMatchObject({ ok: true });
    return result;
  }
  const worker = (paymentId: string, fetchImpl: typeof fetch) => runEnrollmentWorker({ limit: 1, scoped: true, payment_id: paymentId },
    { sql: db!, fetchImpl, config: { enabled: true, baseUrl: 'https://central.test/central-carga', signingSecret: 'integration-secret-0123456789',
      environment: 'test', paidAfter: new Date('2026-01-01T00:00:00Z'), allowSandboxContacts: true } });
  return { ...f, canon, input, source, inboundC, proposalC, capability, counts, reopenInCanonical, worker };
}

run('negociación con venta continuada en una conversación enlazada', () => {
  it('a. el mismo teléfono sin prueba de enlace no hereda ni reabre nada', async () => {
    const f = await linkedFixture(1, { link: false });
    const before = await f.counts();
    expect(await resolveSaleContinuityV1(db!, f.input)).toEqual({ kind: 'none' });
    expect(await materializeSaleContinuityV1(db!, f.input)).toEqual({ kind: 'none' });
    const turn = await f.inboundC();
    expect(await readNegotiationPaymentStateV1(db!, { ...f.input, offering_id: f.courses[0].id })).toMatchObject({ may_reopen: false });
    expect(await offerDirectCourseBonusV1(db!, await f.proposalC(2, f.previous, turn))).toMatchObject({ ok: false });
    expect(await f.counts()).toEqual(before);
    expect((await db!`SELECT selected_offering_code FROM conversation_sales_context_states_v1 WHERE conversation_id=${f.canon.conversation_id}::uuid`)[0])
      .toEqual({ selected_offering_code: null });
  });

  it('b. materializa curso, plan y etapa una sola vez sin tocar el contacto', async () => {
    const f = await linkedFixture(1);
    const [contactBefore] = await db!`SELECT * FROM contacts WHERE id=${f.identity.contact_id}::uuid`;
    expect(await resolveSaleContinuityV1(db!, f.input)).toMatchObject({ kind: 'single', offering_code: f.identity.paid_offering_code,
      payment_plan: 'one_time', stage: 'payment_link_sent', has_unpaid_link: true, source_conversation_id: f.source });
    const state = async () => (await db!`SELECT selected_offering_code,selected_payment_plan,stage,awaiting_reply,version
      FROM conversation_sales_context_states_v1 WHERE conversation_id=${f.canon.conversation_id}::uuid`)[0];
    const first = await state();
    expect(await materializeSaleContinuityV1(db!, f.input)).toMatchObject({ kind: 'single' });
    const after = await state();
    expect(after).toMatchObject({ selected_offering_code: f.identity.paid_offering_code, selected_payment_plan: 'one_time',
      stage: 'payment_link_sent', awaiting_reply: 'none', version: first.version + 1 });
    expect(await materializeSaleContinuityV1(db!, f.input)).toEqual({ kind: 'none' });
    expect(await state()).toEqual(after);
    expect(await db!`SELECT state_version FROM conversation_sales_context_state_events_v1 WHERE conversation_id=${f.canon.conversation_id}::uuid`)
      .toEqual([{ state_version: first.version + 1 }]);
    expect((await db!`SELECT * FROM contacts WHERE id=${f.identity.contact_id}::uuid`)[0]).toEqual(contactBefore);
    // Two racing claims write exactly one version.
    const g = await linkedFixture(0);
    await Promise.all([materializeSaleContinuityV1(db!, g.input), materializeSaleContinuityV1(competitor!, g.input)]);
    expect(await db!`SELECT state_version FROM conversation_sales_context_state_events_v1 WHERE conversation_id=${g.canon.conversation_id}::uuid`)
      .toHaveLength(1);
  });

  it('c. un saludo no muta pagos ni ofertas', async () => {
    const f = await linkedFixture(1);
    await materializeSaleContinuityV1(db!, f.input);
    const before = await f.counts();
    const turn = await f.inboundC('hola');
    await f.capability(turn);
    expect(await f.counts()).toEqual(before);
  });

  it('d. una nueva objeción en la conversación canónica reabre el enlace original y paga el sucesor', async () => {
    const f = await linkedFixture(1);
    await materializeSaleContinuityV1(db!, f.input);
    const turn = await f.inboundC();
    expect(await f.capability(turn)).toMatchObject({ may_offer_bonus: true });
    expect(await readNegotiationPaymentStateV1(db!, { ...f.input, offering_id: f.courses[0].id })).toMatchObject({ may_reopen: true,
      payment: { id: f.payment.payment_id, source_conversation_id: f.source } });
    const original = await db!`SELECT * FROM payment_bonus_offerings WHERE payment_id=${f.payment.payment_id}::uuid ORDER BY position`;
    const result = await offerDirectCourseBonusV1(db!, await f.proposalC(2, f.previous, turn));
    if (!result.ok) throw new Error(result.reason);
    expect(await db!`SELECT conversation_id,reason,source_turn_id FROM payment_intent_supersessions WHERE payment_id=${f.payment.payment_id}::uuid`)
      .toEqual([{ conversation_id: f.source, reason: 'NEGOTIATION_REOPENED', source_turn_id: turn }]);
    expect((await db!`SELECT conversation_id,predecessor_offer_id FROM promotion_offers WHERE id=${result.offer_id}::uuid`)[0])
      .toEqual({ conversation_id: f.canon.conversation_id, predecessor_offer_id: f.previous!.offer_id });
    expect(await db!`SELECT offering_code_snapshot FROM promotion_offer_bonus_offerings WHERE offer_id=${result.offer_id}::uuid ORDER BY position`)
      .toEqual(f.courses.slice(1, 3).map(course => ({ offering_code_snapshot: course.code })));
    await f.delivered(result.outbound_message_id);
    expect(await acceptDirectCourseBonusV1(db!, { ...f.canon, ...result, source_turn_id: await f.inboundC(), expected_offer_version: 2 }))
      .toMatchObject({ ok: true });
    const successor = await reservePaymentLink(db!, { ...f.paymentInput, conversation_id: f.canon.conversation_id, idempotency_key: randomUUID(),
      promotion_code: result.promotion_code, promotion_cycle_id: result.promotion_cycle_id, accepted_offer_version: 2 });
    expect((await db!`SELECT source_conversation_id FROM payments WHERE id=${successor.payment_id}::uuid`)[0]).toEqual({ source_conversation_id: f.canon.conversation_id });
    expect(await db!`SELECT * FROM payment_bonus_offerings WHERE payment_id=${f.payment.payment_id}::uuid ORDER BY position`).toEqual(original);
    await db!`UPDATE payments SET provider_session_id=${'cs_test_' + successor.payment_id} WHERE id=${successor.payment_id}::uuid`;
    await f.pay(successor.payment_id);
    const external = vi.fn(async (_input: unknown, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body));
      expect(request.bonus_offerings.map((course: { code: string }) => course.code)).toEqual(f.courses.slice(1, 3).map(course => course.code));
      return new Response(JSON.stringify({ payment_id: successor.payment_id, enrollment_id: 'enr_linked', student_id: 'stu_linked',
        enrollment_status: 'active', student_was_created: true, access: { login_email: 'prueba@example.com', welcome_sent: true },
        created_at: new Date().toISOString(), bonus_enrollments: f.courses.slice(1, 3).map(course => ({ offering_code: course.code, enrollment_status: 'active' })) }),
        { status: 201, headers: { 'content-type': 'application/json' } });
    });
    expect(await f.worker(successor.payment_id, external)).toMatchObject({ completed: 1 });
    expect(external).toHaveBeenCalledTimes(1);
    expect(await db!`SELECT offering_code FROM central_bonus_enrollment_items WHERE payment_id=${successor.payment_id}::uuid ORDER BY position`)
      .toEqual(f.courses.slice(1, 3).map(course => ({ offering_code: course.code })));
  });

  it('e. segundo y tercer regalo entre conversaciones; el cuarto se rechaza sin tocar el paquete', async () => {
    const f = await linkedFixture(1);
    await materializeSaleContinuityV1(db!, f.input);
    const second = await f.reopenInCanonical(2, f.previous);
    await reservePaymentLink(db!, { ...f.paymentInput, conversation_id: f.canon.conversation_id, idempotency_key: randomUUID(),
      promotion_code: second.promotion_code, promotion_cycle_id: second.promotion_cycle_id, accepted_offer_version: 2 });
    await db!`UPDATE conversation_sales_context_states_v1 SET stage='payment_link_sent' WHERE conversation_id=${f.canon.conversation_id}::uuid`;
    const third = await f.reopenInCanonical(3, second);
    expect(third.offer_version).toBe(3);
    await reservePaymentLink(db!, { ...f.paymentInput, conversation_id: f.canon.conversation_id, idempotency_key: randomUUID(),
      promotion_code: third.promotion_code, promotion_cycle_id: third.promotion_cycle_id, accepted_offer_version: 3 });
    await db!`UPDATE conversation_sales_context_states_v1 SET stage='payment_link_sent' WHERE conversation_id=${f.canon.conversation_id}::uuid`;
    const before = await f.counts();
    expect(await offerDirectCourseBonusV1(db!, await f.proposalC(4, third))).toMatchObject({ ok: false });
    expect(await f.counts()).toEqual(before);
    expect((await db!`SELECT status,offer_version FROM promotion_offers WHERE id=${third.offer_id}::uuid`)[0]).toEqual({ status: 'attached', offer_version: 3 });
  });

  it('f. dos reaperturas concurrentes desde el origen y el canónico producen un único sucesor', async () => {
    const f = await linkedFixture(1);
    await materializeSaleContinuityV1(db!, f.input);
    const fromCanonical = await f.proposalC(2, f.previous);
    const fromSource = await f.proposal(3);
    const results = await Promise.all([offerDirectCourseBonusV1(db!, fromCanonical), offerDirectCourseBonusV1(competitor!, fromSource)]);
    expect(results.filter(result => result.ok)).toHaveLength(1);
    expect(results.find(result => !result.ok)).toMatchObject({ ok: false });
    expect(await db!`SELECT id FROM payment_intent_supersessions WHERE payment_id=${f.payment.payment_id}::uuid`).toHaveLength(1);
    expect(await db!`SELECT id FROM promotion_offers WHERE predecessor_offer_id=${f.previous!.offer_id}::uuid`).toHaveLength(1);
  });

  it('g. el pago tardío del enlace retirado abre conciliación y no da de alta', async () => {
    const f = await linkedFixture(1);
    await materializeSaleContinuityV1(db!, f.input);
    const result = await f.reopenInCanonical(2, f.previous);
    const next = await reservePaymentLink(db!, { ...f.paymentInput, conversation_id: f.canon.conversation_id, idempotency_key: randomUUID(),
      promotion_code: result.promotion_code, promotion_cycle_id: result.promotion_cycle_id, accepted_offer_version: 2 });
    expect(await f.pay(f.payment.payment_id)).toMatchObject({ reconciliation_required: true });
    expect(await db!`SELECT id FROM fulfillment_jobs WHERE payment_id=${f.payment.payment_id}::uuid`).toEqual([]);
    expect(await f.pay(next.payment_id)).toMatchObject({ reconciliation_required: true });
    const external = vi.fn(async () => { throw new Error('no debería llamarse a Central'); });
    await f.worker(next.payment_id, external as unknown as typeof fetch);
    expect(external).not.toHaveBeenCalled();
    expect(await db!`SELECT id FROM central_enrollments WHERE payment_id IN (${f.payment.payment_id}::uuid,${next.payment_id}::uuid)`).toEqual([]);
  });

  it.each(['pending', 'paid'] as const)('h. un pago %s del enlace original bloquea desde la conversación canónica', async evidence => {
    const f = await linkedFixture(1);
    await materializeSaleContinuityV1(db!, f.input);
    if (evidence === 'paid') await f.pay(f.payment.payment_id); else await f.pending(f.payment.payment_id);
    const turn = await f.inboundC();
    expect(await readNegotiationPaymentStateV1(db!, { ...f.input, offering_id: f.courses[0].id })).toMatchObject({ may_reopen: false, blocked: true });
    expect(await f.capability(turn)).toMatchObject({ may_offer_bonus: false });
    const before = await f.counts();
    expect(await offerDirectCourseBonusV1(db!, await f.proposalC(2, f.previous, turn))).toMatchObject({ ok: false, reason: 'sale_already_closed' });
    await db!`UPDATE contacts SET email='corregido@example.com' WHERE id=${f.identity.contact_id}::uuid`;
    await expect(replacePendingCheckoutV1(db!, { ...f.paymentInput, conversation_id: f.canon.conversation_id, previous_payment_id: f.payment.payment_id,
      promotion_code: f.previous!.promotion_code, plan_code: 'monthly_12', idempotency_key: randomUUID(), source_turn_id: await f.inboundC() }))
      .rejects.toMatchObject({ code: expect.stringMatching(/^(CHECKOUT_REPLACEMENT_BLOCKED|PAYMENT_RECONCILIATION_REQUIRED)$/) });
    await expect(reservePaymentLink(db!, { ...f.paymentInput, conversation_id: f.canon.conversation_id, idempotency_key: randomUUID() }))
      .rejects.toMatchObject({ code: 'PAYMENT_RECONCILIATION_REQUIRED' });
    const changeCourse = async () => cancelOpenCourseBonusOffersForCourseChangeV1(db!, { ...f.input, selected_offering_code: f.courses[3].code, source_turn_id: await f.inboundC('otro curso') });
    // A completed purchase is not in flight (a new sale may start); a pending one keeps its course.
    if (evidence === 'pending') await expect(changeCourse()).rejects.toThrow('COURSE_CHANGE_BLOCKED_BY_PAYMENT'); else await changeCourse();
    expect(await db!`SELECT id FROM payment_intent_supersessions WHERE payment_id=${f.payment.payment_id}::uuid`).toEqual([]);
    expect(await f.counts()).toEqual(before);
  });

  it('i. dos cursos abiertos son ambiguos y no se materializa ninguno', async () => {
    const f = await linkedFixture(0);
    await reservePaymentLink(db!, { ...f.paymentInput, conversation_id: f.canon.conversation_id, offering_id: f.courses[1].id,
      idempotency_key: randomUUID(), payment_link_url: 'https://buy.stripe.com/test_other' });
    const codes = [f.courses[0].code, f.courses[1].code].sort();
    expect(await resolveSaleContinuityV1(db!, f.input)).toEqual({ kind: 'ambiguous', candidate_offering_codes: codes });
    expect(await materializeSaleContinuityV1(db!, f.input)).toMatchObject({ kind: 'ambiguous' });
    expect((await db!`SELECT selected_offering_code,version FROM conversation_sales_context_states_v1 WHERE conversation_id=${f.canon.conversation_id}::uuid`)[0])
      .toMatchObject({ selected_offering_code: null });
  });

  it.each(['PLAN_CHANGED', 'CONTACT_DATA_CHANGED', 'REUSE'] as const)('j. %s sobre el enlace del origen', async kind => {
    const f = await linkedFixture(1);
    await materializeSaleContinuityV1(db!, f.input);
    if (kind === 'CONTACT_DATA_CHANGED') await db!`UPDATE contacts SET email='corregido@example.com' WHERE id=${f.identity.contact_id}::uuid`;
    const result = await replacePendingCheckoutV1(db!, { ...f.paymentInput, conversation_id: f.canon.conversation_id,
      previous_payment_id: f.payment.payment_id, promotion_code: f.previous!.promotion_code,
      plan_code: kind === 'PLAN_CHANGED' ? 'monthly_12' : 'one_time', idempotency_key: randomUUID(), source_turn_id: await f.inboundC('mi correo cambió') });
    if (kind === 'REUSE') {
      expect(result).toMatchObject({ outcome: 'reused', payment_id: f.payment.payment_id });
      expect(await f.counts()).toMatchObject({ payments: 1, supersessions: 0 });
      return;
    }
    expect(result).toMatchObject({ outcome: 'replaced', reason: kind });
    expect(await db!`SELECT conversation_id,reason FROM payment_intent_supersessions WHERE payment_id=${f.payment.payment_id}::uuid`)
      .toEqual([{ conversation_id: f.source, reason: kind }]);
    if (result.outcome !== 'replaced') return;
    expect((await db!`SELECT source_conversation_id FROM payments WHERE id=${result.payment_id}::uuid`)[0]).toEqual({ source_conversation_id: f.canon.conversation_id });
    expect(await db!`SELECT offering_code_snapshot FROM payment_bonus_offerings WHERE payment_id=${result.payment_id}::uuid ORDER BY position`)
      .toEqual(await db!`SELECT offering_code_snapshot FROM payment_bonus_offerings WHERE payment_id=${f.payment.payment_id}::uuid ORDER BY position`);
  });

  it('k. un cambio explícito de curso en el canónico cancela el paquete y el enlace del curso anterior', async () => {
    const f = await linkedFixture(1);
    await materializeSaleContinuityV1(db!, f.input);
    const email = (await db!`SELECT email FROM contacts WHERE id=${f.identity.contact_id}::uuid`)[0];
    await cancelOpenCourseBonusOffersForCourseChangeV1(db!, { ...f.input, selected_offering_code: f.courses[3].code, source_turn_id: await f.inboundC('mejor quiero otro curso') });
    expect((await db!`SELECT status,cancel_reason FROM promotion_offers WHERE id=${f.previous!.offer_id}::uuid`)[0])
      .toEqual({ status: 'cancelled', cancel_reason: 'CUSTOMER_CHANGED_COURSE' });
    expect(await db!`SELECT conversation_id,reason FROM payment_intent_supersessions WHERE payment_id=${f.payment.payment_id}::uuid`)
      .toEqual([{ conversation_id: f.source, reason: 'COURSE_CHANGED' }]);
    expect((await db!`SELECT email FROM contacts WHERE id=${f.identity.contact_id}::uuid`)[0]).toEqual(email);
  });

  it('l. la evidencia de la escalera del origen habilita el siguiente regalo con una objeción nueva sólo en el canónico', async () => {
    const f = await linkedFixture(1, { seedCanonical: false });
    await materializeSaleContinuityV1(db!, f.input);
    expect(await db!`SELECT d.id FROM agent_decisions d JOIN messages m ON m.id=d.turn_id WHERE m.conversation_id=${f.canon.conversation_id}::uuid`).toEqual([]);
    const result = await offerDirectCourseBonusV1(db!, await f.proposalC(2, f.previous));
    expect(result).toMatchObject({ ok: true, offer_version: 2 });
    // The motive stays tied to the canonical current turn: a turn without the quote is not enough.
    const g = await linkedFixture(1, { seedCanonical: false });
    await materializeSaleContinuityV1(db!, g.input);
    const quiet = await g.inboundC('hola');
    expect(await offerDirectCourseBonusV1(db!, await g.proposalC(2, g.previous, quiet))).toMatchObject({ ok: false });
  });

  it('m. un pago previo expirado o fallido y el enlace de prueba de USD 0,50 no bloquean un enlace real', async () => {
    for (const status of ['expired', 'failed'] as const) {
      const f = await linkedFixture(0);
      await materializeSaleContinuityV1(db!, f.input);
      const events = status === 'expired' ? ['checkout_creation_started', 'checkout_created', 'checkout_expired'] as const
        : ['checkout_creation_started', 'checkout_creation_failed'] as const;
      for (const type of events) await recordPaymentEvent(db!, { payment_id: f.payment.payment_id, provider: 'stripe', provider_event_id: randomUUID(), event: { type }, payload: {} });
      expect((await db!`SELECT status FROM payments WHERE id=${f.payment.payment_id}::uuid`)[0]).toEqual({ status });
      await reserveStripeVerificationLink(db!, { workspace_id: f.identity.workspace_id, contact_id: f.identity.contact_id,
        offering_id: f.courses[0].id, idempotency_key: randomUUID(), payment_link_url: 'https://buy.stripe.com/test_verification' });
      const state = await readNegotiationPaymentStateV1(db!, { ...f.input, offering_id: f.courses[0].id });
      expect(state).toMatchObject({ blocked: false });
      const next = await reservePaymentLink(db!, { ...f.paymentInput, conversation_id: f.canon.conversation_id, idempotency_key: randomUUID() });
      expect(next.payment_id).not.toBe(f.payment.payment_id);
    }
  });

  it('n. el contexto de la conversación canónica incluye los marcadores already_said del origen verificado', async () => {
    const f = await linkedFixture(0, { seedCanonical: false });
    const say = async (conversation: string, text: string | null, contact = f.identity.contact_id) => {
      const [m] = await db!`INSERT INTO messages(conversation_id,contact_id,direction,content)
        VALUES (${conversation},${contact},'inbound','hola') RETURNING id`;
      await db!`INSERT INTO agent_decisions(turn_id,trace_id,schema_version,intent,decision_kind,response,response_type,
        memory_candidates,next_state,reason_code,confidence,model_provider,model_name,prompt_version,payload_hash,already_said)
        VALUES (${m.id}::uuid,${randomUUID()}::uuid,4,'commercial','reply','ok','commercial_reply','[]'::jsonb,
        'waiting_user','X',1,'offline','fixture','fixture',decode(repeat('00',32),'hex'),${text})`;
    };
    await say(f.source, 'Ya se envió el enlace del plan anual');
    await say(f.source, '   ');
    await say(f.source, 'x'.repeat(300));
    await say(f.canon.conversation_id, 'marcador del canónico');
    const current = await f.inboundC('hola');
    const read = (turn: string) => readPriorAlreadySaidV1({ workspace_slug: f.slug, contact_id: f.identity.contact_id,
      conversation_id: f.canon.conversation_id, source_turn_id: turn }, { db: db! });
    const markers = await read(current);
    expect(markers).toEqual(['marcador del canónico', 'x'.repeat(200), 'Ya se envió el enlace del plan anual']);
    // A conversation without a verified link never reads another one's markers.
    const g = await linkedFixture(0, { link: false, seedCanonical: false });
    await say(g.source, 'no heredable', g.identity.contact_id);
    expect(await readPriorAlreadySaidV1({ workspace_slug: g.slug, contact_id: g.identity.contact_id,
      conversation_id: g.canon.conversation_id, source_turn_id: await g.inboundC('hola') }, { db: db! })).toEqual([]);
  });

  it('o. un paquete sin enlace en el origen cerrado no se hereda: sin excepciones crudas', async () => {
    const f = await linkedFixture(0);
    const offered = await offerDirectCourseBonusV1(db!, await f.proposal(1));
    if (!offered.ok) throw new Error(offered.reason);
    await f.delivered(offered.outbound_message_id);
    expect(await acceptDirectCourseBonusV1(db!, { ...f.identity, ...offered, source_turn_id: await f.inbound(), expected_offer_version: 1 })).toMatchObject({ ok: true });
    await materializeSaleContinuityV1(db!, f.input);
    const turn = await f.inboundC();
    expect(await f.capability(turn)).toMatchObject({ package_status: null, bonus_offerings: [] });
    const accepted = await acceptDirectCourseBonusV1(db!, { ...f.canon, ...offered, source_turn_id: turn, expected_offer_version: 1 });
    expect(accepted).toMatchObject({ ok: false });
    const fresh = await offerDirectCourseBonusV1(db!, await f.proposalC(2));
    expect(typeof fresh.ok).toBe('boolean');
  });

  it.each(['creating_checkout', 'creation_ambiguous'] as const)('p. un cobro %s bloquea y cuenta como enlace pendiente', async status => {
    const f = await linkedFixture(0);
    const events = status === 'creating_checkout' ? ['checkout_creation_started'] as const : ['checkout_creation_started', 'checkout_creation_ambiguous'] as const;
    for (const type of events) await recordPaymentEvent(db!, { payment_id: f.payment.payment_id, provider: 'internal', provider_event_id: randomUUID(), event: { type }, payload: {} });
    expect((await db!`SELECT status FROM payments WHERE id=${f.payment.payment_id}::uuid`)[0]).toEqual({ status });
    expect(await readNegotiationPaymentStateV1(db!, { ...f.input, offering_id: f.courses[0].id })).toMatchObject({ blocked: true, in_flight: true, may_reopen: false });
    expect(await resolveSaleContinuityV1(db!, f.input)).toMatchObject({ kind: 'single', has_unpaid_link: true, stage: 'payment_link_sent' });
    await expect(reservePaymentLink(db!, { ...f.paymentInput, conversation_id: f.canon.conversation_id, idempotency_key: randomUUID() }))
      .rejects.toMatchObject({ code: 'PAYMENT_RECONCILIATION_REQUIRED' });
  });

  it('q. el pago de verificación de USD 0,50 sin conversación no bloquea un enlace real sin conversación', async () => {
    const f = await linkedFixture(0);
    const test = await reserveVerification(db!, { workspace_id: f.identity.workspace_id, contact_id: f.identity.contact_id,
      offering_id: f.courses[0].id, idempotency_key: randomUUID(), payment_link_url: 'https://buy.stripe.com/test_verification' });
    await f.pay(test.payment_id);
    expect((await db!`SELECT status FROM payments WHERE id=${test.payment_id}::uuid`)[0]).toEqual({ status: 'paid' });
    const scope = { workspace_id: f.identity.workspace_id, contact_id: f.identity.contact_id, conversation_id: null, offering_id: f.courses[0].id };
    expect(await readNegotiationPaymentStateV1(db!, scope)).toMatchObject({ blocked: false });
    const real = await reservePaymentLink(db!, { workspace_id: scope.workspace_id, contact_id: scope.contact_id, offering_id: scope.offering_id,
      plan_code: 'one_time', payment_link_url: 'https://buy.stripe.com/test_null_conversation', idempotency_key: randomUUID() });
    expect(real.payment_id).not.toBe(test.payment_id);
  });

  it('r. el candado de venta es el mismo desde el origen y desde el canónico', async () => {
    const f = await linkedFixture(0);
    const offering_id = f.courses[0].id as string;
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    let entered!: () => void;
    const holding = new Promise<void>(resolve => { entered = resolve; });
    const first = db!.begin(async tx => {
      await lockPaymentSaleV1(tx as never, { ...f.input, conversation_id: f.source, offering_id });
      entered();
      await held;
    });
    await holding;
    let acquired = false;
    const second = competitor!.begin(async tx => {
      await lockPaymentSaleV1(tx as never, { ...f.input, offering_id });
      acquired = true;
    });
    await new Promise(resolve => setTimeout(resolve, 300));
    expect(acquired).toBe(false);
    release();
    await Promise.all([first, second]);
    expect(acquired).toBe(true);
  });

  it('s. un linaje que se bloquea durante la llamada externa conserva la evidencia y no cierra el alta', async () => {
    const f = await linkedFixture(1);
    await materializeSaleContinuityV1(db!, f.input);
    const result = await f.reopenInCanonical(2, f.previous);
    const next = await reservePaymentLink(db!, { ...f.paymentInput, conversation_id: f.canon.conversation_id, idempotency_key: randomUUID(),
      promotion_code: result.promotion_code, promotion_cycle_id: result.promotion_cycle_id, accepted_offer_version: 2 });
    await db!`UPDATE payments SET provider_session_id=${'cs_test_' + next.payment_id} WHERE id=${next.payment_id}::uuid`;
    await f.pay(next.payment_id);
    const external = vi.fn(async () => {
      await f.pay(f.payment.payment_id); // the retired link is paid while Central is being called
      return new Response(JSON.stringify({ payment_id: next.payment_id, enrollment_id: 'enr_late', student_id: 'stu_late',
        enrollment_status: 'active', student_was_created: true, access: { login_email: 'prueba@example.com', welcome_sent: true },
        created_at: new Date().toISOString(), bonus_enrollments: f.courses.slice(1, 3).map(course => ({ offering_code: course.code, enrollment_status: 'active' })) }),
        { status: 201, headers: { 'content-type': 'application/json' } });
    });
    const outcome = await f.worker(next.payment_id, external as unknown as typeof fetch);
    expect(outcome).toMatchObject({ completed: 0, dead_lettered: 1 });
    expect((await db!`SELECT status,last_error_code FROM fulfillment_jobs WHERE payment_id=${next.payment_id}::uuid`)[0])
      .toMatchObject({ status: 'dead_letter', last_error_code: 'payment_reconciliation_required' });
    expect(await db!`SELECT enrollment_id FROM central_enrollments WHERE payment_id=${next.payment_id}::uuid`).toEqual([{ enrollment_id: 'enr_late' }]);
  });

  it('t. un pago que llega entre la lectura de candidatos y el candado se rechaza limpio', async () => {
    const f = await linkedFixture(0);
    let go!: () => void;
    const gate = new Promise<void>(resolve => { go = resolve; });
    let held!: () => void;
    const holding = new Promise<void>(resolve => { held = resolve; });
    const webhook = competitor!.begin(async tx => {
      await lockPaymentSaleV1(tx as never, { ...f.input, conversation_id: f.source, offering_id: f.courses[0].id });
      held();
      await gate;
      await tx`INSERT INTO payment_events(payment_id,provider,provider_event_id,event_type,payload)
        VALUES (${f.payment.payment_id}::uuid,'stripe',${randomUUID()},'checkout_completed_unpaid','{}'::jsonb)`;
    });
    await holding;
    const change = cancelOpenCourseBonusOffersForCourseChangeV1(db!, { ...f.input, selected_offering_code: f.courses[3].code, source_turn_id: await f.inboundC('otro curso') });
    const settled = change.then(() => 'ok', (error: Error) => error.message);
    await new Promise(resolve => setTimeout(resolve, 300));
    go();
    await webhook;
    expect(await settled).toBe('COURSE_CHANGE_BLOCKED_BY_PAYMENT');
    expect(await db!`SELECT id FROM payment_intent_supersessions WHERE payment_id=${f.payment.payment_id}::uuid`).toEqual([]);
  });

  describe('venta cerrada por rechazo con un enlace impago seguro', () => {
    const close = (conversation: string) => db!`UPDATE conversation_sales_context_states_v1 SET stage='closed',awaiting_reply='none'
      WHERE conversation_id=${conversation}::uuid`;

    it('un saludo no muta nada y una objeción nueva reabre, cobra el sucesor y da de alta una sola vez', async () => {
      const f = await fixture(0);
      await close(f.identity.conversation_id);
      const count = async () => (await db!`SELECT (SELECT count(*) FROM payments WHERE contact_id=${f.identity.contact_id})::int p,
        (SELECT count(*) FROM promotion_offers WHERE contact_id=${f.identity.contact_id})::int o,
        (SELECT count(*) FROM payment_intent_supersessions WHERE contact_id=${f.identity.contact_id})::int s`)[0];
      const before = await count();
      const [hello] = await db!`INSERT INTO messages(conversation_id,contact_id,direction,content)
        VALUES (${f.identity.conversation_id},${f.identity.contact_id},'inbound','hola') RETURNING id`;
      expect(await readCourseBonusCapabilityV1({ workspace_slug: f.slug, channel: 'text', ...f.identity,
        selected_offering_code: f.identity.paid_offering_code, source_turn_id: hello.id }, { db: db! })).toMatchObject({ may_offer_bonus: true });
      expect(await count()).toEqual(before);
      const result = await offerDirectCourseBonusV1(db!, await f.proposal(1));
      if (!result.ok) throw new Error(result.reason);
      expect(await db!`SELECT reason FROM payment_intent_supersessions WHERE payment_id=${f.payment.payment_id}::uuid`).toEqual([{ reason: 'NEGOTIATION_REOPENED' }]);
      expect((await db!`SELECT stage FROM conversation_sales_context_states_v1 WHERE conversation_id=${f.identity.conversation_id}::uuid`)[0]).toEqual({ stage: 'plan_selected' });
      await f.delivered(result.outbound_message_id);
      expect(await acceptDirectCourseBonusV1(db!, { ...f.identity, ...result, source_turn_id: await f.inbound(), expected_offer_version: 1 })).toMatchObject({ ok: true });
      const successor = await reservePaymentLink(db!, { ...f.paymentInput, idempotency_key: randomUUID(), promotion_code: result.promotion_code,
        promotion_cycle_id: result.promotion_cycle_id, accepted_offer_version: 1 });
      await db!`UPDATE payments SET provider_session_id=${'cs_test_' + successor.payment_id} WHERE id=${successor.payment_id}::uuid`;
      await f.pay(successor.payment_id);
      const external = vi.fn(async (_input: unknown, init?: RequestInit) => {
        expect(JSON.parse(String(init?.body)).bonus_offerings.map((course: { code: string }) => course.code)).toEqual([f.courses[1].code]);
        return new Response(JSON.stringify({ payment_id: successor.payment_id, enrollment_id: 'enr_closed', student_id: 'stu_closed',
          enrollment_status: 'active', student_was_created: true, access: { login_email: 'prueba@example.com', welcome_sent: true },
          created_at: new Date().toISOString(), bonus_enrollments: [{ offering_code: f.courses[1].code, enrollment_status: 'active' }] }),
          { status: 201, headers: { 'content-type': 'application/json' } });
      });
      expect(await runEnrollmentWorker({ limit: 1, scoped: true, payment_id: successor.payment_id }, { sql: db!, fetchImpl: external,
        config: { enabled: true, baseUrl: 'https://central.test/central-carga', signingSecret: 'integration-secret-0123456789',
          environment: 'test', paidAfter: new Date('2026-01-01T00:00:00Z'), allowSandboxContacts: true } })).toMatchObject({ completed: 1 });
      expect(external).toHaveBeenCalledTimes(1);
    });

    it('cerrada con un pago real no se puede reabrir', async () => {
      const f = await fixture(0);
      await close(f.identity.conversation_id);
      await f.pay(f.payment.payment_id);
      const turn = await f.inbound();
      expect(await readCourseBonusCapabilityV1({ workspace_slug: f.slug, channel: 'text', ...f.identity,
        selected_offering_code: f.identity.paid_offering_code, source_turn_id: turn }, { db: db! })).toMatchObject({ may_offer_bonus: false });
      expect(await offerDirectCourseBonusV1(db!, await f.proposal(1, turn))).toMatchObject({ ok: false, reason: 'sale_already_closed' });
    });
  });
});
