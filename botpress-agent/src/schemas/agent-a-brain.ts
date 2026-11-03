import { COURSE_MENTION_ROLES_V1 } from '../../../src/shared/conversation/course-mentions';
import { z } from '@botpress/runtime';
import { ConversationMoveV1Schema } from './conversation-pipeline';
import { TurnRejectionV1Schema } from './turn-rejection';
import {
  CONTACT_PROFILE_FIELDS_V1,
  CONTACT_PROFILE_OPERATIONS_V1,
  CONTACT_PROFILE_PURPOSES_V1,
  CONTACT_PROFILE_MODES_V1,
  CONTACT_PROFILE_MAX_UPDATES_V1,
  CONTACT_PROFILE_MAX_REQUESTS_V1,
  CONTACT_PROFILE_MAX_SOURCES_V1,
  CONTACT_PROFILE_MAX_PENDING_REQUESTS_V1,
} from '../../../src/shared/conversation/contact-profile-contract';

/** Zod 3 mirror of shared/conversation/bonus-ladder CourseBonusLadderV1. */
export const CourseBonusLadderV1Schema = z.object({
  eligible: z.boolean(),
  observed_price_objection_count: z.number().int().nonnegative(),
  required_price_objection_count: z.literal(2),
  call_invitation_status: z.enum(['not_offered', 'offered', 'accepted', 'declined']),
  call_offer_count: z.number().int().nonnegative(),
  may_offer_call: z.boolean(),
  missing_steps: z.array(z.enum(['recorded_price_objections', 'call_invitation'])).readonly(),
  price_only_barrier_confirmed: z.boolean().optional(),
  current_turn_price_objection: z.boolean().optional(),
  instant_trigger: z.boolean().optional(),
}).strict();

// Zui uses Zod 3; construct the ADK mirror locally from the portable constants.
const ProfileFieldSchema = z.enum(CONTACT_PROFILE_FIELDS_V1);
const ProfileFieldsSchema = z.array(ProfileFieldSchema).min(1).max(4)
  .refine((fields) => new Set(fields).size === fields.length, 'DUPLICATE_PROFILE_FIELD');
export const ContactProfileUpdateV1Schema = z.object({
  field: ProfileFieldSchema,
  value: z.string().min(1).max(512).nullable(),
  operation: z.enum(CONTACT_PROFILE_OPERATIONS_V1),
  source_message_id: z.string().uuid(),
  source_quote: z.string().min(1).max(4_096),
}).strict().refine((update) => update.operation === 'retract'
  ? update.value === null : update.value !== null, 'PROFILE_OPERATION_VALUE_MISMATCH');
export const ContactProfileRequestV1Schema = z.object({
  message_index: z.number().int().min(0),
  fields: ProfileFieldsSchema,
  purpose: z.enum(CONTACT_PROFILE_PURPOSES_V1),
  mode: z.enum(CONTACT_PROFILE_MODES_V1),
}).strict();
export const ContactProfileContextV1Schema = z.object({
  version: z.number().int().min(0),
  sources: z.array(z.object({
    id: z.string().uuid(),
    text: z.string().min(1).max(4_096),
    sequence: z.number().int().min(0),
  }).strict()).max(CONTACT_PROFILE_MAX_SOURCES_V1),
  pending_requests: z.array(z.object({
    message_id: z.string().uuid(),
    fields: ProfileFieldsSchema,
    purpose: z.enum(CONTACT_PROFILE_PURPOSES_V1),
    mode: z.enum(CONTACT_PROFILE_MODES_V1),
  }).strict()).max(CONTACT_PROFILE_MAX_PENDING_REQUESTS_V1),
}).strict();

const PaymentPlanSchema = z.enum(['monthly_12', 'monthly_6', 'one_time']);
const MemoryTypeSchema = z.enum([
  'study_goal', 'study_context', 'preference', 'constraint', 'objection', 'timeline', 'contact_preference',
]);
const FactKindSchema = z.enum([
  'area_name', 'offering_name', 'offering_description', 'offering_duration',
  'offering_modality', 'offering_syllabus', 'payment_plan_label', 'payment_plan_price',
]);
const IdentifierSchema = z.string().trim().min(1).max(160);
const RecordedPriceOnlyBarrierV1Schema = z.union([
  z.object({ status: z.literal('unknown') }).strict(),
  z.object({
    status: z.enum(['confirmed', 'other_barriers_reported']),
    offering_code: IdentifierSchema.nullable(),
    source_turn_id: z.string().uuid(), source_message_id: z.string().uuid(),
    source_quote: z.string().min(1).max(2_048), recorded_at: z.string().min(1),
    interpretation_source: z.literal('committed_agent_observation'),
  }).strict(),
]);
export const RecordedNegotiationFactsV1Schema = z.object({
  price_objection_count: z.number().int().min(0),
  latest_price_objection_source_turn_ids: z.array(z.string().uuid()).max(20),
  latest_legacy_price_objection_source_message_ids: z.array(z.string().uuid()).max(20).optional(),
  price_only_barrier: RecordedPriceOnlyBarrierV1Schema,
}).strict();
const AgentANegotiationContextV1Schema = z.object({
  price_objections: z.object({ count: z.number().int().min(0).nullable(),
    scope: z.literal('conversation_prior_recorded_sources'),
    latest_source_turn_ids: z.array(z.string().uuid()).max(20),
    latest_legacy_source_message_ids: z.array(z.string().uuid()).max(20),
  }).strict(),
  price_only_barrier: RecordedPriceOnlyBarrierV1Schema,
  call_invitation: z.object({ status: z.enum(['not_offered', 'offered', 'accepted', 'declined']),
    count: z.union([z.literal(0), z.literal(1), z.literal(2)]),
    authorization: z.enum(['authorized', 'not_authorized']),
  }).strict(),
  delivered_bonus_offers: z.array(z.object({ code: IdentifierSchema, display_name: z.string().min(1).max(240),
    position: z.number().int().min(1).max(3) }).strict()).max(3).nullable(),
}).strict();
const CustomerMessageSchema = z.string().trim().min(1).max(2_000).refine(
  (value) => !/https?:\/\//iu.test(value),
  'MODEL_RESPONSE_URL_FORBIDDEN',
).refine(
  (value) => !/\{\{[^}]+\}\}/u.test(value),
  'MODEL_RESPONSE_PLACEHOLDER_FORBIDDEN',
);
const CallOfferMessageSchema = CustomerMessageSchema;

const AgentAMemorySchema = z.object({
  id: IdentifierSchema,
  type: MemoryTypeSchema,
  key: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/u),
  value: z.string().trim().min(1).max(512),
  confidence: z.number().min(0).max(1),
}).strict();

const AgentAFactSchema = z.object({
  id: IdentifierSchema,
  kind: FactKindSchema,
  value: z.string().trim().min(1).max(1_200),
}).strict();

export const AgentAContextV1Schema = z.object({
  schema_version: z.literal(1),
  turn: z.object({
    batch_messages: z.array(z.object({
      id: IdentifierSchema,
      text: z.string().trim().min(1).max(2_000),
    }).strict()).min(1).max(20),
    input_capability: z.object({
      status: z.enum(['understood', 'partially_understood', 'unreadable']),
      unavailable_message_count: z.number().int().min(0).max(20),
    }).strict().optional(),
    recent_turns: z.array(z.object({
      id: IdentifierSchema,
      direction: z.enum(['inbound', 'outbound']),
      // A customer intervention can contain all twenty model-bounded batch
      // messages; an agent intervention can contain three visible bubbles.
      // Keep the complete causal turn in context rather than truncating one.
      content: z.string().trim().min(1).max(40_019),
    }).strict()).max(20),
  }).strict(),
  continuity: z.object({
    assistant_has_spoken: z.boolean(),
    first_name_status: z.enum(['missing', 'requested', 'known']),
    last_agent_reply: z.string().trim().min(1).max(6_002).nullable(),
  }).strict().optional(),
  customer: z.object({
    display_name: z.string().trim().min(1).max(321).nullable(),
    conversation_summary: z.object({
      text: z.string().trim().min(1).max(4_096),
      version: z.number().int().min(1),
      updated_at: z.string().nullable(),
    }).strict().nullable().optional(),
    contact_profile: ContactProfileContextV1Schema.optional(),
    contact_intake: z.object({
      nombre: z.string().trim().min(1).max(160).nullable(),
      apellido: z.string().trim().min(1).max(160).nullable(),
      correo: z.string().trim().min(1).max(320).nullable(),
      telefono: z.string().trim().min(1).max(40).nullable(),
    }).strict().nullable().optional(),
    memories: z.array(AgentAMemorySchema).max(5),
  }).strict(),
  /**
   * Identidad estable del asesor y de la academia, resuelta por el backend
   * desde la configuración del workspace. Es lo único que la conducta
   * canónica delega en configuración: el resto de sus `{{ }}` son slots que
   * el modelo llena desde este mismo contexto autorizado. `null` cuando el
   * workspace no la declara, y entonces el prompt viaja sin resolver.
   */
  identity: z.object({
    advisor_name: z.string().trim().min(1).max(120),
    academy_name: z.string().trim().min(1).max(240),
    website: z.string().trim().min(1).max(240).nullable(),
    instagram: z.string().trim().min(1).max(120).nullable(),
  }).strict().nullable(),
  commercial_state: z.object({
    negotiation: AgentANegotiationContextV1Schema.optional(),
    promotion: z.object({
      promotion_code: IdentifierSchema,
      promotion_cycle_id: IdentifierSchema,
      offer_version: z.number().int().min(1),
      status: z.enum(['none', 'offer_available', 'accepted', 'expired', 'cancelled']),
      interest_offering_code: IdentifierSchema,
      bonus_offerings: z.array(z.object({
        offering_code: IdentifierSchema,
        name: z.string().trim().min(1).max(240),
        offered_at: z.string().min(1),
        position: z.union([z.literal(1), z.literal(2), z.literal(3)]),
      }).strict()).max(3),
      accepted_at: z.string().min(1).nullable(),
    }).strict().nullable().optional(),
    selected_offering_code: IdentifierSchema.nullable(),
    selected_payment_plan: PaymentPlanSchema.nullable(),
    stage: z.enum(['exploring', 'qualified', 'course_selected', 'plan_selected', 'payment_link_sent', 'handoff', 'closed']),
    call_preference: z.enum(['unknown', 'call', 'chat', 'declined']),
    call_offer_status: z.enum(['not_offered', 'offered', 'accepted', 'declined']),
    call_offer_count: z.union([z.literal(0), z.literal(1), z.literal(2)]),
    // A persisted request supports a status reply, never another dispatch.
    active_call: z.object({ call_id: z.string().uuid(), status: z.string() }).strict().nullable().optional(),
    // Most recently ended call. `result=null` is still terminal evidence: it
    // prevents Agent A from inferring that an already-finished dispatch is
    // pending merely because the provider supplied no classification.
    last_call_result: z.object({
      call_id: z.string().uuid(),
      result: z.string().nullable(),
      ended_at: z.string(),
    }).strict().nullable().optional(),
    awaiting_reply: z.enum(['none', 'area_choice', 'course_choice', 'call_or_chat', 'payment_plan', 'payment_confirmation', 'contact_details']),
    payment_reported: z.boolean(),
    payment_verification: z.object({
      status: z.enum([
        'reserved', 'creating_checkout', 'creation_ambiguous', 'pending',
        'paid', 'failed', 'expired', 'refunded',
      ]),
      offering_code: IdentifierSchema,
      plan_code: PaymentPlanSchema.nullable(),
      paid_at: z.string().nullable(),
      fulfillment: z.object({
        enrollment_status: z.enum(['active', 'already_enrolled']),
        access_message_status: z.enum([
          'pending', 'dispatched', 'processing', 'sent', 'ambiguous',
          'dead_letter', 'cancelled',
        ]).nullable(),
        access_sent_at: z.string().nullable(),
      }).strict().nullable().optional(),
    }).strict().nullable().optional(),
    payment_link_request: z.object({
      status: z.enum(['pending', 'withdrawn', 'consumed']),
      offering_code: IdentifierSchema,
      payment_plan: PaymentPlanSchema,
    }).strict().nullable().optional(),
  }).strict(),
  /**
   * El eje que le faltaba al contexto. `capabilities` dice qué PUEDE hacer el
   * modelo; esto dice qué DEBE este turno y qué todavía no puede hacer, según
   * la fase de venta del comportamiento canónico. El backend fija la fase y su
   * deuda; la redacción sigue siendo enteramente del modelo.
   */
  obligations: z.object({
    stage: z.enum(['exploring', 'qualified', 'course_selected', 'plan_selected', 'payment_link_sent', 'handoff', 'closed']),
    owes: z.array(z.enum([
      'greeting', 'diagnostic_question', 'presentation', 'option_close',
      'contact_details', 'payment_link', 'payment_acknowledgement',
    ])).default([]),
    not_yet: z.array(z.enum(['price', 'payment_link'])).default([]),
  }).strict().optional(),
  catalog: z.object({
    selected_offering: z.object({
      code: IdentifierSchema,
      display_name: z.string().trim().min(1).max(240),
      area_code: IdentifierSchema.nullable(),
      facts: z.array(AgentAFactSchema).max(32),
    }).strict().nullable(),
    available_offerings: z.array(z.object({
      code: IdentifierSchema,
      fact_id: IdentifierSchema,
      display_name: z.string().trim().min(1).max(240),
      area_code: IdentifierSchema.nullable(),
    }).strict()).max(60),
    areas: z.array(z.object({
      code: IdentifierSchema,
      fact_id: IdentifierSchema,
      display_name: z.string().trim().min(1).max(240),
    }).strict()).max(24),
    candidate_offerings: z.array(z.object({
      code: IdentifierSchema,
      fact_id: IdentifierSchema,
      display_name: z.string().trim().min(1).max(240),
      area_code: IdentifierSchema.nullable(),
      facts: z.array(AgentAFactSchema).max(4).optional(),
      reference: z.object({ source: z.enum(['prior_agent_named_candidate', 'current_customer_named_course']),
        matched_terms: z.array(z.string().min(3)).min(1).max(8) }).strict().optional(),
    }).strict()).max(3),
    // Resolver output is evidence, not a conversational instruction. It lets
    // the brain distinguish a confirmed absence from an open-ended browse.
    resolution: z.enum(['exact', 'ambiguous', 'not_found', 'no_catalog_intent', 'unavailable'])
      .optional(),
    payment_plans: z.array(z.object({
      code: PaymentPlanSchema,
      // Referencia estructurada: el modelo cita este id para poder nombrar el
      // plan en su propia redacción sin inventar el valor.
      fact_id: IdentifierSchema,
      label: z.string().trim().min(1).max(240),
    }).strict()).max(3),
    test_payment_options: z.array(z.object({
      code: z.literal('stripe_verification_050'),
      fact_id: IdentifierSchema,
      label: z.string().trim().min(1).max(240),
      action: z.literal('send_test_payment_link'),
    }).strict()).max(1).optional(),
  }).strict(),
  /**
   * Presente SÓLO en la llamada de reparación. Lleva códigos y
   * alternativas, nunca prosa: el backend no redacta (A3/A4).
   */
  turn_rejection: TurnRejectionV1Schema.optional(),
  capabilities: z.object({
    may_reply: z.boolean(),
    may_offer_call: z.boolean(),
    may_request_call_now: z.boolean(),
    may_present_payment_options: z.boolean(),
    may_send_payment_link: z.boolean(),
    authorized_payment_plan: PaymentPlanSchema.nullable(),
    course_bonus: z.object({
      ladder: CourseBonusLadderV1Schema.optional(),
      enabled: z.boolean().optional(),
      may_offer_bonus: z.boolean().optional(),
      promotion_cycle_id: z.string().uuid().nullable().optional(),
      offer_version: z.number().int().min(0).optional(),
      accepted_at: z.string().nullable().optional(),
      package_status: z.enum(['pending_review','offered','accepted','cancelled','expired','attached']).nullable().optional(),
      delivered_bonus_offerings: z.array(z.object({code:IdentifierSchema,display_name:z.string().trim().min(1).max(240),position:z.number().int().min(1).max(3)}).strict()).max(3).optional(),
      sales_flow: z.object({price_probe:z.enum(['not_asked','asked','yes','no']),retention_used:z.boolean(),promo_expires_at:z.string().nullable(),gift_request_pending_probe:z.object({code:IdentifierSchema,display_name:z.string().trim().min(1).max(240)}).strict().nullable()}).strict().optional(),
      rule_bonus: z.object({paid_offering_code:IdentifierSchema,paid_display_name:z.string().trim().min(1).max(240),bonus_offering_code:IdentifierSchema,display_name:z.string().trim().min(1).max(240),position:z.number().int().min(1).max(3),source:z.literal('customer_request').optional(),replaces_offering_code:IdentifierSchema.optional(),replaces_display_name:z.string().trim().min(1).max(240).optional()}).strict().nullable().optional(),
      max_bonus_courses: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
      status: z.enum([
        'unavailable', 'needs_interest', 'not_eligible', 'checkin_available',
        'review_available', 'review_pending', 'offer_available', 'accepted',
      ]),
      may_schedule_checkin: z.boolean(),
      may_request_review: z.boolean(),
      may_accept_offer: z.boolean(),
      may_send_promoted_payment: z.boolean(),
      promotion_code: IdentifierSchema.nullable(),
      bonus_selection_mode: z.enum(['configured', 'any_active_course']).optional(),
      interest_offering_code: IdentifierSchema.nullable().optional(),
      bonus_offerings: z.array(z.object({
        offered_at: z.string().optional(),
        code: IdentifierSchema,
        display_name: z.string().trim().min(1).max(240),
        position: z.number().int().min(1).max(3),
      }).strict()).max(3),
    }).strict().optional(),
    // Lista canónica de campos que todavía faltan. Los valores confirmables
    // están en customer.contact_intake y no alteran este permiso.
    /**
     * Si la autoridad respondió qué falta, o si nadie preguntó.
     * `unknown` nunca puede leerse como completitud: el gate del link no se
     * abre por ignorancia.
     */
    intake_status: z.enum(['known', 'unknown']),
    intake_missing: z.array(z.enum(['nombre', 'apellido', 'correo', 'telefono']))
      .default([]),
    // La ficha completa sigue visible arriba. Esta proyección evita que una
    // acción herede requisitos de otra. La llamada exige los cuatro campos
    // y además evidencia escrita de WhatsApp para el correo.
    required_contact_fields: z.object({
      call: z.array(ProfileFieldSchema),
      payment: z.array(ProfileFieldSchema),
      identity: z.array(ProfileFieldSchema),
    }).strict().optional(),
    call_contact_requirements: z.array(z.object({
      field: ProfileFieldSchema,
      reason: z.enum(['missing', 'written_whatsapp_confirmation_required']),
    }).strict()).optional(),
    call_execution: z.object({
      next_step: z.enum(['none', 'collect_contact_details', 'confirm_availability', 'dispatch_authorized']),
      request_call_now_authorized: z.boolean(),
    }).strict().optional(),
  }).strict(),
}).strict();

export const AgentAProposedActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('none') }).strict(),
  z.object({ type: z.literal('request_call_now'), reason: z.enum(['direct_request', 'accepted_offer']) }).strict(),
  z.object({
    type: z.literal('schedule_price_objection_checkin'),
    reason: z.literal('price_objection'),
  }).strict(),
  z.object({
    type: z.literal('request_promotion_review'),
    reason: z.literal('persistent_price_objection'),
    bonus_offering_code: IdentifierSchema.optional(),
  }).strict(),
  z.object({
    type: z.literal('offer_course_bonus'),
    bonus_offering_code: IdentifierSchema,
    interest_offering_code: IdentifierSchema,
  }).strict(),
  z.object({
    type: z.literal('accept_promotion'),
    promotion_code: IdentifierSchema.optional(),
    interest_offering_code: IdentifierSchema.optional(),
    promotion_cycle_id: IdentifierSchema.optional(),
    offer_version: z.number().int().min(1).optional(),
  }).strict(),
  z.object({
    type: z.literal('send_test_payment_link'),
    offering_code: IdentifierSchema,
  }).strict(),
  z.object({
    type: z.literal('send_payment_link'),
    offering_code: IdentifierSchema,
    payment_plan: PaymentPlanSchema,
    promotion_code: IdentifierSchema.optional(),
  }).strict(),
]).refine((action) => {
  if (action.type !== 'accept_promotion') return true;
  const fields = [action.promotion_code, action.interest_offering_code, action.promotion_cycle_id, action.offer_version];
  return fields.every((field) => field === undefined) || fields.every((field) => field !== undefined);
}, 'DIRECT_PROMOTION_ACCEPTANCE_FIELDS_REQUIRED');

const MemoryCandidateSchema = z.object({
  type: MemoryTypeSchema,
  key: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/u),
  value: z.string().trim().min(1).max(512),
  source_quote: z.string().trim().min(1).max(2_048),
  confidence: z.number().min(0).max(1),
}).strict();

export const AgentATurnProposalV1Schema = z.object({
  schema_version: z.literal(1),
  move: ConversationMoveV1Schema,
  response: z.object({
    // One authored intervention may use one or two WhatsApp bubbles. The call
    // invitation and a canonical payment block are separate transport parts,
    // so permitting more authored bubbles only fragments one logical answer
    // and makes downstream consumers mistake presentation for new context.
    messages: z.array(CustomerMessageSchema).min(1).max(2),
    call_offer: CallOfferMessageSchema.nullable().optional(),
  }).strict(),
  proposed_action: AgentAProposedActionSchema,
  // Legacy wire omission stays empty; roles are never inferred from prose or actions.
  course_mentions: z.array(z.object({
    offering_code: IdentifierSchema, role: z.enum(COURSE_MENTION_ROLES_V1),
  }).strict()).max(50).default([]),
  confirmed_phone: z.string().regex(/^\+[1-9]\d{7,14}$/u).nullable().optional(),
  profile_updates: z.array(ContactProfileUpdateV1Schema).max(CONTACT_PROFILE_MAX_UPDATES_V1).optional(),
  profile_requests: z.array(ContactProfileRequestV1Schema).max(CONTACT_PROFILE_MAX_REQUESTS_V1).optional(),
  used_fact_ids: z.array(IdentifierSchema).max(60),
  used_memory_ids: z.array(IdentifierSchema).max(5),
  // Asesor. No persiste y no autoriza nada (§ 09): el backend conserva
  // sus siete hitos duros y sólo con evidencia durable. Entra para que
  // el modelo pueda declarar dónde cree que está la conversación, y para
  // poder medir cuánto se desvía de la etapa que el backend infiere.
  stage_hypothesis: z.enum([
    'exploring', 'qualified', 'course_selected', 'plan_selected',
    'payment_link_sent', 'handoff', 'closed',
  ]).optional(),
  // Presente sólo en la reescritura. `attempt` es literal 1: no hay
  // segundo reintento (A5), y el tipo lo hace imposible de expresar.
  repair_of: z.object({
    rejection_id: z.string().uuid(),
    attempt: z.literal(1),
  }).strict().nullable().default(null),
  memory_candidates: z.array(MemoryCandidateSchema).max(10),
}).strict().superRefine((value, context) => {
  for (const [index, request] of (value.profile_requests ?? []).entries()) {
    if (request.message_index >= value.response.messages.length) {
      context.addIssue({ code: 'custom', path: ['profile_requests', index, 'message_index'], message: 'PROFILE_REQUEST_MESSAGE_NOT_FOUND' });
    }
  }
  if (new Set(value.used_fact_ids).size !== value.used_fact_ids.length) {
    context.addIssue({ code: 'custom', path: ['used_fact_ids'], message: 'DUPLICATE_FACT_ID' });
  }
  if (new Set(value.used_memory_ids).size !== value.used_memory_ids.length) {
    context.addIssue({ code: 'custom', path: ['used_memory_ids'], message: 'DUPLICATE_MEMORY_ID' });
  }
});

export type AgentAContextV1 = z.infer<typeof AgentAContextV1Schema>;
export type AgentATurnProposalV1 = z.infer<typeof AgentATurnProposalV1Schema>;
