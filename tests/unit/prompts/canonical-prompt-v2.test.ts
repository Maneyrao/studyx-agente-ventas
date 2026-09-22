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

describe('prompt canónico comercial v40', () => {
  it('coincide con la fuente y declara la versión desplegable', () => {
    expect(STUDYX_AGENT_A_CANONICAL_PROMPT_VERSION).toBe('studyx-agent-a-canonical-v40');
    expect(STUDYX_AGENT_A_CANONICAL_PROMPT).toBe(source);
  });

  it('atiende leads de Meta sin fijar un curso fuera del catálogo dinámico', () => {
    expect(source).toMatch(/leads[\s\S]{0,120}Meta/iu);
    expect(source).toContain('Cualquier curso activo de `catalog.available_offerings`');
    expect(source).toMatch(/anuncio o el mensaje[\s\S]{0,100}curso activo/iu);
  });

  it('usa las fases como mapa flexible y deja la redacción en manos del modelo', () => {
    expect(source).toMatch(/Las fases orientan la venta[\s\S]{0,120}no son un cuestionario ni un recorrido obligatorio/iu);
    expect(source).toMatch(/Atiende la intenci[óo]n actual/iu);
    expect(source).toMatch(/Tú interpretas, conduces y redactas/iu);
    expect(source).not.toMatch(/primera fase incompleta|nunca la saltees|Nunca des el precio antes/iu);
  });

  it('fija español neutro sin signos de apertura y captura el nombre desde el inicio sin bloquear', () => {
    expect(source).toMatch(/español neutro/iu);
    expect(source).toMatch(/No uses voseo ni regionalismos/iu);
    expect(source).toMatch(/No abras frases con `¿` o `¡`/iu);
    expect(source).toMatch(/primera respuesta[\s\S]{0,160}pregunta el primer nombre/iu);
    expect(source).toMatch(/primer nombre[\s\S]{0,220}[úu]nica pregunta/iu);
    expect(source).toMatch(/ausencia no bloquea el asesoramiento/iu);
    expect(source).toMatch(/primera respuesta[\s\S]{0,220}StudyX/iu);
    expect(source).toMatch(/entre uno y tres mensajes breves/iu);
    expect(source).toMatch(/primero responde[\s\S]{0,120}luego recomienda[\s\S]{0,120}finalmente propone/iu);
    expect(source).toMatch(/response\.call_offer[\s\S]{0,120}no la dupliques/iu);
    expect(source).toMatch(/no cortes una oración por la mitad/iu);
    expect(source).toMatch(/ni repitas la misma información en otra burbuja/iu);
    expect(source).not.toMatch(/20 a 40 palabras en total/iu);
    expect(source).toMatch(/cursos, planes u opciones[\s\S]{0,80}lista compacta/iu);
    expect(source).toMatch(/recomienda una principal con un motivo concreto/iu);
    expect(source).toMatch(/guarda los detalles secundarios para cuando los pida/iu);
    expect(source).not.toMatch(/Por defecto[^\n]*dos mensajes breves|Prioriza una respuesta compacta|Mant[eé]n cada mensaje breve/iu);
    expect(source).toMatch(/No contestes con una confirmaci[óo]n vac[íi]a/iu);
    expect(source).toMatch(/puedes cerrarlas con `\?` o `!`/iu);
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
    expect(source).toMatch(/Rechazar la primera invitaci[óo]n[\s\S]{0,180}no impide el segundo/iu);
    expect(source).toMatch(/segundo y [uú]ltimo ofrecimiento/iu);
    expect(source).toMatch(/response\.call_offer/iu);
  });

  it('persuade sin inventar resultados laborales ni ampliar el alcance de la llamada', () => {
    expect(source).toMatch(
      /no inventes resultados[\s\S]{0,180}demanda laboral[\s\S]{0,180}ingresos[\s\S]{0,180}conseguir clientes/iu,
    );
    expect(source).toMatch(
      /La llamada sirve para orientar sobre cursos, modalidades, contenidos, precios e inscripci[oó]n/iu,
    );
    expect(source).toMatch(/No la presentes como una clase ni prometas enseñar a conseguir clientes/iu);
  });

  it('conserva las opciones ambiguas fuera de cualquier texto de llamada', () => {
    expect(source).toMatch(/varias coincidencias[\s\S]{0,160}muestra las opciones relevantes/iu);
    expect(source).toMatch(/presenta hasta tres áreas u opciones reales/iu);
  });

  it('mantiene Stripe y los resultados operativos bajo autoridad verificable', () => {
    expect(source).toMatch(/Nunca escribas una URL[\s\S]{0,140}orquestador agrega el link canónico/iu);
    expect(source).toMatch(/equipo verificar[áa] la acreditaci[óo]n[\s\S]{0,100}gestionar[áa] la inscripci[óo]n y el acceso/iu);
    expect(source).not.toMatch(/preinscripci[óo]n cargada|alta acad[ée]mica y genero|credenciales de acceso/iu);
  });

  it('confirma los seis datos comerciales antes del link y distingue pago informado de pago verificado', () => {
    expect(source).toMatch(/nombre y apellido, correo, teléfono, curso y plan[\s\S]{0,180}correctos/iu);
    expect(source).toMatch(/no solicites el link en el mismo turno/iu);
    expect(source).toMatch(/Si informa que pagó[\s\S]{0,220}equipo verificará la acreditación/iu);
    expect(source).toMatch(/Nunca afirmes que el pago est[áa] verificado/iu);
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
