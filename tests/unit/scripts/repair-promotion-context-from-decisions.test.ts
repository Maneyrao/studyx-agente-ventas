import { describe, expect, it } from 'vitest';
import {
  collectAcceptedPriceObjectionTurnIdsV1,
  parsePromotionContextRepairArgsV1,
} from '../../../scripts/repair-promotion-context-from-decisions';

const target = {
  workspace_id: '00000000-0000-4000-8000-000000000001',
  conversation_id: '00000000-0000-4000-8000-000000000002',
  contact_id: '00000000-0000-4000-8000-000000000003',
};

describe('promotion-context repair command', () => {
  it('requires an explicit conversation, course and exact reviewed evidence turns and defaults to dry-run', () => {
    expect(parsePromotionContextRepairArgsV1([
      '--conversation-id', target.conversation_id,
      '--offering-code', 'fotografia_profesional',
      '--evidence-turn-id', '00000000-0000-4000-8000-000000000010',
      '--evidence-turn-id', '00000000-0000-4000-8000-000000000011',
    ])).toEqual({
      conversation_id: target.conversation_id,
      offering_code: 'fotografia_profesional',
      evidence_turn_ids: [
        '00000000-0000-4000-8000-000000000010',
        '00000000-0000-4000-8000-000000000011',
      ],
      apply: false,
    });
    expect(() => parsePromotionContextRepairArgsV1([
      '--offering-code', 'fotografia_profesional',
    ])).toThrow('REPAIR_CONVERSATION_ID_REQUIRED');
    expect(() => parsePromotionContextRepairArgsV1([
      '--conversation-id', target.conversation_id,
      '--offering-code', 'fotografia_profesional',
    ])).toThrow('REPAIR_EVIDENCE_TURN_ID_REQUIRED');
  });

  it('uses only scoped accepted structured objection evidence and never customer prose', () => {
    const rows = [
      {
        ...target,
        turn_id: '00000000-0000-4000-8000-000000000010',
        decision_kind: 'reply',
        outbound_message_id: '00000000-0000-4000-8000-000000000020',
        selected_offering_code: 'fotografia_profesional',
        response: 'El precio parece caro.',
        memory_candidates: [{
          type: 'objection', key: 'price_objection', source_quote: 'me parece caro',
        }],
      },
      {
        ...target,
        turn_id: '00000000-0000-4000-8000-000000000011',
        decision_kind: 'reply',
        outbound_message_id: '00000000-0000-4000-8000-000000000021',
        selected_offering_code: null,
        response: 'El cliente volvió a decir que era caro.',
        memory_candidates: [],
      },
      {
        ...target,
        turn_id: '00000000-0000-4000-8000-000000000012',
        decision_kind: 'suppress',
        outbound_message_id: null,
        selected_offering_code: null,
        response: null,
        memory_candidates: [{
          type: 'objection', key: 'price_objection', source_quote: 'caro',
        }],
      },
    ];

    expect(collectAcceptedPriceObjectionTurnIdsV1(rows, {
      ...target,
      offering_code: 'fotografia_profesional',
    })).toEqual([
      '00000000-0000-4000-8000-000000000010',
    ]);
    expect(() => collectAcceptedPriceObjectionTurnIdsV1([{
      ...rows[0], workspace_id: '00000000-0000-4000-8000-000000000099',
    }], {...target, offering_code:'fotografia_profesional'})).toThrow('REPAIR_SCOPE_MISMATCH');
    expect(() => collectAcceptedPriceObjectionTurnIdsV1([{
      ...rows[0], selected_offering_code: 'ingles_1',
    }], {...target, offering_code:'fotografia_profesional'})).toThrow('REPAIR_INTERVENING_COURSE_CHANGE');
  });
});
