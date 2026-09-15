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

describe('prompt canónico comercial v28', () => {
  it('coincide con la fuente y declara la versión desplegable', () => {
    expect(STUDYX_AGENT_A_CANONICAL_PROMPT_VERSION).toBe('studyx-agent-a-canonical-v28');
    expect(STUDYX_AGENT_A_CANONICAL_PROMPT).toBe(source);
  });

  it('atiende leads de Meta sin fijar un curso fuera del catálogo dinámico', () => {
    expect(source).toMatch(/leads c[áa]lidos[\s\S]{0,100}Meta/iu);
    expect(source).toContain('Cualquier curso activo de `catalog.available_offerings`');
    expect(source).toMatch(/anuncio o el mensaje[\s\S]{0,100}curso activo/iu);
  });

  it('usa las fases como mapa flexible y deja la redacción en manos del modelo', () => {
    expect(source).toMatch(/Las fases son un mapa[\s\S]{0,100}no un guion rígido/iu);
    expect(source).toMatch(/Atiende la intenci[óo]n actual/iu);
    expect(source).toMatch(/Tú conduces y redactas/iu);
    expect(source).not.toMatch(/primera fase incompleta|nunca la saltees|Nunca des el precio antes/iu);
  });

  it('fija español neutro sin signos de apertura y captura el nombre desde el inicio sin bloquear', () => {
    expect(source).toMatch(/español neutro/iu);
    expect(source).toMatch(/No uses voseo ni regionalismos/iu);
    expect(source).toMatch(/No abras frases con `¿` o `¡`/iu);
    expect(source).toMatch(/primera respuesta[\s\S]{0,160}pregunta el primer nombre/iu);
    expect(source).toMatch(/primer nombre[\s\S]{0,220}[úu]nica pregunta/iu);
    expect(source).toMatch(/falta del nombre[\s\S]{0,160}nunca bloquea/iu);
    expect(source).toMatch(/primera respuesta[\s\S]{0,220}StudyX[\s\S]{0,220}cercan/iu);
    expect(source).toMatch(/Normalmente usa uno o dos mensajes breves/iu);
    expect(source).toMatch(/Puedes usar tres[\s\S]{0,120}idea diferente/iu);
    expect(source).toMatch(/nunca respondas s[óo]lo con una confirmaci[óo]n vac[íi]a/iu);
    expect(source).toMatch(/puedes cerrar preguntas y exclamaciones con `\?` o `!`/iu);
    expect(source).not.toMatch(/consulta general ambigua[\s\S]{0,160}un [úu]nico mensaje/iu);
    expect(source).not.toMatch(/s[óo]lo el [úu]ltimo mensaje[\s\S]{0,120}pregunta o invitaci[óo]n/iu);
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
    expect(source).toMatch(/M[áa]ximo dos ofrecimientos/iu);
    expect(source).toMatch(/rechazo a la invitaci[óo]n actual[\s\S]{0,180}no impide un segundo recordatorio/iu);
    expect(source).toMatch(/call_offer_count[^\n]*1[\s\S]{0,240}response\.call_offer/iu);
  });

  it('conserva las opciones ambiguas fuera de cualquier texto de llamada', () => {
    expect(source).toMatch(/varias coincidencias reales[\s\S]{0,200}nombra[^\n]*cada opci[óo]n/iu);
    expect(source).toMatch(/informaci[óo]n de las opciones[\s\S]{0,180}response\.messages/iu);
  });

  it('mantiene Stripe y los resultados operativos bajo autoridad verificable', () => {
    expect(source).toMatch(/Nunca escribas una URL[\s\S]{0,140}backend agrega el link canónico de Stripe/iu);
    expect(source).toMatch(/equipo verificar[áa] la acreditaci[óo]n[\s\S]{0,100}gestionar[áa] la inscripci[óo]n y el acceso/iu);
    expect(source).not.toMatch(/preinscripci[óo]n cargada|alta acad[ée]mica y genero|credenciales de acceso/iu);
  });

  it('confirma los seis datos comerciales antes del link y distingue pago informado de pago verificado', () => {
    expect(source).toMatch(/nombre y apellido, correo, teléfono, curso y plan[\s\S]{0,180}correctos/iu);
    expect(source).toMatch(/no envíes todavía el link en el mismo turno/iu);
    expect(source).toMatch(/Si informa que pagó[\s\S]{0,220}equipo verificará la acreditación/iu);
    expect(source).toMatch(/Nunca afirmes que el pago ya fue verificado/iu);
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
