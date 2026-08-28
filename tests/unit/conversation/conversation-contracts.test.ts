import { describe, expect, it } from 'vitest';
import {
  ComposedNarrativeV1Schema,
  ConversationPipelineCommitV1Schema,
  ConversationMoveV1Schema,
  TurnPlanV1Schema,
} from '@/features/conversation/adapters/conversation-pipeline-schema';
import {
  ComposedNarrativeV1Schema as BotpressComposedNarrativeV1Schema,
  ConversationPipelineCommitV1Schema as BotpressConversationPipelineCommitV1Schema,
  ConversationMoveV1Schema as BotpressConversationMoveV1Schema,
  TurnPlanV1Schema as BotpressTurnPlanV1Schema,
} from '../../../botpress-agent/src/schemas/conversation-pipeline';

const validMove = {
  schema_version: 1,
  move: 'ask_course_information',
  secondary_moves: ['continue_by_chat'],
  vetoes: ['call'],
  course_reference: 'Redes Informáticas',
  confidence: 0.93,
} as const;

const validPlan = {
  schema_version: 1,
  next_stage: 'course_selected',
  response_goal: 'explain_selected_course',
  canonical_fact_requests: [
    { kind: 'offering_name', offering_code: 'redes-informaticas' },
    { kind: 'offering_duration', offering_code: 'redes-informaticas' },
  ],
  allowed_business_action: { type: 'none' },
  missing_information: ['course_information_topic'],
  should_offer_call: false,
  next_call_preference: 'chat',
  next_call_offer_status: 'declined',
  next_call_offer_count: 1,
  next_awaiting_reply: 'none',
  selected_offering_code: 'redes-informaticas',
  selected_payment_plan: null,
} as const;

const validComposition = {
  schema_version: 1,
  narrative: {
    opening: 'Perfecto.',
    explanation: 'Puede encajar con tu objetivo.',
    next_question: '¿Qué aspecto querés profundizar?',
  },
  used_fact_ids: ['offering:redes-informaticas:duration:v1'],
} as const;

describe('conversation pipeline V1 contracts', () => {
  it('keeps backend and Botpress schemas in parity for valid payloads', () => {
    expect(ConversationMoveV1Schema.parse(validMove))
      .toEqual(BotpressConversationMoveV1Schema.parse(validMove));
    expect(TurnPlanV1Schema.parse(validPlan))
      .toEqual(BotpressTurnPlanV1Schema.parse(validPlan));
    expect(ComposedNarrativeV1Schema.parse(validComposition))
      .toEqual(BotpressComposedNarrativeV1Schema.parse(validComposition));
    const commit = { move: validMove, plan_hash: 'a'.repeat(64), composition: validComposition };
    expect(ConversationPipelineCommitV1Schema.parse(commit))
      .toEqual(BotpressConversationPipelineCommitV1Schema.parse(commit));
  });

  it.each([
    {
      ...validMove,
      secondary_moves: ['continue_by_chat', 'decline_call', 'ask_payment_options'],
    },
    { ...validMove, secondary_moves: ['ask_course_information'] },
    { ...validMove, secondary_moves: ['unknown'] },
    { ...validMove, confidence: 1.01 },
    { ...validMove, invented_authority: true },
  ])('rejects invalid or contradictory moves in both mirrors', (payload) => {
    expect(ConversationMoveV1Schema.safeParse(payload).success).toBe(false);
    expect(BotpressConversationMoveV1Schema.safeParse(payload).success).toBe(false);
  });

  it('accepts a positive-looking move with an explicit veto so the planner can fail closed', () => {
    for (const payload of [
      { ...validMove, move: 'request_call', secondary_moves: [], vetoes: ['call'] },
      { ...validMove, move: 'request_payment_link', secondary_moves: [], vetoes: ['payment_link'] },
    ]) {
      expect(ConversationMoveV1Schema.safeParse(payload).success).toBe(true);
      expect(BotpressConversationMoveV1Schema.safeParse(payload).success).toBe(true);
    }
  });

  it('rejects free-form fact requests and missing-information values', () => {
    const invalidFact = {
      ...validPlan,
      canonical_fact_requests: [{ kind: 'whatever', value: 'invented' }],
    };
    const invalidMissing = {
      ...validPlan,
      missing_information: ['anything_the_model_wants'],
    };

    expect(TurnPlanV1Schema.safeParse(invalidFact).success).toBe(false);
    expect(TurnPlanV1Schema.safeParse(invalidMissing).success).toBe(false);
    expect(BotpressTurnPlanV1Schema.safeParse(invalidFact).success).toBe(false);
    expect(BotpressTurnPlanV1Schema.safeParse(invalidMissing).success).toBe(false);
  });
});
