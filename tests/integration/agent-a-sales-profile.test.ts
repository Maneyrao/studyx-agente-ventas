import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { processInboundMessage, type InboundEnvelope } from '@/lib/services/ingestion.service';
import { commitAgentDecision, type CommitDecisionInput } from '@/lib/services/decision.service';
import { sql } from '@/lib/db/orchestrator';
import { openLocalTestDatabase } from '../helpers/db';
import { readSalesProfileMemoriesV1 } from '@/features/conversation/application/read-sales-profile';

const db = openLocalTestDatabase();
const ownedTurnIds: string[] = [];
afterAll(async () => {
  // These tests inspect the immutable record, not the asynchronous memory worker.
  // Leave its shared fixture queue and recall pool clear for the worker's own tests.
  try {
    if (ownedTurnIds.length) {
      await db`DELETE FROM agent_a_memory_projection_jobs WHERE turn_id=ANY(${ownedTurnIds}::uuid[])`;
      await db`DELETE FROM selected_memories WHERE source_message_id=ANY(${ownedTurnIds}::uuid[])`;
    }
  } finally { await db.end(); await sql.end(); }
});

function identity() {
  const id = randomUUID();
  return { conversation: `negotiation-${id}`, user: `user-${id}`, phone: `+54911${Math.floor(10000000 + Math.random() * 89999999)}` };
}

async function inbound(id: ReturnType<typeof identity>, text: string) {
  const result = await processInboundMessage({ schema_version: 1, source: 'botpress', channel: 'emulator',
    integration_id: 'vitest-negotiation', external_message_id: randomUUID(),
    external_conversation_id: id.conversation, external_user_id: id.user, phone_e164: id.phone,
    trace_id: randomUUID(), sandbox_provider: null,
    message: { type: 'text', text, occurred_at: new Date().toISOString(),
      reply_to_external_message_id: null, audio_reference: null, metadata: {} },
  } as InboundEnvelope);
  ownedTurnIds.push(result.turn_id);
  return result;
}

function input(turnId: string, candidates: Array<Record<string, unknown>>): CommitDecisionInput {
  return { turn_id: turnId, trace_id: randomUUID(), authorized_offering_code: null, authorized_payment_plan: null,
    conversation_pipeline_v1: null, supports_multi_outbound: true,
    agent_turn_v2: { schema_version: 2, proposal: { schema_version: 1,
      move: { schema_version: 1, move: 'select_course', secondary_moves: [], vetoes: [],
        course_reference: 'fotografia_profesional', confidence: 1 },
      response: { messages: ['Genial, cuéntame más sobre eso.'], call_offer: null },
      proposed_action: { type: 'none' }, used_fact_ids: [], used_memory_ids: [],
      profile_updates: [], profile_requests: [], repair_of: null,
      memory_candidates: candidates,
    } as never },
    decision: { schema_version: 4, intent: 'commercial', kind: 'reply', response: 'El backend preparará la respuesta autorizada.',
      response_type: 'commercial_reply', business_action: null, memory_candidates: [], missing_information: [],
      next_state: 'waiting_user', reason_code: 'CONVERSATION_PIPELINE_V1_PENDING_BACKEND', confidence: 1, retrieval_used: null },
    model: { provider: 'botpress', model: 'offline-test', prompt_version: 'offline-test' },
  };
}

describe('sales profile memories (persisted model interpretation)', () => {
  it('returns the latest objective and objection of the conversation with their literal quotes', async () => {
    const id = identity();
    const first = await inbound(id, 'Quiero trabajar con marcas. Me interesa Fotografía Profesional.');
    await commitAgentDecision(input(first.turn_id, [
      { type: 'study_goal', key: 'work_goal', value: 'trabajar con marcas', source_quote: 'trabajar con marcas', confidence: 1 },
      { type: 'objection', key: 'price_objection', value: 'precio', source_quote: 'frase que el cliente nunca escribió', confidence: 1 },
    ]));
    for (const text of ['Ok', 'Y cómo es?', 'Dale', 'Contame más']) await inbound(id, text);
    const next = await inbound(id, 'Seguimos?');
    const profile = await readSalesProfileMemoriesV1({ workspace_slug: 'studyx', contact_id: next.contact.id,
      conversation_id: next.conversation_id, source_turn_id: next.turn_id }, { db });
    expect(profile?.objective).toEqual([{ key: 'work_goal', value: 'trabajar con marcas', source_quote: 'trabajar con marcas' }]);
    expect(profile?.objections).toEqual([]);
  });

  // 2026-11-05 owner test (6bcc8efa): the reply answered a superseded batch
  // («no lo sé aún» / «es formarme») plus the newer one; evidence was only the newer.
  it('accepts a quote from customer messages the reply answered across superseded batches', async () => {
    const id = identity();
    await inbound(id, 'no lo sé aún');
    await inbound(id, 'es formarme');
    const answered = await inbound(id, 'son confiables?');
    await commitAgentDecision(input(answered.turn_id, [
      { type: 'study_goal', key: 'objective', value: 'formarse, aún sin definir el uso', source_quote: 'no lo sé aún\nes formarme', confidence: 0.7 }]));
    const next = await inbound(id, 'hay testimonios?');
    const profile = await readSalesProfileMemoriesV1({ workspace_slug: 'studyx', contact_id: next.contact.id,
      conversation_id: next.conversation_id, source_turn_id: next.turn_id }, { db });
    expect(profile?.objective).toEqual([{ key: 'objective', value: 'formarse, aún sin definir el uso', source_quote: 'no lo sé aún\nes formarme' }]);
  });

  it('is scoped to the workspace, the conversation and earlier turns', async () => {
    const id = identity();
    const first = await inbound(id, 'Prefiero seguir por acá, no por llamada.');
    await commitAgentDecision(input(first.turn_id, [
      { type: 'contact_preference', key: 'channel', value: 'chat', source_quote: 'Prefiero seguir por acá', confidence: 1 }]));
    const next = await inbound(id, 'Hola otra vez');
    const scope = { workspace_slug: 'studyx', contact_id: next.contact.id, conversation_id: next.conversation_id, source_turn_id: next.turn_id };
    expect((await readSalesProfileMemoriesV1(scope, { db }))?.contact_preference).toHaveLength(1);
    expect(await readSalesProfileMemoriesV1({ ...scope, workspace_slug: 'not-this-workspace' }, { db })).toBeNull();
    expect((await readSalesProfileMemoriesV1({ ...scope, source_turn_id: first.turn_id }, { db }))?.contact_preference).toEqual([]);
    expect((await readSalesProfileMemoriesV1({ ...scope, conversation_id: randomUUID() }, { db }))?.contact_preference).toEqual([]);
  });
});
