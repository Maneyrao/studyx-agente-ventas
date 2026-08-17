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

export const IntentSchema = z.enum([
  'social',
  'commercial',
  'commercial_decline',
  'complaint',
  'human_request',
  'opt_out',
  'out_of_scope',
  'unknown',
])

/**
 * Business actions the backend will accept. `mark_hot_lead` and `log_objection`
 * are purely observational — nothing outside the database changes when one is
 * recorded, so a replay can never double-promise anything.
 *
 * `escalate_to_human` is intentionally absent from the producer schema: there
 * is no human queue in this product, so the agent must never be able to emit
 * one. Next.js refuses it too; this is the local half of a rule validated on
 * both sides, with the backend holding final authority.
 */
export const BusinessActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('mark_hot_lead'), score: z.number().min(0).max(1) }).strict(),
  z.object({
    type: z.literal('log_objection'),
    objection_key: z.string().min(1).max(128),
    quote: z.string().min(1).max(1024),
  }).strict(),
])

export const RetrievalUsedSchema = z.object({
  kb: z.boolean(),
  long_term_memory: z.boolean(),
  summary_version: z.number().int().nonnegative().nullable(),
}).strict()

export const DecisionSchema = z.object({
  schema_version: z.literal(3),
  intent: IntentSchema,
  kind: z.enum(['reply', 'clarify', 'suppress']),
  response: z.string().min(1).max(4096).nullable(),
  response_type: ResponseTypeSchema.nullable(),
  confidence: z.number().min(0).max(1),
  reason_code: z.string().min(1).max(128),
  business_action: BusinessActionSchema.nullable(),
  memory_candidates: z.array(MemoryCandidateSchema).max(10),
  missing_information: z.array(z.string().min(1).max(128)).max(20),
  next_state: z.enum(['completed', 'waiting_user']),
  retrieval_used: RetrievalUsedSchema.nullable(),
}).strict().superRefine((decision, context) => {
  if (
    decision.kind === 'suppress'
    && (
      decision.response !== null
      || decision.response_type !== null
      || decision.business_action !== null
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
  // Un pedido de humano se responde, no se deriva: no hay humano al que derivar.
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

export const ContactContextSchema = z.object({
  id: z.string().uuid(),
  status: z.string(),
  name: z.string().nullable().default(null),
  blocked: z.boolean(),
  consent_status: z.enum(['allowed', 'revoked', 'unknown']),
})

export const ExistingResultSchema = z
  .object({
    decision_id: z.string().uuid().nullable().default(null),
    outbound_id: z.string().uuid().nullable().default(null),
    delivery_status: z.string().nullable().default(null),
    next_state: z.enum(['completed', 'waiting_user']),
  })
  .nullable()
  .default(null)

/**
 * The durable window this inbound joined. The workflow sleeps until `due_at`
 * and then claims; it never decides on its own that a turn is ready, which is
 * what makes three fast messages produce one answer instead of three.
 */
export const BatchWindowSchema = z.object({
  id: z.string().uuid(),
  state: z.enum(['waiting', 'claimed', 'completed', 'abandoned']),
  joined_existing: z.boolean(),
  due_at: z.string().min(1),
  hard_deadline_at: z.string().min(1),
  conversation_seq: z.number().int(),
  message_count: z.number().int(),
})

/**
 * Ingest is now persistence only. It carries no context: building one before
 * knowing who owns the turn meant a five-message burst paid five times for a
 * single answer. The context arrives with the claim.
 */
export const IngestResponseSchema = z.object({
  status: z.enum(['accepted', 'duplicate', 'suppressed']),
  replayed: z.boolean(),
  trace_id: z.string().uuid(),
  turn_id: z.string().uuid(),
  conversation_id: z.string().uuid(),
  batch: BatchWindowSchema,
  policy: PolicySchema,
  contact: ContactContextSchema,
  existing_result: ExistingResultSchema,
})

export type IngestResponse = z.infer<typeof IngestResponseSchema>

export const BatchMessageSchema = z.object({
  id: z.string().uuid(),
  conversation_seq: z.number().int(),
  content: z.string(),
  created_at: z.string(),
  message_type: z.string(),
})

export const SelectedMemorySchema = z.object({
  memory_id: z.string(),
  type: z.string(),
  key: z.string(),
  value: z.string(),
  source_quote: z.string(),
  similarity: z.number(),
  recorded_at: z.string(),
})

export const KnowledgeItemSchema = z.object({
  source_uri: z.string(),
  title: z.string(),
  content: z.string(),
  similarity: z.number(),
})

/**
 * The controlled context, delivered only to the workflow that won the claim.
 *
 * `knowledge_base` is declared here on purpose: Next.js has been returning it
 * for a while and this schema was the reason the agent could not use it. The
 * `*_available` flags are what let a degraded turn stay a valid turn — an
 * empty list because pgvector is down must never read as "nothing relevant".
 */
export const ClaimedTurnSchema = z.object({
  outcome: z.literal('claimed'),
  trace_id: z.string().uuid(),
  batch: z.object({
    id: z.string().uuid(),
    claim_token: z.string().uuid(),
    conversation_id: z.string().uuid(),
    contact_id: z.string().uuid(),
    lease_until: z.string(),
    hard_deadline_at: z.string(),
    message_count: z.number().int(),
    stolen: z.boolean(),
  }),
  turn_id: z.string().uuid(),
  policy: PolicySchema,
  contact: ContactContextSchema.extend({ opted_in_at: z.string() }),
  context: z.object({
    batch_messages: z.array(BatchMessageSchema),
    recent_turns: z.array(RecentTurnSchema),
    summary: z.object({
      text: z.string().nullable().default(null),
      version: z.number().int(),
      updated_at: z.string().nullable().default(null),
    }),
    selected_memories: z.array(SelectedMemorySchema),
    long_term_memory_available: z.boolean(),
    knowledge_base: z.array(KnowledgeItemSchema),
    knowledge_base_available: z.boolean(),
    knowledge_base_dropped: z.number().int().default(0),
    injection_suspected_count: z.number().int().default(0),
  }),
  existing_result: ExistingResultSchema,
})

export const UnclaimedTurnSchema = z.object({
  outcome: z.enum(['waiting', 'absorbed', 'completed', 'abandoned', 'not_found']),
  trace_id: z.string().uuid(),
  batch_id: z.string().uuid(),
  retry_after_ms: z.number().int().nonnegative(),
})

export const ClaimResponseSchema = z.union([ClaimedTurnSchema, UnclaimedTurnSchema])

export type ClaimedTurn = z.infer<typeof ClaimedTurnSchema>
export type ClaimResponse = z.infer<typeof ClaimResponseSchema>

export const ClaimBatchInputSchema = z.object({
  batch_id: z.string().uuid(),
  trace_id: z.string().uuid(),
  claimed_by: z.string().min(1).max(128),
})

/**
 * Read-only projection of the catalog. There is no write counterpart anywhere
 * in this agent: prices are read, never proposed.
 *
 * `prices_assertable: false` is the signal that the agent must decline to
 * quote. An empty or unavailable catalog has to produce a refusal, not an
 * improvisation.
 */
export const CatalogItemSchema = z.object({
  sku: z.string(),
  name: z.string(),
  description: z.string().nullable().default(null),
  duration_weeks: z.number().int(),
  modality: z.enum(['live', 'ondemand', 'hybrid']),
  price: z.object({ ars_cents: z.number().int(), usd_cents: z.number().int() }),
  price_source: z.enum(['list', 'promo']),
  promo: z
    .object({
      ars_cents: z.number().int().nullable(),
      usd_cents: z.number().int().nullable(),
      valid_to: z.string().nullable(),
    })
    .nullable()
    .default(null),
})

export const CatalogResponseSchema = z.object({
  items: z.array(CatalogItemSchema),
  count: z.number().int(),
  dropped: z.number().int().default(0),
  stale_promotions_dropped: z.number().int().default(0),
  injection_suspected_count: z.number().int().default(0),
  as_of: z.string(),
  prices_assertable: z.boolean(),
})

export type CatalogResponse = z.infer<typeof CatalogResponseSchema>

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
      // El intento que el backend le confía a ESTE workflow. Vuelve en el
      // reporte de entrega: es lo que permite distinguir "falló este intento"
      // de "falló un intento que ya no corre", y sólo el primero puede llevar
      // a otro envío.
      delivery_attempt: z.number().int().min(1),
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
  delivery_attempt: z.number().int().min(1).nullable().default(null),
})

export const DeliveryReportResponseSchema = z.object({
  // `stale_ignored`: el reporte llegó de un intento que ya no corre. Queda
  // como evidencia pero no mueve la entrega.
  status: z.enum(['recorded', 'duplicate', 'stale_ignored']),
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
  // El lote lo reclamó otro workflow: este se detiene sin llamar al modelo.
  'absorbed',
  'abandoned',
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
