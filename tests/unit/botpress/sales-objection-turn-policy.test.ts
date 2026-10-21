import { describe, expect, it } from 'vitest';
import { responseProgressesRepeatedPriceObjectionV1 } from '../../../botpress-agent/src/lib/conversation/sales-objection-turn-policy';

describe('responseProgressesRepeatedPriceObjectionV1', () => {
  it.each([
    'Son 12 cuotas de USD 30. Te parece?',
    'Puedes pagar 12 cuotas de USD 30.',
    'Incluye 16 clases para tu trabajo.',
  ])('rejects pseudo-progress that only repackages price or course facts: %s', (message) => {
    expect(responseProgressesRepeatedPriceObjectionV1({
      messages: [message],
      call_offer: null,
    })).toBe(false);
  });

  it('does not let a call invitation replace handling the objection in chat', () => {
    expect(responseProgressesRepeatedPriceObjectionV1({
      messages: ['Son 12 cuotas de USD 30.'],
      call_offer: 'Si quieres, te llamo y lo vemos.',
    })).toBe(false);
  });

  it.each([
    'Para saber si te conviene, qué quieres poder hacer con Marketing Digital?',
    'Si buscas mover tu propio negocio, lo aprendido te puede ayudar a ordenar cómo lo comunicas.',
    'Lo que te frena es la cuota mensual o no estar seguro de aprovecharlo?',
    'Es un tema de presupuesto o de confianza en la formación?',
    'Es presupuesto o confianza?',
    'Qué te hace dudar?',
  ])('accepts a diagnostic or conditional value advance: %s', (message) => {
    expect(responseProgressesRepeatedPriceObjectionV1({
      messages: [message],
      call_offer: null,
    })).toBe(true);
  });

  it('rejects a vague conditional phrase that adds no customer-specific value', () => {
    expect(responseProgressesRepeatedPriceObjectionV1({
      messages: ['Podrías usar lo aprendido para lo que quieras.'],
      call_offer: null,
    })).toBe(false);
  });

  it('rejects a payment-plan reoffer disguised as a question', () => {
    expect(responseProgressesRepeatedPriceObjectionV1({
      messages: ['Prefieres pagar las 12 cuotas de USD 30?'],
      call_offer: null,
    })).toBe(false);
  });

  it.each([
    'Son 12 cuotas de USD 30. Qué te parece?',
    'Cuál plan quieres?',
  ])('rejects a generic closing or plan selector as diagnostic progress: %s', (message) => {
    expect(responseProgressesRepeatedPriceObjectionV1({
      messages: [message],
      call_offer: null,
    })).toBe(false);
  });
});
