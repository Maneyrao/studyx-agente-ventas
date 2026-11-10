import { describe, expect, it } from 'vitest';
import { authorizeAgentTurnV2 } from '@/features/conversation/domain/agent-turn-policy-v2';
import { createDefaultConversationStateV1 } from '@/features/conversation/domain/conversation-planner';
import type { ConversationStateV1 } from '@/features/conversation/domain/conversation-pipeline';

/** Owner incident A (2026-11-10): Fotografía + Publicidad en Redes Sociales → explicit Plomería. */
const identity = { workspace_id: '11111111-1111-4111-8111-111111111111',
  conversation_id: '22222222-2222-4222-8222-222222222222', contact_id: '33333333-3333-4333-8333-333333333333' };
const offerings = [
  { code: 'fotografia', display_name: 'Fotografía', aliases: [] },
  { code: 'publicidad_redes_sociales', display_name: 'Publicidad en Redes Sociales', aliases: [] },
  { code: 'plomeria', display_name: 'Plomería', aliases: [] },
];
const facts = offerings.flatMap(o => [
  { id: `offering:${o.code}:name:v1`, kind: 'offering_name' as const, source: 'business_snapshot' as const,
    value: o.display_name, offering_code: o.code },
  ...(['one_time', 'monthly_6', 'monthly_12'] as const).map(plan => ({ id: `payment:${o.code}:${plan}:label:v1`,
    kind: 'payment_plan_label' as const, source: 'business_snapshot' as const, value: plan, offering_code: o.code,
    payment_plan: plan })),
]);
const capability = (status: 'accepted' | 'attached') => ({ enabled: true, max_bonus_courses: 3 as const,
  may_offer_bonus: false, status: 'accepted' as const, package_status: status, interest_offering_code: 'fotografia',
  promotion_cycle_id: '44444444-4444-4444-8444-444444444444', offer_version: 1, may_request_review: false,
  may_schedule_checkin: false, may_accept_offer: false, may_send_promoted_payment: status === 'accepted',
  promotion_code: 'BONUS',
  bonus_offerings: [{ code: 'publicidad_redes_sociales', display_name: 'Publicidad en Redes Sociales', position: 1 }],
  delivered_bonus_offerings: [{ code: 'publicidad_redes_sociales', display_name: 'Publicidad en Redes Sociales', position: 1 }] });

function authorize(input: { move: 'select_course' | 'ask_course_information'; customer: string; text: string;
  mentions: Array<{ offering_code: string; role: 'paid' | 'bonus' | 'alternative' }>;
  stage: ConversationStateV1['stage']; pkg: 'accepted' | 'attached' }) {
  return authorizeAgentTurnV2({
    proposal: { schema_version: 1, move: { schema_version: 1, move: input.move, course_reference: 'plomeria',
      secondary_moves: [], vetoes: [], confidence: 1 }, response: { messages: [input.text] },
      proposed_action: { type: 'none' }, used_fact_ids: [], used_memory_ids: [], memory_candidates: [],
      repair_of: null, course_mentions: input.mentions },
    state: { ...createDefaultConversationStateV1(identity), selected_offering_code: 'fotografia',
      selected_payment_plan: 'one_time', stage: input.stage },
    offerings, facts, current_customer_messages: [input.customer], course_bonus: capability(input.pkg),
    paid_mention_offering_code: 'plomeria', semantic_rejections: 'advisory', action_rejections: 'structured',
    call_policy: { may_offer_call: true, may_request_call_now: false },
  });
}

describe('incident A — explicit select_course is one atomic paid-course transition', () => {
  for (const stage of ['course_selected', 'plan_selected', 'payment_link_sent'] as const)
    for (const pkg of ['accepted', 'attached'] as const) {
      it(`${stage}/${pkg}: «ese me convence más» selects Plomería and clears the previous plan`, () => {
        const result = authorize({ move: 'select_course', customer: 'ese me convence más', stage, pkg,
          text: 'Buenísimo, seguimos con Plomería.', mentions: [{ offering_code: 'plomeria', role: 'paid' }] });
        expect(result).toMatchObject({ ok: true, action: { type: 'none' },
          transition: { selected_offering_code: 'plomeria', selected_payment_plan: null, stage: 'course_selected' } });
      });
      it(`${stage}/${pkg}: a query about Plomería does not change the course`, () => {
        const result = authorize({ move: 'ask_course_information', customer: 'pero te estoy pidiendo plomería', stage, pkg,
          text: 'Plomería arranca desde los fundamentos.', mentions: [{ offering_code: 'plomeria', role: 'alternative' }] });
        expect(result).toMatchObject({ ok: true,
          transition: { selected_offering_code: 'fotografia', selected_payment_plan: 'one_time', stage } });
      });
      it(`${stage}/${pkg}: Publicidad does not travel to Plomería`, () => {
        const result = authorize({ move: 'select_course', customer: 'estábamos hablando de plomería', stage, pkg,
          text: 'Seguimos con Plomería y Publicidad en Redes Sociales de regalo.',
          mentions: [{ offering_code: 'plomeria', role: 'paid' }, { offering_code: 'publicidad_redes_sociales', role: 'bonus' }] });
        expect(result).toMatchObject({ ok: false, reasons: ['COMMERCIAL_TRUTH_VIOLATION'],
          rejection_subjects: ['forbidden_promise'] });
      });
    }
});
