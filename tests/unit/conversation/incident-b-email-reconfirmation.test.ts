import { describe, expect, it } from 'vitest';
import { authorizeAgentTurnV2 } from '@/features/conversation/domain/agent-turn-policy-v2';
import { createDefaultConversationStateV1 } from '@/features/conversation/domain/conversation-planner';
import type { ConversationStateV1 } from '@/features/conversation/domain/conversation-pipeline';

/** Owner incident B (2026-11-10): .co → .com after the one-time link, then «dale mandame el link en 12 veces». */
const identity = { workspace_id: '11111111-1111-4111-8111-111111111111',
  conversation_id: '22222222-2222-4222-8222-222222222222', contact_id: '33333333-3333-4333-8333-333333333333' };
const offerings = [{ code: 'fotografia', display_name: 'Fotografía', aliases: [] }];
const facts = (['one_time', 'monthly_6', 'monthly_12'] as const).map(plan => ({ id: `payment:fotografia:${plan}:label:v1`,
  kind: 'payment_plan_label' as const, source: 'business_snapshot' as const, value: plan, offering_code: 'fotografia', payment_plan: plan }));
const intake = { nombre: 'Thiago', apellido: 'Maneyro', correo: 'ipsj.thiagomaneyro@gmail.com', telefono: '+5491169004497' };
const capability = { enabled: true, max_bonus_courses: 3 as const, may_offer_bonus: false, status: 'accepted' as const,
  package_status: 'attached' as const, interest_offering_code: 'fotografia', promotion_cycle_id: '44444444-4444-4444-8444-444444444444',
  offer_version: 1, may_request_review: false, may_schedule_checkin: false, may_accept_offer: false,
  may_send_promoted_payment: true, promotion_code: 'BONUS',
  bonus_offerings: [{ code: 'publicidad_redes_sociales', display_name: 'Publicidad en Redes Sociales', position: 1 }],
  delivered_bonus_offerings: [{ code: 'publicidad_redes_sociales', display_name: 'Publicidad en Redes Sociales', position: 1 }] };
const linkSent: Partial<ConversationStateV1> = { selected_offering_code: 'fotografia', selected_payment_plan: 'one_time',
  stage: 'payment_link_sent', awaiting_reply: 'none' };

function authorize(state: Partial<ConversationStateV1>, customer: string, proposal: Record<string, unknown>) {
  return authorizeAgentTurnV2({
    proposal: { schema_version: 1, response: { messages: ['Listo.'] }, proposed_action: { type: 'none' },
      used_fact_ids: [], used_memory_ids: [], memory_candidates: [], repair_of: null, course_mentions: [], ...proposal } as never,
    state: { ...createDefaultConversationStateV1(identity), ...state }, offerings, facts, contact_intake: intake,
    current_customer_messages: [customer], course_bonus: capability, semantic_rejections: 'advisory',
    action_rejections: 'structured', call_policy: { may_offer_call: false, may_request_call_now: false },
  });
}

describe('incident B — correcting the e-mail during checkout requires a new confirmation', () => {
  it('a corrected e-mail after the link reopens the confirmation without changing course or plan', () => {
    const result = authorize(linkSent, 'perdón es ipsj.thiagomaneyro@gmail.com', {
      move: { schema_version: 1, move: 'provide_contact_details', secondary_moves: [], vetoes: [], confidence: 1 },
      response: { messages: ['Corregido: ipsj.thiagomaneyro@gmail.com. Te confirmo: Fotografía, pago único. Avanzamos?'] },
      profile_updates: [{ field: 'correo', value: 'ipsj.thiagomaneyro@gmail.com', operation: 'set',
        source_message_id: '55555555-5555-4555-8555-555555555555', source_quote: 'ipsj.thiagomaneyro@gmail.com' }],
    });
    // The delivered link keeps the stage (bonuses and call offers stay closed).
    expect(result).toMatchObject({ ok: true, action: { type: 'none' }, transition: {
      selected_offering_code: 'fotografia', selected_payment_plan: 'one_time', stage: 'payment_link_sent',
      awaiting_reply: 'payment_confirmation' } });
    if (!result.ok) throw new Error('expected reconfirmation');
    // Chained from that exact transition: «dale mandame el link de pago en 12 veces».
    const next = authorize(result.transition, 'dale mandame el link de pago en 12 veces', {
      move: { schema_version: 1, move: 'request_payment_link', secondary_moves: ['select_payment_plan'], vetoes: [],
        confidence: 1, payment_plan: 'monthly_12' },
      proposed_action: { type: 'send_payment_link', offering_code: 'fotografia', payment_plan: 'monthly_12', promotion_code: 'BONUS' },
    });
    expect(next).toMatchObject({ ok: true, action: { type: 'send_payment_link', payment_plan: 'monthly_12' } });
  });

  it('«dale mandame el link de pago en 12 veces» confirms, selects monthly_12 and requests the link in one turn', () => {
    const result = authorize({ ...linkSent, stage: 'plan_selected', awaiting_reply: 'payment_confirmation' },
      'dale mandame el link de pago en 12 veces', {
        move: { schema_version: 1, move: 'request_payment_link', secondary_moves: ['select_payment_plan'], vetoes: [],
          confidence: 1, payment_plan: 'monthly_12' },
        proposed_action: { type: 'send_payment_link', offering_code: 'fotografia', payment_plan: 'monthly_12',
          promotion_code: 'BONUS' },
      });
    expect(result).toMatchObject({ ok: true, action: { type: 'send_payment_link', offering_code: 'fotografia',
      payment_plan: 'monthly_12', promotion_code: 'BONUS' }, transition: { selected_payment_plan: 'monthly_12' } });
  });

  it('a rejected effect keeps the understood plan and the pending request when effects are fenced', () => {
    const result = authorizeAgentTurnV2({
      proposal: { schema_version: 1, move: { schema_version: 1, move: 'request_payment_link', secondary_moves: ['select_payment_plan'],
        vetoes: [], confidence: 1, payment_plan: 'monthly_12' }, response: { messages: ['Perfecto, en 12 cuotas.'] },
        proposed_action: { type: 'none' }, used_fact_ids: [], used_memory_ids: [], memory_candidates: [], repair_of: null,
        course_mentions: [] } as never,
      state: { ...createDefaultConversationStateV1(identity), ...linkSent, stage: 'plan_selected', awaiting_reply: 'payment_confirmation' },
      offerings, facts, contact_intake: intake, current_customer_messages: ['dale mandame el link de pago en 12 veces'],
      course_bonus: capability, semantic_rejections: 'advisory', action_rejections: 'structured', effects_allowed: false,
      call_policy: { may_offer_call: false, may_request_call_now: false },
    });
    expect(result).toMatchObject({ ok: true, action: { type: 'none' }, transition: { selected_payment_plan: 'monthly_12',
      payment_link_request: { status: 'pending', payment_plan: 'monthly_12' } } });
    if (result.ok) expect(result.transition.stage).not.toBe('payment_link_sent');
  });

  it('«??» after the fenced turn resumes the preserved 12-installment request (model reads it as request_payment_link)', () => {
    const pending = { ...linkSent, stage: 'plan_selected' as const, awaiting_reply: 'payment_confirmation' as const,
      selected_payment_plan: 'monthly_12' as const, payment_link_request: { status: 'pending' as const,
        offering_code: 'fotografia', payment_plan: 'monthly_12' as const, requested_by_turn_id: null, resolved_by_decision_id: null } };
    const result = authorize(pending, '??', {
      move: { schema_version: 1, move: 'request_payment_link', secondary_moves: [], vetoes: [], confidence: 1 },
      response: { messages: ['Ahí va, en 12 cuotas.'] },
    });
    expect(result).toMatchObject({ ok: true, action: { type: 'send_payment_link', offering_code: 'fotografia',
      payment_plan: 'monthly_12', promotion_code: 'BONUS' } });
    // Without the model's request the same «??» never reserves anything.
    expect(authorize(pending, '??', { move: { schema_version: 1, move: 'unknown', secondary_moves: [], vetoes: [], confidence: 1 } }))
      .toMatchObject({ ok: true, action: { type: 'none' } });
  });
});
