import { describe, expect, it } from 'vitest';
import { TelegramSimVoiceProvider } from '@/features/calls/adapters/telegram-sim-voice.provider';
import {
  createDefaultConversationStateV1,
  planConversationTurn,
} from '@/features/conversation/domain/conversation-planner';
import { CommitDecisionResponseSchema } from '../../botpress-agent/src/schemas/contracts';

const UUID = '18a823e8-27c2-4279-9956-058f45f33cd5';

describe('Agent A to future Agent B call boundary', () => {
  it('keeps semantic intent behind the existing request_call_now authority', () => {
    const state = {
      ...createDefaultConversationStateV1({
        workspace_id: UUID,
        conversation_id: UUID,
        contact_id: UUID,
      }),
      selected_offering_code: 'redes_informaticas',
      stage: 'course_selected' as const,
      call_offer_status: 'offered' as const,
      call_offer_count: 1 as const,
      awaiting_reply: 'call_or_chat' as const,
    };
    const plan = planConversationTurn({
      move: {
        schema_version: 1,
        move: 'request_call',
        secondary_moves: [],
        vetoes: [],
        confidence: 0.99,
      },
      sales_context: state,
      business_context: {
        catalog_available: true,
        areas: [],
        offerings: [{
          code: 'redes_informaticas',
          display_name: 'Redes Informáticas',
          area_code: 'oficios',
        }],
        payment_plans: ['monthly_12', 'monthly_6', 'one_time'],
      },
    });

    expect(plan.allowed_business_action.type).toBe('request_call_now');
    expect(plan.allowed_business_action).toMatchObject({ reason: 'accepted_offer' });
  });

  it('keeps the call request identity and VoiceProvider public shape stable', () => {
    const commit = CommitDecisionResponseSchema.parse({
      status: 'committed',
      replayed: false,
      trace_id: UUID,
      turn_id: UUID,
      decision_id: UUID,
      next_state: 'completed',
      outbound: null,
      call_request: { call_id: UUID, status: 'requested' },
    });
    const voiceProviderPublicShape = Object.getOwnPropertyNames(TelegramSimVoiceProvider.prototype)
      .filter((name) => name !== 'constructor')
      .sort();

    expect(commit.call_request).toMatchObject({ status: 'requested' });
    expect(commit.call_request?.call_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu,
    );
    expect(voiceProviderPublicShape).toEqual([
      'cancelCall',
      'findCallByInternalId',
      'placeCall',
    ]);
  });
});
