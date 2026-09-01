import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const specPath = fileURLToPath(new URL(
  '../../../docs/architecture/2026-09-01-frontera-de-autoridad-agente-a.md',
  import.meta.url,
));

const spec = existsSync(specPath) ? readFileSync(specPath, 'utf8') : '';

/**
 * Las diecisiete tareas del plan de ejecución citan reglas por identificador
 * —A9, V5, O1–O3, P6, P11—. Un plan que cita una regla que el documento
 * normativo no define es un plan que no se puede ejecutar: el ejecutor lee
 * «cumplí O2» y no tiene dónde averiguar qué es O2.
 *
 * Este test es lo que garantiza que la fuente normativa está completa antes
 * de que alguien construya contra ella.
 */
const AUTHORITY = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9'];
const VALIDATION = ['V1', 'V2', 'V3', 'V4', 'V5', 'V6', 'V7', 'V8'];
const ORDERING = ['O1', 'O2', 'O3'];
const PROMPT = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9', 'P10', 'P11'];
const DECISIONS = ['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6'];
const ROLLBACK = ['R1', 'R2', 'R3', 'R4', 'R5', 'R6'];
const SECTIONS = [
  '01', '02', '03', '04', '05', '05b', '06', '07',
  '08', '09', '10', '11', '12', '13', '14',
];

describe('la especificación aprobada vive en el repositorio', () => {
  it('el documento existe', () => {
    expect(existsSync(specPath)).toBe(true);
  });

  it.each([
    ['autoridad', AUTHORITY],
    ['validación', VALIDATION],
    ['orden', ORDERING],
    ['prompt', PROMPT],
    ['decisiones', DECISIONS],
    ['rollback', ROLLBACK],
  ])('define todas las reglas de %s', (_group, rules) => {
    const missing = rules.filter((rule) => !new RegExp(`\\b${rule}\\b`, 'u').test(spec));
    expect(missing).toEqual([]);
  });

  it('define las quince secciones', () => {
    const missing = SECTIONS.filter((section) => !new RegExp(`§\\s?${section}\\b`, 'u').test(spec));
    expect(missing).toEqual([]);
  });

  it('fija el contrato de seis datos y ninguno más', () => {
    for (const field of ['nombre', 'apellido', 'correo', 'teléfono', 'curso', 'plan']) {
      expect(spec.toLowerCase()).toContain(field);
    }
    // El documento normativo no puede nombrar los campos prohibidos ni
    // siquiera para prohibirlos: el guard de T0.4 excluye `docs/architecture`
    // del barrido, así que una mención acá no se detectaría en ningún lado.
    expect(spec).not.toMatch(/\bzip\b|c[oó]digo postal/iu);
  });

  it('fija los textos aprobados palabra por palabra', () => {
    expect(spec).toContain(
      'Registré tus datos. Cuando informes el pago, el equipo lo revisará '
      + 'y, si está acreditado, gestionará tu acceso.',
    );
    expect(spec).toContain(
      'Recibí tu mensaje, pero tuve una demora para procesarlo. '
      + 'Probá nuevamente en unos segundos.',
    );
    expect(spec).toContain(
      'Sigo teniendo un inconveniente para procesar tu consulta. '
      + 'Dejé registrada la conversación para revisión.',
    );
    expect(spec).toContain('Puedo contarte el contenido del programa por acá.');
  });

  it('distingue pago informado de pago verificado', () => {
    expect(spec).toMatch(/payment_reported\s*≠\s*payment_verified/u);
  });
});
