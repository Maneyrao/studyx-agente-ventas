import { describe, expect, it } from 'vitest';
import type { ConversationMoveV1, ConversationStateV1 } from '@/features/conversation/domain/conversation-pipeline';
import {
  CONVERSATION_SESSION_IDLE_MS,
  createDefaultConversationStateV1,
  effectiveConversationStateV1,
  planConversationTurn,
  type PlanningBusinessContextV1,
} from '@/features/conversation/domain/conversation-planner';

const business: PlanningBusinessContextV1 = {
  catalog_available: true,
  areas: [
    { code: 'tecnologia', display_name: 'Tecnología' },
    { code: 'liderazgo', display_name: 'Liderazgo' },
  ],
  offerings: [
    { code: 'coaching_liderazgo', display_name: 'Coaching de Liderazgo', area_code: 'liderazgo' },
    { code: 'redes-informaticas', display_name: 'Redes Informáticas', area_code: 'tecnologia' },
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

/** Production incident: `Buenas tardes` hours after a link was sent resumed the purchase. */
const dormantPurchase = state({
  selected_offering_code: 'coaching_liderazgo',
  selected_payment_plan: 'monthly_6',
  stage: 'payment_link_sent',
  call_preference: 'chat',
  call_offer_status: 'declined',
  call_offer_count: 2,
  awaiting_reply: 'payment_confirmation',
  version: 7,
});

describe('conversation session boundary', () => {
  it('opens a new commercial session when a greeting reopens a dormant purchase', () => {
    const result = plan(move('greeting'), dormantPurchase);

    expect(result.response_goal).toBe('greet_and_discover');
    expect(result.selected_offering_code).toBeNull();
    expect(result.selected_payment_plan).toBeNull();
    expect(result.next_stage).toBe('exploring');
    expect(result.allowed_business_action).toEqual({ type: 'none' });
    expect(result.canonical_fact_requests).toEqual([]);
  });

  it('keeps the call ledger across a reopening greeting so a declined call is never re-offered', () => {
    const result = plan(move('greeting'), dormantPurchase);

    expect(result.next_call_preference).toBe('chat');
    expect(result.next_call_offer_status).toBe('declined');
    expect(result.next_call_offer_count).toBe(2);
    expect(result.should_offer_call).toBe(false);
  });

  it('never lets a greeting turn resume a payment link from inherited state', () => {
    const result = plan(
      move('greeting', { secondary_moves: ['request_payment_link'] }),
      dormantPurchase,
    );

    expect(result.allowed_business_action).toEqual({ type: 'none' });
    expect(result.next_stage).not.toBe('payment_link_sent');
  });

  it('expires only the pending question after the session idle window', () => {
    const updatedAt = new Date('2026-08-31T10:00:00.000Z');
    const stale = { ...dormantPurchase, updated_at: updatedAt.toISOString() };

    const effective = effectiveConversationStateV1(
      stale,
      updatedAt.getTime() + CONVERSATION_SESSION_IDLE_MS + 1,
    );

    expect(effective.awaiting_reply).toBe('none');
    expect(effective.selected_offering_code).toBe('coaching_liderazgo');
    expect(effective.version).toBe(7);
  });

  it('keeps a pending question alive inside the session idle window', () => {
    const updatedAt = new Date('2026-08-31T10:00:00.000Z');
    const fresh = { ...dormantPurchase, updated_at: updatedAt.toISOString() };

    const effective = effectiveConversationStateV1(
      fresh,
      updatedAt.getTime() + CONVERSATION_SESSION_IDLE_MS - 1,
    );

    expect(effective.awaiting_reply).toBe('payment_confirmation');
  });
});
