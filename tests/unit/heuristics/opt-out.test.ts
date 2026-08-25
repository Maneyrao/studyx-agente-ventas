import { describe, expect, it } from 'vitest';
import { isExplicitOptOut } from '@/lib/heuristics/opt-out';

describe('isExplicitOptOut', () => {
  it.each([
    'Dame de baja',
    'No me escribas más',
    'No quiero recibir mensajes',
    'Dejá de contactarme',
    'STOP',
    'No me mandes más mensajes',
    'Sacame de la lista definitivamente, por favor.',
    'Sáquenme de la lista',
    'Borrame de la lista',
    'Dejen de escribirme',
    'No quiero que me escriban más',
    'No me hablen más',
    'Paren los mensajes',
    'Corten los mensajes',
    'Quiero dejar de recibir mensajes',
    'Desuscribime',
    'No deseo recibir más comunicaciones',
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
    // Regresión P0 (informe 2026-08-23): pedir demorar el LINK no es opt-out.
    'No me mandes el link todavía, quiero consultarlo con mi pareja primero.',
    'no me mandes el link aún',
    'Déjame hablarlo con mi familia, no me mandes link todavía',
    'No me mandes la info por mail, prefiero verla acá',
    'No me contactes por teléfono, escribime por WhatsApp',
    'No me contactes por llamada; sigamos por chat',
    'No me escribas hoy, mandame mañana',
    'No me mandes más mensajes de inglés, quiero Marketing',
    'No quiero promociones, pero respondeme esta consulta',
  ])('does not confuse commercial rejection with opt-out: %s', (text) => {
    expect(isExplicitOptOut(text)).toBe(false);
  });
});
