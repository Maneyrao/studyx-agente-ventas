import { z } from 'zod';
import {
  CALL_CONTEXT_FIELDS,
  CallContextV1Schema,
  hashCallContext,
  sanitizeContextForReceipt,
  type CallContextV1,
} from './call-context';

export const ContextLoadAckV1Schema = z.object({
  schema_version: z.literal(1),
  event: z.literal('context_loaded'),
  call_id: z.string().uuid(),
  context_hash: z.string().regex(/^[a-f0-9]{64}$/),
  received_fields: z.array(z.enum(CALL_CONTEXT_FIELDS)),
  missing_fields: z.array(z.enum(CALL_CONTEXT_FIELDS)),
  status: z.enum(['accepted', 'rejected']),
  loaded_at: z.string().datetime({ offset: true }),
  error_code: z.enum([
    'CONTEXT_SCHEMA_INVALID',
    'CONTEXT_HASH_MISMATCH',
    'CONTEXT_REQUIRED_FIELD_MISSING',
  ]).optional(),
}).strict();

export type ContextLoadAckV1 = z.infer<typeof ContextLoadAckV1Schema>;
export type ContextVerdict = 'correct' | 'incorrect';

function objectRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function buildContextLoadAck(
  rawContext: unknown,
  expectedHash: string,
  loadedAt: string,
): ContextLoadAckV1 {
  const record = objectRecord(rawContext);
  const receivedFields = CALL_CONTEXT_FIELDS.filter((field) => Object.hasOwn(record, field));
  const missingFields = CALL_CONTEXT_FIELDS.filter((field) => !Object.hasOwn(record, field));
  const parsed = CallContextV1Schema.safeParse(rawContext);
  const fallbackCallId = z.string().uuid().safeParse(record.call_id);

  if (!parsed.success) {
    return ContextLoadAckV1Schema.parse({
      schema_version: 1,
      event: 'context_loaded',
      call_id: fallbackCallId.success ? fallbackCallId.data : '00000000-0000-4000-8000-000000000000',
      context_hash: /^[a-f0-9]{64}$/.test(expectedHash) ? expectedHash : '0'.repeat(64),
      received_fields: receivedFields,
      missing_fields: missingFields,
      status: 'rejected',
      loaded_at: loadedAt,
      error_code: missingFields.length > 0
        ? 'CONTEXT_REQUIRED_FIELD_MISSING'
        : 'CONTEXT_SCHEMA_INVALID',
    });
  }

  const actualHash = hashCallContext(parsed.data);
  const hashMatches = actualHash === expectedHash;
  return ContextLoadAckV1Schema.parse({
    schema_version: 1,
    event: 'context_loaded',
    call_id: parsed.data.call_id,
    context_hash: actualHash,
    received_fields: receivedFields,
    missing_fields: missingFields,
    status: hashMatches ? 'accepted' : 'rejected',
    loaded_at: loadedAt,
    ...(hashMatches ? {} : { error_code: 'CONTEXT_HASH_MISMATCH' as const }),
  });
}

function displayed(value: string): string {
  return value.length > 0 ? value : 'no informado';
}

export function buildTelegramContextReceipt(
  context: CallContextV1,
  ack: ContextLoadAckV1,
): string {
  const safe = sanitizeContextForReceipt(context);
  return [
    '🧪 SMOKE A → B',
    '',
    `Call ID: ${safe.call_id.slice(0, 8)}`,
    `Nombre: ${displayed(safe.nombre_lead)}`,
    `Curso: ${displayed(safe.curso_interes)}`,
    `País: ${displayed(safe.pais)}`,
    `Resumen: ${displayed(safe.resumen_whatsapp)}`,
    `Campos recibidos: ${ack.received_fields.length}/${CALL_CONTEXT_FIELDS.length}`,
    `Hash: ${ack.context_hash.slice(0, 12)}`,
  ].join('\n');
}

export function encodeContextVerdictCallback(nonce: string, verdict: ContextVerdict): string {
  if (!/^[A-Za-z0-9_-]{8,32}$/.test(nonce)) throw new Error('INVALID_CALLBACK_NONCE');
  const value = `bctx:${nonce}:${verdict === 'correct' ? 'ok' : 'bad'}`;
  if (Buffer.byteLength(value, 'utf8') > 64) throw new Error('CALLBACK_DATA_TOO_LONG');
  return value;
}

export function decodeContextVerdictCallback(value: string): { nonce: string; verdict: ContextVerdict } | null {
  const match = /^bctx:([A-Za-z0-9_-]{8,32}):(ok|bad)$/.exec(value);
  if (!match) return null;
  return { nonce: match[1], verdict: match[2] === 'ok' ? 'correct' : 'incorrect' };
}
