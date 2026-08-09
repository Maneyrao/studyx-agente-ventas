import { describe, expect, it } from 'vitest';
import { referencesPast } from '@/lib/heuristics/reference-detection';

describe('referencesPast', () => {
  it.each([
    'Quiero retomar lo que hablamos',
    'Como te había comentado, prefiero por la noche',
    '¿Sigue vigente la promoción?',
    'La última vez me ofreciste otro horario',
    'Te pasé mi pedido ayer',
  ])('detects historical reference %j', (content) => {
    expect(referencesPast(content)).toBe(true);
  });

  it('normalizes accents and casing', () => {
    expect(referencesPast('ME HABÍAS DICHO que quedaba una vacante')).toBe(true);
  });

  it.each([
    'Quiero conocer el curso de Python',
    '¿Cuánto cuesta la inscripción?',
    'Necesito una vacante para agosto',
    'Gracias',
  ])('does not invent a historical reference for %j', (content) => {
    expect(referencesPast(content)).toBe(false);
  });
});
