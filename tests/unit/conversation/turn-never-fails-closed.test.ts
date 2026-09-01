import { describe, expect, it } from 'vitest';
import type { TurnPlanV1 } from '@/features/conversation/domain/conversation-pipeline';
import { assembleCanonicalConversationResponseV1 } from '@/features/conversation/domain/canonical-response-assembler';
import { conversationDecisionFromPlanV1 } from '@/features/conversation/application/prepare-conversation-pipeline-commit';
import { parseDecisionAnyVersion } from '@/features/orchestration/domain/decision-v4';

function plan(overrides: Partial<TurnPlanV1> = {}): TurnPlanV1 {
  return {
    schema_version: 1,
    next_stage: 'payment_link_sent',
    response_goal: 'acknowledge_payment_report',
    canonical_fact_requests: [],
    allowed_business_action: { type: 'none' },
    missing_information: [],
    should_offer_call: false,
    next_call_preference: 'chat',
    next_call_offer_status: 'declined',
    next_call_offer_count: 2,
    next_awaiting_reply: 'none',
    payment_reported: true,
    selected_offering_code: 'redes-informaticas',
    selected_payment_plan: 'monthly_12',
    ...overrides,
  };
}

/**
 * A guard that removes an unsupported sentence must not remove the whole turn.
 * Live run: the model answered a reported payment entirely with the promise
 * that the enrolment was loaded. Every sentence was stripped, the assembler
 * had no fallback for the new goals, and the turn died with
 * ASSEMBLED_CONTENT_INVALID — the customer got silence instead of a correction.
 */
describe('a stripped composition still answers', () => {
  for (const responseGoal of [
    'acknowledge_payment_report',
    'confirm_current_state',
    'request_contact_details',
  ] as const) {
    it(`still produces an answer for ${responseGoal} when every sentence is removed`, () => {
      const assembled = assembleCanonicalConversationResponseV1({
        plan: plan({ response_goal: responseGoal }),
        facts: [],
        fact_refs: [],
        composition: {
          schema_version: 1,
          narrative: {
            opening: 'Tu inscripción quedó confirmada.',
            explanation: null,
            next_question: null,
          },
          used_fact_ids: [],
        },
      });

      expect(assembled.content.trim().length).toBeGreaterThan(0);
      expect(assembled.content).not.toMatch(/inscripci[oó]n\s+qued/iu);
    });
  }
});

/**
 * `clarify` is a decision that ASKS for something, and the validator enforces
 * that by requiring missing_information. A plan that reached
 * clarify_current_step with nothing missing is not asking anything — it is a
 * reply — and calling it a clarification made the whole turn fail validation.
 */
describe('a turn with nothing missing is a reply, not a clarification', () => {
  it('commits a plain reply when clarify_current_step has nothing to ask for', () => {
    const decision = conversationDecisionFromPlanV1({
      move: { schema_version: 1, move: 'unknown', secondary_moves: [], vetoes: [], confidence: 0.9 },
      plan: plan({ response_goal: 'clarify_current_step', missing_information: [] }),
      response: 'Te confirmo en qué punto quedamos.',
    });

    expect(decision.kind).toBe('reply');
    expect(() => parseDecisionAnyVersion(decision)).not.toThrow();
  });

  it('still clarifies when the plan really is missing something', () => {
    const decision = conversationDecisionFromPlanV1({
      move: { schema_version: 1, move: 'unknown', secondary_moves: [], vetoes: [], confidence: 0.9 },
      plan: plan({
        response_goal: 'clarify_current_step',
        missing_information: ['course_selection'],
        next_stage: 'exploring',
      }),
      response: '¿Cuál de las formaciones te interesa?',
    });

    expect(decision.kind).toBe('clarify');
    expect(() => parseDecisionAnyVersion(decision)).not.toThrow();
  });
});
