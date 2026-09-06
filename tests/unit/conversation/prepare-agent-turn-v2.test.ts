import { describe, expect, it } from 'vitest';
import type { AgentATurnProposalV1 } from '@/features/conversation/domain/agent-a-brain';
import type { ConversationStateV1 } from '@/features/conversation/domain/conversation-pipeline';
import type { ConversationStateStoreV1 } from '@/features/conversation/ports/conversation-state-store';
import type { BusinessContextView, CatalogIndexView } from '@/features/orchestration/domain/business-context';
import { createDefaultConversationStateV1 } from '@/features/conversation/domain/conversation-planner';
import { prepareAgentTurnV2 } from '@/features/conversation/application/prepare-agent-turn-v2';

const ids = {
  workspace: '10000000-0000-4000-8000-000000000001',
  conversation: '10000000-0000-4000-8000-000000000002',
  contact: '10000000-0000-4000-8000-000000000003',
  turn: '10000000-0000-4000-8000-000000000004',
};

const index: CatalogIndexView = {
  as_of: '2026-09-02T16:00:00.000Z',
  offerings_total: 1,
  offerings: [{
    code: 'redes_informaticas', display_name: 'Redes Informáticas', academy: 'Tecnología', aliases: ['redes'],
  }],
  injection_suspected_count: 0,
};

const business = {
  as_of: index.as_of,
  prices_assertable: true,
  workspace: {
    slug: 'studyx', display_name: 'StudyX', environment: 'sandbox', default_locale: 'es-AR',
    timezone: 'America/Argentina/Buenos_Aires',
    payment_options: [{
      code: 'monthly_6', label: '6 cuotas mensuales', total: { amount: '360.00', currency: 'USD' },
      installments: 6, installment_amount: '60.00', payment_link: 'https://buy.stripe.com/test_authorized',
    }],
  },
  offerings: [{
    code: 'redes_informaticas', display_name: 'Redes Informáticas', aliases: ['redes'], academy: 'Tecnología',
    offering_type: 'course', description: 'Formación práctica en redes.', value_proposition: null,
    price_type: 'fixed', price: { amount: '360.00', currency: 'USD' }, price_assertable: true,
    billing_interval: null, modality: 'online', schedules: [], certification: true,
    hours_per_month: 8, classes: 16, modules: 4, includes: [], syllabus_published: true,
    language: 'Spanish', min_age: null,
    policies: { allowed_promise: null, forbidden_promises: [], price_message: null },
  }],
  qualification_fields: [], injection_suspected_count: 0, offerings_truncated: 0,
} satisfies BusinessContextView;

function state(overrides: Partial<ConversationStateV1> = {}): ConversationStateV1 {
  return {
    ...createDefaultConversationStateV1({
      workspace_id: ids.workspace, conversation_id: ids.conversation, contact_id: ids.contact,
    }),
    created_at: index.as_of,
    updated_at: index.as_of,
    ...overrides,
  };
}

function store(current: ConversationStateV1 | null): ConversationStateStoreV1 {
  return {
    async load() { return current; },
    async transition() { throw new Error('prepare must not persist'); },
    async recordTechnicalFallbackV1() { throw new Error('prepare must not persist'); },
  };
}

function proposal(overrides: Partial<AgentATurnProposalV1> = {}): AgentATurnProposalV1 {
  return {
    schema_version: 1,
    move: { schema_version: 1, move: 'unknown', secondary_moves: [], vetoes: [], confidence: 0.96 },
    response: { messages: ['Contame qué querés aprender y te ayudo a encontrar una opción.'] },
    proposed_action: { type: 'none' },
    used_fact_ids: [], used_memory_ids: [], memory_candidates: [], repair_of: null,
    ...overrides,
  };
}

const completeIntake = async () => ({
  nombre: 'Matía', apellido: 'Damonte', correo: 'matia@example.test', telefono: '+5491112345678',
});

describe('prepareAgentTurnV2', () => {
  it('does not authorize a call invitation before the first name is known', async () => {
    await expect(prepareAgentTurnV2({
      turn: { id: ids.turn, workspace_id: ids.workspace, conversation_id: ids.conversation, contact_id: ids.contact },
      workspace_slug: 'studyx', business_context: business, catalog_index: index,
      proposal: proposal({
        move: {
          schema_version: 1, move: 'select_course', secondary_moves: [], vetoes: [],
          course_reference: 'redes', confidence: 0.98,
        },
        response: {
          messages: ['Redes Informáticas puede ser una buena opción para empezar.'],
          call_offer: 'Si querés, podemos verlo mejor en una llamada.',
        },
        used_fact_ids: ['offering:redes_informaticas:name:v1'],
      }),
    }, {
      state_store: store(state()),
      contact_intake: async () => ({ nombre: null, apellido: null, correo: null, telefono: null }),
      now: () => Date.parse(index.as_of),
    })).rejects.toMatchObject({
      code: 'AGENT_TURN_V2_REJECTED', reasons: ['CALL_OFFER_NOT_AUTHORIZED'],
    });
  });

  it('turns the model-owned response into a decision without creating a TurnPlan', async () => {
    const prepared = await prepareAgentTurnV2({
      turn: { id: ids.turn, workspace_id: ids.workspace, conversation_id: ids.conversation, contact_id: ids.contact },
      workspace_slug: 'studyx', business_context: business, catalog_index: index,
      proposal: proposal({
        move: {
          schema_version: 1, move: 'select_course', secondary_moves: [], vetoes: [],
          course_reference: 'redes', confidence: 0.98,
        },
        response: { messages: ['Buenísimo. Redes es una opción práctica; veamos si encaja con lo que buscás.'] },
        used_fact_ids: ['offering:redes_informaticas:name:v1'],
      }),
    }, { state_store: store(state({ call_preference: 'chat', call_offer_status: 'declined' })), now: () => Date.parse(index.as_of) });

    expect(prepared).not.toHaveProperty('plan');
    expect(prepared.decision).toMatchObject({
      schema_version: 4,
      response: 'Buenísimo. Redes es una opción práctica; veamos si encaja con lo que buscás.',
      response_type: 'commercial_reply',
      reason_code: 'AGENT_A_PLANNERLESS_V2',
    });
    expect(prepared.transition).toMatchObject({
      selected_offering_code: 'redes_informaticas', stage: 'course_selected', source_turn_id: ids.turn,
    });
  });

  it('authorizes canonical facts cited by the model without rewriting its copy', async () => {
    const prepared = await prepareAgentTurnV2({
      turn: { id: ids.turn, workspace_id: ids.workspace, conversation_id: ids.conversation, contact_id: ids.contact },
      workspace_slug: 'studyx', business_context: business, catalog_index: index,
      proposal: proposal({
        move: {
          schema_version: 1, move: 'ask_course_information', secondary_moves: [], vetoes: [],
          course_reference: 'redes', confidence: 0.98,
        },
        response: { messages: ['Redes Informáticas tiene 16 clases y se cursa online.'] },
        used_fact_ids: [
          'offering:redes_informaticas:name:v1',
          'offering:redes_informaticas:duration:v1',
          'offering:redes_informaticas:modality:v1',
        ],
      }),
    }, { state_store: store(state({ call_preference: 'chat', call_offer_status: 'declined' })), now: () => Date.parse(index.as_of) });

    expect(prepared.decision.response).toBe('Redes Informáticas tiene 16 clases y se cursa online.');
    expect(prepared.authorized_protected_facts).toEqual(expect.arrayContaining([
      { kind: 'duration', value: '16 clases' },
      { kind: 'modality', value: 'online' },
    ]));
  });

  it('maps a backend-authorized payment request without exposing a model-authored URL', async () => {
    const prepared = await prepareAgentTurnV2({
      turn: { id: ids.turn, workspace_id: ids.workspace, conversation_id: ids.conversation, contact_id: ids.contact },
      workspace_slug: 'studyx', business_context: business, catalog_index: index,
      proposal: proposal({
        move: {
          schema_version: 1, move: 'request_payment_link', secondary_moves: [], vetoes: [],
          payment_plan: 'monthly_6', confidence: 0.99,
        },
        response: { messages: ['Perfecto, te comparto el link seguro para que avances.'] },
        proposed_action: {
          type: 'send_payment_link', offering_code: 'redes_informaticas', payment_plan: 'monthly_6',
        },
      }),
    }, {
      state_store: store(state({
        selected_offering_code: 'redes_informaticas', selected_payment_plan: 'monthly_6', stage: 'plan_selected',
      })),
      contact_intake: completeIntake,
      now: () => Date.parse(index.as_of),
    });

    expect(prepared.decision.business_action).toEqual({
      type: 'send_payment_link', offering_sku: 'redes_informaticas', plan_code: 'monthly_6',
    });
    expect(prepared.authorized_payment_plan).toBe('monthly_6');
    expect(prepared.decision.response).not.toContain('stripe');
  });

  it('resumes the durable plan for a generic link request instead of trusting a model-inferred plan', async () => {
    const prepared = await prepareAgentTurnV2({
      turn: { id: ids.turn, workspace_id: ids.workspace, conversation_id: ids.conversation, contact_id: ids.contact },
      workspace_slug: 'studyx', business_context: business, catalog_index: index,
      current_customer_messages: ['Mandame el link de pago'],
      proposal: proposal({
        move: {
          schema_version: 1, move: 'request_payment_link', secondary_moves: [], vetoes: [],
          payment_plan: 'monthly_6', confidence: 0.99,
        },
        response: { messages: ['Perfecto, te comparto el link seguro para que avances.'] },
        proposed_action: {
          type: 'send_payment_link', offering_code: 'redes_informaticas', payment_plan: 'monthly_6',
        },
      }),
    }, {
      state_store: store(state({
        selected_offering_code: 'redes_informaticas', selected_payment_plan: 'one_time',
        stage: 'plan_selected', awaiting_reply: 'contact_details',
      })),
      contact_intake: completeIntake,
      now: () => Date.parse(index.as_of),
    });

    expect(prepared.decision.business_action).toEqual({
      type: 'send_payment_link', offering_sku: 'redes_informaticas', plan_code: 'one_time',
    });
    expect(prepared.authorized_payment_plan).toBe('one_time');
    expect(prepared.transition).toMatchObject({
      selected_payment_plan: 'one_time', stage: 'payment_link_sent', awaiting_reply: 'none',
    });
  });

  it('rejects a response citing a fact from outside the selected course', async () => {
    await expect(prepareAgentTurnV2({
      turn: { id: ids.turn, workspace_id: ids.workspace, conversation_id: ids.conversation, contact_id: ids.contact },
      workspace_slug: 'studyx', business_context: business, catalog_index: index,
      proposal: proposal({
        move: {
          schema_version: 1, move: 'select_course', secondary_moves: [], vetoes: [],
          course_reference: 'redes', confidence: 0.98,
        },
        used_fact_ids: ['offering:curso_inexistente:duration:v1'],
      }),
    }, { state_store: store(state({ call_preference: 'chat', call_offer_status: 'declined' })), now: () => Date.parse(index.as_of) })).rejects.toMatchObject({
      code: 'AGENT_TURN_V2_REJECTED', reasons: ['FACT_NOT_AUTHORIZED'],
    });
  });
});
