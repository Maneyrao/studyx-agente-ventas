import { z } from 'zod';
import {
  AWAITING_REPLIES_V1,
  CALL_OFFER_STATUSES_V1,
  CALL_PREFERENCES_V1,
  CONVERSATION_MOVE_KINDS_V1,
  CONVERSATION_VETOES_V1,
  MISSING_INFORMATION_V1,
  RESPONSE_GOALS_V1,
} from '../domain/conversation-pipeline';

const PaymentPlanSchema = z.enum(['monthly_12', 'monthly_6', 'one_time']);
const MoveKindSchema = z.enum(CONVERSATION_MOVE_KINDS_V1);
const VetoSchema = z.enum(CONVERSATION_VETOES_V1);

const COURSE_REFERENCE_MOVES = new Set([
  'select_course', 'ask_course_information', 'request_call', 'ask_payment_options',
  'select_payment_plan', 'defer_payment', 'request_payment_link', 'decline_purchase',
]);
const AREA_REFERENCE_MOVES = new Set(['browse_catalog', 'select_area']);
const PAYMENT_PLAN_MOVES = new Set(['select_payment_plan', 'defer_payment', 'request_payment_link']);

export const ConversationMoveV1Schema = z.object({
  schema_version: z.literal(1),
  move: MoveKindSchema,
  secondary_moves: z.array(MoveKindSchema).max(2),
  vetoes: z.array(VetoSchema).max(CONVERSATION_VETOES_V1.length),
  course_reference: z.string().trim().min(1).max(128).optional(),
  area_reference: z.string().trim().min(1).max(128).optional(),
  payment_plan: PaymentPlanSchema.optional(),
  confidence: z.number().min(0).max(1),
}).strict().superRefine((value, context) => {
  const secondary = value.secondary_moves;
  if (new Set(secondary).size !== secondary.length || secondary.includes(value.move)) {
    context.addIssue({ code: 'custom', path: ['secondary_moves'], message: 'DUPLICATE_CONVERSATION_MOVE' });
  }
  if (secondary.includes('unknown') || secondary.includes('greeting')) {
    context.addIssue({ code: 'custom', path: ['secondary_moves'], message: 'INVALID_SECONDARY_MOVE' });
  }
  if (new Set(value.vetoes).size !== value.vetoes.length) {
    context.addIssue({ code: 'custom', path: ['vetoes'], message: 'DUPLICATE_VETO' });
  }
  const moves = new Set([value.move, ...secondary]);
  if (value.course_reference && ![...moves].some((move) => COURSE_REFERENCE_MOVES.has(move))) {
    context.addIssue({ code: 'custom', path: ['course_reference'], message: 'COURSE_REFERENCE_NOT_APPLICABLE' });
  }
  if (value.area_reference && ![...moves].some((move) => AREA_REFERENCE_MOVES.has(move))) {
    context.addIssue({ code: 'custom', path: ['area_reference'], message: 'AREA_REFERENCE_NOT_APPLICABLE' });
  }
  if (value.payment_plan && ![...moves].some((move) => PAYMENT_PLAN_MOVES.has(move))) {
    context.addIssue({ code: 'custom', path: ['payment_plan'], message: 'PAYMENT_PLAN_NOT_APPLICABLE' });
  }
});

const CanonicalFactRequestV1Schema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('area_options'), limit: z.union([z.literal(1), z.literal(2), z.literal(3)]) }).strict(),
  z.object({ kind: z.literal('course_options'), area_code: z.string().min(1), limit: z.union([z.literal(1), z.literal(2), z.literal(3)]) }).strict(),
  z.object({ kind: z.enum(['offering_name', 'offering_description', 'offering_duration', 'offering_modality']), offering_code: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('payment_options'), offering_code: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('payment_link'), offering_code: z.string().min(1), payment_plan: PaymentPlanSchema }).strict(),
]);

const AllowedBusinessActionV1Schema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('none') }).strict(),
  z.object({ type: z.literal('request_call_now'), reason: z.enum(['direct_request', 'accepted_offer']) }).strict(),
  z.object({ type: z.literal('send_payment_link'), offering_code: z.string().min(1), payment_plan: PaymentPlanSchema }).strict(),
]);

export const TurnPlanV1Schema = z.object({
  schema_version: z.literal(1),
  next_stage: z.enum(['exploring', 'qualified', 'course_selected', 'plan_selected', 'payment_link_sent', 'handoff', 'closed']),
  response_goal: z.enum(RESPONSE_GOALS_V1),
  canonical_fact_requests: z.array(CanonicalFactRequestV1Schema),
  allowed_business_action: AllowedBusinessActionV1Schema,
  missing_information: z.array(z.enum(MISSING_INFORMATION_V1)),
  should_offer_call: z.boolean(),
  next_call_preference: z.enum(CALL_PREFERENCES_V1),
  next_call_offer_status: z.enum(CALL_OFFER_STATUSES_V1),
  next_awaiting_reply: z.enum(AWAITING_REPLIES_V1),
  selected_offering_code: z.string().min(1).nullable(),
  selected_payment_plan: PaymentPlanSchema.nullable(),
}).strict();

export const CanonicalFactRefV1Schema = z.object({
  id: z.string().min(1),
  kind: z.enum([
    'area_name', 'offering_name', 'offering_description', 'offering_duration',
    'offering_modality', 'payment_plan_label', 'payment_plan_price', 'payment_link',
  ]),
  offering_code: z.string().min(1).optional(),
  payment_plan: PaymentPlanSchema.optional(),
}).strict();

export const ComposedNarrativeV1Schema = z.object({
  schema_version: z.literal(1),
  narrative: z.object({
    opening: z.string().trim().min(1).max(600),
    explanation: z.string().trim().min(1).max(1_200).nullable(),
    next_question: z.string().trim().min(1).max(400).nullable(),
  }).strict(),
  used_fact_ids: z.array(z.string().min(1)).max(32),
}).strict().superRefine((value, context) => {
  if (new Set(value.used_fact_ids).size !== value.used_fact_ids.length) {
    context.addIssue({ code: 'custom', path: ['used_fact_ids'], message: 'DUPLICATE_FACT_ID' });
  }
});

export const ConversationPipelineCommitV1Schema = z.object({
  move: ConversationMoveV1Schema,
  plan_hash: z.string().regex(/^[a-f0-9]{64}$/),
  composition: ComposedNarrativeV1Schema,
}).strict();

export type ParsedConversationMoveV1 = z.infer<typeof ConversationMoveV1Schema>;
export type ParsedConversationPipelineCommitV1 = z.infer<typeof ConversationPipelineCommitV1Schema>;
