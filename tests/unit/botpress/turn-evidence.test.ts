import { describe, expect, it, vi } from 'vitest';
import { createTurnEvidenceJournal, isTurnEvidencePersistenceError, TurnEvidencePersistenceError } from '../../../botpress-agent/src/lib/observability/turn-evidence';
import { runAgentADeepSeekAttemptV1 } from '../../../botpress-agent/src/lib/conversation/agent-a-attempt';
import { evidenceAwareWorkflow, getOrCreateEvidenceWorkflow, hydrateWorkflowCallback } from '../../../botpress-agent/src/lib/observability/evidence-workflow';

describe('durable turn evidence', () => {
  it.each([{ error_code: 'TURN_EVIDENCE_UNAVAILABLE' }, { error_code: 'TURN_EVIDENCE_RECOVERED_REQUIRES_REVIEW' },
    { outcome: 'evidence_review_required' }])('preserves terminal output even when late tags failed: %j', async output => {
    const original = { workflow: { id: 'original', status: 'completed', output, tags: {} } };
    const load = vi.fn(async () => original);
    expect(await evidenceAwareWorkflow(load)).toBe(original);
    expect(load).toHaveBeenCalledOnce();
  });
  it('joins via the public client without loading any ADK state and preserves the keyed input', async () => {
    const getOrCreateWorkflow = vi.fn(async () => ({ workflow: { id: 'raw', status: 'pending', tags: {} } }));
    const deleteWorkflow = vi.fn();
    const args = { name: 'processInboundTurn', input: { trace_id: 'trace' }, tags: { key: 'turn:key' },
      discriminateByTags: ['key'], conversationId: 'conversation', timeoutAt: '2026-11-02T03:00:00Z' };
    expect(await getOrCreateEvidenceWorkflow({ getOrCreateWorkflow, deleteWorkflow } as never, args)).toMatchObject({ id: 'raw' });
    expect(getOrCreateWorkflow).toHaveBeenCalledExactlyOnceWith({ ...args, status: 'pending' });
    expect(deleteWorkflow).not.toHaveBeenCalled();
  });
  it.each(['timedout', 'cancelled', 'completed', 'failed'])('retains pending evidence on %s without deleting a workflow', async status => {
    const original = { id: 'original', status, tags: { studyxEvidenceReview: 'true' } };
    const getOrCreateWorkflow = vi.fn(async () => ({ workflow: original }));
    const deleteWorkflow = vi.fn();
    expect(await getOrCreateEvidenceWorkflow({ getOrCreateWorkflow, deleteWorkflow } as never,
      { name: 'processInboundTurn', input: {}, tags: { key: 'original' }, discriminateByTags: ['key'] })).toBe(original);
    expect(deleteWorkflow).not.toHaveBeenCalled();
  });
  it('awaits callback state hydration before the router can finish', async () => {
    let release!: () => void;
    const hydrate = vi.fn(() => new Promise<void>(resolve => { release = resolve; }));
    let returned = false;
    const pending = hydrateWorkflowCallback('workflow_callback', { workflow: { id: 'worker' } }, hydrate)
      .then(result => { returned = true; return result; });
    await Promise.resolve();
    expect(hydrate).toHaveBeenCalledWith('worker');
    expect(returned).toBe(false);
    release();
    expect(await pending).toBe(true);
    expect(await hydrateWorkflowCallback('message', undefined, hydrate)).toBe(false);
  });
  it.each([true, false])('preserves terminal evidence but permits ordinary release recovery (evidence=%s)', async evidence => {
    let created = 0;
    const terminal = { workflow: { status: 'completed' }, tags: { studyxEvidenceReview: evidence ? 'true' : undefined }, id: 'original' };
    // Characterization of installed ADK 2.0.8: an excluded terminal status
    // deletes/replaces the instance. Test our boundary against that contract.
    const result = await evidenceAwareWorkflow(async statuses => {
      if (statuses?.includes('completed')) return terminal;
      created += 1;
      return { ...terminal, id: 'replacement' };
    });
    expect(result.id).toBe(evidence ? 'original' : 'replacement');
    expect(created).toBe(evidence ? 0 : 1);
  });
  it('recognizes a plain cached ADK error without class or code and rejects unrelated errors', () => {
    expect(isTurnEvidencePersistenceError(new Error('TURN_EVIDENCE_UNAVAILABLE\nWorkflow step context'))).toBe(true);
    expect(isTurnEvidencePersistenceError(new Error('BRAIN_DEEPSEEK_TIMEOUT'))).toBe(false);
    expect(isTurnEvidencePersistenceError(new Error('TURN_EVIDENCE_UNAVAILABLE_OTHER'))).toBe(false);
  });
  it('never retries generation when persisting a repaired draft fails', async () => {
    let generations = 0;
    let retries = 0;
    const journal = createTurnEvidenceJournal(async () => { throw new Error('DB_UNAVAILABLE'); });
    await expect(runAgentADeepSeekAttemptV1({
      generate: () => journal.generate(async observe => {
        generations += 1;
        observe({ kind: 'model_raw', raw_content: 'Borrador reparado.' });
        return 'repaired';
      }, { rejection: { code: 'FACT_VALUE_MISMATCH', subject: 'price' } }),
      onRetry: () => { retries += 1; },
    })).rejects.toBeInstanceOf(TurnEvidencePersistenceError);
    expect(generations).toBe(1);
    expect(retries).toBe(0);
  });
  it('captures original malformed output and failure without a decision', async () => {
    const saved: unknown[] = [];
    const journal = createTurnEvidenceJournal(async event => { saved.push(event); });
    await expect(journal.generate(async observe => {
      observe({ kind: 'model_raw', raw_content: '{invalid json Tenés', provider: 'deepseek-direct', attempt: 1 });
      throw new Error('BRAIN_DEEPSEEK_INVALID_JSON');
    }, { rejection: { rejections: [{ code: 'FACT_VALUE_MISMATCH', subject: 'price' }] } }))
      .rejects.toThrow('BRAIN_DEEPSEEK_INVALID_JSON');
    expect(saved).toEqual([
      expect.objectContaining({ kind: 'generation_started', data: { rejection: { rejections: [{ code: 'FACT_VALUE_MISMATCH', subject: 'price' }] } } }),
      expect.objectContaining({ kind: 'model_raw', data: { raw_content: '{invalid json Tenés', provider: 'deepseek-direct', attempt: 1 } }),
      expect.objectContaining({ kind: 'generation_failed', data: { code: 'BRAIN_DEEPSEEK_INVALID_JSON' } }),
    ]);
  });

  it('retries persistence with the same evidence identity and never regenerates', async () => {
    let generations = 0;
    let available = false;
    const attempted: unknown[] = [];
    const journal = createTurnEvidenceJournal(async event => {
      attempted.push(event);
      if (!available) throw new Error('DB_UNAVAILABLE');
    });
    await expect(journal.generate(async observe => {
      generations += 1;
      observe({ kind: 'model_raw', raw_content: '¿Tenés cámara?' });
      return 'generated';
    }, {})).rejects.toBeInstanceOf(TurnEvidencePersistenceError);
    available = true;
    await journal.flush();
    expect(generations).toBe(1);
    expect(attempted[1]).toEqual(attempted[0]);
    expect(attempted).toContainEqual(expect.objectContaining({ kind: 'model_raw', data: { raw_content: '¿Tenés cámara?' } }));
    const count = attempted.length;
    await journal.flush();
    expect(attempted).toHaveLength(count);
  });
});
