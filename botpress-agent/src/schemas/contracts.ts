import { z } from '@botpress/runtime'

export const SourceSchema = z.literal('botpress')
export const ChannelSchema = z.enum(['emulator', 'whatsapp'])
export const MessageTypeSchema = z.enum(['text', 'audio', 'image', 'unsupported'])

export const AudioReferenceSchema = z.object({
  provider_file_id: z.string().min(1).max(512),
  mime_type: z.string().min(1).max(128),
  duration_seconds: z.number().int().nonnegative().nullable().default(null),
  transcription_status: z.enum(['ok', 'failed', 'skipped']),
  transcription_provider: z.string().min(1).max(64).nullable().default(null),
}).strict()

export const MessageMetadataSchema = z.record(
  z.string().max(64),
  z.union([z.string().max(512), z.number(), z.boolean()])
)

export const MessageSchema = z.object({
  type: MessageTypeSchema,
  text: z.string().min(1).max(4096),
  occurred_at: z.string().min(1),
  reply_to_external_message_id: z.string().min(1).max(512).nullable().default(null),
  audio_reference: AudioReferenceSchema.nullable().default(null),
  metadata: MessageMetadataSchema.default({}),
})

export const SandboxProviderSchema = z.enum(['telegram_sandbox'])

export const InboundEnvelopeSchema = z.object({
  schema_version: z.literal(1),
  source: SourceSchema,
  channel: ChannelSchema,
  integration_id: z.string().min(1).max(512),
  external_message_id: z.string().min(1).max(512),
  provider_message_id: z.string().min(1).max(512).optional(),
  external_conversation_id: z.string().min(1).max(512),
  external_user_id: z.string().min(1).max(512),
  phone_e164: z.string().min(8).max(16).optional(),
  trace_id: z.string().uuid(),
  message: MessageSchema,
  // When set, the backend treats this envelope as belonging to a sandbox provider
  // for idempotency (channel_events/channel_threads UNIQUE(provider, ...)) and for
  // the real-side-effect lock. `channel` stays 'whatsapp' so the entire code path
  // is identical to production WhatsApp — only the provider label changes.
  sandbox_provider: SandboxProviderSchema.nullable().default(null),
})

export type AudioReference = z.infer<typeof AudioReferenceSchema>
export type MessageMetadata = z.infer<typeof MessageMetadataSchema>
export type InboundMessage = z.infer<typeof MessageSchema>
export type InboundEnvelope = z.infer<typeof InboundEnvelopeSchema>

export const ResponseTypeSchema = z.enum([
  'social_reply',
  'commercial_reply',
  'clarification',
  'complaint_ack',
  'automation_only',
  'opt_out_ack',
  'out_of_scope',
  'technical_fallback',
])

export const MemoryCandidateSchema = z.object({
  type: z.string().min(1).max(128),
  key: z.string().min(1).max(128),
  value: z.string().min(1).max(4096),
  source_quote: z.string().min(1).max(4096),
  confidence: z.number().min(0).max(1),
}).strict()

export const DecisionSchema = z.object({
  schema_version: z.literal(2),
  intent: z.enum([
    'social',
    'commercial',
    'commercial_decline',
    'complaint',
    'human_request',
    'opt_out',
    'out_of_scope',
    'unknown',
  ]),
  kind: z.enum(['reply', 'clarify', 'suppress']),
  response: z.string().min(1).max(4096).nullable(),
  response_type: ResponseTypeSchema.nullable(),
  confidence: z.number().min(0).max(1),
  reason_code: z.string().min(1).max(128),
  business_action: z.null(),
  memory_candidates: z.array(MemoryCandidateSchema).max(20),
  missing_information: z.array(z.string().min(1).max(128)).max(20),
  next_state: z.enum(['completed', 'waiting_user']),
}).strict().superRefine((decision, context) => {
  if (
    decision.kind === 'suppress'
    && (
      decision.response !== null
      || decision.response_type !== null
      || decision.memory_candidates.length > 0
      || decision.missing_information.length > 0
    )
  ) {
    context.addIssue({ code: 'custom', message: 'SUPPRESS_HAS_SIDE_EFFECT' })
  }
  if (
    decision.kind === 'clarify'
    && (
      decision.response === null
      || decision.response_type === null
      || decision.missing_information.length === 0
      || decision.next_state !== 'waiting_user'
    )
  ) {
    context.addIssue({ code: 'custom', message: 'INVALID_CLARIFICATION' })
  }
  if (decision.kind === 'reply' && (decision.response === null || decision.response_type === null)) {
    context.addIssue({ code: 'custom', message: 'REPLY_REQUIRES_RESPONSE' })
  }
  if (
    decision.intent === 'opt_out'
    && (
      decision.response_type !== 'opt_out_ack'
      || decision.memory_candidates.length > 0
      || decision.next_state !== 'completed'
    )
  ) {
    context.addIssue({ code: 'custom', message: 'INVALID_OPT_OUT' })
  }
  if (
    decision.intent === 'human_request'
    && (decision.response_type !== 'automation_only' || decision.next_state !== 'waiting_user')
  ) {
    context.addIssue({ code: 'custom', message: 'INVALID_HUMAN_REQUEST' })
  }
})

export type Decision = z.infer<typeof DecisionSchema>

export const RecentTurnSchema = z.object({
  direction: z.enum(['inbound', 'outbound']),
  content: z.string(),
  created_at: z.string(),
})

export const MemoryItemSchema = z.object({
  content: z.string(),
  similarity: z.number(),
  created_at: z.string(),
})

export const PolicySchema = z.object({
  may_respond: z.boolean(),
  allowed_response_types: z.array(ResponseTypeSchema),
  reason: z.string().nullable().default(null),
})

export const IngestResponseSchema = z.object({
  status: z.enum(['accepted', 'duplicate', 'suppressed']),
  replayed: z.boolean(),
  trace_id: z.string().uuid(),
  turn_id: z.string().uuid(),
  conversation_id: z.string().uuid(),
  policy: PolicySchema,
  contact: z.object({
    id: z.string().uuid(),
    status: z.string(),
    name: z.string().nullable().default(null),
    blocked: z.boolean(),
    consent_status: z.enum(['allowed', 'revoked', 'unknown']),
  }),
  context: z.object({
    recent_turns: z.array(RecentTurnSchema),
    summary: z.string().nullable().default(null),
    long_term_memory: z.array(MemoryItemSchema).nullable().default(null),
    long_term_memory_available: z.boolean(),
  }),
  existing_result: z
    .object({
      decision_id: z.string().uuid().nullable().default(null),
      outbound_id: z.string().uuid().nullable().default(null),
      delivery_status: z.string().nullable().default(null),
      next_state: z.enum(['completed', 'waiting_user']),
    })
    .nullable()
    .default(null),
})

export type IngestResponse = z.infer<typeof IngestResponseSchema>

export const CommitDecisionInputSchema = z.object({
  turn_id: z.string().uuid(),
  trace_id: z.string().uuid(),
  decision: DecisionSchema,
  model: z.object({
    provider: z.literal('botpress'),
    model: z.string().min(1),
    prompt_version: z.string().min(1),
  }),
})

export const CommitDecisionResponseSchema = z.object({
  status: z.enum(['committed', 'duplicate', 'rejected']),
  replayed: z.boolean(),
  trace_id: z.string().uuid(),
  turn_id: z.string().uuid(),
  decision_id: z.string().uuid(),
  next_state: z.enum(['completed', 'waiting_user']),
  outbound: z
    .object({
      id: z.string().uuid(),
      content: z.string().min(1).max(4096),
      status: z.enum(['pending', 'submitted_to_botpress', 'failed']),
    })
    .nullable()
    .default(null),
})

export type CommitDecisionResponse = z.infer<typeof CommitDecisionResponseSchema>

export const DeliveryStatusSchema = z.enum(['submitted_to_botpress', 'failed'])

export const DeliveryReportInputSchema = z.object({
  outbound_id: z.string().uuid(),
  trace_id: z.string().uuid(),
  status: DeliveryStatusSchema,
  botpress_message_id: z.string().min(1).max(512).nullable().default(null),
  replayed: z.boolean().default(false),
  error_code: z.string().min(1).max(128).nullable().default(null),
})

export const DeliveryReportResponseSchema = z.object({
  status: z.enum(['recorded', 'duplicate']),
  replayed: z.boolean(),
  outbound_id: z.string().uuid(),
  delivery_status: DeliveryStatusSchema,
})

export const WorkflowInputSchema = InboundEnvelopeSchema.extend({
  botpress_conversation_id: z.string().min(1).max(512),
  botpress_user_id: z.string().min(1).max(512),
})

export const ProcessingStateSchema = z.enum([
  'received',
  'processing',
  'decision_committed',
  'waiting_user',
  'blocked',
  'retry_pending',
  'paused_error',
  'completed',
])

export const WorkflowResultSchema = z.object({
  status: ProcessingStateSchema,
  trace_id: z.string().uuid(),
  turn_id: z.string().uuid().nullable(),
  decision_id: z.string().uuid().nullable(),
  outbound_id: z.string().uuid().nullable(),
  delivery_status: DeliveryStatusSchema.nullable(),
  error_code: z.string().nullable(),
})

export type WorkflowResult = z.infer<typeof WorkflowResultSchema>
