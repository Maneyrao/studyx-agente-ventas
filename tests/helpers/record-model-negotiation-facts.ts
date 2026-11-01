import { jsonbParam } from '@/lib/db/json';
import { randomUUID } from 'node:crypto';
import type { DbClient } from '@/lib/db/types';

/** Rule 10 fixtures: committed model observations, never a legacy-memory bypass.
 * User-authorized backend implementation of prompt-agente-a-studyx-v2.md:106-120. */
export async function recordModelPriceObjection(db: DbClient, turnId: string, options: { memory?: boolean; source_quote?: string; call_offer?: boolean; action?: 'schedule_price_objection_checkin' | 'request_promotion_review' } = {}): Promise<void> {
  await db`INSERT INTO agent_decisions(turn_id,trace_id,schema_version,intent,decision_kind,response,response_type,
    memory_candidates,business_action,next_state,reason_code,confidence,model_provider,model_name,prompt_version,payload_hash)
    VALUES (${turnId}::uuid,${randomUUID()}::uuid,4,'commercial','reply','Revisemos tu consulta.',${options.call_offer?'call_offer':'commercial_reply'},
      ${jsonbParam(db,options.memory===false?[]:[{type:'objection',key:'price_objection',value:'precio',source_quote:options.source_quote??'Customer',confidence:1}])}::jsonb,
      ${options.action?jsonbParam(db,{type:options.action}):null}::jsonb,
      'waiting_user','MODEL_PRICE_OBJECTION',1,'offline','fixture','fixture',decode(repeat('00',32),'hex'))`;
}
export async function seedPriorModelNegotiation(db: DbClient, input: {
  workspace_id:string;contact_id:string;conversation_id:string;
}, count=3): Promise<string[]> {
  const turns:string[]=[];
  for(let index=0;index<count;index+=1) {
    const [turn]=await db`INSERT INTO messages(conversation_id,contact_id,direction,content,created_at)
      VALUES (${input.conversation_id}::uuid,${input.contact_id}::uuid,'inbound','Customer',
        now() - (10-${index}) * interval '1 minute') RETURNING id`;
    await recordModelPriceObjection(db,turn.id);
    turns.push(turn.id);
  }
  await db`UPDATE conversation_sales_context_states_v1 SET call_offer_status='offered',call_offer_count=1
    WHERE workspace_id=${input.workspace_id}::uuid AND conversation_id=${input.conversation_id}::uuid AND contact_id=${input.contact_id}::uuid`;
  return turns;
}
