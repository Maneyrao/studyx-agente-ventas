import { afterEach, describe, expect, it, vi } from 'vitest';
import { commitAgentDecision, recordDeliveryReport } from '@/lib/services/decision.service';
import * as capability from '@/features/promotions/application/read-course-bonus-capability';
import { seedConversationForAgentTurn } from '../helpers/agent-turn-fixtures';
import { sql } from '@/lib/db/orchestrator';
import { jsonbParam } from '@/lib/db/json';
import { offerDirectCourseBonusV1 } from '@/features/promotions/application/direct-course-bonus-service';
import { randomUUID } from 'node:crypto';
import { processInboundMessage } from '@/lib/services/ingestion.service';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
run('direct decision atomic repair', () => {
  it('does not let a current-turn objection memory authorize its own first gift', async () => {
    vi.stubEnv('CENTRAL_CARGA_BONUS_ENABLED','true');vi.stubEnv('COURSE_BONUS_FLOW_MODE','direct');vi.stubEnv('COURSE_BONUS_MAX_COURSES','2');
    const f=await seedConversationForAgentTurn({selected_offering_code:'entrenamiento_funcional',intake_complete:true});
    await sql`INSERT INTO selected_memories(contact_id,conversation_id,source_message_id,status,memory_type,memory_key,value_normalized,source_quote,confidence,dedupe_hash)
      VALUES (${f.contact_id},${f.conversation_id},${f.turn_id},'active','objection','price_objection','caro','Me parece caro',1,${'c'.repeat(64)})`;
    expect(await capability.readCourseBonusCapabilityV1({workspace_slug:'studyx',contact_id:f.contact_id,
      conversation_id:f.conversation_id,channel:'text',selected_offering_code:'entrenamiento_funcional',source_turn_id:f.turn_id},{db:sql}))
      .toMatchObject({enabled:true,max_bonus_courses:2,may_offer_bonus:false,may_request_review:false});
  });
  it.each(['direct','review','review_pending'] as const)('reserves one outbound and preserves exact delivery authority in %s mode', async mode => {
    vi.stubEnv('CENTRAL_CARGA_BONUS_ENABLED','true');vi.stubEnv('COURSE_BONUS_FLOW_MODE','direct');vi.stubEnv('COURSE_BONUS_MAX_COURSES','2');
    const f = await seedConversationForAgentTurn({selected_offering_code:'entrenamiento_funcional',intake_complete:true});
    const [prior] = await sql`INSERT INTO messages(conversation_id,contact_id,direction,content,created_at)
      VALUES (${f.conversation_id},${f.contact_id},'inbound','Me parece caro',now()-interval '1 hour') RETURNING id`;
    await sql`INSERT INTO selected_memories(contact_id,conversation_id,source_message_id,status,memory_type,memory_key,value_normalized,source_quote,confidence,dedupe_hash)
      VALUES (${f.contact_id},${f.conversation_id},${prior.id},'active','objection','price_objection','caro','Me parece caro',1,${'b'.repeat(64)})`;
    const proposal = {...f.proposalWithCallOfferAndFalsePrice,response:{messages:['El total es USD 360.','Entrenamiento Funcional e Inglés 1 quedan incluidos en el paquete.'],call_offer:'Si querés, puedo llamarte para asesorarte.'},
      proposed_action:{type:'offer_course_bonus',interest_offering_code:'entrenamiento_funcional',bonus_offering_code:'ingles_1'}};
    const input = {turn_id:f.turn_id,trace_id:f.trace_id,supports_multi_outbound:true,
      authorized_offering_code:'entrenamiento_funcional',authorized_payment_plan:null,
      agent_turn_v2:{schema_version:2 as const,proposal:proposal as never},decision:f.placeholderDecision as never,model:f.model as never};
    const result = await commitAgentDecision(input);
    expect(result.outbounds).toHaveLength(1);
    const id=result.outbounds[0].id;
    expect((await sql`SELECT count(*)::int n FROM messages WHERE in_reply_to=${f.turn_id}`)[0].n).toBe(1);
    const pending = await capability.readCourseBonusCapabilityV1({workspace_slug:'studyx',contact_id:f.contact_id,
      conversation_id:f.conversation_id,channel:'text',selected_offering_code:'entrenamiento_funcional',source_turn_id:f.second_turn_id},{db:sql});
    expect(pending).toMatchObject({offer_version:1,may_offer_bonus:false,may_accept_offer:false,delivered_bonus_offerings:[]});
    expect(pending.promotion_cycle_id).toMatch(/^[0-9a-f-]{36}$/u);
    const cloneWithAction = async (action:Record<string,unknown>) => {
      const accepted = new Error('ROLL_BACK_SYNTHETIC_ACCEPTED_DECISION');
      try { await sql.begin(async tx => {
      await tx`INSERT INTO agent_decisions
      (turn_id,trace_id,schema_version,intent,decision_kind,response,response_type,business_action,
       memory_candidates,missing_information,next_state,reason_code,confidence,model_provider,model_name,prompt_version,payload_hash)
      SELECT ${f.second_turn_id},trace_id,schema_version,intent,decision_kind,response,response_type,${jsonbParam(tx,action)},
       memory_candidates,missing_information,next_state,reason_code,confidence,model_provider,model_name,prompt_version,payload_hash
      FROM agent_decisions WHERE turn_id=${f.turn_id}`;
      throw accepted;
      }); } catch(error) { if (error === accepted) return []; throw error; }
    };
    for (const action of [
      {type:'accept_promotion',offer_version:1},
      {type:'accept_promotion',promotion_code:'p',promotion_cycle_id:pending.promotion_cycle_id,
        interest_offering_code:'entrenamiento_funcional',offer_version:1,unknown:true},
      {type:'offer_course_bonus',interest_offering_code:'entrenamiento_funcional'},
    ]) await expect(cloneWithAction(action)).rejects.toMatchObject({code:'23514',constraint_name:'agent_decisions_business_action_check'});
    for (const promotion_code of ['   ','\t','\n',' \t\n ']) {
      await expect(cloneWithAction({type:'accept_promotion',promotion_code,promotion_cycle_id:pending.promotion_cycle_id,
        interest_offering_code:'entrenamiento_funcional',offer_version:1})).rejects.toMatchObject({code:'23514'});
    }
    expect(await cloneWithAction({type:'accept_promotion'})).toEqual([]);
    const report = {outbound_id:id,trace_id:f.trace_id,status:'submitted_to_botpress' as const,
      botpress_message_id:`confirmed-bonus-${f.trace_id}`,replayed:false,error_code:null,delivery_attempt:1};
    await expect(recordDeliveryReport({...report,status:'delivered',delivered_at:new Date().toISOString()}))
      .rejects.toMatchObject({code:'DELIVERY_REPORT_CONFLICT'});
    await recordDeliveryReport(report);
    for (const invalid of [
      {...report,status:'delivered' as const},
      {...report,status:'delivered' as const,delivered_at:'2000-01-01T00:00:00.000Z'},
      {...report,status:'delivered' as const,delivered_at:new Date().toISOString(),botpress_message_id:'wrong-provider-id'},
    ]) await expect(recordDeliveryReport(invalid)).rejects.toMatchObject({code:'DELIVERY_REPORT_CONFLICT'});
    expect((await sql`SELECT delivered_at FROM promotion_offer_bonus_offerings WHERE offered_outbound_message_id=${id}`)[0].delivered_at).toBeNull();
    // Keep receipt/source/outbound ordering on the PostgreSQL clock. A Node
    // receipt a few milliseconds ahead can fabricate a future fixture inbound.
    const [receiptClock]=await sql<Array<{delivered_at:string}>>`
      SELECT to_char(timezone('UTC',clock_timestamp()),'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS delivered_at`;
    const receipt = {...report,status:'delivered' as const,delivered_at:receiptClock.delivered_at};
    expect(await recordDeliveryReport(receipt)).toMatchObject({status:'recorded'});
    expect(await recordDeliveryReport(receipt)).toMatchObject({status:'duplicate'});
    await expect(recordDeliveryReport({...report,status:'failed',error_code:'DOWNGRADE'}))
      .rejects.toMatchObject({code:'DELIVERY_REPORT_CONFLICT'});
    expect((await sql`SELECT delivered_at FROM promotion_offer_bonus_offerings WHERE offered_outbound_message_id=${id}`)[0].delivered_at).not.toBeNull();
    await expect(recordDeliveryReport({...receipt,delivered_at:new Date(Date.now()+1000).toISOString()})).rejects.toMatchObject({code:'DELIVERY_REPORT_CONFLICT'});
    // Move the fixture's second inbound to the actual later receipt moment.
    await sql`UPDATE messages SET created_at=GREATEST(clock_timestamp(),
      (SELECT delivered_at+interval '1 microsecond' FROM outbound_deliveries WHERE message_id=${id})),metadata=metadata-'occurred_at_trusted'
      WHERE id=${f.second_turn_id}`;
    const delivered = await capability.readCourseBonusCapabilityV1({workspace_slug:'studyx',contact_id:f.contact_id,
      conversation_id:f.conversation_id,channel:'text',selected_offering_code:'entrenamiento_funcional',source_turn_id:f.second_turn_id},{db:sql});
    expect(delivered).toMatchObject({may_accept_offer:true,may_offer_bonus:true,offer_version:1,
      delivered_bonus_offerings:[{code:'ingles_1'}]});
    if(mode==='review_pending') {
      const secondId=randomUUID();
      const second=await offerDirectCourseBonusV1(sql,{workspace_id:f.workspace_id,contact_id:f.contact_id,conversation_id:f.conversation_id,
        source_turn_id:f.second_turn_id,paid_offering_code:'entrenamiento_funcional',promotion_code:delivered.promotion_code,
        promotion_cycle_id:delivered.promotion_cycle_id,expected_offer_version:1,bonus_offering_codes:['excel_integral'],
        outbound:{id:secondId,content:'Excel Integral de regalo.',provider:'test',integration_id:'test',channel:'whatsapp',destination:'test',idempotency_key:secondId}});
      expect(second,JSON.stringify(second)).toMatchObject({ok:true,offer_version:2});
      const [contact]=await sql`SELECT phone FROM contacts WHERE id=${f.contact_id}`;
      const later=await processInboundMessage({schema_version:1,source:'botpress',channel:'whatsapp',integration_id:'vitest-agent-turn-fixture',
        external_message_id:randomUUID(),external_conversation_id:`agent-turn-fixture-${f.trace_id}`,
        external_user_id:`agent-turn-fixture-user-${f.trace_id}`,phone_e164:contact.phone,trace_id:randomUUID(),identity_owner:'agent_a_v1',
        message:{type:'text',text:'Acepto',occurred_at:new Date().toISOString(),reply_to_external_message_id:null}});
      vi.stubEnv('COURSE_BONUS_FLOW_MODE','review');vi.stubEnv('CENTRAL_CARGA_BONUS_ENABLED','false');
      const commit=(action:Record<string,unknown>,content:string)=>commitAgentDecision({...input,turn_id:later.turn_id,agent_turn_v2:{schema_version:2,
        proposal:{...proposal,proposed_action:action,response:{messages:[content],call_offer:null}} as never}});
      await expect(commit({type:'none'},'Excel Integral queda incluido.')).rejects.toMatchObject({subjects:expect.arrayContaining(['forbidden_promise'])});
      await expect(commit({type:'accept_promotion',interest_offering_code:'entrenamiento_funcional',promotion_code:delivered.promotion_code,
        promotion_cycle_id:delivered.promotion_cycle_id,offer_version:2},'Seguimos con el paquete.')).rejects.toThrow();
      expect((await commit({type:'none'},'Inglés 1 sigue incluido.')).status).toBe('committed');
      expect((await sql`SELECT status,offer_version FROM promotion_offers WHERE promotion_cycle_id=${delivered.promotion_cycle_id ?? null}`)[0])
        .toMatchObject({status:'offered',offer_version:2});
      return;
    }
    // A stale preliminary capability must not survive a stricter final runtime limit.
    vi.spyOn(capability,'readCourseBonusCapabilityV1').mockResolvedValue(delivered);
    vi.stubEnv('COURSE_BONUS_MAX_COURSES','1');
    await expect(commitAgentDecision({...input,turn_id:f.second_turn_id,agent_turn_v2:{schema_version:2,
      proposal:{...proposal,proposed_action:{type:'offer_course_bonus',interest_offering_code:'entrenamiento_funcional',bonus_offering_code:'excel_integral'},
        response:{messages:['Inglés 1 sigue incluido. Excel Integral queda bonificado.'],call_offer:null}} as never}}))
      .rejects.toMatchObject({subjects:['forbidden_promise','direct_bonus:bonus_limit_reached']});
    expect((await sql`SELECT count(*)::int n FROM messages WHERE in_reply_to=${f.second_turn_id}`)[0].n).toBe(0);
    expect((await sql`SELECT count(*)::int n FROM promotion_offer_bonus_offerings WHERE offered_outbound_message_id=${id}`)[0].n).toBe(1);
    vi.restoreAllMocks();vi.stubEnv('COURSE_BONUS_MAX_COURSES','2');
    vi.stubEnv('COURSE_BONUS_FLOW_MODE',mode);
    if (mode === 'review') {
      vi.stubEnv('CENTRAL_CARGA_BONUS_ENABLED','false');
      vi.stubEnv('CENTRAL_CARGA_BONUS_CANARY_CONTACT_IDS','');
      expect(await capability.readCourseBonusCapabilityV1({workspace_slug:'studyx',contact_id:f.contact_id,
        conversation_id:f.conversation_id,channel:'text',selected_offering_code:'entrenamiento_funcional',source_turn_id:f.second_turn_id},{db:sql}))
        .toMatchObject({enabled:false,may_offer_bonus:false,may_accept_offer:true,offer_version:1});
    }
    const action = {type:'accept_promotion',interest_offering_code:'entrenamiento_funcional',promotion_code:delivered.promotion_code,
      promotion_cycle_id:delivered.promotion_cycle_id,offer_version:1};
    const accepted=await commitAgentDecision({...input,turn_id:f.second_turn_id,agent_turn_v2:{schema_version:2,
      proposal:{...proposal,proposed_action:action,response:{messages:['El total es USD 360. Entrenamiento Funcional e Inglés 1 están incluidos en el paquete.'],call_offer:null}} as never}});
    expect(accepted.status).toBe('committed');
    expect(accepted.outbounds[0].content).toBe('El total es USD 360. Entrenamiento Funcional e Inglés 1 están incluidos en el paquete.');
    expect((await sql`SELECT status,bonus_snapshot_sealed_at FROM promotion_offers WHERE promotion_cycle_id=${delivered.promotion_cycle_id ?? null}`)[0])
      .toMatchObject({status:'accepted',bonus_snapshot_sealed_at:expect.any(Date)});
  });
  it('rolls back a final rejection, then commits and queues the useful Agent A rewrite', async () => {
    vi.stubEnv('CENTRAL_CARGA_BONUS_ENABLED','true');
    vi.stubEnv('COURSE_BONUS_FLOW_MODE','direct');
    vi.stubEnv('COURSE_BONUS_MAX_COURSES','2');
    const f = await seedConversationForAgentTurn({selected_offering_code:'entrenamiento_funcional',intake_complete:true});
    // Simulate a capability that became stale before final transactional validation.
    vi.spyOn(capability,'readCourseBonusCapabilityV1').mockResolvedValue({
      status:'checkin_available', enabled:true, max_bonus_courses:2, may_offer_bonus:true,
      may_schedule_checkin:false,may_request_review:false,may_accept_offer:false,
      may_send_promoted_payment:false,promotion_code:null,interest_offering_code:'entrenamiento_funcional',
      offer_version:0,bonus_offerings:[],delivered_bonus_offerings:[],
    });
    const proposal = {...f.proposalWithCallOfferAndFalsePrice,
      response:{messages:['El total es USD 360. Inglés 1 queda bonificado.'],call_offer:null},
      proposed_action:{type:'offer_course_bonus',interest_offering_code:'entrenamiento_funcional',bonus_offering_code:'ingles_1'}};
    const input = {turn_id:f.turn_id,trace_id:f.trace_id,supports_multi_outbound:true,
      authorized_offering_code:'entrenamiento_funcional',authorized_payment_plan:null,
      agent_turn_v2:{schema_version:2 as const,proposal:proposal as never},
      decision:f.placeholderDecision as never,model:f.model as never};
    await expect(commitAgentDecision(input)).rejects.toMatchObject({
      reason:'AGENT_TURN_V2_REJECTED:COMMERCIAL_TRUTH_VIOLATION',
      subjects:['forbidden_promise','direct_bonus:no_price_objection'],
    });
    expect((await sql`SELECT count(*)::int n FROM agent_decisions WHERE turn_id=${f.turn_id}`)[0].n).toBe(0);
    expect((await sql`SELECT count(*)::int n FROM messages WHERE in_reply_to=${f.turn_id}`)[0].n).toBe(0);
    const repaired = await commitAgentDecision({...input,agent_turn_v2:{schema_version:2,proposal:{...proposal,
      proposed_action:{type:'none'},response:{messages:['El total es USD 360. Podemos ver qué contenido te sirve para tu objetivo.'],call_offer:null}} as never}});
    expect(repaired.status).toBe('committed');
    expect(repaired.outbounds).toHaveLength(1);
    expect((await sql`SELECT d.state,e.state AS outbox_state FROM outbound_deliveries d
      JOIN outbox_events e ON e.delivery_id=d.id WHERE d.message_id=${repaired.outbounds[0].id}`)[0])
      .toMatchObject({state:'leased',outbox_state:'leased'});
  });
});
