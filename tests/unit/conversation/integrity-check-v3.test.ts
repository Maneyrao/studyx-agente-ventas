import { describe, expect, it } from 'vitest';
import { checkAgentTurnIntegrityV3 } from '@/features/conversation/domain/integrity-check-v3';

const base = {
  decision: {
    schema_version: 3 as const,
    blocks: [{ type: 'narrative' as const, text: 'Dale, te cuento.' }],
    commit_preparations: [] as string[],
    used_memory_ids: [],
    state_patch: { expected_state_version: 5, set: {} },
    response_type: 'commercial_reply',
  },
  context: {
    state_version: 5,
    authorized_fact_ids: ['fact:price:one_time'],
    open_preparations: ['prep-1'],
    preparation_tools: { 'prep-1': 'prepare_payment_link' },
    intake_missing: [] as string[],
  },
  rejection_id: 'r-1',
};

describe('checkAgentTurnIntegrityV3', () => {
  it('accepts a clean turn without rewriting it', () => {
    expect(checkAgentTurnIntegrityV3(base)).toEqual({ ok: true });
  });

  it('rejects every narrative violation and carries no customer text', () => {
    const result = checkAgentTurnIntegrityV3({
      ...base,
      decision: {
        ...base.decision,
        blocks: [{ type: 'narrative', text: 'Sale USD 999 en https://x.com/a' }],
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.violations.map((violation) => violation.code)).toEqual([
      'NARRATIVE_CONTAINS_URL',
      'NARRATIVE_CONTAINS_AMOUNT',
    ]);
    expect(JSON.stringify(result)).not.toContain('Sale USD');
  });

  it('rejects facts and artifact preparations outside the authorized context', () => {
    const result = checkAgentTurnIntegrityV3({
      ...base,
      decision: {
        ...base.decision,
        blocks: [
          { type: 'fact', fact_id: 'fact:invented' },
          { type: 'artifact', preparation_id: 'prep-ghost' },
        ],
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.violations).toEqual([
      { code: 'FACT_NOT_AUTHORIZED', subject: 'fact:invented' },
      { code: 'PREPARATION_NOT_OPEN', subject: 'prep-ghost' },
    ]);
  });

  it('rejects a stale expected state version', () => {
    const result = checkAgentTurnIntegrityV3({
      ...base,
      decision: {
        ...base.decision,
        state_patch: { expected_state_version: 4, set: {} },
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.violations).toEqual([{
      code: 'STATE_VERSION_CONFLICT',
      subject: 'state_patch',
      detail: 'expected 4, current 5',
    }]);
  });

  it('rejects a payment-link stage without a committed preparation', () => {
    const result = checkAgentTurnIntegrityV3({
      ...base,
      decision: {
        ...base.decision,
        state_patch: { expected_state_version: 5, set: { stage: 'payment_link_sent' as const } },
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.violations).toEqual([
      { code: 'STATE_ACTION_INCOHERENT', subject: 'stage' },
    ]);
  });

  it('rejects a committed preparation that is not open for this turn', () => {
    const result = checkAgentTurnIntegrityV3({
      ...base,
      decision: { ...base.decision, commit_preparations: ['prep-ghost'] },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.violations).toEqual([
      { code: 'PREPARATION_NOT_OPEN', subject: 'prep-ghost' },
    ]);
  });

  it('rejects committing a preparation while intake is incomplete', () => {
    const result = checkAgentTurnIntegrityV3({
      ...base,
      decision: { ...base.decision, commit_preparations: ['prep-1'] },
      context: { ...base.context, intake_missing: ['correo'] },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.violations).toContainEqual(
      { code: 'MISSING_INTAKE', subject: 'commit_preparations' },
    );
  });

  it('rejects a payment preparation without its artifact and delivered stage', () => {
    const result = checkAgentTurnIntegrityV3({
      ...base,
      decision: { ...base.decision, commit_preparations: ['prep-1'] },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.violations).toEqual([
      { code: 'STATE_ACTION_INCOHERENT', subject: 'commit_preparations' },
    ]);
  });

  it('does not require payment intake for a call preparation', () => {
    const result = checkAgentTurnIntegrityV3({
      ...base,
      decision: { ...base.decision, commit_preparations: ['call-prep'] },
      context: {
        ...base.context,
        open_preparations: ['call-prep'],
        preparation_tools: { 'call-prep': 'prepare_call_request' },
        intake_missing: ['correo'],
      },
    });
    expect(result).toEqual({ ok: true });
  });

  it('rejects an open artifact that the decision did not commit', () => {
    const result = checkAgentTurnIntegrityV3({
      ...base,
      decision: {
        ...base.decision,
        blocks: [{ type: 'artifact', preparation_id: 'prep-1' }],
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.violations).toEqual([
      { code: 'STATE_ACTION_INCOHERENT', subject: 'prep-1' },
    ]);
  });

  it('accepts a coherent payment artifact, commit and stage', () => {
    const result = checkAgentTurnIntegrityV3({
      ...base,
      decision: {
        ...base.decision,
        blocks: [{ type: 'artifact', preparation_id: 'prep-1' }],
        commit_preparations: ['prep-1'],
        state_patch: {
          expected_state_version: 5,
          set: { stage: 'payment_link_sent' as const },
        },
      },
    });
    expect(result).toEqual({ ok: true });
  });

  it('returns only authorized alternatives for one repair attempt', () => {
    const result = checkAgentTurnIntegrityV3({
      ...base,
      decision: {
        ...base.decision,
        blocks: [{ type: 'fact', fact_id: 'fact:invented' }],
      },
      context: { ...base.context, intake_missing: ['correo'] },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection).toEqual({
      rejection_id: 'r-1',
      attempt: 1,
      violations: [{ code: 'FACT_NOT_AUTHORIZED', subject: 'fact:invented' }],
      authorized_alternatives: {
        fact_ids: ['fact:price:one_time'],
        preparations: ['prep-1'],
        missing_information: ['correo'],
      },
    });
  });
});
