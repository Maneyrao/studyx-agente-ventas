import { COURSE_MENTION_ROLES_V1 } from '@/shared/conversation/course-mentions';
import { z } from 'zod';
import { TurnRejectionV1Schema } from './turn-rejection-schema';
import {
  AGENT_A_FACT_KINDS_V1,
  AGENT_A_MEMORY_TYPES_V1,
} from '../domain/agent-a-brain';
import { ConversationMoveV1Schema } from './conversation-pipeline-schema';
import {
  ContactProfileContextV1Schema,
  ContactProfileRequestV1Schema,
  ContactProfileUpdateV1Schema,
  CONTACT_PROFILE_MAX_REQUESTS_V1,
  CONTACT_PROFILE_MAX_UPDATES_V1,
} from '../../../shared/conversation/contact-profile-contract';

const PaymentPlanSchema = z.enum(['monthly_12', 'monthly_6', 'one_time']);
const MemoryTypeSchema = z.enum(AGENT_A_MEMORY_TYPES_V1);
const IdentifierSchema = z.string().trim().min(1).max(160);
const CustomerMessageSchema = z.string().trim().min(1).max(2_000).refine(
  (value) => !/https?:\/\//iu.test(value),
  'MODEL_RESPONSE_URL_FORBIDDEN',
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
  kind: z.enum(AGENT_A_FACT_KINDS_V1),
  value: z.string().trim().min(1).max(1_200),
}).strict();

const SalesProfileItemV1Schema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/u),
  value: z.string().trim().min(1).max(512),
  source_quote: z.string().trim().min(1).max(400),
}).strict();
const SalesProfileItemsSchema = z.array(SalesProfileItemV1Schema).max(4);
/** Claim-level: persisted model memories, latest per (type, key). */
const SalesProfileMemoriesV1Schema = z.object({
  objective: SalesProfileItemsSchema, experience: SalesProfileItemsSchema,
  tentative_interest: SalesProfileItemsSchema, objections: SalesProfileItemsSchema,
  constraints: SalesProfileItemsSchema, preferences: SalesProfileItemsSchema,
  timeline: SalesProfileItemsSchema, contact_preference: SalesProfileItemsSchema,
}).strict();
/** What the model sees in commercial_state: persisted data only, never agent phrases. */
const SalesProfileV1Schema = SalesProfileMemoriesV1Schema.extend({
  selected_course: z.object({ code: IdentifierSchema, name: z.string().trim().min(1).max(240) }).strict().nullable(),
  call_preference: z.enum(['chat', 'call', 'unknown']),
  active_promotion: z.object({
    promotion_code: IdentifierSchema, interest_offering_code: IdentifierSchema,
    status: z.enum(['none', 'offer_available', 'accepted', 'expired', 'cancelled']),
  }).strict().nullable(),
  bonus_courses: z.array(z.object({ code: IdentifierSchema, name: z.string().trim().min(1).max(240),
    position: z.union([z.literal(1), z.literal(2), z.literal(3)]) }).strict()).max(3),
  missing_data: z.array(z.enum(['nombre', 'apellido', 'correo', 'telefono'])).max(4),
  next_allowed_effects: z.array(z.string().min(1).max(64)).max(16),
  retention_used: z.boolean().nullable(),
}).strict();

export const AgentAContextV1Schema = z.object({
  schema_version: z.literal(1),
  turn: z.object({
    batch_messages: z.array(z.object({
      id: IdentifierSchema,
      text: z.string().trim().min(1).max(2_000),
    }).strict()).min(1).max(20),
    recent_turns: z.array(z.object({
      id: IdentifierSchema,
      direction: z.enum(['inbound', 'outbound']),
      content: z.string().trim().min(1).max(4_096),
    }).strict()).max(8),
  }).strict(),
  continuity: z.object({
    assistant_has_spoken: z.boolean(),
    first_name_status: z.enum(['missing', 'requested', 'known']),
    last_agent_reply: z.string().trim().min(1).max(4_096).nullable(),
  }).strict().optional(),
  customer: z.object({
    display_name: z.string().trim().min(1).max(321).nullable(),
    contact_profile: ContactProfileContextV1Schema.optional(),
    contact_intake: z.object({
      nombre: z.string().trim().min(1).max(160).nullable(),
      apellido: z.string().trim().min(1).max(160).nullable(),
      correo: z.string().trim().min(1).max(320).nullable(),
      telefono: z.string().trim().min(1).max(40).nullable(),
    }).strict().nullable().optional(),
    memories: z.array(AgentAMemorySchema).max(5),
  }).strict(),
  identity: z.object({
    advisor_name: z.string().trim().min(1).max(120),
    academy_name: z.string().trim().min(1).max(240),
    website: z.string().trim().min(1).max(240).nullable(),
    instagram: z.string().trim().min(1).max(120).nullable(),
  }).strict().nullable(),
  commercial_state: z.object({
    sales_profile: SalesProfileV1Schema.optional(),
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
      /** Paid course + delivered bonuses now. "N cursos al precio de uno" must use the right N. */
      courses_in_package: z.number().int().min(1).max(4).optional(),
      /** The count if the next bonus is offered in this turn (paid + bonuses + 1). */
      courses_in_package_after_next_offer: z.number().int().min(2).max(4).optional(),
      accepted_at: z.string().min(1).nullable(),
    }).strict().nullable().optional(),
    selected_offering_code: IdentifierSchema.nullable(),
    selected_payment_plan: PaymentPlanSchema.nullable(),
    stage: z.enum(['exploring', 'qualified', 'course_selected', 'plan_selected', 'payment_link_sent', 'handoff', 'closed']),
    call_preference: z.enum(['unknown', 'call', 'chat', 'declined']),
    call_offer_status: z.enum(['not_offered', 'offered', 'accepted', 'declined']),
    call_offer_count: z.union([z.literal(0), z.literal(1), z.literal(2)]),
    active_call: z.object({ call_id: z.string().uuid(), status: z.string() }).strict().nullable().optional(),
    last_call_result: z.object({
      call_id: z.string().uuid(), result: z.string().nullable(), ended_at: z.string(),
    }).strict().nullable().optional(),
    awaiting_reply: z.enum(['none', 'area_choice', 'course_choice', 'call_or_chat', 'payment_plan', 'payment_confirmation', 'contact_details']),
    payment_reported: z.boolean(),
  }).strict(),
  /** Espejo de `obligations` del ADK: qué debe este turno y qué no habilita. */
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
    // Manual-verified facts valid for every course (benefits, how it works).
    general_facts: z.array(AgentAFactSchema).max(4).optional(),
    bonus_candidate_fichas: z.array(z.object({
      code: IdentifierSchema,
      fact: AgentAFactSchema,
    }).strict()).max(8).optional(),
    candidate_offerings: z.array(z.object({
      code: IdentifierSchema,
      fact_id: IdentifierSchema,
      display_name: z.string().trim().min(1).max(240),
      area_code: IdentifierSchema.nullable(),
      facts: z.array(AgentAFactSchema).max(4).optional(),
    }).strict()).max(3),
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
    course_programs: z.object({
      available_offering_codes: z.array(IdentifierSchema).max(60),
      sent_offering_codes: z.array(IdentifierSchema).max(60),
    }).strict().optional(),
    course_bonus: z.object({
      enabled: z.boolean().optional(),
      may_offer_bonus: z.boolean().optional(),
      promotion_cycle_id: z.string().uuid().nullable().optional(),
      offer_version: z.number().int().min(0).optional(),
      accepted_at: z.string().nullable().optional(),
      package_status: z.enum(['pending_review','offered','accepted','cancelled','expired','attached']).nullable().optional(),
      delivered_bonus_offerings: z.array(z.object({code:IdentifierSchema,display_name:z.string().trim().min(1).max(240),position:z.number().int().min(1).max(3)}).strict()).max(3).optional(),
      sales_flow: z.object({retention_used:z.boolean(),promo_expires_at:z.string().nullable()}).strict().optional(),
      bonus_candidates: z.array(z.object({code:IdentifierSchema,display_name:z.string().trim().min(1).max(240)}).strict()).max(60).optional(),
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
    // Nombres de campo, nunca valores. El modelo necesita saber qué
    // falta para poder pedirlo; no necesita el nombre, el correo ni el
    // teléfono del cliente, y no los recibe.
    /**
     * Si la autoridad respondió qué falta, o si nadie preguntó.
     * `unknown` nunca puede leerse como completitud: el gate del link no se
     * abre por ignorancia.
     */
    intake_status: z.enum(['known', 'unknown']),
    intake_missing: z.array(z.enum(['nombre', 'apellido', 'correo', 'telefono']))
      .default([]),
    call_contact_requirements: z.array(z.object({
      field: z.enum(['nombre', 'apellido', 'correo', 'telefono']),
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
    motive: z.object({
      kind: z.enum(['price_objection', 'promotion_rejection', 'better_promotion_request', 'purchase_decline']),
      quote: z.string().trim().min(1).max(2_048),
    }).strict(),
  }).strict(),
  z.object({
    type: z.literal('accept_promotion'),
    promotion_code: IdentifierSchema.optional(),
    interest_offering_code: IdentifierSchema.optional(),
    promotion_cycle_id: IdentifierSchema.optional(),
    offer_version: z.number().int().min(1).optional(),
  }).strict(),
  z.object({
    type: z.literal('send_course_program'),
    offering_code: IdentifierSchema,
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

/**
 * Internal reasoning of the turn. Never sent to the customer, never validated
 * beyond shape/size and never used by any rule: it exists only as evidence.
 */
export const TURN_REASONING_NEXT_STEPS_V1 = [
  'discover', 'value', 'objection', 'close', 'promo', 'call', 'checkout', 'post_sale', 'other',
] as const;
export const TurnReasoningV1Schema = z.object({
  phase: z.string().max(120),
  customer_now: z.string().max(400),
  already_said: z.string().max(400),
  customer_goal: z.string().max(400),
  next_step: z.enum(TURN_REASONING_NEXT_STEPS_V1),
}).strict();

export const AgentATurnProposalV1Schema = z.object({
  schema_version: z.literal(1),
  move: ConversationMoveV1Schema,
  response: z.object({
    // Conversational length is evaluated, not rejected transactionally.
    messages: z.array(CustomerMessageSchema).min(1).max(2),
    call_offer: CallOfferMessageSchema.nullable().optional(),
  }).strict(),
  proposed_action: AgentAProposedActionSchema,
  course_mentions: z.array(z.object({offering_code:IdentifierSchema,role:z.enum(COURSE_MENTION_ROLES_V1)}).strict()).max(50).default([]),
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
  turn_reasoning: TurnReasoningV1Schema.optional(),
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

export type ParsedAgentAContextV1 = z.infer<typeof AgentAContextV1Schema>;
export type ParsedAgentATurnProposalV1 = z.infer<typeof AgentATurnProposalV1Schema>;
