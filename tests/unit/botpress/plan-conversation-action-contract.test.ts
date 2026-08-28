import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ConversationPlanResponseV1Schema,
} from '../../../botpress-agent/src/schemas/conversation-pipeline';

describe('planConversation Botpress action contract', () => {
  it('accepts an authoritative value-free response', () => {
    const parsed = ConversationPlanResponseV1Schema.parse({
      plan: {
        schema_version: 1,
        next_stage: 'course_selected',
        response_goal: 'explain_selected_course',
        canonical_fact_requests: [{ kind: 'offering_name', offering_code: 'redes-informaticas' }],
        allowed_business_action: { type: 'none' },
        missing_information: [],
        should_offer_call: true,
        next_call_preference: 'unknown',
        next_call_offer_status: 'offered',
        next_call_offer_count: 1,
        next_awaiting_reply: 'call_or_chat',
        selected_offering_code: 'redes-informaticas',
        selected_payment_plan: null,
      },
      fact_refs: [{
        id: 'offering:redes-informaticas:name:v1', kind: 'offering_name',
        offering_code: 'redes-informaticas',
      }],
      state_version: 0,
      plan_hash: 'a'.repeat(64),
    });

    expect(JSON.stringify(parsed)).not.toContain('value');
  });

  it('posts the move to the turn-scoped backend endpoint', () => {
    const source = readFileSync('botpress-agent/src/actions/planConversation.ts', 'utf8');
    expect(source).toContain('/api/agent/turns/${encodeURIComponent(validated.turn_id)}/plan');
    expect(source).toContain('ConversationPlanResponseV1Schema');
  });
});
