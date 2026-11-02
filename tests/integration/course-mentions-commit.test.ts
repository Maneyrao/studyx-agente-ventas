import { randomUUID } from 'node:crypto';
import { afterAll,afterEach,describe,it,expect,vi } from 'vitest';
import { commitAgentDecision } from '@/lib/services/decision.service';
import { offerDirectCourseBonusV1 } from '@/features/promotions/application/direct-course-bonus-service';
import { seedConversationForAgentTurn } from '../helpers/agent-turn-fixtures';
import { seedPriorModelNegotiation } from '../helpers/record-model-negotiation-facts';
import { openLocalTestDatabase } from '../helpers/db';
const run=process.env.TEST_DATABASE_URL?describe:describe.skip;
const db=process.env.TEST_DATABASE_URL?openLocalTestDatabase():null;
afterAll(async()=>db?.end());afterEach(()=>vi.unstubAllEnvs());
type Fixture=Awaited<ReturnType<typeof seedConversationForAgentTurn>>;
function input(f:Fixture,proposal:Record<string,unknown>,turn=f.turn_id) {
  return {turn_id:turn,trace_id:f.trace_id,supports_multi_outbound:true,
    agent_turn_v2:{schema_version:2 as const,proposal:{...f.proposalWithCallOfferAndFalsePrice,
      move:{schema_version:1,move:'ask_course_information',secondary_moves:[],vetoes:[],course_reference:'entrenamiento_funcional',confidence:1},
      response:{messages:['Entrenamiento Funcional puede servirte.'],call_offer:null},proposed_action:{type:'none'},memory_candidates:[],...proposal} as never},
    decision:f.placeholderDecision as never,model:f.model as never};
}
async function noEffects(f:Fixture,turn=f.turn_id) {
  expect(await db!`SELECT id FROM agent_decisions WHERE turn_id=${turn}`).toHaveLength(0);
  expect(await db!`SELECT id FROM messages WHERE in_reply_to=${turn} AND direction='outbound'`).toHaveLength(0);
  expect(await db!`SELECT id FROM promotion_offer_bonus_offerings WHERE source_turn_id=${turn}`).toHaveLength(0);
}
run('mandatory course role commit boundary (authority prompt:123,129; spec:59-71)',()=>{
  it.each(['bubble','call_offer','conversation_only'] as const)('rejects undeclared additional canonical names in %s without effects',async where=>{
    const f=await seedConversationForAgentTurn({selected_offering_code:'entrenamiento_funcional',intake_complete:true});
    const request=input(f,{response:where==='call_offer'?{messages:['Entrenamiento Funcional puede servirte.'],call_offer:'Podemos revisar Inglés 1 por teléfono.'}
      :{messages:['Entrenamiento Funcional puede servirte.','También Inglés 1.'],call_offer:null}});
    if(where==='conversation_only') Object.assign(request.agent_turn_v2,{conversation_only:true});
    await expect(commitAgentDecision(request)).rejects.toMatchObject({code:'DECISION_REJECTED',reason:'AGENT_TURN_V2_REJECTED:COURSE_ROLE_UNDECLARED'});
    await noEffects(f);
  });
  it('does not let a stale primary declaration override fresh selected state',async()=>{
    const f=await seedConversationForAgentTurn({selected_offering_code:'entrenamiento_funcional',intake_complete:true});
    await db!`UPDATE conversation_sales_context_states_v1 SET selected_offering_code='ingles_1' WHERE conversation_id=${f.conversation_id}`;
    await expect(commitAgentDecision(input(f,{course_mentions:[{offering_code:'entrenamiento_funcional',role:'paid'}]})))
      .rejects.toMatchObject({code:'DECISION_REJECTED',reason:'AGENT_TURN_V2_REJECTED:COURSE_ROLE_UNDECLARED'});
    await noEffects(f);
    expect((await db!`SELECT selected_offering_code FROM conversation_sales_context_states_v1 WHERE conversation_id=${f.conversation_id}`)[0].selected_offering_code).toBe('ingles_1');
  });
  it('accepts an explicit separately paid complement without creating a bonus',async()=>{
    const f=await seedConversationForAgentTurn({selected_offering_code:'entrenamiento_funcional',intake_complete:true});
    const result=await commitAgentDecision(input(f,{response:{messages:['Entrenamiento Funcional e Inglés 1 son opciones para estudiar.'],call_offer:null},
      course_mentions:[{offering_code:'ingles_1',role:'paid_complement'}]}));
    expect(result.status).toBe('committed');
    expect(await db!`SELECT id FROM promotion_offers WHERE conversation_id=${f.conversation_id}`).toHaveLength(0);
  });
  it('accepts a new paid role only when that same canonical course selection is committed',async()=>{
    const f=await seedConversationForAgentTurn({selected_offering_code:'entrenamiento_funcional',intake_complete:true});
    const result=await commitAgentDecision(input(f,{move:{schema_version:1,move:'select_course',secondary_moves:[],vetoes:[],course_reference:'ingles_1',confidence:1},
      response:{messages:['Inglés 1 puede servirte.'],call_offer:null},course_mentions:[{offering_code:'ingles_1',role:'paid'}]}));
    expect(result.status).toBe('committed');
    expect((await db!`SELECT selected_offering_code FROM conversation_sales_context_states_v1 WHERE conversation_id=${f.conversation_id}`)[0].selected_offering_code).toBe('ingles_1');
  });
  it.each(['pending','cancelled','delivered'] as const)('authorizes a bonus recap only from a confirmed current package: %s',async status=>{
    vi.stubEnv('CENTRAL_CARGA_BONUS_ENABLED','true');vi.stubEnv('COURSE_BONUS_FLOW_MODE','direct');vi.stubEnv('COURSE_BONUS_MAX_COURSES','3');
    const f=await seedConversationForAgentTurn({selected_offering_code:'entrenamiento_funcional',intake_complete:true});
    await seedPriorModelNegotiation(db!,f);
    const id=randomUUID();const offer=await offerDirectCourseBonusV1(db!,{...f,paid_offering_code:'entrenamiento_funcional',source_turn_id:f.turn_id,expected_offer_version:0,
      bonus_offering_codes:['nutricion_alimentacion'],outbound:{id,content:'Paquete autorizado',provider:'test',integration_id:'test',channel:'whatsapp',destination:'test',idempotency_key:id}});
    if(!offer.ok) throw new Error(offer.reason);
    if(status==='delivered') {
      await db!`UPDATE outbound_deliveries SET state='leased' WHERE message_id=${id}`;
      await db!`UPDATE outbound_deliveries SET state='submitted',submitted_at=now() WHERE message_id=${id}`;
      await db!`UPDATE outbound_deliveries SET state='delivered',delivered_at=now() WHERE message_id=${id}`;
    }
    if(status==='cancelled') await db!`UPDATE promotion_offers SET status='cancelled',cancel_reason='COURSE_CHANGED' WHERE id=${offer.offer_id}`;
    await db!`UPDATE messages SET created_at=clock_timestamp(),metadata=metadata-'occurred_at_trusted' WHERE id=${f.second_turn_id}`;
    const request=input(f,{response:{messages:['Entrenamiento Funcional incluye Nutrición y Alimentación Saludable.'],call_offer:null},course_mentions:[{offering_code:'nutricion_alimentacion',role:'bonus'}]},f.second_turn_id);
    if(status==='delivered') expect((await commitAgentDecision(request)).status).toBe('committed');
    else {await expect(commitAgentDecision(request)).rejects.toMatchObject({code:'DECISION_REJECTED',reason:'AGENT_TURN_V2_REJECTED:COMMERCIAL_TRUTH_VIOLATION',subjects:expect.arrayContaining(['forbidden_promise'])});await noEffects(f,f.second_turn_id);}
  });
});
