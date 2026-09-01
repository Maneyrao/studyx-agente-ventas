import { describe, expect, it } from 'vitest';
import type { ConversationMoveV1, ConversationStateV1 } from '@/features/conversation/domain/conversation-pipeline';
import {
  CONVERSATION_SESSION_IDLE_MS,
  CONVERSATION_STATE_MAX_IDLE_MS,
  isConversationSessionDormantV1,
  createDefaultConversationStateV1,
  effectiveConversationStateV1,
  planConversationTurn,
  type PlanningBusinessContextV1,
} from '@/features/conversation/domain/conversation-planner';
import { loadConversationSessionConfig } from '@/lib/config';

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

function plan(
  currentMove: ConversationMoveV1,
  currentState: ConversationStateV1,
  overrides: { session_dormant?: boolean } = {},
) {
  return planConversationTurn({
    move: currentMove,
    sales_context: currentState,
    business_context: business,
    ...overrides,
  });
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
  it('keeps the live context when a greeting lands inside an active session', () => {
    // Saludar a mitad de una conversación viva no es empezar de nuevo. El
    // contexto comercial se conserva; el modelo decide qué decir con él.
    const result = plan(move('greeting'), dormantPurchase, { session_dormant: false });

    expect(result.response_goal).toBe('greet_and_discover');
    expect(result.selected_offering_code).toBe('coaching_liderazgo');
    expect(result.selected_payment_plan).toBe('monthly_6');
    expect(result.next_stage).toBe('payment_link_sent');
    expect(result.allowed_business_action).toEqual({ type: 'none' });
  });

  it('opens a new commercial session when a greeting lands on a dormant one', () => {
    const result = plan(move('greeting'), dormantPurchase, { session_dormant: true });

    expect(result.response_goal).toBe('greet_and_discover');
    expect(result.selected_offering_code).toBeNull();
    expect(result.selected_payment_plan).toBeNull();
    expect(result.next_stage).toBe('exploring');
    expect(result.allowed_business_action).toEqual({ type: 'none' });
    expect(result.canonical_fact_requests).toEqual([]);
  });

  it('opens a new commercial session when a greeting lands on a terminal one', () => {
    for (const stage of ['closed', 'handoff'] as const) {
      const result = plan(
        move('greeting'),
        { ...dormantPurchase, stage },
        { session_dormant: false },
      );

      expect(result.selected_offering_code).toBeNull();
      expect(result.selected_payment_plan).toBeNull();
      expect(result.next_stage).toBe('exploring');
    }
  });

  it('keeps the call ledger across a reopening greeting so a declined call is never re-offered', () => {
    const result = plan(move('greeting'), dormantPurchase, { session_dormant: true });

    expect(result.next_call_preference).toBe('chat');
    expect(result.next_call_offer_status).toBe('declined');
    expect(result.next_call_offer_count).toBe(2);
    expect(result.should_offer_call).toBe(false);
  });

  it('never lets a greeting turn resume a payment link, dormant or not', () => {
    for (const session_dormant of [true, false]) {
      const result = plan(
        move('greeting', { secondary_moves: ['request_payment_link'] }),
        dormantPurchase,
        { session_dormant },
      );

      expect(result.allowed_business_action).toEqual({ type: 'none' });
    }
  });

  it('reports dormancy from the same window that expires a pending question', () => {
    const updatedAt = new Date('2026-08-31T10:00:00.000Z');
    const stale = { ...dormantPurchase, updated_at: updatedAt.toISOString() };

    expect(isConversationSessionDormantV1(
      stale, updatedAt.getTime() + CONVERSATION_SESSION_IDLE_MS + 1,
    )).toBe(true);
    expect(isConversationSessionDormantV1(
      stale, updatedAt.getTime() + CONVERSATION_SESSION_IDLE_MS - 1,
    )).toBe(false);
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

  it('reads the session window from configuration', () => {
    expect(loadConversationSessionConfig({ CONVERSATION_SESSION_IDLE_MINUTES: '90' }))
      .toEqual({ sessionIdleMs: 90 * 60 * 1_000 });
  });

  it('falls back to the built-in default for an absent, invalid or non-positive value', () => {
    for (const environment of [
      {},
      { CONVERSATION_SESSION_IDLE_MINUTES: 'x' },
      { CONVERSATION_SESSION_IDLE_MINUTES: '0' },
      { CONVERSATION_SESSION_IDLE_MINUTES: '-30' },
    ]) {
      expect(loadConversationSessionConfig(environment).sessionIdleMs)
        .toBe(CONVERSATION_SESSION_IDLE_MS);
    }
  });

  it('never lets configuration outlive the full-state expiry', () => {
    expect(loadConversationSessionConfig({ CONVERSATION_SESSION_IDLE_MINUTES: '9999' }).sessionIdleMs)
      .toBe(CONVERSATION_STATE_MAX_IDLE_MS);
  });

  it('applies the configured window instead of the default', () => {
    const updatedAt = new Date('2026-08-31T10:00:00.000Z');
    const stale = { ...dormantPurchase, updated_at: updatedAt.toISOString() };
    const { sessionIdleMs } = loadConversationSessionConfig({
      CONVERSATION_SESSION_IDLE_MINUTES: '30',
    });

    expect(effectiveConversationStateV1(
      stale, updatedAt.getTime() + 31 * 60 * 1_000, sessionIdleMs,
    ).awaiting_reply).toBe('none');
    expect(effectiveConversationStateV1(
      stale, updatedAt.getTime() + 29 * 60 * 1_000, sessionIdleMs,
    ).awaiting_reply).toBe('payment_confirmation');
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
