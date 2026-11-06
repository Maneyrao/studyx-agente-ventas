import { z } from '@botpress/runtime';

/**
 * CommercialTurnPlanV1 — Agent A's own reading of the turn, produced by the
 * model in a separate planning pass before it writes the reply.
 *
 * It is internal working notes only. It never authorizes a fact, a course, a
 * gift or an effect: the backend keeps validating those from the full context.
 * Commercial behavior stays in the canonical prompt; these fields only give
 * the model's reading a structure that the writer receives back.
 */
// Safety caps, looser than the wire-schema hints: the provider treats
// maxLength/maxItems as guidance, and a slightly long note is still a plan.
const PlanText = z.string().trim().min(1).max(800);
const PlanList = z.array(z.string().trim().min(1).max(500)).max(12);

export const COMMERCIAL_NEXT_MOVES = [
  'discover', 'value', 'objection', 'close', 'promo', 'call', 'checkout', 'post_sale', 'other',
] as const;

export const COMMERCIAL_EFFECT_INTENTS = [
  'none', 'send_course_program', 'request_call_now', 'send_payment_link', 'send_test_payment_link',
  'offer_course_bonus', 'accept_promotion', 'other',
] as const;

export const CommercialTurnPlanV1Schema = z.object({
  // Classification of the current customer message under the existing move
  // contract (MOVE_SEMANTICS), made before deciding the commercial move.
  current_move: z.string().trim().min(1).max(60),
  current_request: PlanText,
  course_focus: z.string().trim().min(1).max(120).nullable(),
  customer_goal: PlanText.nullable(),
  known_information: PlanList,
  pending_confirmations: PlanList,
  answered_discovery_topics: PlanList,
  ignored_or_closed_topics: PlanList,
  forbidden_repetitions: PlanList,
  next_commercial_move: z.enum(COMMERCIAL_NEXT_MOVES),
  response_obligations: PlanList,
  proposed_effect_intent: z.enum(COMMERCIAL_EFFECT_INTENTS),
  contact_data_purpose: z.enum(['none', 'identity', 'call', 'payment']),
}).strict();

export type CommercialTurnPlanV1 = z.infer<typeof CommercialTurnPlanV1Schema>;

const list = (description: string) => ({
  type: 'array', maxItems: 8, items: { type: 'string', maxLength: 240 }, description,
});

/** Strict wire schema for the planning pass. Descriptions define fields; they add no sales rule. */
export const COMMERCIAL_TURN_PLAN_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'current_move', 'current_request', 'course_focus', 'customer_goal', 'known_information', 'pending_confirmations', 'answered_discovery_topics',
    'ignored_or_closed_topics', 'forbidden_repetitions', 'next_commercial_move', 'response_obligations',
    'proposed_effect_intent', 'contact_data_purpose',
  ],
  properties: {
    current_move: { type: 'string', description: 'Move of the current customer message, under the existing move contract.' },
    current_request: { type: 'string', maxLength: 400, description: 'What the current customer messages ask or say, every part.' },
    course_focus: { anyOf: [{ type: 'string' }, { type: 'null' }], description: 'Exact canonical offering code in focus, or null.' },
    customer_goal: { anyOf: [{ type: 'string', maxLength: 400 }, { type: 'null' }] },
    known_information: list('What the customer already told or confirmed (level, goal, constraints, data).'),
    pending_confirmations: list('Values the agent proposed or the customer changed that still await an explicit customer confirmation; empty when none.'),
    answered_discovery_topics: list('Discovery topics already answered, with the answer.'),
    ignored_or_closed_topics: list('Questions the agent asked earlier that the customer ignored, answered with uncertainty, or declined.'),
    forbidden_repetitions: list('Questions or content from earlier agent turns that this reply would repeat or rephrase.'),
    next_commercial_move: { type: 'string', enum: [...COMMERCIAL_NEXT_MOVES] },
    response_obligations: list('What this reply does, in order, under the canonical sales behavior.'),
    proposed_effect_intent: { type: 'string', enum: [...COMMERCIAL_EFFECT_INTENTS], description: 'Internal intent only; never an authorization.' },
    contact_data_purpose: { type: 'string', enum: ['none', 'identity', 'call', 'payment'], description: 'If this reply asks for contact data, its profile_requests purpose: payment for enrollment checkout, call for a call, identity otherwise; none when no data is asked.' },
  },
} as const;
