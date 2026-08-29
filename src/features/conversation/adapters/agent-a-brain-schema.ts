import { z } from 'zod';
import {
  AGENT_A_FACT_KINDS_V1,
  AGENT_A_MEMORY_TYPES_V1,
} from '../domain/agent-a-brain';
import { ConversationMoveV1Schema } from './conversation-pipeline-schema';

const PaymentPlanSchema = z.enum(['monthly_12', 'monthly_6', 'one_time']);
const MemoryTypeSchema = z.enum(AGENT_A_MEMORY_TYPES_V1);
const IdentifierSchema = z.string().trim().min(1).max(160);
const CustomerMessageSchema = z.string().trim().min(1).max(1_500).refine(
  (value) => !/https?:\/\//iu.test(value),
  'MODEL_RESPONSE_URL_FORBIDDEN',
);

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
  customer: z.object({
    display_name: z.string().trim().min(1).max(200).nullable(),
    memories: z.array(AgentAMemorySchema).max(5),
  }).strict(),
  commercial_state: z.object({
    selected_offering_code: IdentifierSchema.nullable(),
    selected_payment_plan: PaymentPlanSchema.nullable(),
    stage: z.enum(['exploring', 'qualified', 'course_selected', 'plan_selected', 'payment_link_sent', 'handoff', 'closed']),
    call_preference: z.enum(['unknown', 'call', 'chat', 'declined']),
    call_offer_status: z.enum(['not_offered', 'offered', 'accepted', 'declined']),
    call_offer_count: z.union([z.literal(0), z.literal(1), z.literal(2)]),
    awaiting_reply: z.enum(['none', 'area_choice', 'course_choice', 'call_or_chat', 'payment_plan', 'payment_confirmation']),
  }).strict(),
  catalog: z.object({
    selected_offering: z.object({
      code: IdentifierSchema,
      display_name: z.string().trim().min(1).max(240),
      area_code: IdentifierSchema.nullable(),
      facts: z.array(AgentAFactSchema).max(32),
    }).strict().nullable(),
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
    }).strict()).max(3),
    payment_plans: z.array(z.object({
      code: PaymentPlanSchema,
      label: z.string().trim().min(1).max(240),
    }).strict()).max(3),
  }).strict(),
  capabilities: z.object({
    may_reply: z.boolean(),
    may_offer_call: z.boolean(),
    may_request_call_now: z.boolean(),
    may_present_payment_options: z.boolean(),
    may_send_payment_link: z.boolean(),
    authorized_payment_plan: PaymentPlanSchema.nullable(),
  }).strict(),
}).strict();

const ProposedActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('none') }).strict(),
  z.object({ type: z.literal('request_call_now'), reason: z.enum(['direct_request', 'accepted_offer']) }).strict(),
  z.object({
    type: z.literal('send_payment_link'),
    offering_code: IdentifierSchema,
    payment_plan: PaymentPlanSchema,
  }).strict(),
]);

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
    messages: z.union([
      z.tuple([CustomerMessageSchema]),
      z.tuple([CustomerMessageSchema, CustomerMessageSchema]),
      z.tuple([CustomerMessageSchema, CustomerMessageSchema, CustomerMessageSchema]),
    ]),
  }).strict(),
  proposed_action: ProposedActionSchema,
  used_fact_ids: z.array(IdentifierSchema).max(32),
  used_memory_ids: z.array(IdentifierSchema).max(5),
  memory_candidates: z.array(MemoryCandidateSchema).max(10),
}).strict().superRefine((value, context) => {
  if (new Set(value.used_fact_ids).size !== value.used_fact_ids.length) {
    context.addIssue({ code: 'custom', path: ['used_fact_ids'], message: 'DUPLICATE_FACT_ID' });
  }
  if (new Set(value.used_memory_ids).size !== value.used_memory_ids.length) {
    context.addIssue({ code: 'custom', path: ['used_memory_ids'], message: 'DUPLICATE_MEMORY_ID' });
  }
});

export type ParsedAgentAContextV1 = z.infer<typeof AgentAContextV1Schema>;
export type ParsedAgentATurnProposalV1 = z.infer<typeof AgentATurnProposalV1Schema>;
