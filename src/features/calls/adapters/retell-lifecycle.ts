import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import {
  CallEventSchema,
  CallResultSchema,
  type CallEndReason,
  type CallEvent,
} from '@/lib/contracts/call-event';
import type { RetellCorrelationMetadata } from '../ports/retell-call-correlation-store';

const RETELL_SIGNATURE_TOLERANCE_MS = 5 * 60 * 1_000;
const ProviderTimestampSchema = z.number().int().nonnegative().max(8_640_000_000_000_000);

const RetellMetadataSchema = z.object({
  internal_call_id: z.string().uuid().optional(),
  contact_id: z.string().uuid().optional(),
  conversation_id: z.string().uuid().optional(),
}).passthrough().superRefine((metadata, context) => {
  const present = [metadata.internal_call_id, metadata.contact_id, metadata.conversation_id]
    .filter((value) => value !== undefined).length;
  if (present !== 0 && present !== 3) {
    context.addIssue({ code: 'custom', message: 'INCOMPLETE_RETELL_CORRELATION_METADATA' });
  }
});

const RetellCallBaseSchema = z.object({
  call_id: z.string().trim().min(1).max(512),
  metadata: RetellMetadataSchema.optional(),
}).passthrough();

const RetellStartedWebhookSchema = z.object({
  event: z.literal('call_started'),
  call: RetellCallBaseSchema.extend({
    start_timestamp: ProviderTimestampSchema,
  }),
}).strict();

const RetellEndedWebhookSchema = z.object({
  event: z.literal('call_ended'),
  call: RetellCallBaseSchema.extend({
    start_timestamp: ProviderTimestampSchema.optional(),
    end_timestamp: ProviderTimestampSchema,
    disconnection_reason: z.string().trim().min(1).max(128),
  }),
}).strict();

const RetellAnalysisDataSchema = z.object({
  resultado: CallResultSchema,
  nivel_interes: z.enum(['alto', 'medio', 'bajo', 'nulo']).optional().nullable(),
  curso_ofrecido: z.string().trim().min(1).max(256).optional().nullable(),
  precio_ofrecido: z.string().trim().min(1).max(256).optional().nullable(),
  objecion_principal: z.enum([
    'precio', 'tiempo', 'confianza', 'capacidad_propia', 'consultar_con_tercero',
    'comparando_opciones', 'conectividad_o_dispositivo', 'timing', 'otra', 'ninguna',
  ]).optional().nullable(),
  email_capturado: z.string().trim().max(254).email().optional().nullable(),
  link_pago_enviado: z.boolean().optional(),
  pago_confirmado: z.boolean().optional(),
  pidio_humano: z.boolean().optional(),
  pidio_no_contactar: z.boolean().optional(),
  pregunto_si_es_ia: z.boolean().optional(),
  compromiso_pendiente: z.string().trim().min(1).max(1024).optional().nullable(),
}).passthrough();

const RetellAnalyzedWebhookSchema = z.object({
  event: z.literal('call_analyzed'),
  call: RetellCallBaseSchema.extend({
    end_timestamp: ProviderTimestampSchema,
    call_analysis: z.object({
      call_summary: z.string().trim().min(1).max(4096).optional().nullable(),
      user_sentiment: z.enum(['positive', 'neutral', 'negative']).optional().nullable(),
      custom_analysis_data: RetellAnalysisDataSchema,
    }).passthrough(),
  }),
}).strict();

export const RetellLifecycleWebhookSchema = z.discriminatedUnion('event', [
  RetellStartedWebhookSchema,
  RetellEndedWebhookSchema,
  RetellAnalyzedWebhookSchema,
]);

export type RetellLifecycleWebhook = z.infer<typeof RetellLifecycleWebhookSchema>;

export function verifyRetellSignature(input: {
  readonly rawBody: string | Uint8Array;
  readonly signature: string | null;
  readonly apiKey: string;
  readonly nowMs?: number;
}): boolean {
  if (!input.signature || input.apiKey.length === 0) return false;
  const match = /^v=(\d+),d=([0-9a-f]{64})$/u.exec(input.signature);
  if (!match) return false;
  const timestamp = Number(match[1]);
  const now = input.nowMs ?? Date.now();
  if (!Number.isSafeInteger(timestamp) || Math.abs(now - timestamp) > RETELL_SIGNATURE_TOLERANCE_MS) {
    return false;
  }

  const expected = createHmac('sha256', input.apiKey)
    .update(input.rawBody)
    .update(match[1], 'utf8')
    .digest();
  const actual = Buffer.from(match[2], 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function retellCorrelationMetadata(
  webhook: RetellLifecycleWebhook,
): RetellCorrelationMetadata | null {
  const metadata = webhook.call.metadata;
  if (!metadata?.internal_call_id || !metadata.contact_id || !metadata.conversation_id) return null;
  return {
    internalCallId: metadata.internal_call_id,
    contactId: metadata.contact_id,
    conversationId: metadata.conversation_id,
  };
}

const FAILED_TO_CONNECT_REASONS = new Set([
  'concurrency_limit_reached',
  'no_valid_payment',
  'scam_detected',
  'dial_failed',
  'invalid_destination',
  'telephony_provider_permission_denied',
  'telephony_provider_unavailable',
  'sip_routing_error',
  'marked_as_spam',
  'error_llm_websocket_open',
  'error_llm_websocket_lost_connection',
  'error_llm_websocket_runtime',
  'error_llm_websocket_corrupt_payload',
  'error_no_audio_received',
  'error_asr',
  'error_retell',
  'error_unknown',
  'error_user_not_joined',
  'registered_call_timeout',
]);

export function mapRetellDisconnectionReason(reason: string): CallEndReason {
  if (reason === 'user_hangup') return 'user_hangup';
  if (reason === 'agent_hangup' || reason === 'manual_stopped') return 'agent_hangup';
  if (reason === 'dial_busy') return 'busy';
  if (reason === 'dial_no_answer' || reason === 'user_declined') return 'no_answer';
  if (reason === 'voicemail_reached') return 'voicemail';
  if (reason === 'inactivity' || reason === 'max_duration_reached') {
    return 'timed_out';
  }
  if (FAILED_TO_CONNECT_REASONS.has(reason)) return 'failed_to_connect';
  return 'other';
}

function providerIso(timestamp: number): string {
  return new Date(timestamp).toISOString();
}

export function mapRetellLifecycleEvent(raw: unknown, internalCallId: string): CallEvent {
  const webhook = RetellLifecycleWebhookSchema.parse(raw);
  const base = {
    schema_version: 1 as const,
    event_id: `retell:${webhook.event}:${webhook.call.call_id}`,
    call_id: internalCallId,
    provider: 'retell' as const,
  };

  if (webhook.event === 'call_started') {
    const occurredAt = providerIso(webhook.call.start_timestamp);
    return CallEventSchema.parse({
      ...base,
      event_type: 'started',
      sequence: 1,
      occurred_at: occurredAt,
      payload: { event_type: 'started', started_at: occurredAt },
    });
  }

  if (webhook.event === 'call_ended') {
    const occurredAt = providerIso(webhook.call.end_timestamp);
    const durationSeconds = webhook.call.start_timestamp === undefined
      ? 0
      : Math.max(0, Math.floor((webhook.call.end_timestamp - webhook.call.start_timestamp) / 1_000));
    return CallEventSchema.parse({
      ...base,
      event_type: 'ended',
      sequence: 2,
      occurred_at: occurredAt,
      payload: {
        event_type: 'ended',
        ended_at: occurredAt,
        duration_seconds: durationSeconds,
        disconnection_reason: mapRetellDisconnectionReason(webhook.call.disconnection_reason),
      },
    });
  }

  const custom = webhook.call.call_analysis.custom_analysis_data;
  const occurredAt = providerIso(webhook.call.end_timestamp);
  const hasExtendedAnalysis = custom.link_pago_enviado !== undefined
    || custom.pago_confirmado !== undefined
    || custom.pidio_humano !== undefined
    || custom.pidio_no_contactar !== undefined
    || custom.pregunto_si_es_ia !== undefined;
  const analysis = {
    result: custom.resultado,
    nivel_interes: custom.nivel_interes === 'nulo' ? null : (custom.nivel_interes ?? null),
    objecion: custom.objecion_principal ?? null,
    notas: webhook.call.call_analysis.call_summary ?? null,
    ...(hasExtendedAnalysis ? {
      resultado: custom.resultado,
      ...(webhook.call.call_analysis.call_summary === undefined || webhook.call.call_analysis.call_summary === null
        ? {} : { call_summary: webhook.call.call_analysis.call_summary }),
      ...(webhook.call.call_analysis.user_sentiment === undefined || webhook.call.call_analysis.user_sentiment === null
        ? {} : { user_sentiment: webhook.call.call_analysis.user_sentiment }),
      ...(custom.curso_ofrecido === undefined || custom.curso_ofrecido === null
        ? {} : { curso_ofrecido: custom.curso_ofrecido }),
      ...(custom.precio_ofrecido === undefined || custom.precio_ofrecido === null
        ? {} : { precio_ofrecido: custom.precio_ofrecido }),
      ...(custom.objecion_principal === undefined || custom.objecion_principal === null
        ? {} : { objecion_principal: custom.objecion_principal }),
      ...(custom.nivel_interes === undefined || custom.nivel_interes === null
        ? {} : { nivel_interes: custom.nivel_interes }),
      ...(custom.email_capturado === undefined || custom.email_capturado === null
        ? {} : { email_capturado: custom.email_capturado }),
      ...(custom.link_pago_enviado === undefined ? {} : { link_pago_enviado: custom.link_pago_enviado }),
      ...(custom.pago_confirmado === undefined ? {} : { pago_confirmado: custom.pago_confirmado }),
      ...(custom.pidio_humano === undefined ? {} : { pidio_humano: custom.pidio_humano }),
      ...(custom.pidio_no_contactar === undefined ? {} : { pidio_no_contactar: custom.pidio_no_contactar }),
      ...(custom.pregunto_si_es_ia === undefined ? {} : { pregunto_si_es_ia: custom.pregunto_si_es_ia }),
      ...(custom.compromiso_pendiente === undefined || custom.compromiso_pendiente === null
        ? {} : { compromiso_pendiente: custom.compromiso_pendiente }),
    } : {}),
  };
  return CallEventSchema.parse({
    ...base,
    event_type: 'analyzed',
    sequence: 3,
    occurred_at: occurredAt,
    payload: {
      event_type: 'analyzed',
      analysis,
    },
  });
}
