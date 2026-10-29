import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import type { AgentAContextV1 } from '../../botpress-agent/src/schemas/agent-a-brain';
import { generateDeepSeekAgentATurnProposalV1 } from '../../botpress-agent/src/lib/conversation/agent-a-brain';
import { openLocalTestDatabase } from '../helpers/db';
import {
  claimCommercialFollowupV1,
  commitCommercialActionV1,
  deliverCommercialFollowupV1,
} from '@/features/promotions/application/commercial-followup-service';
import {
  applyPromotionContextRepairPlanV1,
  derivePromotionContextRepairPlanV1,
  readCourseBonusCapabilityV1,
} from '@/features/promotions/application/read-course-bonus-capability';
import { reservePaymentLink } from '@/features/payments/application/reserve-payment-link';
import { runEnrollmentWorker } from '@/features/fulfillment/central-carga/worker';
import { assemblePostSaleMessage } from '@/features/fulfillment/post-sale/service';
import { commitAgentDecision } from '@/lib/services/decision.service';
import { authorizeAgentTurnV2 } from '@/features/conversation/domain/agent-turn-policy-v2';
import { createDefaultConversationStateV1 } from '@/features/conversation/domain/conversation-planner';
import Stripe from 'stripe';
import { processStripeWebhook } from '@/features/payments/application/process-stripe-webhook';

const run = process.env.TEST_DATABASE_URL ? it : it.skip;
const db = process.env.TEST_DATABASE_URL ? openLocalTestDatabase() : null;
const priorBonusFlag = process.env.CENTRAL_CARGA_BONUS_ENABLED;
const priorCanaryContacts = process.env.CENTRAL_CARGA_BONUS_CANARY_CONTACT_IDS;
const priorWorkspaceSlug = process.env.BUSINESS_WORKSPACE_SLUG;
const priorFlowMode = process.env.COURSE_BONUS_FLOW_MODE;

beforeAll(() => { process.env.CENTRAL_CARGA_BONUS_ENABLED = 'false'; process.env.COURSE_BONUS_FLOW_MODE = 'review'; });
afterAll(async () => {
  if (priorBonusFlag === undefined) delete process.env.CENTRAL_CARGA_BONUS_ENABLED;
  else process.env.CENTRAL_CARGA_BONUS_ENABLED = priorBonusFlag;
  if (priorCanaryContacts === undefined) delete process.env.CENTRAL_CARGA_BONUS_CANARY_CONTACT_IDS;
  else process.env.CENTRAL_CARGA_BONUS_CANARY_CONTACT_IDS = priorCanaryContacts;
  if (priorWorkspaceSlug === undefined) delete process.env.BUSINESS_WORKSPACE_SLUG;
  else process.env.BUSINESS_WORKSPACE_SLUG = priorWorkspaceSlug;
  if (priorFlowMode === undefined) delete process.env.COURSE_BONUS_FLOW_MODE;
  else process.env.COURSE_BONUS_FLOW_MODE = priorFlowMode;
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
  process.env.CENTRAL_CARGA_BONUS_CANARY_CONTACT_IDS = contact.id;
  await db!`INSERT INTO contact_channel_permissions(contact_id,channel,consent_status)
    VALUES (${contact.id},'whatsapp','unknown')`;
  await db!`INSERT INTO workspace_contacts(workspace_id,contact_id,source_channel)
    VALUES (${workspace.id},${contact.id},'whatsapp')`;
  const [thread] = await db!`INSERT INTO channel_threads(contact_id,provider,integration_id,channel,external_conversation_id,metadata)
    VALUES (${contact.id},'botpress','whatsapp','whatsapp',${botpressId},${db!.json({botpress_conversation_id:botpressId})})
    RETURNING id`;
  const [conversation] = await db!`INSERT INTO conversations(contact_id,channel,channel_thread_id)
    VALUES (${contact.id},'whatsapp',${thread.id}) RETURNING id`;
  const offerings = await db!`INSERT INTO offerings(workspace_id,code,display_name,offering_type,status,description,
      price_type,price_amount,currency,billing_interval)
    VALUES (${workspace.id},${`ingles_1_${suffix.slice(0,8)}`},'Inglés 1','course','active','Nivel inicial','fixed',360,'USD','annual'),
      (${workspace.id},${`ingles_2_${suffix.slice(0,8)}`},'Inglés 2','course','active','Continuación','free',NULL,NULL,NULL)
    RETURNING id,code,display_name`;
  const [paid, bonus] = offerings;
  const [firstInbound] = await db!`INSERT INTO messages(conversation_id,contact_id,direction,content)
    VALUES (${conversation.id},${contact.id},'inbound','Me parece caro') RETURNING id`;
  const [firstOutbound] = await db!`INSERT INTO messages(conversation_id,contact_id,direction,content,in_reply_to)
    VALUES (${conversation.id},${contact.id},'outbound','Inglés 1 puede ayudarte con documentación y entrevistas.',${firstInbound.id})
    RETURNING id`;
  const [sourceEvent] = await db!`INSERT INTO channel_events(provider,integration_id,channel,event_kind,
      direction,external_event_id,external_message_id,external_conversation_id,payload_hash,payload,
      contact_id,channel_thread_id)
    VALUES ('botpress','whatsapp','whatsapp','inbound_message','inbound',${`event-${suffix}`},
      ${`message-${suffix}`},${botpressId},decode(repeat('02',32),'hex'),${db!.json({type:'text'})},
      ${contact.id},${thread.id}) RETURNING id`;
  const [inbound] = await db!`INSERT INTO messages(conversation_id,contact_id,direction,content,source_event_id)
    VALUES (${conversation.id},${contact.id},'inbound','El monto me sigue frenando',${sourceEvent.id}) RETURNING id`;
  await db!`INSERT INTO conversation_sales_context_states_v1(workspace_id,conversation_id,contact_id,
      selected_offering_code,source_turn_id)
    VALUES (${workspace.id},${conversation.id},${contact.id},NULL,${inbound.id})`;

  await db!`INSERT INTO agent_decisions(turn_id,trace_id,schema_version,intent,decision_kind,response,
      response_type,business_action,memory_candidates,missing_information,next_state,reason_code,
      confidence,model_provider,model_name,prompt_version,payload_hash,outbound_message_id)
    VALUES (${firstInbound.id},${randomUUID()},4,'commercial','reply',
      'Inglés 1 puede ayudarte con documentación y entrevistas.','commercial_reply',NULL,
      ${db!.json([{type:'objection',key:'price_objection',value:'precio alto',
        source_quote:'Me parece caro',confidence:1}])},ARRAY[]::text[],'waiting_user',
      'PROMOTION_STRUCTURED_EVIDENCE',1,'deepseek-direct','deepseek-v4-flash',
      'studyx-agent-a-brain-v128',decode(repeat('01',32),'hex'),${firstOutbound.id})`;
  const continuityPlan = derivePromotionContextRepairPlanV1({
    workspace_id: workspace.id, contact_id: contact.id, conversation_id: conversation.id,
    interest_offering_code: paid.code, existing: null,
    accepted_price_objection_turn_ids: [firstInbound.id], active_offer_status: null,
  });
  await expect(applyPromotionContextRepairPlanV1(db!, continuityPlan)).resolves.toEqual({
    interest_offering_code: paid.code, price_objection_count: 1,
  });
  const reviewCapability = await readCourseBonusCapabilityV1({workspace_slug:workspace.slug,contact_id:contact.id,
    conversation_id:conversation.id,channel:'text',selected_offering_code:null},{db:db!});
  expect(reviewCapability).toMatchObject({
    status:'review_available',may_request_review:true,interest_offering_code:paid.code,bonus_offerings:[],
    bonus_selection_mode:'any_active_course',
  });
  process.env.BUSINESS_WORKSPACE_SLUG = workspace.slug;
  const brainContext: AgentAContextV1 = {
    schema_version: 1,
    turn: {
      batch_messages: [
        { id: randomUUID(), text: 'no tenes nnguan oferta' },
        { id: randomUUID(), text: 'para hacerme' },
        { id: randomUUID(), text: '?' },
      ],
      recent_turns: [
        { id: firstInbound.id, direction: 'inbound', content: 'Me parece caro' },
        { id: firstOutbound.id, direction: 'outbound', content: 'Inglés 1 puede ayudarte con documentación y entrevistas.' },
      ],
    },
    customer: { display_name: 'Ana', memories: [] },
    identity: { advisor_name: 'Emma', academy_name: 'Studyx', website: null, instagram: null },
    commercial_state: {
      selected_offering_code: null, selected_payment_plan: null, stage: 'qualified',
      call_preference: 'unknown', call_offer_status: 'not_offered', call_offer_count: 0,
      awaiting_reply: 'none', payment_reported: false,
    },
    obligations: { stage: 'qualified', owes: [], not_yet: [] },
    catalog: {
      selected_offering: null,
      available_offerings: [paid, bonus].map((offering) => ({
        code: offering.code, display_name: offering.display_name,
        fact_id: `offering:${offering.code}:name:v1`, area_code: null,
      })),
      areas: [], candidate_offerings: [], payment_plans: [],
    },
    capabilities: {
      may_reply: true, may_offer_call: false, may_request_call_now: false,
      may_present_payment_options: true, may_send_payment_link: false,
      authorized_payment_plan: null, intake_status: 'known', intake_missing: [],
      course_bonus: {
        ...reviewCapability,
        bonus_offerings: [...reviewCapability.bonus_offerings],
      },
    },
  };
  const proposedReview = {
    schema_version: 1,
    move: {
      schema_version: 1, move: 'ask_payment_options', secondary_moves: [], vetoes: [],
      course_reference: paid.code, confidence: 1,
    },
    response: {
      messages: ['Dame un minuto y reviso qué alternativa puedo habilitarte para que aproveches mejor la formación.'],
      call_offer: null,
    },
    proposed_action: {
      type: 'request_promotion_review', reason: 'persistent_price_objection',
      bonus_offering_code: bonus.code,
    },
    confirmed_phone: null, profile_updates: [], profile_requests: [],
    used_fact_ids: [], used_memory_ids: [],
    memory_candidates: [{
      type: 'objection', key: 'price_objection', value: 'pide una alternativa comercial',
      source_quote: 'no tenes nnguan oferta', confidence: 1,
    }],
    repair_of: null,
  };
  const originalFetch = globalThis.fetch;
  let providerRequest: Record<string, unknown> | null = null;
  globalThis.fetch = vi.fn(async (_request: RequestInfo | URL, init?: RequestInit) => {
    providerRequest = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({
      output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(proposedReview) }] }],
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  let generated: Awaited<ReturnType<typeof generateDeepSeekAgentATurnProposalV1>>;
  try {
    generated = await generateDeepSeekAgentATurnProposalV1({
      context: brainContext, apiKey: 'workflow-fixture', signal: new AbortController().signal,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
  const providerSchema = (providerRequest as {
    text?: { format?: { schema?: { properties?: { proposed_action?: { anyOf?: Array<{
      properties?: { type?: { enum?: string[] }; bonus_offering_code?: { enum?: string[] } };
      required?: string[];
    }> } } } } };
  } | null)?.text?.format?.schema;
  const reviewSchema = providerSchema?.properties?.proposed_action?.anyOf?.find((candidate) => (
    candidate.properties?.type?.enum?.includes('request_promotion_review')
  ));
  expect(reviewSchema).toMatchObject({
    properties: { bonus_offering_code: { enum: [bonus.code] } },
    required: ['type', 'reason', 'bonus_offering_code'],
  });
  expect(generated.proposal.response.messages.join(' ')).not.toMatch(
    /no hay promo|no te lo voy a inventar|no te voy a ofrecer|no te voy a insistir/iu,
  );
  if (generated.proposal.proposed_action.type !== 'request_promotion_review') {
    throw new Error('promotion review proposal expected');
  }
  const committedReview = await commitAgentDecision({
    turn_id: inbound.id,
    trace_id: randomUUID(),
    authorized_offering_code: null,
    authorized_payment_plan: null,
    conversation_pipeline_v1: null,
    agent_turn_v2: { schema_version: 2, proposal: generated.proposal },
    supports_multi_outbound: true,
    supports_send_fencing: true,
    turn_diagnostics: {
      schema_version: 1, generation_attempts: 1, failure_stage: 'none',
      failure_codes: [], action_status: 'authorized',
    },
    decision: {
      schema_version: 4, intent: 'commercial', kind: 'reply', response: 'placeholder',
      response_type: 'commercial_reply', business_action: null, memory_candidates: [],
      missing_information: [], next_state: 'waiting_user', reason_code: 'WORKFLOW_PLACEHOLDER',
      confidence: 1, retrieval_used: null,
    },
    model: {
      provider: 'deepseek-direct', model: 'deepseek-v4-flash',
      prompt_version: 'studyx-agent-a-brain-v131',
    },
  });
  expect(committedReview).toMatchObject({
    status: 'committed',
    outbound: { content: proposedReview.response.messages[0] },
    commercial_followups: [{ kind: 'promotion_review' }],
  });
  const [persistedReview] = await db!<Array<{
    business_action: { type: string; bonus_offering_code?: string };
    price_objection_count: number;
  }>>`SELECT decision.business_action,context.price_objection_count
    FROM agent_decisions decision
    JOIN conversation_promotion_context_v1 context
      ON context.conversation_id=${conversation.id} AND context.contact_id=${contact.id}
    WHERE decision.turn_id=${inbound.id}`;
  expect(persistedReview).toEqual({
    business_action: {
      type: 'request_promotion_review', reason: 'persistent_price_objection',
      bonus_offering_code: bonus.code,
    },
    price_objection_count: 2,
  });
  const reviewFollowup = committedReview.commercial_followups[0];
  if (!reviewFollowup || !committedReview.outbound) throw new Error('promotion review commit missing effects');
  const [review] = await db!<Array<{ offer_id: string }>>`
    SELECT id AS offer_id FROM promotion_offers
    WHERE workspace_id=${workspace.id} AND contact_id=${contact.id} AND conversation_id=${conversation.id}
    ORDER BY created_at DESC LIMIT 1`;
  expect(review.offer_id).toBeTruthy();
  const [promotion] = await db!`SELECT promotion.id,promotion.promotion_code
    FROM promotion_offers offer JOIN promotions promotion ON promotion.id=offer.promotion_id
    WHERE offer.id=${review.offer_id}`;
  expect(await db!`SELECT offer.status,paid.code AS paid_offering_code,
      snapshot.offering_code_snapshot AS bonus_offering_code
    FROM promotion_offers offer
    JOIN offerings paid ON paid.id=offer.paid_offering_id
    JOIN promotion_offer_bonus_offerings snapshot ON snapshot.offer_id=offer.id
    WHERE offer.id=${review.offer_id}`).toEqual([{
      status:'pending_review',paid_offering_code:paid.code,bonus_offering_code:bonus.code,
    }]);
  await db!`UPDATE course_bonus_followups SET due_at=now()-interval '1 second' WHERE id=${reviewFollowup.id}`;
  const claim = await claimCommercialFollowupV1(reviewFollowup.id,botpressId,`followup-event-${suffix}`,{db:db!});
  if(!claim.claimed) throw new Error('promotion review claim failed');
  expect(await deliverCommercialFollowupV1(reviewFollowup.id,{claim_token:claim.claim_token,
    botpress_conversation_id:botpressId,narrative:{kind:'promotion_review',value_angle:'progression',cta:'advance',treatment:'tu'}},
    {db:db!,sender:async()=>({outcome:'sent' as const,channel:'whatsapp' as const,providerMessageId:`wamid.${suffix}`,
      deliveryId:null,reason:null})})).toEqual({outcome:'sent'});
  await commitCommercialActionV1(db!,{workspace_id:workspace.id,contact_id:contact.id,
    conversation_id:conversation.id,paid_offering_code:paid.code,source_turn_id:inbound.id,
    source_outbound_message_id:committedReview.outbound.id,action:{type:'accept_promotion'}});

  const acceptedCapability = await readCourseBonusCapabilityV1({workspace_slug:workspace.slug,
    contact_id:contact.id,conversation_id:conversation.id,channel:'text',
    selected_offering_code:paid.code},{db:db!});
  const authorization = authorizeAgentTurnV2({
    state:{...createDefaultConversationStateV1({workspace_id:workspace.id,conversation_id:conversation.id,
      contact_id:contact.id}),selected_offering_code:paid.code,selected_payment_plan:'monthly_12',
      stage:'plan_selected',awaiting_reply:'payment_confirmation'},
    offerings:[{code:paid.code,display_name:paid.display_name},{code:bonus.code,display_name:bonus.display_name}],
    facts:[{id:`payment:${paid.code}:monthly_12:label:v1`,kind:'payment_plan_label',
      source:'business_snapshot',value:'12 pagos mensuales de USD 30',offering_code:paid.code,
      payment_plan:'monthly_12'}],
    contact_intake:{nombre:'Ana',apellido:'Prueba',correo:'ana@example.test',telefono:'+5491112345678'},
    current_customer_messages:['Pasame el link'],course_bonus:acceptedCapability,
    call_policy:{may_offer_call:true,may_request_call_now:true},
    proposal:{schema_version:1,move:{schema_version:1,move:'request_payment_link',secondary_moves:[],
      vetoes:[],confidence:1},response:{messages:['Acá tenés el enlace para avanzar.']},
      proposed_action:{type:'send_payment_link',offering_code:paid.code,payment_plan:'monthly_6',
        promotion_code:promotion.promotion_code},used_fact_ids:[],used_memory_ids:[],
      memory_candidates:[],repair_of:null},
  });
  expect(authorization).toMatchObject({ok:true,action:{type:'send_payment_link',
    offering_code:paid.code,payment_plan:'monthly_12',promotion_code:promotion.promotion_code}});
  if (!authorization.ok || authorization.action.type !== 'send_payment_link') {
    throw new Error('promoted payment authorization failed');
  }

  const reservation = await reservePaymentLink(db!,{workspace_id:workspace.id,contact_id:contact.id,
    offering_id:paid.id,conversation_id:conversation.id,plan_code:authorization.action.payment_plan,
    idempotency_key:`workflow-bonus:${suffix}`,payment_link_url:'https://buy.stripe.com/test_workflow_bonus',
    promotion_code:authorization.action.promotion_code});
  expect(await db!`SELECT promotion_code_snapshot,offering_code_snapshot,position
    FROM payment_bonus_offerings WHERE payment_id=${reservation.payment_id}`)
    .toEqual([{promotion_code_snapshot:promotion.promotion_code,
      offering_code_snapshot:bonus.code,position:1}]);
  await db!`UPDATE payments SET status='creating_checkout' WHERE id=${reservation.payment_id}`;
  await db!`UPDATE payments SET status='pending',provider_session_id=${`cs_test_${suffix}`} WHERE id=${reservation.payment_id}`;
  const stripe=new Stripe('sk_test_no_network');const secret='whsec_review_workflow';
  const payload=JSON.stringify({id:`evt_${suffix}`,object:'event',livemode:false,type:'checkout.session.completed',created:Math.floor(Date.now()/1000),
    data:{object:{id:`cs_test_${suffix}`,object:'checkout.session',client_reference_id:reservation.payment_id,mode:'subscription',
      payment_status:'paid',amount_total:3000,currency:'usd',metadata:{}}}});
  const signature=stripe.webhooks.generateTestHeaderString({payload,secret});
  const paidEvent=()=>processStripeWebhook(payload,signature,{db:db!,stripe,webhookSecret:secret,expectedEnvironment:'test'});
  expect(await paidEvent()).toMatchObject({status:200,body:{status:'paid'}});
  expect(await paidEvent()).toMatchObject({status:200,body:{outcome:'duplicate'}});
  expect(await db!`SELECT id FROM fulfillment_jobs WHERE payment_id=${reservation.payment_id}`).toHaveLength(1);
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
    bonusConfig:{enabled:false,fulfillmentPaused:true,canaryContactIds:[contact.id]}})).toMatchObject({completed:1});
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
