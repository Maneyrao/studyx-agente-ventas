import { z } from '@botpress/runtime'

export const CallEventProviderSchema = z.enum(['telegram_sandbox', 'retell'])

export const CallEventTypeSchema = z.enum(['requested', 'started', 'ended', 'analyzed'])

export const CallEndReasonSchema = z.enum([
  'user_hangup',
  'agent_hangup',
  'no_answer',
  'busy',
  'failed_to_connect',
  'voicemail',
  'timed_out',
  'other',
])

export const CallResultSchema = z.enum([
  'venta_confirmada',
  'link_enviado_sin_pago',
  'seguimiento_agendado',
  'no_interesado',
  'derivado_humano',
  'no_es_buen_momento',
  'no_contactar',
  'ya_es_alumno',
  'no_calificado',
])

export const CallRequestedPayloadSchema = z.object({
  event_type: z.literal('requested'),
  contact_id: z.string().uuid(),
  conversation_id: z.string().uuid(),
  reason: z.string().min(1).max(512),
  course_of_interest: z.string().min(1).max(128).nullable().default(null),
  previous_summary: z.string().max(4096).nullable().default(null),
}).strict()

export const CallStartedPayloadSchema = z.object({
  event_type: z.literal('started'),
  started_at: z.string().datetime({ offset: true }),
}).strict()

export const CallEndedPayloadSchema = z.object({
  event_type: z.literal('ended'),
  ended_at: z.string().datetime({ offset: true }),
  duration_seconds: z.number().int().nonnegative(),
  disconnection_reason: CallEndReasonSchema,
}).strict()

export const CallAnalysisSchema = z.object({
  result: CallResultSchema,
  nivel_interes: z.enum(['alto', 'medio', 'bajo']).nullable().default(null),
  objecion: z.string().max(512).nullable().default(null),
  notas: z.string().max(4096).nullable().default(null),
}).strict()

export const CallAnalyzedPayloadSchema = z.object({
  event_type: z.literal('analyzed'),
  analysis: CallAnalysisSchema,
}).strict()

export const CallEventPayloadSchema = z.discriminatedUnion('event_type', [
  CallRequestedPayloadSchema,
  CallStartedPayloadSchema,
  CallEndedPayloadSchema,
  CallAnalyzedPayloadSchema,
])

export const CallEventSchema = z.object({
  schema_version: z.literal(1),
  event_id: z.string().min(1).max(512),
  call_id: z.string().uuid(),
  event_type: CallEventTypeSchema,
  sequence: z.number().int().nonnegative(),
  occurred_at: z.string().datetime({ offset: true }),
  provider: CallEventProviderSchema,
  payload: CallEventPayloadSchema,
}).strict().superRefine((event, context) => {
  if (event.event_type !== event.payload.event_type) {
    context.addIssue({
      code: 'custom',
      message: 'EVENT_TYPE_PAYLOAD_MISMATCH',
      path: ['payload', 'event_type'],
    })
  }
})

export type CallEventProvider = z.infer<typeof CallEventProviderSchema>
export type CallEventType = z.infer<typeof CallEventTypeSchema>
export type CallEndReason = z.infer<typeof CallEndReasonSchema>
export type CallResult = z.infer<typeof CallResultSchema>
export type CallAnalysis = z.infer<typeof CallAnalysisSchema>
export type CallEvent = z.infer<typeof CallEventSchema>
