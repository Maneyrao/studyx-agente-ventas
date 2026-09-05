import { describe, expect, it } from 'vitest';
import {
  classifyCurrentPaymentIntent as backendClassify,
  derivePaymentChoiceFromBatch as backendDerive,
  derivePaymentPlanSelectionFromBatch as backendSelection,
  hasExplicitPurchaseDecline as backendDecline,
  hasTemporalPaymentDeferral as backendDeferral,
} from '../../../src/features/payments/domain/payment-choice-policy';
import {
  classifyCurrentPaymentIntent as mirrorClassify,
  derivePaymentChoiceFromBatch as mirrorDerive,
  derivePaymentPlanSelectionFromBatch as mirrorSelection,
  hasExplicitPurchaseDecline as mirrorDecline,
  hasTemporalPaymentDeferral as mirrorDeferral,
} from '../../../botpress-agent/src/utils/payment-choice';

/**
 * The Botpress workflow carries a MIRROR of the backend's deterministic
 * payment-choice rule so it can downgrade an unauthorized send_payment_link
 * to a clarification before the backend 422s it. A divergence between the
 * two would reopen the silent-turn bug: a phrase the mirror accepts but the
 * backend refuses (or vice versa) puts the customer back in silence. This
 * corpus locks both derivations together.
 */
const CORPUS = [
  'Quiero los 12 meses',
  'me sirven 12 cuotas',
  'quiero 12 pagos',
  'La opción de 30 dólares por mes me sirve',
  'Prefiero cuotas de 30 usd',
  'las 6 meses porfa',
  '6 cuotas está bien',
  'Prefiero 6 pagos',
  'Quiero pagar USD 60 por mes',
  'Me quedo con las cuotas de USD 60',
  'prefiero contado',
  'quiero el Pago Único',
  'Pago todo junto',
  'prefiero un solo pago',
  'quiero hacer el pago total',
  'un pago de 360',
  'Quiero pagar los 360 dólares en un único pago',
  'prefiero único pago',
  'hola, quiero info del curso',
  'pasame el link porfa',
  '¿6 pagos o todo junto?',
  'El curso cuesta 360 dólares, ¿verdad?',
  'me sirven las 12 meses o las 6 cuotas, cuál me recomendás?',
  'Mejor todavía, prefiero el plan corto de menos tiempo. Esperá antes de mandar nada.',
  'No, esperá, mejor pago todo de una vez, así termino antes.',
  'Antes de seguir, ¿qué te había contado sobre mi disponibilidad?',
  'Ya te había contado mi situación',
  'Por ahora no tengo correo; mi teléfono es +54 9 11 1234 5678',
  'Después te paso mi apellido',
  'Prefiero esperar para pagar',
  'No puedo pagar en este momento',
  'No quiero comprar el curso',
  'No me interesa inscribirme',
  'Por ahora no me voy a anotar, lo voy a pensar',
  'No quiero comprar ahora',
  'No me voy a inscribir todavía',
];

describe('payment-choice mirror parity (botpress-agent vs backend)', () => {
  it.each(CORPUS)('derives the same plan for: %s', (text) => {
    const messages = [{ content: text }];
    expect(mirrorDerive(messages)).toBe(backendDerive(messages));
    expect(mirrorSelection(messages)).toBe(backendSelection(messages));
    expect(mirrorClassify(messages)).toEqual(backendClassify(messages));
    expect(mirrorDeferral(messages)).toBe(backendDeferral(messages));
    expect(mirrorDeferral(messages, true)).toBe(backendDeferral(messages, true));
    expect(mirrorDecline(messages)).toBe(backendDecline(messages));
  });

  it.each([
    ['No quiero un pago de 360', { kind: 'none' }],
    ['No, un pago de 360 no', { kind: 'none' }],
    ['El curso requiere un pago de 360 antes de empezar', { kind: 'none' }],
    ['Me dijeron que es un pago de 360', { kind: 'none' }],
  ] as const)('keeps non-selections from acquiring payment authority in both copies: %s', (
    text,
    expectedIntent,
  ) => {
    const messages = [{ content: text }];
    expect(backendSelection(messages)).toBeNull();
    expect(mirrorSelection(messages)).toBeNull();
    expect(backendClassify(messages)).toEqual(expectedIntent);
    expect(mirrorClassify(messages)).toEqual(expectedIntent);
  });

  it.each([
    ['same-message revocation', [{ content: 'Prefiero un pago de 360, no' }]],
    ['later-message revocation', [
      { content: 'Prefiero un pago de 360' },
      { content: 'No, mejor no' },
    ]],
  ] as const)('keeps %s from authorizing checkout in either copy', (_name, messages) => {
    expect(backendSelection(messages)).toBeNull();
    expect(mirrorSelection(messages)).toBeNull();
    expect(backendClassify(messages)).toEqual({ kind: 'veto' });
    expect(mirrorClassify(messages)).toEqual({ kind: 'veto' });
  });
});
