import { describe, expect, it } from 'vitest';
import { derivePaymentChoiceFromBatch as backendDerive } from '../../../src/features/payments/domain/payment-choice-policy';
import { derivePaymentChoiceFromBatch as mirrorDerive } from '../../../botpress-agent/src/utils/payment-choice';

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
  'Quiero pagar los 360 dólares en un único pago',
  'prefiero único pago',
  'hola, quiero info del curso',
  'pasame el link porfa',
  '¿6 pagos o todo junto?',
  'El curso cuesta 360 dólares, ¿verdad?',
  'me sirven las 12 meses o las 6 cuotas, cuál me recomendás?',
  'Mejor todavía, prefiero el plan corto de menos tiempo. Esperá antes de mandar nada.',
  'No, esperá, mejor pago todo de una vez, así termino antes.',
];

describe('payment-choice mirror parity (botpress-agent vs backend)', () => {
  it.each(CORPUS)('derives the same plan for: %s', (text) => {
    const messages = [{ content: text }];
    expect(mirrorDerive(messages)).toBe(backendDerive(messages));
  });
});
