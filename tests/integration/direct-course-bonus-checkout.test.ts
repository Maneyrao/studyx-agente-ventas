import { recordModelPriceObjection, seedPriorModelNegotiation } from '../helpers/record-model-negotiation-facts';
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openIndependentLocalTestDatabases, openLocalTestDatabase } from '../helpers/db';
import { acceptDirectCourseBonusV1, offerDirectCourseBonusV1 } from '@/features/promotions/application/direct-course-bonus-service';
import { cancelOpenCourseBonusOffersForCourseChangeV1 } from '@/features/promotions/application/commercial-followup-service';
import { createValidatedPaymentLinkCourseSelectionV1, reservePaymentLink } from '@/features/payments/application/reserve-payment-link';
import { recordPaymentEvent } from '@/features/payments/application/record-payment-event';
import { readCourseBonusCapabilityV1 } from '@/features/promotions/application/read-course-bonus-capability';
import { processStripeWebhook } from '@/features/payments/application/process-stripe-webhook';
import Stripe from 'stripe';
import { seedConversationForAgentTurn } from '../helpers/agent-turn-fixtures';
import { commitAgentDecision } from '@/lib/services/decision.service';
import { processInboundMessage } from '@/lib/services/ingestion.service';

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const db = process.env.TEST_DATABASE_URL ? openLocalTestDatabase() : null;
afterAll(async () => db?.end());
beforeEach(() => {
  vi.stubEnv('COURSE_BONUS_FLOW_MODE', 'direct');
  vi.stubEnv('COURSE_BONUS_MAX_COURSES', '3');
  vi.stubEnv('CENTRAL_CARGA_BONUS_ENABLED', 'true');
});
afterEach(() => vi.unstubAllEnvs());

async function fixture(count = 1, accepted = true) {
  const key = randomUUID();
  const [w] = await db!`INSERT INTO workspaces(slug,display_name) VALUES (${key},'Checkout') RETURNING id`;
  const [c] = await db!`INSERT INTO contacts(phone,channel_origin,status) VALUES
    (${'+' + String(Math.floor(100000000000 + Math.random()*800000000000))},'whatsapp','prospecto') RETURNING id`;
  await db!`INSERT INTO workspace_contacts(workspace_id,contact_id,source_channel) VALUES (${w.id},${c.id},'whatsapp')`;
  const [v] = await db!`INSERT INTO conversations(contact_id,channel) VALUES (${c.id},'whatsapp') RETURNING id`;
  const courses = await db!`INSERT INTO offerings(workspace_id,code,display_name,offering_type,status,description,price_type,price_amount,currency,billing_interval)
    SELECT ${w.id}, (ARRAY['introduccion_ecommerce','fotografia_celulares_tiendas_online','publicidad_redes_sociales','instagram_emprendedores','ingles_1'])[n+1],'Course ' || n,'course','active','Course','fixed',360,'USD','annual' FROM generate_series(0,4) n RETURNING id,code`;
  await db!`INSERT INTO conversation_sales_context_states_v1(workspace_id,conversation_id,contact_id,selected_offering_code)
    VALUES (${w.id},${v.id},${c.id},${courses[0].code})`;
  async function inbound(prior = false) {
    const [m] = await db!`INSERT INTO messages(conversation_id,contact_id,direction,content,created_at)
      VALUES (${v.id},${c.id},'inbound','Customer',now() - ${prior ? 10 : 0} * interval '1 second') RETURNING id`;
    // Model-recorded current reply supports Rule A escalation; text alone does not.
    if (!prior) await recordModelPriceObjection(db!, m.id);
    return m.id as string;
  }
  await seedPriorModelNegotiation(db!,{workspace_id:w.id,contact_id:c.id,conversation_id:v.id});
  const prior = await inbound(true);
  await db!`INSERT INTO selected_memories(contact_id,conversation_id,source_message_id,status,memory_type,memory_key,value_normalized,source_quote,confidence,dedupe_hash)
    VALUES (${c.id},${v.id},${prior},'active','objection','price_objection','expensive','Customer',0.9,${'a'.repeat(64)})`;
  const identity = {workspace_id:w.id as string,contact_id:c.id as string,conversation_id:v.id as string,
    paid_offering_code:courses[0].code as string};
  let offer: {offer_id:string;promotion_code:string;promotion_cycle_id:string;offer_version:number} | undefined;
  for(let n=1;n<=count;n++) {
    const id=randomUUID();
    const result=await offerDirectCourseBonusV1(db!,{...identity,source_turn_id:await inbound(),expected_offer_version:n-1,
      ...(offer ? {promotion_code:offer.promotion_code,promotion_cycle_id:offer.promotion_cycle_id} : {}),
      bonus_offering_codes:[courses[n].code as string],outbound:{id,content:'Bonus',provider:'test',integration_id:'test',channel:'whatsapp',destination:'test',idempotency_key:id}});
    if(!result.ok) throw new Error(result.reason);
    offer=result;
    await db!`UPDATE outbound_deliveries SET state='leased' WHERE message_id=${id}`;
    await db!`UPDATE outbound_deliveries SET state='submitted',submitted_at=now() WHERE message_id=${id}`;
    await db!`UPDATE outbound_deliveries SET state='delivered',delivered_at=now() WHERE message_id=${id}`;
  }
  if(!offer) throw new Error('missing offer');
  if(accepted) expect(await acceptDirectCourseBonusV1(db!,{...identity,...offer,source_turn_id:await inbound(),expected_offer_version:count})).toMatchObject({ok:true});
  const input={workspace_id:identity.workspace_id,contact_id:identity.contact_id,conversation_id:identity.conversation_id,
    offering_id:courses[0].id as string,plan_code:'one_time' as const,idempotency_key:randomUUID(),
    payment_link_url:'https://buy.stripe.com/test_bonus',promotion_code:offer.promotion_code,
    promotion_cycle_id:offer.promotion_cycle_id,accepted_offer_version:count};
  async function change() {
    const source=await inbound();
    await db!.begin(async tx=>{
      await cancelOpenCourseBonusOffersForCourseChangeV1(tx,{...identity,selected_offering_code:courses[4].code,source_turn_id:source});
      await tx`UPDATE conversation_sales_context_states_v1 SET selected_offering_code=${courses[4].code} WHERE conversation_id=${v.id}`;
    });
    return source;
  }
  return {identity,courses,offer,input,change,inbound};
}

run('direct bonus checkout exact accepted package',()=>{
  it('PASO 1a: global switch extends and accepts for any contact with both canary lists empty', async () => {
    const f = await fixture(1, false);
    vi.stubEnv('CENTRAL_CARGA_BONUS_ENABLED', 'true');
    vi.stubEnv('COURSE_BONUS_FLOW_MODE', 'direct');
    vi.stubEnv('COURSE_BONUS_MAX_COURSES', '3');
    vi.stubEnv('CENTRAL_CARGA_BONUS_CANARY_CONTACT_IDS', '');
    vi.stubEnv('CENTRAL_CARGA_BONUS_CANARY_PHONE_E164S', '');
    const id = randomUUID();
    const extended = await offerDirectCourseBonusV1(db!, { ...f.identity,
      source_turn_id: await f.inbound(), expected_offer_version: 1,
      promotion_code: f.offer.promotion_code, promotion_cycle_id: f.offer.promotion_cycle_id,
      bonus_offering_codes: [f.courses[2].code], outbound: { id, content: 'Second bonus', provider: 'test',
        integration_id: 'test', channel: 'whatsapp', destination: 'test', idempotency_key: id } });
    expect(extended).toMatchObject({ ok: true, offer_version: 2 });
    await db!`UPDATE outbound_deliveries SET state='leased' WHERE message_id=${id}`;
    await db!`UPDATE outbound_deliveries SET state='submitted',submitted_at=now() WHERE message_id=${id}`;
    await db!`UPDATE outbound_deliveries SET state='delivered',delivered_at=now() WHERE message_id=${id}`;
    expect(await acceptDirectCourseBonusV1(db!, { ...f.identity, promotion_code: f.offer.promotion_code,
      promotion_cycle_id: f.offer.promotion_cycle_id, source_turn_id: await f.inbound(), expected_offer_version: 2 }))
      .toMatchObject({ ok: true, offer_version: 2 });
  });
  it('extends and accepts a delivered package with a phone-scoped permission and the global switch off', async () => {
    const f = await fixture(1, false);
    const [contact] = await db!`SELECT phone FROM contacts WHERE id=${f.identity.contact_id}`;
    vi.stubEnv('CENTRAL_CARGA_BONUS_ENABLED', 'false');
    vi.stubEnv('CENTRAL_CARGA_BONUS_CANARY_CONTACT_IDS', '');
    vi.stubEnv('CENTRAL_CARGA_BONUS_CANARY_PHONE_E164S', contact.phone);
    const id = randomUUID();
    const extended = await offerDirectCourseBonusV1(db!, { ...f.identity,
      source_turn_id: await f.inbound(), expected_offer_version: 1,
      promotion_code: f.offer.promotion_code, promotion_cycle_id: f.offer.promotion_cycle_id,
      bonus_offering_codes: [f.courses[2].code], outbound: { id, content: 'Second bonus', provider: 'test',
        integration_id: 'test', channel: 'whatsapp', destination: 'test', idempotency_key: id } });
    expect(extended).toMatchObject({ ok: true, offer_version: 2 });
    await db!`UPDATE outbound_deliveries SET state='leased' WHERE message_id=${id}`;
    await db!`UPDATE outbound_deliveries SET state='submitted',submitted_at=now() WHERE message_id=${id}`;
    await db!`UPDATE outbound_deliveries SET state='delivered',delivered_at=now() WHERE message_id=${id}`;
    expect(await acceptDirectCourseBonusV1(db!, { ...f.identity, promotion_code: f.offer.promotion_code,
      promotion_cycle_id: f.offer.promotion_cycle_id, source_turn_id: await f.inbound(), expected_offer_version: 2 }))
      .toMatchObject({ ok: true, offer_version: 2 });
  });
  it.each(['persisted_selection','combined_return'] as const)('commits exact accepted checkout after review rollback (%s)',async scenario=>{
    vi.stubEnv('PAYMENT_LINK_CONTADO','https://buy.stripe.com/test_bonus');
    const f=await seedConversationForAgentTurn({selected_offering_code:'entrenamiento_funcional',intake_complete:true});
    const [prior]=await db!`INSERT INTO messages(conversation_id,contact_id,direction,content,created_at)
      VALUES (${f.conversation_id},${f.contact_id},'inbound','Expensive',now()-interval '1 hour') RETURNING id`;
    await db!`INSERT INTO selected_memories(contact_id,conversation_id,source_message_id,status,memory_type,memory_key,value_normalized,source_quote,confidence,dedupe_hash)
      VALUES (${f.contact_id},${f.conversation_id},${prior.id},'active','objection','price_objection','expensive','Expensive',0.9,${'a'.repeat(64)})`;
    await seedPriorModelNegotiation(db!,f);
    const id=randomUUID();const identity={workspace_id:f.workspace_id,contact_id:f.contact_id,conversation_id:f.conversation_id,paid_offering_code:'entrenamiento_funcional'};
    const offer=await offerDirectCourseBonusV1(db!,{...identity,source_turn_id:f.turn_id,expected_offer_version:0,bonus_offering_codes:['nutricion_alimentacion'],
      outbound:{id,content:'Bonus',provider:'test',integration_id:'test',channel:'whatsapp',destination:'test',idempotency_key:id}});
    if(!offer.ok) throw new Error(offer.reason);
    await db!`UPDATE outbound_deliveries SET state='leased' WHERE message_id=${id}`;
    await db!`UPDATE outbound_deliveries SET state='submitted',submitted_at=now() WHERE message_id=${id}`;
    await db!`UPDATE outbound_deliveries SET state='delivered',delivered_at=now() WHERE message_id=${id}`;
    await db!`UPDATE messages SET created_at=clock_timestamp(),metadata=metadata-'occurred_at_trusted' WHERE id=${f.second_turn_id}`;
    expect(await acceptDirectCourseBonusV1(db!,{...identity,...offer,source_turn_id:f.second_turn_id,expected_offer_version:1})).toMatchObject({ok:true});
    await db!`UPDATE conversation_sales_context_states_v1 SET selected_payment_plan='one_time',awaiting_reply='payment_confirmation'
      WHERE workspace_id=${f.workspace_id} AND conversation_id=${f.conversation_id}`;
    const [contact]=await db!`SELECT phone FROM contacts WHERE id=${f.contact_id}`;
    async function next(text:string) {
      return processInboundMessage({schema_version:1,source:'botpress',channel:'whatsapp',integration_id:'vitest-agent-turn-fixture',
        external_message_id:randomUUID(),external_conversation_id:`agent-turn-fixture-${f.trace_id}`,
        external_user_id:`agent-turn-fixture-user-${f.trace_id}`,phone_e164:contact.phone,trace_id:randomUUID(),identity_owner:'agent_a_v1',
        message:{type:'text',text,occurred_at:new Date().toISOString(),reply_to_external_message_id:null}});
    }
    if(scenario==='combined_return') {
      const away=await next('Quiero Inglés 1');
      expect((await commitAgentDecision({turn_id:away.turn_id,trace_id:randomUUID(),supports_multi_outbound:true,
        authorized_offering_code:'ingles_1',authorized_payment_plan:null,
        agent_turn_v2:{schema_version:2,proposal:{...f.proposalWithCallOfferAndFalsePrice,
          move:{schema_version:1,move:'select_course',secondary_moves:[],vetoes:[],confidence:1,course_reference:'Inglés 1'},
          proposed_action:{type:'none'},response:{messages:['Seguimos con Inglés 1.'],call_offer:null}} as never},
        decision:f.placeholderDecision as never,model:f.model as never})).status).toBe('committed');
    }
    const checkoutTurnId=scenario==='combined_return'
      ? (await next('Quiero Entrenamiento Funcional en un pago. Pasame el link de pago')).turn_id : f.second_turn_id;
    const [beforeCheckout]=await db!`SELECT version FROM conversation_sales_context_states_v1 WHERE conversation_id=${f.conversation_id}`;
    vi.stubEnv('COURSE_BONUS_FLOW_MODE','review');
    const result=await commitAgentDecision({turn_id:checkoutTurnId,trace_id:f.trace_id,supports_multi_outbound:true,
      authorized_offering_code:'entrenamiento_funcional',authorized_payment_plan:'one_time',
      agent_turn_v2:{schema_version:2,proposal:{...f.proposalWithCallOfferAndFalsePrice,
        move:{schema_version:1,move:'request_payment_link',secondary_moves:scenario==='combined_return'?['select_course','select_payment_plan']:[],
          vetoes:[],confidence:1,course_reference:scenario==='combined_return'?'Entrenamiento Funcional':null,payment_plan:'one_time'},
        proposed_action:{type:'send_payment_link',offering_code:'entrenamiento_funcional',payment_plan:'one_time',promotion_code:offer.promotion_code},
        response:{messages:['Te comparto el enlace para pagar.'],call_offer:null}} as never},decision:f.placeholderDecision as never,model:f.model as never});
    expect(result.status).toBe('committed');
    const [payment]=await db!`SELECT id,promotion_offer_id,promotion_cycle_id,accepted_offer_version,checkout_url FROM payments WHERE idempotency_key=${`agent-a-payment-link:${checkoutTurnId}`}`;
    expect(payment).toMatchObject({promotion_cycle_id:offer.promotion_cycle_id,accepted_offer_version:1});
    expect(payment.promotion_offer_id).toBe(offer.offer_id);
    expect(await db!`SELECT promotion_code_snapshot,offering_code_snapshot,position FROM payment_bonus_offerings WHERE payment_id=${payment.id}`)
      .toEqual([{promotion_code_snapshot:offer.promotion_code,offering_code_snapshot:'nutricion_alimentacion',position:1}]);
    const [afterCheckout]=await db!`SELECT version,selected_offering_code FROM conversation_sales_context_states_v1 WHERE conversation_id=${f.conversation_id}`;
    expect(afterCheckout.selected_offering_code).toBe('entrenamiento_funcional');
    expect(Number(afterCheckout.version)).toBe(Number(beforeCheckout.version)+1);
    expect(result.outbounds[0].content).toContain(payment.checkout_url);
    async function select(code:string,reference:string) {
      const turn=await next(`Quiero ${reference}`);
      return commitAgentDecision({turn_id:turn.turn_id,trace_id:randomUUID(),supports_multi_outbound:true,
        authorized_offering_code:code,authorized_payment_plan:null,
        agent_turn_v2:{schema_version:2,proposal:{...f.proposalWithCallOfferAndFalsePrice,
          // Authority: changing the paid course cancels the prior promotion;
          // a call request about a course must not masquerade as that change.
          move:{schema_version:1,move:'select_course',secondary_moves:[],vetoes:[],confidence:1,course_reference:reference},
          proposed_action:{type:'none'},response:{messages:[`Seguimos con ${reference}.`],call_offer:null}} as never},
        decision:f.placeholderDecision as never,model:f.model as never});
    }
    expect((await select('ingles_1','Inglés 1')).status).toBe('committed');
    expect(await db!`SELECT id FROM payment_intent_supersessions WHERE payment_id=${payment.id}`).toHaveLength(1);
    const stripe=new Stripe('sk_test_never_network');const secret='whsec_request_call';
    const payload=JSON.stringify({id:`evt_${randomUUID()}`,object:'event',livemode:false,type:'checkout.session.completed',created:Math.floor(Date.now()/1000),
      data:{object:{id:`cs_test_${randomUUID()}`,object:'checkout.session',client_reference_id:payment.id,mode:'payment',
        payment_status:'paid',amount_total:36000,currency:'usd',metadata:{}}}});
    expect(await processStripeWebhook(payload,stripe.webhooks.generateTestHeaderString({payload,secret}),
      {db:db!,stripe,webhookSecret:secret,expectedEnvironment:'test'})).toMatchObject({body:{reconciliation_required:true}});
    expect(await db!`SELECT id FROM fulfillment_jobs WHERE payment_id=${payment.id}`).toEqual([]);
    async function combinedCheckout(code:string,reference:string) {
      const turn=await next(`Quiero ${reference} en un pago. Pasame el link de pago`);
      return commitAgentDecision({turn_id:turn.turn_id,trace_id:randomUUID(),supports_multi_outbound:true,
        authorized_offering_code:code,authorized_payment_plan:'one_time',
        agent_turn_v2:{schema_version:2,proposal:{...f.proposalWithCallOfferAndFalsePrice,
          move:{schema_version:1,move:'select_course',secondary_moves:['select_payment_plan','request_payment_link'],vetoes:[],
            confidence:1,course_reference:reference,payment_plan:'one_time'},
          proposed_action:{type:'send_payment_link',offering_code:code,payment_plan:'one_time'},
          response:{messages:['Te comparto el enlace para pagar.'],call_offer:null}} as never},
        decision:f.placeholderDecision as never,model:f.model as never});
    }
    await expect(combinedCheckout('entrenamiento_funcional','Entrenamiento Funcional'))
      .rejects.toMatchObject({reason:'AGENT_TURN_V2_REJECTED:ACTION_NOT_AUTHORIZED'});
    expect(await db!`SELECT id FROM payments WHERE source_conversation_id=${f.conversation_id}`).toHaveLength(1);
    expect((await select('entrenamiento_funcional','Entrenamiento Funcional')).status).toBe('committed');
    const retry=await next('Pasame el link de pago');
    const returned=await readCourseBonusCapabilityV1({workspace_slug:'studyx',contact_id:f.contact_id,conversation_id:f.conversation_id,
      channel:'text',selected_offering_code:'entrenamiento_funcional',source_turn_id:retry.turn_id},{db:db!});
    expect(returned).toMatchObject({package_status:'attached',promotion_cycle_id:offer.promotion_cycle_id,may_send_promoted_payment:false});
    await expect(commitAgentDecision({turn_id:retry.turn_id,trace_id:randomUUID(),supports_multi_outbound:true,
      authorized_offering_code:'entrenamiento_funcional',authorized_payment_plan:'one_time',
      agent_turn_v2:{schema_version:2,proposal:{...f.proposalWithCallOfferAndFalsePrice,
        move:{schema_version:1,move:'request_payment_link',secondary_moves:['select_payment_plan'],vetoes:[],confidence:1,payment_plan:'one_time'},
        proposed_action:{type:'send_payment_link',offering_code:'entrenamiento_funcional',payment_plan:'one_time'},
        response:{messages:['Te comparto el enlace para pagar.'],call_offer:null}} as never},decision:f.placeholderDecision as never,model:f.model as never}))
      .rejects.toMatchObject({reason:'AGENT_TURN_V2_REJECTED:ACTION_NOT_AUTHORIZED'});
    expect(await db!`SELECT id FROM payments WHERE source_conversation_id=${f.conversation_id}`).toHaveLength(1);
    expect((await db!`SELECT status,promotion_cycle_id FROM promotion_offers WHERE id=${offer.offer_id}`)[0])
      .toEqual({status:'attached',promotion_cycle_id:offer.promotion_cycle_id});
    expect((await combinedCheckout('ingles_1','Inglés 1')).status).toBe('committed');
    expect(await db!`SELECT id FROM payments WHERE source_conversation_id=${f.conversation_id}`).toHaveLength(2);
  });
  it('projects an accepted obligation in review rollback without authorizing offers or acceptance',async()=>{
    const f=await fixture(2);vi.stubEnv('COURSE_BONUS_FLOW_MODE','review');
    const [workspace]=await db!`SELECT slug FROM workspaces WHERE id=${f.identity.workspace_id}`;
    const cap=await readCourseBonusCapabilityV1({workspace_slug:workspace.slug,contact_id:f.identity.contact_id,
      conversation_id:f.identity.conversation_id,channel:'text',selected_offering_code:f.identity.paid_offering_code,
      source_turn_id:await f.inbound()},{db:db!});
    expect(cap).toMatchObject({enabled:false,may_offer_bonus:false,may_accept_offer:false,may_send_promoted_payment:true,
      status:'accepted',package_status:'accepted',promotion_cycle_id:f.offer.promotion_cycle_id,offer_version:2});
    await expect(reservePaymentLink(db!,{...f.input,promotion_code:cap.promotion_code!,
      promotion_cycle_id:cap.promotion_cycle_id!,accepted_offer_version:cap.offer_version})).resolves.toMatchObject({status:'reserved'});
  });
  it('requires complete direct package DB identity and keeps the stored identity immutable',async()=>{
    const f=await fixture();const payment=await reservePaymentLink(db!,f.input);
    await expect(db!`UPDATE payments SET accepted_offer_version=2 WHERE id=${payment.payment_id}`).rejects.toThrow(/immutable/i);
    await expect(db!.begin(async tx=>{
      await tx`UPDATE payments SET source_conversation_id=NULL WHERE id=${payment.payment_id}`;
      throw new Error('UNEXPECTED_IDENTITY_MUTATION');
    })).rejects.toThrow(/immutable/i);
    await expect(db!`INSERT INTO payments(workspace_id,contact_id,offering_id,amount,currency,status,provider,environment,checkout_mode,idempotency_key,promotion_offer_id,promotion_cycle_id,accepted_offer_version)
      VALUES (${f.identity.workspace_id},${f.identity.contact_id},${f.courses[0].id},360,'USD','reserved','stripe','test','payment',${randomUUID()},${f.offer.offer_id},${f.offer.promotion_cycle_id},NULL)`)
      .rejects.toThrow();
  });
  it.each(['root','serialized','stale','workspace','contact','conversation','source','offering'] as const)
  ('refuses an invalid internal selection proof (%s) without attaching the accepted obligation',async kind=>{
    const f=await fixture();await f.change();const other=await fixture();
    const [state]=await db!`SELECT version FROM conversation_sales_context_states_v1 WHERE conversation_id=${f.identity.conversation_id}`;
    const details={workspace_id:f.identity.workspace_id,contact_id:f.identity.contact_id,conversation_id:f.identity.conversation_id,
      source_turn_id:await f.inbound(),expected_state_version:Number(state.version),previous_offering_code:f.courses[4].code as string,
      selected_offering_code:f.identity.paid_offering_code};
    const proof=createValidatedPaymentLinkCourseSelectionV1({...details,
      ...(kind==='stale'?{expected_state_version:Number(state.version)+1}:kind==='workspace'?{workspace_id:other.identity.workspace_id}
        :kind==='contact'?{contact_id:other.identity.contact_id}:kind==='conversation'?{conversation_id:other.identity.conversation_id}
        :kind==='source'?{source_turn_id:await other.inbound()}:kind==='offering'?{selected_offering_code:f.courses[1].code as string}:{})});
    expect(()=>JSON.stringify(proof)).toThrow(/not serializable/i);
    const input={...f.input,validated_course_selection:kind==='serialized'
      ? JSON.parse(JSON.stringify(details)) as typeof proof : proof};
    if(kind==='root') await expect(reservePaymentLink(db!,input)).rejects.toMatchObject({code:'PROMOTION_NOT_AUTHORIZED'});
    else await expect(db!.begin(tx=>reservePaymentLink(tx,input))).rejects.toMatchObject({code:'PROMOTION_NOT_AUTHORIZED'});
    expect(await db!`SELECT id FROM payments WHERE idempotency_key=${f.input.idempotency_key}`).toEqual([]);
    expect((await db!`SELECT status,payment_id FROM promotion_offers WHERE id=${f.offer.offer_id}`)[0]).toEqual({status:'accepted',payment_id:null});
  });
  it.each([1,2,3])('copies %i accepted gifts and preserves replay under review rollback',async count=>{
    const f=await fixture(count);vi.stubEnv('COURSE_BONUS_FLOW_MODE','review');
    const payment=await reservePaymentLink(db!,f.input);
    await db!`UPDATE offerings SET display_name='Changed',status='inactive' WHERE workspace_id=${f.identity.workspace_id}`;
    expect(await reservePaymentLink(db!,f.input)).toEqual(payment);
    expect(await db!`SELECT offering_display_name_snapshot,position FROM payment_bonus_offerings WHERE payment_id=${payment.payment_id} ORDER BY position`)
      .toEqual(Array.from({length:count},(_,n)=>({offering_display_name_snapshot:`Course ${n+1}`,position:n+1})));
    expect((await db!`SELECT amount::text AS amount,currency FROM payments WHERE id=${payment.payment_id}`)[0]).toEqual({amount:'360.00',currency:'USD'});
  });
  it.each(['version','cycle','missing','course','partial','malformed_cycle'] as const)('rejects %s mismatch before creating a payment',async kind=>{
    const f=await fixture();
    const input={...f.input,...(kind==='version'?{accepted_offer_version:2}:kind==='cycle'?{promotion_cycle_id:randomUUID()}:kind==='missing'?{promotion_cycle_id:undefined,accepted_offer_version:undefined}:kind==='partial'?{promotion_code:undefined}:kind==='malformed_cycle'?{promotion_cycle_id:'malformed'}:{offering_id:f.courses[4].id as string})};
    await expect(reservePaymentLink(db!,input)).rejects.toMatchObject({code:'PROMOTION_NOT_AUTHORIZED'});
    expect(await db!`SELECT id FROM payments WHERE idempotency_key=${input.idempotency_key}`).toEqual([]);
  });
  it.each([0,4,2147483648])('rejects unsupported version %i without SQL or a payment',async version=>{
    const f=await fixture();
    await expect(reservePaymentLink(db!,{...f.input,accepted_offer_version:version}))
      .rejects.toMatchObject({code:'PROMOTION_NOT_AUTHORIZED'});
    expect(await db!`SELECT id FROM payments WHERE idempotency_key=${f.input.idempotency_key}`).toEqual([]);
  });
  it('denies inherited public client privileges and restricts the application to SELECT/INSERT',async()=>{
    const roles=await db!`SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role','orchestrator_role')`;
    for(const {rolname} of roles) for(const table of ['payment_intent_supersessions','payment_reconciliation_cases','bonus_fulfillment_cases']) {
      const [acl]=await db!`SELECT has_table_privilege(${rolname},${'public.'+table},'SELECT') AS read,
        has_table_privilege(${rolname},${'public.'+table},'INSERT') AS append,
        has_table_privilege(${rolname},${'public.'+table},'UPDATE') AS change,
        has_table_privilege(${rolname},${'public.'+table},'DELETE') AS remove,
        has_table_privilege(${rolname},${'public.'+table},'TRUNCATE') AS truncate`;
      expect(acl).toEqual({read:rolname==='orchestrator_role',append:rolname==='orchestrator_role',change:false,remove:false,truncate:false});
    }
    expect(await db!`SELECT privilege_type FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a
      WHERE c.oid IN ('public.payment_intent_supersessions'::regclass,'public.payment_reconciliation_cases'::regclass,'public.bonus_fulfillment_cases'::regclass) AND a.grantee=0`).toEqual([]);
  });
  it.each(['anon','authenticated','service_role'])('denies direct reads and writes to %s independently from RLS',async role=>{
    for(const table of ['payment_intent_supersessions','payment_reconciliation_cases','bonus_fulfillment_cases']) {
      for(const command of [`SELECT id FROM ${table}`,`INSERT INTO ${table} DEFAULT VALUES`,
        `UPDATE ${table} SET id=id WHERE false`,`DELETE FROM ${table} WHERE false`]) {
        await expect(db!.begin(async tx=>{
          // Both role and commands are fixed test-owned allowlisted literals.
          await tx.unsafe(`SET LOCAL ROLE ${role}`);
          await tx.unsafe(command);
        })).rejects.toMatchObject({code:'42501'});
      }
    }
  });
  it.each(['direct','review'])('keeps superseded history but no checkout capability in %s mode',async mode=>{
    const f=await fixture();await reservePaymentLink(db!,f.input);await f.change();
    await db!`UPDATE conversation_sales_context_states_v1 SET selected_offering_code=${f.identity.paid_offering_code}
      WHERE conversation_id=${f.identity.conversation_id}`;
    const [workspace]=await db!`SELECT slug FROM workspaces WHERE id=${f.identity.workspace_id}`;
    vi.stubEnv('COURSE_BONUS_FLOW_MODE',mode);
    expect(await readCourseBonusCapabilityV1({workspace_slug:workspace.slug,contact_id:f.identity.contact_id,
      conversation_id:f.identity.conversation_id,selected_offering_code:f.identity.paid_offering_code,channel:'text',source_turn_id:await f.inbound()},{db:db!}))
      .toMatchObject({package_status:'attached',promotion_cycle_id:f.offer.promotion_cycle_id,offer_version:1,
        bonus_offerings:[{code:f.courses[1].code}],may_send_promoted_payment:false});
  });
  it('rejects mismatched replay versions and returns one reference for concurrent identical requests',async()=>{
    const f=await fixture();const clients=openIndependentLocalTestDatabases(2);
    try {
      const [a,b]=await Promise.all(clients.map(client=>reservePaymentLink(client,f.input)));
      expect(a).toEqual(b);
      await expect(reservePaymentLink(db!,{...f.input,accepted_offer_version:2})).rejects.toMatchObject({code:'IDEMPOTENCY_KEY_CONFLICT'});
    } finally {await Promise.all(clients.map(client=>client.end()));}
  });
  it('cancels an open cycle before acceptance but preserves accepted obligations after course change',async()=>{
    const open=await fixture(1,false);await open.change();
    expect((await db!`SELECT status FROM promotion_offers WHERE id=${open.offer.offer_id}`)[0].status).toBe('cancelled');
    const f=await fixture();await f.change();
    expect((await db!`SELECT status FROM promotion_offers WHERE id=${f.offer.offer_id}`)[0].status).toBe('accepted');
    expect(await db!`SELECT payload FROM audit_log WHERE entity_id=${f.offer.offer_id} AND action='promotion.path.superseded'`)
      .toEqual([{payload:expect.objectContaining({promotion_cycle_id:f.offer.promotion_cycle_id,offer_version:1,replacement_offering_code:f.courses[4].code})}]);
    await expect(reservePaymentLink(db!,f.input)).rejects.toMatchObject({code:'PROMOTION_NOT_AUTHORIZED'});
  });
  it('supersedes the unpaid intent without mutating the package and reconciles a late paid event once',async()=>{
    const f=await fixture(2);const old=await reservePaymentLink(db!,f.input);
    const source=await f.change();await f.change();
    expect(await reservePaymentLink(db!,f.input)).toEqual(old);
    const [supersession]=await db!`SELECT id,source_turn_id,original_offering_id,replacement_offering_id FROM payment_intent_supersessions WHERE payment_id=${old.payment_id}`;
    expect(supersession).toMatchObject({source_turn_id:source,original_offering_id:f.courses[0].id,replacement_offering_id:f.courses[4].id});
    const fresh=await reservePaymentLink(db!,{...f.input,idempotency_key:randomUUID(),offering_id:f.courses[4].id,
      promotion_code:undefined,promotion_cycle_id:undefined,accepted_offer_version:undefined});
    expect(fresh.payment_id).not.toBe(old.payment_id);
    expect((await db!`SELECT status,payment_id FROM promotion_offers WHERE id=${f.offer.offer_id}`)[0]).toEqual({status:'attached',payment_id:old.payment_id});
    await recordPaymentEvent(db!,{payment_id:old.payment_id,provider:'internal',provider_event_id:randomUUID(),event:{type:'checkout_creation_started'},payload:{}});
    await recordPaymentEvent(db!,{payment_id:old.payment_id,provider:'internal',provider_event_id:randomUUID(),event:{type:'checkout_created'},payload:{}});
    const paid={payment_id:old.payment_id,provider:'stripe',provider_event_id:randomUUID(),event:{type:'checkout_completed_paid' as const},payload:{signed_evidence:'old reference'}};
    const clients=openIndependentLocalTestDatabases(2);
    try {
      const results=await Promise.all(clients.map(client=>recordPaymentEvent(client,paid)));
      expect(results.map(result=>result.outcome).sort()).toEqual(['applied','duplicate']);
      for(const result of results) expect(result).toMatchObject({status:'paid',reconciliation_required:true});
    } finally {await Promise.all(clients.map(client=>client.end()));}
    expect(await recordPaymentEvent(db!,paid)).toMatchObject({outcome:'duplicate',status:'paid',reconciliation_required:true});
    expect(await db!`SELECT id FROM fulfillment_jobs WHERE payment_id IN (${old.payment_id},${fresh.payment_id})`).toEqual([]);
    const cases=await db!`SELECT c.status,c.case_type,e.provider_event_id FROM payment_reconciliation_cases c JOIN payment_events e ON e.id=c.payment_event_id WHERE c.payment_id=${old.payment_id}`;
    expect(cases).toEqual([{status:'open',case_type:'SUPERSEDED_PAYMENT_PAID',provider_event_id:paid.provider_event_id}]);
    expect((await db!`SELECT offering_id,status FROM payments WHERE id=${old.payment_id}`)[0]).toEqual({offering_id:f.courses[0].id,status:'paid'});
  });
  it('refuses a new ordinary reservation for the superseded attached paid course without a promotion code',async()=>{
    const f=await fixture();const old=await reservePaymentLink(db!,f.input);await f.change();
    await expect(reservePaymentLink(db!,{...f.input,idempotency_key:randomUUID(),promotion_code:undefined,
      promotion_cycle_id:undefined,accepted_offer_version:undefined})).rejects.toMatchObject({code:'PROMOTION_NOT_AUTHORIZED'});
    expect((await db!`SELECT payment_id FROM promotion_offers WHERE id=${f.offer.offer_id}`)[0].payment_id).toBe(old.payment_id);
    expect(await db!`SELECT id FROM payments WHERE source_conversation_id=${f.identity.conversation_id}`).toHaveLength(1);
  });
  it('requires correlated course-change evidence and grants the production role append-only access',async()=>{
    const f=await fixture();const old=await reservePaymentLink(db!,f.input);
    await expect(cancelOpenCourseBonusOffersForCourseChangeV1(db!,{...f.identity,selected_offering_code:f.courses[4].code}))
      .rejects.toThrow('COURSE_CHANGE_SOURCE_TURN_REQUIRED');
    const turn=await f.inbound();
    await db!.begin(async tx=>{
      await tx`SET LOCAL ROLE orchestrator_role`;
      await cancelOpenCourseBonusOffersForCourseChangeV1(tx,{...f.identity,selected_offering_code:f.courses[4].code,source_turn_id:turn});
      expect(await tx`SELECT payment_id FROM payment_intent_supersessions WHERE payment_id=${old.payment_id}`).toHaveLength(1);
    });
    await expect(db!`UPDATE payment_intent_supersessions SET reason='COURSE_CHANGED' WHERE payment_id=${old.payment_id}`).rejects.toThrow(/append.only/i);
    await expect(db!.begin(async tx=>{await tx`SET LOCAL ROLE orchestrator_role`;await tx`DELETE FROM payment_intent_supersessions WHERE payment_id=${old.payment_id}`;})).rejects.toThrow(/permission denied/i);
  });
  it('records signed late payment evidence, withholds projections and deduplicates concurrent paid callbacks',async()=>{
    const f=await fixture();const old=await reservePaymentLink(db!,f.input);await f.change();
    const stripe=new Stripe('sk_test_never_network');const secret='whsec_direct_bonus';
    const eventId=`evt_${randomUUID()}`;
    const payload=JSON.stringify({id:eventId,object:'event',livemode:false,type:'checkout.session.completed',created:Math.floor(Date.now()/1000),
      data:{object:{id:`cs_test_${randomUUID()}`,object:'checkout.session',client_reference_id:old.payment_id,mode:'payment',
        payment_status:'paid',amount_total:36000,currency:'usd',metadata:{}}}});
    const signature=stripe.webhooks.generateTestHeaderString({payload,secret});
    const first=await processStripeWebhook(payload,signature,{db:db!,stripe,webhookSecret:secret,expectedEnvironment:'test'});
    expect(first).toMatchObject({status:200,body:{status:'paid',reconciliation_required:true}});
    expect(first.verifiedPaymentId).toBeUndefined();
    const clients=openIndependentLocalTestDatabases(2);
    try {
      const results=await Promise.all(clients.map(client=>processStripeWebhook(payload,signature,{db:client,stripe,webhookSecret:secret,expectedEnvironment:'test'})));
      for(const result of results) expect(result).toMatchObject({body:{outcome:'duplicate',reconciliation_required:true}});
    } finally {await Promise.all(clients.map(client=>client.end()));}
    expect(await db!`SELECT id FROM payment_reconciliation_cases WHERE payment_id=${old.payment_id}`).toHaveLength(1);
    expect(await db!`SELECT id FROM fulfillment_jobs WHERE payment_id=${old.payment_id}`).toEqual([]);
    expect(await db!`SELECT id FROM payment_events WHERE payment_id=${old.payment_id} AND provider_event_id=${eventId}`).toHaveLength(1);
  });
  it.each(['failed','expired','refunded'] as const)('opens one manual case for signed late paid evidence after %s without regressing the terminal ledger',async terminal=>{
    const f=await fixture();const old=await reservePaymentLink(db!,f.input);await f.change();
    // Historical terminal ledger fixture: use real SQL transitions without the
    // application event handler, so refunded starts with no pre-existing case.
    await db!`UPDATE payments SET status='creating_checkout' WHERE id=${old.payment_id}`;
    await db!`UPDATE payments SET status='pending',provider_session_id=${`cs_test_${old.payment_id}`} WHERE id=${old.payment_id}`;
    if(terminal==='refunded') await db!`UPDATE payments SET status='paid',paid_at=now() WHERE id=${old.payment_id}`;
    await db!`UPDATE payments SET status=${terminal} WHERE id=${old.payment_id}`;
    const stripe=new Stripe('sk_test_never_network');const secret='whsec_terminal_bonus';const eventId=`evt_${randomUUID()}`;
    const payload=JSON.stringify({id:eventId,object:'event',livemode:false,type:'checkout.session.completed',created:Math.floor(Date.now()/1000),
      data:{object:{id:`cs_test_${old.payment_id}`,object:'checkout.session',client_reference_id:old.payment_id,mode:'payment',
        payment_status:'paid',amount_total:36000,currency:'usd',metadata:{}}}});
    const signature=stripe.webhooks.generateTestHeaderString({payload,secret});
    const clients=openIndependentLocalTestDatabases(2);
    try {
      const results=await Promise.all(clients.map(client=>processStripeWebhook(payload,signature,{db:client,stripe,webhookSecret:secret,expectedEnvironment:'test'})));
      expect(results.map(result=>result.body.outcome).sort()).toEqual(['duplicate','ignored']);
      for(const result of results) {
        expect(result.body).toMatchObject({status:terminal,reconciliation_required:true});
        expect(result.verifiedPaymentId).toBeUndefined();
      }
    } finally {await Promise.all(clients.map(client=>client.end()));}
    const [evidence]=await db!`SELECT c.status,e.provider_event_id FROM payment_reconciliation_cases c JOIN payment_events e ON e.id=c.payment_event_id WHERE c.payment_id=${old.payment_id}`;
    expect(evidence).toEqual({status:'open',provider_event_id:eventId});
    expect((await db!`SELECT status FROM payments WHERE id=${old.payment_id}`)[0].status).toBe(terminal);
    expect(await db!`SELECT id FROM fulfillment_jobs WHERE payment_id=${old.payment_id}`).toEqual([]);
  });
});
