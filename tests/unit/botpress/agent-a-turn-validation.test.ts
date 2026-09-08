import { describe, expect, it } from 'vitest';
import {
  removeRepeatedAgentQuestionMessagesV1,
  validateAgentATurnProposalV1,
} from '../../../botpress-agent/src/lib/conversation/agent-a-brain';
import type { AgentAContextV1, AgentATurnProposalV1 } from '../../../botpress-agent/src/schemas/agent-a-brain';

/**
 * V1–V7 dejan de podar en silencio y devuelven un motivo estructurado.
 *
 * La composición sigue existiendo y sigue podando: lo que cambia es que la
 * poda ya no es la ÚNICA respuesta posible a un rechazo. Un rechazo no podable
 * —una acción sin precondición— ahora puede abrir una reparación en vez de
 * degradar el turno a una frase fija.
 */

function context(overrides: Partial<AgentAContextV1> = {}): AgentAContextV1 {
  return {
    schema_version: 1,
    turn: { batch_messages: [{ id: 'm1', text: 'quiero avanzar' }], recent_turns: [] },
    customer: { display_name: null, memories: [] },
    identity: null,
    commercial_state: {
      selected_offering_code: 'redes-informaticas',
      selected_payment_plan: null,
      stage: 'course_selected',
      call_preference: 'unknown',
      call_offer_status: 'not_offered',
      call_offer_count: 0,
      awaiting_reply: 'none',
      payment_reported: false,
    },
    catalog: {
      available_offerings: [],
      selected_offering: {
        code: 'redes-informaticas',
        display_name: 'Redes Informáticas',
        area_code: 'tecnologia',
        facts: [{
          id: 'offering:redes-informaticas:name:v1',
          kind: 'offering_name',
          value: 'Redes Informáticas',
        }],
      },
      areas: [],
      candidate_offerings: [],
      payment_plans: [],
    },
    capabilities: {
      may_reply: true,
      may_offer_call: false,
      may_request_call_now: false,
      may_present_payment_options: true,
      may_send_payment_link: false,
      intake_status: 'known',
      authorized_payment_plan: null,
      intake_missing: ['apellido', 'correo'],
    },
    ...overrides,
  } as AgentAContextV1;
}

function proposal(overrides: Partial<AgentATurnProposalV1> = {}): AgentATurnProposalV1 {
  return {
    schema_version: 1,
    move: { schema_version: 1, move: 'ask_course_information', secondary_moves: [], vetoes: [], confidence: 0.9 },
    response: { messages: ['Te cuento de Redes Informáticas.'], call_offer: null },
    proposed_action: { type: 'none' },
    used_fact_ids: ['offering:redes-informaticas:name:v1'],
    used_memory_ids: [],
    memory_candidates: [],
    repair_of: null,
    ...overrides,
  } as AgentATurnProposalV1;
}

describe('validación de la propuesta del turno', () => {
  it('una propuesta válida no produce rechazo', () => {
    expect(validateAgentATurnProposalV1({
      proposal: proposal(),
      context: context(),
      planned_fact_ids: ['offering:redes-informaticas:name:v1'],
      rejection_id: '00000000-0000-4000-8000-000000000001',
    })).toBeNull();
  });

  it('rechaza una oferta inicial de llamada embebida para que el modelo la reescriba separada', () => {
    const rejection = validateAgentATurnProposalV1({
      proposal: proposal({
        response: {
          messages: ['Te cuento de Redes Informáticas. Si querés, coordinamos una llamada.'],
          call_offer: null,
        },
      }),
      context: context({
        capabilities: { ...context().capabilities, may_offer_call: true },
      }),
      planned_fact_ids: ['offering:redes-informaticas:name:v1'],
      rejection_id: '00000000-0000-4000-8000-000000000001',
    });
    expect(rejection?.rejections).toContainEqual({
      code: 'CALL_OFFER_MESSAGE_BOUNDARY_INVALID', subject: 'call_offer',
    });
  });

  it('rechaza dos mensajes informativos antes de la primera oferta separada de llamada', () => {
    const rejection = validateAgentATurnProposalV1({
      proposal: proposal({
        response: {
          messages: ['Te cuento de Redes Informáticas.', 'Tiene 16 clases.'],
          call_offer: 'Si querés, puedo llamarte para orientarte.',
        },
      }),
      context: context({
        capabilities: { ...context().capabilities, may_offer_call: true },
      }),
      planned_fact_ids: ['offering:redes-informaticas:name:v1'],
      rejection_id: '00000000-0000-4000-8000-000000000001',
    });
    expect(rejection?.rejections).toContainEqual({
      code: 'CALL_OFFER_MESSAGE_BOUNDARY_INVALID', subject: 'call_offer',
    });
  });

  // V2
  it('citar un hecho que el turno no materializó es FACT_NOT_AUTHORIZED', () => {
    const rejection = validateAgentATurnProposalV1({
      proposal: proposal({ used_fact_ids: ['payment:redes-informaticas:monthly_6:price:v1'] }),
      context: context(),
      planned_fact_ids: ['offering:redes-informaticas:name:v1'],
      rejection_id: '00000000-0000-4000-8000-000000000001',
    });
    expect(rejection!.rejections.map((entry) => entry.code)).toContain('FACT_NOT_AUTHORIZED');
    expect(rejection!.rejections[0]!.subject)
      .toBe('payment:redes-informaticas:monthly_6:price:v1');
  });

  // V3
  it('rechaza un precio escrito sin ningún hecho materializado aunque el modelo omita la cita', () => {
    const rejection = validateAgentATurnProposalV1({
      proposal: proposal({
        response: {
          messages: ['El valor total del programa es USD 360.'],
          call_offer: null,
        },
        used_fact_ids: [],
      }),
      context: context({
        commercial_state: {
          ...context().commercial_state,
          selected_offering_code: null,
          stage: 'exploring',
        },
        catalog: {
          available_offerings: [],
          selected_offering: null,
          areas: [],
          candidate_offerings: [],
          payment_plans: [],
        },
      }),
      planned_fact_ids: [],
      rejection_id: '00000000-0000-4000-8000-000000000001',
    });

    expect(rejection!.rejections).toContainEqual({
      code: 'FACT_VALUE_MISMATCH',
      subject: 'price',
    });
  });

  it('acepta el precio exacto cuando el planner materializó y el modelo citó ese hecho', () => {
    const paymentFactId = 'payment:redes-informaticas:monthly_6:price:v1';
    const rejection = validateAgentATurnProposalV1({
      proposal: proposal({
        response: {
          messages: ['Podés elegir 6 pagos mensuales de USD 60.'],
          call_offer: null,
        },
        used_fact_ids: [paymentFactId],
      }),
      context: context({
        catalog: {
          ...context().catalog,
          payment_plans: [{
            fact_id: paymentFactId,
            code: 'monthly_6',
            label: '6 pagos mensuales de USD 60',
          }],
        },
      }),
      planned_fact_ids: [paymentFactId],
      rejection_id: '00000000-0000-4000-8000-000000000001',
    });

    expect(rejection).toBeNull();
  });

  // V4
  it('pedir el link sin plan seleccionado es ACTION_NOT_AUTHORIZED', () => {
    const rejection = validateAgentATurnProposalV1({
      proposal: proposal({
        proposed_action: {
          type: 'send_payment_link',
          offering_code: 'redes-informaticas',
          payment_plan: 'monthly_6',
        },
      }),
      context: context(),
      planned_fact_ids: ['offering:redes-informaticas:name:v1'],
      rejection_id: '00000000-0000-4000-8000-000000000001',
    });
    expect(rejection!.rejections.map((entry) => entry.code)).toContain('ACTION_NOT_AUTHORIZED');
  });

  // V6
  it('texto informativo en call_offer no consume ni exige permiso de llamada', () => {
    const rejection = validateAgentATurnProposalV1({
      proposal: proposal({ response: { messages: ['Bien.'], call_offer: 'Si querés, puedo contarte más en detalle cómo funciona el curso.' } }),
      context: context({ capabilities: { ...context().capabilities, may_offer_call: false } }),
      planned_fact_ids: ['offering:redes-informaticas:name:v1'],
      rejection_id: '00000000-0000-4000-8000-000000000001',
    });
    expect(rejection).toBeNull();
  });

  it('rechaza select_course sin una referencia canónica aunque nombre opciones reales', () => {
    const discovery = context({
      commercial_state: {
        ...context().commercial_state,
        selected_offering_code: null,
        stage: 'exploring',
      },
      catalog: {
        available_offerings: [
          { code: 'ingles_1', fact_id: 'offering:ingles_1:name:v1', display_name: 'Inglés 1', area_code: 'idiomas' },
          { code: 'ingles_2', fact_id: 'offering:ingles_2:name:v1', display_name: 'Inglés 2', area_code: 'idiomas' },
          { code: 'ingles_3', fact_id: 'offering:ingles_3:name:v1', display_name: 'Inglés 3', area_code: 'idiomas' },
        ],
        selected_offering: null,
        areas: [],
        candidate_offerings: [],
        payment_plans: [],
      },
      capabilities: { ...context().capabilities, may_offer_call: true },
    });
    const facts = discovery.catalog.available_offerings.map((offering) => offering.fact_id);
    const rejection = validateAgentATurnProposalV1({
      proposal: proposal({
        move: {
          schema_version: 1, move: 'select_course', secondary_moves: [], vetoes: [], confidence: 1,
        },
        response: {
          messages: ['Tenemos Inglés 1, Inglés 2 e Inglés 3.'],
          call_offer: '¿Te gustaría que te llame para identificar tu nivel?',
        },
        used_fact_ids: facts,
      }),
      context: discovery,
      planned_fact_ids: facts,
      rejection_id: '00000000-0000-4000-8000-000000000001',
    });

    expect(rejection?.rejections).toContainEqual({
      code: 'COURSE_NOT_RESOLVED',
      subject: 'course_reference',
    });
  });

  it('rechaza una exploración ambigua que omite opciones canónicas resueltas', () => {
    const discovery = context({
      commercial_state: {
        ...context().commercial_state,
        selected_offering_code: null,
        stage: 'exploring',
      },
      catalog: {
        available_offerings: [],
        selected_offering: null,
        areas: [],
        candidate_offerings: [
          { code: 'ingles_1', fact_id: 'offering:ingles_1:name:v1', display_name: 'Inglés 1', area_code: 'idiomas' },
          { code: 'ingles_2', fact_id: 'offering:ingles_2:name:v1', display_name: 'Inglés 2', area_code: 'idiomas' },
          { code: 'ingles_3', fact_id: 'offering:ingles_3:name:v1', display_name: 'Inglés 3', area_code: 'idiomas' },
        ],
        payment_plans: [],
      },
      capabilities: { ...context().capabilities, may_offer_call: true },
    });
    const rejection = validateAgentATurnProposalV1({
      proposal: proposal({
        move: { schema_version: 1, move: 'browse_catalog', secondary_moves: [], vetoes: [], confidence: 1 },
        response: {
          messages: ['Tenemos Inglés 1. ¿Desde qué nivel te gustaría empezar?'],
          call_offer: 'Si querés, puedo llamarte para ayudarte a elegir.',
        },
        used_fact_ids: ['offering:ingles_1:name:v1'],
      }),
      context: discovery,
      planned_fact_ids: ['offering:ingles_1:name:v1'],
      rejection_id: '00000000-0000-4000-8000-000000000001',
    });

    expect(rejection?.rejections).toContainEqual({
      code: 'COURSE_NOT_RESOLVED', subject: 'candidate_offerings',
    });
  });

  it('rechaza una recomendación de catálogo que termina sin siguiente paso útil', () => {
    const discovery = context({
      commercial_state: {
        ...context().commercial_state,
        selected_offering_code: null,
        stage: 'exploring',
      },
      catalog: {
        available_offerings: [{
          code: 'marketing_digital',
          fact_id: 'offering:marketing_digital:name:v1',
          display_name: 'Marketing Digital',
          area_code: 'marketing',
        }],
        selected_offering: null,
        areas: [],
        candidate_offerings: [],
        payment_plans: [],
      },
    });
    const fact = discovery.catalog.available_offerings[0]!.fact_id;
    const rejection = validateAgentATurnProposalV1({
      proposal: proposal({
        move: {
          schema_version: 1, move: 'browse_catalog', secondary_moves: [], vetoes: [], confidence: 1,
        },
        response: {
          messages: ['No tenemos Derecho. Te recomiendo Marketing Digital para mejorar tu salida laboral.'],
          call_offer: null,
        },
        used_fact_ids: [fact],
      }),
      context: discovery,
      planned_fact_ids: [fact],
      rejection_id: '00000000-0000-4000-8000-000000000001',
    });

    expect(rejection?.rejections).toContainEqual({
      code: 'COURSE_NOT_RESOLVED',
      subject: 'next_step',
    });
  });

  it('rechaza logística de cursada que no aparece en los hechos autorizados', () => {
    const selected = context({
      commercial_state: {
        ...context().commercial_state,
        selected_offering_code: 'excel_integral',
        stage: 'course_selected',
        call_offer_count: 1,
        call_offer_status: 'offered',
      },
      catalog: {
        available_offerings: [],
        selected_offering: {
          code: 'excel_integral',
          display_name: 'Excel Integral',
          area_code: 'negocios',
          facts: [
            { id: 'offering:excel_integral:duration:v1', kind: 'offering_duration', value: '17 clases' },
            { id: 'offering:excel_integral:modality:v1', kind: 'offering_modality', value: 'online' },
          ],
        },
        areas: [],
        candidate_offerings: [],
        payment_plans: [],
      },
    });
    const factIds = selected.catalog.selected_offering!.facts.map((fact) => fact.id);
    const rejection = validateAgentATurnProposalV1({
      proposal: proposal({
        move: {
          schema_version: 1, move: 'ask_course_information', secondary_moves: [], vetoes: [],
          course_reference: 'excel_integral', confidence: 1,
        },
        response: {
          messages: ['Son 17 clases online y avanzás a tu ritmo: la plataforma queda disponible 24/7 por varios meses, sin una fecha fija para terminar.'],
          call_offer: null,
        },
        used_fact_ids: factIds,
      }),
      context: selected,
      planned_fact_ids: factIds,
      rejection_id: '00000000-0000-4000-8000-000000000001',
    });

    expect(rejection?.rejections).toContainEqual({
      code: 'FACT_VALUE_MISMATCH',
      subject: 'course_logistics',
    });
  });

  it.each([
    'La clase en vivo es semanal y queda grabada.',
    'Las clases en vivo quedan grabadas y accedés a la plataforma cuando quieras.',
  ])('rechaza logística de vivo, grabación o acceso libre no autorizada: %s', (message) => {
    const selected = context({
      commercial_state: {
        ...context().commercial_state,
        selected_offering_code: 'energia_solar_fotovoltaica',
        call_offer_count: 1,
        call_offer_status: 'offered',
      },
      catalog: {
        available_offerings: [],
        selected_offering: {
          code: 'energia_solar_fotovoltaica',
          display_name: 'Energía Solar Fotovoltaica',
          area_code: 'oficios',
          facts: [
            { id: 'offering:energia_solar_fotovoltaica:name:v1', kind: 'offering_name', value: 'Energía Solar Fotovoltaica' },
            { id: 'offering:energia_solar_fotovoltaica:duration:v1', kind: 'offering_duration', value: '8 clases' },
            { id: 'offering:energia_solar_fotovoltaica:modality:v1', kind: 'offering_modality', value: 'online' },
          ],
        },
        areas: [],
        candidate_offerings: [],
        payment_plans: [],
      },
    });
    const factIds = selected.catalog.selected_offering!.facts.map((fact) => fact.id);
    const rejection = validateAgentATurnProposalV1({
      proposal: proposal({ response: { messages: [message], call_offer: null }, used_fact_ids: factIds }),
      context: selected,
      planned_fact_ids: factIds,
      rejection_id: '00000000-0000-4000-8000-000000000001',
    });

    expect(rejection?.rejections).toContainEqual({
      code: 'FACT_VALUE_MISMATCH',
      subject: 'course_logistics',
    });
  });

  it('rechaza repetir literalmente la invitación de llamada anterior', () => {
    const previousOffer = 'Si querés, podemos coordinar una llamada breve para contarte los detalles del curso.';
    const current = context({
      turn: {
        batch_messages: [{ id: 'm2', text: 'Cambié a Community Manager.' }],
        recent_turns: [
          { id: 'r1', direction: 'inbound', content: 'Quiero Marketing Digital.' },
          { id: 'r2', direction: 'outbound', content: `Marketing Digital tiene 16 clases.\n\n${previousOffer}` },
        ],
      },
      commercial_state: {
        ...context().commercial_state,
        call_offer_count: 1,
        call_offer_status: 'offered',
      },
      capabilities: { ...context().capabilities, may_offer_call: true },
    });
    const rejection = validateAgentATurnProposalV1({
      proposal: proposal({
        response: { messages: ['Community Manager tiene 16 clases.'], call_offer: previousOffer },
      }),
      context: current,
      planned_fact_ids: ['offering:redes-informaticas:name:v1'],
      rejection_id: '00000000-0000-4000-8000-000000000001',
    });

    expect(rejection?.rejections).toContainEqual({
      code: 'REPEATED_AGENT_REPLY',
      subject: 'previous_call_offer',
    });
  });

  it.each(['¿Te llamo?', '¿Hablamos por teléfono?', '¿Quieres que te llame para explicarte el curso?', 'Ya registré tus datos. ¿Hablamos por teléfono?', 'Ya registré tus datos, ¿Hablamos por teléfono?', 'Entendido, seguimos sin llamada. ¿Quieres que te llame para explicarte el curso?'])('una tercera oferta de llamada es CALL_BUDGET_EXHAUSTED: %s', (offer) => {
    const rejection = validateAgentATurnProposalV1({
      proposal: proposal({ response: { messages: ['Bien.'], call_offer: offer } }),
      context: context({
        commercial_state: { ...context().commercial_state, call_offer_count: 2 },
        capabilities: { ...context().capabilities, may_offer_call: false },
      }),
      planned_fact_ids: ['offering:redes-informaticas:name:v1'],
      rejection_id: '00000000-0000-4000-8000-000000000001',
    });
    expect(rejection!.rejections.map((entry) => entry.code)).toContain('CALL_BUDGET_EXHAUSTED');
  });

  // V7
  it('una URL escrita por el modelo es rechazo, no poda silenciosa', () => {
    const rejection = validateAgentATurnProposalV1({
      proposal: proposal({
        response: { messages: ['Pagá acá: https://buy.stripe.com/inventado'], call_offer: null },
      }),
      context: context(),
      planned_fact_ids: ['offering:redes-informaticas:name:v1'],
      rejection_id: '00000000-0000-4000-8000-000000000001',
    });
    expect(rejection).not.toBeNull();
  });

  it('acumula todos los motivos antes de responder', () => {
    // Orden fijo, pero se acumulan: devolver sólo el primero obligaría al
    // modelo a reparar de a un motivo por vez, y sólo hay una reparación.
    const rejection = validateAgentATurnProposalV1({
      proposal: proposal({
        used_fact_ids: ['payment:x:monthly_6:price:v1'],
        proposed_action: {
          type: 'send_payment_link',
          offering_code: 'redes-informaticas',
          payment_plan: 'monthly_6',
        },
      }),
      context: context(),
      planned_fact_ids: ['offering:redes-informaticas:name:v1'],
      rejection_id: '00000000-0000-4000-8000-000000000001',
    });
    expect(rejection!.rejections.length).toBeGreaterThanOrEqual(2);
  });

  it('las alternativas autorizadas dicen qué SÍ puede citar y pedir', () => {
    const rejection = validateAgentATurnProposalV1({
      proposal: proposal({ used_fact_ids: ['payment:x:monthly_6:price:v1'] }),
      context: context(),
      planned_fact_ids: ['offering:redes-informaticas:name:v1'],
      rejection_id: '00000000-0000-4000-8000-000000000001',
    });
    expect(rejection!.authorized_alternatives.fact_ids)
      .toContain('offering:redes-informaticas:name:v1');
    expect(rejection!.authorized_alternatives.missing_information)
      .toEqual(expect.arrayContaining(['apellido', 'correo']));
  });

  it('ningún sujeto es prosa', () => {
    // A4: si esto se rompe, el backend estaría redactando por la ventana de
    // atrás y el modelo recibiría instrucciones de texto.
    const rejection = validateAgentATurnProposalV1({
      proposal: proposal({
        used_fact_ids: ['payment:x:monthly_6:price:v1'],
        proposed_action: {
          type: 'send_payment_link',
          offering_code: 'redes-informaticas',
          payment_plan: 'monthly_6',
        },
      }),
      context: context(),
      planned_fact_ids: ['offering:redes-informaticas:name:v1'],
      rejection_id: '00000000-0000-4000-8000-000000000001',
    });
    for (const reason of rejection!.rejections) {
      expect(reason.subject).not.toMatch(/\s/u);
    }
  });
});

/**
 * V8 — un borrador idéntico al último mensaje del agente.
 *
 * `base_20_withholds_data` y `base_09_transfer` fallan igual en todas las
 * corridas: dos turnos consecutivos reciben el mismo trío (move, objetivo,
 * hechos), y con eso el modelo devuelve el turno anterior carácter por
 * carácter. La regla de continuidad del prompt bajó la repetición a la mitad
 * pero no la elimina, porque cuando el material autorizado es idéntico repetir
 * es la salida más probable.
 *
 * El backend no puede reescribir la copia —eso lo prohíbe A3— pero sí puede
 * rechazar: devolver el mismo mensaje no es contestar, y la reparación es
 * exactamente el mecanismo que ya existe para un borrador inaceptable.
 */
describe('intake parcial observable', () => {
  it('rechaza afirmar que un dato quedó registrado mientras faltan campos', () => {
    const current = context({
      commercial_state: { ...context().commercial_state, awaiting_reply: 'contact_details' },
      capabilities: { ...context().capabilities, may_offer_call: false, intake_missing: ['apellido', 'correo'] },
    });
    const rejection = validateAgentATurnProposalV1({
      proposal: proposal({
        move: { schema_version: 1, move: 'provide_contact_details', secondary_moves: [], vetoes: [], confidence: 1 },
        response: { messages: ['Quedó registrado tu nombre. ¿Me pasás tu apellido y correo?'], call_offer: null },
        used_fact_ids: [],
      }), context: current, planned_fact_ids: [],
      rejection_id: '11111111-1111-4111-8111-111111111111',
    });
    expect(rejection?.rejections).toContainEqual({ code: 'UNSUPPORTED_OPERATIONAL_CLAIM', subject: 'contact_details' });
  });

  it('permite aclarar que un dato todavía no quedó registrado', () => {
    const current = context({
      commercial_state: { ...context().commercial_state, awaiting_reply: 'contact_details' },
      capabilities: { ...context().capabilities, may_offer_call: false, intake_missing: ['apellido', 'correo'] },
    });
    const rejection = validateAgentATurnProposalV1({
      proposal: proposal({
        move: { schema_version: 1, move: 'provide_contact_details', secondary_moves: [], vetoes: [], confidence: 1 },
        response: { messages: ['Todavía no tengo registrado tu apellido. ¿Me lo pasás junto con tu correo?'], call_offer: null },
        used_fact_ids: [],
      }), context: current, planned_fact_ids: [],
      rejection_id: '11111111-1111-4111-8111-111111111111',
    });
    expect(rejection?.rejections ?? []).not.toContainEqual({ code: 'UNSUPPORTED_OPERATIONAL_CLAIM', subject: 'contact_details' });
  });

  it('no confunde el propósito de pedir datos con afirmar que ya fueron registrados', () => {
    const current = context({
      commercial_state: {
        ...context().commercial_state,
        selected_payment_plan: 'one_time',
        stage: 'plan_selected',
        awaiting_reply: 'contact_details',
      },
      capabilities: {
        ...context().capabilities,
        authorized_payment_plan: 'one_time',
        intake_missing: ['nombre', 'apellido', 'correo', 'telefono'],
      },
    } as Partial<AgentAContextV1>);
    const rejection = validateAgentATurnProposalV1({
      proposal: proposal({
        move: {
          schema_version: 1, move: 'request_payment_link', secondary_moves: [],
          vetoes: [], payment_plan: 'one_time', confidence: 1,
        },
        response: {
          messages: ['Para dejarlo registrado necesito tu nombre, apellido, correo electrónico y teléfono.'],
          call_offer: null,
        },
        used_fact_ids: [],
      }),
      context: current,
      planned_fact_ids: [],
      rejection_id: '11111111-1111-4111-8111-111111111111',
    });

    expect(rejection).toBeNull();
  });
});

describe('V8 respuesta repetida', () => {
  const previous = 'Entiendo, no hay problema. Quedo a disposición.';

  function withPrevious(messages: [string]) {
    return validateAgentATurnProposalV1({
      proposal: proposal({
        response: { messages, call_offer: null },
        used_fact_ids: [],
      }),
      context: context({
        turn: {
          batch_messages: [{ id: 'm2', text: '¿Igual me podés anotar?' }],
          recent_turns: [
            { id: 'r1', direction: 'inbound', content: 'No te voy a dar mis datos' },
            { id: 'r2', direction: 'outbound', content: previous },
          ],
        },
      } as Partial<AgentAContextV1>),
      planned_fact_ids: [],
      rejection_id: '11111111-1111-4111-8111-111111111111',
    });
  }

  it('rechaza un borrador igual al último mensaje del agente', () => {
    const rejection = withPrevious([previous]);
    expect(rejection?.rejections.map((r) => r.code)).toContain('REPEATED_AGENT_REPLY');
  });

  it('ignora diferencias de espaciado, que no cambian lo que el cliente lee', () => {
    const rejection = withPrevious(['Entiendo,  no hay problema.\n Quedo a disposición. ']);
    expect(rejection?.rejections.map((r) => r.code)).toContain('REPEATED_AGENT_REPLY');
  });

  it('no rechaza una respuesta que dice algo distinto', () => {
    const rejection = withPrevious(['Sin tus datos no puedo dejarte anotado.']);
    expect(rejection?.rejections.map((r) => r.code) ?? []).not.toContain('REPEATED_AGENT_REPLY');
  });

  it('rechaza repetir la misma pregunta aunque el resto de la respuesta cambie', () => {
    const rejection = validateAgentATurnProposalV1({
      proposal: proposal({
        response: {
          messages: [
            'La formación se cursa online.',
            '¿Ya tenías pensado estudiar maquillaje o recién estás empezando a averiguar?',
          ],
          call_offer: null,
        },
        used_fact_ids: [],
      }),
      context: context({
        turn: {
          batch_messages: [{ id: 'm2', text: '¿Cuánto dura la formación?' }],
          recent_turns: [{
            id: 'r1',
            direction: 'outbound',
            content: 'Perfecto. ¿Ya tenías pensado estudiar maquillaje o recién estás empezando a averiguar?',
          }],
        },
      } as Partial<AgentAContextV1>),
      planned_fact_ids: [],
      rejection_id: '11111111-1111-4111-8111-111111111111',
    });

    expect(rejection?.rejections).toContainEqual({
      code: 'REPEATED_AGENT_REPLY',
      subject: 'previous_agent_question',
    });
  });

  it('no permite afirmar que no hay requisitos cuando el catálogo no lo dice', () => {
    const rejection = validateAgentATurnProposalV1({
      proposal: proposal({
        response: { messages: ['No necesitás experiencia previa para arrancar.'], call_offer: null },
        used_fact_ids: [],
      }),
      context: context({
        turn: {
          batch_messages: [{ id: 'm2', text: '¿Qué necesito para arrancar?' }],
          recent_turns: [],
        },
      } as Partial<AgentAContextV1>),
      planned_fact_ids: [],
      rejection_id: '11111111-1111-4111-8111-111111111111',
    });

    expect(rejection?.rejections).toContainEqual({
      code: 'FACT_VALUE_MISMATCH',
      subject: 'prerequisites',
    });
  });

  it('acepta reconocer que los requisitos no están confirmados', () => {
    const rejection = validateAgentATurnProposalV1({
      proposal: proposal({
        response: {
          messages: ['Los requisitos previos no están especificados en la información confirmada.'],
          call_offer: null,
        },
        used_fact_ids: [],
      }),
      context: context({
        turn: {
          batch_messages: [{ id: 'm2', text: '¿Qué necesito para arrancar?' }],
          recent_turns: [],
        },
      } as Partial<AgentAContextV1>),
      planned_fact_ids: [],
      rejection_id: '11111111-1111-4111-8111-111111111111',
    });

    expect(rejection).toBeNull();
  });

  it('exige guiar al siguiente dato cuando el intake sigue incompleto', () => {
    const current = context({
      commercial_state: {
        ...context().commercial_state,
        selected_payment_plan: 'monthly_12',
        stage: 'plan_selected',
        awaiting_reply: 'contact_details',
      },
      capabilities: {
        ...context().capabilities,
        may_send_payment_link: true,
        intake_status: 'known',
        authorized_payment_plan: 'monthly_12',
        intake_missing: ['correo'],
      },
      turn: {
        batch_messages: [{ id: 'm2', text: 'Soy Nadia Ferrer' }],
        recent_turns: [],
      },
    } as Partial<AgentAContextV1>);
    const rejection = validateAgentATurnProposalV1({
      proposal: proposal({
        move: {
          schema_version: 1,
          move: 'provide_contact_details',
          secondary_moves: [],
          vetoes: [],
          confidence: 1,
        },
        response: { messages: ['Gracias, Nadia.'], call_offer: null },
        used_fact_ids: [],
      }),
      context: current,
      planned_fact_ids: [],
      rejection_id: '11111111-1111-4111-8111-111111111111',
    });

    expect(rejection?.rejections).toContainEqual({
      code: 'MISSING_INTAKE',
      subject: 'correo',
    });
  });

  it('no deja que una postergación inventada anule el intake persistido', () => {
    const current = context({
      commercial_state: {
        ...context().commercial_state,
        selected_payment_plan: 'one_time',
        stage: 'plan_selected',
        awaiting_reply: 'contact_details',
      },
      capabilities: {
        ...context().capabilities,
        authorized_payment_plan: 'one_time',
        intake_missing: ['apellido', 'correo', 'telefono'],
      },
      turn: {
        batch_messages: [{ id: 'm2', text: 'Inés' }],
        recent_turns: [],
      },
    } as Partial<AgentAContextV1>);
    const rejection = validateAgentATurnProposalV1({
      proposal: proposal({
        move: {
          schema_version: 1, move: 'defer_payment', secondary_moves: [],
          vetoes: ['payment_link'], confidence: 0.91,
        },
        response: { messages: ['¡Gracias, Inés!'], call_offer: null },
        used_fact_ids: [],
      }),
      context: current,
      planned_fact_ids: [],
      rejection_id: '11111111-1111-4111-8111-111111111111',
    });

    expect(rejection?.rejections).toContainEqual({
      code: 'MISSING_INTAKE',
      subject: 'apellido',
    });
  });

  it('no deja que un decline_purchase inventado anule el intake persistido', () => {
    const current = context({
      commercial_state: {
        ...context().commercial_state,
        selected_payment_plan: 'one_time',
        stage: 'plan_selected',
        awaiting_reply: 'contact_details',
      },
      capabilities: {
        ...context().capabilities,
        authorized_payment_plan: 'one_time',
        intake_missing: ['apellido', 'correo', 'telefono'],
      },
      turn: {
        batch_messages: [{ id: 'm2', text: 'Inés' }],
        recent_turns: [],
      },
    } as Partial<AgentAContextV1>);
    const rejection = validateAgentATurnProposalV1({
      proposal: proposal({
        move: {
          schema_version: 1, move: 'decline_purchase', secondary_moves: [],
          vetoes: ['purchase'], confidence: 0.91,
        },
        response: { messages: ['¡Gracias, Inés!'], call_offer: null },
        used_fact_ids: [],
      }),
      context: current,
      planned_fact_ids: [],
      rejection_id: '11111111-1111-4111-8111-111111111111',
    });

    expect(rejection?.rejections).toContainEqual({
      code: 'MISSING_INTAKE',
      subject: 'apellido',
    });
  });

  it.each([
    ['Ya tengo tu nombre y apellido registrados. Solo me falta tu correo electrónico para dejarlo todo listo.', false],
    ['Necesito tu nombre y correo electrónico para continuar.', false],
    ['¿Cuál es tu nombre completo?', true],
    ['¿Podés compartir tu apellido?', true],
    ['Compartí tu apellido, por favor.', true],
    ['Tu correo ya está registrado. Solo me falta tu apellido.', true],
  ] as const)('valida campos pedidos, no menciones de campos en reconocimientos: %s', (text, valid) => {
    const current = context({
      commercial_state: { ...context().commercial_state, awaiting_reply: 'contact_details' },
      capabilities: { ...context().capabilities, intake_missing: ['nombre', 'apellido'] },
    } as Partial<AgentAContextV1>);
    const rejection = validateAgentATurnProposalV1({
      proposal: proposal({
        move: { schema_version: 1, move: 'provide_contact_details', secondary_moves: [], vetoes: [], confidence: 1 },
        response: { messages: [text], call_offer: null },
        used_fact_ids: [],
      }),
      context: current,
      planned_fact_ids: [],
      rejection_id: '11111111-1111-4111-8111-111111111111',
    });
    if (valid) expect(rejection).toBeNull();
    else expect(rejection?.rejections).toContainEqual({ code: 'MISSING_INTAKE', subject: 'nombre' });
  });

  it('acepta guiar al siguiente dato faltante sin pedir los ya guardados', () => {
    const current = context({
      commercial_state: {
        ...context().commercial_state,
        selected_payment_plan: 'monthly_12',
        stage: 'plan_selected',
        awaiting_reply: 'contact_details',
      },
      capabilities: {
        ...context().capabilities,
        may_send_payment_link: true,
        intake_status: 'known',
        authorized_payment_plan: 'monthly_12',
        intake_missing: ['correo'],
      },
      turn: {
        batch_messages: [{ id: 'm2', text: 'Soy Nadia Ferrer' }],
        recent_turns: [],
      },
    } as Partial<AgentAContextV1>);
    const rejection = validateAgentATurnProposalV1({
      proposal: proposal({
        move: {
          schema_version: 1,
          move: 'provide_contact_details',
          secondary_moves: [],
          vetoes: [],
          confidence: 1,
        },
        response: { messages: ['Gracias, Nadia. ¿Cuál es tu correo?'], call_offer: null },
        used_fact_ids: [],
      }),
      context: current,
      planned_fact_ids: [],
      rejection_id: '11111111-1111-4111-8111-111111111111',
    });

    expect(rejection).toBeNull();
  });
});

/**
 * La verdad comercial pasó a verificarse por VALOR contra el registro canónico
 * en el backend (`commercial-truth-guard`). Este validador deja de duplicar esa
 * frontera con criterio de CITA: exigir un `used_fact_ids` por cada sustantivo
 * comercial convertía cualquier frase natural en un rechazo, y con la
 * reparación apagada, en el piso técnico.
 *
 * Sigue bloqueando lo que es dinero o promesa, que es donde un error es caro.
 */
describe('frontera léxica del ADK acotada a dinero y promesas', () => {
  function validate(messages: string[]) {
    return validateAgentATurnProposalV1({
      proposal: proposal({
        response: { messages: messages as never, call_offer: null },
        used_fact_ids: [],
      }),
      context: context(),
      planned_fact_ids: [],
      rejection_id: '22222222-2222-4222-8222-222222222222',
    });
  }

  it('no rechaza mencionar la modalidad sin citar un id de hecho', () => {
    expect(validate(['Es 100% online, así que lo hacés a tu ritmo.'])).toBeNull();
  });

  it('no rechaza mencionar la certificación sin citar un id de hecho', () => {
    expect(validate(['Al terminar te llevás un certificado.'])).toBeNull();
  });

  it('no rechaza nombrar cursos con lenguaje de venta corriente', () => {
    expect(validate(['Tenemos cursos de Tecnología y de Negocios.'])).toBeNull();
  });

  it('sigue rechazando un precio que nadie autorizó', () => {
    expect(validate(['El valor total del programa es USD 360.'])?.rejections)
      .toContainEqual({ code: 'FACT_VALUE_MISMATCH', subject: 'price' });
  });

  it('sigue rechazando una promesa de empleo garantizado', () => {
    expect(validate(['Tenés salida laboral garantizada.'])?.rejections)
      .toContainEqual({ code: 'FACT_VALUE_MISMATCH', subject: 'promise' });
  });
});

/**
 * Preguntar no es afirmar.
 *
 * El guard de prerequisitos existe para que el modelo no deduzca «no hace
 * falta experiencia» de un ejemplo del comportamiento canónico cuando el
 * catálogo no lo confirma. Eso está bien y se conserva.
 *
 * Pero su patrón matchea `partís desde cero`, que es literalmente la pregunta
 * de diagnóstico que el prompt canónico PRESCRIBE en la Fase 2:
 *
 *   "¿Tenés conocimientos previos o partís desde cero?"
 *
 * Con eso, el agente quedaba rechazado por obedecer. Medido en la corrida
 * `v13iter2`: 4 reparaciones en 26 turnos —15,4% contra un gate de 5%— y tres
 * de las cuatro en el mismo caso, todas por esta regla.
 *
 * Una pregunta no afirma nada sobre los requisitos del curso: pide un dato.
 */
describe('el guard de prerequisitos distingue pregunta de afirmación', () => {
  function rechazoDePrerequisitos(mensaje: string) {
    const rejection = validateAgentATurnProposalV1({
      proposal: proposal({ response: { messages: [mensaje] } }),
      context: context(),
      planned_fact_ids: [],
      rejection_id: '00000000-0000-4000-8000-000000000001',
    });
    return (rejection?.rejections ?? []).some((r) => r.subject === 'prerequisites');
  }

  it('la pregunta de diagnóstico canónica no se rechaza', () => {
    expect(rechazoDePrerequisitos('¿Tenés conocimientos previos o partís desde cero?')).toBe(false);
    expect(rechazoDePrerequisitos('¿Ya tenés experiencia o empezás desde cero?')).toBe(false);
  });

  it('la afirmación sin respaldo canónico se sigue rechazando', () => {
    expect(rechazoDePrerequisitos('No necesitás experiencia previa para este curso.')).toBe(true);
    expect(rechazoDePrerequisitos('Podés empezar desde cero sin problema.')).toBe(true);
    expect(rechazoDePrerequisitos('Está pensado para arrancar desde los fundamentos.')).toBe(true);
  });

  it('una afirmación no se salva por venir acompañada de una pregunta', () => {
    expect(rechazoDePrerequisitos(
      '¿Ya tenés conocimientos previos? No necesitás experiencia para arrancar.',
    )).toBe(true);
  });
});

/**
 * La pregunta repetida se quita sola, no arrastra el mensaje entero.
 *
 * `removeRepeatedAgentQuestionMessagesV1` descartaba el mensaje completo. Si la
 * pregunta ya hecha venía pegada a algo útil —"Perfecto, seguimos por chat.
 * ¿Ya tenías pensado estudiar maquillaje...?"— quitarla dejaba el turno sin
 * mensajes, la poda se abortaba y la repetición se entregaba igual.
 *
 * Observado por el arnés de workflow en `llamada_rechazada` t2: la persona pide
 * seguir por chat y recibe de vuelta la misma pregunta de diagnóstico del turno
 * anterior, que el propio prompt prohíbe repetir.
 */
describe('poda de la pregunta ya hecha', () => {
  const anterior = '¿Ya tenías pensado estudiar maquillaje o recién estás empezando a averiguar?';

  it('conserva la parte útil y quita sólo la pregunta repetida', () => {
    const resultado = removeRepeatedAgentQuestionMessagesV1(
      ['Perfecto, seguimos por chat entonces. ¿Ya tenías pensado estudiar maquillaje o recién estás empezando a averiguar?'],
      anterior,
      'No quiero que me llamen, prefiero por chat',
    );

    expect(resultado.join(' ')).toContain('seguimos por chat');
    expect(resultado.join(' ')).not.toMatch(/ya ten[ií]as pensado estudiar maquillaje/iu);
  });

  it('si el cliente pide que se lo repitan, no se poda nada', () => {
    const resultado = removeRepeatedAgentQuestionMessagesV1(
      [`Claro. ${anterior}`],
      anterior,
      '¿Me lo repetís? No entendí',
    );

    expect(resultado.join(' ')).toMatch(/ya ten[ií]as pensado/iu);
  });

  it('una pregunta nueva no se toca', () => {
    const resultado = removeRepeatedAgentQuestionMessagesV1(
      ['¿Cuál de las tres opciones de pago te resulta más cómoda?'],
      anterior,
      'me interesa',
    );

    expect(resultado).toEqual(['¿Cuál de las tres opciones de pago te resulta más cómoda?']);
  });
});
