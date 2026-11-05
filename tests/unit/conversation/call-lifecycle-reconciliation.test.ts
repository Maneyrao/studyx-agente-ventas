import { describe, expect, it } from 'vitest';
import { createDefaultConversationStateV1 } from '@/features/conversation/domain/conversation-planner';
import {
  customerResumesCommercialFlowAfterCallV1,
  reconcileTerminalCallStateV1,
} from '@/features/conversation/domain/call-lifecycle-reconciliation';

const identity = {
  workspace_id: '11111111-1111-4111-8111-111111111111',
  conversation_id: '22222222-2222-4222-8222-222222222222',
  contact_id: '33333333-3333-4333-8333-333333333333',
};

describe('reconcileTerminalCallStateV1', () => {
  it.each([
    ['quiero pagar', true],
    ['me sigue pareciendo caro', true],
    ['qué incluye el curso?', true],
    ['mi correo es ana@example.com', false],
    ['gracias', false],
    ['sí, intenta otra vez', false],
    ['cuánto tarda la llamada?', false],
  ] as const)('classifies explicit commercial resumption conservatively: %s', (message, expected) => {
    expect(customerResumesCommercialFlowAfterCallV1([message])).toBe(expected);
  });

  it('releases completed call consent without resetting the invitation budget', () => {
    const state = {
      ...createDefaultConversationStateV1(identity),
      selected_offering_code: 'marketing_digital',
      stage: 'handoff' as const,
      call_preference: 'call' as const,
      call_offer_status: 'accepted' as const,
      call_offer_count: 1 as const,
      awaiting_reply: 'none' as const,
    };

    expect(reconcileTerminalCallStateV1(state, {
      active_call: null,
      last_call_result: {
        call_id: '44444444-4444-4444-8444-444444444444',
        result: 'buzon_de_voz',
        ended_at: '2026-10-21T10:30:30.117Z',
      },
    })).toMatchObject({
      selected_offering_code: 'marketing_digital',
      stage: 'course_selected',
      call_preference: 'unknown',
      call_offer_status: 'not_offered',
      call_offer_count: 1,
      awaiting_reply: 'none',
    });
  });

  it('keeps accepted consent while a call is active', () => {
    const state = {
      ...createDefaultConversationStateV1(identity),
      stage: 'handoff' as const,
      call_preference: 'call' as const,
      call_offer_status: 'accepted' as const,
      awaiting_reply: 'none' as const,
    };

    expect(reconcileTerminalCallStateV1(state, {
      active_call: { call_id: '55555555-5555-4555-8555-555555555555', status: 'in_progress' },
      last_call_result: {
        call_id: '44444444-4444-4444-8444-444444444444',
        result: 'buzon_de_voz',
        ended_at: '2026-10-21T10:30:30.117Z',
      },
    })).toEqual(state);
  });

  it('keeps accepted consent while availability is still pending', () => {
    const state = {
      ...createDefaultConversationStateV1(identity),
      selected_offering_code: 'marketing_digital',
      stage: 'course_selected' as const,
      call_preference: 'call' as const,
      call_offer_status: 'accepted' as const,
      awaiting_reply: 'call_or_chat' as const,
    };

    expect(reconcileTerminalCallStateV1(state, {
      active_call: null,
      last_call_result: {
        call_id: '44444444-4444-4444-8444-444444444444',
        result: 'buzon_de_voz',
        ended_at: '2026-10-21T10:30:30.117Z',
      },
    }, { current_customer_signal: 'call_acceptance' })).toEqual(state);
  });

  it('releases a terminal-call acceptance when the customer resumes the sale instead of confirming availability', () => {
    const state = {
      ...createDefaultConversationStateV1(identity),
      selected_offering_code: 'marketing_digital',
      stage: 'course_selected' as const,
      call_preference: 'call' as const,
      call_offer_status: 'accepted' as const,
      call_offer_count: 0 as const,
      awaiting_reply: 'call_or_chat' as const,
    };

    expect(reconcileTerminalCallStateV1(state, {
      active_call: null,
      last_call_result: {
        call_id: '44444444-4444-4444-8444-444444444444',
        result: 'buzon_de_voz',
        ended_at: '2026-10-21T17:19:06.022Z',
      },
    }, {
      current_customer_signal: 'model_required',
      current_customer_resumes_commercial_flow: true,
    })).toMatchObject({
      selected_offering_code: 'marketing_digital',
      stage: 'course_selected',
      call_preference: 'unknown',
      call_offer_status: 'not_offered',
      call_offer_count: 0,
      awaiting_reply: 'none',
    });
  });

  it('does not consume pending retry consent for incidental text', () => {
      const state = {
        ...createDefaultConversationStateV1(identity),
        selected_offering_code: 'marketing_digital',
        stage: 'course_selected' as const,
        call_preference: 'call' as const,
        call_offer_status: 'accepted' as const,
        awaiting_reply: 'call_or_chat' as const,
      };

      expect(reconcileTerminalCallStateV1(state, {
        active_call: null,
        last_call_result: {
          call_id: '44444444-4444-4444-8444-444444444444',
          result: 'buzon_de_voz',
          ended_at: '2026-10-21T17:19:06.022Z',
        },
      }, {
        current_customer_signal: 'model_required',
        current_customer_resumes_commercial_flow: false,
      })).toEqual(state);
  });

  it('gives current call acceptance priority over an earlier commercial message in the same batch', () => {
    const state = {
      ...createDefaultConversationStateV1(identity),
      selected_offering_code: 'marketing_digital',
      stage: 'course_selected' as const,
      call_preference: 'call' as const,
      call_offer_status: 'accepted' as const,
      awaiting_reply: 'call_or_chat' as const,
    };

    expect(reconcileTerminalCallStateV1(state, {
      active_call: null,
      last_call_result: {
        call_id: '44444444-4444-4444-8444-444444444444',
        result: 'buzon_de_voz',
        ended_at: '2026-10-21T17:19:06.022Z',
      },
    }, {
      current_customer_signal: 'call_acceptance',
      current_customer_resumes_commercial_flow: true,
    })).toEqual(state);
  });

  it.each(['payment_confirmation', 'contact_details'] as const)(
    'never erases a %s checkpoint while reconciling a terminal call',
    (awaitingReply) => {
      const state = {
        ...createDefaultConversationStateV1(identity),
        selected_offering_code: 'marketing_digital',
        selected_payment_plan: 'monthly_12' as const,
        stage: 'plan_selected' as const,
        call_preference: 'call' as const,
        call_offer_status: 'accepted' as const,
        awaiting_reply: awaitingReply,
      };

      expect(reconcileTerminalCallStateV1(state, {
        active_call: null,
        last_call_result: {
          call_id: '44444444-4444-4444-8444-444444444444',
          result: 'buzon_de_voz',
          ended_at: '2026-10-21T17:19:06.022Z',
        },
      }, {
        current_customer_signal: 'model_required',
        current_customer_resumes_commercial_flow: true,
      })).toMatchObject({
        selected_offering_code: 'marketing_digital',
        selected_payment_plan: 'monthly_12',
        stage: 'plan_selected',
        call_preference: 'unknown',
        call_offer_status: 'not_offered',
        awaiting_reply: awaitingReply,
      });
    },
  );

  it('keeps a current call intake checkpoint when profile data follows an older terminal call', () => {
    const state = {
      ...createDefaultConversationStateV1(identity),
      selected_offering_code: 'marketing_digital',
      stage: 'course_selected' as const,
      call_preference: 'call' as const,
      call_offer_status: 'accepted' as const,
      awaiting_reply: 'contact_details' as const,
    };

    expect(reconcileTerminalCallStateV1(state, {
      active_call: null,
      last_call_result: {
        call_id: '44444444-4444-4444-8444-444444444444',
        result: 'buzon_de_voz',
        ended_at: '2026-10-21T17:19:06.022Z',
      },
    }, {
      current_customer_signal: 'model_required',
      current_customer_resumes_commercial_flow: false,
    })).toEqual(state);
  });

  it('releases inherited accepted consent even when the course was reselected after the terminal call', () => {
    const state = {
      ...createDefaultConversationStateV1(identity),
      selected_offering_code: 'marketing_digital',
      stage: 'course_selected' as const,
      call_preference: 'call' as const,
      call_offer_status: 'accepted' as const,
      call_offer_count: 0 as const,
      awaiting_reply: 'none' as const,
    };

    expect(reconcileTerminalCallStateV1(state, {
      active_call: null,
      last_call_result: {
        call_id: '44444444-4444-4444-8444-444444444444',
        result: 'buzon_de_voz',
        ended_at: '2026-10-21T10:30:30.117Z',
      },
    })).toMatchObject({
      stage: 'course_selected',
      call_preference: 'unknown',
      call_offer_status: 'not_offered',
      call_offer_count: 0,
      awaiting_reply: 'none',
    });
  });

  it.each(['payment_link_sent', 'closed'] as const)(
    'does not reopen a terminal commercial stage: %s',
    (stage) => {
      const state = {
        ...createDefaultConversationStateV1(identity),
        selected_offering_code: 'marketing_digital',
        stage,
        call_preference: 'call' as const,
        call_offer_status: 'accepted' as const,
        call_offer_count: 1 as const,
        awaiting_reply: 'none' as const,
      };

      expect(reconcileTerminalCallStateV1(state, {
        active_call: null,
        last_call_result: {
          call_id: '44444444-4444-4444-8444-444444444444',
          result: 'completed',
          ended_at: '2026-10-21T10:30:30.117Z',
        },
      })).toEqual(state);
    },
  );
});

// 2026-11-05, conversación 5b138536: el cliente eligió chat mientras la 4.ª
// llamada seguía abierta (v24 handoff/chat/declined). La llamada terminó
// después y el estado quedó en handoff, que cierra la bonificación.
describe('reconcileTerminalCallStateV1 — chat elegido antes del resultado terminal', () => {
  const lastCall = {
    call_id: '55555555-5555-4555-8555-555555555555',
    result: 'buzon_de_voz',
    ended_at: '2026-11-05T18:30:10.000Z',
  };
  const chatDuringCall = {
    ...createDefaultConversationStateV1(identity),
    selected_offering_code: 'real_estate',
    stage: 'handoff' as const,
    call_preference: 'chat' as const,
    call_offer_status: 'declined' as const,
    call_offer_count: 0 as const,
    awaiting_reply: 'none' as const,
  };

  it('libera handoff cuando la llamada termina después de que el cliente eligió chat', () => {
    expect(reconcileTerminalCallStateV1(chatDuringCall, { active_call: null, last_call_result: lastCall }))
      .toMatchObject({
        selected_offering_code: 'real_estate',
        stage: 'course_selected',
        call_preference: 'chat',
        call_offer_status: 'declined',
        call_offer_count: 0,
        awaiting_reply: 'none',
      });
  });

  it('conserva el plan elegido al volver', () => {
    expect(reconcileTerminalCallStateV1({ ...chatDuringCall, selected_payment_plan: 'cuotas_12' as never },
      { active_call: null, last_call_result: lastCall }).stage).toBe('plan_selected');
  });

  it('no toca el estado mientras la llamada sigue activa', () => {
    const state = reconcileTerminalCallStateV1(chatDuringCall, {
      active_call: { call_id: lastCall.call_id, status: 'in_progress' }, last_call_result: null,
    });
    expect(state).toBe(chatDuringCall);
  });

  it('sin ningún resultado terminal no libera', () => {
    expect(reconcileTerminalCallStateV1(chatDuringCall, { active_call: null, last_call_result: null }))
      .toBe(chatDuringCall);
  });
});
