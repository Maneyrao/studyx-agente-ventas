import { describe, expect, it } from 'vitest';
import {
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
      may_offer_call: true,
      may_request_call_now: false,
      may_present_payment_options: true,
      may_send_payment_link: false,
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
  it('una tercera oferta de llamada es CALL_BUDGET_EXHAUSTED', () => {
    const rejection = validateAgentATurnProposalV1({
      proposal: proposal({ response: { messages: ['Bien.'], call_offer: '¿Te llamo?' } }),
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
