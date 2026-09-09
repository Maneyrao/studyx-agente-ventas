import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as reconcileOrchestrationCron } from '@/app/api/cron/reconcile-orchestration/route';
import {
  prepareCallRequestToolV1,
  prepareContactDetailsToolV1,
  prepareLeadProjectionToolV1,
  prepareMemoryToolV1,
  preparePaymentLinkToolV1,
} from '@/features/conversation/application/agent-tools-prepare';
import {
  AgentTurnV3RejectedError,
  commitAgentTurnV3,
} from '@/features/conversation/application/commit-agent-turn-v3';
import {
  projectAgentAMemories,
  reclaimStrandedMemorySupersessions,
} from '@/features/memory/application/project-agent-a-memories';
import { reserveCallForDecision } from '@/features/calls/application/request-call';
import { recordDeliveryReport } from '@/lib/services/decision.service';
import { flushSheetProjections } from '@/lib/services/projection.service';
import { FakeSheetsProvider } from '@/lib/providers/sheets/fake-sheets-provider';
import { sql } from '@/lib/db/orchestrator';
import { processInboundMessage, type InboundEnvelope } from '@/lib/services/ingestion.service';
import { seedConversationForAgentTurn, type SeededAgentTurn } from '../helpers/agent-turn-fixtures';

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const originalSheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
const originalSheetTab = process.env.GOOGLE_SHEETS_TAB_NAME;
const originalCronSecret = process.env.CRON_SECRET;

function commit(
  seeded: SeededAgentTurn,
  input: {
    readonly turn_id?: string;
    readonly preparation_ids: readonly string[];
    readonly text?: string;
    readonly response_type?: string;
    readonly state_patch?: Record<string, unknown>;
    readonly state_version?: number;
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
        expected_state_version: input.state_version ?? seeded.state_version,
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
  if (originalCronSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = originalCronSecret;
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
    // Spec §3.10: a correction deactivates its predecessor INSIDE the decision
    // transaction, not deferred to the async worker. Immediately after commit
    // (before any worker run) the predecessor must already be unrecallable —
    // `search_selected_memories` only reads `status = 'active'`.
    // `pending_supersession` is that in-transaction limbo state: `superseded`
    // cannot be used yet because it requires `superseded_by_memory_id` to
    // already point at the successor, whose row does not exist until the
    // worker runs. The final link to the successor's id is completed by the
    // worker once the successor itself becomes durable (checked below).
    await expect(sql<Array<{ status: string; superseded_by_memory_id: string | null }>>`
      SELECT status, superseded_by_memory_id
      FROM selected_memories WHERE id = ${firstAccepted.id}::uuid
    `).resolves.toEqual([{ status: 'pending_supersession', superseded_by_memory_id: null }]);

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

  it('reclaims a predecessor stranded in pending_supersession when its successor job terminally fails', async () => {
    // Blocker P1 (2026-09-05 independent review): `pending_supersession`
    // (20260905000007) has no terminal recovery path once the successor's
    // job that would complete the link exhausts its retries — the
    // predecessor is neither `active` nor `superseded`, invisible to
    // `search_selected_memories`, and unrecoverable. This drives a real
    // successor job to the actual terminal `failed` state (three exhausted
    // attempts, same code path production uses) and asserts a reconciliation
    // sweep restores the predecessor to `active` rather than losing it.
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
      candidates: [{ text: 'Quiero estudiar marketing', type: 'study_goal', supersedes: [] }],
    });
    expect(firstPrepared.success).toBe(true);
    const firstAccepted = firstPrepared.canonical_data!.accepted[0]!;
    const first = await commit(seeded, { preparation_ids: [firstPrepared.preparation_id!] });
    await projectMemoryJob(first.decision_id);
    await expect(sql<Array<{ status: string }>>`
      SELECT status FROM selected_memories WHERE id = ${firstAccepted.id}::uuid
    `).resolves.toEqual([{ status: 'active' }]);

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
    const second = await commit(seeded, {
      turn_id: seeded.second_turn_id,
      preparation_ids: [successor.preparation_id!],
    });
    // Spec §3.10 in-transaction limbo, already covered by the test above —
    // asserted again here only as the precondition this test builds on.
    await expect(sql<Array<{ status: string }>>`
      SELECT status FROM selected_memories WHERE id = ${firstAccepted.id}::uuid
    `).resolves.toEqual([{ status: 'pending_supersession' }]);

    // Force the successor's async projection to fail deterministically while
    // preserving its authoritative workspace/contact provenance. Recovery
    // must never trust candidate JSON to choose a tenant, so deleting that
    // provenance would correctly make recovery fail closed too.
    await sql`
      UPDATE agent_a_memory_projection_jobs
      SET candidate = jsonb_set(candidate, '{type}', '"unsupported"'::jsonb),
          created_at = '-infinity'::timestamptz
      WHERE decision_id = ${second.decision_id}::uuid
    `;

    // Drive the job to the real terminal state through the same worker
    // entrypoint production uses. Only the 1-minute `available_at` backoff
    // between attempts is short-circuited here (by SQL, between calls) so
    // the test does not sleep three real minutes — the failure detection and
    // `attempt_count` bookkeeping under test run for real, unmodified.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await sql`
        UPDATE agent_a_memory_projection_jobs
        SET available_at = now()
        WHERE decision_id = ${second.decision_id}::uuid
      `;
      await projectAgentAMemories({ limit: 10 }, { db: sql });
    }
    const [terminalJob] = await sql<Array<{
      status: string;
      attempt_count: number;
      last_error_code: string | null;
    }>>`
      SELECT status, attempt_count, last_error_code
      FROM agent_a_memory_projection_jobs
      WHERE decision_id = ${second.decision_id}::uuid
    `;
    expect(terminalJob).toMatchObject({
      status: 'failed',
      attempt_count: 3,
      last_error_code: 'MEMORY_CANDIDATE_INVALID',
    });

    // The predecessor must not remain stranded: `attempt_count < 3` gates
    // every future claim, so nothing will ever reclaim this job again.
    await expect(sql<Array<{ status: string }>>`
      SELECT status FROM selected_memories WHERE id = ${firstAccepted.id}::uuid
    `).resolves.toEqual([{ status: 'pending_supersession' }]);

    // Recovery and its durable audit must commit together. If the audit sink
    // fails, leaving the memory active would make a retry a no-op and lose
    // the evidence forever.
    await expect(reclaimStrandedMemorySupersessions({}, {
      db: sql,
      audit: async () => {
        throw new Error('TEST_AUDIT_FAILURE');
      },
    })).rejects.toThrow('TEST_AUDIT_FAILURE');
    await expect(sql<Array<{ status: string }>>`
      SELECT status FROM selected_memories WHERE id = ${firstAccepted.id}::uuid
    `).resolves.toEqual([{ status: 'pending_supersession' }]);

    // Exercise the scheduled production entrypoint, not the recovery helper
    // directly. This is what proves a deployed cron sweep can actually reach
    // the repair after the worker exhausts the successor job.
    process.env.CRON_SECRET = `test-reconcile-${randomUUID()}`;
    const request = () => new NextRequest('http://localhost/api/cron/reconcile-orchestration', {
      headers: {
        authorization: `Bearer ${process.env.CRON_SECRET}`,
        'x-trace-id': randomUUID(),
      },
    });
    const response = await reconcileOrchestrationCron(request());
    const sweep = await response.json() as {
      memory_supersessions?: { examined: number; reclaimed: number; failed: number };
    };
    expect(sweep.memory_supersessions?.failed).toBe(0);
    expect(sweep.memory_supersessions?.reclaimed).toBeGreaterThanOrEqual(1);

    await expect(sql<Array<{ status: string; embedding_state: string }>>`
      SELECT status, embedding_state FROM selected_memories WHERE id = ${firstAccepted.id}::uuid
    `).resolves.toEqual([{ status: 'active', embedding_state: 'pending' }]);

    const auditEventKey = `memory:${firstAccepted.id}:supersession_reclaimed`;
    await expect(sql<Array<{
      action: string;
      payload: {
        workspace_id?: string;
        successor_decision_id?: string;
        successor_job_status?: string;
        successor_job_result?: string | null;
        attempt_count?: number;
        last_error_code?: string;
      };
    }>>`
      SELECT action, payload FROM audit_log WHERE event_key = ${auditEventKey}
    `).resolves.toEqual([{
      action: 'agent.decision.memory_supersession_reclaimed',
      payload: expect.objectContaining({
        workspace_id: seeded.workspace_id,
        successor_decision_id: second.decision_id,
        successor_job_status: 'failed',
        successor_job_result: null,
        attempt_count: 3,
        last_error_code: 'MEMORY_CANDIDATE_INVALID',
      }),
    }]);

    // Idempotent through the same production entrypoint: no second mutation
    // and no duplicate audit event for the deterministic event key.
    const secondResponse = await reconcileOrchestrationCron(request());
    const secondSweep = await secondResponse.json() as {
      memory_supersessions?: { examined: number; reclaimed: number; failed: number };
    };
    expect(secondSweep.memory_supersessions).toMatchObject({ reclaimed: 0, failed: 0 });
    await expect(sql<Array<{ count: string }>>`
      SELECT count(*)::text AS count FROM audit_log WHERE event_key = ${auditEventKey}
    `).resolves.toEqual([{ count: '1' }]);
  });

  it('reclaims a predecessor when the successor job completes as rejected without materializing a memory', async () => {
    const seeded = await seedConversationForAgentTurn();
    await sql`
      UPDATE messages SET content = 'Quiero estudiar marketing'
      WHERE id = ${seeded.turn_id}::uuid
    `;
    const original = await prepareMemoryToolV1({
      db: sql,
      turn_id: seeded.turn_id,
      conversation_id: seeded.conversation_id,
    }, {
      candidates: [{ text: 'Quiero estudiar marketing', type: 'study_goal', supersedes: [] }],
    });
    expect(original.success).toBe(true);
    const originalId = original.canonical_data!.accepted[0]!.id;
    const first = await commit(seeded, { preparation_ids: [original.preparation_id!] });
    await projectMemoryJob(first.decision_id);

    await sql`
      UPDATE messages SET content = 'Ahora busco algo de 50000 pesos'
      WHERE id = ${seeded.second_turn_id}::uuid
    `;
    const prohibitedSuccessor = await prepareMemoryToolV1({
      db: sql,
      turn_id: seeded.second_turn_id,
      conversation_id: seeded.conversation_id,
    }, {
      candidates: [{
        text: 'Ahora busco algo de 50000 pesos',
        type: 'study_goal',
        supersedes: [originalId],
      }],
    });
    expect(prohibitedSuccessor.success).toBe(true);
    const second = await commit(seeded, {
      turn_id: seeded.second_turn_id,
      preparation_ids: [prohibitedSuccessor.preparation_id!],
    });
    await expect(sql<Array<{ status: string }>>`
      SELECT status FROM selected_memories WHERE id = ${originalId}::uuid
    `).resolves.toEqual([{ status: 'pending_supersession' }]);

    // This is a genuine terminal path in the worker, distinct from exhausted
    // retries: the price guard intentionally completes the job as rejected
    // and creates no successor selected_memory row.
    await sql`
      UPDATE agent_a_memory_projection_jobs
      SET created_at = '-infinity'::timestamptz, available_at = now()
      WHERE decision_id = ${second.decision_id}::uuid
    `;
    await projectAgentAMemories({ limit: 1 }, { db: sql, audit: async () => {} });
    await expect(sql<Array<{
      status: string;
      result: string | null;
      attempt_count: number;
    }>>`
      SELECT status, result, attempt_count
      FROM agent_a_memory_projection_jobs
      WHERE decision_id = ${second.decision_id}::uuid
    `).resolves.toEqual([{
      status: 'completed',
      result: 'rejected',
      attempt_count: 1,
    }]);
    await expect(sql<Array<{ id: string }>>`
      SELECT id FROM selected_memories WHERE id = ${prohibitedSuccessor.canonical_data!.accepted[0]!.id}::uuid
    `).resolves.toHaveLength(0);

    process.env.CRON_SECRET = `test-reconcile-${randomUUID()}`;
    const request = () => new NextRequest('http://localhost/api/cron/reconcile-orchestration', {
      headers: {
        authorization: `Bearer ${process.env.CRON_SECRET}`,
        'x-trace-id': randomUUID(),
      },
    });
    const response = await reconcileOrchestrationCron(request());
    const sweep = await response.json() as {
      memory_supersessions?: { examined: number; reclaimed: number; failed: number };
    };
    expect(sweep.memory_supersessions?.failed).toBe(0);
    expect(sweep.memory_supersessions?.reclaimed).toBeGreaterThanOrEqual(1);
    await expect(sql<Array<{ status: string; embedding_state: string }>>`
      SELECT status, embedding_state FROM selected_memories WHERE id = ${originalId}::uuid
    `).resolves.toEqual([{ status: 'active', embedding_state: 'pending' }]);

    const auditEventKey = `memory:${originalId}:supersession_reclaimed`;
    await expect(sql<Array<{
      payload: { successor_job_status?: string; successor_job_result?: string };
    }>>`
      SELECT payload FROM audit_log WHERE event_key = ${auditEventKey}
    `).resolves.toEqual([{
      payload: expect.objectContaining({
        successor_job_status: 'completed',
        successor_job_result: 'rejected',
      }),
    }]);

    await reconcileOrchestrationCron(request());
    await expect(sql<Array<{ count: string }>>`
      SELECT count(*)::text AS count FROM audit_log WHERE event_key = ${auditEventKey}
    `).resolves.toEqual([{ count: '1' }]);
  });

  it('fails closed when a successor supersedes a preparation that was never committed', async () => {
    const seeded = await seedConversationForAgentTurn();
    await sql`
      UPDATE messages SET content = 'Quiero estudiar diseño'
      WHERE id = ${seeded.turn_id}::uuid
    `;
    const abandoned = await prepareMemoryToolV1({
      db: sql,
      turn_id: seeded.turn_id,
      conversation_id: seeded.conversation_id,
    }, {
      candidates: [{ text: 'Quiero estudiar diseño', type: 'study_goal', supersedes: [] }],
    });
    expect(abandoned.success).toBe(true);
    const abandonedId = abandoned.canonical_data!.accepted[0]!.id;

    // Turn 1 commits WITHOUT the memory preparation: it stays a reservation
    // that never becomes durable and never joins any commit.
    await commit(seeded, { preparation_ids: [] });

    await sql`
      UPDATE messages SET content = 'Mejor arquitectura'
      WHERE id = ${seeded.second_turn_id}::uuid
    `;
    const successor = await prepareMemoryToolV1({
      db: sql,
      turn_id: seeded.second_turn_id,
      conversation_id: seeded.conversation_id,
    }, {
      candidates: [{
        text: 'Mejor arquitectura',
        type: 'study_goal',
        supersedes: [abandonedId],
      }],
    });
    expect(successor.success).toBe(true);

    let commitError: unknown;
    try {
      await commit(seeded, {
        turn_id: seeded.second_turn_id,
        preparation_ids: [successor.preparation_id!],
      });
    } catch (error) {
      commitError = error;
    }
    expect(commitError).toBeInstanceOf(AgentTurnV3RejectedError);
    expect((commitError as AgentTurnV3RejectedError).rejection.violations).toEqual([
      expect.objectContaining({ code: 'MEMORY_SUPERSEDES_NOT_COMMITTABLE' }),
    ]);

    await expect(sql<Array<{ decision_id: string }>>`
      SELECT decision_id FROM agent_a_memory_projection_jobs
      WHERE turn_id = ${seeded.second_turn_id}::uuid
    `).resolves.toHaveLength(0);
    await expect(sql<Array<{ id: string }>>`
      SELECT id FROM agent_decisions WHERE turn_id = ${seeded.second_turn_id}::uuid
    `).resolves.toHaveLength(0);
  });

  it('activates a successor whose predecessor preparation is selected in the same commit', async () => {
    const seeded = await seedConversationForAgentTurn();
    // Both memory candidates cite the SAME turn, so their literal quotes
    // (the projection worker's grounding check requires the quote to be a
    // substring of a batch message) must both be present in its content.
    await sql`
      UPDATE messages SET content = 'Quiero contabilidad. Mejor administración, la verdad'
      WHERE id = ${seeded.turn_id}::uuid
    `;
    const predecessor = await prepareMemoryToolV1({
      db: sql,
      turn_id: seeded.turn_id,
      conversation_id: seeded.conversation_id,
    }, {
      candidates: [{ text: 'Quiero contabilidad', type: 'study_goal', supersedes: [] }],
    });
    expect(predecessor.success).toBe(true);
    const predecessorId = predecessor.canonical_data!.accepted[0]!.id;

    const successor = await prepareMemoryToolV1({
      db: sql,
      turn_id: seeded.turn_id,
      conversation_id: seeded.conversation_id,
    }, {
      candidates: [{
        text: 'Mejor administración',
        type: 'study_goal',
        supersedes: [predecessorId],
      }],
    });
    expect(successor.success).toBe(true);
    const successorId = successor.canonical_data!.accepted[0]!.id;

    // Same turn, same commit: predecessor and successor are a closed
    // dependency. This must NOT be rejected by the fail-closed gate.
    const committed = await commit(seeded, {
      preparation_ids: [predecessor.preparation_id!, successor.preparation_id!],
    });
    expect(committed.decision_id).toBeTruthy();

    // The disposable local database is intentionally reused across focal
    // integration commands and can contain older pending projection jobs.
    // Make this decision the oldest claimable work so the two LIMIT-1 calls
    // below still prove candidate_index ordering for this exact commit.
    await sql`
      UPDATE agent_a_memory_projection_jobs
      SET created_at = now() - interval '200 years', available_at = now()
      WHERE decision_id = ${committed.decision_id}::uuid
    `;

    // Claim one job at a time: candidate_index 0 (predecessor) is guaranteed
    // to be the sole row returned by the first LIMIT-1 claim, so it always
    // activates before the successor's job validates its `supersedes`.
    await sql.begin(async (transaction) => {
      await transaction`SET LOCAL ROLE orchestrator_role`;
      await projectAgentAMemories({ limit: 1 }, { db: transaction });
    });
    await sql.begin(async (transaction) => {
      await transaction`SET LOCAL ROLE orchestrator_role`;
      await projectAgentAMemories({ limit: 1 }, { db: transaction });
    });

    await expect(sql<Array<{
      id: string;
      status: string;
      superseded_by_memory_id: string | null;
    }>>`
      SELECT id, status, superseded_by_memory_id
      FROM selected_memories
      WHERE id = ANY(${[predecessorId, successorId]}::uuid[])
      ORDER BY id
    `).resolves.toEqual(expect.arrayContaining([
      {
        id: predecessorId,
        status: 'superseded',
        superseded_by_memory_id: successorId,
      },
      {
        id: successorId,
        status: 'active',
        superseded_by_memory_id: null,
      },
    ]));
  });

  // P1-C (re-review 2026-09-05): `enqueueLeadProjection` used to be called
  // INSIDE the commit transaction, which left `sheet_projection_rows` in
  // `pending` — immediately claimable by `flushSheetProjections` — while the
  // outbound message could still be `leased` (or never delivered at all).
  // This is the exact defect from the re-review report
  // (task-2.13-2.14-independent-rereview.md, "El lead queda reclamable por
  // Sheets antes de que el canal confirme la entrega"): a lead in the
  // spreadsheet with no confirmed delivery to the customer.
  //
  // This original assertion CODIFIED that wrong order (it asserted a claimable
  // `pending` row right after commit, with no delivery report in between). It
  // is replaced by three tests: this one (defect/negative-by-omission — no row
  // at all until delivery), one for the positive path (delivery accepted ->
  // exactly one claimable row, flushed exactly once), and one for the
  // negative path (delivery reported failed -> never claimable).
  it('defers the lead projection until delivery is confirmed: no claimable row and no Sheets contact before a delivery report', async () => {
    const seeded = await seedConversationForAgentTurn({
      intake_complete: true,
      selected_offering_code: 'entrenamiento_funcional',
    });
    // Unique per test run: lets a flush assertion below distinguish "nothing
    // was ever written for THIS lead" from "the shared disposable database
    // happens to have unrelated pending rows from other tests/prior runs".
    const spreadsheetId = `agent-loop-${randomUUID()}`;
    process.env.GOOGLE_SHEETS_SPREADSHEET_ID = spreadsheetId;
    process.env.GOOGLE_SHEETS_TAB_NAME = 'Leads';
    const first = await commit(seeded, { preparation_ids: [] });
    const replay = await commit(seeded, { preparation_ids: [] });
    expect(replay).toEqual(first);

    // The outbound is still sitting `leased` (no delivery report was ever
    // issued) — the exact reproduction from the re-review report.
    const [outbound] = await sql<Array<{ state: string }>>`
      SELECT state FROM outbound_deliveries WHERE message_id = ${first.outbound_id}::uuid
    `;
    expect(outbound?.state).toBe('leased');

    const rows = await sql<Array<{ id: string }>>`
      SELECT id FROM sheet_projection_rows
      WHERE workspace_id = ${seeded.workspace_id}::uuid
        AND projection_key = ${`lead:${seeded.workspace_id}:${seeded.contact_id}`}
    `;
    expect(rows).toHaveLength(0);

    // Even a manual/cron flush of the whole outbox must never contact Sheets
    // for THIS lead: there is no row to protect it, by construction. The
    // outbox is a shared table (other tests/workers may have unrelated
    // pending rows), so the assertion is scoped to this test's own
    // spreadsheetId rather than the global claim count.
    const fake = new FakeSheetsProvider();
    await flushSheetProjections(
      { worker_id: `test-flush-${randomUUID()}` },
      { sql, provider: fake },
    );
    expect(fake.calls.some((call) => call.spreadsheetId === spreadsheetId)).toBe(false);
  });

  it('projects a complete lead after accepted delivery without a payment or lead-projection preparation', async () => {
    const seeded = await seedConversationForAgentTurn({
      intake_complete: true,
      selected_offering_code: 'entrenamiento_funcional',
    });
    const spreadsheetId = `complete-lead-${randomUUID()}`;
    process.env.GOOGLE_SHEETS_SPREADSHEET_ID = spreadsheetId;
    process.env.GOOGLE_SHEETS_TAB_NAME = 'Leads';

    const committed = await commit(seeded, { preparation_ids: [] });

    await expect(sql<Array<{ id: string }>>`
      SELECT id FROM sheet_projection_rows
      WHERE projection_key = ${`lead:${seeded.workspace_id}:${seeded.contact_id}`}
    `).resolves.toHaveLength(0);

    await recordDeliveryReport({
      outbound_id: committed.outbound_id!,
      trace_id: randomUUID(),
      status: 'submitted_to_botpress',
      botpress_message_id: `bp-${seeded.turn_id}`,
      replayed: false,
      error_code: null,
      delivery_attempt: 1,
    });

    await expect(sql<Array<{ payload: Record<string, string> }>>`
      SELECT payload FROM sheet_projection_rows
      WHERE projection_key = ${`lead:${seeded.workspace_id}:${seeded.contact_id}`}
    `).resolves.toEqual([{
      payload: {
        nombre: 'Ana',
        apellido: 'Pérez',
        mail: expect.stringMatching(/^ana\..+@example\.test$/u),
        tipo_de_curso: 'entrenamiento_funcional',
      },
    }]);

    await expect(sql<Array<{ projections: number; payment_jobs: number }>>`
      SELECT
        (SELECT count(*)::int FROM sheet_projection_rows
          WHERE projection_key = ${`lead:${seeded.workspace_id}:${seeded.contact_id}`}) AS projections,
        (SELECT count(*)::int FROM payment_projection_jobs
          WHERE decision_id = ${committed.decision_id}::uuid) AS payment_jobs
    `).resolves.toEqual([{ projections: 1, payment_jobs: 0 }]);
  });

  it('projects once after contact details arrive across accepted turns in arbitrary order', async () => {
    const seeded = await seedConversationForAgentTurn({ call_offer_count: 2 });
    const spreadsheetId = `captured-lead-${randomUUID()}`;
    process.env.GOOGLE_SHEETS_SPREADSHEET_ID = spreadsheetId;
    process.env.GOOGLE_SHEETS_TAB_NAME = 'Leads';

    const firstNameFirst = await prepareContactDetailsToolV1({
      db: sql,
      turn_id: seeded.turn_id,
      conversation_id: seeded.conversation_id,
      contact_id: seeded.contact_id,
    }, { first_name: 'Ana' });
    expect(firstNameFirst.success).toBe(true);
    const first = await commit(seeded, { preparation_ids: [firstNameFirst.preparation_id!] });
    await recordDeliveryReport({
      outbound_id: first.outbound_id!,
      trace_id: randomUUID(),
      status: 'submitted_to_botpress',
      botpress_message_id: `bp-first-name-${seeded.turn_id}`,
      replayed: false,
      error_code: null,
      delivery_attempt: 1,
    });
    await expect(sql<Array<{ id: string }>>`
      SELECT id FROM sheet_projection_rows
      WHERE projection_key = ${`lead:${seeded.workspace_id}:${seeded.contact_id}`}
    `).resolves.toHaveLength(0);

    const courseSecond = await commit(seeded, {
      turn_id: seeded.second_turn_id,
      preparation_ids: [],
      state_patch: { selected_offering_code: 'entrenamiento_funcional' },
    });
    await recordDeliveryReport({
      outbound_id: courseSecond.outbound_id!,
      trace_id: randomUUID(),
      status: 'submitted_to_botpress',
      botpress_message_id: `bp-course-${seeded.second_turn_id}`,
      replayed: false,
      error_code: null,
      delivery_attempt: 1,
    });
    await expect(sql<Array<{ id: string }>>`
      SELECT id FROM sheet_projection_rows
      WHERE projection_key = ${`lead:${seeded.workspace_id}:${seeded.contact_id}`}
    `).resolves.toHaveLength(0);

    const [channel] = await sql<Array<{
      provider: string;
      integration_id: string;
      external_conversation_id: string;
      phone: string;
    }>>`
      SELECT thread.provider, thread.integration_id, thread.external_conversation_id, contact.phone
      FROM conversations AS conversation
      JOIN channel_threads AS thread ON thread.id = conversation.channel_thread_id
      JOIN contacts AS contact ON contact.id = conversation.contact_id
      WHERE conversation.id = ${seeded.conversation_id}::uuid
    `;
    if (!channel) throw new Error('TEST_CHANNEL_CONTEXT_MISSING');
    const thirdInbound: InboundEnvelope = {
      schema_version: 1,
      source: 'botpress',
      channel: 'emulator',
      integration_id: channel.integration_id,
      external_message_id: `agent-turn-fixture-third-${randomUUID()}`,
      external_conversation_id: channel.external_conversation_id,
      external_user_id: `agent-turn-fixture-third-user-${randomUUID()}`,
      phone_e164: channel.phone,
      trace_id: randomUUID(),
      message: {
        type: 'text',
        text: 'Mi correo es ana.garcia@example.test',
        occurred_at: new Date().toISOString(),
        reply_to_external_message_id: null,
      },
    };
    const thirdInboundResult = await processInboundMessage(thirdInbound);
    const emailThird = await prepareContactDetailsToolV1({
      db: sql,
      turn_id: thirdInboundResult.turn_id,
      conversation_id: seeded.conversation_id,
      contact_id: seeded.contact_id,
    }, { email: 'ana.garcia@example.test' });
    expect(emailThird.success).toBe(true);
    const [state] = await sql<Array<{ version: number }>>`
      SELECT version
      FROM conversation_sales_context_states_v1
      WHERE workspace_id = ${seeded.workspace_id}::uuid
        AND conversation_id = ${seeded.conversation_id}::uuid
        AND contact_id = ${seeded.contact_id}::uuid
    `;
    if (!state) throw new Error('TEST_CONVERSATION_STATE_MISSING');
    const third = await commit(seeded, {
      turn_id: thirdInboundResult.turn_id,
      state_version: Number(state.version),
      preparation_ids: [emailThird.preparation_id!],
    });
    await recordDeliveryReport({
      outbound_id: third.outbound_id!,
      trace_id: randomUUID(),
      status: 'submitted_to_botpress',
      botpress_message_id: `bp-email-${thirdInboundResult.turn_id}`,
      replayed: false,
      error_code: null,
      delivery_attempt: 1,
    });
    await expect(sql<Array<{ id: string }>>`
      SELECT id FROM sheet_projection_rows
      WHERE projection_key = ${`lead:${seeded.workspace_id}:${seeded.contact_id}`}
    `).resolves.toHaveLength(0);

    const fourthInboundResult = await processInboundMessage({
      ...thirdInbound,
      external_message_id: `agent-turn-fixture-fourth-${randomUUID()}`,
      external_user_id: `agent-turn-fixture-fourth-user-${randomUUID()}`,
      trace_id: randomUUID(),
      message: {
        type: 'text',
        text: 'Mi apellido es García',
        occurred_at: new Date().toISOString(),
        reply_to_external_message_id: null,
      },
    });
    const surnameFourth = await prepareContactDetailsToolV1({
      db: sql,
      turn_id: fourthInboundResult.turn_id,
      conversation_id: seeded.conversation_id,
      contact_id: seeded.contact_id,
    }, { last_name: 'García' });
    expect(surnameFourth.success).toBe(true);
    const [latestState] = await sql<Array<{ version: number }>>`
      SELECT version
      FROM conversation_sales_context_states_v1
      WHERE workspace_id = ${seeded.workspace_id}::uuid
        AND conversation_id = ${seeded.conversation_id}::uuid
        AND contact_id = ${seeded.contact_id}::uuid
    `;
    if (!latestState) throw new Error('TEST_CONVERSATION_STATE_MISSING');
    const fourth = await commit(seeded, {
      turn_id: fourthInboundResult.turn_id,
      state_version: Number(latestState.version),
      preparation_ids: [surnameFourth.preparation_id!],
    });
    await recordDeliveryReport({
      outbound_id: fourth.outbound_id!,
      trace_id: randomUUID(),
      status: 'submitted_to_botpress',
      botpress_message_id: `bp-surname-${fourthInboundResult.turn_id}`,
      replayed: false,
      error_code: null,
      delivery_attempt: 1,
    });

    await expect(sql<Array<{ payload: Record<string, string>; source_order: string }>>`
      SELECT payload, source_order FROM sheet_projection_rows
      WHERE projection_key = ${`lead:${seeded.workspace_id}:${seeded.contact_id}`}
    `).resolves.toEqual([{
      source_order: '8',
      payload: {
        nombre: 'Ana',
        apellido: 'García',
        mail: 'ana.garcia@example.test',
        tipo_de_curso: 'entrenamiento_funcional',
      },
    }]);
  });

  it('does not let an older accepted outbound overwrite a newer complete-lead correction', async () => {
    const seeded = await seedConversationForAgentTurn({
      intake_complete: true,
      selected_offering_code: 'entrenamiento_funcional',
    });
    const spreadsheetId = `ordered-lead-${randomUUID()}`;
    process.env.GOOGLE_SHEETS_SPREADSHEET_ID = spreadsheetId;
    process.env.GOOGLE_SHEETS_TAB_NAME = 'Leads';

    const older = await commit(seeded, { preparation_ids: [] });
    const correction = await prepareContactDetailsToolV1({
      db: sql,
      turn_id: seeded.second_turn_id,
      conversation_id: seeded.conversation_id,
      contact_id: seeded.contact_id,
    }, { last_name: 'García' });
    expect(correction.success).toBe(true);
    const newer = await commit(seeded, {
      turn_id: seeded.second_turn_id,
      preparation_ids: [correction.preparation_id!],
    });

    await recordDeliveryReport({
      outbound_id: newer.outbound_id!,
      trace_id: randomUUID(),
      status: 'submitted_to_botpress',
      botpress_message_id: `bp-newer-${seeded.second_turn_id}`,
      replayed: false,
      error_code: null,
      delivery_attempt: 1,
    });
    await recordDeliveryReport({
      outbound_id: older.outbound_id!,
      trace_id: randomUUID(),
      status: 'submitted_to_botpress',
      botpress_message_id: `bp-older-${seeded.turn_id}`,
      replayed: false,
      error_code: null,
      delivery_attempt: 1,
    });

    await expect(sql<Array<{ payload: Record<string, string>; source_order: string }>>`
      SELECT payload, source_order FROM sheet_projection_rows
      WHERE projection_key = ${`lead:${seeded.workspace_id}:${seeded.contact_id}`}
    `).resolves.toEqual([{
      source_order: '4',
      payload: {
        nombre: 'Ana',
        apellido: 'García',
        mail: expect.stringMatching(/^ana\..+@example\.test$/u),
        tipo_de_curso: 'entrenamiento_funcional',
      },
    }]);
  });

  it('promotes the deferred lead to a claimable Sheets row once delivery is accepted, and flushes it exactly once', async () => {
    const seeded = await seedConversationForAgentTurn({
      intake_complete: true,
      selected_offering_code: 'entrenamiento_funcional',
    });
    const spreadsheetId = `agent-loop-${randomUUID()}`;
    process.env.GOOGLE_SHEETS_SPREADSHEET_ID = spreadsheetId;
    process.env.GOOGLE_SHEETS_TAB_NAME = 'Leads';
    const committed = await commit(seeded, { preparation_ids: [] });

    // Before delivery: nothing claimable yet (same guarantee as the previous test).
    await expect(sql<Array<{ id: string }>>`
      SELECT id FROM sheet_projection_rows
      WHERE projection_key = ${`lead:${seeded.workspace_id}:${seeded.contact_id}`}
    `).resolves.toHaveLength(0);

    // `submitted_to_botpress` means the channel ACCEPTED the message, not that
    // the customer has seen it — the strongest proof available for the
    // Telegram sandbox, which emits no delivery receipt.
    await recordDeliveryReport({
      outbound_id: committed.outbound_id!,
      trace_id: randomUUID(),
      status: 'submitted_to_botpress',
      botpress_message_id: `bp-${seeded.turn_id}`,
      replayed: false,
      error_code: null,
      delivery_attempt: 1,
    });

    const rows = await sql<Array<{
      projection_key: string;
      state: string;
      attempt_count: number;
      row_number: number;
      payload: Record<string, unknown>;
    }>>`
      SELECT projection_key, state, attempt_count, row_number, payload
      FROM sheet_projection_rows
      WHERE workspace_id = ${seeded.workspace_id}::uuid
        AND projection_key = ${`lead:${seeded.workspace_id}:${seeded.contact_id}`}
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      projection_key: `lead:${seeded.workspace_id}:${seeded.contact_id}`,
      state: 'pending',
      attempt_count: 0,
      payload: {
        nombre: 'Ana',
        apellido: 'Pérez',
        mail: expect.stringMatching(/^ana\..+@example\.test$/u),
        tipo_de_curso: 'entrenamiento_funcional',
      },
    });
    const ourRowNumber = rows[0]!.row_number;

    // The outbox is a shared table (other tests/workers may have unrelated
    // pending rows), so "exactly once" is asserted against THIS row's calls,
    // not the flush's global counters.
    const fake = new FakeSheetsProvider();
    const ourCalls = () => fake.calls.filter(
      (call) => call.spreadsheetId === spreadsheetId && call.rowNumber === ourRowNumber,
    );
    const workerId = `test-flush-${randomUUID()}`;
    await flushSheetProjections({ worker_id: workerId }, { sql, provider: fake });
    expect(ourCalls()).toHaveLength(1);
    await expect(sql<Array<{ state: string }>>`
      SELECT state FROM sheet_projection_rows
      WHERE projection_key = ${`lead:${seeded.workspace_id}:${seeded.contact_id}`}
    `).resolves.toEqual([{ state: 'projected' }]);

    // Flushing again must not touch Sheets a second time: the row is already
    // `projected` and there is nothing left to claim.
    await flushSheetProjections({ worker_id: workerId }, { sql, provider: fake });
    expect(ourCalls()).toHaveLength(1);

    // A duplicate/replayed delivery report must not re-open or duplicate the row.
    await recordDeliveryReport({
      outbound_id: committed.outbound_id!,
      trace_id: randomUUID(),
      status: 'submitted_to_botpress',
      botpress_message_id: `bp-${seeded.turn_id}`,
      replayed: true,
      error_code: null,
      delivery_attempt: 1,
    });
    await expect(sql<Array<{ state: string }>>`
      SELECT state FROM sheet_projection_rows
      WHERE projection_key = ${`lead:${seeded.workspace_id}:${seeded.contact_id}`}
    `).resolves.toEqual([{ state: 'projected' }]);
  });

  it('never makes the lead claimable when the channel reports delivery failed', async () => {
    const seeded = await seedConversationForAgentTurn({
      intake_complete: true,
      selected_offering_code: 'entrenamiento_funcional',
    });
    const spreadsheetId = `agent-loop-${randomUUID()}`;
    process.env.GOOGLE_SHEETS_SPREADSHEET_ID = spreadsheetId;
    process.env.GOOGLE_SHEETS_TAB_NAME = 'Leads';
    const committed = await commit(seeded, { preparation_ids: [] });

    await recordDeliveryReport({
      outbound_id: committed.outbound_id!,
      trace_id: randomUUID(),
      status: 'failed',
      botpress_message_id: null,
      replayed: false,
      error_code: 'CHANNEL_REJECTED',
      delivery_attempt: 1,
    });

    await expect(sql<Array<{ id: string }>>`
      SELECT id FROM sheet_projection_rows
      WHERE projection_key = ${`lead:${seeded.workspace_id}:${seeded.contact_id}`}
    `).resolves.toHaveLength(0);

    const fake = new FakeSheetsProvider();
    await flushSheetProjections(
      { worker_id: `test-flush-${randomUUID()}` },
      { sql, provider: fake },
    );
    expect(fake.calls.some((call) => call.spreadsheetId === spreadsheetId)).toBe(false);

    // The outbound is left retryable, not stuck: a defined terminal outcome
    // (retry->accepted promotes the lead; retries exhausted means the
    // customer never received the message and, correctly, the lead is never
    // chased for a turn that was never delivered).
    const [outbound] = await sql<Array<{ state: string }>>`
      SELECT state FROM outbound_deliveries WHERE message_id = ${committed.outbound_id}::uuid
    `;
    expect(outbound?.state).toBe('failed_retryable');
  });
});
