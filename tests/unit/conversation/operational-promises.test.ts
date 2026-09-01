import { describe, expect, it } from 'vitest';
import {
  assertsCompletedOperationalOutcome,
  stripUnsupportedOperationalClaims,
} from '@/features/conversation/domain/operational-promise-guard';
import { assembleCanonicalConversationResponseV1 } from '@/features/conversation/domain/canonical-response-assembler';
import type { TurnPlanV1 } from '@/features/conversation/domain/conversation-pipeline';

/**
 * The agent told a customer their pre-enrolment was loaded in the system.
 * Nothing had been loaded anywhere: no row, no record, no operator. The
 * sentence was the model's invention, and the customer believed it.
 *
 * A claim that an operational outcome already happened — enrolled, registered,
 * activated, access granted — is only allowed when this turn actually
 * committed the thing being claimed. Nothing in the conversational path can
 * enrol anybody, so in practice these claims are never allowed.
 */
describe('unsupported operational promises', () => {
  it('recognizes a completed operational outcome regardless of the noun used', () => {
    for (const claim of [
      'Ya te dejo la preinscripción cargada en el sistema.',
      'Tu inscripción quedó confirmada.',
      'Dejé registrada tu matrícula.',
      'Listo, tu acceso ya está habilitado.',
      'Tu alta quedó procesada.',
    ]) {
      expect(assertsCompletedOperationalOutcome(claim)).toBe(true);
    }
  });

  /** The guard must not eat the ordinary, truthful things the agent says. */
  it('leaves truthful conversational copy alone', () => {
    for (const honest of [
      'El valor total del programa es USD 360.',
      'Te comparto el link para que puedas completar el pago.',
      'Gracias por avisar. Queda registrado para que una persona lo revise.',
      'Para inscribirte necesitás completar el pago primero.',
      '¿Preferís que sigamos por chat o querés solicitar una llamada?',
      'Queda registrada tu elección de plan.',
    ]) {
      expect(assertsCompletedOperationalOutcome(honest)).toBe(false);
    }
  });

  it('drops only the offending sentence and keeps the rest of the answer', () => {
    const text = 'Entiendo que el precio te preocupa. '
      + 'Ya te dejo la preinscripción cargada en el sistema. '
      + '¿Querés que veamos las opciones de pago?';

    const kept = stripUnsupportedOperationalClaims(text);

    expect(kept).not.toMatch(/preinscripción cargada/iu);
    expect(kept).toContain('Entiendo que el precio te preocupa.');
    expect(kept).toContain('¿Querés que veamos las opciones de pago?');
  });

  it('keeps paragraph structure when a whole paragraph is dropped', () => {
    const text = 'Perfecto.\n\nTu inscripción quedó confirmada.\n\n¿Seguimos?';

    expect(stripUnsupportedOperationalClaims(text)).toBe('Perfecto.\n\n¿Seguimos?');
  });

  it('returns nothing when every sentence was an unsupported promise', () => {
    expect(stripUnsupportedOperationalClaims('Tu inscripción quedó confirmada.')).toBe('');
  });

  /** The guard is only real if the assembled answer actually loses the claim. */
  it('never lets the promise reach the assembled answer', () => {
    const plan: TurnPlanV1 = {
      schema_version: 1,
      next_stage: 'plan_selected',
      response_goal: 'confirm_selected_plan',
      canonical_fact_requests: [],
      allowed_business_action: { type: 'none' },
      missing_information: [],
      should_offer_call: false,
      next_call_preference: 'chat',
      next_call_offer_status: 'declined',
      next_call_offer_count: 2,
      next_awaiting_reply: 'payment_confirmation',
      payment_reported: false,
      selected_offering_code: 'redes-informaticas',
      selected_payment_plan: 'monthly_12',
    };

    const assembled = assembleCanonicalConversationResponseV1({
      plan,
      facts: [],
      fact_refs: [],
      composition: {
        schema_version: 1,
        narrative: {
          opening: 'Entiendo que el precio te preocupa.',
          explanation: 'Ya te dejo la preinscripción cargada en el sistema.',
          next_question: '¿Querés que veamos las opciones de pago?',
        },
        used_fact_ids: [],
      },
    });

    expect(assembled.content).not.toMatch(/preinscripci[oó]n/iu);
    expect(assembled.content).toContain('Entiendo que el precio te preocupa.');
    expect(assembled.content).toContain('¿Querés que veamos las opciones de pago?');
  });
});
