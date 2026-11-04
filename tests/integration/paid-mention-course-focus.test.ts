import { afterAll, describe, expect, it } from 'vitest';
import { commitAgentDecision } from '@/lib/services/decision.service';
import { seedConversationForAgentTurn } from '../helpers/agent-turn-fixtures';
import { openLocalTestDatabase } from '../helpers/db';

const run=process.env.TEST_DATABASE_URL?describe:describe.skip;
const db=process.env.TEST_DATABASE_URL?openLocalTestDatabase():null;
afterAll(async()=>db?.end());
type Fixture=Awaited<ReturnType<typeof seedConversationForAgentTurn>>;
function request(f:Fixture,turn:string,code:string,role:'paid'|'bonus'='paid'){
  return {turn_id:turn,trace_id:f.trace_id,supports_multi_outbound:true,
    agent_turn_v2:{schema_version:2 as const,proposal:{...f.proposalWithCallOfferAndFalsePrice,
      move:{schema_version:1,move:'ask_course_information',secondary_moves:[],vetoes:[],course_reference:'entrenamiento_funcional',confidence:1},
      response:{messages:[code==='ingles_1'?'Inglés 1 puede servirte.':'Entrenamiento Funcional puede servirte.'],call_offer:null},
      proposed_action:{type:'none'},course_mentions:[{offering_code:code,role}],memory_candidates:[]} as never},
    decision:f.placeholderDecision as never,model:f.model as never};
}
run('paid mention identity uses the same server course focus as the claim',()=>{
  it.each(['current','history'] as const)('delivers a legitimate paid mention without creating purchase selection or a bonus: %s',async source=>{
    const f=await seedConversationForAgentTurn({selected_offering_code:null,first_message:'Quiero información de Entrenamiento Funcional.'});
    const turn=source==='current'?f.turn_id:f.second_turn_id;
    const result=await commitAgentDecision(request(f,turn,'entrenamiento_funcional'));
    expect(result.status).toBe('committed');
    expect(result.outbounds.map(outbound=>outbound.content)).toEqual(['Entrenamiento Funcional puede servirte.']);
    expect((await db!`SELECT selected_offering_code,selected_payment_plan FROM conversation_sales_context_states_v1 WHERE conversation_id=${f.conversation_id}`)[0])
      .toMatchObject({selected_offering_code:null,selected_payment_plan:null});
    expect(await db!`SELECT id FROM promotion_offers WHERE conversation_id=${f.conversation_id}`).toHaveLength(0);
    expect((await db!`SELECT business_action FROM agent_decisions WHERE turn_id=${turn}`)[0].business_action).toBeNull();
  });
  it('does not let an unauthorized bonus use the conversational identity',async()=>{
    const f=await seedConversationForAgentTurn({selected_offering_code:null,first_message:'Quiero información de Entrenamiento Funcional.'});
    await expect(commitAgentDecision(request(f,f.turn_id,'ingles_1','bonus'))).rejects.toMatchObject({subjects:expect.arrayContaining(['forbidden_promise'])});
    expect(await db!`SELECT id FROM agent_decisions WHERE turn_id=${f.turn_id}`).toHaveLength(0);
  });
  it('downgrades a paid declaration for another recommended course to metadata when nothing is persisted',async()=>{
    const f=await seedConversationForAgentTurn({selected_offering_code:null,first_message:'Quiero información de Entrenamiento Funcional.'});
    const result=await commitAgentDecision(request(f,f.turn_id,'ingles_1'));
    expect(result.status).toBe('committed');
    expect((await db!`SELECT selected_offering_code FROM conversation_sales_context_states_v1 WHERE conversation_id=${f.conversation_id}`)[0])
      .toMatchObject({selected_offering_code:null});
  });
});
