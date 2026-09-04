import { describe, expect, it } from 'vitest';

import {
  classifyCurrentPaymentIntent,
  derivePaymentPlanSelectionFromBatch,
} from '@/features/payments/domain/payment-choice-policy';

/**
 * El plan escrito en letras es el mismo plan.
 *
 * El backend deriva el plan del mensaje del cliente por su cuenta y exige que
 * coincida con el que autorizó el modelo; si no coinciden, el commit muere con
 * `PAYMENT_PLAN_MISMATCH`. Los patrones sólo aceptaban numerales, así que
 * "me quedo con las seis cuotas" derivaba `null` mientras el modelo entendía
 * `monthly_6` perfectamente.
 *
 * Consecuencia observada por el arnés de workflow con una paráfrasis nueva: el
 * commit se rechaza, el workflow queda en `paused_error` y el turno sale MUDO.
 * Una persona que escribe los números con letras no puede comprar.
 *
 * Ninguna suite lo veía: todos sus guiones dicen "las 6 cuotas".
 */
describe('planes nombrados en letras', () => {
  it('deriva el plan aunque el número venga escrito', () => {
    expect(derivePaymentPlanSelectionFromBatch([{ content: 'Me quedo con las seis cuotas' }]))
      .toBe('monthly_6');
    expect(derivePaymentPlanSelectionFromBatch([{ content: 'prefiero doce pagos' }]))
      .toBe('monthly_12');
    expect(derivePaymentPlanSelectionFromBatch([{ content: 'dale, seis meses' }]))
      .toBe('monthly_6');
  });

  it('sigue derivando con numerales, como hasta ahora', () => {
    expect(derivePaymentPlanSelectionFromBatch([{ content: 'Me quedo con las 6 cuotas' }]))
      .toBe('monthly_6');
    expect(derivePaymentPlanSelectionFromBatch([{ content: 'elijo 12 pagos mensuales' }]))
      .toBe('monthly_12');
  });

  it('la intención de compromiso también reconoce las letras', () => {
    expect(classifyCurrentPaymentIntent([{ content: 'Me quedo con las seis cuotas' }]))
      .toEqual({ kind: 'direct', planCode: 'monthly_6' });
  });

  it('no inventa un plan donde no lo hay', () => {
    expect(derivePaymentPlanSelectionFromBatch([{ content: 'hola, buenas tardes' }]))
      .toBeNull();
  });
});
