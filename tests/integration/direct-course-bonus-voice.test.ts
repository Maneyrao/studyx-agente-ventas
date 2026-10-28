import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openLocalTestDatabase } from '../helpers/db';
import { acceptDirectCourseBonusByVoiceV1, offerDirectCourseBonusV1 } from '@/features/promotions/application/direct-course-bonus-service';
import { PostgresRetellOrchestrationStore } from '@/features/calls/adapters/postgres-retell-orchestration-store';
import { hashCallContext } from '@/features/calls/domain/call-context';

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const db = process.env.TEST_DATABASE_URL ? openLocalTestDatabase() : null;
afterAll(async () => db?.end());
beforeEach(() => {
  vi.stubEnv('COURSE_BONUS_FLOW_MODE', 'direct');
  vi.stubEnv('COURSE_BONUS_MAX_COURSES', '3');
  vi.stubEnv('CENTRAL_CARGA_BONUS_ENABLED', 'true');
});
afterEach(() => vi.unstubAllEnvs());

async function fixture() {
  const slug = randomUUID();
  const [w] = await db!`INSERT INTO workspaces(slug,display_name) VALUES (${slug},'Voice') RETURNING id`;
  const [c] = await db!`INSERT INTO contacts(phone,channel_origin,name,email) VALUES
    (${'+' + String(Math.floor(100000000000 + Math.random()*800000000000))},'whatsapp','Ana Perez','ana@example.com') RETURNING id`;
  await db!`INSERT INTO workspace_contacts(workspace_id,contact_id) VALUES (${w.id},${c.id})`;
  const [v] = await db!`INSERT INTO conversations(contact_id,channel) VALUES (${c.id},'whatsapp') RETURNING id`;
  const courses = await db!`INSERT INTO offerings(workspace_id,code,display_name,offering_type,status,description,price_type,price_amount,currency,billing_interval)
    SELECT ${w.id}, ${slug} || n,'Course ' || n,'course','active','Course','fixed',360,'USD','one_time' FROM generate_series(0,3) n RETURNING id,code`;
  await db!`INSERT INTO conversation_sales_context_states_v1(workspace_id,conversation_id,contact_id,selected_offering_code,selected_payment_plan)
    VALUES (${w.id},${v.id},${c.id},${courses[0].code},'one_time')`;
  async function inbound(prior = false) {
    const [m] = await db!`INSERT INTO messages(conversation_id,contact_id,direction,content,created_at)
      VALUES (${v.id},${c.id},'inbound','Customer',clock_timestamp() - ${prior ? 10 : 0} * interval '1 second') RETURNING id`;
    return m.id as string;
  }
  const prior = await inbound(true);
  await db!`INSERT INTO selected_memories(contact_id,conversation_id,source_message_id,status,memory_type,memory_key,value_normalized,source_quote,confidence,dedupe_hash)
    VALUES (${c.id},${v.id},${prior},'active','objection','price_objection','expensive','Customer',0.9,${'a'.repeat(64)})`;
  const source = await inbound();
  const identity = {workspace_id:w.id as string,contact_id:c.id as string,conversation_id:v.id as string,paid_offering_code:courses[0].code as string};
  const callId = randomUUID(); const context = {call_id:callId,nombre_lead:'Ana Perez',curso_interes:courses[0].code,pais:'',email_lead:'ana@example.com',resumen_whatsapp:'Call',prompt_version:'test'};
  await db!`INSERT INTO call_sessions(id,workspace_id,source_turn_id,contact_id,conversation_id,provider,provider_call_id,request_idempotency_key,status,consent_source_message_id,context_snapshot,context_hash,prompt_version)
    VALUES (${callId},${w.id},${source},${c.id},${v.id},'retell',${randomUUID()},${randomUUID()},'in_progress',${source},${db!.json(context)},decode(${hashCallContext(context)},'hex'),'test')`;
  const sent = vi.fn(async (input: unknown) => {
    expect(input).toBeDefined();
    return {outcome:'sent',channel:'whatsapp',deliveryId:randomUUID(),providerMessageId:randomUUID()} as never;
  });
  const store = new PostgresRetellOrchestrationStore(db!,{paymentLinkResolver:{resolve:()=> 'https://buy.stripe.com/test_voice'},sendOutbound:sent});
  const common = {callId,contactId:c.id as string,conversationId:v.id as string,workspaceSlug:slug,course:courses[0].code as string};
  let offer: {offer_id:string;promotion_code:string;promotion_cycle_id:string;offer_version:number} | undefined;
  async function append(n:number, delivered=true) {
    const id=randomUUID();
    const result=await offerDirectCourseBonusV1(db!,{...identity,source_turn_id:await inbound(),expected_offer_version:n-1,
      ...(offer ? {promotion_code:offer.promotion_code,promotion_cycle_id:offer.promotion_cycle_id}:{}),bonus_offering_codes:[courses[n].code as string],
      outbound:{id,content:'Bonus',provider:'test',integration_id:'test',channel:'whatsapp',destination:'test',idempotency_key:id}});
    if(!result.ok) throw new Error(result.reason); offer=result;
    if(delivered) {
      await db!`UPDATE outbound_deliveries SET state='leased' WHERE message_id=${id}`;
      await db!`UPDATE outbound_deliveries SET state='submitted',submitted_at=clock_timestamp() WHERE message_id=${id}`;
      await db!`UPDATE outbound_deliveries SET state='delivered',delivered_at=clock_timestamp() WHERE message_id=${id}`;
    }
    return result;
  }
  const first = await append(1);
  const payment = (version=offer!.offer_version) => ({...common,paymentPlan:'one_time' as const,promotionCode:offer!.promotion_code,
    promotionCycleId:offer!.promotion_cycle_id,acceptedOfferVersion:version,acceptPromotion:true});
  return {store,common,identity,first,append,payment,sent,inbound,courses,source};
}

run('direct course bonus voice continuity',()=>{
  it('refuses ordinary checkout when the model omits every promotion field of an offered package',async()=>{
    const f=await fixture();
    expect(await f.store.requestAgentAPaymentLink({...f.common,paymentPlan:'one_time'}))
      .toMatchObject({sent:false,reason:'PROMOTION_ACCEPTANCE_REQUIRED'});
    expect(f.sent).not.toHaveBeenCalled();
    expect(await db!`SELECT id FROM payments WHERE contact_id=${f.common.contactId}`).toHaveLength(0);
  });
  it('automatically preserves an already accepted exact package when every promotion field is omitted',async()=>{
    const f=await fixture();
    expect(await acceptDirectCourseBonusByVoiceV1(db!,{...f.identity,...f.first,source_turn_id:f.source,
      expected_offer_version:1,call_id:f.common.callId})).toMatchObject({ok:true});
    expect(await f.store.requestAgentAPaymentLink({...f.common,paymentPlan:'one_time'})).toMatchObject({sent:true});
    const [payment]=await db!`SELECT id,promotion_offer_id,promotion_cycle_id,accepted_offer_version FROM payments WHERE contact_id=${f.common.contactId}`;
    expect(payment).toMatchObject({promotion_offer_id:f.first.offer_id,promotion_cycle_id:f.first.promotion_cycle_id,accepted_offer_version:1});
    expect(await db!`SELECT offering_code_snapshot FROM payment_bonus_offerings WHERE payment_id=${payment.id}`)
      .toEqual([{offering_code_snapshot:f.courses[1].code}]);
  });
  it('cancels an offered package atomically when voice changes A to B to A without recreating inbound chat',async()=>{
    const f=await fixture();
    const before=await db!`SELECT id FROM messages WHERE conversation_id=${f.common.conversationId} AND direction='inbound'`;
    expect(await f.store.recordConfirmedSelection({...f.common,course:f.courses[3].code})).toMatchObject({recorded:true});
    expect(await f.store.recordConfirmedSelection(f.common)).toMatchObject({recorded:true});
    expect(await f.store.readCourseBonusPromotion(f.common)).toBeNull();
    expect((await db!`SELECT status FROM promotion_offers WHERE id=${f.first.offer_id}`)[0].status).toBe('cancelled');
    expect(await db!`SELECT call_id FROM voice_course_selections WHERE conversation_id=${f.common.conversationId}`).toHaveLength(2);
    expect(await db!`SELECT id FROM messages WHERE conversation_id=${f.common.conversationId} AND direction='inbound'`).toEqual(before);
  });
  it('supersedes the exact existing checkout with current voice selection evidence and never retargets it',async()=>{
    const f=await fixture();
    expect(await f.store.requestAgentAPaymentLink(f.payment())).toMatchObject({sent:true});
    const [before]=await db!`SELECT * FROM payments WHERE promotion_offer_id=${f.first.offer_id}`;
    await db!`SET ROLE orchestrator_role`;
    try {
      expect(await f.store.recordConfirmedSelection({...f.common,course:f.courses[3].code})).toMatchObject({recorded:true});
    } finally { await db!`RESET ROLE`; }
    const [supersession]=await db!`SELECT s.*,e.call_id,e.selected_offering_code FROM payment_intent_supersessions s
      JOIN voice_course_selections e ON e.id=s.source_voice_selection_id WHERE s.payment_id=${before.id}`;
    expect(supersession).toMatchObject({payment_id:before.id,source_turn_id:null,call_id:f.common.callId,
      original_offering_id:f.courses[0].id,replacement_offering_id:f.courses[3].id,selected_offering_code:f.courses[3].code});
    expect((await db!`SELECT * FROM payments WHERE id=${before.id}`)[0]).toEqual(before);
    expect(await f.store.recordConfirmedSelection(f.common)).toMatchObject({recorded:true});
    expect(await f.store.readCourseBonusPromotion(f.common)).toBeNull();
    expect(await f.store.requestAgentAPaymentLink({...f.common,paymentPlan:'one_time'})).toMatchObject({sent:false});
    expect(await db!`SELECT id FROM payments WHERE contact_id=${f.common.contactId}`).toHaveLength(1);
  });
  it('rolls back voice selection, supersession and context together when checkout conflicts',async()=>{
    const f=await fixture();
    expect(await f.store.requestAgentAPaymentLink(f.payment())).toMatchObject({sent:true});
    const [before]=await db!`SELECT * FROM conversation_sales_context_states_v1 WHERE conversation_id=${f.common.conversationId}`;
    expect(await f.store.requestAgentAPaymentLink({...f.common,course:f.courses[3].code,paymentPlan:'one_time'}))
      .toMatchObject({sent:false,reason:'IDEMPOTENCY_KEY_CONFLICT'});
    expect((await db!`SELECT * FROM conversation_sales_context_states_v1 WHERE conversation_id=${f.common.conversationId}`)[0]).toEqual(before);
    expect(await db!`SELECT id FROM voice_course_selections WHERE conversation_id=${f.common.conversationId}`).toHaveLength(0);
    expect(await db!`SELECT id FROM payment_intent_supersessions WHERE contact_id=${f.common.contactId}`).toHaveLength(0);
    expect(f.sent).toHaveBeenCalledTimes(1);
  });
  it('does not overwrite a newer voice course selection when the older checkout delivery finishes',async()=>{
    const f=await fixture();
    f.sent.mockImplementationOnce(async()=>{
      expect(await f.store.recordConfirmedSelection({...f.common,course:f.courses[3].code})).toMatchObject({recorded:true});
      return {outcome:'sent',channel:'whatsapp',deliveryId:null,providerMessageId:'voice-race'} as never;
    });
    expect(await f.store.requestAgentAPaymentLink(f.payment())).toMatchObject({sent:true});
    const [state]=await db!`SELECT selected_offering_code FROM conversation_sales_context_states_v1 WHERE conversation_id=${f.common.conversationId}`;
    expect(state.selected_offering_code).toBe(f.courses[3].code);
    expect(await db!`SELECT id FROM payment_intent_supersessions WHERE contact_id=${f.common.contactId}`).toHaveLength(1);
    expect(await f.store.readCourseBonusPromotion(f.common)).toBeNull();
  });
  it('rejects stale or wrong-call voice selection evidence without changing the selected course',async()=>{
    const f=await fixture();
    const [before]=await db!`SELECT selected_offering_code,version FROM conversation_sales_context_states_v1 WHERE conversation_id=${f.common.conversationId}`;
    await expect(db!`INSERT INTO voice_course_selections(call_id,workspace_id,contact_id,conversation_id,previous_offering_code,selected_offering_code,expected_state_version)
      VALUES (${f.common.callId},${f.identity.workspace_id},${f.common.contactId},${f.common.conversationId},${before.selected_offering_code},${f.courses[3].code},${Number(before.version)+1})`).rejects.toThrow('Voice selection identity mismatch');
    expect(await f.store.recordConfirmedSelection({...f.common,callId:randomUUID(),course:f.courses[3].code})).toMatchObject({recorded:false});
    expect((await db!`SELECT selected_offering_code,version FROM conversation_sales_context_states_v1 WHERE conversation_id=${f.common.conversationId}`)[0]).toEqual(before);
    expect(await db!`SELECT id FROM voice_course_selections WHERE conversation_id=${f.common.conversationId}`).toHaveLength(0);
  });
  it('preserves ordinary no-promotion checkout after a confirmed course selection',async()=>{
    const f=await fixture(); const ordinary={...f.common,course:f.courses[3].code};
    expect(await f.store.recordConfirmedSelection(ordinary)).toMatchObject({recorded:true});
    expect(await f.store.requestAgentAPaymentLink({...ordinary,paymentPlan:'one_time'})).toMatchObject({sent:true});
    const [payment]=await db!`SELECT promotion_offer_id,promotion_cycle_id FROM payments WHERE contact_id=${f.common.contactId}`;
    expect(payment).toEqual({promotion_offer_id:null,promotion_cycle_id:null});
  });
  it('reads the exact text package without sealing or mutating it',async()=>{
    const f=await fixture(); const second=await f.append(2);
    const [before]=await db!`SELECT * FROM promotion_offers WHERE id=${second.offer_id}`;
    expect(await f.store.readCourseBonusPromotion(f.common)).toMatchObject({promotionCode:second.promotion_code,promotionCycleId:second.promotion_cycle_id,offerVersion:2,
      bonusOfferings:f.courses.slice(1,3).map(c=>({code:c.code,displayName:`Course ${f.courses.indexOf(c)}`}))});
    expect((await db!`SELECT * FROM promotion_offers WHERE id=${second.offer_id}`)[0]).toEqual(before);
  });
  it('rejects stale versions, missing explicit acceptance and wrong-call correlation without sending',async()=>{
    const f=await fixture(); await f.append(2);
    expect(await f.store.requestAgentAPaymentLink(f.payment(1))).toMatchObject({sent:false,reason:'stale_offer_version'});
    expect(await f.store.requestAgentAPaymentLink({...f.payment(),acceptPromotion:false})).toMatchObject({sent:false});
    expect(await f.store.requestAgentAPaymentLink({...f.payment(),callId:randomUUID()})).toMatchObject({sent:false});
    expect(f.sent).not.toHaveBeenCalled();
    expect(await db!`SELECT offer_id FROM promotion_voice_acceptances WHERE offer_id=${f.first.offer_id}`).toHaveLength(0);
  });
  it('durably accepts only the delivered current version, returns checkout to the original chat and replays exactly',async()=>{
    const f=await fixture(); const second=await f.append(2);
    const beforeMessages=await db!`SELECT id FROM messages WHERE conversation_id=${f.common.conversationId} AND direction='inbound'`;
    expect(await f.store.requestAgentAPaymentLink(f.payment())).toMatchObject({sent:true});
    expect(f.sent.mock.calls[0][0]).toMatchObject({conversationId:f.common.conversationId,contactId:f.common.contactId});
    expect(await db!`SELECT id FROM messages WHERE conversation_id=${f.common.conversationId} AND direction='inbound'`).toEqual(beforeMessages);
    const [evidence]=await db!`SELECT * FROM promotion_voice_acceptances WHERE offer_id=${second.offer_id}`;
    expect(evidence).toMatchObject({call_id:f.common.callId,offer_version:2,conversation_id:f.common.conversationId,contact_id:f.common.contactId});
    const [payment]=await db!`SELECT id,promotion_cycle_id,accepted_offer_version FROM payments WHERE promotion_offer_id=${second.offer_id}`;
    expect(payment).toMatchObject({promotion_cycle_id:second.promotion_cycle_id,accepted_offer_version:2});
    expect(await db!`SELECT offering_code_snapshot FROM payment_bonus_offerings WHERE payment_id=${payment.id} ORDER BY position`).toEqual(f.courses.slice(1,3).map(c=>({offering_code_snapshot:c.code})));
    expect(await f.store.requestAgentAPaymentLink(f.payment())).toMatchObject({sent:true});
    vi.stubEnv('COURSE_BONUS_FLOW_MODE','review');
    expect(await f.store.requestAgentAPaymentLink(f.payment())).toMatchObject({sent:true});
    expect(await f.store.readCourseBonusPromotion(f.common)).toMatchObject({offerVersion:2,promotionCycleId:second.promotion_cycle_id});
    expect(await db!`SELECT offer_id FROM promotion_voice_acceptances WHERE offer_id=${second.offer_id}`).toHaveLength(1);
    await expect(db!`UPDATE promotion_voice_acceptances SET offer_version=1 WHERE offer_id=${second.offer_id}`).rejects.toThrow();
    await expect(db!`UPDATE promotion_offers SET offer_version=3 WHERE id=${second.offer_id}`).rejects.toThrow();
  });
  it('does not accept the current version before confirmed delivery',async()=>{
    const f=await fixture(); await f.append(2,false);
    expect(await f.store.requestAgentAPaymentLink(f.payment())).toMatchObject({sent:false,reason:'bonus_without_reply'});
    expect(f.sent).not.toHaveBeenCalled();
  });
  it('accepts through the production orchestrator role with durable voice evidence',async()=>{
    const f=await fixture();
    await db!.begin(async tx=>{
      await tx`SET LOCAL ROLE orchestrator_role`;
      expect(await acceptDirectCourseBonusByVoiceV1(tx,{...f.identity,...f.first,
        source_turn_id:f.source,expected_offer_version:1,call_id:f.common.callId})).toMatchObject({ok:true});
    });
    expect(await f.store.requestAgentAPaymentLink(f.payment())).toMatchObject({sent:true});
  });
  it('rejects fabricated cross-scope evidence and replay from another valid call',async()=>{
    const f=await fixture();
    await expect(db!`INSERT INTO promotion_voice_acceptances(offer_id,call_id,workspace_id,contact_id,conversation_id,promotion_cycle_id,offer_version)
      VALUES (${f.first.offer_id},${f.common.callId},${f.identity.workspace_id},${f.common.contactId},${randomUUID()},${f.first.promotion_cycle_id},1)`).rejects.toThrow();
    expect(await f.store.requestAgentAPaymentLink(f.payment())).toMatchObject({sent:true});
    await db!`UPDATE call_sessions SET status='completed' WHERE id=${f.common.callId}`;
    const otherCall=randomUUID(); const source=await f.inbound();
    await db!`INSERT INTO call_sessions(id,workspace_id,source_turn_id,contact_id,conversation_id,provider,provider_call_id,request_idempotency_key,status,consent_source_message_id,context_snapshot,context_hash,prompt_version)
      SELECT ${otherCall},workspace_id,${source},contact_id,conversation_id,provider,${randomUUID()},${randomUUID()},'in_progress',${source},context_snapshot,context_hash,prompt_version
      FROM call_sessions WHERE id=${f.common.callId}`;
    expect(await acceptDirectCourseBonusByVoiceV1(db!,{...f.identity,...f.first,source_turn_id:source,expected_offer_version:1,call_id:otherCall}))
      .toMatchObject({ok:false,reason:'stale_offer_version'});
    const [evidence]=await db!`SELECT call_id FROM promotion_voice_acceptances WHERE offer_id=${f.first.offer_id}`;
    expect(evidence.call_id).toBe(f.common.callId);
  });
});
