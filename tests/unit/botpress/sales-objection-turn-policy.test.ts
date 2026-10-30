import { describe, expect, it } from 'vitest';
import type { AgentAContextV1 } from '../../../botpress-agent/src/schemas/agent-a-brain';
import { evaluateSalesObjectionTurnV1 } from '../../../botpress-agent/src/lib/conversation/sales-objection-turn-policy';

function contextWithCurrentMessage(text: string, priorInbound: readonly string[] = []): AgentAContextV1 {
  return {
    turn: {
      batch_messages: [{ id: 'current-message', text }],
      recent_turns: priorInbound.map((content, index) => ({
        id: `prior-${index}`,
        direction: 'inbound' as const,
        content,
      })),
    },
  } as AgentAContextV1;
}

/**
 * Authority: AGENTS.md responsibilities and prompt lines 68-112.
 * Response strategy belongs to Agent A. This module only classifies the current
 * objection for model context; it no longer validates whether wording sells,
 * reframes price or advances a negotiation rung.
 */
describe('evaluateSalesObjectionTurnV1', () => {
  it.each([
    ['Cual es el costo?', 'price_question', null],
    ['Cuanto sale el curso?', 'price_question', null],
    ['Me parece caro, cuánto sería en 12 cuotas?', 'price_question_with_objection', null],
    ['Me parece caro, cuánto cuesta por mes?', 'price_question_with_objection', null],
    ['Me parece caro, hay que pagar todo junto para empezar?', 'price_question_with_objection', null],
    ['Me parece caro, puedo pagar en cuotas?', 'price_question_with_objection', null],
    ['Me parece caro, cuántas cuotas son?', 'price_question_with_objection', null],
    ['solo 1 pago? me parece super caro', 'price_question_with_objection', null],
    ['Ofreces descuentos al final?', 'price_objection', null],
    ['Me haces un descuento?', 'price_objection', null],
    ['Podés bajar el precio?', 'price_objection', null],
    ['No tenés una promoción?', 'price_objection', null],
    ['No tenés ninguna oferta para hacerme?', 'price_objection', null],
    ['Hay alguna oferta que puedas darme?', 'price_objection', null],
    ['Si no me ofrecés la promo no', 'price_objection', null],
    ['No podés ofrecerme una bonificación?', 'price_objection', null],
    ['Me sigue pareciendo caro', 'repeated_price_objection', ['Está fuera de mi presupuesto']],
    ['Si no me ofrecés la promo no', 'repeated_price_objection', ['El precio me parece caro']],
    ['Si pago en 12 meses, el diploma tarda 12 meses?', 'payment_terms_question', null],
    ['Si pago en 12 meses, puedo terminar antes?', 'payment_terms_question', null],
    ['Hay que pagar todo junto para empezar?', 'payment_terms_question', null],
    ['Hay que pagar todo junto para inscribirme?', 'payment_terms_question', null],
    ['Trabajo mucho, no sé si voy a tener tiempo', 'time_or_schedule_objection', null],
    ['No puedo en ese horario', 'time_or_schedule_objection', null],
    ['Las clases son de lunes a viernes?', 'time_or_schedule_objection', null],
    ['Prefiero estudiar de mañana', 'time_or_schedule_objection', null],
    ['Estoy desde cero', 'readiness_or_requirements_objection', null],
    ['No tengo computadora', 'readiness_or_requirements_objection', null],
    ['El certificado sirve?', 'trust_objection', null],
    ['Es una escuela real?', 'trust_objection', null],
    ['Pensé que las clases eran con un profesor en vivo, no un video', 'trust_objection', null],
    ['Pensé que eran clases en vivo, no videos', 'trust_objection', null],
    ['El banco no me deja hacer el pago', 'payment_friction', null],
    ['El banco rechazó el pago', 'payment_friction', null],
    ['La tarjeta fue rechazada', 'payment_friction', null],
    ['La tarjeta está bloqueada', 'payment_friction', null],
    ['Se me quedó la tarjeta en el cajero', 'payment_friction', null],
    ['Ahorita recargo la tarjeta', 'payment_friction', null],
    ['Quiero tiempo para pensarlo', 'decision_deferral', null],
    ['No me quiero inscribir todavía, tengo que pensarlo', 'decision_deferral', null],
    ['Hasta cuándo es válida la oferta?', 'offer_timing_question', null],
    ['Hasta cuándo tienes esa oferta?', 'offer_timing_question', null],
  ] satisfies ReadonlyArray<readonly [string, string, readonly string[] | null]>)('classifies %s as %s', (text, expected, priorInbound) => {
    expect(evaluateSalesObjectionTurnV1(contextWithCurrentMessage(text, priorInbound ?? []))).toEqual({
      kind: expected,
    });
  });

  it('classifies the fragmented production wording as a promotion objection', () => {
    const current = contextWithCurrentMessage('');
    current.turn.batch_messages = [
      { id: 'current-1', text: 'no tenes nnguan oferta' },
      { id: 'current-2', text: 'para hacerme' },
      { id: 'current-3', text: '?' },
    ];

    expect(evaluateSalesObjectionTurnV1(current)).toEqual({ kind: 'price_objection' });
  });

  it.each([
    'Cuánto dura?',
    'Hoy sí o sí hago el pago',
    'Me interesa Inglés 1',
    'No quiero recibir ofertas',
    'Vi una oferta laboral de fotografía',
    'Hay ofertas laborales?',
    'No me ofrecés más ofertas',
  ])('does not force an objection category for %s', (text) => {
    expect(evaluateSalesObjectionTurnV1(contextWithCurrentMessage(text))).toEqual({ kind: 'none' });
  });

  it('classifies a selected plan followed by a decision deferral in the same batch', () => {
    const current = contextWithCurrentMessage('');
    current.turn.batch_messages = [
      { id: 'current-1', text: 'doce de 30' },
      { id: 'current-2', text: 'no me quiero inscribir igual ya, tengo que pensarlo' },
    ];

    expect(evaluateSalesObjectionTurnV1(current)).toEqual({ kind: 'decision_deferral' });
  });

  it.each([
    'No necesito pensarlo, pasame el link.',
    'No quiero pensarlo más, quiero inscribirme ahora.',
  ])('does not treat a negated deferral as pending: %s', (text) => {
    expect(evaluateSalesObjectionTurnV1(contextWithCurrentMessage(text))).toEqual({ kind: 'none' });
  });

  it('honors the last purchase intention when the customer changes their mind in the same batch', () => {
    const current = contextWithCurrentMessage('');
    current.turn.batch_messages = [
      { id: 'current-1', text: 'Lo voy a pensar.' },
      { id: 'current-2', text: 'Mejor no, quiero inscribirme ahora.' },
    ];

    expect(evaluateSalesObjectionTurnV1(current)).toEqual({ kind: 'none' });
  });

  it('honors a later link request after an earlier decision deferral', () => {
    const current = contextWithCurrentMessage('');
    current.turn.batch_messages = [
      { id: 'current-1', text: 'Lo voy a pensar.' },
      { id: 'current-2', text: 'Ya me decidí, pasame el link.' },
    ];

    expect(evaluateSalesObjectionTurnV1(current)).toEqual({ kind: 'none' });
  });
});
