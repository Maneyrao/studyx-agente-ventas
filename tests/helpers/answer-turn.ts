import { randomUUID } from 'node:crypto';
import type { DbClient } from '@/lib/db/types';

/**
 * Records that the agent answered an inbound turn (owner 2026-11-10): the
 * current intervention stops at the latest answered message, and "answered"
 * is a durable decision, never an outbound timestamp.
 */
export async function answerTurn(db: DbClient, turnId: string): Promise<void> {
  await db`INSERT INTO agent_decisions(turn_id,trace_id,schema_version,intent,decision_kind,response,response_type,
      business_action,memory_candidates,missing_information,next_state,reason_code,confidence,
      model_provider,model_name,prompt_version,payload_hash)
    VALUES (${turnId}::uuid,${randomUUID()}::uuid,4,'commercial','reply','Respuesta','commercial_reply',
      NULL,'[]'::jsonb,ARRAY[]::text[],'waiting_user','TEST_ANSWERED',1,'test','test-model','test',
      decode(repeat('00',32),'hex'))`;
}
