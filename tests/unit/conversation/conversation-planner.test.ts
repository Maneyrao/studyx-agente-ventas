import { describe, expect, it } from 'vitest';
import type { ConversationMoveV1, ConversationStateV1 } from '@/features/conversation/domain/conversation-pipeline';
import {
  createDefaultConversationStateV1,
  planConversationTurn,
  type PlanningBusinessContextV1,
} from '@/features/conversation/domain/conversation-planner';

const business: PlanningBusinessContextV1 = {
  catalog_available: true,
  areas: [
    { code: 'tecnologia', display_name: 'Tecnología' },
    { code: 'oficios', display_name: 'Oficios' },
  ],
  offerings: [
    { code: 'redes-informaticas', display_name: 'Redes Informáticas', area_code: 'tecnologia' },
    { code: 'armado-reparacion-pc', display_name: 'Armado y Reparación de PC', area_code: 'tecnologia' },
    { code: 'barista', display_name: 'Barista', area_code: 'oficios' },
  ],
  payment_plans: ['monthly_12', 'monthly_6', 'one_time'],
};

function state(overrides: Partial<ConversationStateV1> = {}): ConversationStateV1 {
  return {
    ...createDefaultConversationStateV1({
      workspace_id: '00000000-0000-4000-8000-000000000001',
      conversation_id: '00000000-0000-4000-8000-000000000002',
      contact_id: '00000000-0000-4000-8000-000000000003',
    }),
    ...overrides,
  };
}

function move(
  kind: ConversationMoveV1['move'],
  overrides: Partial<ConversationMoveV1> = {},
): ConversationMoveV1 {
  return {
    schema_version: 1,
    move: kind,
    secondary_moves: [],
    vetoes: [],
    confidence: 0.95,
    ...overrides,
  };
}

function plan(currentMove: ConversationMoveV1, currentState: ConversationStateV1) {
  return planConversationTurn({ move: currentMove, sales_context: currentState, business_context: business });
}

describe('planConversationTurn', () => {
  it('accepts chat after a call choice and consumes the offer without asking again', () => {
    const result = plan(move('continue_by_chat'), state({
      selected_offering_code: 'redes-informaticas',
      stage: 'course_selected',
      call_offer_status: 'offered',
      awaiting_reply: 'call_or_chat',
    }));

    expect(result).toMatchObject({
      next_call_preference: 'chat',
      next_call_offer_status: 'declined',
      next_awaiting_reply: 'none',
      response_goal: 'acknowledge_chat_preference',
      canonical_fact_requests: [
        { kind: 'offering_name', offering_code: 'redes-informaticas' },
        { kind: 'offering_description', offering_code: 'redes-informaticas' },
        { kind: 'offering_duration', offering_code: 'redes-informaticas' },
        { kind: 'offering_modality', offering_code: 'redes-informaticas' },
      ],
      should_offer_call: false,
      allowed_business_action: { type: 'none' },
    });
  });

  it('treats a structured call veto during a pending call choice as continuing by chat', () => {
    const result = plan(move('ask_course_information', {
      vetoes: ['call'],
      course_reference: 'Redes Informáticas',
    }), state({
      selected_offering_code: 'redes-informaticas',
      stage: 'course_selected',
      call_offer_status: 'offered',
      call_offer_count: 2,
      awaiting_reply: 'call_or_chat',
    }));

    expect(result).toMatchObject({
      next_call_preference: 'chat',
      next_call_offer_status: 'declined',
      next_awaiting_reply: 'none',
      should_offer_call: false,
      allowed_business_action: { type: 'none' },
    });
  });

  it('treats chat without a prior offer as advisory context, not new authority', () => {
    const result = plan(move('continue_by_chat'), state({
      selected_offering_code: 'redes-informaticas',
      stage: 'course_selected',
    }));

    expect(result).toMatchObject({
      next_call_preference: 'unknown',
      next_call_offer_status: 'not_offered',
      response_goal: 'continue_course_advice',
      should_offer_call: false,
      allowed_business_action: { type: 'none' },
    });
  });

  it('continues after a declined call and allows a later direct request without another offer', () => {
    const declined = plan(move('decline_call'), state({
      selected_offering_code: 'redes-informaticas',
      stage: 'course_selected',
      call_offer_status: 'offered',
      awaiting_reply: 'call_or_chat',
    }));
    const requested = plan(move('request_call'), state({
      selected_offering_code: declined.selected_offering_code,
      stage: declined.next_stage,
      call_preference: declined.next_call_preference,
      call_offer_status: declined.next_call_offer_status,
      awaiting_reply: declined.next_awaiting_reply,
    }));

    expect(declined).toMatchObject({
      next_call_preference: 'declined',
      next_call_offer_status: 'declined',
      response_goal: 'acknowledge_call_decline',
      next_stage: 'course_selected',
    });
    expect(requested).toMatchObject({
      next_call_preference: 'call',
      next_call_offer_status: 'accepted',
      should_offer_call: false,
      allowed_business_action: { type: 'request_call_now', reason: 'direct_request' },
      next_stage: 'handoff',
    });
  });

  it('offers a call at most twice per conversation while the preference remains unknown', () => {
    const first = plan(move('ask_course_information'), state({
      selected_offering_code: 'redes-informaticas', stage: 'course_selected',
    }));
    const second = plan(move('ask_course_information'), state({
      selected_offering_code: 'redes-informaticas', stage: 'course_selected',
      call_offer_status: first.next_call_offer_status,
      call_offer_count: first.next_call_offer_count,
      awaiting_reply: first.next_awaiting_reply,
    }));
    const exhausted = plan(move('ask_course_information'), state({
      selected_offering_code: 'redes-informaticas', stage: 'course_selected',
      call_offer_status: second.next_call_offer_status,
      call_offer_count: second.next_call_offer_count,
      awaiting_reply: second.next_awaiting_reply,
    }));

    expect(first).toMatchObject({
      should_offer_call: true,
      next_call_offer_status: 'offered',
      next_call_offer_count: 1,
      next_awaiting_reply: 'call_or_chat',
    });
    expect(second).toMatchObject({
      should_offer_call: true,
      next_call_offer_status: 'offered',
      next_call_offer_count: 2,
    });
    expect(exhausted).toMatchObject({
      should_offer_call: false,
      next_call_offer_status: 'offered',
      next_call_offer_count: 2,
    });
    const accepted = plan(move('request_call'), state({
      selected_offering_code: 'redes-informaticas', stage: 'course_selected',
      call_offer_status: first.next_call_offer_status,
      awaiting_reply: first.next_awaiting_reply,
    }));
    expect(accepted.allowed_business_action).toEqual({
      type: 'request_call_now', reason: 'accepted_offer',
    });
  });

  it('uses the first call offer when a specific course is selected', () => {
    const selected = plan(
      move('select_course', { course_reference: 'Redes Informáticas' }),
      state(),
    );

    expect(selected).toMatchObject({
      selected_offering_code: 'redes-informaticas',
      should_offer_call: true,
      next_call_offer_status: 'offered',
      next_call_offer_count: 1,
      next_awaiting_reply: 'call_or_chat',
    });
  });

  it('never spends both call offers inside one compound turn', () => {
    const selected = plan(
      move('select_course', {
        course_reference: 'Redes Informáticas',
        secondary_moves: ['ask_course_information'],
      }),
      state(),
    );

    expect(selected).toMatchObject({
      should_offer_call: true,
      next_call_offer_count: 1,
      next_call_offer_status: 'offered',
      next_awaiting_reply: 'call_or_chat',
    });
  });

  it('resolves a canonical course and clears a plan selected for another course', () => {
    const result = plan(move('select_course', { course_reference: 'Redes Informáticas' }), state({
      selected_offering_code: 'barista',
      selected_payment_plan: 'monthly_12',
      stage: 'plan_selected',
      awaiting_reply: 'payment_confirmation',
    }));

    expect(result).toMatchObject({
      selected_offering_code: 'redes-informaticas',
      selected_payment_plan: null,
      next_stage: 'course_selected',
      next_awaiting_reply: 'call_or_chat',
      next_call_offer_count: 1,
      allowed_business_action: { type: 'none' },
    });
  });

  it('persists plan selection, defers safely and authorizes one explicit resumed link request', () => {
    const selected = plan(move('select_payment_plan', { payment_plan: 'monthly_12' }), state({
      selected_offering_code: 'redes-informaticas', stage: 'course_selected',
    }));
    const deferred = plan(move('defer_payment'), state({
      selected_offering_code: selected.selected_offering_code,
      selected_payment_plan: selected.selected_payment_plan,
      stage: selected.next_stage,
      awaiting_reply: selected.next_awaiting_reply,
    }));
    const resumed = plan(move('request_payment_link'), state({
      selected_offering_code: deferred.selected_offering_code,
      selected_payment_plan: deferred.selected_payment_plan,
      stage: deferred.next_stage,
      awaiting_reply: deferred.next_awaiting_reply,
    }));

    expect(selected).toMatchObject({
      selected_payment_plan: 'monthly_12', next_stage: 'plan_selected',
      next_awaiting_reply: 'payment_confirmation', allowed_business_action: { type: 'none' },
    });
    expect(deferred).toMatchObject({
      response_goal: 'acknowledge_payment_deferral',
      next_awaiting_reply: 'payment_confirmation', allowed_business_action: { type: 'none' },
    });
    expect(resumed).toMatchObject({
      next_stage: 'payment_link_sent', next_awaiting_reply: 'none',
      allowed_business_action: {
        type: 'send_payment_link', offering_code: 'redes-informaticas', payment_plan: 'monthly_12',
      },
    });
  });

  it('applies compound vetoes before any otherwise valid action', () => {
    const result = plan(move('ask_course_information', {
      secondary_moves: ['continue_by_chat', 'request_payment_link'],
      vetoes: ['call', 'payment_link'],
      course_reference: 'Redes Informáticas',
    }), state({
      selected_offering_code: 'redes-informaticas',
      selected_payment_plan: 'monthly_6',
      stage: 'plan_selected',
      call_offer_status: 'offered',
      awaiting_reply: 'call_or_chat',
    }));

    expect(result).toMatchObject({
      next_call_preference: 'chat',
      next_call_offer_status: 'declined',
      should_offer_call: false,
      allowed_business_action: { type: 'none' },
    });
  });

  it('lets an explicit veto cancel the primary transactional move', () => {
    const current = state({
      selected_offering_code: 'redes-informaticas',
      selected_payment_plan: 'monthly_12',
      stage: 'plan_selected',
    });
    expect(plan(move('request_call', { vetoes: ['call'] }), current).allowed_business_action)
      .toEqual({ type: 'none' });
    expect(plan(move('request_payment_link', { vetoes: ['payment_link'] }), current).allowed_business_action)
      .toEqual({ type: 'none' });
  });

  it('fails closed on low confidence, ambiguity or an unavailable catalog', () => {
    const uncertain = plan(move('request_call', { confidence: 0.4 }), state());
    const unavailable = planConversationTurn({
      move: move('browse_catalog'),
      sales_context: state(),
      business_context: { ...business, catalog_available: false, offerings: [], areas: [] },
    });

    expect(uncertain).toMatchObject({
      response_goal: 'clarify_current_step', allowed_business_action: { type: 'none' },
    });
    expect(unavailable).toMatchObject({
      response_goal: 'catalog_temporarily_unavailable',
      missing_information: ['catalog_snapshot'],
      allowed_business_action: { type: 'none' },
    });
  });
});
