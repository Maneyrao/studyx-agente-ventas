import { describe, expect, it } from 'vitest';
import {
  paymentReservationRejectionSubjectsV1,
  understoodIntentContinuityV1,
} from '../../../botpress-agent/src/lib/conversation/agent-a-action-feedback';
import { TECHNICAL_CONTINUITY_TEXT_V1, technicalFallback } from '../../../botpress-agent/src/utils/decision-policy';
import { claimsImmediatePaymentLinkDeliveryV1 } from '../../../src/shared/conversation/payment-link-claim';
import type { AgentATurnProposalV1 } from '../../../botpress-agent/src/schemas/agent-a-brain';

/** Owner incident B (2026-11-10): «dale mandame el link de pago» + «en 12 veces». */
const understood = {
  schema_version: 1,
  move: { schema_version: 1, move: 'request_payment_link', secondary_moves: ['select_payment_plan'], vetoes: [],
    confidence: 1, payment_plan: 'monthly_12' },
  response: { messages: ['Dale, te reenvío el enlace en 12 cuotas.'], call_offer: null },
  proposed_action: { type: 'send_payment_link', offering_code: 'fotografia', payment_plan: 'monthly_12', promotion_code: 'BONUS' },
  course_mentions: [{ offering_code: 'fotografia', role: 'paid' }], used_fact_ids: [], used_memory_ids: [],
  memory_candidates: [], profile_updates: [], profile_requests: [], repair_of: null,
} as unknown as AgentATurnProposalV1;

describe('recovery keeps the understood intent after an effect rejection', () => {
  it.each(['PROMOTION_NOT_AUTHORIZED', 'IDEMPOTENCY_KEY_CONFLICT', 'CHECKOUT_REPLACEMENT_BLOCKED'])(
    '%s is a rejected payment-link effect with its real code, never an unreadable turn', code => {
      expect(paymentReservationRejectionSubjectsV1(code)).toEqual(['send_payment_link', `payment_reservation:${code.toLowerCase()}`]);
    });
  it('unrelated reasons are not reinterpreted', () => {
    expect(paymentReservationRejectionSubjectsV1('AGENT_TURN_V2_REJECTED:ACTION_NOT_AUTHORIZED')).toBeNull();
  });

  const rejection = { schema_version: 1 as const, rejection_id: '00000000-0000-4000-8000-000000000001', attempt: 1 as const,
    rejections: [{ code: 'ACTION_NOT_AUTHORIZED' as const, subject: 'send_payment_link' },
      { code: 'ACTION_NOT_AUTHORIZED' as const, subject: 'payment_reservation:promotion_not_authorized' }],
    authorized_alternatives: { fact_ids: [], actions: ['none'], missing_information: [] } };

  it('states the understood plan and the failed effect, keeps the move, never claims the link', () => {
    const continuity = understoodIntentContinuityV1({ proposal: understood, rejection });
    expect(continuity.response.messages).toEqual(['Entendí que lo quieres en 12 cuotas, pero no pude generar el enlace de pago todavía.']);
    expect(continuity.move).toEqual(understood.move);
    expect(continuity.proposed_action).toEqual({ type: 'none' });
    expect(claimsImmediatePaymentLinkDeliveryV1(continuity.response.messages.join(' '))).toBe(false);
    expect(continuity.response.messages.join(' ')).not.toMatch(/no te entend/iu);
  });

  it('never leaves an empty outbound for a non-payment effect', () => {
    const other = understoodIntentContinuityV1({ proposal: understood, rejection: { ...rejection,
      rejections: [{ code: 'ACTION_NOT_AUTHORIZED' as const, subject: 'send_course_program' }] } });
    expect(other.response.messages).toEqual(['Entendí tu pedido, pero no pude completarlo todavía.']);
  });

  it('the technical last resort is true and is never «no te entendí»', () => {
    expect(TECHNICAL_CONTINUITY_TEXT_V1).not.toMatch(/no te entend/iu);
    expect(technicalFallback().response).toBe(TECHNICAL_CONTINUITY_TEXT_V1);
  });
});
