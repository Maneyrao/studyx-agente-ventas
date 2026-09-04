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
  customerText?: string;
}) {
  return authorizeAgentTurnV2({
    proposal: input.proposal,
    state: input.state ?? state(),
    offerings,
    facts,
    contact_intake: input.intake,
    current_customer_messages: input.customerText ? [input.customerText] : [],
    call_policy: {
      may_offer_call: input.mayOfferCall ?? true,
      may_request_call_now: input.mayRequestCall ?? true,
    },
  });
}

describe('plannerless Agent A authority', () => {
  it('preserves model-owned copy while reducing a canonical course selection', () => {
    const result = authorize({
      mayOfferCall: false, // This fixture isolates course/fact authority when a call is unavailable.
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
      mayOfferCall: false, // This fixture isolates course/fact authority when a call is unavailable.
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

  it.each([
    'Si querés, puedo contarte más en detalle cómo funciona el curso.',
    '¿Preferís que te explique el contenido por acá?',
    'Entendido, seguimos sin llamada.',
  ])('does not spend a call offer or wait for one merely because prose was placed in call_offer: %s', (text) => {
    const result = authorize({
      state: state({ selected_offering_code: 'redes_informaticas', stage: 'course_selected' }),
      mayOfferCall: false,
      proposal: proposal({ response: { messages: ['Puedo ayudarte con el curso.'], call_offer: text } }),
    });
    expect(result).toMatchObject({
      ok: true,
      transition: { call_offer_count: 0, call_offer_status: 'not_offered', awaiting_reply: 'none' },
    });
    if (result.ok) expect(result.response).toContain(text);
  });

  it.each(['¿Querés que coordinemos una llamada?', '¿Hablamos por teléfono?', '¿Quieres que te llame para explicarte el curso?', 'Ya registré tus datos. ¿Hablamos por teléfono?', 'Ya registré tus datos, ¿Hablamos por teléfono?', 'Entendido, seguimos sin llamada. ¿Quieres que te llame para explicarte el curso?'])('rejects a third proactive call offer: %s', (offer) => {
    const result = authorize({
      state: state({
        selected_offering_code: 'redes_informaticas', stage: 'course_selected',
        call_offer_count: 2, call_offer_status: 'offered',
      }),
      mayOfferCall: false,
      proposal: proposal({
        response: {
          messages: ['Seguimos por chat.'],
          call_offer: offer,
        },
      }),
    });

    expect(result).toEqual({ ok: false, reasons: ['CALL_OFFER_NOT_AUTHORIZED'] });
  });
});

// A pending intake carries link consent only after an explicit request.
describe('payment link consent across intake', () => {
  it.each(['continue_by_chat', 'decline_call'] as const)(
    'preserves explicit link consent while the customer chooses %s', (chatMove) => {
      const result = authorize({
        customerText: 'No quiero una llamada, sigamos por chat y mandame el link.',
        state: state({ selected_offering_code: 'redes_informaticas', selected_payment_plan: 'monthly_6' }),
        proposal: proposal({
          move: { schema_version: 1, move: 'request_payment_link', secondary_moves: [chatMove], vetoes: [], confidence: 1 },
          response: { messages: ['Seguimos por acá. ¿Cuál es tu correo?'] },
        }),
      });
      expect(result).toMatchObject({ ok: true, transition: { awaiting_reply: 'contact_details' } });
    },
  );

  it('changing course clears the former plan and pending link consent', () => {
    const result = authorize({
      mayOfferCall: false, // This fixture isolates course/fact authority when a call is unavailable.
      state: state({ selected_offering_code: 'redes_informaticas', selected_payment_plan: 'monthly_6', awaiting_reply: 'contact_details' }),
      intake: completeIntake,
      proposal: proposal({
        move: { schema_version: 1, move: 'select_course', course_reference: 'excel', secondary_moves: ['provide_contact_details'], vetoes: [], confidence: 1 },
        response: { messages: ['Elegiste Excel Integral.'] },
      }),
    });
    expect(result).toMatchObject({
      ok: true, action: { type: 'none' },
      transition: { selected_offering_code: 'excel_integral', selected_payment_plan: null, awaiting_reply: 'none' },
    });
  });

  it('choosing a plan alone persists it without authorizing a link through intake', () => {
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
        awaiting_reply: 'payment_confirmation',
      },
    });
  });

  it('postponement cancels pending link consent before later contact details arrive', () => {
    const initialState = state({
      selected_offering_code: 'redes_informaticas', selected_payment_plan: 'monthly_6',
      stage: 'plan_selected', awaiting_reply: 'contact_details',
    });
    const deferred = authorize({
      customerText: 'Todavía no, prefiero pagar más adelante.',
      state: initialState,
      proposal: proposal({
        move: { schema_version: 1, move: 'defer_payment', secondary_moves: [], vetoes: [], confidence: 1 },
        response: { messages: ['Está bien, podés retomar cuando te quede cómodo.'] },
      }),
    });
    expect(deferred).toMatchObject({ ok: true, transition: { awaiting_reply: 'none' } });
    if (!deferred.ok) throw new Error('Expected safe postponement');
    const details = authorize({
      state: { ...initialState, ...deferred.transition }, intake: completeIntake,
      proposal: proposal({
        move: { schema_version: 1, move: 'provide_contact_details', secondary_moves: [], vetoes: [], confidence: 1 },
        response: { messages: ['Gracias por los datos.'] },
      }),
    });
    expect(details).toMatchObject({ ok: true, action: { type: 'none' } });
  });

  it('rejects a fabricated payment deferral while durable intake is pending', () => {
    const result = authorize({
      customerText: 'Inés',
      state: state({
        selected_offering_code: 'redes_informaticas',
        selected_payment_plan: 'monthly_6',
        stage: 'plan_selected',
        awaiting_reply: 'contact_details',
      }),
      proposal: proposal({
        move: {
          schema_version: 1, move: 'defer_payment', secondary_moves: [],
          vetoes: ['payment_link'], confidence: 0.91,
        },
        response: { messages: ['¡Gracias, Inés!'] },
      }),
    });

    expect(result).toEqual({ ok: false, reasons: ['MISSING_INTAKE'] });
  });

  it('rejects a fabricated purchase decline and keeps durable intake pending', () => {
    const result = authorize({
      customerText: 'Inés',
      state: state({
        selected_offering_code: 'redes_informaticas',
        selected_payment_plan: 'monthly_6',
        stage: 'plan_selected',
        awaiting_reply: 'contact_details',
      }),
      proposal: proposal({
        move: {
          schema_version: 1, move: 'decline_purchase', secondary_moves: [],
          vetoes: ['purchase'], confidence: 0.91,
        },
        response: { messages: ['¡Gracias, Inés!'] },
      }),
    });

    expect(result).toEqual({ ok: false, reasons: ['MISSING_INTAKE'] });
  });

  it('closes the sale only when the current message explicitly declines the purchase', () => {
    const result = authorize({
      customerText: 'No quiero comprar el curso.',
      state: state({
        selected_offering_code: 'redes_informaticas',
        selected_payment_plan: 'monthly_6',
        stage: 'plan_selected',
        awaiting_reply: 'contact_details',
      }),
      proposal: proposal({
        move: {
          schema_version: 1, move: 'decline_purchase', secondary_moves: [],
          vetoes: ['purchase'], confidence: 0.99,
        },
        response: { messages: ['Entiendo. Si más adelante querés retomarlo, escribime.'] },
      }),
    });

    expect(result).toMatchObject({
      ok: true,
      action: { type: 'none' },
      transition: { stage: 'closed', awaiting_reply: 'none' },
    });
  });

  it.each([
    'No quiero comprar ahora.',
    'No me voy a inscribir todavía.',
  ])('treats a time-bounded refusal as deferral without closing the sale: %s', (customerText) => {
    const result = authorize({
      customerText,
      state: state({
        selected_offering_code: 'redes_informaticas',
        selected_payment_plan: 'monthly_6',
        stage: 'plan_selected',
        awaiting_reply: 'contact_details',
      }),
      proposal: proposal({
        move: {
          schema_version: 1, move: 'decline_purchase', secondary_moves: [],
          vetoes: ['purchase'], confidence: 0.99,
        },
        response: { messages: ['Entiendo, podemos retomarlo cuando te quede cómodo.'] },
      }),
    });

    expect(result).toMatchObject({
      ok: true,
      action: { type: 'none' },
      transition: { stage: 'plan_selected', awaiting_reply: 'none' },
    });
  });

  it('checks intake continuation after removing an unsupported state claim', () => {
    const result = authorize({
      customerText: 'Inés',
      state: state({
        selected_offering_code: 'redes_informaticas',
        selected_payment_plan: 'monthly_6',
        stage: 'plan_selected',
        awaiting_reply: 'contact_details',
      }),
      proposal: proposal({
        move: {
          schema_version: 1, move: 'provide_contact_details', secondary_moves: [],
          vetoes: [], confidence: 0.99,
        },
        response: {
          messages: [
            'Gracias, Inés.',
            'Ya tengo tus datos registrados, ¿me pasás tu correo?',
          ],
        },
      }),
    });

    expect(result).toEqual({ ok: false, reasons: ['MISSING_INTAKE'] });
  });

  it('a postponement takes precedence over a conflicting link request', () => {
    const result = authorize({
      customerText: 'Todavía no me mandes el link; prefiero seguir más adelante.',
      state: state({ selected_offering_code: 'redes_informaticas', selected_payment_plan: 'monthly_6' }),
      intake: completeIntake,
      proposal: proposal({
        move: { schema_version: 1, move: 'defer_payment', secondary_moves: ['request_payment_link'], vetoes: [], confidence: 1 },
        response: { messages: ['Podés retomar cuando quieras.'] },
      }),
    });
    expect(result).toMatchObject({ ok: true, action: { type: 'none' } });
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
