import { seedPriorModelNegotiation } from '../helpers/record-model-negotiation-facts';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import type { AgentAContextV1, AgentATurnProposalV1 } from '../../botpress-agent/src/schemas/agent-a-brain';
import { runWorkflowTurnV1 } from '../helpers/agent-a-workflow-driver';
import { configuration, secrets } from '../helpers/botpress-workflow-runtime';
import { openLocalTestDatabase } from '../helpers/db';
import { projectAgentAMemories } from '@/features/memory/application/project-agent-a-memories';
import { recordDeliveryReport } from '@/lib/services/decision.service';
import Stripe from 'stripe';
import { processStripeWebhook } from '@/features/payments/application/process-stripe-webhook';
import { runEnrollmentWorker } from '@/features/fulfillment/central-carga/worker';
import { postSaleAccessTestConfig } from '../helpers/post-sale-config';
import { claimNotification, deliverNotification, dispatchNotifications } from '@/features/fulfillment/post-sale/service';
import { loadLatestPaymentVerificationV1 } from '@/features/payments/application/read-payment-verification';
import { contactFixtureUpdatesV1 } from './contact-profile-fixture';
import { acceptDirectCourseBonusV1 } from '@/features/promotions/application/direct-course-bonus-service';

// Real Botpress handler, signed HTTP actions, backend and PostgreSQL. Only the
// model HTTP boundary is scripted: this tests contracts, not sales naturalness.
const run = process.env.TEST_DATABASE_URL ? it : it.skip;
const db = process.env.TEST_DATABASE_URL ? openLocalTestDatabase() : null;
const originalKey = secrets.DEEPSEEK_API_KEY;
const originalCron = secrets.CRON_SECRET;
let next: (context: AgentAContextV1) => AgentATurnProposalV1;
const observedContexts: AgentAContextV1[] = [];

beforeAll(async () => {
  if (!db) return;
  vi.stubEnv('COURSE_BONUS_FLOW_MODE','direct');
  vi.stubEnv('COURSE_BONUS_MAX_COURSES','3');
  vi.stubEnv('CENTRAL_CARGA_BONUS_ENABLED','true');
  vi.stubEnv('BOTPRESS_MANAGED_EGRESS_TOKEN','synthetic-post-sale-token');
  vi.stubEnv('BOTPRESS_MANAGED_EGRESS_BOT_ID','synthetic-post-sale-bot');
  expect(new URL(configuration.apiBaseUrl).hostname).toBe('127.0.0.1');
  const fetchLocal = globalThis.fetch;
  expect((await fetchLocal(`${configuration.apiBaseUrl}/api/ready`)).ok).toBe(true);
  secrets.DEEPSEEK_API_KEY = 'fixture-no-network-credentials';
  // Derived Google Sheets/embedding queues are outside this commercial gate.
  // Do not drain unrelated local jobs into external providers.
  secrets.CRON_SECRET = '';
  configuration.agentAPlannerlessV2Enabled = true;
  vi.stubGlobal('fetch', async (request: RequestInfo | URL, init?: RequestInit) => {
    const target = new URL(request instanceof Request ? request.url : String(request));
    if (target.origin === new URL(configuration.apiBaseUrl).origin) return fetchLocal(request, init);
    if (target.href !== 'https://api.deepseek.com/responses') throw new Error('UNEXPECTED_EXTERNAL_REQUEST');
    const instructions = JSON.parse(String(init?.body)).instructions as string;
    const context = JSON.parse(instructions.split('<authorized_context>')[1]!.split('</authorized_context>')[0]!) as AgentAContextV1;
    observedContexts.push(context);
    const proposal = next(context);
    return new Response(JSON.stringify({output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(proposal)}]}],
      usage:{input_tokens:0,output_tokens:0,total_tokens:0}}),{headers:{'content-type':'application/json'}});
  });
});
afterAll(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  if (originalKey === undefined) delete secrets.DEEPSEEK_API_KEY;
  else secrets.DEEPSEEK_API_KEY = originalKey;
  secrets.CRON_SECRET = originalCron;
  await db?.end();
});

function proposal(text: string, action: AgentATurnProposalV1['proposed_action'] = {type:'none'},
  fields: Partial<AgentATurnProposalV1> = {}): AgentATurnProposalV1 {
  return {schema_version:1,move:{schema_version:1,move:'ask_course_information',secondary_moves:[],vetoes:[],
    course_reference:'entrenamiento_funcional',confidence:1},response:{messages:[text],call_offer:null},
    proposed_action:action,profile_updates:[],profile_requests:[],course_mentions: [], used_fact_ids:[],used_memory_ids:[],
    memory_candidates:[],repair_of:null,...fields};
}

async function seedRemainingPriorNegotiation(turnId: string) {
  const [identity] = await db!<Array<{ workspace_id: string; contact_id: string; conversation_id: string }>>`
    SELECT s.workspace_id, s.contact_id, s.conversation_id FROM conversation_sales_context_states_v1 s
    JOIN messages m ON m.conversation_id=s.conversation_id AND m.contact_id=s.contact_id WHERE m.id=${turnId}::uuid`;
  expect(identity).toBeTruthy();
  // The scenario already committed one model-owned objection in its prior turn.
  await seedPriorModelNegotiation(db!, identity, 2);
}

function scenario() {
  const key=randomUUID();
  const identity={conversationId:`direct-matrix-${key}`,userId:`direct-matrix-user-${key}`,
    phoneE164:`+999${String(Date.now()).slice(-7)}${String(Math.floor(Math.random()*1000)).padStart(3,'0')}`,
    providerMode:'fixture' as const};
  async function send(text:string, authored:AgentATurnProposalV1 | ((context:AgentAContextV1)=>AgentATurnProposalV1),externalMessageId?:string) {
    next=context=>({...((typeof authored==='function')?authored(context):authored),
      repair_of:context.turn_rejection?{rejection_id:context.turn_rejection.rejection_id,attempt:1}:null});
    const evidence=await runWorkflowTurnV1({...identity,text,externalMessageId});
    expect(evidence.errorCode,JSON.stringify(evidence.workflowEvents)).toBeNull();
    expect(evidence.authorizedMessages.length).toBeGreaterThan(0);
    expect(evidence.commitSucceeded).toBe(true);
    const [row]=await db!<Array<{conversation_id:string;contact_id:string}>>`SELECT m.conversation_id,m.contact_id FROM messages m JOIN messages answer ON answer.in_reply_to=m.id
      JOIN outbound_deliveries d ON d.message_id=answer.id WHERE m.id=${evidence.turnId}::uuid AND d.state IN ('submitted','delivered')`;
    expect(row).toBeTruthy();
    return {...evidence,...row};
  }
  return {identity,send};
}

run('answers direct price and real inability, offers an early call, honors decline and deduplicates inbound',async()=>{
  const s=scenario();
  const first=await s.send('Me interesa Entrenamiento Funcional. ¿Podés orientarme?',
    proposal('¿Qué te gustaría aprender para tus rutinas?',{type:'none'},
      {response:{messages:['¿Qué te gustaría aprender para tus rutinas?'],call_offer:'Si querés, podemos coordinar una llamada para orientarte.'}}));
  expect(first.authorizedMessages.join(' ')).toMatch(/llamada/iu);
  expect((await db!`SELECT selected_offering_code,call_offer_count FROM conversation_sales_context_states_v1 WHERE conversation_id=${first.conversation_id}`)[0])
    .toMatchObject({selected_offering_code:null,call_offer_count:1});
  const declined=await s.send('No quiero llamada; sigamos por chat.',proposal('Seguimos por acá. ¿Qué necesitás saber?',{type:'none'},
    {move:{schema_version:1,move:'continue_by_chat',secondary_moves:[],vetoes:['call'],confidence:1}}));
  expect(declined.authorizedMessages.join(' ')).not.toMatch(/llamad/iu);
  const price=await s.send('¿Cuál es el precio y cómo se paga?',proposal('El total es USD 360: 12 pagos de USD 30, 6 pagos de USD 60 o un pago de USD 360.',{type:'none'},
    {move:{schema_version:1,move:'ask_payment_options',secondary_moves:[],vetoes:[],confidence:1,course_reference:'entrenamiento_funcional'},
      used_fact_ids:['payment:entrenamiento_funcional:monthly_12:price:v1','payment:entrenamiento_funcional:monthly_6:price:v1',
        'payment:entrenamiento_funcional:one_time:price:v1']}));
  expect(price.authorizedMessages.join(' ')).toContain('USD 360');
  await s.send('No puedo pagarlo: estoy sin ingresos.',proposal('Podemos dejarlo para cuando puedas retomarlo. ¿Preferís que lo veamos más adelante?'));
  expect(await db!`SELECT id FROM promotion_offers WHERE conversation_id=${first.conversation_id}`).toHaveLength(0);
  const eventId=randomUUID();
  const original=await s.send('Gracias, lo voy a pensar.',proposal('Cuando quieras retomarlo, podemos revisar tus dudas.'),eventId);
  const before=await db!`SELECT id FROM messages WHERE conversation_id=${first.conversation_id}`;
  const replay=await runWorkflowTurnV1({...s.identity,text:'Gracias, lo voy a pensar.',externalMessageId:eventId,occurredAt:original.occurredAt});
  expect(replay.errorCode).toBeNull();
  expect(await db!`SELECT id FROM messages WHERE conversation_id=${first.conversation_id}`).toHaveLength(before.length);
  await s.send('No me escriban más.',proposal('Entendido, dejamos de enviarte mensajes.'));
  expect((await db!`SELECT consent_status FROM contact_channel_permissions WHERE contact_id=${first.contact_id}`)[0])
    .toMatchObject({consent_status:'revoked'});
},120_000);

run('repairs pending delivery acceptance, rejects a pre-confirmation reply, and cancels on course change',async()=>{
  const s=scenario();
  await s.send('Me interesa Entrenamiento Funcional.',proposal('¿Qué te gustaría aprender para tus rutinas?'));
  const objection = await s.send('Me parece caro Entrenamiento Funcional.',proposal('¿Qué necesitás evaluar del contenido?',{type:'none'},
    {memory_candidates:[{type:'objection',key:'price_objection',value:'precio alto',source_quote:'Me parece caro',confidence:1}]}));
  await seedRemainingPriorNegotiation(objection.turnId!);
  const offered=await s.send('El monto sigue frenándome',proposal('Te regalo Inglés 1 al comprar Entrenamiento Funcional.',
    {type:'offer_course_bonus',motive:{kind:'price_objection',quote:'es caro'}, interest_offering_code:'entrenamiento_funcional',bonus_offering_code:'ingles_1'},{course_mentions:[{offering_code:'ingles_1',role:'bonus'}]}));
  const [offer]=await db!`SELECT o.*,p.promotion_code FROM promotion_offers o JOIN promotions p ON p.id=o.promotion_id WHERE o.conversation_id=${offered.conversation_id}`;
  const early=await s.send('Sí, acepto',context=>context.turn_rejection
    ? proposal('Estoy verificando el paquete para poder avanzar. ¿Querés repasar el contenido mientras tanto?')
    : proposal('Entrenamiento Funcional incluye Inglés 1 de regalo.',{type:'accept_promotion',interest_offering_code:'entrenamiento_funcional',
      promotion_code:offer.promotion_code,promotion_cycle_id:offer.promotion_cycle_id,offer_version:1},
      {course_mentions:[{offering_code:'ingles_1',role:'bonus'}],move:{schema_version:1,move:'unknown',secondary_moves:[],vetoes:[],confidence:1}}));
  expect(early.authorizedMessages.join(' ')).toContain('verificando');
  expect((await db!`SELECT status FROM promotion_offers WHERE id=${offer.id}`)[0].status).toBe('offered');
  await recordDeliveryReport({outbound_id:offered.outboundId!,trace_id:offered.traceId,status:'delivered',
    botpress_message_id:offered.adapterCaptures[0]!.providerMessageId,replayed:false,error_code:null,delivery_attempt:1,
    delivered_at:new Date().toISOString()});
  expect(await acceptDirectCourseBonusV1(db!,{workspace_id:offer.workspace_id,contact_id:offer.contact_id,conversation_id:offer.conversation_id,
    paid_offering_code:'entrenamiento_funcional',promotion_code:offer.promotion_code,promotion_cycle_id:offer.promotion_cycle_id,
    expected_offer_version:1,source_turn_id:early.turnId!})).toEqual({ok:false,reason:'bonus_without_reply'});
  await s.send('Ahora quiero Redes Informáticas.',proposal('Seguimos con Redes Informáticas. ¿Qué te gustaría saber?',{type:'none'},
    {move:{schema_version:1,move:'select_course',secondary_moves:[],vetoes:[],confidence:1,course_reference:'redes_informaticas'}}));
  expect((await db!`SELECT status FROM promotion_offers WHERE id=${offer.id}`)[0].status).toBe('cancelled');
},120_000);

run.each(['complete','partial'] as const)('carries interest-only discovery, 1→2→3, fourth refusal, exact acceptance, intake and signed payment (%s fulfillment)', async fulfillment => {
  const key = randomUUID();
  const identity = {conversationId:`direct-bonus-${key}`,userId:`direct-user-${key}`,
    phoneE164:`+999${Date.now().toString().slice(-10)}`,providerMode:'fixture' as const};
  const turnIds:string[]=[];
  async function send(text:string, authored:AgentATurnProposalV1 | ((context:AgentAContextV1)=>AgentATurnProposalV1)) {
    next = context => ({...(typeof authored==='function'?authored(context):authored),repair_of:context.turn_rejection
      ? {rejection_id:context.turn_rejection.rejection_id,attempt:1} : null});
    const result = await runWorkflowTurnV1({...identity,text});
    expect(result.errorCode,JSON.stringify(result.workflowEvents)).toBeNull();
    expect(result.commitSucceeded).toBe(true);
    expect(result.authorizedMessages.length).toBeGreaterThan(0);
    turnIds.push(result.turnId!);
    const deliveries=await db!`SELECT d.state FROM outbound_deliveries d JOIN messages m ON m.id=d.message_id
      WHERE m.in_reply_to=${result.turnId}::uuid`;
    expect(deliveries.length).toBeGreaterThan(0);
    expect(deliveries.every(d=>d.state==='submitted'||d.state==='delivered')).toBe(true);
    return result;
  }
  await send('Me interesa Entrenamiento Funcional; todavía estoy averiguando.',
    proposal('¿Qué te gustaría aprender para tus entrenamientos?'));
  await send('Quiero organizar mis rutinas. ¿Cómo es?',proposal('Podemos revisar el contenido según tu objetivo.'));
  const first = await send('Me parece caro',proposal('Entiendo la duda con el precio. ¿Qué necesitás evaluar para decidir?',{type:'none'},
    {memory_candidates:[{type:'objection',key:'price_objection',value:'precio alto',source_quote:'Me parece caro',confidence:1}]}));
  expect(await db!`SELECT id FROM promotion_offers WHERE conversation_id=(SELECT conversation_id FROM messages WHERE id=${first.turnId}::uuid)`)
    .toHaveLength(0);
  await seedRemainingPriorNegotiation(first.turnId!);
  await projectAgentAMemories({limit:100},{db:db!});
  const result = await send('El monto me sigue frenando',proposal('Te regalo Inglés 1 al comprar Entrenamiento Funcional.',
    {type:'offer_course_bonus',motive:{kind:'price_objection',quote:'es caro'}, interest_offering_code:'entrenamiento_funcional',bonus_offering_code:'ingles_1'},{course_mentions:[{offering_code:'ingles_1',role:'bonus'}]}));
  expect(result.authorizedMessages.join(' ')).toContain('Inglés 1');
  expect((await db!`SELECT selected_offering_code FROM conversation_sales_context_states_v1
    WHERE conversation_id=(SELECT conversation_id FROM messages WHERE id=${result.turnId}::uuid)`)[0])
    .toEqual({selected_offering_code:null});
  expect(await db!`SELECT offering_code_snapshot FROM promotion_offer_bonus_offerings
    WHERE source_turn_id=${result.turnId}::uuid`).toEqual([{offering_code_snapshot:'ingles_1'}]);
  // Submission remains distinct from confirmed channel delivery.
  const context = observedContexts.at(-1)!;
  expect(context.capabilities.course_bonus?.may_offer_bonus).toBe(true);
  expect(context.commercial_state.selected_offering_code).toBeNull();
  async function confirm(delivery:typeof result) {
    const receipt={outbound_id:delivery.outboundId!,trace_id:delivery.traceId,status:'delivered' as const,
      botpress_message_id:delivery.adapterCaptures[0]!.providerMessageId,replayed:false,error_code:null,
      delivery_attempt:1,delivered_at:new Date().toISOString()};
    expect(await recordDeliveryReport(receipt)).toMatchObject({status:'recorded'});
    expect(await recordDeliveryReport(receipt)).toMatchObject({status:'duplicate'});
  }
  await confirm(result);
  const second=await send('Sigo dudando por el monto',proposal('Te regalo Inglés 1 y Excel Integral al comprar Entrenamiento Funcional.',
    {type:'offer_course_bonus',motive:{kind:'price_objection',quote:'es caro'}, interest_offering_code:'entrenamiento_funcional',bonus_offering_code:'excel_integral'},{course_mentions:[{offering_code:'ingles_1',role:'bonus'},{offering_code:'excel_integral',role:'bonus'}]}));
  await confirm(second);
  const third=await send('¿Podés sumar otra formación?',proposal('Te regalo Inglés 1, Excel Integral e Inglés 2 al comprar Entrenamiento Funcional.',
    {type:'offer_course_bonus',motive:{kind:'price_objection',quote:'es caro'}, interest_offering_code:'entrenamiento_funcional',bonus_offering_code:'ingles_2'},{course_mentions:[{offering_code:'ingles_1',role:'bonus'},{offering_code:'excel_integral',role:'bonus'},{offering_code:'ingles_2',role:'bonus'}]}));
  await confirm(third);
  const fourth=await send('¿Y Redes también?',context=>context.turn_rejection
    ? proposal('El paquete incluye Inglés 1, Excel Integral e Inglés 2 de regalo. ¿Te sirve para avanzar con tu objetivo?',{type:'none'},{course_mentions:[{offering_code:'ingles_1',role:'bonus'},{offering_code:'excel_integral',role:'bonus'},{offering_code:'ingles_2',role:'bonus'}]})
    : proposal('Te regalo Redes Informáticas al comprar Entrenamiento Funcional.',
      {type:'offer_course_bonus',motive:{kind:'price_objection',quote:'es caro'}, interest_offering_code:'entrenamiento_funcional',bonus_offering_code:'redes_informaticas'},{course_mentions:[{offering_code:'redes_informaticas',role:'bonus'}]}));
  expect(fourth.authorizedMessages.join(' ')).not.toContain('Redes Informáticas');
  expect(fourth.authorizedMessages.join(' ')).toContain('Te sirve');
  const [offer]=await db!`SELECT o.*,p.promotion_code FROM promotion_offers o JOIN promotions p ON p.id=o.promotion_id
    WHERE o.conversation_id=(SELECT conversation_id FROM messages WHERE id=${result.turnId}::uuid)`;
  expect(offer.offer_version).toBe(3);
  expect(offer.bonus_snapshot_sealed_at).toBeNull();
  expect(await acceptDirectCourseBonusV1(db!,{workspace_id:offer.workspace_id,contact_id:offer.contact_id,conversation_id:offer.conversation_id,
    paid_offering_code:'entrenamiento_funcional',promotion_code:offer.promotion_code,promotion_cycle_id:offer.promotion_cycle_id,
    expected_offer_version:2,source_turn_id:fourth.turnId!})).toEqual({ok:false,reason:'stale_offer_version'});
  await send('Sí, acepto ese paquete',()=>proposal('Entrenamiento Funcional incluye Inglés 1, Excel Integral e Inglés 2 de regalo.',
    {type:'accept_promotion',interest_offering_code:'entrenamiento_funcional',promotion_code:offer.promotion_code,
      promotion_cycle_id:offer.promotion_cycle_id,offer_version:3},
    {course_mentions:[{offering_code:'ingles_1',role:'bonus'},{offering_code:'excel_integral',role:'bonus'},{offering_code:'ingles_2',role:'bonus'}],move:{schema_version:1,move:'unknown',secondary_moves:[],vetoes:[],confidence:1}}));
  expect((await db!`SELECT status,offer_version,bonus_snapshot_sealed_at FROM promotion_offers WHERE id=${offer.id}`)[0])
    .toMatchObject({status:'accepted',offer_version:3,bonus_snapshot_sealed_at:expect.any(Date)});
  const move=(kind:AgentATurnProposalV1['move']['move'],extra:Partial<AgentATurnProposalV1['move']>={})=>
    ({schema_version:1 as const,move:kind,secondary_moves:[],vetoes:[],confidence:1,course_reference:'entrenamiento_funcional',...extra});
  await send('Quiero inscribirme en Entrenamiento Funcional en un pago',proposal('¿Avanzamos con tus datos?',{type:'none'},
    {move:move('select_course',{secondary_moves:['select_payment_plan'],payment_plan:'one_time'})}));
  await send('Pasame el enlace para pagar',proposal('Para la inscripción, ¿me pasás nombre, apellido, correo y teléfono?',{type:'none'},
    {move:move('request_payment_link'),profile_requests:[{message_index:0,fields:['nombre','apellido','correo','telefono'],purpose:'payment',mode:'collect'}]}));
  await send('Nombre Ana; apellido Prueba; correo ana.direct@example.test; teléfono +1 305 555 0176.',context=>
    proposal('Tus datos son Ana Prueba, ana.direct@example.test y +1 305 555 0176. ¿Están correctos?',{type:'none'},
      {move:move('provide_contact_details'),profile_updates:contactFixtureUpdatesV1(context,[
        {field:'nombre',value:'Ana'},{field:'apellido',value:'Prueba'},
        {field:'correo',value:'ana.direct@example.test'},
        {field:'telefono',value:'+13055550176',quote:'+1 305 555 0176'},
      ])}));
  const checkout=await send('Sí, están correctos. Enviame el enlace de un pago.',proposal('Te comparto el enlace para avanzar.',
    {type:'send_payment_link',offering_code:'entrenamiento_funcional',payment_plan:'one_time',promotion_code:offer.promotion_code},
    {move:move('request_payment_link',{payment_plan:'one_time'})}));
  const [payment]=await db!`SELECT * FROM payments WHERE source_conversation_id=${offer.conversation_id}`;
  expect(payment).toMatchObject({promotion_offer_id:offer.id,promotion_cycle_id:offer.promotion_cycle_id,accepted_offer_version:3,amount:'360.00'});
  expect(checkout.authorizedMessages.join(' ')).toContain(payment.checkout_url);
  const snapshots=await db!`SELECT offering_code_snapshot,position FROM payment_bonus_offerings WHERE payment_id=${payment.id} ORDER BY position`;
  expect(snapshots).toEqual([{offering_code_snapshot:'ingles_1',position:1},{offering_code_snapshot:'excel_integral',position:2},
    {offering_code_snapshot:'ingles_2',position:3}]);
  const stripe=new Stripe('sk_test_no_network');const secret='whsec_direct_workflow';
  const payload=JSON.stringify({id:`evt_${key}`,object:'event',livemode:false,type:'checkout.session.completed',created:Math.floor(Date.now()/1000),
    data:{object:{id:`cs_test_${key}`,object:'checkout.session',client_reference_id:payment.id,mode:'payment',payment_status:'paid',
      amount_total:36000,currency:'usd',metadata:{}}}});
  const signature=stripe.webhooks.generateTestHeaderString({payload,secret});
  const webhook=()=>processStripeWebhook(payload,signature,{db:db!,stripe,webhookSecret:secret,expectedEnvironment:'test'});
  expect(await webhook()).toMatchObject({status:200,body:{status:'paid'}});
  expect(await webhook()).toMatchObject({status:200,body:{outcome:'duplicate'}});
  expect(await db!`SELECT id FROM fulfillment_jobs WHERE payment_id=${payment.id}`).toHaveLength(1);
  expect(await db!`SELECT id FROM post_sale_notifications WHERE payment_id=${payment.id} AND kind='access_ready'`).toHaveLength(0);
  const missing=await db!`SELECT m.id FROM messages m WHERE m.id=ANY(${db!.array(turnIds)}::uuid[])
    AND NOT EXISTS(SELECT 1 FROM messages out JOIN outbound_deliveries d ON d.message_id=out.id
      WHERE out.in_reply_to=m.id AND d.state IN ('submitted','delivered'))`;
  expect(missing).toEqual([]);
  if(fulfillment==='partial') await db!`UPDATE fulfillment_jobs SET max_attempts=1 WHERE payment_id=${payment.id}`;
  const centralRequests:Array<{schema_version:number;payment_id:string;bonus_offerings:Array<{code:string;promotion_code:string}>}>=[];
  const fetchCentral=(async (_url:unknown,init?:RequestInit)=>{
    const body=JSON.parse(String(init?.body));
    centralRequests.push(body);
    return new Response(JSON.stringify({payment_id:payment.id,enrollment_id:`enr-${key}`,student_id:`stu-${key}`,
      enrollment_status:'active',student_was_created:true,access:{login_email:'ana.direct@example.test',welcome_sent:true},supports_partial_recovery:true,
      bonus_enrollments:[{offering_code:'ingles_1',enrollment_status:'active'},
        {offering_code:'excel_integral',enrollment_status:'active'},
        {offering_code:'ingles_2',enrollment_status:fulfillment==='partial'?'failed':'active'}]}),{status:201});
  }) as typeof fetch;
  const workerResult=await runEnrollmentWorker({scoped:true,payment_id:payment.id,limit:1},{sql:db!,fetchImpl:fetchCentral,
    config:{enabled:true,baseUrl:'https://central.test',signingSecret:'workflow-synthetic-secret',environment:'test',
      paidAfter:new Date('2026-01-01'),allowSandboxContacts:true},bonusConfig:{enabled:true,fulfillmentPaused:false}});
  // Assert outside the transport double: the client deliberately catches
  // thrown transport errors, which must never conceal a fixture assertion.
  expect(centralRequests).toHaveLength(1);
  expect(centralRequests[0]).toMatchObject({schema_version:2,payment_id:payment.id});
  expect(centralRequests[0].bonus_offerings.map(course=>course.code)).toEqual(['ingles_1','excel_integral','ingles_2']);
  expect(centralRequests[0].bonus_offerings.every(course=>course.promotion_code===offer.promotion_code)).toBe(true);
  expect(workerResult).toMatchObject(fulfillment==='partial'?{dead_lettered:1,completed:0}:{completed:1});
  async function sendPersistedPostSale(kind:'access_ready'|'access_delayed') {
    const [notice]=await db!`SELECT id,status FROM post_sale_notifications WHERE payment_id=${payment.id} AND kind=${kind}`;
    expect(notice).toMatchObject({status:'pending'});
    const dispatchedEvents:unknown[]=[];
    const deps={db:db!,config:{accessTemplate:postSaleAccessTestConfig,enabled:true,environment:'test' as const,paidAfter:new Date('2026-01-01')},
      fetchImpl:(async (_url:unknown,init?:RequestInit)=>{
        dispatchedEvents.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({event:{id:`post-sale-event-${key}`}}),{status:201});
      }) as typeof fetch};
    expect(await dispatchNotifications(payment.id,deps)).toEqual({dispatched:1});
    expect(dispatchedEvents).toEqual([{type:'studyxPostSale',payload:{notification_id:notice.id},conversationId:identity.conversationId}]);
    const claim=await claimNotification(notice.id,identity.conversationId,deps);
    expect(claim).toMatchObject({claimed:true,kind});
    if(!claim.claimed) throw new Error('POST_SALE_CLAIM_REQUIRED');
    const sent:string[]=[];
    const deliveryDeps={...deps,sender:async(input:{text:string})=>{
      sent.push(input.text);
      return {outcome:'sent' as const,channel:'whatsapp' as const,providerMessageId:`post-sale-message-${key}`,
        deliveryId:null,reason:null};
    }};
    const input={claim_token:claim.claim_token,botpress_conversation_id:identity.conversationId,
      narrative:{intro:kind==='access_ready'?'Tu acceso ya está habilitado.':'Recibimos tu pago. El equipo está revisando el curso pendiente.',suggestion:''}};
    expect(await deliverNotification(notice.id,input,deliveryDeps)).toEqual({outcome:'sent'});
    // Sent notifications are excluded by the source authorization query.
    expect(await deliverNotification(notice.id,input,deliveryDeps)).toEqual({outcome:'not_authorized'});
    expect(sent).toHaveLength(1);
    expect((await db!`SELECT status,provider_message_id,sent_at FROM post_sale_notifications WHERE id=${notice.id}`)[0])
      .toMatchObject({status:'sent',provider_message_id:`post-sale-message-${key}`,sent_at:expect.any(Date)});
    return sent[0];
  }
  if(fulfillment==='partial') {
    expect((await db!`SELECT status FROM payments WHERE id=${payment.id}`)[0].status).toBe('paid');
    expect(await loadLatestPaymentVerificationV1({workspace_slug:'studyx',contact_id:offer.contact_id},db!))
      .toMatchObject({status:'paid',fulfillment:null});
    expect(await db!`SELECT id FROM post_sale_notifications WHERE payment_id=${payment.id} AND kind='access_ready'`).toHaveLength(0);
    expect(await db!`SELECT pending_codes FROM bonus_fulfillment_cases WHERE payment_id=${payment.id}`)
      .toEqual([{pending_codes:['ingles_2']}]);
    const delayed=await sendPersistedPostSale('access_delayed');
    // Owner's 2026-11-01 exception: partial access lists verified courses only.
    expect(delayed).toContain('CURSOS HABILITADOS');
    expect(delayed).toContain('El equipo está terminando de habilitar Inglés 2; te avisamos por acá.');
    expect(delayed).not.toContain('🎁 CURSO BONIFICADO: Inglés 2');
    expect(delayed).not.toMatch(/factura|invoice/iu);
    expect(await db!`SELECT id FROM bonus_fulfillment_cases WHERE payment_id=${payment.id}`).toHaveLength(1);
    return;
  }
  const verified=await db!<Array<{offering_code:string;enrollment_status:string;position:number}>>`
    SELECT offering_code,enrollment_status,position FROM central_bonus_enrollment_items WHERE payment_id=${payment.id} ORDER BY position`;
  // Authority: prompt-agente-a-studyx-v2.md:228-230; spec-backend-bonificacion.md:89-90.
  // Owner-authorized template reflects only actual enrollments.
  expect(verified).toEqual([
    { offering_code: 'ingles_1', enrollment_status: 'active', position: 1 },
    { offering_code: 'excel_integral', enrollment_status: 'active', position: 2 },
    { offering_code: 'ingles_2', enrollment_status: 'active', position: 3 },
  ]);
  expect(await loadLatestPaymentVerificationV1({workspace_slug:'studyx',contact_id:offer.contact_id},db!))
    .toMatchObject({status:'paid',fulfillment:{enrollment_status:'active'}});
  const message=await sendPersistedPostSale('access_ready');
  for(const name of ['Entrenamiento Funcional','Inglés 1','Excel Integral','Inglés 2']) expect(message).toContain(name);
  expect(message).not.toMatch(/invoice|factura|comprobante/iu);
},180_000);
