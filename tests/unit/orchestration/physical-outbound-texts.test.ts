import { describe, expect, it } from 'vitest';
import { physicalOutboundTexts } from '../../../src/features/orchestration/domain/physical-outbound-texts';

describe('physicalOutboundTexts', () => {
  it('preserves natural model-authored bubbles within the three-part transport cap', () => {
    const authored = ['Uno.', 'Dos.', 'Tres.', 'Llamada aparte.'];

    const result = physicalOutboundTexts({
      final_response: authored.join('\n\n'),
      authored_messages: authored,
      enabled: true,
    });

    expect(result).toHaveLength(3);
    expect(result.join('\n\n')).toBe(authored.join('\n\n'));
    expect(result.at(-1)).toBe('Llamada aparte.');
  });

  it('keeps a canonical payment block last without losing model-authored copy', () => {
    const authored = ['Uno.', 'Dos.', 'Tres.'];
    const payment = '12 pagos mensuales de USD 30: https://buy.stripe.com/test';

    const result = physicalOutboundTexts({
      final_response: `${authored.join('\n\n')}\n\n${payment}`,
      authored_messages: authored,
      enabled: true,
    });

    expect(result).toHaveLength(3);
    expect(result.join('\n\n')).toBe(`${authored.join('\n\n')}\n\n${payment}`);
    expect(result.at(-1)).toBe(payment);
  });

  it('keeps a payment explanation and its canonical link in one WhatsApp message', () => {
    const authored = ['Perfecto, te dejo el enlace.'];
    const payment = 'Pago único de USD 360: https://buy.stripe.com/test';

    const result = physicalOutboundTexts({
      final_response: `${authored[0]}\n\n${payment}`,
      authored_messages: authored,
      enabled: true,
      force_single_message: true,
    });

    expect(result).toEqual([`${authored[0]}\n\n${payment}`]);
  });

  it('splits a long authored message at its paragraph break into separate bubbles', () => {
    const first = 'Tienes razón en preguntarlo, no doy por hecho que necesites el básico. Inglés 1 arranca con conceptos básicos.';
    const second = 'Si quieres seguir subiendo, después de Inglés 1 viene Inglés 2. Cuéntame para qué quieres el inglés: trabajo, viajar o algo más?';
    const authored = [`${first}\n${second}`];

    const result = physicalOutboundTexts({ final_response: authored[0]!, authored_messages: authored, enabled: true });

    expect(result).toEqual([first, second]);
  });

  it('keeps a list attached to the sentence that introduces it', () => {
    const authored = ['Tienes estas opciones:\n- Inglés 1\n- Inglés 2'];

    const result = physicalOutboundTexts({ final_response: authored[0]!, authored_messages: authored, enabled: true });

    expect(result).toEqual(authored);
  });

  it('keeps the three-part cap after splitting paragraphs', () => {
    const authored = ['Uno.\nDos.', 'Tres.\nCuatro.'];

    const result = physicalOutboundTexts({ final_response: authored.join('\n\n'), authored_messages: authored, enabled: true });

    expect(result).toEqual(['Uno.', 'Dos.\n\nTres.', 'Cuatro.']);
  });
});
