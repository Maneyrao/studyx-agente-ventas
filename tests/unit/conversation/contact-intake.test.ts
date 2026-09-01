import { describe, expect, it } from 'vitest';
import type { ConversationMoveV1, ConversationStateV1 } from '@/features/conversation/domain/conversation-pipeline';
import {
  CONTACT_INTAKE_FIELDS_V1,
  createDefaultConversationStateV1,
  missingContactIntakeFieldsV1,
  planConversationTurn,
  type ContactIntakeV1,
  type PlanningBusinessContextV1,
} from '@/features/conversation/domain/conversation-planner';

const business: PlanningBusinessContextV1 = {
  catalog_available: true,
  areas: [{ code: 'tecnologia', display_name: 'Tecnología' }],
  offerings: [{ code: 'redes-informaticas', display_name: 'Redes Informáticas', area_code: 'tecnologia' }],
  payment_plans: ['monthly_12', 'monthly_6', 'one_time'],
};

function state(overrides: Partial<ConversationStateV1> = {}): ConversationStateV1 {
  return {
    ...createDefaultConversationStateV1({
      workspace_id: '00000000-0000-4000-8000-000000000001',
      conversation_id: '00000000-0000-4000-8000-000000000002',
      contact_id: '00000000-0000-4000-8000-000000000003',
    }),
    ...overrides,
  };
}

function move(kind: ConversationMoveV1['move'], overrides: Partial<ConversationMoveV1> = {}): ConversationMoveV1 {
  return { schema_version: 1, move: kind, secondary_moves: [], vetoes: [], confidence: 0.95, ...overrides };
}

const planChosen = state({
  selected_offering_code: 'redes-informaticas',
  selected_payment_plan: 'one_time',
  stage: 'plan_selected',
  awaiting_reply: 'payment_confirmation',
});

const complete: ContactIntakeV1 = {
  nombre: 'Ariana',
  apellido: 'Paz',
  correo: 'ariana.paz@example.test',
  telefono: '+5491100000001',
};

describe('six-field contact intake', () => {
  /** The commercial contract is frozen. A seventh field is a contract change. */
  it('freezes the intake at exactly the four conversational fields', () => {
    expect([...CONTACT_INTAKE_FIELDS_V1]).toEqual(['nombre', 'apellido', 'correo', 'telefono']);
  });

  it('reports only the fields that are actually absent', () => {
    expect(missingContactIntakeFieldsV1(complete)).toEqual([]);
    expect(missingContactIntakeFieldsV1({ ...complete, correo: null })).toEqual(['correo']);
    expect(missingContactIntakeFieldsV1({ ...complete, nombre: '   ', apellido: null }))
      .toEqual(['nombre', 'apellido']);
  });

  it('asks for the missing data instead of sending a link the customer cannot be billed for', () => {
    const result = planConversationTurn({
      move: move('request_payment_link'),
      sales_context: planChosen,
      business_context: business,
      contact_intake: { ...complete, correo: null },
    });

    expect(result.response_goal).toBe('request_contact_details');
    expect(result.missing_information).toContain('contact_details');
    expect(result.next_awaiting_reply).toBe('contact_details');
    expect(result.allowed_business_action).toEqual({ type: 'none' });
  });

  it('sends the link once the six fields are complete', () => {
    const result = planConversationTurn({
      move: move('request_payment_link'),
      sales_context: planChosen,
      business_context: business,
      contact_intake: complete,
    });

    expect(result.allowed_business_action).toEqual({
      type: 'send_payment_link',
      offering_code: 'redes-informaticas',
      payment_plan: 'one_time',
    });
  });

  it('resumes the link the customer already asked for once the data arrives', () => {
    const awaitingData = { ...planChosen, awaiting_reply: 'contact_details' as const };
    const result = planConversationTurn({
      move: move('provide_contact_details'),
      sales_context: awaitingData,
      business_context: business,
      contact_intake: complete,
    });

    expect(result.allowed_business_action).toEqual({
      type: 'send_payment_link',
      offering_code: 'redes-informaticas',
      payment_plan: 'one_time',
    });
  });

  it('keeps asking while data is still missing and never asks for a seventh field', () => {
    const awaitingData = { ...planChosen, awaiting_reply: 'contact_details' as const };
    const result = planConversationTurn({
      move: move('provide_contact_details'),
      sales_context: awaitingData,
      business_context: business,
      contact_intake: { ...complete, apellido: null },
    });

    expect(result.response_goal).toBe('request_contact_details');
    expect(result.next_awaiting_reply).toBe('contact_details');
    expect(result.allowed_business_action).toEqual({ type: 'none' });
    expect(result.missing_information).toEqual(['contact_details']);
  });

  /** Intake gates the link, never the conversation before it. */
  it('never demands identity data to answer a catalog or price question', () => {
    for (const kind of ['ask_course_information', 'ask_payment_options'] as const) {
      const result = planConversationTurn({
        move: move(kind),
        sales_context: planChosen,
        business_context: business,
        contact_intake: { nombre: null, apellido: null, correo: null, telefono: complete.telefono },
      });

      expect(result.response_goal).not.toBe('request_contact_details');
      expect(result.next_awaiting_reply).not.toBe('contact_details');
    }
  });

  /** Absent intake evidence is not a licence to skip the gate. */
  it('withholds the link when intake is unknown to the caller', () => {
    const result = planConversationTurn({
      move: move('request_payment_link'),
      sales_context: planChosen,
      business_context: business,
    });

    expect(result.allowed_business_action).toEqual({ type: 'none' });
    expect(result.response_goal).toBe('request_contact_details');
  });
});
