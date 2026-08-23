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

export const MEMORY_CANDIDATE_TYPES = [
  'study_goal',
  'study_context',
  'preference',
  'constraint',
  'objection',
  'timeline',
  'contact_preference',
] as const

export const MemoryCandidateSchema = z.object({
  type: z.enum(MEMORY_CANDIDATE_TYPES),
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

/**
 * Decision v4 call protocol, additive over v3. `call_offer` proposes a call
 * and waits; `call_confirmation` + `request_call_now` asks the backend for
 * one. The action never carries identity (phone, contact_id, call_id,
 * provider IDs, consent evidence) — `.strict()` rejects any such field, and
 * the backend derives all of it from the canonical turn.
 */
export const RequestCallNowActionSchema = z.object({
  type: z.literal('request_call_now'),
  reason: z.enum(['direct_request', 'accepted_offer']),
  course_of_interest: z.string().min(1).max(128).optional(),
}).strict()

/**
 * The typed payment-link action (spec §4). `offering_sku` is a canonical sku
 * string or null — never a URL or an amount. The producer side enforces the
 * same shape rule as `.strict()` gives request_call_now: an unknown key is
 * exactly where a URL or an amount would be smuggled in under another name.
 * The link itself never rides in this action; the backend resolves it from
 * configuration only, after revalidating plan_code against the customer's
 * explicit choice in the current batch.
 */
export const SendPaymentLinkActionSchema = z.object({
  type: z.literal('send_payment_link'),
  plan_code: z.enum(['monthly_12', 'monthly_6', 'one_time']),
  offering_sku: z.string().min(1).max(128)
    .refine((value) => !/https?:\/\//i.test(value), 'OFFERING_SKU_LOOKS_LIKE_URL')
    .refine((value) => !/\d[.,]\d{2}|\busd\b|\bars\b|[$€£]/i.test(value), 'OFFERING_SKU_LOOKS_LIKE_AMOUNT')
    .nullable(),
}).strict()

export const DecisionBusinessActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('mark_hot_lead'), score: z.number().min(0).max(1) }).strict(),
  z.object({
    type: z.literal('log_objection'),
    objection_key: z.string().min(1).max(128),
    quote: z.string().min(1).max(1024),
  }).strict(),
  RequestCallNowActionSchema,
  SendPaymentLinkActionSchema,
])

export const DecisionResponseTypeSchema = z.enum([
  'social_reply',
  'commercial_reply',
  'clarification',
  'complaint_ack',
  'automation_only',
  'opt_out_ack',
  'out_of_scope',
  'technical_fallback',
  'call_offer',
  'call_confirmation',
])

export const DecisionSchema = z.object({
  schema_version: z.union([z.literal(3), z.literal(4)]),
  intent: IntentSchema,
  kind: z.enum(['reply', 'clarify', 'suppress']),
  response: z.string().min(1).max(4096).nullable(),
  response_type: DecisionResponseTypeSchema.nullable(),
  confidence: z.number().min(0).max(1),
  reason_code: z.string().min(1).max(128),
  business_action: DecisionBusinessActionSchema.nullable(),
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
  // Reglas v4: el protocolo de llamada no existe por debajo de schema 4.
  const requestsCall = decision.business_action?.type === 'request_call_now'
  const isCallResponse = decision.response_type === 'call_offer' || decision.response_type === 'call_confirmation'
  if (decision.schema_version !== 4 && (requestsCall || isCallResponse)) {
    context.addIssue({ code: 'custom', message: 'CALL_PROTOCOL_REQUIRES_V4' })
  }
  if (
    decision.response_type === 'call_offer'
    && (decision.business_action !== null || decision.kind !== 'reply' || decision.next_state !== 'waiting_user')
  ) {
    context.addIssue({ code: 'custom', message: 'INVALID_CALL_OFFER' })
  }
  if (requestsCall !== (decision.response_type === 'call_confirmation')) {
    context.addIssue({ code: 'custom', message: 'INVALID_CALL_REQUEST' })
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
 * The bounded sales/call context handed to Agent A on every claimed turn.
 * Never carries phone, provider credentials, a transcript or unbounded call
 * analysis — only what the deterministic call-offer policy allows and the
 * facts that produced it.
 */
export const SalesContextSchema = z.object({
  mode: z.enum(['advising', 'awaiting_call_consent', 'call_pending', 'in_call', 'post_call']),
  course_of_interest: z.string().nullable(),
  open_call_offer: z
    .object({
      decision_id: z.string().uuid(),
      expires_at: z.string(),
    })
    .nullable(),
  accepted_call_offer: z
    .object({
      decision_id: z.string().uuid(),
      expires_at: z.string(),
    })
    .nullable()
    .default(null),
  active_call: z
    .object({
      call_id: z.string().uuid(),
      status: z.string(),
    })
    .nullable(),
  allowed_actions: z.array(z.enum(['offer_call', 'request_call_now'])),
  last_call_result: z
    .object({
      call_id: z.string().uuid(),
      result: z.string().nullable(),
      ended_at: z.string(),
    })
    .nullable(),
})

/**
 * The controlled context, delivered only to the workflow that won the claim.
 *
 * `knowledge_base` is declared here on purpose: Next.js has been returning it
 * for a while and this schema was the reason the agent could not use it. The
 * `*_available` flags are what let a degraded turn stay a valid turn — an
 * empty list because pgvector is down must never read as "nothing relevant".
 */
/**
 * Bounded commercial facts for the configured workspace. Everything here is
 * backend-derived and rides inside the untrusted-context fence like retrieval:
 * the model reads it, it never chooses the workspace or amends a price.
 */
export const BusinessOfferingSchema = z.object({
  code: z.string(),
  display_name: z.string(),
  // Owner-authored commercial grouping. The nullable default keeps the
  // Botpress revision compatible with snapshots created before academy was
  // projected by the backend.
  academy: z.string().nullable().default(null),
  offering_type: z.enum(['service', 'course', 'product', 'subscription']),
  description: z.string().nullable().default(null),
  value_proposition: z.string().nullable().default(null),
  price_type: z.enum(['fixed', 'quote', 'free']),
  price: z.object({ amount: z.string(), currency: z.string() }).nullable().default(null),
  price_assertable: z.boolean(),
  billing_interval: z.string().nullable().default(null),
  modality: z.string().nullable().default(null),
  schedules: z
    .array(
      z.object({
        days: z.array(z.string()).default([]),
        start: z.string().nullable().default(null),
        end: z.string().nullable().default(null),
        timezone: z.string().nullable().default(null),
      })
    )
    .default([]),
  certification: z.boolean().nullable().default(null),
  hours_per_month: z.number().nullable().default(null),
  classes: z.number().nullable().default(null),
  modules: z.number().nullable().default(null),
  includes: z.array(z.string()).default([]),
  syllabus_published: z.boolean().nullable().default(null),
  language: z.string().nullable().default(null),
  min_age: z.number().nullable().default(null),
  policies: z.object({
    allowed_promise: z.string().nullable().default(null),
    forbidden_promises: z.array(z.string()).default([]),
    price_message: z.string().nullable().default(null),
  }),
})

export const BusinessContextSchema = z.object({
  // Transitional defaults let a new Botpress revision consume the previous
  // backend snapshot shape. Missing freshness evidence must never make prices
  // assertable, so legacy snapshots degrade closed instead of failing the turn.
  as_of: z.string().min(1).nullable().default(null),
  prices_assertable: z.boolean().default(false),
  workspace: z.object({
    slug: z.string(),
    display_name: z.string(),
    environment: z.enum(['sandbox', 'staging', 'production']),
    default_locale: z.string(),
    timezone: z.string(),
    payment_options: z.array(z.object({
      code: z.enum(['monthly_12', 'monthly_6', 'one_time']),
      label: z.string(),
      total: z.object({ amount: z.literal('360.00'), currency: z.literal('USD') }),
      installments: z.number().int().positive(),
      installment_amount: z.enum(['30.00', '60.00', '360.00']),
      payment_link: z.string().url(),
    }).strict()).default([]),
  }),
  offerings: z.array(BusinessOfferingSchema),
  qualification_fields: z.array(
    z.object({
      code: z.string(),
      prompt: z.string(),
      response_type: z.enum(['boolean', 'single_select', 'multi_select', 'text', 'number']),
      options: z.array(z.string()).default([]),
      is_required: z.boolean(),
      position: z.number().int(),
    })
  ),
  injection_suspected_count: z.number().int().default(0),
  offerings_truncated: z.number().int().nonnegative().default(0),
})

export type BusinessContext = z.infer<typeof BusinessContextSchema>

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
  sales_context: SalesContextSchema,
  deterministic_route: z.enum([
    'greeting',
    'call_direct_request',
    'call_accepted_offer',
    'call_acceptance_clarification',
  ]).nullable().default(null),
  diagnostics: z.object({
    timings: z.object({
      claim_total_ms: z.number().nonnegative(),
      core_db_ms: z.number().nonnegative(),
      shared_embedding_ms: z.number().nonnegative(),
      memory_search_ms: z.number().nonnegative(),
      knowledge_search_ms: z.number().nonnegative(),
      business_snapshot_ms: z.number().nonnegative(),
    }).passthrough(),
    counters: z.object({
      embedding_calls: z.number().int().nonnegative(),
      memory_search_calls: z.number().int().nonnegative(),
      knowledge_search_calls: z.number().int().nonnegative(),
      business_snapshot_calls: z.number().int().nonnegative(),
      catalog_calls: z.literal(0),
    }).passthrough(),
  }).passthrough().default({
    timings: {
      claim_total_ms: 0,
      core_db_ms: 0,
      shared_embedding_ms: 0,
      memory_search_ms: 0,
      knowledge_search_ms: 0,
      business_snapshot_ms: 0,
    },
    counters: {
      embedding_calls: 0,
      memory_search_calls: 0,
      knowledge_search_calls: 0,
      business_snapshot_calls: 0,
      catalog_calls: 0,
    },
  }),
  business_context: BusinessContextSchema.nullable().default(null),
  business_context_available: z.boolean().default(false),
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
  offering_type: z.enum(['service', 'course', 'product', 'subscription']),
  modality: z.string().nullable().default(null),
  billing_interval: z.string().nullable().default(null),
  /**
   * Canonical price columns, verbatim. `null` means the backend refused to
   * provide an amount (quote/free): there is no field an invented price
   * could ride in, and `price_assertable` says so explicitly.
   */
  price: z.object({ amount: z.string(), currency: z.string() }).nullable().default(null),
  price_type: z.enum(['fixed', 'quote', 'free']),
  price_assertable: z.boolean(),
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
  // Presente exactamente cuando la decisión reservó una llamada. En replay
  // trae el mismo call_id de la primera reserva; el workflow despacha por
  // call_id y nunca conoce el teléfono.
  call_request: z
    .object({
      call_id: z.string().uuid(),
      status: z.literal('requested'),
    })
    .nullable()
    .default(null),
  // Passthrough only, from commit-claimed-decision.ts's best-effort batch
  // close (spec §8). Optional: an older backend, or a commit with no claimed
  // batch to close (batch_id/claim_token absent), simply omits it. Never
  // gates anything on the Botpress side — it exists so the workflow can log
  // whether the batch actually reached `completed`.
  batch_completion: z
    .enum(['completed', 'duplicate', 'stale_claim', 'not_found', 'skipped', 'error'])
    .optional(),
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
