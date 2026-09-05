import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import {
  prepareCallRequestToolV1,
  prepareContactDetailsToolV1,
  prepareLeadProjectionToolV1,
  prepareMemoryToolV1,
  preparePaymentLinkToolV1,
} from '@/features/conversation/application/agent-tools-prepare';
import { commitAgentTurnV3 } from '@/features/conversation/application/commit-agent-turn-v3';
import { projectAgentAMemories } from '@/features/memory/application/project-agent-a-memories';
import { reserveCallForDecision } from '@/features/calls/application/request-call';
import { sql } from '@/lib/db/orchestrator';
import { seedConversationForAgentTurn, type SeededAgentTurn } from '../helpers/agent-turn-fixtures';

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const originalSheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
const originalSheetTab = process.env.GOOGLE_SHEETS_TAB_NAME;

function commit(
  seeded: SeededAgentTurn,
  input: {
    readonly turn_id?: string;
    readonly preparation_ids: readonly string[];
    readonly text?: string;
    readonly response_type?: string;
    readonly state_patch?: Record<string, unknown>;
    readonly artifact_ids?: readonly string[];
  },
) {
  return commitAgentTurnV3(sql, {
    turn_id: input.turn_id ?? seeded.turn_id,
    trace_id: randomUUID(),
    effective_prompt_sha256: seeded.release_manifest.prompt_sha256,
    release_manifest: seeded.release_manifest,
    decision: {
      schema_version: 3,
      blocks: [
        {
          type: 'narrative',
          text: input.text ?? 'Perfecto, ya quedó registrado.',
        },
        ...(input.artifact_ids ?? []).map((preparationId) => ({
          type: 'artifact' as const,
          preparation_id: preparationId,
        })),
      ],
      commit_preparations: input.preparation_ids,
      used_memory_ids: [],
      state_patch: {
        expected_state_version: seeded.state_version,
        set: input.state_patch ?? {},
      },
      response_type: input.response_type ?? 'commercial_reply',
    },
  });
}

afterEach(() => {
  if (originalSheetId === undefined) delete process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  else process.env.GOOGLE_SHEETS_SPREADSHEET_ID = originalSheetId;
  if (originalSheetTab === undefined) delete process.env.GOOGLE_SHEETS_TAB_NAME;
  else process.env.GOOGLE_SHEETS_TAB_NAME = originalSheetTab;
});

afterAll(async () => sql.end());

async function projectMemoryJob(decisionId: string): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await sql.begin(async (transaction) => {
      await transaction`SET LOCAL ROLE orchestrator_role`;
      await projectAgentAMemories({ limit: 100 }, { db: transaction });
    });
    const [job] = await sql<Array<{ status: string }>>`
      SELECT status FROM agent_a_memory_projection_jobs
      WHERE decision_id = ${decisionId}::uuid
    `;
    if (job?.status === 'completed') return;
  }
  throw new Error('MEMORY_JOB_DID_NOT_COMPLETE');
}

run('Agent Loop preparation materialization', () => {
  it('applies only the listed normalized contact reservation and replay stays unique', async () => {
    const seeded = await seedConversationForAgentTurn();
    const contact = await prepareContactDetailsToolV1({
      db: sql,
      turn_id: seeded.turn_id,
      conversation_id: seeded.conversation_id,
      contact_id: seeded.contact_id,
    }, {
      first_name: '  Ana  ',
      last_name: '  Pérez ',
      email: ' ANA.PEREZ@EXAMPLE.TEST ',
      phone: ' +54 9 11 4444-5555 ',
    });
    const unlistedLead = await prepareLeadProjectionToolV1({
      db: sql,
      turn_id: seeded.turn_id,
      conversation_id: seeded.conversation_id,
    });
    const unlistedCall = await prepareCallRequestToolV1({
      db: sql,
      turn_id: seeded.turn_id,
      conversation_id: seeded.conversation_id,
      contact_id: seeded.contact_id,
    }, { reason: 'customer_request' });
    const unlistedMemory = await prepareMemoryToolV1({
      db: sql,
      turn_id: seeded.turn_id,
      conversation_id: seeded.conversation_id,
    }, {
      candidates: [{ text: 'Prefiere clases cortas', type: 'preference', supersedes: [] }],
    });
    const payment = await preparePaymentLinkToolV1({
      db: sql,
      turn_id: seeded.turn_id,
      conversation_id: seeded.conversation_id,
    }, {
      offering_code: 'entrenamiento_funcional',
      payment_plan: 'one_time',
    }, { resolver: { resolve: () => 'https://buy.stripe.com/test_contact_and_payment' } });
    expect(contact.success).toBe(true);
    expect(unlistedLead.success).toBe(true);
    expect(unlistedCall.success).toBe(true);
    expect(unlistedMemory.success).toBe(true);
    expect(payment.success).toBe(true);

    const acceptedIds = [contact.preparation_id!, payment.preparation_id!];
    const commitInput = {
      preparation_ids: acceptedIds,
      artifact_ids: [payment.preparation_id!],
      state_patch: { stage: 'payment_link_sent' },
    };
    const first = await commit(seeded, commitInput);
    const replay = await commit(seeded, commitInput);
    expect(replay).toEqual(first);

    const [proof] = await sql<Array<{
      name: string | null;
      email: string | null;
      declared_phone: string | null;
      contact_committed: boolean;
      lead_committed: boolean;
      lead_rows: number;
      payment_jobs: number;
      unlisted_committed: number;
      calls: number;
      memory_jobs: number;
    }>>`
      SELECT
        contact.name,
        contact.email,
        contact.declared_phone,
        selected.committed_at IS NOT NULL AS contact_committed,
        unlisted.committed_at IS NOT NULL AS lead_committed,
        (SELECT count(*)::int FROM sheet_projection_rows
          WHERE workspace_id = ${seeded.workspace_id}::uuid
            AND projection_key = ${`lead:${seeded.workspace_id}:${seeded.contact_id}`}) AS lead_rows,
        (SELECT count(*)::int FROM payment_projection_jobs
          WHERE decision_id = ${first.decision_id}::uuid) AS payment_jobs,
        (SELECT count(*)::int FROM agent_turn_preparations
          WHERE id = ANY(${[
            unlistedLead.preparation_id!,
            unlistedCall.preparation_id!,
            unlistedMemory.preparation_id!,
          ]}::uuid[]) AND committed_at IS NOT NULL) AS unlisted_committed,
        (SELECT count(*)::int FROM call_sessions
          WHERE source_turn_id = ${seeded.turn_id}::uuid) AS calls,
        (SELECT count(*)::int FROM agent_a_memory_projection_jobs
          WHERE turn_id = ${seeded.turn_id}::uuid) AS memory_jobs
      FROM contacts AS contact
      JOIN agent_turn_preparations AS selected ON selected.id = ${contact.preparation_id}::uuid
      JOIN agent_turn_preparations AS unlisted ON unlisted.id = ${unlistedLead.preparation_id}::uuid
      WHERE contact.id = ${seeded.contact_id}::uuid
    `;
    expect(proof).toEqual({
      name: 'Ana Pérez',
      email: 'ana.perez@example.test',
      declared_phone: '+5491144445555',
      contact_committed: true,
      lead_committed: false,
      lead_rows: 0,
      payment_jobs: 1,
      unlisted_committed: 0,
      calls: 0,
      memory_jobs: 0,
    });
  });

  it('accepts call_confirmation and reserves one internal call plus requested event without dispatch', async () => {
    const seeded = await seedConversationForAgentTurn({ intake_complete: true });
    await sql`UPDATE messages SET content = 'Sí, llamame ahora' WHERE id = ${seeded.turn_id}::uuid`;
    const prepared = await prepareCallRequestToolV1({
      db: sql,
      turn_id: seeded.turn_id,
      conversation_id: seeded.conversation_id,
      contact_id: seeded.contact_id,
    }, { reason: 'customer_request' });
    expect(prepared.success).toBe(true);

    const first = await commit(seeded, {
      preparation_ids: [prepared.preparation_id!],
      text: 'Perfecto. Registré la llamada; nuestra asesora virtual intenta comunicarse ahora.',
      response_type: 'call_confirmation',
      state_patch: { call_preference: 'call', call_offer_status: 'accepted', stage: 'handoff' },
    });
    const replay = await commit(seeded, {
      preparation_ids: [prepared.preparation_id!],
      text: 'Perfecto. Registré la llamada; nuestra asesora virtual intenta comunicarse ahora.',
      response_type: 'call_confirmation',
      state_patch: { call_preference: 'call', call_offer_status: 'accepted', stage: 'handoff' },
    });
    expect(replay).toEqual(first);

    const [proof] = await sql<Array<{
      calls: number;
      call_id: string | null;
      requested_events: number;
      provider_events: number;
      business_action: Record<string, unknown> | null;
    }>>`
      SELECT
        (SELECT count(*)::int FROM call_sessions
          WHERE source_turn_id = ${seeded.turn_id}::uuid) AS calls,
        (SELECT id FROM call_sessions
          WHERE source_turn_id = ${seeded.turn_id}::uuid) AS call_id,
        (SELECT count(*)::int FROM call_events AS event
          JOIN call_sessions AS session ON session.id = event.call_id
          WHERE session.source_turn_id = ${seeded.turn_id}::uuid
            AND event.event_type = 'requested') AS requested_events,
        (SELECT count(*)::int FROM call_events AS event
          JOIN call_sessions AS session ON session.id = event.call_id
          WHERE session.source_turn_id = ${seeded.turn_id}::uuid
            AND event.event_type <> 'requested') AS provider_events,
        (SELECT business_action FROM agent_decisions
          WHERE turn_id = ${seeded.turn_id}::uuid) AS business_action
    `;
    expect(proof).toEqual({
      calls: 1,
      call_id: prepared.canonical_data!.call_id,
      requested_events: 1,
      provider_events: 0,
      business_action: {
        type: 'request_call_now',
        reason: 'direct_request',
        course_of_interest: null,
      },
    });
  });

  it('rejects a malformed reserved call id before any ledger write', async () => {
    const seeded = await seedConversationForAgentTurn({ intake_complete: true });
    await expect(reserveCallForDecision(sql, {
      turn_id: seeded.turn_id,
      trace_id: randomUUID(),
      decision_id: randomUUID(),
      contact_id: seeded.contact_id,
      conversation_id: seeded.conversation_id,
      contact_name: 'Ana Pérez',
      phone: '+5491144445555',
      consent_messages: [{ id: seeded.turn_id, content: 'Llamame ahora' }],
      course_of_interest: null,
      prompt_version: 'test',
      reserved_call_id: 'not-a-uuid',
    })).rejects.toMatchObject({
      reason: 'CALL_RESERVATION_ID_INVALID',
    });
    await expect(sql`
      SELECT id FROM call_sessions WHERE source_turn_id = ${seeded.turn_id}::uuid
    `).resolves.toHaveLength(0);
  });

  it('activates the reserved memory ID and atomically links an explicit successor', async () => {
    const seeded = await seedConversationForAgentTurn();
    await sql`
      UPDATE messages SET content = 'Quiero estudiar marketing'
      WHERE id = ${seeded.turn_id}::uuid
    `;
    const firstPrepared = await prepareMemoryToolV1({
      db: sql,
      turn_id: seeded.turn_id,
      conversation_id: seeded.conversation_id,
    }, {
      candidates: [{
        text: 'Quiero estudiar marketing',
        type: 'study_goal',
        supersedes: [],
      }],
    });
    expect(firstPrepared.success).toBe(true);
    const firstAccepted = firstPrepared.canonical_data!.accepted[0]!;

    const first = await commit(seeded, { preparation_ids: [firstPrepared.preparation_id!] });
    const replay = await commit(seeded, { preparation_ids: [firstPrepared.preparation_id!] });
    expect(replay).toEqual(first);

    const jobs = await sql<Array<{
      decision_id: string;
      turn_id: string;
      candidate: Record<string, unknown>;
      status: string;
    }>>`
      SELECT decision_id, turn_id, candidate, status
      FROM agent_a_memory_projection_jobs
      WHERE turn_id = ${seeded.turn_id}::uuid
    `;
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      decision_id: first.decision_id,
      turn_id: seeded.turn_id,
      status: 'pending',
      candidate: {
        id: firstAccepted.id,
        text: firstAccepted.text,
        type: firstAccepted.type,
        supersedes: [],
      },
    });

    await projectMemoryJob(first.decision_id);
    await expect(sql<Array<{ id: string; status: string }>>`
      SELECT id, status FROM selected_memories WHERE id = ${firstAccepted.id}::uuid
    `).resolves.toEqual([{ id: firstAccepted.id, status: 'active' }]);

    await sql`
      UPDATE messages SET content = 'En realidad quiero estudiar finanzas'
      WHERE id = ${seeded.second_turn_id}::uuid
    `;
    const successor = await prepareMemoryToolV1({
      db: sql,
      turn_id: seeded.second_turn_id,
      conversation_id: seeded.conversation_id,
    }, {
      candidates: [{
        text: 'En realidad quiero estudiar finanzas',
        type: 'study_goal',
        supersedes: [firstAccepted.id],
      }],
    });
    expect(successor.success).toBe(true);
    const successorAccepted = successor.canonical_data!.accepted[0]!;
    const second = await commit(seeded, {
      turn_id: seeded.second_turn_id,
      preparation_ids: [successor.preparation_id!],
    });
    await expect(sql<Array<{ status: string; superseded_by_memory_id: string | null }>>`
      SELECT status, superseded_by_memory_id
      FROM selected_memories WHERE id = ${firstAccepted.id}::uuid
    `).resolves.toEqual([{ status: 'active', superseded_by_memory_id: null }]);

    await projectMemoryJob(second.decision_id);
    await expect(sql<Array<{
      id: string;
      status: string;
      superseded_by_memory_id: string | null;
    }>>`
      SELECT id, status, superseded_by_memory_id
      FROM selected_memories
      WHERE id = ANY(${[firstAccepted.id, successorAccepted.id]}::uuid[])
      ORDER BY id
    `).resolves.toEqual(expect.arrayContaining([
      {
        id: firstAccepted.id,
        status: 'superseded',
        superseded_by_memory_id: successorAccepted.id,
      },
      {
        id: successorAccepted.id,
        status: 'active',
        superseded_by_memory_id: null,
      },
    ]));
  });

  it('queues one durable lead projection at commit and never contacts Sheets inline', async () => {
    const seeded = await seedConversationForAgentTurn({ intake_complete: true });
    process.env.GOOGLE_SHEETS_SPREADSHEET_ID = `agent-loop-${randomUUID()}`;
    process.env.GOOGLE_SHEETS_TAB_NAME = 'Leads';
    const prepared = await prepareLeadProjectionToolV1({
      db: sql,
      turn_id: seeded.turn_id,
      conversation_id: seeded.conversation_id,
    });
    expect(prepared.success).toBe(true);

    const first = await commit(seeded, { preparation_ids: [prepared.preparation_id!] });
    const replay = await commit(seeded, { preparation_ids: [prepared.preparation_id!] });
    expect(replay).toEqual(first);

    const rows = await sql<Array<{
      projection_key: string;
      state: string;
      attempt_count: number;
      payload: Record<string, unknown>;
    }>>`
      SELECT projection_key, state, attempt_count, payload
      FROM sheet_projection_rows
      WHERE workspace_id = ${seeded.workspace_id}::uuid
        AND projection_key = ${`lead:${seeded.workspace_id}:${seeded.contact_id}`}
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      projection_key: `lead:${seeded.workspace_id}:${seeded.contact_id}`,
      state: 'pending',
      attempt_count: 0,
      payload: { contact_id: seeded.contact_id, ultima_senal: 'agent_loop_lead_committed' },
    });
  });
});
