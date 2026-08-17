import { createHash } from 'node:crypto';
import { z } from 'zod';

export const CALL_CONTEXT_FIELDS = [
  'call_id',
  'nombre_lead',
  'curso_interes',
  'pais',
  'email_lead',
  'resumen_whatsapp',
  'prompt_version',
] as const;

export const CallContextV1Schema = z.object({
  call_id: z.string().uuid(),
  nombre_lead: z.string().max(128),
  curso_interes: z.string().max(128),
  pais: z.string().max(128),
  email_lead: z.string().max(254),
  resumen_whatsapp: z.string().max(1_200),
  prompt_version: z.string().min(1).max(128),
}).strict();

export type CallContextV1 = z.infer<typeof CallContextV1Schema>;

export function parseCallContext(value: unknown): CallContextV1 {
  return CallContextV1Schema.parse(value);
}

export function canonicalizeCallContext(value: unknown): string {
  const context = parseCallContext(value);
  const canonical: CallContextV1 = {
    call_id: context.call_id,
    nombre_lead: context.nombre_lead,
    curso_interes: context.curso_interes,
    pais: context.pais,
    email_lead: context.email_lead,
    resumen_whatsapp: context.resumen_whatsapp,
    prompt_version: context.prompt_version,
  };
  return JSON.stringify(canonical);
}

export function hashCallContext(value: unknown): string {
  return createHash('sha256').update(canonicalizeCallContext(value), 'utf8').digest('hex');
}

function sanitizeDisplayValue(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Sanitization is presentation-only. Hashing always uses the exact validated
 * transport values, so a renderer cannot hide a transport mismatch.
 */
export function sanitizeContextForReceipt(context: CallContextV1): CallContextV1 {
  return {
    call_id: context.call_id,
    nombre_lead: sanitizeDisplayValue(context.nombre_lead),
    curso_interes: sanitizeDisplayValue(context.curso_interes),
    pais: sanitizeDisplayValue(context.pais),
    email_lead: sanitizeDisplayValue(context.email_lead),
    resumen_whatsapp: sanitizeDisplayValue(context.resumen_whatsapp),
    prompt_version: sanitizeDisplayValue(context.prompt_version),
  };
}
