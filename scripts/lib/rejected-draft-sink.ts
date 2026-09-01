import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/**
 * Observabilidad del rechazo (§ 07, Q3).
 *
 * El borrador rechazado NO entra en `messages` productivos: un texto que el
 * backend decidió no entregar no es una conversación, y guardarlo ahí lo
 * volvería indistinguible de lo que el cliente sí recibió.
 *
 * Artefacto local, sumidero único, gitignored, sin PII ni secretos. El
 * sumidero es único para que mover esto a una tabla con TTL —si la Fase 3 lo
 * justifica— sea un cambio de una línea y no una cacería.
 *
 * Costo aceptado: con la PII redactada no se puede diagnosticar un fallo que
 * dependa del nombre del cliente. Las clases que importan —hechos, precios,
 * promesas, acciones— no dependen de la identidad.
 */

const DEFAULT_SINK = 'artifacts/rejected-drafts/drafts.jsonl';

export interface RejectedDraftV1 {
  readonly rejection_id: string;
  readonly codes: readonly string[];
  readonly subjects: readonly string[];
  readonly authorized_fact_ids: readonly string[];
  readonly draft_text: string;
  readonly repair_level: 'N1' | 'N2' | 'N3';
}

/**
 * Los cuatro campos del intake se redactan ANTES de escribir. No se enmascara
 * el archivo después: un dato que llegó al disco ya se escapó.
 */
export function redactIntakePiiV1(
  text: string,
  intake: { nombre?: string | null; apellido?: string | null; correo?: string | null; telefono?: string | null },
): string {
  let redacted = text;
  const replacements: Array<[string | null | undefined, string]> = [
    [intake.correo, '[correo]'],
    [intake.telefono, '[telefono]'],
    [intake.nombre, '[nombre]'],
    [intake.apellido, '[apellido]'],
  ];
  for (const [value, token] of replacements) {
    const trimmed = (value ?? '').trim();
    if (trimmed.length < 2) continue;
    redacted = redacted.split(trimmed).join(token);
  }
  // Red de seguridad por forma, no por valor: un correo o un teléfono que el
  // modelo inventó no está en `intake` y se escaparía de la pasada de arriba.
  redacted = redacted.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu, '[correo]');
  redacted = redacted.replace(/\+?\d[\d\s().-]{7,}\d/gu, '[telefono]');
  return redacted;
}

export function writeRejectedDraftV1(
  draft: RejectedDraftV1,
  intake: Parameters<typeof redactIntakePiiV1>[1],
  sinkPath: string = DEFAULT_SINK,
): void {
  const target = resolve(process.cwd(), sinkPath);
  mkdirSync(dirname(target), { recursive: true });
  appendFileSync(target, `${JSON.stringify({
    ...draft,
    draft_text: redactIntakePiiV1(draft.draft_text, intake),
    written_at: new Date().toISOString(),
  })}\n`, 'utf8');
}
