import { describe, expect, it } from 'vitest';
import {
  AgentAContextV1Schema as BackendContextSchema,
  AgentATurnProposalV1Schema as BackendProposalSchema,
} from '@/features/conversation/adapters/agent-a-brain-schema';
import {
  AgentAContextV1Schema as BotpressContextSchema,
  AgentATurnProposalV1Schema as BotpressProposalSchema,
} from '../../botpress-agent/src/schemas/agent-a-brain';
import { TurnRejectionV1Schema as BackendRejectionSchema } from '@/features/conversation/adapters/turn-rejection-schema';
import { TurnRejectionV1Schema as BotpressRejectionSchema } from '../../botpress-agent/src/schemas/turn-rejection';

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
  identity: null,
  commercial_state: {
    selected_offering_code: 'redes-informaticas',
    selected_payment_plan: null,
    stage: 'course_selected',
    call_preference: 'unknown',
    call_offer_status: 'offered',
    call_offer_count: 1,
    awaiting_reply: 'call_or_chat',
    // Se agregó al contrato en 15b444e y este fixture nunca se actualizó. El
    // hueco quedó invisible porque `npm run test:unit` filtra por tests/unit y
    // no corre tests/contract; sólo `npm test` lo alcanza.
    payment_reported: false,
  },
  obligations: { stage: 'course_selected', owes: ['presentation'], not_yet: [] },
  catalog: {
    selected_offering: {
      code: 'redes-informaticas',
      display_name: 'Redes Informáticas',
      area_code: 'tecnologia',
      facts: [
        { id: 'offering:redes-informaticas:name', kind: 'offering_name', value: 'Redes Informáticas' },
      ],
    },
    available_offerings: [],
    areas: [{ code: 'tecnologia', fact_id: 'area:tecnologia:name:v1', display_name: 'Tecnología' }],
    candidate_offerings: [],
    payment_plans: [{ code: 'monthly_12', fact_id: 'payment:redes-informaticas:monthly_12:label:v1', label: '12 pagos mensuales de USD 30' }],
  },
  capabilities: {
    may_reply: true,
    may_offer_call: false,
    may_request_call_now: true,
    may_present_payment_options: true,
    may_send_payment_link: false,
    intake_status: 'known',
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

  it('accepts citations for every course in a 40-offering catalog at both boundaries', () => {
    const usedFactIds = Array.from(
      { length: 40 },
      (_, index) => `offering:curso-${index + 1}:name:v1`,
    );
    const candidate = { ...validProposal, used_fact_ids: usedFactIds };

    for (const schema of proposalSchemas) expect(schema.safeParse(candidate).success).toBe(true);
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

// ─────────────────────────────────────────────────────────────────────────
// Los contratos nuevos entran a la paridad desde el primer commit.
//
// La deriva de espejos ya causó un fallo en producción local: `contact_details`
// quedó en el dominio y no en los contratos, y el estado se persistía sin
// poder leerse de vuelta. El cliente recibía la misma pregunta cada turno.
// ─────────────────────────────────────────────────────────────────────────

describe('paridad de TurnRejectionV1', () => {
  const validRejection = {
    schema_version: 1,
    rejection_id: '00000000-0000-4000-8000-000000000001',
    attempt: 1,
    rejections: [{
      code: 'FACT_NOT_AUTHORIZED',
      subject: 'payment:redes-informaticas:monthly_6:price:v1',
    }],
    authorized_alternatives: {
      fact_ids: ['offering:redes-informaticas:name:v1'],
      actions: [],
      missing_information: ['course_selection'],
    },
  };

  it('ambos espejos aceptan el mismo rechazo válido', () => {
    expect(BackendRejectionSchema.parse(validRejection))
      .toEqual(BotpressRejectionSchema.parse(validRejection));
  });

  it('ambos espejos rechazan un sujeto en prosa', () => {
    const prose = {
      ...validRejection,
      rejections: [{ code: 'COURSE_NOT_RESOLVED', subject: 'pedile que elija un curso' }],
    };
    expect(BackendRejectionSchema.safeParse(prose).success).toBe(false);
    expect(BotpressRejectionSchema.safeParse(prose).success).toBe(false);
  });

  it('ambos espejos rechazan attempt 2: no hay segundo reintento', () => {
    const second = { ...validRejection, attempt: 2 };
    expect(BackendRejectionSchema.safeParse(second).success).toBe(false);
    expect(BotpressRejectionSchema.safeParse(second).success).toBe(false);
  });

  it('ambos espejos exigen al menos un motivo', () => {
    const empty = { ...validRejection, rejections: [] };
    expect(BackendRejectionSchema.safeParse(empty).success).toBe(false);
    expect(BotpressRejectionSchema.safeParse(empty).success).toBe(false);
  });
});

describe('paridad de stage_hypothesis y repair_of', () => {
  it('ambos espejos aceptan una propuesta con los campos nuevos', () => {
    const proposal = {
      ...validProposal,
      stage_hypothesis: 'plan_selected',
      repair_of: { rejection_id: '00000000-0000-4000-8000-000000000001', attempt: 1 },
    };
    expect(BackendProposalSchema.parse(proposal))
      .toEqual(BotpressProposalSchema.parse(proposal));
  });

  it('ambos espejos aceptan una propuesta sin ellos: son opcionales', () => {
    expect(BackendProposalSchema.parse(validProposal))
      .toEqual(BotpressProposalSchema.parse(validProposal));
  });

  it('ambos espejos rechazan repair_of con attempt 2', () => {
    const second = {
      ...validProposal,
      repair_of: { rejection_id: '00000000-0000-4000-8000-000000000001', attempt: 2 },
    };
    expect(BackendProposalSchema.safeParse(second).success).toBe(false);
    expect(BotpressProposalSchema.safeParse(second).success).toBe(false);
  });

  it('ambos espejos rechazan una etapa inventada', () => {
    const invented = { ...validProposal, stage_hypothesis: 'negotiating' };
    expect(BackendProposalSchema.safeParse(invented).success).toBe(false);
    expect(BotpressProposalSchema.safeParse(invented).success).toBe(false);
  });
});
