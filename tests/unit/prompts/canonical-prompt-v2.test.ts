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

describe('prompt canónico v2', () => {
  it('las objeciones y reglas duras conservan el alcance de precio, elección y permiso', () => {
    const costObjection = source.slice(source.indexOf('**"¿Cuál es el costo?"**'), source.indexOf('**"Es caro"'));
    expect(costObjection).toMatch(/primera presentación/iu);
    expect(costObjection).toMatch(/sin repetir/iu);
    const always = source.slice(source.indexOf('**SIEMPRE:**'), source.indexOf('## 8.'));
    expect(always.split('\n').find(line => line.includes('Cierre por opción'))).toMatch(/no haya elegido/iu);
    expect(always.split('\n').find(line => line.includes('Link de pago'))).toMatch(/autorización explícita vigente/iu);
    const firstPayment = source.slice(source.indexOf('**"¿Hay que pagar todo junto'), source.indexOf('### TIEMPO Y HORARIOS'));
    expect(firstPayment).toMatch(/verificar la acreditación/iu);
    expect(firstPayment).not.toMatch(/ya tenés acceso completo/iu);
  });

  it('está versionado como v2 y el generado coincide con la fuente', () => {
    expect(STUDYX_AGENT_A_CANONICAL_PROMPT_VERSION).toBe('studyx-agent-a-canonical-v9');
    expect(STUDYX_AGENT_A_CANONICAL_PROMPT).toBe(source);
  });

  // P1 · P3
  it('pide los cuatro campos del contrato y ninguno más', () => {
    for (const term of [/ciudad/iu, /zip\s*code/iu, /c[oó]digo postal/iu, /nombre completo/iu]) {
      expect(source).not.toMatch(term);
    }
    for (const field of ['nombre', 'apellido', 'correo', 'teléfono']) {
      expect(source.toLowerCase()).toContain(field);
    }
  });

  // P2
  it('dice que curso y plan vienen del estado canónico', () => {
    expect(source).toMatch(/curso y el plan no se piden/iu);
  });

  // P4 · P5
  it('no contiene las dos promesas eliminadas', () => {
    expect(source).not.toContain('preinscripción cargada');
    expect(source).not.toContain('alta académica y genero');
    expect(source).not.toContain('credenciales de acceso');
  });

  // P6
  it('contiene el copy autorizado, palabra por palabra', () => {
    expect(source).toContain(
      'Registré tus datos. Cuando informes el pago, el equipo lo revisará '
      + 'y, si está acreditado, gestionará tu acceso.',
    );
  });

  // P8 · P9
  it('mantiene los tres planes y el tope de dos ofertas', () => {
    for (const plan of ['monthly_12', 'monthly_6', 'one_time']) {
      expect(source).toContain(plan);
    }
    expect(source).toMatch(/m[áa]ximo 2 ofrecimientos|nunca m[áa]s de dos/iu);
  });

  it('prioriza la invitación inicial y distingue el link de pago autorizado de otras URL', () => {
    const diagnosis = source.slice(source.indexOf('### FASE 2'), source.indexOf('### POLÍTICA DE LLAMADA'));
    const callPolicy = source.slice(source.indexOf('### POLÍTICA DE LLAMADA'), source.indexOf('### FASE 3'));
    const never = source.slice(source.indexOf('**NUNCA:**'), source.indexOf('**SIEMPRE:**'));

    expect(diagnosis).toMatch(/después de ofrecer la llamada/iu);
    expect(diagnosis).toMatch(/no la mezcles con la invitación/iu);
    expect(callPolicy).toMatch(/antes del diagnóstico, los datos y el cierre por chat/iu);
    expect(callPolicy).toMatch(/sin preguntas de diagnóstico, datos o pago en ese mismo turno/iu);
    expect(never).not.toContain('links de cualquier tipo');
    expect(never).toMatch(/link de pago autorizado.*backend/iu);
  });

  it('conserva las fases de presentación y precio dentro del límite de mensajes del cerebro', () => {
    const presentation = source.slice(source.indexOf('### FASE 3'), source.indexOf('### FASE 4'));
    const pricing = source.slice(source.indexOf('### FASE 4'), source.indexOf('### FASE 5'));
    expect(presentation).not.toContain('Tres mensajes cortos');
    expect(presentation).toMatch(/tres aspectos[\s\S]*máximo de dos mensajes/iu);
    expect(pricing).not.toContain('(4 mensajes cortos)');
    expect(pricing).toMatch(/secuencia[\s\S]*máximo de dos mensajes/iu);
  });

  // P10
  it('no ordena entregar campus, usuario, contraseña ni credenciales', () => {
    expect(source).not.toMatch(/mand[áa].{0,40}link al campus/iu);
    expect(source).not.toMatch(/usuario \+ contrase/iu);
    expect(source).not.toMatch(/video tutorial/iu);
  });

  // P11 · entregas
  it('no ordena mandar PDF, archivo ni link de programa', () => {
    expect(source).not.toMatch(/\bPDF\b/u);
    expect(source).not.toMatch(/mand[áa] el (?:archivo|programa)/iu);
  });

  // P11 · plazos y seguimiento
  it('no promete plazos ni mensajes futuros que no puede ejecutar', () => {
    for (const term of [
      /\{\{PLAZO_CONCRETO\}\}/u,
      /te escribo (?:antes|el|en|ma[ñn]ana)/iu,
      /d[áa] un plazo concreto/iu,
      /te llamo \d+ minutos/iu,
      /seguimiento en 24\s*h/iu,
      /lo verifico y te digo/iu,
      /ofrecé llamada inmediata/iu,
    ]) {
      expect(source).not.toMatch(term);
    }
  });

  it('contiene el único reemplazo autorizado para el contenido del programa', () => {
    expect(source).toContain('Puedo contarte el contenido del programa por acá.');
  });

  // § 08 — la contradicción de hoy convertida en gate permanente.
  //
  // El gate mide lo que el prompt ORDENA. Una viñeta bajo «**NUNCA:**» no
  // ordena: prohíbe. Escanearla en aislamiento la lee al revés, porque la
  // negación vive en el encabezado del bloque y no en la línea.
  //
  // Excluir esas líneas no puede esconder nada mientras el test de abajo
  // exija que el bloque de prohibiciones siga conteniéndolas: si alguien
  // borra la prohibición para pasar el gate, ese test falla.
  function instructionLines(markdown: string): { line: string; number: number }[] {
    const rows: { line: string; number: number }[] = [];
    let prohibiting = false;
    markdown.split('\n').forEach((line, index) => {
      if (/^\*\*NUNCA:\*\*/u.test(line.trim())) { prohibiting = true; return; }
      if (/^\*\*[A-ZÁÉÍÓÚÑ]+:?\*\*/u.test(line.trim()) && !/^\*\*NUNCA/u.test(line.trim())) {
        prohibiting = false;
      }
      if (prohibiting && line.trim().startsWith('-')) return;
      rows.push({ line, number: index + 1 });
    });
    return rows;
  }

  it('el bloque de prohibiciones sigue prohibiendo lo que V5 bloquea', () => {
    // Contrapeso del filtro de arriba. Sin este test, borrar la prohibición
    // haría pasar el gate.
    const nunca = source.slice(source.indexOf('**NUNCA:**'), source.indexOf('**SIEMPRE:**'));
    expect(nunca).toMatch(/pago fue verificado, acreditado o confirmado/iu);
    expect(nunca).toMatch(/inscripci[óo]n, matr[íi]cula o preinscripci[óo]n qued[óo] cargada/iu);
    expect(nunca).toMatch(/acceso, campus, usuario, contrase[ñn]a, credenciales/iu);
    expect(nunca).toMatch(/llamada, un plazo, un horario, un archivo o un mensaje futuro/iu);
  });

  it('ninguna línea del prompt ordena algo que V5 bloquearía', () => {
    // Se evalúa con el estado MÁS permisivo posible: lo que cae acá cae
    // siempre, porque son los hitos externos que ningún turno puede
    // establecer.
    const todoMaterializado = materializeStateFactsV1({
      intake: {
        nombre: 'Ana', apellido: 'Pérez',
        correo: 'ana@example.com', telefono: '+15551234567',
      },
      planned_payment_reported: true,
    });
    const offending = instructionLines(source)
      .filter(({ line }) => unsupportedOperationalAssertionsV1(line, todoMaterializado).length > 0)
      .map((o) => `${o.number}: ${o.line.trim()}`);

    expect(offending).toEqual([]);
  });
});
