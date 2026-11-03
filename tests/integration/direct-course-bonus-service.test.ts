import { recordModelPriceObjection, seedPriorModelNegotiation } from '../helpers/record-model-negotiation-facts';
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openLocalTestDatabase } from '../helpers/db';
import { acceptDirectCourseBonusV1, offerDirectCourseBonusV1 } from '@/features/promotions/application/direct-course-bonus-service';
import { cancelOpenCourseBonusOffersForCourseChangeV1 } from '@/features/promotions/application/commercial-followup-service';
import { readCourseBonusCapabilityV1, recordPromotionConversationContextV1 } from '@/features/promotions/application/read-course-bonus-capability';
import { seedConversationForAgentTurn } from '../helpers/agent-turn-fixtures';
import { commitAgentDecision } from '@/lib/services/decision.service';
import { processInboundMessage } from '@/lib/services/ingestion.service';

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const db = process.env.TEST_DATABASE_URL ? openLocalTestDatabase() : null;
afterAll(async () => db?.end());
beforeEach(() => {
  vi.stubEnv('COURSE_BONUS_FLOW_MODE', 'direct');
  vi.stubEnv('COURSE_BONUS_MAX_COURSES', '2');
  vi.stubEnv('CENTRAL_CARGA_BONUS_ENABLED', 'true');
});
afterEach(() => vi.unstubAllEnvs());

async function fixture(objectionCount=2) {
  const key = randomUUID();
  const [w] = await db!`INSERT INTO workspaces(slug,display_name) VALUES (${key},'Service') RETURNING id`;
  const [c] = await db!`INSERT INTO contacts(phone,channel_origin,status) VALUES
    (${'+' + String(Math.floor(100000000000 + Math.random()*800000000000))},'whatsapp','prospecto') RETURNING id`;
  await db!`INSERT INTO workspace_contacts(workspace_id,contact_id,source_channel) VALUES (${w.id},${c.id},'whatsapp')`;
  const [v] = await db!`INSERT INTO conversations(contact_id,channel) VALUES (${c.id},'whatsapp') RETURNING id`;
  const courses = await db!`INSERT INTO offerings(workspace_id,code,display_name,offering_type,status,description,price_type,price_amount,currency,billing_interval)
    SELECT ${w.id}, (ARRAY['introduccion_ecommerce','fotografia_celulares_tiendas_online','publicidad_redes_sociales','instagram_emprendedores','ingles_1'])[n+1],'Course ' || n,'course','active','Course','fixed',360,'USD','annual' FROM generate_series(0,4) n RETURNING id,code`;
  await db!`INSERT INTO conversation_sales_context_states_v1(workspace_id,conversation_id,contact_id,selected_offering_code)
    VALUES (${w.id},${v.id},${c.id},${courses[0].code})`;
  await db!`INSERT INTO promotions(workspace_id,promotion_code,paid_offering_id,channels,active)
    VALUES (${w.id},${key},${courses[0].id},ARRAY['text'],true)`;
  async function inbound(offset: number) {
    const [m] = await db!`INSERT INTO messages(conversation_id,contact_id,direction,content,created_at)
      VALUES (${v.id},${c.id},'inbound','Customer',now() + ${Math.min(0,offset)} * interval '1 second') RETURNING id`;
    // Later price replies are committed model observations for Rule A escalation.
    if (offset > 0) await recordModelPriceObjection(db!, m.id);
    return m.id as string;
  }
  const prior = await inbound(-10);
  await db!`INSERT INTO selected_memories(contact_id,conversation_id,source_message_id,status,memory_type,memory_key,value_normalized,source_quote,confidence,dedupe_hash)
    VALUES (${c.id},${v.id},${prior},'active','objection','price_objection','expensive','Customer',0.9,${'a'.repeat(64)})`;
  const objectionTurns=await seedPriorModelNegotiation(db!,{workspace_id:w.id,contact_id:c.id,conversation_id:v.id},objectionCount);
  const source = await inbound(0);
  const identity = {workspace_id:w.id as string,contact_id:c.id as string,conversation_id:v.id as string,
    paid_offering_code:courses[0].code as string,promotion_code:key,promotion_cycle_id:randomUUID()};
  function input(turn=source, course=1, version=0) {
    const id=randomUUID();
    return {...identity,source_turn_id:turn,expected_offer_version:version,bonus_offering_codes:[courses[course].code as string],
      outbound:{id,content:'Bonus',provider:'test',integration_id:'test',channel:'whatsapp',destination:'test',idempotency_key:id}};
  }
  async function deliver(id: string) {
    await db!`UPDATE outbound_deliveries SET state='leased' WHERE message_id=${id}`;
    await db!`UPDATE outbound_deliveries SET state='submitted',submitted_at=now() WHERE message_id=${id}`;
    await db!`UPDATE outbound_deliveries SET state='delivered',delivered_at=now() WHERE message_id=${id}`;
  }
  return {w,c,v,courses,identity,source,inbound,input,deliver,objectionTurns};
}

run('atomic direct bonus service', () => {
  it.each([0,1,2])('uses exactly prior committed model facts (%s objections)',async count=>{
    const f=await fixture(count);
    const cap=await readCourseBonusCapabilityV1({workspace_slug:f.w.slug ?? f.identity.promotion_code,
      contact_id:f.c.id,conversation_id:f.v.id,channel:'text',selected_offering_code:f.courses[0].code,
      source_turn_id:f.source},{db:db!});
    // One persisted objection is enough (no count of two); with none the offer stays pending.
    expect(cap).toMatchObject({may_offer_bonus:true,ladder:{price_evidence:count>=1,eligible:count>=1}});
    const result=await offerDirectCourseBonusV1(db!,f.input());
    expect(result).toMatchObject(count>=1?{ok:true}:{ok:false,reason:'ladder_step_pending',ladder:{price_evidence:false}});
  });
  it('counts the current second committed objection without counting duplicate legacy memory',async()=>{
    const f=await fixture(1);
    await recordModelPriceObjection(db!,f.source);
    expect(await offerDirectCourseBonusV1(db!,f.input())).toMatchObject({ok:true,offer_version:1});
  });
  it('does not count action-only review/checkin records or future objections',async()=>{
    const f=await fixture(0);
    const actionTurn=await f.inbound(0);
    await recordModelPriceObjection(db!,actionTurn,{memory:false,action:'schedule_price_objection_checkin'});
    const reviewTurn=await f.inbound(0);
    await recordModelPriceObjection(db!,reviewTurn,{memory:false,action:'request_promotion_review'});
    const current=await f.inbound(0);
    const future=await f.inbound(0);
    await recordModelPriceObjection(db!,future);
    expect(await offerDirectCourseBonusV1(db!,f.input(current))).toMatchObject({ok:false,reason:'ladder_step_pending',
      ladder:{price_evidence:false}});
  });
  it('uses the durable prior call invitation when a later state cycle reset it',async()=>{
    const f=await fixture();
    const invitation=await f.inbound(0);await recordModelPriceObjection(db!,invitation,{memory:false,call_offer:true});
    const current=await f.inbound(0);
    await db!`UPDATE conversation_sales_context_states_v1 SET call_offer_status='not_offered',call_offer_count=0 WHERE conversation_id=${f.v.id}`;
    expect(await offerDirectCourseBonusV1(db!,f.input(current))).toMatchObject({ok:true});
  });
  it('does not require a prior call invitation under Rule A',async()=>{
    const f=await fixture();await db!`UPDATE conversation_sales_context_states_v1 SET call_offer_status='not_offered',call_offer_count=0 WHERE conversation_id=${f.v.id}`;
    const input=f.input();input.outbound.content='Si querés, podemos hablar por teléfono. Te regalo el curso.';
    expect(await offerDirectCourseBonusV1(db!,input)).toMatchObject({ok:true});
  });
  it('requires literal provenance even when invalid model candidates were committed before async memory validation',async()=>{
    const f=await fixture(0);
    for(let index=0;index<3;index+=1) {
      const source=await f.inbound(0);await recordModelPriceObjection(db!,source,{source_quote:'Una cita que el cliente nunca escribió'});
    }
    const current=await f.inbound(0);
    expect(await offerDirectCourseBonusV1(db!,f.input(current))).toMatchObject({ok:false,reason:'ladder_step_pending',ladder:{price_evidence:false}});
  });
  it.each(['terminal_call','expired_session'] as const)('does not reopen a bonus while persisted state remains in handoff (%s)',async kind=>{
    const f=await fixture();
    await db!`UPDATE conversation_sales_context_states_v1 SET call_preference='call',call_offer_status='accepted',call_offer_count=0,
      stage='handoff',awaiting_reply='none',updated_at=${kind==='expired_session'?new Date(Date.now()-25*60*60*1000):new Date()}
      WHERE conversation_id=${f.v.id}`;
    if(kind==='terminal_call') {
      await db!`INSERT INTO call_sessions(workspace_id,source_turn_id,contact_id,conversation_id,provider,request_idempotency_key,status,
        consent_source_message_id,context_snapshot,context_hash,prompt_version,completed_at)
        VALUES (${f.w.id},${f.objectionTurns[0]},${f.c.id},${f.v.id},'telegram_sandbox',${randomUUID()},'completed',
          ${f.objectionTurns[0]},'{}'::jsonb,decode(repeat('00',32),'hex'),'fixture',now())`;
    }
    expect(await offerDirectCourseBonusV1(db!,f.input())).toEqual({ok:false,reason:'sale_already_closed'});
  });
  it('keeps blocked-contact safety ahead of call-unavailable ladder eligibility without writing effects',async()=>{
    const f=await fixture();const input=f.input();
    await db!`UPDATE contacts SET lifecycle_status='blocked',blocked_at=now() WHERE id=${f.c.id}`;
    expect(await offerDirectCourseBonusV1(db!,input)).toMatchObject({ok:false,reason:'bonus_disabled'});
    expect(await db!`SELECT id FROM promotion_offers WHERE conversation_id=${f.v.id}`).toHaveLength(0);
    expect(await db!`SELECT id FROM promotion_offer_bonus_offerings WHERE source_turn_id=${f.source}`).toHaveLength(0);
    expect(await db!`SELECT id FROM messages WHERE id=${input.outbound.id}`).toHaveLength(0);
  });
  it.each(['offered','declined','not_offered','limit','unavailable'] as const)('does not use call status as a Rule A prerequisite: %s',async status=>{
    const f=await fixture();
    await db!`UPDATE conversation_sales_context_states_v1 SET call_offer_status=${status==='offered'||status==='declined'?status:'not_offered'},
      call_offer_count=${status==='limit'?2:status==='offered'?1:0},call_preference=${status==='unavailable'?'call':'unknown'}
      WHERE conversation_id=${f.v.id}`;
    expect(await offerDirectCourseBonusV1(db!,f.input())).toMatchObject({ok:true});
  });
  it('preserves exact replay even after call eligibility and observations change',async()=>{
    const f=await fixture();const input=f.input();const result=await offerDirectCourseBonusV1(db!,input);
    expect(result.ok).toBe(true);
    await db!`UPDATE conversation_sales_context_states_v1 SET call_offer_status='not_offered',call_offer_count=0 WHERE conversation_id=${f.v.id}`;
    expect(await offerDirectCourseBonusV1(db!,input)).toEqual(result);
  });

  it.each([
    ['paid in another conversation', 'paid', true],
    ['refunded in this conversation', 'refunded', false],
  ] as const)('does not close a new bonus sale for a historical payment: %s', async (_label, status, otherConversation) => {
    const f = await fixture();
    const sourceConversationId = otherConversation
      ? (await db!`INSERT INTO conversations(contact_id,channel) VALUES (${f.c.id},'telegram') RETURNING id`)[0].id
      : f.v.id;
    await db!`INSERT INTO payments(workspace_id,contact_id,offering_id,amount,currency,status,provider,
      environment,checkout_mode,idempotency_key,plan_code,source_conversation_id,paid_at)
      VALUES (${f.w.id},${f.c.id},${f.courses[0].id},360,'USD',${status},'fake','test','payment',
        ${randomUUID()},'one_time',${sourceConversationId},now()-interval '1 day')`;

    expect(await offerDirectCourseBonusV1(db!, f.input())).toMatchObject({ ok: true, offer_version: 1 });
  });

  it('still closes the current sale after a paid payment in this conversation', async () => {
    const f = await fixture();
    await db!`INSERT INTO payments(workspace_id,contact_id,offering_id,amount,currency,status,provider,
      environment,checkout_mode,idempotency_key,plan_code,source_conversation_id,paid_at)
      VALUES (${f.w.id},${f.c.id},${f.courses[0].id},360,'USD','paid','fake','test','payment',
        ${randomUUID()},'one_time',${f.v.id},now())`;

    expect(await offerDirectCourseBonusV1(db!, f.input())).toEqual({ ok: false, reason: 'sale_already_closed' });
  });

  it('clears historical promotion interest when a new generic sales cycle starts', async () => {
    const f = await fixture();
    await recordPromotionConversationContextV1(db!, {
      ...f.identity,
      source_turn_id: f.source,
      discussed_offering_code: f.courses[0].code as string,
      records_price_objection: true,
    });
    const resetTurn = await f.inbound(0);

    expect(await recordPromotionConversationContextV1(db!, {
      ...f.identity,
      source_turn_id: resetTurn,
      discussed_offering_code: null,
      records_price_objection: false,
      reset_context: true,
    })).toEqual({ interest_offering_code: null, price_objection_count: 0 });
    expect((await db!`SELECT interest_offering_code, price_objection_count
      FROM conversation_promotion_context_v1
      WHERE workspace_id=${f.w.id} AND conversation_id=${f.v.id}`)[0])
      .toEqual({ interest_offering_code: null, price_objection_count: 0 });
  });

  it.each(['direct','review','call'] as const)('keeps package identity for gift information and a call about the included course (%s)',async mode=>{
    const f=await seedConversationForAgentTurn({selected_offering_code:'entrenamiento_funcional',intake_complete:true});
    const [prior]=await db!`INSERT INTO messages(conversation_id,contact_id,direction,content,created_at)
      VALUES (${f.conversation_id},${f.contact_id},'inbound','Expensive',now()-interval '1 hour') RETURNING id`;
    await db!`INSERT INTO selected_memories(contact_id,conversation_id,source_message_id,status,memory_type,memory_key,value_normalized,source_quote,confidence,dedupe_hash)
      VALUES (${f.contact_id},${f.conversation_id},${prior.id},'active','objection','price_objection','expensive','Expensive',0.9,${'a'.repeat(64)})`;
    await seedPriorModelNegotiation(db!,f);
    const identity={workspace_id:f.workspace_id,contact_id:f.contact_id,conversation_id:f.conversation_id,paid_offering_code:'entrenamiento_funcional'};
    const id=randomUUID();
    const offer=await offerDirectCourseBonusV1(db!,{...identity,source_turn_id:f.turn_id,expected_offer_version:0,bonus_offering_codes:['nutricion_alimentacion'],
      outbound:{id,content:'Bonus',provider:'test',integration_id:'test',channel:'whatsapp',destination:'test',idempotency_key:id}});
    if(!offer.ok) throw new Error(offer.reason);
    await db!`UPDATE outbound_deliveries SET state='leased' WHERE message_id=${id}`;
    await db!`UPDATE outbound_deliveries SET state='submitted',submitted_at=now() WHERE message_id=${id}`;
    await db!`UPDATE outbound_deliveries SET state='delivered',delivered_at=now() WHERE message_id=${id}`;
    await db!`UPDATE conversation_sales_context_states_v1 SET selected_offering_code=NULL WHERE conversation_id=${f.conversation_id}`;
    await recordPromotionConversationContextV1(db!,{...identity,discussed_offering_code:'entrenamiento_funcional',source_turn_id:f.turn_id,records_price_objection:false});
    await db!`UPDATE messages SET created_at=clock_timestamp(),metadata=metadata-'occurred_at_trusted' WHERE id=${f.second_turn_id}`;
    vi.stubEnv('COURSE_BONUS_FLOW_MODE',mode==='call'?'direct':mode);
    const question=await commitAgentDecision({turn_id:f.second_turn_id,trace_id:f.trace_id,supports_multi_outbound:true,
      agent_turn_v2:{schema_version:2,proposal:{...f.proposalWithCallOfferAndFalsePrice,
        move:{schema_version:1,move:mode==='call'?'request_call':'ask_course_information',secondary_moves:[],vetoes:[],confidence:1,course_reference:'nutricion_alimentacion'},
        course_mentions:[{offering_code:'nutricion_alimentacion',role:'bonus'}],response:{messages:['Podemos revisar el contenido de Nutrición y Alimentación Saludable.'],call_offer:null},proposed_action:{type:'none'},memory_candidates:[]} as never},
      decision:f.placeholderDecision as never,model:f.model as never});
    expect(question.status).toBe('committed');
    expect((await db!`SELECT status FROM promotion_offers WHERE id=${offer.offer_id}`)[0].status).toBe('offered');
    const [contact]=await db!`SELECT phone FROM contacts WHERE id=${f.contact_id}`;
    const acceptedTurn=await processInboundMessage({schema_version:1,source:'botpress',channel:'whatsapp',integration_id:'vitest-agent-turn-fixture',
      external_message_id:randomUUID(),external_conversation_id:`agent-turn-fixture-${f.trace_id}`,
      external_user_id:`agent-turn-fixture-user-${f.trace_id}`,phone_e164:contact.phone,trace_id:randomUUID(),identity_owner:'agent_a_v1',
      message:{type:'text',text:'Acepto el paquete',occurred_at:new Date().toISOString(),reply_to_external_message_id:null}});
    const later={id:acceptedTurn.turn_id};
    const cap=await readCourseBonusCapabilityV1({workspace_slug:'studyx',contact_id:f.contact_id,conversation_id:f.conversation_id,
      channel:'text',selected_offering_code:null,source_turn_id:later.id},{db:db!});
    expect(cap).toMatchObject({interest_offering_code:'entrenamiento_funcional',promotion_cycle_id:offer.promotion_cycle_id,may_accept_offer:true});
    const rollback=new Error('ROLLBACK_ACCEPTANCE_PROBE');
    await expect(db!.begin(async tx=>{
      expect(await acceptDirectCourseBonusV1(tx,{...identity,...offer,source_turn_id:later.id,expected_offer_version:1})).toMatchObject({ok:true});
      throw rollback;
    })).rejects.toBe(rollback);
    expect((await db!`SELECT selected_offering_code FROM conversation_sales_context_states_v1 WHERE conversation_id=${f.conversation_id}`)[0])
      .toEqual({selected_offering_code:null});
    await recordPromotionConversationContextV1(db!,{...identity,discussed_offering_code:'ingles_2',source_turn_id:later.id,records_price_objection:false});
    const unrelated=await readCourseBonusCapabilityV1({workspace_slug:'studyx',contact_id:f.contact_id,conversation_id:f.conversation_id,
      channel:'text',selected_offering_code:null,source_turn_id:later.id},{db:db!});
    expect(unrelated.promotion_cycle_id ?? null).toBeNull();
    // Rule A counts the whole conversation; changing course does not reset facts.
    expect(unrelated.may_offer_bonus===true).toBe(mode!=='review');
    const unrelatedId=randomUUID();
    if(mode==='review') {
      expect(await offerDirectCourseBonusV1(db!,{...identity,paid_offering_code:'ingles_2',source_turn_id:later.id,
        expected_offer_version:0,bonus_offering_codes:['ingles_3'],outbound:{id:unrelatedId,content:'Bonus',
          provider:'test',integration_id:'test',channel:'whatsapp',destination:'test',idempotency_key:unrelatedId}}))
        .toMatchObject({ok:false,reason:'bonus_disabled'});
    } else {
      const probe=new Error('ROLLBACK_OTHER_COURSE_RULE_A_PROBE');
      await expect(db!.begin(async tx=>{
        expect(await offerDirectCourseBonusV1(tx,{...identity,paid_offering_code:'ingles_2',source_turn_id:later.id,
          expected_offer_version:0,bonus_offering_codes:['ingles_3'],outbound:{id:unrelatedId,content:'Bonus',
            provider:'test',integration_id:'test',channel:'whatsapp',destination:'test',idempotency_key:unrelatedId}})).toMatchObject({ok:true});
        throw probe;
      })).rejects.toBe(probe);
    }
    await recordPromotionConversationContextV1(db!,{...identity,discussed_offering_code:'nutricion_alimentacion',source_turn_id:f.second_turn_id,records_price_objection:false});
    const accepted=await commitAgentDecision({turn_id:later.id,trace_id:randomUUID(),supports_multi_outbound:true,
      agent_turn_v2:{schema_version:2,proposal:{...f.proposalWithCallOfferAndFalsePrice,
        move:{schema_version:1,move:'select_course',secondary_moves:[],vetoes:[],confidence:1,course_reference:'nutricion_alimentacion'},
        course_mentions:[{offering_code:'nutricion_alimentacion',role:'bonus'}],response:{messages:['Entrenamiento Funcional incluye Nutrición y Alimentación Saludable de regalo.'],call_offer:null},
        proposed_action:{type:'accept_promotion',promotion_code:offer.promotion_code,promotion_cycle_id:offer.promotion_cycle_id,
          interest_offering_code:'entrenamiento_funcional',offer_version:1},memory_candidates:[]} as never},
      decision:f.placeholderDecision as never,model:f.model as never});
    expect(accepted.status).toBe('committed');
    expect((await db!`SELECT status FROM promotion_offers WHERE id=${offer.offer_id}`)[0].status).toBe('accepted');
    expect((await db!`SELECT selected_offering_code FROM conversation_sales_context_states_v1 WHERE conversation_id=${f.conversation_id}`)[0])
      .toEqual({selected_offering_code:'entrenamiento_funcional'});
  });
  it('accepts only the existing delivered current package after review rollback',async()=>{
    const f=await fixture();const input=f.input();const first=await offerDirectCourseBonusV1(db!,input);
    expect(first.ok).toBe(true);if(!first.ok) throw new Error('missing offer');
    vi.stubEnv('COURSE_BONUS_FLOW_MODE','review');vi.stubEnv('COURSE_BONUS_MAX_COURSES','1');
    vi.stubEnv('CENTRAL_CARGA_BONUS_ENABLED','false');vi.stubEnv('CENTRAL_CARGA_BONUS_CANARY_CONTACT_IDS','');
    const accept={...f.identity,expected_offer_version:1,source_turn_id:await f.inbound(0)};
    expect(await acceptDirectCourseBonusV1(db!,accept)).toEqual({ok:false,reason:'bonus_without_reply'});
    await f.deliver(input.outbound.id);
    expect(await acceptDirectCourseBonusV1(db!,accept)).toEqual({ok:false,reason:'bonus_without_reply'});
    const later={...accept,source_turn_id:await f.inbound(0)};
    expect(await acceptDirectCourseBonusV1(db!,{...later,expected_offer_version:2})).toEqual({ok:false,reason:'stale_offer_version'});
    expect(await offerDirectCourseBonusV1(db!,f.input(later.source_turn_id,2,1))).toEqual({ok:false,reason:'bonus_disabled'});
    const fresh=await fixture();
    expect(await offerDirectCourseBonusV1(db!,fresh.input())).toEqual({ok:false,reason:'bonus_disabled'});
    expect(await acceptDirectCourseBonusV1(db!,later)).toMatchObject({ok:true,offer_id:first.offer_id,offer_version:1});
    expect(await db!`SELECT position,offering_code_snapshot FROM promotion_offer_bonus_offerings WHERE offer_id=${first.offer_id}`)
      .toEqual([{position:1,offering_code_snapshot:f.courses[1].code}]);
  });
  it('preserves a previously offered two-course package when rollback lowers the new-offer cap to one',async()=>{
    const f=await fixture();const first=f.input();const offer=await offerDirectCourseBonusV1(db!,first);
    expect(offer.ok).toBe(true);if(!offer.ok) throw new Error('missing offer');
    await f.deliver(first.outbound.id);
    const second=f.input(await f.inbound(2),2,1);
    expect(await offerDirectCourseBonusV1(db!,second)).toMatchObject({ok:true,offer_version:2});
    await f.deliver(second.outbound.id);
    vi.stubEnv('COURSE_BONUS_FLOW_MODE','review');vi.stubEnv('COURSE_BONUS_MAX_COURSES','1');
    expect(await acceptDirectCourseBonusV1(db!,{...f.identity,expected_offer_version:2,source_turn_id:await f.inbound(0)}))
      .toMatchObject({ok:true,offer_id:offer.offer_id,offer_version:2});
    expect(await offerDirectCourseBonusV1(db!,f.input(await f.inbound(0),3,2))).toEqual({ok:false,reason:'bonus_disabled'});
  });
  it.each(['interest_current','selected_current','selected_future','selected_foreign'] as const)
  ('price evidence is conversation-level and never needs the promotion-context table (%s)',async scenario=>{
    const f=await seedConversationForAgentTurn({intake_complete:true,first_message:'Me parece caro'});
    await commitAgentDecision({turn_id:f.turn_id,trace_id:f.trace_id,supports_multi_outbound:true,
      agent_turn_v2:{schema_version:2,proposal:{...f.proposalWithCallOfferAndFalsePrice,
        move:{schema_version:1,move:'ask_course_information',secondary_moves:[],vetoes:[],confidence:1,course_reference:'entrenamiento_funcional'},
        response:{messages:['Podemos revisar el contenido.'],call_offer:null},proposed_action:{type:'none'},
        memory_candidates:[{type:'objection',key:'price_objection',value:'precio alto',source_quote:'Me parece caro',confidence:1}]} as never},
      decision:f.placeholderDecision as never,model:f.model as never});
    const course=scenario.endsWith('current')?'ingles_2':'entrenamiento_funcional';
    let evidenceSource=f.second_turn_id;
    if(scenario==='selected_future') {
      const [future]=await db!`INSERT INTO messages(conversation_id,contact_id,direction,content,created_at)
        VALUES (${f.conversation_id},${f.contact_id},'inbound','Más adelante',clock_timestamp()+interval '1 minute') RETURNING id`;
      evidenceSource=future.id;
    }
    if(scenario==='selected_foreign') evidenceSource=(await seedConversationForAgentTurn({intake_complete:true})).turn_id;
    await recordPromotionConversationContextV1(db!,{workspace_id:f.workspace_id,contact_id:f.contact_id,conversation_id:f.conversation_id,
      source_turn_id:evidenceSource,discussed_offering_code:course,records_price_objection:true});
    if(scenario!=='interest_current') await db!`UPDATE conversation_sales_context_states_v1 SET selected_offering_code=${course}
      WHERE conversation_id=${f.conversation_id}`;
    const cap=await readCourseBonusCapabilityV1({workspace_slug:'studyx',contact_id:f.contact_id,conversation_id:f.conversation_id,
      channel:'text',selected_offering_code:scenario==='interest_current'?null:course,source_turn_id:f.second_turn_id},{db:db!});
    // The objection committed on the first turn is persisted price evidence of this conversation.
    expect(cap.ladder).toMatchObject({price_evidence:true,eligible:true});
    const id=randomUUID();
    expect(await offerDirectCourseBonusV1(db!,{workspace_id:f.workspace_id,contact_id:f.contact_id,conversation_id:f.conversation_id,
      paid_offering_code:course,source_turn_id:f.second_turn_id,expected_offer_version:0,
      bonus_offering_codes:[course==='ingles_2'?'ingles_3':'nutricion_alimentacion'],
      outbound:{id,content:'Te sumo el curso complementario.',provider:'test',integration_id:'test',channel:'whatsapp',destination:'test',idempotency_key:id}}))
      .toMatchObject({ok:true});
  });
  it.each([null,'ingles_2'] as const)('retains B prior-objection evidence after a later non-objection turn (selection %s)',async selected=>{
    const f=await seedConversationForAgentTurn({intake_complete:true,first_message:'Me parece caro'});
    const commit=(turn:string,course:string,objection:boolean)=>commitAgentDecision({turn_id:turn,trace_id:randomUUID(),supports_multi_outbound:true,
      agent_turn_v2:{schema_version:2,proposal:{...f.proposalWithCallOfferAndFalsePrice,
        move:{schema_version:1,move:'ask_course_information',secondary_moves:[],vetoes:[],confidence:1,course_reference:course},
        response:{messages:[objection?'Revisemos qué necesitás del curso.':'Podemos continuar por acá.'],call_offer:null},proposed_action:{type:'none'},
        memory_candidates:objection?[{type:'objection',key:'price_objection',value:'precio alto',source_quote:turn===f.turn_id?'Me parece caro':'Dale',confidence:1}]:[]} as never},
      decision:f.placeholderDecision as never,model:f.model as never});
    await commit(f.turn_id,'entrenamiento_funcional',true);
    await commit(f.second_turn_id,'ingles_2',true);
    const [later]=await db!`INSERT INTO messages(conversation_id,contact_id,direction,content)
      VALUES (${f.conversation_id},${f.contact_id},'inbound','Repasemos el contenido') RETURNING id`;
    await recordPromotionConversationContextV1(db!,{workspace_id:f.workspace_id,contact_id:f.contact_id,conversation_id:f.conversation_id,
      source_turn_id:later.id,discussed_offering_code:'ingles_2',records_price_objection:false});
    await db!`UPDATE conversation_sales_context_states_v1 SET selected_offering_code=${selected} WHERE conversation_id=${f.conversation_id}`;
    const [current]=await db!`INSERT INTO messages(conversation_id,contact_id,direction,content)
      VALUES (${f.conversation_id},${f.contact_id},'inbound','El precio sigue frenándome') RETURNING id`;
    await seedPriorModelNegotiation(db!,f);
    expect(await readCourseBonusCapabilityV1({workspace_slug:'studyx',contact_id:f.contact_id,conversation_id:f.conversation_id,
      channel:'text',selected_offering_code:selected,source_turn_id:current.id},{db:db!})).toMatchObject({may_offer_bonus:true,interest_offering_code:'ingles_2'});
    const id=randomUUID();
    const independent=openLocalTestDatabase();
    try {await db!.begin(async tx=>{
      expect(await offerDirectCourseBonusV1(tx,{workspace_id:f.workspace_id,contact_id:f.contact_id,conversation_id:f.conversation_id,
        paid_offering_code:'ingles_2',source_turn_id:current.id,expected_offer_version:0,bonus_offering_codes:['ingles_3'],
        outbound:{id,content:'Te regalo Inglés 1.',provider:'test',integration_id:'test',channel:'whatsapp',destination:'test',idempotency_key:id}}))
        .toMatchObject({ok:true});
      await expect(independent.begin(async race=>{
        await race`SET LOCAL lock_timeout='100ms'`;
        await race`UPDATE conversation_promotion_context_v1 SET source_turn_id=${current.id} WHERE conversation_id=${f.conversation_id}`;
        throw new Error('COMMERCIAL_EVIDENCE_CHANGED_DURING_OFFER');
      })).rejects.toMatchObject({code:'55P03'});
    });} finally {await independent.end();}
  });
  it.each(['selected_other','interest_other','future_source','foreign_source','foreign_contact','current_objection'] as const)
  ('refuses stale or unrelated interest/objection evidence (%s)',async kind=>{
    const f=await seedConversationForAgentTurn({intake_complete:true,first_message:'Me parece caro'});
    await commitAgentDecision({turn_id:f.turn_id,trace_id:f.trace_id,supports_multi_outbound:true,
      agent_turn_v2:{schema_version:2,proposal:{...f.proposalWithCallOfferAndFalsePrice,
        move:{schema_version:1,move:'ask_course_information',secondary_moves:[],vetoes:[],confidence:1,course_reference:'entrenamiento_funcional'},
        response:{messages:['Podemos revisar el contenido.'],call_offer:null},proposed_action:{type:'none'},
        memory_candidates:[{type:'objection',key:'price_objection',value:'precio alto',source_quote:'Me parece caro',confidence:1}]} as never},
      decision:f.placeholderDecision as never,model:f.model as never});
    let contact=f.contact_id;let source=f.second_turn_id;
    if(kind==='selected_other') await db!`UPDATE conversation_sales_context_states_v1 SET selected_offering_code='ingles_2' WHERE conversation_id=${f.conversation_id}`;
    if(kind==='interest_other') await recordPromotionConversationContextV1(db!,{workspace_id:f.workspace_id,contact_id:f.contact_id,
      conversation_id:f.conversation_id,source_turn_id:f.second_turn_id,discussed_offering_code:'ingles_2',records_price_objection:false});
    if(kind==='future_source') {source=f.turn_id;await db!`UPDATE conversation_promotion_context_v1 SET source_turn_id=${f.second_turn_id} WHERE conversation_id=${f.conversation_id}`;}
    if(kind==='foreign_source'||kind==='foreign_contact') {
      const other=await seedConversationForAgentTurn({intake_complete:true});
      if(kind==='foreign_source') await db!`UPDATE conversation_promotion_context_v1 SET source_turn_id=${other.turn_id} WHERE conversation_id=${f.conversation_id}`;
      else contact=other.contact_id;
    }
    if(kind==='current_objection') source=f.turn_id;
    const cap=await readCourseBonusCapabilityV1({workspace_slug:'studyx',contact_id:contact,conversation_id:f.conversation_id,
      channel:'text',selected_offering_code:null,source_turn_id:source},{db:db!});
    // The commercial interest of the conversation is only established by the second turn: at the
    // first turn there is no course to bonify, whatever the price evidence says.
    if (kind !== 'interest_other' && kind !== 'current_objection') expect(cap.may_offer_bonus).not.toBe(true);
    const id=randomUUID();
    expect(await offerDirectCourseBonusV1(db!,{workspace_id:f.workspace_id,contact_id:contact,conversation_id:f.conversation_id,
      paid_offering_code:'entrenamiento_funcional',source_turn_id:source,expected_offer_version:0,bonus_offering_codes:['nutricion_alimentacion'],
      outbound:{id,content:'Te regalo Inglés 1.',provider:'test',integration_id:'test',channel:'whatsapp',destination:'test',idempotency_key:id}}))
      .toMatchObject({ok:false,reason:kind==='current_objection'?'stale_offer_version':'invalid_offering'});
    expect(await db!`SELECT id FROM promotion_offers WHERE conversation_id=${f.conversation_id}`).toHaveLength(0);
  });
  it('authorizes durable interest and committed objection without purchase selection or semantic memory',async()=>{
    const f=await seedConversationForAgentTurn({intake_complete:true,first_message:'Me parece caro'});
    await commitAgentDecision({turn_id:f.turn_id,trace_id:f.trace_id,supports_multi_outbound:true,
      agent_turn_v2:{schema_version:2,proposal:{...f.proposalWithCallOfferAndFalsePrice,
        move:{schema_version:1,move:'ask_course_information',secondary_moves:[],vetoes:[],confidence:1,course_reference:'entrenamiento_funcional'},
        response:{messages:['Podemos revisar el contenido según tu objetivo.'],call_offer:null},proposed_action:{type:'none'},
        memory_candidates:[{type:'objection',key:'price_objection',value:'precio alto',source_quote:'Me parece caro',confidence:1}]} as never},
      decision:f.placeholderDecision as never,model:f.model as never});
    await seedPriorModelNegotiation(db!,f);
    const cap=await readCourseBonusCapabilityV1({workspace_slug:'studyx',contact_id:f.contact_id,conversation_id:f.conversation_id,
      channel:'text',selected_offering_code:null,source_turn_id:f.second_turn_id},{db:db!});
    expect(cap).toMatchObject({interest_offering_code:'entrenamiento_funcional',may_offer_bonus:true});
    const id=randomUUID();
    const independent=openLocalTestDatabase();
    try {
      await db!.begin(async tx=>{
        expect(await offerDirectCourseBonusV1(tx,{workspace_id:f.workspace_id,contact_id:f.contact_id,conversation_id:f.conversation_id,
          paid_offering_code:'entrenamiento_funcional',source_turn_id:f.second_turn_id,expected_offer_version:0,bonus_offering_codes:['nutricion_alimentacion'],
          outbound:{id,content:'Te regalo Inglés 1.',provider:'test',integration_id:'test',channel:'whatsapp',destination:'test',idempotency_key:id}}))
          .toMatchObject({ok:true,offer_version:1});
        await expect(independent.begin(async race=>{
          await race`SET LOCAL lock_timeout='100ms'`;
          await race`UPDATE conversation_promotion_context_v1 SET interest_offering_code='ingles_2' WHERE conversation_id=${f.conversation_id}`;
          throw new Error('INTEREST_CHANGED_WITH_OPEN_OFFER_TRANSACTION');
        })).rejects.toMatchObject({code:'55P03'});
      });
    } finally {await independent.end();}
    expect((await db!`SELECT selected_offering_code FROM conversation_sales_context_states_v1 WHERE conversation_id=${f.conversation_id}`)[0])
      .toEqual({selected_offering_code:null});
  });
  it('runs inside the production-role turn transaction and rolls back a refused append to its savepoint',async()=>{
    const f=await fixture();const first={...f.input(),promotion_code:undefined,promotion_cycle_id:undefined};
    const turn=await f.inbound(2);
    await db!.begin(async tx=>{
      await tx`SET LOCAL ROLE orchestrator_role`;
      const result=await offerDirectCourseBonusV1(tx,first);
      expect(result).toMatchObject({ok:true,offer_version:1});if(!result.ok) throw new Error('missing result');
      const second={...f.input(turn,2,1),promotion_code:result.promotion_code,promotion_cycle_id:result.promotion_cycle_id};
      expect(await offerDirectCourseBonusV1(tx,second)).toEqual({ok:false,reason:'bonus_without_reply'});
      expect((await tx`SELECT count(*)::int AS n FROM messages WHERE id=${second.outbound.id}`)[0].n).toBe(0);
      expect((await tx`SELECT count(*)::int AS n FROM promotion_offer_bonus_offerings WHERE offer_id=${result.offer_id}`)[0].n).toBe(1);
    });
  });

  it('rejects an active gift outside the affinity set before writing effects',async()=>{
    const f=await fixture();const input=f.input(f.source,4);
    expect(await offerDirectCourseBonusV1(db!,input)).toEqual({ok:false,reason:'invalid_offering'});
    expect(await db!`SELECT id FROM promotion_offers WHERE conversation_id=${f.v.id}`).toHaveLength(0);
    expect(await db!`SELECT id FROM messages WHERE id=${input.outbound.id}`).toHaveLength(0);
  });
  it('accepts any affinity-row course (the model chooses, no fixed order) and a course the customer names literally',async()=>{
    const row=await fixture();
    // publicidad_redes_sociales is third in the row, not the "next" of a sequence.
    expect(await offerDirectCourseBonusV1(db!,row.input(row.source,2))).toMatchObject({ok:true,offer_version:1});
    const named=await fixture();
    await db!`UPDATE messages SET content='me interesa tambien Course 4' WHERE id=${named.source}`;
    expect(await offerDirectCourseBonusV1(db!,named.input(named.source,4))).toMatchObject({ok:true,offer_version:1});
  });

  it('rejects an empty reply without persisting an offer',async()=>{
    const f=await fixture();const input=f.input();input.outbound.content=' ';
    expect(await offerDirectCourseBonusV1(db!,input)).toEqual({ok:false,reason:'bonus_without_reply'});
  });

  it('returns the original durable result after catalog deactivation and sanitizes a conflicting delivery key',async()=>{
    const f=await fixture();const input=f.input();const result=await offerDirectCourseBonusV1(db!,input);
    await db!`UPDATE offerings SET status='inactive' WHERE id=${f.courses[0].id}`;
    expect(await offerDirectCourseBonusV1(db!,input)).toEqual(result);
    const other=await fixture();const conflict=other.input();conflict.outbound.idempotency_key=input.outbound.idempotency_key;
    expect(await offerDirectCourseBonusV1(db!,conflict)).toEqual({ok:false,reason:'stale_offer_version'});
    expect((await db!`SELECT count(*)::int AS n FROM messages WHERE id=${conflict.outbound.id}`)[0].n).toBe(0);
  });

  it('creates an internal promotion and cycle without commercial identifiers and replays after cancellation',async()=>{
    const f=await fixture();const input={...f.input(),promotion_code:undefined,promotion_cycle_id:undefined};
    await db!`DELETE FROM promotions WHERE promotion_code=${f.identity.promotion_code}`;
    const result=await offerDirectCourseBonusV1(db!,input);
    expect(result).toMatchObject({ok:true,offer_version:1});if(!result.ok) throw new Error('missing result');
    expect(result.promotion_code).toMatch(/^any_bonus_/u);
    expect(await offerDirectCourseBonusV1(db!,input)).toEqual(result);
    await db!`UPDATE promotion_offers SET status='cancelled',cancel_reason='COURSE_CHANGED' WHERE id=${result.offer_id}`;
    expect(await offerDirectCourseBonusV1(db!,input)).toEqual(result);
  });

  it('requires committed prior evidence rather than the current objection or another conversation',async()=>{
    const f=await fixture(0);
    await db!`UPDATE selected_memories SET source_message_id=${f.source} WHERE conversation_id=${f.v.id}`;
    expect(await offerDirectCourseBonusV1(db!,f.input())).toMatchObject({ok:false,reason:'ladder_step_pending'});
    await db!`UPDATE selected_memories SET source_message_id=${f.source},status='proposed' WHERE conversation_id=${f.v.id}`;
    expect(await offerDirectCourseBonusV1(db!,f.input())).toMatchObject({ok:false,reason:'ladder_step_pending'});
  });

  it('revalidates workspace, selected course, cycle and promotion identities',async()=>{
    const f=await fixture();const first=f.input();await offerDirectCourseBonusV1(db!,first);await f.deliver(first.outbound.id);
    const next=f.input(await f.inbound(2),2,1);
    for(const mutation of [{promotion_cycle_id:randomUUID()},{promotion_code:'wrong'}]) {
      expect(await offerDirectCourseBonusV1(db!,{...next,...mutation})).toEqual({ok:false,reason:'stale_offer_version'});
      expect(await acceptDirectCourseBonusV1(db!,{...f.identity,source_turn_id:next.source_turn_id,expected_offer_version:1,...mutation}))
        .toEqual({ok:false,reason:'stale_offer_version'});
    }
    expect(await offerDirectCourseBonusV1(db!,{...next,workspace_id:randomUUID()})).toEqual({ok:false,reason:'invalid_offering'});
    await db!`UPDATE conversation_sales_context_states_v1 SET selected_offering_code=${f.courses[4].code} WHERE conversation_id=${f.v.id}`;
    expect(await offerDirectCourseBonusV1(db!,next)).toEqual({ok:false,reason:'invalid_offering'});
  });

  it('enforces max one and allows three only with explicit authorization; stale acceptance does not seal an extended package',async()=>{
    const f=await fixture();const first=f.input();await offerDirectCourseBonusV1(db!,first);await f.deliver(first.outbound.id);
    vi.stubEnv('COURSE_BONUS_MAX_COURSES','1');const second=f.input(await f.inbound(2),2,1);
    expect(await offerDirectCourseBonusV1(db!,second)).toEqual({ok:false,reason:'bonus_limit_reached'});
    vi.stubEnv('COURSE_BONUS_MAX_COURSES','3');
    const result=await offerDirectCourseBonusV1(db!,second);expect(result).toMatchObject({ok:true,offer_version:2});
    await f.deliver(second.outbound.id);
    const third=f.input(await f.inbound(3),3,2);
    expect(await offerDirectCourseBonusV1(db!,third)).toMatchObject({ok:true,offer_version:3});
    await f.deliver(third.outbound.id);
    const accept={...f.identity,source_turn_id:await f.inbound(4),expected_offer_version:2};
    expect(await acceptDirectCourseBonusV1(db!,accept)).toEqual({ok:false,reason:'stale_offer_version'});
    expect(await acceptDirectCourseBonusV1(db!,{...accept,expected_offer_version:3})).toMatchObject({ok:true,offer_version:3});
    expect(await offerDirectCourseBonusV1(db!,first)).toMatchObject({ok:true,offer_version:1,outbound_message_id:first.outbound.id});
  });

  it('escalates a delivered package when the customer asks for another promo without a new price objection',async()=>{
    const f=await fixture();
    vi.stubEnv('COURSE_BONUS_MAX_COURSES','3');
    const first=f.input();
    expect(await offerDirectCourseBonusV1(db!,first)).toMatchObject({ok:true,offer_version:1});
    await f.deliver(first.outbound.id);
    const [promoTurn]=await db!`INSERT INTO messages(conversation_id,contact_id,direction,content)
      VALUES (${f.v.id},${f.c.id},'inbound','¿Y otra promo más?') RETURNING id`;
    const second=f.input(promoTurn.id,2,1);
    expect(await offerDirectCourseBonusV1(db!,second)).toMatchObject({ok:true,offer_version:2});
  });

  it.each(['payment_plan','payment_confirmation','contact_details'] as const)('never offers during checkout, decided by state only, even with price evidence and a promo wording (%s)',async awaiting=>{
    const f=await fixture();
    await db!`UPDATE messages SET content='me hacés un descuento? es caro' WHERE id=${f.source}`;
    await db!`UPDATE conversation_sales_context_states_v1 SET awaiting_reply=${awaiting} WHERE conversation_id=${f.v.id}`;
    const input=f.input();
    expect(await offerDirectCourseBonusV1(db!,input)).toEqual({ok:false,reason:'sale_already_closed'});
    expect(await db!`SELECT id FROM promotion_offers WHERE conversation_id=${f.v.id}`).toHaveLength(0);
  });
  it('retention: a quoted purchase decline offers one bonus without price evidence, once per conversation',async()=>{
    const f=await fixture(0);
    vi.stubEnv('COURSE_BONUS_MAX_COURSES','3');
    await db!`UPDATE messages SET content='No gracias, lo dejo' WHERE id=${f.source}`;
    // Without the model's declaration there is no permission.
    expect(await offerDirectCourseBonusV1(db!,f.input())).toMatchObject({ok:false,reason:'ladder_step_pending',
      ladder:{price_evidence:false,retention_decline:false}});
    await recordModelPriceObjection(db!,f.source,{key:'purchase_decline',source_quote:'No gracias, lo dejo'});
    const first=f.input();
    expect(await offerDirectCourseBonusV1(db!,first)).toMatchObject({ok:true,offer_version:1});
    await f.deliver(first.outbound.id);
    // A second decline, even quoted, cannot reuse it; and it grants nothing else.
    const again=await f.inbound(0);
    await db!`UPDATE messages SET content='No, de verdad no' WHERE id=${again}`;
    await recordModelPriceObjection(db!,again,{key:'purchase_decline',source_quote:'No, de verdad no'});
    expect(await offerDirectCourseBonusV1(db!,f.input(again,2,1))).toMatchObject({ok:false,reason:'ladder_step_pending',
      ladder:{retention_used:true,retention_decline:false,price_evidence:false}});
  });
  it('retention: a decline quote that is not in the customer batch grants nothing',async()=>{
    const f=await fixture(0);
    await recordModelPriceObjection(db!,f.source,{key:'purchase_decline',source_quote:'No gracias, lo dejo'});
    expect(await offerDirectCourseBonusV1(db!,f.input())).toMatchObject({ok:false,reason:'ladder_step_pending',
      ladder:{retention_decline:false}});
  });
  it('retention does not block a later price-evidence bonus',async()=>{
    const f=await fixture(0);
    vi.stubEnv('COURSE_BONUS_MAX_COURSES','3');
    await recordModelPriceObjection(db!,f.source,{key:'purchase_decline'});
    const first=f.input();
    expect(await offerDirectCourseBonusV1(db!,first)).toMatchObject({ok:true,offer_version:1});
    await f.deliver(first.outbound.id);
    const later=await f.inbound(2);
    expect(await offerDirectCourseBonusV1(db!,f.input(later,2,1))).toMatchObject({ok:true,offer_version:2});
  });

  it('delivers a second and third bonus, refuses a fourth, and cancels the open package when the paid course changes',async()=>{
    const f=await fixture();
    vi.stubEnv('COURSE_BONUS_MAX_COURSES','3');

    const first=f.input();
    expect(await offerDirectCourseBonusV1(db!,first)).toMatchObject({ok:true,offer_version:1});
    await f.deliver(first.outbound.id);

    const second=f.input(await f.inbound(2),2,1);
    expect(await offerDirectCourseBonusV1(db!,second)).toMatchObject({ok:true,offer_version:2});
    await f.deliver(second.outbound.id);

    const third=f.input(await f.inbound(3),3,2);
    expect(await offerDirectCourseBonusV1(db!,third)).toMatchObject({ok:true,offer_version:3});
    await f.deliver(third.outbound.id);

    const fourth=f.input(await f.inbound(4),4,3);
    expect(await offerDirectCourseBonusV1(db!,fourth)).toEqual({ok:false,reason:'bonus_limit_reached'});
    expect((await db!`SELECT count(*)::int AS count FROM promotion_offer_bonus_offerings
      WHERE offer_id=(SELECT id FROM promotion_offers WHERE promotion_cycle_id=${f.identity.promotion_cycle_id})`)[0].count).toBe(3);
    expect((await db!`SELECT offer_version,status FROM promotion_offers
      WHERE promotion_cycle_id=${f.identity.promotion_cycle_id}`)[0]).toEqual({offer_version:3,status:'offered'});

    expect(await cancelOpenCourseBonusOffersForCourseChangeV1(db!,{
      ...f.identity,
      selected_offering_code:f.courses[4].code as string,
    })).toBe(1);
    expect((await db!`SELECT status,cancel_reason FROM promotion_offers
      WHERE promotion_cycle_id=${f.identity.promotion_cycle_id}`)[0])
      .toEqual({status:'cancelled',cancel_reason:'CUSTOMER_CHANGED_COURSE'});
  });

  it('persists one durable result, replays exactly, seals delivered current version and preserves accepted obligations', async () => {
    const f=await fixture();const input=f.input();
    const result=await offerDirectCourseBonusV1(db!,input);
    expect(result).toMatchObject({ok:true,offer_version:1,outbound_message_id:input.outbound.id});
    expect(await offerDirectCourseBonusV1(db!,input)).toEqual(result);
    expect(await offerDirectCourseBonusV1(db!,{...input,outbound:{...input.outbound,content:'Different'}}))
      .toMatchObject({ok:false,reason:'multiple_bonus_in_turn'});
    await f.deliver(input.outbound.id);
    const turn=await f.inbound(2);const accept={...f.identity,source_turn_id:turn,expected_offer_version:1};
    expect(await acceptDirectCourseBonusV1(db!,{...accept,expected_offer_version:0})).toEqual({ok:false,reason:'stale_offer_version'});
    const accepted=await acceptDirectCourseBonusV1(db!,accept);
    expect(accepted).toMatchObject({ok:true,offer_version:1});
    expect(await acceptDirectCourseBonusV1(db!,accept)).toEqual(accepted);
    expect(await acceptDirectCourseBonusV1(db!,{...accept,source_turn_id:await f.inbound(3)}))
      .toEqual({ok:false,reason:'sale_already_closed'});
    const [row]=await db!`SELECT status,bonus_snapshot_sealed_at FROM promotion_offers WHERE promotion_cycle_id=${f.identity.promotion_cycle_id}`;
    expect(row.status).toBe('accepted');expect(row.bonus_snapshot_sealed_at).toBeInstanceOf(Date);
    expect(await cancelOpenCourseBonusOffersForCourseChangeV1(db!,{...f.identity,selected_offering_code:f.courses[4].code})).toBe(0);
    expect((await db!`SELECT count(*)::int AS count FROM messages WHERE id=${input.outbound.id}`)[0].count).toBe(1);
  });

  it.each(['ladder_step_pending','invalid_offering','same_as_paid_course','multiple_bonus_in_turn','sale_already_closed','stale_offer_version'] as const)
  ('rejects %s before writing a cycle or outbound', async reason => {
    const f=await fixture(reason==='ladder_step_pending'?0:3);const input=f.input();
    if(reason==='invalid_offering') input.bonus_offering_codes=['missing'];
    if(reason==='same_as_paid_course') input.bonus_offering_codes=[f.courses[0].code];
    if(reason==='multiple_bonus_in_turn') input.bonus_offering_codes.push(f.courses[2].code);
    if(reason==='sale_already_closed') await db!`UPDATE conversation_sales_context_states_v1 SET stage='closed' WHERE conversation_id=${f.v.id}`;
    if(reason==='stale_offer_version') input.expected_offer_version=1;
    expect(await offerDirectCourseBonusV1(db!,input)).toMatchObject({ok:false,reason});
    expect((await db!`SELECT count(*)::int AS n FROM promotion_offers WHERE promotion_cycle_id=${f.identity.promotion_cycle_id}`)[0].n).toBe(0);
    expect((await db!`SELECT count(*)::int AS n FROM messages WHERE id=${input.outbound.id}`)[0].n).toBe(0);
  });

  it.each(['pending','submitted','failed_retryable','dead_letter','early'] as const)('refuses append and acceptance with %s delivery evidence',async state=>{
    const f=await fixture();const first=f.input();await offerDirectCourseBonusV1(db!,first);
    const turn=await f.inbound(2);
    if(state==='submitted') {
      await db!`UPDATE outbound_deliveries SET state='leased' WHERE message_id=${first.outbound.id}`;
      await db!`UPDATE outbound_deliveries SET state='submitted' WHERE message_id=${first.outbound.id}`;
    }
    if(state==='dead_letter') await db!`UPDATE outbound_deliveries SET state='dead_letter' WHERE message_id=${first.outbound.id}`;
    if(state==='failed_retryable') {
      await db!`UPDATE outbound_deliveries SET state='leased' WHERE message_id=${first.outbound.id}`;
      await db!`UPDATE outbound_deliveries SET state='failed_retryable' WHERE message_id=${first.outbound.id}`;
    }
    if(state==='early') {
      await db!`UPDATE messages SET metadata=${db!.json({occurred_at_trusted:true,occurred_at:new Date(Date.now()-5000).toISOString()})} WHERE id=${turn}`;
      await f.deliver(first.outbound.id);
    }
    const next=f.input(turn,2,1);
    expect(await offerDirectCourseBonusV1(db!,next)).toEqual({ok:false,reason:'bonus_without_reply'});
    expect(await acceptDirectCourseBonusV1(db!,{...f.identity,source_turn_id:turn,expected_offer_version:1}))
      .toEqual({ok:false,reason:'bonus_without_reply'});
    expect((await db!`SELECT count(*)::int AS n FROM messages WHERE id=${next.outbound.id}`)[0].n).toBe(0);
  });

  it('rejects duplicate gifts and serializes independent contenders at the runtime limit',async()=>{
    const f=await fixture();const first=f.input();await offerDirectCourseBonusV1(db!,first);await f.deliver(first.outbound.id);
    const turn=await f.inbound(2);
    expect(await offerDirectCourseBonusV1(db!,f.input(turn,1,1))).toEqual({ok:false,reason:'duplicate_bonus'});
    const independent=openLocalTestDatabase();
    try {
      const results=await Promise.all([offerDirectCourseBonusV1(db!,f.input(turn,2,1)),offerDirectCourseBonusV1(independent,f.input(turn,2,1))]);
      expect(results.filter(r=>r.ok), JSON.stringify(results)).toHaveLength(1);
      expect(results.filter(r=>!r.ok)).toEqual([{ok:false,reason:'stale_offer_version'}]);
      const success=results.find(r=>r.ok)!;if(!success.ok) throw new Error('missing result');
      await f.deliver(success.outbound_message_id);
      expect(await offerDirectCourseBonusV1(db!,f.input(await f.inbound(3),4,2))).toEqual({ok:false,reason:'bonus_limit_reached'});
      expect((await db!`SELECT count(*)::int AS n FROM promotion_offer_bonus_offerings WHERE offer_id=${success.offer_id}`)[0].n).toBe(2);
    } finally {await independent.end();}
  });
});
