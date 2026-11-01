import { describe, expect, it } from 'vitest';
import { createTurnEvidenceJournal, isTurnEvidencePersistenceError, TurnEvidencePersistenceError } from '../../../botpress-agent/src/lib/observability/turn-evidence';
import { runAgentADeepSeekAttemptV1 } from '../../../botpress-agent/src/lib/conversation/agent-a-attempt';
import { evidenceAwareWorkflow } from '../../../botpress-agent/src/lib/observability/evidence-workflow';

describe('durable turn evidence', () => {
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
