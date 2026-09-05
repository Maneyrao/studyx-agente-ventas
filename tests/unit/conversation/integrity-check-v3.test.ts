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
    preparation_tools: { 'prep-1': 'prepare_payment_link' as const },
    intake_missing: [] as string[],
    call_policy: {
      offer_allowed: true,
      offer_required: false,
      request_allowed: true,
    },
  },
  rejection_id: 'r-1',
};

describe('checkAgentTurnIntegrityV3', () => {
  it('accepts a clean turn without rewriting it', () => {
    const before = JSON.stringify(base);
    expect(checkAgentTurnIntegrityV3(base)).toEqual({ ok: true });
    expect(JSON.stringify(base)).toBe(before);
  });

  it('accepts an authorized fact without rewriting it', () => {
    const input = {
      ...base,
      decision: {
        ...base.decision,
        blocks: [{ type: 'fact' as const, fact_id: 'fact:price:one_time' }],
      },
    };
    const before = JSON.stringify(input);
    expect(checkAgentTurnIntegrityV3(input)).toEqual({ ok: true });
    expect(JSON.stringify(input)).toBe(before);
  });

  it('rejects every narrative violation and carries no customer text', () => {
    const input = {
      ...base,
      decision: {
        ...base.decision,
        blocks: [{ type: 'narrative' as const, text: 'Sale USD 999 en https://x.com/a' }],
      },
    };
    const before = JSON.stringify(input);
    const result = checkAgentTurnIntegrityV3(input);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.violations.map((violation) => violation.code)).toEqual([
      'NARRATIVE_CONTAINS_URL',
      'NARRATIVE_CONTAINS_AMOUNT',
    ]);
    expect(JSON.stringify(result)).not.toContain('Sale USD');
    expect(JSON.stringify(input)).toBe(before);
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
      { code: 'STATE_ACTION_INCOHERENT', subject: 'prep-1' },
    ]);
  });

  it('does not require payment intake for a call preparation', () => {
    const result = checkAgentTurnIntegrityV3({
      ...base,
      decision: {
        ...base.decision,
        response_type: 'call_confirmation',
        commit_preparations: ['call-prep'],
      },
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

  it('rejects every payment preparation that is not represented by its own artifact', () => {
    const result = checkAgentTurnIntegrityV3({
      ...base,
      decision: {
        ...base.decision,
        blocks: [{ type: 'artifact', preparation_id: 'pay-1' }],
        commit_preparations: ['pay-1', 'pay-2'],
        state_patch: {
          expected_state_version: 5,
          set: { stage: 'payment_link_sent' as const },
        },
      },
      context: {
        ...base.context,
        open_preparations: ['pay-1', 'pay-2'],
        preparation_tools: {
          'pay-1': 'prepare_payment_link',
          'pay-2': 'prepare_payment_link',
        },
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.violations).toContainEqual({
      code: 'STATE_ACTION_INCOHERENT',
      subject: 'pay-2',
    });
  });

  it('fails closed when an open preparation has no authoritative tool type', () => {
    const result = checkAgentTurnIntegrityV3({
      ...base,
      decision: {
        ...base.decision,
        blocks: [{ type: 'artifact', preparation_id: 'prep-1' }],
        commit_preparations: ['prep-1'],
      },
      context: {
        ...base.context,
        preparation_tools: {},
        intake_missing: ['correo'],
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.violations).toContainEqual({
      code: 'PREPARATION_TYPE_UNKNOWN',
      subject: 'prep-1',
    });
  });

  it('rejects an unused open preparation without an authoritative tool type', () => {
    const result = checkAgentTurnIntegrityV3({
      ...base,
      decision: {
        ...base.decision,
        blocks: [{ type: 'fact', fact_id: 'fact:invented' }],
      },
      context: {
        ...base.context,
        open_preparations: ['untyped-open'],
        preparation_tools: {},
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.violations).toContainEqual({
      code: 'PREPARATION_TYPE_UNKNOWN',
      subject: 'untyped-open',
    });
    expect(result.rejection.authorized_alternatives.preparations).toEqual([]);
  });

  it('rejects a call offer forbidden by the authoritative call policy', () => {
    const result = checkAgentTurnIntegrityV3({
      ...base,
      decision: {
        ...base.decision,
        response_type: 'call_offer',
        state_patch: {
          expected_state_version: 5,
          set: {
            call_offer_delta: 1 as const,
            call_offer_status: 'offered' as const,
            awaiting_reply: 'call_or_chat' as const,
          },
        },
      },
      context: {
        ...base.context,
        call_policy: {
          offer_allowed: false,
          offer_required: false,
          request_allowed: false,
        },
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.violations).toContainEqual({
      code: 'CALL_OFFER_NOT_AUTHORIZED',
      subject: 'response_type',
    });
  });

  it('rejects a visible call offer that omits its structured signals', () => {
    const result = checkAgentTurnIntegrityV3({
      ...base,
      decision: {
        ...base.decision,
        blocks: [{ type: 'narrative', text: 'Si querés, podemos coordinar una llamada.' }],
      },
      context: {
        ...base.context,
        call_policy: {
          offer_allowed: false,
          offer_required: false,
          request_allowed: false,
        },
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.violations).toContainEqual({
      code: 'STATE_ACTION_INCOHERENT',
      subject: 'call_offer',
    });
    expect(result.rejection.violations).toContainEqual({
      code: 'CALL_OFFER_NOT_AUTHORIZED',
      subject: 'response_type',
    });
  });

  it('accepts a visible call offer with every structured signal when policy allows it', () => {
    const result = checkAgentTurnIntegrityV3({
      ...base,
      decision: {
        ...base.decision,
        blocks: [{ type: 'narrative', text: 'Si querés, podemos coordinar una llamada.' }],
        response_type: 'call_offer',
        state_patch: {
          expected_state_version: 5,
          set: {
            call_offer_delta: 1 as const,
            call_offer_status: 'offered' as const,
            awaiting_reply: 'call_or_chat' as const,
          },
        },
      },
    });
    expect(result).toEqual({ ok: true });
  });

  it('rejects omitting a call offer when the authoritative policy requires it', () => {
    const result = checkAgentTurnIntegrityV3({
      ...base,
      context: {
        ...base.context,
        call_policy: {
          offer_allowed: true,
          offer_required: true,
          request_allowed: false,
        },
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.violations).toContainEqual({
      code: 'CALL_OFFER_REQUIRED',
      subject: 'response_type',
    });
  });

  it('rejects committing a call request forbidden by policy', () => {
    const result = checkAgentTurnIntegrityV3({
      ...base,
      decision: { ...base.decision, commit_preparations: ['call-prep'] },
      context: {
        ...base.context,
        open_preparations: ['call-prep'],
        preparation_tools: { 'call-prep': 'prepare_call_request' },
        call_policy: {
          offer_allowed: false,
          offer_required: false,
          request_allowed: false,
        },
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.violations).toContainEqual({
      code: 'CALL_REQUEST_NOT_AUTHORIZED',
      subject: 'call-prep',
    });
  });

  it('rejects a call confirmation without a committed call preparation', () => {
    const result = checkAgentTurnIntegrityV3({
      ...base,
      decision: {
        ...base.decision,
        blocks: [{ type: 'narrative', text: 'Perfecto, coordinamos la llamada.' }],
        response_type: 'call_confirmation',
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.violations).toContainEqual({
      code: 'STATE_ACTION_INCOHERENT',
      subject: 'call_confirmation',
    });
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
