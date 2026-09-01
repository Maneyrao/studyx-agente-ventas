import { describe, expect, it } from 'vitest';
import type { ConversationMoveV1, ConversationStateV1 } from '@/features/conversation/domain/conversation-pipeline';
import {
  createDefaultConversationStateV1,
  planConversationTurn,
  type PlanningBusinessContextV1,
} from '@/features/conversation/domain/conversation-planner';

const business: PlanningBusinessContextV1 = {
  catalog_available: true,
  areas: [{ code: 'tecnologia', display_name: 'Tecnología' }],
  offerings: [{ code: 'redes-informaticas', display_name: 'Redes Informáticas', area_code: 'tecnologia' }],
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

function move(kind: ConversationMoveV1['move'], overrides: Partial<ConversationMoveV1> = {}): ConversationMoveV1 {
  return { schema_version: 1, move: kind, secondary_moves: [], vetoes: [], confidence: 0.95, ...overrides };
}

const courseChosen = state({ selected_offering_code: 'redes-informaticas', stage: 'course_selected' });

/** The six-field gate is a separate rule with its own suite; supply it so
 *  these tests observe interpretation alone. */
const intake = {
  nombre: 'Ariana', apellido: 'Paz',
  correo: 'ariana.paz@example.test', telefono: '+5491100000001',
};
const linkSent = state({
  selected_offering_code: 'redes-informaticas',
  selected_payment_plan: 'one_time',
  stage: 'payment_link_sent',
  call_preference: 'chat',
  call_offer_status: 'declined',
  call_offer_count: 2,
});

describe('payment interpretation', () => {
  /**
   * base_01. "Elijo el pago único y mandame el link" carries two compatible
   * requests. Answering only the first strands the customer: the plan is
   * recorded and the link they explicitly asked for never arrives.
   */
  it('selects the plan and authorizes the link when one turn asks for both', () => {
    const result = planConversationTurn({
      move: move('select_payment_plan', {
        secondary_moves: ['request_payment_link'],
        payment_plan: 'one_time',
      }),
      sales_context: courseChosen,
      business_context: business,
      contact_intake: intake,
    });

    expect(result.selected_payment_plan).toBe('one_time');
    expect(result.allowed_business_action).toEqual({
      type: 'send_payment_link',
      offering_code: 'redes-informaticas',
      payment_plan: 'one_time',
    });
  });

  /**
   * base_02. Asking what an already-sent link is for is a question about the
   * current state, not a request for another link. The turn must answer it and
   * must not re-authorize the payment link.
   */
  it('answers a question about current state without re-sending the link', () => {
    const result = planConversationTurn({
      move: move('ask_current_state'),
      sales_context: linkSent,
      business_context: business,
    });

    expect(result.response_goal).toBe('confirm_current_state');
    expect(result.allowed_business_action).toEqual({ type: 'none' });
    expect(result.canonical_fact_requests.some((request) => request.kind === 'payment_link')).toBe(false);
    expect(result.selected_offering_code).toBe('redes-informaticas');
    expect(result.selected_payment_plan).toBe('one_time');
  });

  /**
   * "Ya pagué" is a claim, never evidence. It records payment_reported and it
   * must never produce a business action nor imply verification.
   */
  it('records a reported payment without verifying it or acting on it', () => {
    const result = planConversationTurn({
      move: move('report_payment'),
      sales_context: linkSent,
      business_context: business,
    });

    expect(result.response_goal).toBe('acknowledge_payment_report');
    expect(result.payment_reported).toBe(true);
    expect(result.allowed_business_action).toEqual({ type: 'none' });
    expect(result.next_awaiting_reply).toBe('none');
  });

  it('never lets a reported payment be read as a link request', () => {
    const result = planConversationTurn({
      move: move('report_payment', { secondary_moves: ['request_payment_link'] }),
      sales_context: linkSent,
      business_context: business,
    });

    expect(result.allowed_business_action).toEqual({ type: 'none' });
  });

  it('keeps a reported payment reported once it is true', () => {
    const alreadyReported = { ...linkSent, payment_reported_at: '2026-09-01T10:00:00.000Z' };
    const result = planConversationTurn({
      move: move('ask_current_state'),
      sales_context: alreadyReported,
      business_context: business,
    });

    expect(result.payment_reported).toBe(true);
  });
});
