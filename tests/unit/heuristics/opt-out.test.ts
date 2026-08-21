import { describe, expect, it } from 'vitest';
import { isExplicitOptOut } from '@/lib/heuristics/opt-out';

describe('isExplicitOptOut', () => {
  it.each([
    'Dame de baja',
    'No me escribas más',
    'No quiero recibir mensajes',
    'Dejá de contactarme',
    'STOP',
  ])('detects an explicit no-contact request: %s', (text) => {
    expect(isExplicitOptOut(text)).toBe(true);
  });

  it.each([
    'No quiero comprar ahora',
    'El curso no me convence',
    'No puedo esta semana',
    'Quiero comparar precios',
    'No me llames, prefiero seguir por WhatsApp',
    'No quiero recibir llamadas',
    'Dejá de llamarme y explicame por acá',
  ])('does not confuse commercial rejection with opt-out: %s', (text) => {
    expect(isExplicitOptOut(text)).toBe(false);
  });
});
