import { describe, expect, it } from 'vitest';
import type { AgentATurnProposalV1 } from '@/features/conversation/domain/agent-a-brain';
import type { CanonicalFactV1, ConversationStateV1 } from '@/features/conversation/domain/conversation-pipeline';
import { createDefaultConversationStateV1 } from '@/features/conversation/domain/conversation-planner';
import { authorizeAgentTurnV2 } from '@/features/conversation/domain/agent-turn-policy-v2';

const identity = {
  workspace_id: '11111111-1111-4111-8111-111111111111',
  conversation_id: '22222222-2222-4222-8222-222222222222',
  contact_id: '33333333-3333-4333-8333-333333333333',
};

const offerings = [
  { code: 'redes_informaticas', display_name: 'Redes Informáticas', aliases: ['redes'] },
  { code: 'excel_integral', display_name: 'Excel Integral', aliases: ['excel'] },
];

const facts: CanonicalFactV1[] = [
  {
    id: 'offering:redes_informaticas:name:v1', kind: 'offering_name', source: 'business_snapshot',
    value: 'Redes Informáticas', offering_code: 'redes_informaticas',
  },
  {
    id: 'offering:redes_informaticas:duration:v1', kind: 'offering_duration', source: 'business_snapshot',
    value: '16 clases', offering_code: 'redes_informaticas',
  },
  {
    id: 'offering:excel_integral:duration:v1', kind: 'offering_duration', source: 'business_snapshot',
    value: '12 clases', offering_code: 'excel_integral',
  },
  {
    id: 'payment:redes_informaticas:monthly_6:label:v1', kind: 'payment_plan_label',
    source: 'business_snapshot', value: '6 pagos mensuales de USD 60',
    offering_code: 'redes_informaticas', payment_plan: 'monthly_6',
  },
];

function state(overrides: Partial<ConversationStateV1> = {}): ConversationStateV1 {
  return { ...createDefaultConversationStateV1(identity), ...overrides };
}

function proposal(overrides: Partial<AgentATurnProposalV1> = {}): AgentATurnProposalV1 {
  return {
    schema_version: 1,
    move: {
      schema_version: 1,
      move: 'unknown',
      secondary_moves: [],
      vetoes: [],
      confidence: 0.95,
    },
    response: { messages: ['Contame qué querés aprender y te oriento.'] },
    proposed_action: { type: 'none' },
    used_fact_ids: [],
    used_memory_ids: [],
    memory_candidates: [],
    repair_of: null,
    ...overrides,
  };
}

const completeIntake = {
  nombre: 'Matía', apellido: 'Damonte', correo: 'matia@example.com', telefono: '+5491112345678',
};

function authorize(input: {
  proposal: AgentATurnProposalV1;
  state?: ConversationStateV1;
  intake?: typeof completeIntake;
  mayOfferCall?: boolean;
  mayRequestCall?: boolean;
}) {
  return authorizeAgentTurnV2({
    proposal: input.proposal,
    state: input.state ?? state(),
    offerings,
    facts,
    contact_intake: input.intake,
    call_policy: {
      may_offer_call: input.mayOfferCall ?? true,
      may_request_call_now: input.mayRequestCall ?? true,
    },
  });
}

describe('plannerless Agent A authority', () => {
  it('preserves model-owned copy while reducing a canonical course selection', () => {
    const result = authorize({
      proposal: proposal({
        move: {
          schema_version: 1, move: 'select_course', secondary_moves: [], vetoes: [],
          course_reference: 'redes', confidence: 0.98,
        },
        response: { messages: ['Buena elección. Redes te puede servir si buscás una salida práctica.'] },
        used_fact_ids: ['offering:redes_informaticas:name:v1'],
      }),
    });

    expect(result).toMatchObject({
      ok: true,
      response: 'Buena elección. Redes te puede servir si buscás una salida práctica.',
      action: { type: 'none' },
      transition: { selected_offering_code: 'redes_informaticas', stage: 'course_selected' },
    });
  });

  it('rejects a detailed fact from a course other than the resolved course', () => {
    const result = authorize({
      proposal: proposal({
        move: {
          schema_version: 1, move: 'ask_course_information', secondary_moves: [], vetoes: [],
          course_reference: 'redes', confidence: 0.98,
        },
        response: { messages: ['Tiene 12 clases.'] },
        used_fact_ids: ['offering:excel_integral:duration:v1'],
      }),
    });

    expect(result).toEqual({ ok: false, reasons: ['FACT_NOT_AUTHORIZED'] });
  });

  it('drops a false registration claim instead of treating it as conversational truth', () => {
    const result = authorize({
      proposal: proposal({
        response: {
          messages: ['Ya tengo todos tus datos registrados.', 'Todavía me falta tu correo para continuar.'],
        },
      }),
    });

    expect(result).toMatchObject({
      ok: true,
      response: 'Todavía me falta tu correo para continuar.',
    });
  });

  it('rejects an answer left empty after removing a false state assertion', () => {
    const result = authorize({
      proposal: proposal({ response: { messages: ['Ya tengo todos tus datos registrados.'] } }),
    });

    expect(result).toEqual({ ok: false, reasons: ['UNSUPPORTED_STATE_ASSERTION'] });
  });

  it('authorizes a payment link only from canonical state and complete intake', () => {
    const result = authorize({
      state: state({
        selected_offering_code: 'redes_informaticas',
        selected_payment_plan: 'monthly_6',
        stage: 'plan_selected',
      }),
      intake: completeIntake,
      proposal: proposal({
        move: {
          schema_version: 1, move: 'request_payment_link', secondary_moves: [], vetoes: [],
          payment_plan: 'monthly_6', confidence: 0.99,
        },
        response: { messages: ['Perfecto, te comparto el link seguro para continuar.'] },
        proposed_action: {
          type: 'send_payment_link', offering_code: 'redes_informaticas', payment_plan: 'monthly_6',
        },
      }),
    });

    expect(result).toMatchObject({
      ok: true,
      action: { type: 'send_payment_link', offering_code: 'redes_informaticas', payment_plan: 'monthly_6' },
      transition: { stage: 'payment_link_sent', selected_payment_plan: 'monthly_6' },
    });
  });

  it('materializes a requested link from the authorized move when the model omits the side effect', () => {
    const result = authorize({
      state: state({ selected_offering_code: 'redes_informaticas', stage: 'course_selected' }),
      intake: completeIntake,
      proposal: proposal({
        move: {
          schema_version: 1, move: 'select_payment_plan',
          secondary_moves: ['request_payment_link'], vetoes: [],
          payment_plan: 'monthly_6', confidence: 0.99,
        },
        response: { messages: ['Perfecto, avanzamos con esa opción.'] },
        proposed_action: { type: 'none' },
      }),
    });

    expect(result).toMatchObject({
      ok: true,
      action: {
        type: 'send_payment_link',
        offering_code: 'redes_informaticas',
        payment_plan: 'monthly_6',
      },
      transition: { stage: 'payment_link_sent' },
    });
  });

  it('materializes the pending link when the final contact detail completed durable intake', () => {
    const result = authorize({
      state: state({
        selected_offering_code: 'redes_informaticas', selected_payment_plan: 'monthly_6',
        stage: 'plan_selected', awaiting_reply: 'contact_details',
      }),
      intake: completeIntake,
      proposal: proposal({
        move: {
          schema_version: 1, move: 'provide_contact_details', secondary_moves: [], vetoes: [],
          confidence: 0.99,
        },
        response: { messages: ['Gracias, ya está completo.'] },
        proposed_action: { type: 'none' },
      }),
    });

    expect(result).toMatchObject({
      ok: true,
      action: { type: 'send_payment_link', payment_plan: 'monthly_6' },
      transition: { stage: 'payment_link_sent', awaiting_reply: 'none' },
    });
  });

  it('rejects a payment action when durable intake is incomplete', () => {
    const result = authorize({
      state: state({
        selected_offering_code: 'redes_informaticas', selected_payment_plan: 'monthly_6', stage: 'plan_selected',
      }),
      proposal: proposal({
        move: {
          schema_version: 1, move: 'request_payment_link', secondary_moves: [], vetoes: [],
          payment_plan: 'monthly_6', confidence: 0.99,
        },
        proposed_action: {
          type: 'send_payment_link', offering_code: 'redes_informaticas', payment_plan: 'monthly_6',
        },
      }),
    });

    expect(result).toEqual({ ok: false, reasons: ['MISSING_INTAKE'] });
  });

  it('waits for contact details after a link request whose intake is incomplete', () => {
    const result = authorize({
      state: state({ selected_offering_code: 'redes_informaticas', stage: 'course_selected' }),
      proposal: proposal({
        move: {
          schema_version: 1, move: 'select_payment_plan', secondary_moves: ['request_payment_link'],
          vetoes: [], payment_plan: 'monthly_6', confidence: 0.99,
        },
        response: { messages: ['Para avanzar, pasame los datos que faltan.'] },
      }),
    });

    expect(result).toMatchObject({
      ok: true,
      action: { type: 'none' },
      transition: {
        selected_payment_plan: 'monthly_6', stage: 'plan_selected',
        awaiting_reply: 'contact_details',
      },
    });
  });

  it('accepts the link action when contact details complete a pending intake', () => {
    const result = authorize({
      state: state({
        selected_offering_code: 'redes_informaticas', selected_payment_plan: 'monthly_6',
        stage: 'plan_selected', awaiting_reply: 'contact_details',
      }),
      intake: completeIntake,
      proposal: proposal({
        move: {
          schema_version: 1, move: 'provide_contact_details', secondary_moves: [], vetoes: [],
          confidence: 0.99,
        },
        response: { messages: ['Gracias, ya está todo para compartirte el link seguro.'] },
        proposed_action: {
          type: 'send_payment_link', offering_code: 'redes_informaticas', payment_plan: 'monthly_6',
        },
      }),
    });

    expect(result).toMatchObject({
      ok: true,
      action: { type: 'send_payment_link' },
      transition: { stage: 'payment_link_sent', awaiting_reply: 'none' },
    });
  });

  it('counts a visible call offer without letting the backend write its wording', () => {
    const result = authorize({
      state: state({ selected_offering_code: 'redes_informaticas', stage: 'course_selected' }),
      mayOfferCall: true,
      proposal: proposal({
        response: {
          messages: ['Por chat también puedo ayudarte.'],
          call_offer: 'Si preferís, coordinamos una llamada y lo vemos juntos.',
        },
      }),
    });

    expect(result).toMatchObject({
      ok: true,
      response: 'Por chat también puedo ayudarte.\n\nSi preferís, coordinamos una llamada y lo vemos juntos.',
      transition: { call_offer_count: 1, call_offer_status: 'offered', awaiting_reply: 'call_or_chat' },
    });
  });

  it('rejects a third proactive call offer', () => {
    const result = authorize({
      state: state({
        selected_offering_code: 'redes_informaticas', stage: 'course_selected',
        call_offer_count: 2, call_offer_status: 'offered',
      }),
      mayOfferCall: false,
      proposal: proposal({
        response: {
          messages: ['Seguimos por chat.'],
          call_offer: '¿Querés que coordinemos una llamada?',
        },
      }),
    });

    expect(result).toEqual({ ok: false, reasons: ['CALL_OFFER_NOT_AUTHORIZED'] });
  });
});

/**
 * El estado tiene que describir lo que el agente realmente preguntó.
 *
 * Elegir plan fijaba `awaiting_reply = 'payment_confirmation'` aunque el mismo
 * turno pidiera nombre, apellido, correo y teléfono. La conversación seguía
 * pidiendo datos mientras el estado decía que esperaba una confirmación de
 * pago, y como la regla del link exige `awaiting_reply === 'contact_details'`,
 * el turno siguiente entregaba los cuatro datos y NO se mandaba ningún link.
 *
 * Lo encontró el cliente adaptativo, que contesta lo que el agente pregunta en
 * vez de seguir un guion: la persona dio todo y recibió "cuando hagas el pago,
 * avisame" sin un lugar donde pagar. Con guion fijo no se veía, porque el
 * guion decía "mandame el link" explícitamente y eso tomaba otro camino.
 *
 * `payment_confirmation` sólo tiene sentido cuando ya no falta nada por pedir.
 */
describe('esperar los datos cuando todavía faltan', () => {
  it('elegir plan sin intake registrado espera datos de contacto', () => {
    const result = authorize({
      state: state({ selected_offering_code: 'redes_informaticas', stage: 'course_selected' }),
      proposal: proposal({
        move: {
          schema_version: 1, move: 'select_payment_plan', secondary_moves: [], vetoes: [],
          payment_plan: 'monthly_6', confidence: 0.99,
        },
        response: {
          messages: ['¡Excelente! Para dejarlo registrado necesito tu nombre, apellido, correo electrónico y teléfono.'],
        },
      }),
    });

    expect(result).toMatchObject({
      ok: true,
      transition: {
        selected_payment_plan: 'monthly_6', stage: 'plan_selected',
        awaiting_reply: 'contact_details',
      },
    });
  });

  it('con el intake ya registrado sí espera la confirmación del pago', () => {
    const result = authorize({
      state: state({ selected_offering_code: 'redes_informaticas', stage: 'course_selected' }),
      // El hecho `state:intake_recorded:v1` lo materializa la propia política
      // desde el intake completo; no se inyecta desde el test.
      intake: completeIntake,
      proposal: proposal({
        move: {
          schema_version: 1, move: 'select_payment_plan', secondary_moves: [], vetoes: [],
          payment_plan: 'monthly_6', confidence: 0.99,
        },
        response: { messages: ['Listo, quedó el plan de 6 pagos.'] },
      }),
    });

    expect(result).toMatchObject({
      ok: true,
      transition: { awaiting_reply: 'payment_confirmation' },
    });
  });
});
