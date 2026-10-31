import { createHash, randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { processInboundMessage, type InboundEnvelope } from '@/lib/services/ingestion.service';
import { commitAgentDecision, type CommitDecisionInput } from '@/lib/services/decision.service';
import { sql } from '@/lib/db/orchestrator';
import { openLocalTestDatabase } from '../helpers/db';
import { readNegotiationFactsV1 } from '@/features/conversation/application/read-negotiation-facts';

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

function input(turnId: string, status: 'confirmed' | 'other_barriers_reported', quote: string): CommitDecisionInput {
  return { turn_id: turnId, trace_id: randomUUID(), authorized_offering_code: null, authorized_payment_plan: null,
    conversation_pipeline_v1: null, supports_multi_outbound: true,
    agent_turn_v2: { schema_version: 2, proposal: { schema_version: 1,
      move: { schema_version: 1, move: 'select_course', secondary_moves: [], vetoes: [],
        course_reference: 'fotografia_profesional', confidence: 1 },
      response: { messages: ['Entiendo lo que me decís, sigamos con eso.'], call_offer: null },
      proposed_action: { type: 'none' }, used_fact_ids: [], used_memory_ids: [],
      profile_updates: [], profile_requests: [], repair_of: null,
      memory_candidates: [{ type: 'constraint', key: 'price_only_barrier', value: status, source_quote: quote, confidence: 1 }],
    } },
    decision: { schema_version: 4, intent: 'commercial', kind: 'reply', response: 'El backend preparará la respuesta autorizada.',
      response_type: 'commercial_reply', business_action: null, memory_candidates: [], missing_information: [],
      next_state: 'waiting_user', reason_code: 'CONVERSATION_PIPELINE_V1_PENDING_BACKEND', confidence: 1, retrieval_used: null },
    model: { provider: 'botpress', model: 'offline-test', prompt_version: 'offline-test' },
  };
}

function withPriceObjection(base: CommitDecisionInput, quote: string): CommitDecisionInput {
  return { ...base, agent_turn_v2: { ...base.agent_turn_v2!, proposal: { ...base.agent_turn_v2!.proposal,
    memory_candidates: [...base.agent_turn_v2!.proposal.memory_candidates,
      { type: 'objection', key: 'price_objection', value: 'precio', source_quote: quote, confidence: 1 }],
  } } };
}

async function recordedMemory(source: Awaited<ReturnType<typeof inbound>>, decisionId: string | null = null) {
  await db`INSERT INTO selected_memories(contact_id,conversation_id,memory_type,memory_key,value_normalized,
    source_quote,confidence,dedupe_hash,source_message_id,decision_id,status)
    VALUES (${source.contact.id}::uuid,${source.conversation_id}::uuid,'objection','price_objection',
      'precio','precio',1,${createHash('sha256').update(randomUUID()).digest('hex')},${source.turn_id}::uuid,${decisionId}::uuid,'accepted')`;
}

describe('committed negotiation facts (P:106-120; observational, no new bonus condition)', () => {
  it('records quoted model interpretation atomically with the final decision and only once on replay', async () => {
    const quote = 'El precio es lo único que me frena';
    const id = identity();
    const turn = await inbound(id, `Me interesa Fotografía Profesional. ${quote}.`);
    const request = input(turn.turn_id, 'confirmed', quote);
    const result = await commitAgentDecision(request);
    await commitAgentDecision(request);
    const rows = await db<Array<{ diagnostics: unknown; negotiation_observations: unknown[] }>>`
      SELECT diagnostics, negotiation_observations FROM agent_decisions WHERE turn_id=${turn.turn_id}::uuid`;
    expect(rows).toHaveLength(1);
    expect(rows[0].diagnostics).toBeNull();
    expect(rows[0].negotiation_observations).toMatchObject([{
      status: 'confirmed', offering_code: 'fotografia_profesional', source_turn_id: turn.turn_id,
      source_message_id: turn.turn_id, source_quote: quote, interpretation_source: 'committed_agent_observation',
    }]);
    expect(result.status).toBe('committed');
    const next = await inbound(id, 'Seguimos?');
    const facts = await readNegotiationFactsV1({ workspace_slug: 'studyx', contact_id: turn.contact.id,
      conversation_id: turn.conversation_id, source_turn_id: next.turn_id, selected_offering_code: 'fotografia_profesional' }, { db });
    expect(facts).toMatchObject({ price_objection_count: 0, price_only_barrier: { status: 'confirmed',
      source_turn_id: turn.turn_id, source_quote: quote } });
  });

  it('counts five committed objection turns without a cap or duplication across memory and decisions', async () => {
    const id = identity();
    const legacy = await inbound(id, 'Todavía no me cierra el precio.');
    const sourceIds: string[] = [];
    let current: Awaited<ReturnType<typeof inbound>>;
    for (let index = 0; index < 5; index += 1) {
      current = await inbound(id, 'Me interesa Fotografía Profesional, pero el precio es lo único que me frena.');
      sourceIds.push(current.turn_id);
      const request = withPriceObjection(input(current.turn_id, 'confirmed', 'el precio es lo único que me frena'), 'el precio');
      const committed = await commitAgentDecision(request);
      await recordedMemory(current, committed.decision_id);
    }
    const next = await inbound(id, 'Y cómo seguimos?');
    const scope = { workspace_slug: 'studyx', contact_id: current!.contact.id,
      conversation_id: current!.conversation_id, source_turn_id: next.turn_id, selected_offering_code: 'fotografia_profesional' };
    const facts = await readNegotiationFactsV1(scope, { db });
    expect(facts?.price_objection_count).toBe(5);
    expect(new Set(facts?.latest_price_objection_source_turn_ids)).toEqual(new Set(sourceIds));
    expect(await readNegotiationFactsV1({ ...scope, workspace_slug: 'not-this-workspace' }, { db })).toBeNull();
    expect(await readNegotiationFactsV1({ ...scope, contact_id: randomUUID() }, { db })).toBeNull();
    const otherCourse = await readNegotiationFactsV1({ ...scope, selected_offering_code: 'marketing_digital' }, { db });
    expect(otherCourse?.price_only_barrier).toEqual({ status: 'unknown' });
    await recordedMemory(legacy);
    const withLegacy = await readNegotiationFactsV1(scope, { db });
    expect(withLegacy?.price_objection_count).toBe(6);
    expect(withLegacy?.latest_legacy_price_objection_source_message_ids).toEqual([legacy.turn_id]);
    const [existingCounter] = await db<Array<{ price_objection_count: number }>>`
      SELECT price_objection_count FROM conversation_promotion_context_v1
      WHERE conversation_id=${current!.conversation_id}::uuid AND contact_id=${current!.contact.id}::uuid`;
    expect(existingCounter.price_objection_count).toBe(2);
  });

  it('deduplicates a memory from another fragment using its explicit committed decision link', async () => {
    const id = identity();
    const fragment = await inbound(id, 'El precio es lo único que me frena.');
    const representative = await inbound(id, 'Me interesa Fotografía Profesional.');
    const committed = await commitAgentDecision(withPriceObjection(input(representative.turn_id,
      'confirmed', 'El precio es lo único que me frena'), 'El precio'));
    await recordedMemory(fragment, committed.decision_id);
    const next = await inbound(id, 'Seguimos?');
    const facts = await readNegotiationFactsV1({ workspace_slug: 'studyx', contact_id: next.contact.id,
      conversation_id: next.conversation_id, source_turn_id: next.turn_id, selected_offering_code: 'fotografia_profesional' }, { db });
    expect(facts?.price_objection_count).toBe(1);
    expect(facts?.latest_price_objection_source_turn_ids).toEqual([representative.turn_id]);
    expect(facts?.price_only_barrier).toMatchObject({ source_message_id: fragment.turn_id });
  });

  it('preserves PII-free metrics independently from source-quoted observations', async () => {
    const quote = 'Sólo el precio';
    const turn = await inbound(identity(), `Me interesa Fotografía Profesional. ${quote} me frena.`);
    const diagnostics = { schema_version: 1 as const, generation_attempts: 0 as const,
      failure_stage: 'none' as const, failure_codes: [], action_status: 'none' as const };
    await commitAgentDecision({ ...input(turn.turn_id, 'confirmed', quote), turn_diagnostics: diagnostics });
    const [row] = await db<Array<{ diagnostics: unknown; negotiation_observations: unknown[] }>>`
      SELECT diagnostics,negotiation_observations FROM agent_decisions WHERE turn_id=${turn.turn_id}::uuid`;
    expect(row.diagnostics).toEqual(diagnostics);
    expect(row.negotiation_observations).toHaveLength(1);
  });

  it('does not record an unquoted observation or mutate immutable committed observations', async () => {
    const turn = await inbound(identity(), 'Me interesa Fotografía Profesional, pero tengo varias dudas.');
    await commitAgentDecision(input(turn.turn_id, 'confirmed', 'no dije esto'));
    const [row] = await db<Array<{ negotiation_observations: unknown }>>`
      SELECT negotiation_observations FROM agent_decisions WHERE turn_id=${turn.turn_id}::uuid`;
    expect(row.negotiation_observations).toBeNull();
    await expect(db`UPDATE agent_decisions SET negotiation_observations='[]'::jsonb WHERE turn_id=${turn.turn_id}::uuid`)
      .rejects.toMatchObject({ code: '23514' });
    const [shape] = await db<Array<{ valid: boolean }>>`
      SELECT public.agent_negotiation_observations_valid_v1('[{"status":"confirmed"}]'::jsonb) valid`;
    expect(shape.valid).toBe(false);
  });

  it('records only the final authorized interpretation after a rejected draft and then permits correction', async () => {
    const id = identity();
    const turn = await inbound(id, 'El precio es lo único que me frena. Me corrijo: también me preocupa el horario.');
    const base = input(turn.turn_id, 'confirmed', 'El precio es lo único que me frena');
    const rejected = { ...base, agent_turn_v2: { ...base.agent_turn_v2!, proposal: { ...base.agent_turn_v2!.proposal,
      response: { messages: ['https://invented.example.test/forbidden-model-url'], call_offer: null },
    } } };
    await expect(commitAgentDecision(rejected)).rejects.toBeInstanceOf(Error);
    const repaired = input(turn.turn_id, 'other_barriers_reported', 'también me preocupa el horario');
    await commitAgentDecision(repaired);
    const next = await inbound(id, 'Contame más.');
    const facts = await readNegotiationFactsV1({ workspace_slug: 'studyx', contact_id: turn.contact.id,
      conversation_id: turn.conversation_id, source_turn_id: next.turn_id, selected_offering_code: 'fotografia_profesional' }, { db });
    expect(facts?.price_only_barrier).toMatchObject({ status: 'other_barriers_reported', source_turn_id: turn.turn_id });
    const [row] = await db<Array<{ negotiation_observations: unknown[] }>>`
      SELECT negotiation_observations FROM agent_decisions WHERE turn_id=${turn.turn_id}::uuid`;
    expect(row.negotiation_observations).toHaveLength(1);
  });
});
