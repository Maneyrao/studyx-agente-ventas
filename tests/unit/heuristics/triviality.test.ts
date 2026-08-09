import { describe, expect, it } from 'vitest';
import { isTrivial } from '@/lib/heuristics/triviality';

describe('isTrivial', () => {
  it.each(['hola', 'OK', 'muchas gracias', 'sí', 'buen día'])(
    'classifies acknowledgement %j as trivial',
    (content) => {
      expect(isTrivial(content)).toBe(true);
    }
  );

  it('normalizes casing, accents and surrounding whitespace', () => {
    expect(isTrivial('  SÍ  ')).toBe(true);
    expect(isTrivial('BUEN DÍA')).toBe(true);
    expect(isTrivial('Gracias!')).toBe(true);
  });

  it.each([
    '¿Cuánto cuesta?',
    'Necesito 2 vacantes',
    'Quiero información sobre el curso nocturno',
    'No me contacten nunca más, por favor',
  ])('keeps substantive message %j out of the trivial path', (content) => {
    expect(isTrivial(content)).toBe(false);
  });

  it('keeps a question non-trivial even when it has few words', () => {
    expect(isTrivial('¿Hay cupo?')).toBe(false);
  });

  it.each(['quiero comprar', 'prefiero noche', 'no me llames'])(
    'does not discard short commercial intent %j',
    (content) => {
      expect(isTrivial(content)).toBe(false);
    }
  );
});
