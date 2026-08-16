import { describe, expect, it } from 'vitest';

/**
 * The deterministic call fast path: unambiguous signals skip catalog and
 * model, everything else falls through, and a negation can never request a
 * call. The emitted decisions are Decision v4 — the backend re-validates
 * consent on commit either way.
 */
import { matchCallHandoffFastPath } from '../../../botpress-agent/src/utils/call-handoff-fast-path';
import type { ClaimedTurn } from '../../../botpress-agent/src/schemas/contracts';

const UUID = '18a823e8-27c2-4279-9956-058f45f33cd5';

function claimed(overrides: {
  texts?: string[];
  allowedActions?: Array<'offer_call' | 'request_call_now'>;
  openOffer?: boolean;
  course?: string | null;
}): ClaimedTurn {
  const texts = overrides.texts ?? ['Llamame'];
  return {
    outcome: 'claimed',
    trace_id: UUID,
    batch: {
      id: UUID,
      claim_token: UUID,
      conversation_id: UUID,
      contact_id: UUID,
      lease_until: '2026-08-16T00:00:10.000Z',
      hard_deadline_at: '2026-08-16T00:00:04.000Z',
      message_count: texts.length,
      stolen: false,
    },
    turn_id: UUID,
    policy: {
      may_respond: true,
      allowed_response_types: ['social_reply', 'commercial_reply', 'clarification'],
      reason: null,
    },
    contact: {
      id: UUID,
      status: 'prospecto',
      name: null,
      blocked: false,
      consent_status: 'allowed',
      opted_in_at: '2026-08-12T00:00:00.000Z',
    },
    context: {
      batch_messages: texts.map((text, index) => ({
        id: UUID,
        conversation_seq: index + 1,
        content: text,
        created_at: '2026-08-16T00:00:00.000Z',
        message_type: 'text',
      })),
      recent_turns: [],
      summary: { text: null, version: 0, updated_at: null },
      selected_memories: [],
      long_term_memory_available: false,
      knowledge_base: [],
      knowledge_base_available: false,
      knowledge_base_dropped: 0,
      injection_suspected_count: 0,
    },
    sales_context: {
      mode: 'advising',
      course_of_interest: overrides.course ?? null,
      open_call_offer: overrides.openOffer
        ? { decision_id: UUID, expires_at: '2026-08-16T00:15:00.000Z' }
        : null,
      active_call: null,
      allowed_actions: overrides.allowedActions ?? ['offer_call'],
      last_call_result: null,
    },
    existing_result: null,
  } as unknown as ClaimedTurn;
}

describe('matchCallHandoffFastPath', () => {
  it('a direct request with request_call_now allowed becomes an immediate v4 request', () => {
    const decision = matchCallHandoffFastPath(
      claimed({ texts: ['Llamame ahora'], allowedActions: ['request_call_now'], course: 'Python' }),
    );
    expect(decision).toMatchObject({
      schema_version: 4,
      response_type: 'call_confirmation',
      business_action: {
        type: 'request_call_now',
        reason: 'direct_request',
        course_of_interest: 'Python',
      },
    });
    expect(decision!.response).not.toMatch(/conectad|en línea|sonando/i);
  });

  it('a direct request without policy permission falls through to the model', () => {
    expect(
      matchCallHandoffFastPath(claimed({ texts: ['Llamame'], allowedActions: [] })),
    ).toBeNull();
  });

  it('an exact acceptance over an open offer becomes an accepted_offer request', () => {
    const decision = matchCallHandoffFastPath(
      claimed({ texts: ['sí'], allowedActions: ['request_call_now'], openOffer: true }),
    );
    expect(decision).toMatchObject({
      response_type: 'call_confirmation',
      business_action: { type: 'request_call_now', reason: 'accepted_offer' },
    });
  });

  it('a bare acceptance without an offer asks one clarification and never calls', () => {
    const decision = matchCallHandoffFastPath(
      claimed({ texts: ['sí'], allowedActions: [], openOffer: false }),
    );
    expect(decision).toMatchObject({
      kind: 'clarify',
      response_type: 'clarification',
      business_action: null,
      next_state: 'waiting_user',
    });
    const questions = (decision!.response ?? '').match(/[?]/g) ?? [];
    expect(questions.length).toBeLessThanOrEqual(1);
  });

  it('a negation wins over the affirmative and never requests a call', () => {
    expect(
      matchCallHandoffFastPath(
        claimed({
          texts: ['Sí, pero no me llames'],
          allowedActions: ['request_call_now'],
          openOffer: true,
        }),
      ),
    ).toBeNull();
  });

  it('an opt-out never requests a call', () => {
    expect(
      matchCallHandoffFastPath(
        claimed({ texts: ['Quiero darme de baja'], allowedActions: ['request_call_now'] }),
      ),
    ).toBeNull();
  });

  it('a multi-message burst goes to the model', () => {
    expect(
      matchCallHandoffFastPath(
        claimed({
          texts: ['¿Cuánto sale Python?', 'Llamame'],
          allowedActions: ['request_call_now'],
        }),
      ),
    ).toBeNull();
  });

  it('anything outside the bounded patterns goes to the model', () => {
    expect(
      matchCallHandoffFastPath(
        claimed({ texts: ['Quiero información'], allowedActions: ['request_call_now'] }),
      ),
    ).toBeNull();
  });
});
