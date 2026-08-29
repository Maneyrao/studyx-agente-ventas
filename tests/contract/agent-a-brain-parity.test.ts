import { describe, expect, it } from 'vitest';
import {
  AgentAContextV1Schema as BackendContextSchema,
  AgentATurnProposalV1Schema as BackendProposalSchema,
} from '@/features/conversation/adapters/agent-a-brain-schema';
import {
  AgentAContextV1Schema as BotpressContextSchema,
  AgentATurnProposalV1Schema as BotpressProposalSchema,
} from '../../botpress-agent/src/schemas/agent-a-brain';

const validContext = {
  schema_version: 1,
  turn: {
    batch_messages: [{ id: 'message-1', text: 'Quiero Redes y prefiero seguir por chat' }],
    recent_turns: [{ id: 'turn-1', direction: 'outbound', content: '¿Preferís llamada o chat?' }],
  },
  customer: {
    display_name: 'Matías',
    memories: [{
      id: 'memory-1',
      type: 'study_goal',
      key: 'career_goal',
      value: 'busca salida laboral',
      confidence: 0.91,
    }],
  },
  commercial_state: {
    selected_offering_code: 'redes-informaticas',
    selected_payment_plan: null,
    stage: 'course_selected',
    call_preference: 'unknown',
    call_offer_status: 'offered',
    call_offer_count: 1,
    awaiting_reply: 'call_or_chat',
  },
  catalog: {
    selected_offering: {
      code: 'redes-informaticas',
      display_name: 'Redes Informáticas',
      area_code: 'tecnologia',
      facts: [
        { id: 'offering:redes-informaticas:name', kind: 'offering_name', value: 'Redes Informáticas' },
      ],
    },
    areas: [{ code: 'tecnologia', fact_id: 'area:tecnologia:name:v1', display_name: 'Tecnología' }],
    candidate_offerings: [],
    payment_plans: [{ code: 'monthly_12', label: '12 pagos mensuales de USD 30' }],
  },
  capabilities: {
    may_reply: true,
    may_offer_call: false,
    may_request_call_now: true,
    may_present_payment_options: true,
    may_send_payment_link: false,
    authorized_payment_plan: null,
  },
} as const;

const validProposal = {
  schema_version: 1,
  move: {
    schema_version: 1,
    move: 'ask_course_information',
    secondary_moves: ['continue_by_chat'],
    vetoes: ['call'],
    course_reference: 'Redes Informáticas',
    confidence: 0.96,
  },
  response: { messages: ['Perfecto, seguimos por chat.', 'Te cuento cómo funciona el curso.'] },
  proposed_action: { type: 'none' },
  used_fact_ids: ['offering:redes-informaticas:name'],
  used_memory_ids: ['memory-1'],
  memory_candidates: [],
} as const;

const contextSchemas = [BackendContextSchema, BotpressContextSchema] as const;
const proposalSchemas = [BackendProposalSchema, BotpressProposalSchema] as const;

describe('Agent A brain schema parity', () => {
  it('accepts the same valid context and compound proposal at both boundaries', () => {
    for (const schema of contextSchemas) expect(schema.safeParse(validContext).success).toBe(true);
    for (const schema of proposalSchemas) expect(schema.safeParse(validProposal).success).toBe(true);
  });

  it.each([
    ['unknown action', { proposed_action: { type: 'enroll_student' } }],
    ['fourth payment plan', { proposed_action: { type: 'send_payment_link', offering_code: 'redes-informaticas', payment_plan: 'monthly_3' } }],
    ['unknown memory type', { memory_candidates: [{ type: 'price', key: 'cost', value: 'USD 360', source_quote: 'cuesta 360', confidence: 0.9 }] }],
    ['missing used memory ids', { used_memory_ids: undefined }],
    ['unexpected field', { internal_reasoning: 'hidden' }],
    ['raw payment URL', { response: { messages: ['Pagá en https://buy.stripe.com/not-authorized'] } }],
  ])('rejects %s at both boundaries', (_label, replacement) => {
    const candidate = { ...validProposal, ...replacement };
    for (const schema of proposalSchemas) expect(schema.safeParse(candidate).success).toBe(false);
  });

  it('rejects unbounded or secret context fields at both boundaries', () => {
    const candidate = { ...validContext, embedding: [0.1, 0.2] };
    for (const schema of contextSchemas) expect(schema.safeParse(candidate).success).toBe(false);
  });
});
