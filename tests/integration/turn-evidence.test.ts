import { describe, expect, it, vi, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { sql } from '@/lib/db/orchestrator';
import { recordTurnEvidence } from '@/lib/services/turn-evidence.service';
import { seedConversationForAgentTurn } from '../helpers/agent-turn-fixtures';

afterEach(() => vi.unstubAllEnvs());
(process.env.TEST_DATABASE_URL ? describe : describe.skip)('turn evidence persistence', () => {
  it('keeps raw drafts and rejection subjects without a decision; replay is exact', async () => {
    const f = await seedConversationForAgentTurn({ selected_offering_code: 'entrenamiento_funcional', intake_complete: true });
    const backendSha = 'a'.repeat(40);
    vi.stubEnv('STUDYX_RELEASE_SHA', backendSha);
    const event = { subject_type: 'turn', subject_id: f.turn_id, trace_id: f.trace_id, event_id: randomUUID(),
      kind: 'model_raw', botpress_version: 'synthetic-botpress-v1', brain_version: 'brain-v145', prompt_version: 'canonical-v101',
      data: { raw_content: '{invalid JSON ¿Tenés?', rejection: { code: 'FACT_VALUE_MISMATCH', subject: 'price' } } };
    await recordTurnEvidence(sql, event);
    vi.stubEnv('STUDYX_RELEASE_SHA', 'b'.repeat(40));
    await recordTurnEvidence(sql, event);
    const rows = await sql`SELECT payload FROM audit_log WHERE entity_id=${f.turn_id} AND action='agent.turn.evidence'`;
    expect(rows).toHaveLength(1);
    expect(rows[0].payload).toEqual({ observation: event, backend_sha: backendSha });
    expect((await sql`SELECT count(*)::int AS n FROM agent_decisions WHERE turn_id=${f.turn_id}`)[0].n).toBe(0);
    await expect(recordTurnEvidence(sql, { ...event, data: { raw_content: 'different draft' } })).rejects.toBeDefined();
    await expect(recordTurnEvidence(sql, { ...event, subject_id: randomUUID(), event_id: randomUUID() }))
      .rejects.toThrow('EVIDENCE_SUBJECT_NOT_AUTHORIZED');
  });
});
