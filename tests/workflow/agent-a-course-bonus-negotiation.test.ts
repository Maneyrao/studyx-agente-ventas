import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { openLocalTestDatabase } from '../helpers/db';
import {
  claimCommercialFollowupV1,
  commitCommercialActionV1,
  deliverCommercialFollowupV1,
} from '@/features/promotions/application/commercial-followup-service';
import { readCourseBonusCapabilityV1 } from '@/features/promotions/application/read-course-bonus-capability';
import { reservePaymentLink } from '@/features/payments/application/reserve-payment-link';
import { runEnrollmentWorker } from '@/features/fulfillment/central-carga/worker';
import { assemblePostSaleMessage } from '@/features/fulfillment/post-sale/service';

const run = process.env.TEST_DATABASE_URL ? it : it.skip;
const db = process.env.TEST_DATABASE_URL ? openLocalTestDatabase() : null;
const priorBonusFlag = process.env.CENTRAL_CARGA_BONUS_ENABLED;

beforeAll(() => { process.env.CENTRAL_CARGA_BONUS_ENABLED = 'true'; });
afterAll(async () => {
  if (priorBonusFlag === undefined) delete process.env.CENTRAL_CARGA_BONUS_ENABLED;
  else process.env.CENTRAL_CARGA_BONUS_ENABLED = priorBonusFlag;
  await db?.end();
});

run('carries one authorized price-objection bonus through payment, Central v2 and verified post-sale', async () => {
  const suffix = randomUUID();
  const botpressId = `workflow-bonus-${suffix}`;
  const [workspace] = await db!`INSERT INTO workspaces(slug,display_name)
    VALUES (${`workflow-bonus-${suffix}`},'Studyx') RETURNING id,slug`;
  const [contact] = await db!`INSERT INTO contacts(phone,status,channel_origin,name,email)
    VALUES (${`+54911${Math.floor(10000000+Math.random()*89999999)}`},'prospecto','whatsapp','Ana Prueba','ana@example.test')
    RETURNING id`;
  await db!`INSERT INTO contact_channel_permissions(contact_id,channel,consent_status)
    VALUES (${contact.id},'whatsapp','unknown')`;
  await db!`INSERT INTO workspace_contacts(workspace_id,contact_id,source_channel)
    VALUES (${workspace.id},${contact.id},'whatsapp')`;
  const [thread] = await db!`INSERT INTO channel_threads(contact_id,provider,integration_id,channel,external_conversation_id,metadata)
    VALUES (${contact.id},'botpress','whatsapp','whatsapp',${botpressId},${db!.json({botpress_conversation_id:botpressId})})
    RETURNING id`;
  const [conversation] = await db!`INSERT INTO conversations(contact_id,channel,workspace_id,channel_thread_id)
    VALUES (${contact.id},'whatsapp',${workspace.id},${thread.id}) RETURNING id`;
  const offerings = await db!`INSERT INTO offerings(workspace_id,code,display_name,offering_type,status,description,
      price_type,price_amount,currency,billing_interval)
    VALUES (${workspace.id},${`ingles_1_${suffix.slice(0,8)}`},'Inglés 1','course','active','Nivel inicial','fixed',360,'USD','annual'),
      (${workspace.id},${`ingles_2_${suffix.slice(0,8)}`},'Inglés 2','course','active','Continuación','free',NULL,NULL,NULL)
    RETURNING id,code,display_name`;
  const [paid, bonus] = offerings;
  const [promotion] = await db!`INSERT INTO promotions(workspace_id,promotion_code,paid_offering_id,channels,active)
    VALUES (${workspace.id},${`ingles_combo_${suffix.slice(0,8)}`},${paid.id},ARRAY['text','voice']::text[],true)
    RETURNING id,promotion_code`;
  await db!`INSERT INTO promotion_bonus_offerings(promotion_id,workspace_id,offering_id,position)
    VALUES (${promotion.id},${workspace.id},${bonus.id},1)`;
  const [inbound] = await db!`INSERT INTO messages(conversation_id,contact_id,direction,content)
    VALUES (${conversation.id},${contact.id},'inbound','Me sigue pareciendo caro') RETURNING id`;
  const [outbound] = await db!`INSERT INTO messages(conversation_id,contact_id,direction,content,in_reply_to)
    VALUES (${conversation.id},${contact.id},'outbound','Dame un momento y reviso qué alternativa puedo habilitarte.',${inbound.id})
    RETURNING id`;
  await db!`INSERT INTO conversation_sales_context_states_v1(workspace_id,conversation_id,contact_id,
      selected_offering_code,source_turn_id)
    VALUES (${workspace.id},${conversation.id},${contact.id},${paid.code},${inbound.id})`;

  await commitCommercialActionV1(db!,{workspace_id:workspace.id,contact_id:contact.id,
    conversation_id:conversation.id,paid_offering_code:paid.code,source_turn_id:inbound.id,
    source_outbound_message_id:outbound.id,
    action:{type:'schedule_price_objection_checkin',reason:'price_objection'}});
  await expect(readCourseBonusCapabilityV1({workspace_slug:workspace.slug,contact_id:contact.id,
    conversation_id:conversation.id,channel:'text',selected_offering_code:paid.code},{db:db!})).resolves.toMatchObject({
      status:'review_available',may_request_review:true,bonus_offerings:[],
    });
  const review = await commitCommercialActionV1(db!,{workspace_id:workspace.id,contact_id:contact.id,
    conversation_id:conversation.id,paid_offering_code:paid.code,source_turn_id:inbound.id,
    source_outbound_message_id:outbound.id,action:{type:'request_promotion_review',reason:'persistent_price_objection'}});
  await db!`UPDATE course_bonus_followups SET due_at=now()-interval '1 second' WHERE id=${review.followup!.id}`;
  const claim = await claimCommercialFollowupV1(review.followup!.id,botpressId,`event-${suffix}`,{db:db!});
  if(!claim.claimed) throw new Error('promotion review claim failed');
  expect(await deliverCommercialFollowupV1(review.followup!.id,{claim_token:claim.claim_token,
    botpress_conversation_id:botpressId,narrative:{message:'Pude habilitarte Inglés 2 junto con Inglés 1, sin cambiar el precio de Inglés 1.'}},
    {db:db!,sender:async()=>({outcome:'sent' as const,channel:'whatsapp' as const,providerMessageId:`wamid.${suffix}`,
      deliveryId:null,reason:null})})).toEqual({outcome:'sent'});
  await commitCommercialActionV1(db!,{workspace_id:workspace.id,contact_id:contact.id,
    conversation_id:conversation.id,paid_offering_code:paid.code,source_turn_id:inbound.id,
    source_outbound_message_id:outbound.id,action:{type:'accept_promotion'}});

  const reservation = await reservePaymentLink(db!,{workspace_id:workspace.id,contact_id:contact.id,
    offering_id:paid.id,conversation_id:conversation.id,plan_code:'monthly_12',
    idempotency_key:`workflow-bonus:${suffix}`,payment_link_url:'https://buy.stripe.com/test_workflow_bonus',
    promotion_code:promotion.promotion_code});
  await db!`UPDATE payments SET status='creating_checkout' WHERE id=${reservation.payment_id}`;
  await db!`UPDATE payments SET status='pending',provider_session_id=${`cs_test_${suffix}`} WHERE id=${reservation.payment_id}`;
  await db!`UPDATE payments SET status='paid',paid_at=now() WHERE id=${reservation.payment_id}`;
  await db!`INSERT INTO fulfillment_jobs(payment_id,workspace_id) VALUES (${reservation.payment_id},${workspace.id})`;
  const centralFetch = (async (_url:unknown,init?:RequestInit)=>{
    const request=JSON.parse(String(init?.body));
    expect(request).toMatchObject({schema_version:2,bonus_offerings:[{code:bonus.code,
      promotion_code:promotion.promotion_code}]});
    return new Response(JSON.stringify({payment_id:reservation.payment_id,enrollment_id:'enr-workflow',student_id:'stu-workflow',
      enrollment_status:'active',student_was_created:true,access:{login_email:'ana@example.test',welcome_sent:true},
      bonus_enrollments:[{offering_code:bonus.code,enrollment_status:'active'}]}),{status:201});
  }) as typeof fetch;
  expect(await runEnrollmentWorker({scoped:true,payment_id:reservation.payment_id,limit:1},{sql:db!,config:{enabled:true,
    baseUrl:'https://central.test',signingSecret:'workflow-secret-0123456789',environment:'test',
    paidAfter:new Date('2026-01-01T00:00:00Z'),allowSandboxContacts:true},fetchImpl:centralFetch,
    bonusConfig:{enabled:true,fulfillmentPaused:false}})).toMatchObject({completed:1});
  const verified = await db!<Array<{
    offering_code: string;
    enrollment_status: string;
    position: number;
  }>>`SELECT offering_code,enrollment_status,position FROM central_bonus_enrollment_items
    WHERE payment_id=${reservation.payment_id} ORDER BY position`;
  expect(verified).toEqual([{offering_code:bonus.code,enrollment_status:'active',position:1}]);
  const message = assemblePostSaleMessage({kind:'access_ready',student_was_created:true,login_email:'ana@example.test',
    login_url:null,offering_name:paid.display_name,
    bonus_offerings:[{code:bonus.code,display_name:bonus.display_name,position:1}],
    verified_bonus_enrollments:verified},{intro:'Tu acceso ya está habilitado.',suggestion:''});
  expect(message).toContain('CURSO PRINCIPAL: Inglés 1');
  expect(message).toContain('CURSO BONIFICADO: Inglés 2');
  expect(message).not.toMatch(/invoice|comprobante/iu);
}, 60_000);
