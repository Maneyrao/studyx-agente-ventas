import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  STUDYX_AGENT_A_CANONICAL_PROMPT,
  STUDYX_AGENT_A_CANONICAL_PROMPT_VERSION,
} from '../../../botpress-agent/src/prompts/studyx-agent-a-canonical.generated';
import { unsupportedOperationalAssertionsV1 } from '@/features/conversation/domain/operational-promise-guard';
import { materializeStateFactsV1 } from '@/features/conversation/domain/state-fact-registry';

const source = readFileSync(
  fileURLToPath(new URL('../../../docs/prompts/studyx-agent-a-canonical.md', import.meta.url)),
  'utf8',
);

describe('prompt canónico comercial v15', () => {
  it('coincide con la fuente y declara la versión desplegable', () => {
    expect(STUDYX_AGENT_A_CANONICAL_PROMPT_VERSION).toBe('studyx-agent-a-canonical-v15');
    expect(STUDYX_AGENT_A_CANONICAL_PROMPT).toBe(source);
  });

  it('atiende leads de Meta sin fijar un curso fuera del catálogo dinámico', () => {
    expect(source).toMatch(/leads c[áa]lidos[\s\S]{0,100}Meta/iu);
    expect(source).toContain('Cualquier curso activo de `catalog.available_offerings`');
    expect(source).toMatch(/contexto del anuncio[\s\S]{0,100}si est[áa] disponible/iu);
    expect(source).toMatch(/ese contexto no est[áa] disponible[\s\S]{0,160}mensaje actual/iu);
  });

  it('usa las fases como mapa flexible y deja la redacción en manos del modelo', () => {
    expect(source).toMatch(/Las fases son un mapa[\s\S]{0,100}no un guion r[íi]gido ni un bloqueo/iu);
    expect(source).toMatch(/Respond[ée] su intenci[óo]n actual/iu);
    expect(source).toMatch(/Vos conduc[íi]s y redact[áa]s la conversaci[óo]n/iu);
    expect(source).not.toMatch(/primera fase incompleta|nunca la saltees|Nunca des el precio antes/iu);
  });

  it('mantiene exactamente los cuatro datos de contacto permitidos', () => {
    for (const field of ['nombre', 'apellido', 'correo', 'teléfono']) {
      expect(source.toLowerCase()).toContain(field);
    }
    for (const forbidden of [/ciudad/iu, /zip\s*code/iu, /c[oó]digo postal/iu]) {
      expect(source).not.toMatch(forbidden);
    }
  });

  it('mantiene los tres planes y el tope de dos invitaciones de llamada', () => {
    expect(source).toContain('12 pagos mensuales de USD 30 (`monthly_12`)');
    expect(source).toContain('6 pagos mensuales de USD 60 (`monthly_6`)');
    expect(source).toContain('1 pago único de USD 360 (`one_time`)');
    expect(source).toMatch(/m[áa]ximo dos invitaciones/iu);
    expect(source).toMatch(/Si rechaza[\s\S]{0,180}no vuelvas a ofrecer una llamada ni insistas/iu);
  });

  it('mantiene Stripe y los resultados operativos bajo autoridad verificable', () => {
    expect(source).toMatch(/Nunca escribas una URL[\s\S]{0,140}backend agrega el link de Stripe/iu);
    expect(source).toContain(
      'Registré tus datos y tu aviso de pago. El equipo va a verificar la acreditación '
      + 'y, cuando esté confirmada, gestionará tu inscripción y acceso.',
    );
    expect(source).not.toMatch(/preinscripci[óo]n cargada|alta acad[ée]mica y genero|credenciales de acceso/iu);
  });

  it('no ordena afirmaciones que el guard operativo rechazaría', () => {
    const allMaterialized = materializeStateFactsV1({
      intake: {
        nombre: 'Ana', apellido: 'Pérez',
        correo: 'ana@example.com', telefono: '+15551234567',
      },
      planned_payment_reported: true,
    });
    const offenders = source
      .split('\n')
      .map((line, index) => ({ line, number: index + 1 }))
      .filter(({ line }) => !/^\s*- No /u.test(line))
      .filter(({ line }) => unsupportedOperationalAssertionsV1(line, allMaterialized).length > 0)
      .map(({ line, number }) => `${number}: ${line.trim()}`);

    expect(offenders).toEqual([]);
  });
});
