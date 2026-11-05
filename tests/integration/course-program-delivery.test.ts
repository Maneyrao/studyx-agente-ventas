import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { commitAgentDecision, recordDeliveryReport } from '@/lib/services/decision.service';
import { readCourseProgramsCapabilityV1 } from '@/features/programs/application/read-course-programs-capability';
import { seedConversationForAgentTurn } from '../helpers/agent-turn-fixtures';
import { sql } from '@/lib/db/orchestrator';
import type { AgentATurnProposalV1 } from '../../botpress-agent/src/schemas/agent-a-brain';

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const CODE = 'entrenamiento_funcional';
const BASE = 'https://assets.example.com';
beforeEach(() => { vi.stubEnv('STUDYX_PUBLIC_ASSET_BASE_URL', BASE); });
afterEach(() => vi.unstubAllEnvs());

function proposal(texts: string[], callOffer: string | null, action: AgentATurnProposalV1['proposed_action']): AgentATurnProposalV1 {
  return { schema_version: 1,
    move: { schema_version: 1, move: 'request_course_program', secondary_moves: [], vetoes: [], confidence: 1 },
    response: { messages: texts, call_offer: callOffer }, proposed_action: action,
    course_mentions: [], used_fact_ids: [], used_memory_ids: [], memory_candidates: [],
    confirmed_phone: null, profile_updates: [], profile_requests: [], repair_of: null };
}
const SEND = { type: 'send_course_program', offering_code: CODE } as const;

async function commit(f: Awaited<ReturnType<typeof seedConversationForAgentTurn>>, turn: string, p: AgentATurnProposalV1) {
  return commitAgentDecision({ turn_id: turn, trace_id: randomUUID(), supports_multi_outbound: true,
    agent_turn_v2: { schema_version: 2 as const, proposal: p }, decision: f.placeholderDecision as never, model: f.model as never });
}
const report = (outbound_id: string, status: 'submitted_to_botpress' | 'failed') => recordDeliveryReport({ outbound_id, trace_id: randomUUID(), status,
  botpress_message_id: status === 'failed' ? null : `bp-${randomUUID()}`, replayed: false, error_code: status === 'failed' ? 'PROVIDER_REJECTED' : null, delivery_attempt: 1 } as never);
const ledger = (conversation: string) => sql`SELECT offering_code, asset_version, status, outbound_message_id FROM course_program_deliveries WHERE conversation_id=${conversation}::uuid`;

run('send_course_program at the commit boundary', () => {
  it('commits the document as its own part (after the two authored bubbles; a call offer cannot ride with an action) and exposes a URL built from env + registry', async () => {
    const f = await seedConversationForAgentTurn({ selected_offering_code: CODE, intake_complete: true });
    const cap = await readCourseProgramsCapabilityV1({ workspace_slug: 'studyx', conversation_id: f.conversation_id }, { db: sql });
    expect(cap?.available_offering_codes).toContain(CODE);
    expect(cap?.sent_offering_codes).toEqual([]);
    const result = await commit(f, f.turn_id, proposal(['Te comparto el programa.', 'Cualquier duda me dices.'], null, SEND));
    expect(result.status).toBe('committed');
    expect(result.outbounds.map(part => part.part_index)).toEqual([0, 1, 2]);
    const doc = result.outbounds[2]!;
    expect(doc.content).toMatch(/^\[programa enviado: .+\]$/u);
    expect(doc.part_count).toBe(3);
    expect(doc.document).toMatchObject({ kind: 'course_program', offering_code: CODE,
      file_url: `${BASE}/programas/entrenamiento-funcional.pdf`, filename: 'Programa Entrenamiento Funcional - Studyx.pdf' });
    expect(result.outbounds.slice(0, 2).every(part => part.document === undefined)).toBe(true);
    const [decision] = await sql`SELECT business_action FROM agent_decisions WHERE turn_id=${f.turn_id}`;
    expect(decision.business_action).toEqual(SEND);
    expect(await ledger(f.conversation_id)).toMatchObject([{ offering_code: CODE, status: 'pending', outbound_message_id: doc.id }]);
    // Delivery acceptance of the document marks the ledger submitted.
    await report(doc.id, 'submitted_to_botpress');
    expect(await ledger(f.conversation_id)).toMatchObject([{ status: 'submitted' }]);
  });

  it('a second request is idempotent: the action is dropped, the text is still sent, no second document', async () => {
    const f = await seedConversationForAgentTurn({ selected_offering_code: CODE, intake_complete: true });
    const first = await commit(f, f.turn_id, proposal(['Te comparto el programa.'], null, SEND));
    await report(first.outbounds.find(part => part.document)!.id, 'submitted_to_botpress');
    expect((await readCourseProgramsCapabilityV1({ workspace_slug: 'studyx', conversation_id: f.conversation_id }, { db: sql }))?.sent_offering_codes).toEqual([CODE]);
    const second = await commit(f, f.second_turn_id, proposal(['Ya te lo mandé, lo repasamos juntos si quieres.'], null, SEND));
    expect(second.status).toBe('committed');
    expect(second.outbounds.map(part => part.content)).toEqual(['Ya te lo mandé, lo repasamos juntos si quieres.']);
    expect(second.outbounds.some(part => part.document)).toBe(false);
    expect(await ledger(f.conversation_id)).toHaveLength(1);
    const [decision] = await sql`SELECT business_action FROM agent_decisions WHERE turn_id=${f.second_turn_id}`;
    expect(decision.business_action).toBeNull();
  });

  it('the ledger is unique per (conversation, offering, asset version)', async () => {
    const f = await seedConversationForAgentTurn({ selected_offering_code: CODE, intake_complete: true });
    await commit(f, f.turn_id, proposal(['Te comparto el programa.'], null, SEND));
    const [row] = await sql`SELECT workspace_id, contact_id, asset_version, sha256 FROM course_program_deliveries WHERE conversation_id=${f.conversation_id}::uuid`;
    await expect(sql`INSERT INTO course_program_deliveries (workspace_id, conversation_id, contact_id, offering_code, asset_version, sha256)
      VALUES (${row.workspace_id}::uuid, ${f.conversation_id}::uuid, ${row.contact_id}::uuid, ${CODE}, ${row.asset_version}, ${row.sha256})`)
      .rejects.toMatchObject({ code: '23505', constraint_name: 'course_program_deliveries_once' });
  });

  it('a document that fails is recorded as failed, never as sent, and may be proposed again; the text parts exist regardless', async () => {
    const f = await seedConversationForAgentTurn({ selected_offering_code: CODE, intake_complete: true });
    const first = await commit(f, f.turn_id, proposal(['Te comparto el programa.'], null, SEND));
    const doc = first.outbounds.find(part => part.document)!;
    expect(first.outbounds.filter(part => !part.document)).toHaveLength(1);
    await report(doc.id, 'failed');
    expect(await ledger(f.conversation_id)).toMatchObject([{ status: 'failed' }]);
    expect((await readCourseProgramsCapabilityV1({ workspace_slug: 'studyx', conversation_id: f.conversation_id }, { db: sql }))?.sent_offering_codes).toEqual([]);
    const retry = await commit(f, f.second_turn_id, proposal(['Te lo reenvío ahora.'], null, SEND));
    expect(retry.outbounds.some(part => part.document)).toBe(true);
    expect(await ledger(f.conversation_id)).toMatchObject([{ status: 'pending' }]);
  });

  it('rejects a programme without a public asset base URL, an unknown offering and a non-request move', async () => {
    vi.stubEnv('STUDYX_PUBLIC_ASSET_BASE_URL', '');
    const f = await seedConversationForAgentTurn({ selected_offering_code: CODE, intake_complete: true });
    expect((await readCourseProgramsCapabilityV1({ workspace_slug: 'studyx', conversation_id: f.conversation_id }, { db: sql }))?.available_offering_codes).toEqual([]);
    // Without the capability the action is pruned; a reply that claimed the send is rejected for repair (never delivered).
    await expect(commit(f, f.turn_id, proposal(['Te comparto el programa.'], null, SEND))).rejects.toMatchObject({
      subjects: expect.arrayContaining(['program_send_not_executed:unavailable']) });
    const result = await commit(f, f.turn_id, proposal(['No tengo el archivo del programa a mano, pero te cuento lo que incluye.'], null, SEND));
    expect(result.outbounds.some(part => part.document)).toBe(false);
    expect(result.outbounds).toHaveLength(1);
    expect(await ledger(f.conversation_id)).toHaveLength(0);
  });
});
