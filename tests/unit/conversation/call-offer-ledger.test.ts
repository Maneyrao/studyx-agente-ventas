import { describe, expect, it } from 'vitest';
import type {
  CanonicalFactRefV1,
  CanonicalFactV1,
  TurnPlanV1,
} from '@/features/conversation/domain/conversation-pipeline';
import { assembleCanonicalConversationResponseV1 } from '@/features/conversation/domain/canonical-response-assembler';
import {
  confirmsACall,
  solicitsACall,
} from '@/features/conversation/domain/operational-promise-guard';

function plan(overrides: Partial<TurnPlanV1> = {}): TurnPlanV1 {
  return {
    schema_version: 1,
    next_stage: 'course_selected',
    response_goal: 'explain_selected_course',
    canonical_fact_requests: [],
    allowed_business_action: { type: 'none' },
    missing_information: [],
    should_offer_call: false,
    next_call_preference: 'unknown',
    next_call_offer_status: 'not_offered',
    next_call_offer_count: 0,
    next_awaiting_reply: 'none',
    payment_reported: false,
    selected_offering_code: 'redes-informaticas',
    selected_payment_plan: null,
    ...overrides,
  };
}

const facts: CanonicalFactV1[] = [{
  id: 'offering:redes-informaticas:name:v1',
  kind: 'offering_name',
  source: 'business_snapshot',
  value: 'Redes Informáticas',
  offering_code: 'redes-informaticas',
}];
const refs: CanonicalFactRefV1[] = facts.map(({ id, kind, offering_code }) => ({ id, kind, offering_code }));

function assemble(currentPlan: TurnPlanV1, narrative: {
  opening: string; explanation: string | null; next_question: string | null;
}) {
  return assembleCanonicalConversationResponseV1({
    plan: currentPlan,
    facts,
    fact_refs: refs,
    composition: {
      schema_version: 1,
      narrative,
      used_fact_ids: ['offering:redes-informaticas:name:v1'],
    },
  });
}

/**
 * The customer saw three call offers while the ledger had spent two. The
 * assembler was only ever counting its own offer; an offer the model wrote
 * inside the narrative was invisible to the budget and went out for free.
 *
 * The budget only means something if every visible offer consumes one.
 */
describe('call offers never outnumber the ledger', () => {
  it('recognizes a solicitation of a call, however it is phrased', () => {
    for (const offer of [
      '¿Preferís que sigamos por chat o querés solicitar una llamada?',
      'Si querés, podemos coordinar una llamada.',
      '¿Te gustaría que te llamemos?',
      '¿Te sirve que te llamemos?',
      '¿Podemos hablar por teléfono?',
      '¿Hablamos por teléfono?',
      '¿Coordinamos una llamada?',
      'Podés pedir que te contactemos por teléfono.',
    ]) {
      expect(solicitsACall(offer)).toBe(true);
    }
  });

  it('does not mistake talking about calls for offering one', () => {
    for (const honest of [
      'Ya registré tu solicitud de llamada.',
      'Entendido, no te llamamos y seguimos por acá.',
      'La llamada es opcional. ¿Querés conocer el programa?',
      'La llamada es opcional; si querés, te cuento el programa.',
      'La llamada es opcional, si querés, te cuento el programa.',
      'No podemos coordinar una llamada.',
      'El valor total del programa es USD 360.',
    ]) {
      expect(solicitsACall(honest)).toBe(false);
    }
  });

  it('recognizes a visible call confirmation without mistaking an offer for one', () => {
    expect(confirmsACall('Perfecto, coordinamos la llamada.')).toBe(true);
    expect(confirmsACall('No hay problema, coordinamos la llamada.')).toBe(true);
    expect(confirmsACall('Ya registré tu solicitud de llamada.')).toBe(true);
    expect(confirmsACall('La solicitud de llamada no fue registrada.')).toBe(false);
    expect(confirmsACall('Todavía no coordinamos la llamada.')).toBe(false);
    expect(confirmsACall('La llamada todavía no está confirmada.')).toBe(false);
    expect(confirmsACall('No podemos coordinar una llamada.')).toBe(false);
    expect(confirmsACall('Si querés, podemos coordinar una llamada.')).toBe(false);
    expect(confirmsACall('Dale, te cuento.')).toBe(false);
  });

  it('removes an unledgered call offer the model slipped into the narrative', () => {
    const assembled = assemble(plan({ should_offer_call: false }), {
      opening: 'Redes Informáticas dura 24 clases.',
      explanation: 'Si querés, podemos coordinar una llamada.',
      next_question: '¿Querés ver las formas de pago?',
    });

    expect(solicitsACall(assembled.content)).toBe(false);
    expect(assembled.content).toContain('Redes Informáticas');
    expect(assembled.content).toContain('¿Querés ver las formas de pago?');
  });

  it('keeps exactly one offer when the ledger authorized one', () => {
    const assembled = assemble(
      plan({ should_offer_call: true, next_call_offer_status: 'offered', next_call_offer_count: 1 }),
      {
        opening: 'Redes Informáticas dura 24 clases.',
        explanation: 'Si querés, podemos coordinar una llamada.',
        next_question: 'Contame si te sirve.',
      },
    );

    const offers = assembled.content
      .split('\n\n')
      .filter((paragraph) => solicitsACall(paragraph));
    expect(offers).toHaveLength(1);
  });
});
