import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

/**
 * El contrato comercial congelado tiene seis datos: nombre, apellido, correo,
 * teléfono, curso y plan. Ciudad, estado y ZIP no están.
 *
 * Este guard recorre artefactos en vez de un archivo porque el defecto estaba
 * repartido en cinco categorías —prompt canónico, dos prompts más, un fallback
 * del backend, dos fixtures y dos tests que lo afirmaban como conducta
 * esperada— y arreglar una sola deja el contrato roto en las otras cuatro.
 */
const FORBIDDEN = [
  { name: 'ciudad', pattern: 'ciudad' },
  { name: 'ZIP', pattern: 'zip[ _]?code|\\bZIP\\b' },
  { name: 'código postal', pattern: 'c[oó]digo postal' },
  { name: 'nombre completo', pattern: 'nombre completo|full name' },
];

/**
 * Inspecciona ÚNICAMENTE artefactos activos del Agente A: lo que llega al
 * modelo, lo que el backend puede decir, y los datos con que se lo evalúa.
 *
 * Es una lista de inclusión y no de exclusión, por una razón concreta: una
 * lista de exclusión deja pasar cualquier archivo nuevo por omisión, y este
 * defecto entró precisamente por archivos que nadie estaba mirando.
 *
 * Documentación y tests quedan fuera a propósito. Tienen que poder NOMBRAR los
 * campos para prohibirlos: una prohibición que no puede nombrar lo que prohíbe
 * obliga a adivinar, y adivinar es cómo volvieron a entrar. Un test que afirma
 * «el modelo no produce esta cadena» necesita la cadena.
 */
const ACTIVE_AGENT_A_ARTIFACTS = [
  'docs/prompts/',
  'botpress-agent/src/prompts/',
  'botpress-agent/src/lib/conversation/',
  'botpress-agent/src/workflows/',
  'botpress-agent/evals/personas/',
  'src/features/conversation/',
  'src/lib/services/',
];

// Retell está fuera de alcance por § 01 de la especificación. No aparece en la
// lista de arriba a propósito, y va escrito para que sea una decisión visible y
// no un olvido: el archivo contiene ciudad y ZIP y NO se corrige en este
// trabajo. Cuando Retell entre en alcance, se agrega su ruta y el archivo
// aparece solo en la lista de fallos.

function hits(pattern: string): string[] {
  try {
    return execFileSync(
      'git',
      // -P y no -E: `git grep -E` usa ERE POSIX, donde `\b` no existe y se
      // interpreta literalmente. Con -E este guard no veía `agent-a-sales-bridge.ts`
      // ni los fixtures, que es exactamente el fallo silencioso que un guard
      // no puede tener. -i porque «Ciudad» y «ciudad» son el mismo defecto.
      ['grep', '-nIiP', pattern, '--', ...ACTIVE_AGENT_A_ARTIFACTS],
      { encoding: 'utf8' },
    ).trim().split('\n').filter(Boolean);
  } catch {
    return []; // git grep sale con 1 cuando no hay coincidencias
  }
}

describe('el intake es de seis campos en todo artefacto activo del Agente A', () => {
  for (const { name, pattern } of FORBIDDEN) {
    it(`no existe «${name}» en ningún prompt, fallback, fixture ni contrato activo`, () => {
      expect(hits(pattern)).toEqual([]);
    });
  }

  it('la lista de artefactos activos alcanza el módulo generado del prompt', () => {
    // El generado es derivado, pero si el generador corrió con una fuente
    // sucia hay que enterarse acá y no en producción. Este test fija que la
    // ruta sigue dentro del barrido, para que mover el archivo no lo saque en
    // silencio.
    expect(hits('STUDYX_AGENT_A_CANONICAL_PROMPT_VERSION').length).toBeGreaterThan(0);
  });
});
