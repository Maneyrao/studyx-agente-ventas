import { describe, expect, it } from 'vitest';
import { claimsProgramSendNowV1 } from '@/shared/conversation/program-send-claim';

describe('program-send effect claim', () => {
  it.each([
    ['te lo comparto de nuevo por acá', true],                      // real trace 36/syllabus_again
    ['Claro, te comparto el programa de Excel Integral para que lo veas.', true], // real trace 38/syllabus_unavailable
    ['Te envío el temario ahora mismo.', true],
    ['Ahí va el PDF del programa.', true],
    ['Te mando el plan de estudio completo.', true],
    ['Te dejo el programa acá.', true],
    ['Acá va el PDF.', true],
    ['Ahí tenés el temario.', true],
    ['Listo, te envié el PDF.', true],
    ['Ahí te mando el programa.', true],
  ])('claims a send happening now: %s', (text, expected) => {
    expect(claimsProgramSendNowV1(text, { programTopic: true })).toBe(expected);
  });
  it.each([
    'Ya te lo compartí hace un rato, está arriba en el chat.',
    'Te lo había enviado antes; si querés lo repasamos juntos.',
    'Ya te mandé el programa de Marketing Digital.',
    'No te lo puedo mandar de nuevo, pero te cuento lo que incluye.',
    'No tengo el archivo del programa de Excel Integral, pero te cuento lo principal.',
    'Si querés te lo mando por correo.',
    '¿Te comparto el programa?',
    'El programa tiene 8 módulos y se cursa online.',
    'Puedo compartirte el programa si lo necesitas.',
    'Te paso el link de pago del programa de Marketing Digital.',
    'Aquí tienes el detalle de los módulos del programa: son 8.',
    'Programa online de 16 clases con certificado de Studyx.',
    'Te comparto el enlace para inscribirte al programa.',
    'Ya te envié el programa hace un rato.',
    'Ya te lo compartí, está más arriba.',
  ])('does not claim: %s', (text) => {
    expect(claimsProgramSendNowV1(text, { programTopic: true })).toBe(false);
  });
  it('a bare pronoun needs a programme topic', () => {
    expect(claimsProgramSendNowV1('Te lo comparto ahora.', { programTopic: false })).toBe(false);
    expect(claimsProgramSendNowV1('Te lo comparto ahora.', { programTopic: true })).toBe(true);
  });
  it('an unrelated send (the payment link) is not a programme claim', () => {
    expect(claimsProgramSendNowV1('Te paso el link de pago.', { programTopic: false })).toBe(false);
  });
});
