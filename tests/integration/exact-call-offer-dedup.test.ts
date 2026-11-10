import { afterAll, describe, expect, it } from 'vitest';
import { commitAgentDecision, recordDeliveryReport } from '@/lib/services/decision.service';
import { seedConversationForAgentTurn } from '../helpers/agent-turn-fixtures';
import { openLocalTestDatabase } from '../helpers/db';

const run=process.env.TEST_DATABASE_URL?describe:describe.skip;
const db=process.env.TEST_DATABASE_URL?openLocalTestDatabase():null;
afterAll(async()=>db?.end());

run('exact call delivery copies (explicit technical authorization 2026-11-01)',()=>{
  it.each(['only','first','last'] as const)('saves and delivers one invitation and advances the ledger once: %s',async position=>{
    const f=await seedConversationForAgentTurn({selected_offering_code:'entrenamiento_funcional',intake_complete:true,
      call_offer_count:0,first_message:'Quiero conocer el contenido del curso.'});
    const invitation='Si querés, podemos verlo en una llamada corta. Te sirve?';
    const explanation='Podemos revisar cómo encaja con tu objetivo.';
    const messages=position==='only'?[invitation]:position==='first'?[invitation,explanation]:[explanation,invitation];
    const raw={...f.proposalWithCallOfferAndFalsePrice,
      move:{schema_version:1,move:'ask_course_information',secondary_moves:[],vetoes:[],course_reference:'entrenamiento_funcional',confidence:1},
      response:{messages,call_offer:invitation},proposed_action:{type:'none'},course_mentions:[],memory_candidates:[]};
    const before=structuredClone(raw);
    const result=await commitAgentDecision({turn_id:f.turn_id,trace_id:f.trace_id,supports_multi_outbound:true,
      agent_turn_v2:{schema_version:2,proposal:raw as never},decision:f.placeholderDecision as never,model:f.model as never});
    const expected=position==='only'?[invitation]:[explanation,invitation];
    expect(result.outbounds.map(outbound=>outbound.content)).toEqual(expected);
    const stored=await db!`SELECT id,content FROM messages WHERE in_reply_to=${f.turn_id} AND direction='outbound'`;
    expect(stored).toHaveLength(expected.length);
    const storedById=new Map(stored.map(row=>[row.id,row.content]));
    // The authorized outbound plan owns delivery order; outbound rows may
    // share a null conversation_seq and must not be ordered by heap position.
    expect(result.outbounds.map(outbound=>storedById.get(outbound.id))).toEqual(expected);
    expect((await db!`SELECT response FROM agent_decisions WHERE turn_id=${f.turn_id}`)[0].response).toBe(expected.join('\n\n'));
    expect(raw).toEqual(before);
    for(const outbound of result.outbounds){
      const submitted={outbound_id:outbound.id,trace_id:f.trace_id,status:'submitted_to_botpress' as const,
        botpress_message_id:`exact-call-${outbound.id}`,replayed:false,error_code:null,delivery_attempt:outbound.delivery_attempt};
      await recordDeliveryReport(submitted);
      const [clock]=await db!`SELECT to_char(timezone('UTC',clock_timestamp()),'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS delivered_at`;
      const receipt={...submitted,status:'delivered' as const,delivered_at:clock.delivered_at};
      await recordDeliveryReport(receipt);
      await recordDeliveryReport(receipt);
    }
    expect((await db!`SELECT call_offer_count,call_offer_status FROM conversation_sales_context_states_v1 WHERE conversation_id=${f.conversation_id}`)[0])
      .toMatchObject({call_offer_count:1,call_offer_status:'offered'});
  });
});
