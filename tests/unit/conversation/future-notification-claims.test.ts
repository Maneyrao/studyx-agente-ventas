import { describe, expect, it } from 'vitest';
import { dropUnsupportedStateAssertionsV1 } from '@/features/conversation/domain/operational-promise-guard';

describe('unsupported follow-up commitments', () => {
  it.each([
    'Una vez que el equipo confirme que está acreditado, gestionan tu ingreso al campus y te avisan por acá.',
    'El equipo te contactará cuando revise el pago.',
    'Mañana te escribo para recordarte el pago.',
    'No te preocupes, el equipo te contactará cuando revise el pago.',
    'Mañana te avisaré cuando revise el pago.',
    'Cuando revisen el pago, te voy a avisar por acá.',
    'Te aviso que el equipo te contactará cuando revise el pago.',
    'No te voy a avisar hoy, mañana te escribo.',
  ])('removes an unimplemented notification even when attributed to a human: %s', (claim) => {
    expect(dropUnsupportedStateAssertionsV1(`Gracias por avisar. ${claim}`, new Set()))
      .toBe('Gracias por avisar.');
  });

  it.each([
    'El equipo lo revisará y, si está acreditado, gestionará tu acceso.',
    'No voy a volver a escribirte.',
    'Cuando hagas el pago, avisame por acá.',
    'Te aviso que el total es USD 360.',
    'No te voy a avisar más.',
    'No puedo prometer que el equipo te contactará.',
  ])('preserves the authorized process, a negation, or a customer request: %s', (copy) => {
    expect(dropUnsupportedStateAssertionsV1(copy, new Set())).toBe(copy);
  });
});
