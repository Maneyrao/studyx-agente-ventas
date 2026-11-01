import { deriveCourseBonusLadderV1 } from '@/shared/conversation/bonus-ladder';
import { describe, expect, it } from 'vitest';
import type { AgentATurnProposalV1 } from '@/features/conversation/domain/agent-a-brain';
import type { ConversationStateV1 } from '@/features/conversation/domain/conversation-pipeline';
import type { ConversationStateStoreV1 } from '@/features/conversation/ports/conversation-state-store';
import type { BusinessContextView, CatalogIndexView } from '@/features/orchestration/domain/business-context';
import { createDefaultConversationStateV1 } from '@/features/conversation/domain/conversation-planner';
import {
  AgentTurnV2RejectedError,
  prepareAgentTurnV2,
} from '@/features/conversation/application/prepare-agent-turn-v2';

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
  it('does not retain a request_call move by stripping only its effect after refusal', async () => {
    await expect(prepareAgentTurnV2({
      turn: { id: ids.turn, workspace_id: ids.workspace, conversation_id: ids.conversation, contact_id: ids.contact },
      workspace_slug: 'studyx', business_context: business, catalog_index: index, semantic_rejections: 'advisory',
      current_customer_messages: ['Sí, dale', 'ahora no'],
      proposal: proposal({ move: { schema_version: 1, move: 'request_call', secondary_moves: [], vetoes: [], confidence: 1 },
        proposed_action: { type: 'none' }, response: { messages: ['Seguimos por acá.'] } }),
    }, { state_store: store(state({ call_preference: 'call', call_offer_status: 'accepted', awaiting_reply: 'call_or_chat' })),
      contact_intake: completeIntake, now: () => Date.parse(index.as_of),
    })).rejects.toMatchObject({ rejectionSubjects: ['call_consent_revoked'] });
  });

  it('does not equate provider acceptance with a connected call', async () => {
    await expect(prepareAgentTurnV2({
      turn: { id: ids.turn, workspace_id: ids.workspace, conversation_id: ids.conversation, contact_id: ids.contact },
      workspace_slug: 'studyx', business_context: business, catalog_index: index, semantic_rejections: 'advisory',
      proposal: proposal({ response: { messages: ['La llamada ya está conectada.'] } }),
    }, { state_store: store(state()), contact_intake: completeIntake, now: () => Date.parse(index.as_of),
      call_facts: { async loadClaimedCallFacts() { return {
        open_offer: null, open_retry_prompt: null, last_call_result: null, last_decline_at: null,
        active_call: { call_id: ids.turn, status: 'provider_accepted' },
      }; } },
    })).rejects.toMatchObject({ reasons: ['UNSUPPORTED_OPERATIONAL_CLAIM'] });
  });
  it.each(['La asesora ya está llamando.', 'Ya te estamos llamando.', 'Tu teléfono ya está sonando.'])(
    'rejects provider progress supported only by a request reservation: %s', async message => {
      await expect(prepareAgentTurnV2({
        turn: { id: ids.turn, workspace_id: ids.workspace, conversation_id: ids.conversation, contact_id: ids.contact },
        workspace_slug: 'studyx', business_context: business, catalog_index: index,
        current_customer_messages: ['Llamame'], semantic_rejections: 'advisory',
        proposal: proposal({
          move: { schema_version: 1, move: 'request_call', secondary_moves: [], vetoes: [], confidence: 1 },
          response: { messages: [message] }, proposed_action: { type: 'request_call_now', reason: 'direct_request' },
        }),
      }, { state_store: store(state()), contact_intake: completeIntake, now: () => Date.parse(index.as_of) }))
        .rejects.toMatchObject({ reasons: ['UNSUPPORTED_OPERATIONAL_CLAIM'], rejectionSubjects: ['call_in_progress'] });
    },
  );
  it('accepts a syllabus citation reloaded from the canonical knowledge source', async () => {
    const syllabusFact = {
      id: 'knowledge-source:11111111-1111-4111-8111-111111111111',
      kind: 'offering_syllabus' as const,
      source: 'knowledge_base' as const,
      value: 'Clase 1: fundamentos de redes. Clase 2: direccionamiento IP.',
      offering_code: 'redes_informaticas',
    };
    const prepared = await prepareAgentTurnV2({
      turn: { id: ids.turn, workspace_id: ids.workspace, conversation_id: ids.conversation, contact_id: ids.contact },
      workspace_slug: 'studyx', business_context: business, catalog_index: index,
      authorized_knowledge_facts: [syllabusFact],
      proposal: proposal({
        move: { schema_version: 1, move: 'ask_course_information', secondary_moves: [], vetoes: [],
          course_reference: 'redes_informaticas', confidence: 1 },
        response: { messages: [syllabusFact.value] },
        used_fact_ids: [syllabusFact.id],
      }),
    }, { state_store: store(state({ selected_offering_code: 'redes_informaticas' })) });

    expect(prepared.response_messages).toEqual([syllabusFact.value]);
    expect(prepared.decision.business_action).toBeNull();
  });

  it('retains an authorized direct bonus as the committed business action', async () => {
    const action = {type:'offer_course_bonus',interest_offering_code:'redes_informaticas',bonus_offering_code:'excel_integral'} as const;
    const prepared = await prepareAgentTurnV2({
      turn:{id:ids.turn,workspace_id:ids.workspace,conversation_id:ids.conversation,contact_id:ids.contact},
      workspace_slug:'studyx',business_context:business,
      catalog_index:{...index,offerings:[...index.offerings,{code:'excel_integral',display_name:'Excel Integral',aliases:[],academy:'Tecnología'}]},
      proposal:proposal({proposed_action:action,response:{messages:['Te regalo Excel Integral.']}}),
      course_bonus_capability:{status:'checkin_available',enabled:true,max_bonus_courses:2,may_offer_bonus:true,
        ladder:deriveCourseBonusLadderV1({observed_price_objection_count:3,call_invitation_status:'offered',call_offer_count:1,may_offer_call:true}),
        may_schedule_checkin:false,may_request_review:false,may_accept_offer:false,may_send_promoted_payment:false,
        promotion_code:null,interest_offering_code:'redes_informaticas',bonus_offerings:[]},
    },{state_store:store(state({selected_offering_code:'redes_informaticas'})),contact_intake:completeIntake});
    expect(prepared.decision.business_action).toEqual(action);
  });
  it.each(['missing', 'complete'] as const)('keeps the original explicit tool intent while continuation sends only prose: %s intake', async intakeCase => {
    const messages = ['Para avanzar, vemos los datos necesarios.'];
    const prepared = await prepareAgentTurnV2({
      turn: { id: ids.turn, workspace_id: ids.workspace, conversation_id: ids.conversation, contact_id: ids.contact },
      workspace_slug: 'studyx', business_context: business, catalog_index: index,
      conversation_only: true,
      requested_action: { type: 'send_payment_link', offering_code: 'redes_informaticas', payment_plan: 'monthly_6' },
      proposal: proposal({ move: { schema_version: 1, move: 'select_payment_plan', secondary_moves: [],
        vetoes: [], payment_plan: 'monthly_6', confidence: 1 }, response: { messages } }),
    }, { state_store: store(state({ selected_offering_code: 'redes_informaticas', stage: 'handoff' })),
      now: () => Date.parse(index.as_of), contact_intake: intakeCase === 'complete' ? completeIntake
        : async () => ({ nombre: 'Camila', apellido: 'Pérez', correo: null, telefono: '+5491112345678' }) });
    expect(prepared.decision.business_action).toBeNull();
    expect(prepared.response_messages).toEqual(messages);
    expect(prepared.transition).toMatchObject({ selected_payment_plan: 'monthly_6', stage: 'plan_selected',
      awaiting_reply: intakeCase === 'missing' ? 'contact_details' : 'payment_confirmation',
      payment_link_request: { status: 'pending', offering_code: 'redes_informaticas', payment_plan: 'monthly_6', requested_by_turn_id: ids.turn } });
  });

  it.each(['unknown course', 'mismatched course', 'mismatched plan', 'deferral', 'veto', 'paid'] as const)(
    'does not manufacture pending payment consent from an original tool request with %s', async condition => {
      const prepared = await prepareAgentTurnV2({
        turn: { id: ids.turn, workspace_id: ids.workspace, conversation_id: ids.conversation, contact_id: ids.contact },
        workspace_slug: 'studyx', business_context: business, catalog_index: index,
        conversation_only: true, semantic_rejections: 'advisory',
        requested_action: { type: 'send_payment_link', offering_code: condition === 'mismatched course' ? 'unknown_course' : 'redes_informaticas',
          payment_plan: condition === 'mismatched plan' ? 'one_time' : 'monthly_6' },
        proposal: proposal({ move: { schema_version: 1, move: condition === 'deferral' ? 'defer_payment' : 'select_payment_plan',
          secondary_moves: [], vetoes: condition === 'veto' ? ['payment_link'] : [], payment_plan: 'monthly_6', confidence: 1 },
          response: { messages: ['Seguimos conversando.'] } }),
      }, { state_store: store(state({ selected_offering_code: condition === 'unknown course' ? 'unknown_course' : 'redes_informaticas' })),
        now: () => Date.parse(index.as_of), contact_intake: completeIntake,
        payment_verification: condition === 'paid' ? async () => ({ status: 'paid', offering_code: 'redes_informaticas',
          plan_code: 'monthly_6', paid_at: index.as_of }) : undefined });
      expect(prepared.decision.business_action).toBeNull();
      expect(prepared.transition.payment_link_request?.status).not.toBe('pending');
    },
  );

  it('keeps the explicit link tool intent pending when a selector lacks intake', async () => {
    const prepared = await prepareAgentTurnV2({
      turn: { id: ids.turn, workspace_id: ids.workspace, conversation_id: ids.conversation, contact_id: ids.contact },
      workspace_slug: 'studyx', business_context: business, catalog_index: index,
      current_customer_messages: ['6 pagos 60'],
      proposal: proposal({ move: { schema_version: 1, move: 'select_payment_plan', secondary_moves: [],
        vetoes: [], payment_plan: 'monthly_6', confidence: 1 },
        response: { messages: ['Para avanzar necesito tu correo.'] },
        proposed_action: { type: 'send_payment_link', offering_code: 'redes_informaticas', payment_plan: 'monthly_6' } }),
    }, { state_store: store(state({ selected_offering_code: 'redes_informaticas' })), now: () => Date.parse(index.as_of),
      contact_intake: async () => ({ nombre: 'Camila', apellido: 'Pérez', correo: null, telefono: '+5491112345678' }) });
    expect(prepared.decision.business_action).toBeNull();
    expect(prepared.transition).toMatchObject({ selected_payment_plan: 'monthly_6', awaiting_reply: 'contact_details',
      payment_link_request: { status: 'pending', payment_plan: 'monthly_6', requested_by_turn_id: ids.turn } });
    expect(prepared.action_rejection).toMatchObject({ codes: ['MISSING_INTAKE'], missing_fields: ['correo'] });
  });

  it.each(['missing', 'complete'] as const)('preserves one-time checkout intent without effects during %s intake continuation', async intakeCase => {
    const messages = ['Vemos primero los datos necesarios para avanzar.'];
    const prepared = await prepareAgentTurnV2({ conversation_only: true,
      turn: { id: ids.turn, workspace_id: ids.workspace, conversation_id: ids.conversation, contact_id: ids.contact },
      workspace_slug: 'studyx', catalog_index: index,
      business_context: { ...business, workspace: { ...business.workspace, payment_options: [
        ...business.workspace.payment_options,
        { code: 'one_time', label: '1 pago de USD 360', total: { amount: '360.00', currency: 'USD' },
          installments: 1, installment_amount: '360.00', payment_link: 'https://buy.stripe.com/test_one_time' },
      ] } },
      current_customer_messages: ['1 pago'],
      proposal: proposal({ move: { schema_version: 1, move: 'select_payment_plan',
        secondary_moves: ['request_payment_link'], vetoes: [], payment_plan: 'one_time', confidence: 1 },
        response: { messages } }),
    }, {
      state_store: store(state({ selected_offering_code: 'redes_informaticas', stage: 'handoff' })),
      contact_intake: intakeCase === 'complete' ? completeIntake
        : async () => ({ nombre: 'Camila', apellido: null, correo: null, telefono: null }),
      now: () => Date.parse(index.as_of),
    });
    expect(prepared.decision.business_action).toBeNull();
    expect(prepared.response_messages).toEqual(messages);
    expect(prepared.transition).toMatchObject({ selected_payment_plan: 'one_time', stage: 'plan_selected',
      awaiting_reply: intakeCase === 'complete' ? 'payment_confirmation' : 'contact_details',
      payment_link_request: { status: 'pending', payment_plan: 'one_time', requested_by_turn_id: ids.turn },
    });
  });

  it('preserves direct call consent while conversation-only continuation asks for the missing phone', async () => {
    const prepared = await prepareAgentTurnV2({ conversation_only: true,
      turn: { id: ids.turn, workspace_id: ids.workspace, conversation_id: ids.conversation, contact_id: ids.contact },
      workspace_slug: 'studyx', business_context: business, catalog_index: index,
      current_customer_messages: ['Dale llamame'],
      proposal: proposal({ move: { schema_version: 1, move: 'request_call', secondary_moves: [], vetoes: [], confidence: 1 },
        response: { messages: ['A qué número con código de país y área puedo llamarte?'] } }),
    }, { state_store: store(state()), now: () => Date.parse(index.as_of),
      contact_intake: async () => ({ nombre: 'Camila', apellido: null, correo: null, telefono: null }) });
    expect(prepared.decision.business_action).toBeNull();
    expect(prepared.transition).toMatchObject({ call_preference: 'call', call_offer_status: 'accepted', awaiting_reply: 'contact_details' });
  });

  it.each(['requested', 'provider_accepted', 'in_progress'])(
    'allows a registration confirmation backed by an active %s call without another dispatch', async status => {
      const message = 'Sí, la llamada ya quedó registrada.';
      const prepared = await prepareAgentTurnV2({
        turn: { id: ids.turn, workspace_id: ids.workspace, conversation_id: ids.conversation, contact_id: ids.contact },
        workspace_slug: 'studyx', business_context: business, catalog_index: index,
        semantic_rejections: 'advisory', current_customer_messages: ['¿Ya pediste la llamada?'],
        proposal: proposal({ response: { messages: [message] } }),
      }, {
        state_store: store(state()), contact_intake: completeIntake, now: () => Date.parse(index.as_of),
        call_facts: { async loadClaimedCallFacts() { return {
          open_offer: null, open_retry_prompt: null, last_call_result: null, last_decline_at: null,
          active_call: { call_id: '00000000-0000-4000-8000-0000000000c1', status },
        }; } },
      });
      expect(prepared.decision).toMatchObject({ response: message, business_action: null });
    },
  );

  it.each([
    ['provider_accepted', 'Te llamo ahora.'],
    ['failed', 'Sí, la llamada ya quedó registrada.'],
    ['completed', 'Sí, la llamada ya quedó registrada.'],
    ['dispatch_ambiguous', 'Sí, la llamada ya quedó registrada.'],
  ])('rejects an unsupported claim with prior status %s: %s', async (status, message) => {
    await expect(prepareAgentTurnV2({
      turn: { id: ids.turn, workspace_id: ids.workspace, conversation_id: ids.conversation, contact_id: ids.contact },
      workspace_slug: 'studyx', business_context: business, catalog_index: index,
      semantic_rejections: 'advisory',
      proposal: proposal({ response: { messages: [message] } }),
    }, {
      state_store: store(state()), contact_intake: completeIntake, now: () => Date.parse(index.as_of),
      call_facts: { async loadClaimedCallFacts() { return {
        open_offer: null, open_retry_prompt: null, last_call_result: null, last_decline_at: null,
        active_call: { call_id: '00000000-0000-4000-8000-0000000000c1', status },
      }; } },
    })).rejects.toMatchObject({ code: 'AGENT_TURN_V2_REJECTED', reasons: ['ACTION_NOT_AUTHORIZED'] });
  });

  it.each([
    'No te preocupes, te llamo ahora.',
    'Te llamo ahora y podemos hablar del curso.',
    '¿Te parece bien? Te llamo ahora.',
    'Perfecto, te llamo ahora, ¿de acuerdo?',
    'Sí, la llamada ya quedó registrada, ¿te parece bien?',
  ])('rejects an unbacked dispatch claim despite unrelated wording: %s', async message => {
    await expect(prepareAgentTurnV2({
      turn: { id: ids.turn, workspace_id: ids.workspace, conversation_id: ids.conversation, contact_id: ids.contact },
      workspace_slug: 'studyx', business_context: business, catalog_index: index,
      semantic_rejections: 'advisory',
      proposal: proposal({ response: { messages: [message] } }),
    }, { state_store: store(state()), contact_intake: completeIntake, now: () => Date.parse(index.as_of) }))
      .rejects.toMatchObject({ code: 'AGENT_TURN_V2_REJECTED', reasons: ['ACTION_NOT_AUTHORIZED'] });
  });

  it.each(['omitted_action', 'missing_phone', 'missing_surname', 'withdrawn_consent'] as const)(
    'rejects a call announcement with %s before commit in advisory mode', async failure => {
      await expect(prepareAgentTurnV2({
        turn: { id: ids.turn, workspace_id: ids.workspace, conversation_id: ids.conversation, contact_id: ids.contact },
        workspace_slug: 'studyx', business_context: business, catalog_index: index,
        semantic_rejections: 'advisory',
        current_customer_messages: [failure === 'withdrawn_consent' ? 'Mejor seguimos por chat' : 'Sí'],
        proposal: proposal({
          move: { schema_version: 1, move: 'request_call', secondary_moves: [], vetoes: [], confidence: 1 },
          response: { messages: ['Perfecto, te llamo ahora.'] },
          proposed_action: failure === 'omitted_action'
            ? { type: 'none' } : { type: 'request_call_now', reason: 'direct_request' },
        }),
      }, {
        state_store: store(state({ call_preference: 'call', call_offer_status: 'accepted', awaiting_reply: 'call_or_chat' })),
        contact_intake: async () => ({ ...(await completeIntake()),
          ...(failure === 'missing_phone' ? { telefono: null } : {}),
          ...(failure === 'missing_surname' ? { apellido: null } : {}),
        }),
        now: () => Date.parse(index.as_of),
      })).rejects.toMatchObject({ code: 'AGENT_TURN_V2_REJECTED', reasons: ['ACTION_NOT_AUTHORIZED'] });
    },
  );

  it('preserves a model-authored surname question and reports the missing call field', async () => {
    const prepared = await prepareAgentTurnV2({
      turn: { id: ids.turn, workspace_id: ids.workspace, conversation_id: ids.conversation, contact_id: ids.contact },
      workspace_slug: 'studyx', business_context: business, catalog_index: index,
      semantic_rejections: 'advisory', current_customer_messages: ['Sí'],
      proposal: proposal({
        move: { schema_version: 1, move: 'request_call', secondary_moves: [], vetoes: [], confidence: 1 },
        response: { messages: ['Antes de llamarte, dime tu apellido.'] },
        proposed_action: { type: 'request_call_now', reason: 'direct_request' },
      }),
    }, {
      state_store: store(state({ call_preference: 'call', call_offer_status: 'accepted', awaiting_reply: 'call_or_chat' })),
      contact_intake: async () => ({ ...(await completeIntake()), apellido: null }),
      now: () => Date.parse(index.as_of),
    });
    expect(prepared.decision).toMatchObject({ response: 'Antes de llamarte, dime tu apellido.', business_action: null });
    expect(prepared.action_rejection).toMatchObject({ action: 'request_call_now', missing_fields: ['apellido'] });
  });

  it('requires email before authorizing a confirmed call', async () => {
    const prepared = await prepareAgentTurnV2({
      turn: { id: ids.turn, workspace_id: ids.workspace, conversation_id: ids.conversation, contact_id: ids.contact },
      workspace_slug: 'studyx', business_context: business, catalog_index: index,
      semantic_rejections: 'advisory', current_customer_messages: ['Sí'],
      proposal: proposal({
        move: { schema_version: 1, move: 'request_call', secondary_moves: [], vetoes: [], confidence: 1 },
        response: { messages: ['Antes de llamarte, compartime tu correo por acá.'] },
        proposed_action: { type: 'request_call_now', reason: 'direct_request' },
      }),
    }, {
      state_store: store(state({ call_preference: 'call', call_offer_status: 'accepted', awaiting_reply: 'call_or_chat' })),
      contact_intake: async () => ({ ...(await completeIntake()), correo: null }),
      now: () => Date.parse(index.as_of),
    });
    expect(prepared.decision.business_action).toBeNull();
    expect(prepared.action_rejection).toMatchObject({
      action: 'request_call_now', missing_fields: ['correo'],
    });
  });

  it.each([
    'No te llamo hasta que me confirmes.',
    'Puedes atender si te llamo ahora?',
    'Si estás disponible, te llamo.',
    'Si puedes atender, te llamo ahora.',
    'Te llamo si estás disponible.',
    '¿Te llamo ahora?',
    '¿La llamada ya quedó registrada?',
  ])(
    'keeps a non-dispatch statement unchanged: %s', async message => {
      const prepared = await prepareAgentTurnV2({
        turn: { id: ids.turn, workspace_id: ids.workspace, conversation_id: ids.conversation, contact_id: ids.contact },
        workspace_slug: 'studyx', business_context: business, catalog_index: index,
        semantic_rejections: 'advisory', current_customer_messages: ['Llamame'],
        proposal: proposal({
          move: { schema_version: 1, move: 'request_call', secondary_moves: [], vetoes: [], confidence: 1 },
          response: { messages: [message] },
        }),
      }, { state_store: store(state()), contact_intake: completeIntake, now: () => Date.parse(index.as_of) });
      expect(prepared.decision).toMatchObject({ response: message, business_action: null });
    },
  );

  it('rejects a delivery announcement when the paid ledger prevents the link', async () => {
    await expect(prepareAgentTurnV2({
      turn: { id: ids.turn, workspace_id: ids.workspace, conversation_id: ids.conversation, contact_id: ids.contact },
      workspace_slug: 'studyx', business_context: business, catalog_index: index,
      semantic_rejections: 'advisory', current_customer_messages: ['y el link?'],
      proposal: proposal({
        move: { schema_version: 1, move: 'request_payment_link', secondary_moves: [], vetoes: [], confidence: 1 },
        response: { messages: ['Ahí va, Matía. El enlace es de Stripe.'] },
        proposed_action: { type: 'send_payment_link', offering_code: 'redes_informaticas', payment_plan: 'monthly_6' },
      }),
    }, {
      state_store: store(state({ selected_offering_code: 'redes_informaticas', selected_payment_plan: 'monthly_6',
        stage: 'plan_selected', awaiting_reply: 'payment_confirmation' })),
      contact_intake: completeIntake, now: () => Date.parse(index.as_of),
      payment_verification: async () => ({ status: 'paid', offering_code: 'redes_informaticas',
        plan_code: 'monthly_6', paid_at: index.as_of }),
    })).rejects.toMatchObject({ code: 'AGENT_TURN_V2_REJECTED', reasons: ['ACTION_NOT_AUTHORIZED'] });
  });
  it('authorizes a verified-payment reply only when the canonical ledger is paid', async () => {
    const prepared = await prepareAgentTurnV2({
      turn: { id: ids.turn, workspace_id: ids.workspace, conversation_id: ids.conversation, contact_id: ids.contact },
      workspace_slug: 'studyx', business_context: business, catalog_index: index,
      current_customer_messages: ['Ya pagué'],
      proposal: proposal({
        move: {
          schema_version: 1, move: 'report_payment', secondary_moves: [], vetoes: [], confidence: 0.99,
        },
        response: { messages: ['Listo, tu pago quedó verificado. Ahora el equipo continuará con tu inscripción y acceso.'] },
        used_fact_ids: [
          'state:payment_reported:v1',
          'state:payment_verified:v1',
          'process:access_after_verification:v1',
        ],
      }),
    }, {
      state_store: store(state({
        selected_offering_code: 'redes_informaticas',
        selected_payment_plan: 'monthly_6',
        stage: 'payment_link_sent',
      })),
      contact_intake: completeIntake,
      payment_verification: async () => ({
        status: 'paid' as const,
        offering_code: 'redes_informaticas',
        plan_code: 'monthly_6' as const,
        paid_at: index.as_of,
      }),
      now: () => Date.parse(index.as_of),
    });

    expect(prepared.decision.response).toContain('pago quedó verificado');
    expect(prepared.transition.payment_reported).toBe(true);
  });

  it('rejects a verified-payment claim while the canonical Stripe attempt is only reserved', async () => {
    const input = {
      turn: { id: ids.turn, workspace_id: ids.workspace, conversation_id: ids.conversation, contact_id: ids.contact },
      workspace_slug: 'studyx', business_context: business, catalog_index: index,
      current_customer_messages: ['Ya pagué'],
      proposal: proposal({
        move: {
          schema_version: 1 as const,
          move: 'report_payment' as const,
          secondary_moves: [], vetoes: [], confidence: 0.99,
        },
        response: { messages: ['Listo, tu pago quedó verificado.'] },
        used_fact_ids: ['state:payment_reported:v1', 'state:payment_verified:v1'],
      }),
    };

    await expect(prepareAgentTurnV2(input, {
      state_store: store(state({
        selected_offering_code: 'redes_informaticas',
        selected_payment_plan: 'monthly_6',
        stage: 'payment_link_sent',
      })),
      contact_intake: completeIntake,
      payment_verification: async () => ({
        status: 'reserved' as const,
        offering_code: 'redes_informaticas',
        plan_code: 'monthly_6' as const,
        paid_at: null,
      }),
      now: () => Date.parse(index.as_of),
    })).rejects.toMatchObject({
      code: 'AGENT_TURN_V2_REJECTED',
      reasons: expect.arrayContaining(['FACT_NOT_AUTHORIZED']),
    });
  });

  it('accepts a natural not-yet-verified reply while Stripe is still pending', async () => {
    const prepared = await prepareAgentTurnV2({
      turn: { id: ids.turn, workspace_id: ids.workspace, conversation_id: ids.conversation, contact_id: ids.contact },
      workspace_slug: 'studyx', business_context: business, catalog_index: index,
      current_customer_messages: ['Ya pagué'],
      proposal: proposal({
        move: {
          schema_version: 1, move: 'report_payment', secondary_moves: [], vetoes: [], confidence: 0.99,
        },
        response: { messages: ['Gracias por avisarme. Todavía no pude verificar la acreditación; puede demorar unos instantes.'] },
        used_fact_ids: ['state:payment_reported:v1'],
      }),
    }, {
      state_store: store(state({
        selected_offering_code: 'redes_informaticas',
        selected_payment_plan: 'monthly_6',
        stage: 'payment_link_sent',
      })),
      contact_intake: completeIntake,
      payment_verification: async () => ({
        status: 'pending',
        offering_code: 'redes_informaticas',
        plan_code: 'monthly_6',
        paid_at: null,
      }),
      now: () => Date.parse(index.as_of),
    });

    expect(prepared.decision.response).toContain('no pude verificar');
    expect(prepared.transition.payment_reported).toBe(true);
  });

  it('does not label an ordinary CTA stored in call_offer as a call invitation', async () => {
    const prepared = await prepareAgentTurnV2({
      turn: { id: ids.turn, workspace_id: ids.workspace, conversation_id: ids.conversation, contact_id: ids.contact },
      workspace_slug: 'studyx', business_context: business, catalog_index: index,
      proposal: proposal({
        response: {
          messages: ['Tenemos varias opciones para aprender.'],
          call_offer: 'Cuéntame qué te interesa y te recomiendo una.',
        },
      }),
    }, {
      state_store: store(state()),
      contact_intake: completeIntake,
      now: () => Date.parse(index.as_of),
    });

    expect(prepared.decision.response_type).toBe('commercial_reply');
    expect(prepared.transition).toMatchObject({ call_offer_count: 0, call_offer_status: 'not_offered' });
  });

  it('delivers and counts a permitted invitation even before the first name', async () => {
    const prepared = await prepareAgentTurnV2({
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
    });
    expect(prepared).toMatchObject({
      decision: { kind: 'reply' },
      transition: { call_offer_count: 1, call_offer_status: 'offered' },
    });
  });

  it('authorizes the initial offer when the customer supplies a first name in this batch', async () => {
    const prepared = await prepareAgentTurnV2({
      turn: { id: ids.turn, workspace_id: ids.workspace, conversation_id: ids.conversation, contact_id: ids.contact },
      workspace_slug: 'studyx', business_context: business, catalog_index: index,
      current_customer_messages: ['Soy Lucas', 'Quiero aprender redes'],
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
    });

    expect(prepared.transition).toMatchObject({ call_offer_count: 1, call_offer_status: 'offered' });
  });

  it('authorizes one later reminder after a prior call refusal when the new turn needs more detail', async () => {
    const prepared = await prepareAgentTurnV2({
      turn: { id: ids.turn, workspace_id: ids.workspace, conversation_id: ids.conversation, contact_id: ids.contact },
      workspace_slug: 'studyx', business_context: business, catalog_index: index,
      current_customer_messages: ['¿Qué incluye el curso? Quiero ver el temario completo.'],
      proposal: proposal({
        move: {
          schema_version: 1, move: 'ask_course_information', secondary_moves: [], vetoes: [],
          course_reference: 'redes', confidence: 0.98,
        },
        response: {
          messages: ['Te explico los contenidos principales de Redes Informáticas.'],
          call_offer: 'Recuerda que también puedo llamarte para orientarte con más detalle.',
        },
        used_fact_ids: ['offering:redes_informaticas:name:v1'],
      }),
    }, {
      state_store: store(state({
        selected_offering_code: 'redes_informaticas', stage: 'course_selected',
        call_preference: 'chat', call_offer_status: 'declined', call_offer_count: 1,
      })),
      call_facts: {
        async loadClaimedCallFacts() {
          return {
            open_offer: null, open_retry_prompt: null, active_call: null, last_call_result: null,
            last_decline_at: '2026-09-02T15:55:00.000Z',
          };
        },
      },
      contact_intake: completeIntake,
      now: () => Date.parse(index.as_of),
    });

    expect(prepared.response_messages).toEqual([
      'Te explico los contenidos principales de Redes Informáticas.',
      'Recuerda que también puedo llamarte para orientarte con más detalle.',
    ]);
    expect(prepared.transition).toMatchObject({
      call_preference: 'chat', call_offer_count: 2, call_offer_status: 'offered',
    });
  });

  it('rejects an inconsistent call invitation instead of deleting it from the response', async () => {
    const prepared = prepareAgentTurnV2({
      turn: { id: ids.turn, workspace_id: ids.workspace, conversation_id: ids.conversation, contact_id: ids.contact },
      workspace_slug: 'studyx', business_context: business, catalog_index: index,
      current_customer_messages: ['No me llames, prefiero seguir por chat.'],
      proposal: proposal({
        move: {
          schema_version: 1, move: 'decline_call', secondary_moves: [], vetoes: [], confidence: 0.99,
        },
        response: {
          messages: ['Seguimos por chat y te ayudo por aquí.'],
          call_offer: 'Si quieres, también puedo llamarte para orientarte.',
        },
      }),
    }, {
      state_store: store(state({
        selected_offering_code: 'redes_informaticas', stage: 'course_selected',
        call_preference: 'unknown', call_offer_status: 'offered', call_offer_count: 1,
        awaiting_reply: 'call_or_chat',
      })),
      contact_intake: completeIntake,
      now: () => Date.parse(index.as_of),
    });

    await expect(prepared).rejects.toThrow('AGENT_TURN_V2_REJECTED');
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
        awaiting_reply: 'payment_confirmation',
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
      workspace_slug: 'studyx',
      business_context: { ...business, workspace: { ...business.workspace, payment_options: [
        ...business.workspace.payment_options,
        { code: 'one_time', label: '1 pago de USD 360', total: { amount: '360.00', currency: 'USD' },
          installments: 1, installment_amount: '360.00', payment_link: 'https://buy.stripe.com/test_one_time' },
      ] } },
      catalog_index: index,
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
        stage: 'plan_selected', awaiting_reply: 'payment_confirmation',
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

  it('returns a repairable rejection instead of silently stripping checkout from a pending package', async () => {
    const packageIndex: CatalogIndexView = {
      ...index,
      offerings_total: 2,
      offerings: [
        index.offerings[0]!,
        { code: 'excel_integral', display_name: 'Excel Integral', academy: 'Tecnología', aliases: ['excel'] },
      ],
    };
    const packageBusiness: BusinessContextView = {
      ...business,
      offerings: [
        business.offerings[0]!,
        { ...business.offerings[0]!, code: 'excel_integral', display_name: 'Excel Integral', aliases: ['excel'] },
      ],
    };
    const attempt = prepareAgentTurnV2({
      turn: { id: ids.turn, workspace_id: ids.workspace, conversation_id: ids.conversation, contact_id: ids.contact },
      workspace_slug: 'studyx', business_context: packageBusiness, catalog_index: packageIndex,
      current_customer_messages: ['Claro, pasame el link y va también Excel'],
      course_bonus_capability: {
        status: 'offer_available', may_schedule_checkin: false, may_request_review: false,
        may_accept_offer: true, may_send_promoted_payment: false,
        promotion_code: 'redes_con_excel', interest_offering_code: 'redes_informaticas',
        bonus_offerings: [{ code: 'excel_integral', display_name: 'Excel Integral', position: 1 }],
      },
      proposal: proposal({
        move: { schema_version: 1, move: 'request_payment_link', secondary_moves: [], vetoes: [],
          course_reference: 'excel', confidence: 1 },
        response: { messages: ['Perfecto, avanzo con el paquete.'] },
        proposed_action: { type: 'send_payment_link', offering_code: 'excel_integral', payment_plan: 'monthly_6' },
      }),
    }, {
      state_store: store(state({ selected_offering_code: 'excel_integral', selected_payment_plan: 'monthly_6',
        stage: 'plan_selected', awaiting_reply: 'payment_confirmation' })),
      contact_intake: completeIntake,
      now: () => Date.parse(index.as_of),
    });

    const rejection = await attempt.catch((error: unknown) => error);
    expect(rejection).toBeInstanceOf(AgentTurnV2RejectedError);
    expect(rejection).toMatchObject({
      code: 'AGENT_TURN_V2_REJECTED',
      reasons: ['ACTION_NOT_AUTHORIZED'],
      rejectionSubjects: ['promotion_acceptance_required'],
    });
  });

  it('carries a current explicit plan selected as a secondary move while intake is still incomplete', async () => {
    const prepared = await prepareAgentTurnV2({
      turn: { id: ids.turn, workspace_id: ids.workspace, conversation_id: ids.conversation, contact_id: ids.contact },
      workspace_slug: 'studyx', business_context: business, catalog_index: index,
      current_customer_messages: ['Sí, quiero avanzar: envíame el enlace para pagar en seis cuotas.'],
      proposal: proposal({
        move: {
          schema_version: 1, move: 'request_payment_link', secondary_moves: ['select_payment_plan'],
          vetoes: [], payment_plan: 'monthly_6', confidence: 0.99,
        },
        response: { messages: ['Para avanzar me faltan tu apellido, correo y teléfono.'] },
      }),
    }, {
      state_store: store(state({
        selected_offering_code: 'redes_informaticas', selected_payment_plan: 'monthly_6',
        stage: 'plan_selected', awaiting_reply: 'payment_confirmation',
      })),
      contact_intake: async () => ({ nombre: 'Camila', apellido: null, correo: null, telefono: null }),
      now: () => Date.parse(index.as_of),
    });

    expect(prepared.authorized_payment_plan).toBe('monthly_6');
    expect(prepared.decision.business_action).toBeNull();
    expect(prepared.transition).toMatchObject({
      selected_payment_plan: 'monthly_6', stage: 'plan_selected', awaiting_reply: 'contact_details',
    });
  });

  it('accepts cited details of active English levels while the customer is still choosing', async () => {
    const englishIndex: CatalogIndexView = {
      ...index,
      offerings_total: 2,
      offerings: [
        { code: 'ingles_1', display_name: 'Inglés 1', academy: 'Academia Cultural', aliases: [] },
        { code: 'ingles_2', display_name: 'Inglés 2', academy: 'Academia Cultural', aliases: [] },
      ],
    };
    const englishBusiness: BusinessContextView = {
      ...business,
      offerings: [
        { ...business.offerings[0], code: 'ingles_1', display_name: 'Inglés 1', description: 'Lectura y práctica del idioma.', classes: 12 },
        { ...business.offerings[0], code: 'ingles_2', display_name: 'Inglés 2', description: 'Aprender a entablar una conversación.', classes: 12 },
      ],
    };
    const prepared = await prepareAgentTurnV2({
      turn: { id: ids.turn, workspace_id: ids.workspace, conversation_id: ids.conversation, contact_id: ids.contact },
      workspace_slug: 'studyx',
      current_customer_messages: ['Buenas contame info d ingles'],
      business_context: englishBusiness,
      catalog_index: englishIndex,
      proposal: proposal({
        move: { schema_version: 1, move: 'browse_catalog', secondary_moves: [], vetoes: [], confidence: 0.9 },
        response: { messages: ['Inglés 1 tiene 12 clases y trabaja lectura; Inglés 2 ayuda a entablar una conversación.'] },
        used_fact_ids: [
          'offering:ingles_1:name:v1',
          'offering:ingles_1:description:v1',
          'offering:ingles_1:duration:v1',
          'offering:ingles_2:name:v1',
          'offering:ingles_2:description:v1',
        ],
      }),
    }, { state_store: store(state()), now: () => Date.parse(index.as_of) });

    expect(prepared.decision.response).toContain('Inglés 1 tiene 12 clases');
    expect(prepared.transition.selected_offering_code).toBeNull();
    expect(prepared.decision.business_action).toBeNull();
    expect(prepared.authorized_protected_facts).toContainEqual({ kind: 'duration', value: '12 clases' });
  });

  it('records acceptance of an open call offer and asks availability before dispatch', async () => {
    const prepared = await prepareAgentTurnV2({
      turn: { id: ids.turn, workspace_id: ids.workspace, conversation_id: ids.conversation, contact_id: ids.contact },
      workspace_slug: 'studyx', business_context: business, catalog_index: index,
      current_customer_messages: ['sí'],
      proposal: proposal({
        move: {
          schema_version: 1, move: 'request_call', secondary_moves: [], vetoes: [], confidence: 0.98,
        },
        response: { messages: ['Perfecto. ¿Podés atender si te llamamos ahora?'] },
        proposed_action: { type: 'request_call_now', reason: 'accepted_offer' },
      }),
    }, {
      state_store: store(state({ call_offer_status: 'offered', call_offer_count: 1, awaiting_reply: 'call_or_chat' })),
      call_facts: {
        async loadClaimedCallFacts() {
          return {
            open_offer: {
              decision_id: '10000000-0000-4000-8000-000000000005',
              offered_at: '2026-09-02T15:44:00.000Z',
            },
            open_retry_prompt: null,
            active_call: null,
            last_call_result: null,
            last_decline_at: null,
          };
        },
      },
      contact_intake: completeIntake,
      now: () => Date.parse(index.as_of),
    });

    expect(prepared.decision.business_action).toBeNull();
    expect(prepared.transition).toMatchObject({
      call_preference: 'call', call_offer_status: 'accepted', awaiting_reply: 'call_or_chat',
    });
    expect(prepared.action_rejection).toMatchObject({ action: 'request_call_now' });
  });

  it('authorizes a fresh invitation after the prior call reached a terminal result', async () => {
    const prepared = await prepareAgentTurnV2({
      turn: { id: ids.turn, workspace_id: ids.workspace, conversation_id: ids.conversation, contact_id: ids.contact },
      workspace_slug: 'studyx', business_context: business, catalog_index: index,
      current_customer_messages: ['Contame qué beneficios tiene el curso.'],
      proposal: proposal({
        move: {
          schema_version: 1, move: 'ask_course_information', secondary_moves: [], vetoes: [],
          course_reference: 'redes_informaticas', confidence: 0.98,
        },
        response: {
          messages: ['Te cuento lo más importante para que puedas decidir.'],
          call_offer: 'Y si querés, te llamo y lo vemos.',
        },
      }),
    }, {
      state_store: store(state({
        selected_offering_code: 'redes_informaticas', stage: 'course_selected',
        call_preference: 'call', call_offer_status: 'accepted', call_offer_count: 0,
        awaiting_reply: 'none',
      })),
      call_facts: {
        async loadClaimedCallFacts() {
          return {
            open_offer: null,
            open_retry_prompt: null,
            active_call: null,
            last_call_result: {
              call_id: '44444444-4444-4444-8444-444444444444',
              result: 'buzon_de_voz',
              ended_at: '2026-10-21T10:30:30.117Z',
            },
            last_decline_at: null,
          };
        },
      },
      now: () => Date.parse(index.as_of),
    });

    expect(prepared.transition).toMatchObject({
      stage: 'course_selected',
      call_preference: 'unknown',
      call_offer_status: 'offered',
      call_offer_count: 1,
      awaiting_reply: 'call_or_chat',
    });
  });

  it('persists released terminal consent when the customer resumes the sale', async () => {
    const prepared = await prepareAgentTurnV2({
      turn: { id: ids.turn, workspace_id: ids.workspace, conversation_id: ids.conversation, contact_id: ids.contact },
      workspace_slug: 'studyx', business_context: business, catalog_index: index,
      current_customer_messages: ['quiero pagar'],
      proposal: proposal({
        move: {
          schema_version: 1, move: 'ask_payment_options', secondary_moves: [], vetoes: [],
          course_reference: 'redes_informaticas', confidence: 0.98,
        },
        response: { messages: ['Te muestro las formas disponibles para avanzar.'] },
      }),
    }, {
      state_store: store(state({
        selected_offering_code: 'redes_informaticas', stage: 'course_selected',
        call_preference: 'call', call_offer_status: 'accepted', call_offer_count: 0,
        awaiting_reply: 'call_or_chat',
      })),
      call_facts: {
        async loadClaimedCallFacts() {
          return {
            open_offer: null,
            open_retry_prompt: null,
            active_call: null,
            last_call_result: {
              call_id: '44444444-4444-4444-8444-444444444444',
              result: 'buzon_de_voz',
              ended_at: '2026-10-21T17:19:06.022Z',
            },
            last_decline_at: null,
          };
        },
      },
      contact_intake: completeIntake,
      now: () => Date.parse(index.as_of),
    });

    expect(prepared.transition).toMatchObject({
      selected_offering_code: 'redes_informaticas',
      stage: 'course_selected',
      call_preference: 'unknown',
      call_offer_status: 'not_offered',
      call_offer_count: 0,
      awaiting_reply: 'none',
    });
  });

  it('keeps Agent A conversationally in control when payment intake is incomplete', async () => {
    const prepared = await prepareAgentTurnV2({
      turn: { id: ids.turn, workspace_id: ids.workspace, conversation_id: ids.conversation, contact_id: ids.contact },
      workspace_slug: 'studyx', business_context: business, catalog_index: index,
      current_customer_messages: ['Mandame el link de seis cuotas'],
      proposal: proposal({
        move: {
          schema_version: 1, move: 'request_payment_link', secondary_moves: [], vetoes: [],
          payment_plan: 'monthly_6', confidence: 0.98,
        },
        response: { messages: ['Claro. Para enviártelo necesito tu correo.'] },
        proposed_action: {
          type: 'send_payment_link', offering_code: 'redes_informaticas', payment_plan: 'monthly_6',
        },
      }),
    }, {
      state_store: store(state({
        selected_offering_code: 'redes_informaticas',
        selected_payment_plan: 'monthly_6',
        stage: 'plan_selected',
      })),
      contact_intake: async () => ({
        nombre: 'Lucía', apellido: 'Pérez', correo: null, telefono: '+5491112345678',
      }),
      now: () => Date.parse(index.as_of),
    });

    expect(prepared).toMatchObject({
      decision: {
        response: 'Claro. Para enviártelo necesito tu correo.',
        business_action: null,
      },
      action_rejection: {
        action: 'send_payment_link',
        status: 'needs_input',
        code: 'MISSING_INTAKE',
        codes: ['MISSING_INTAKE'],
        missing_fields: ['correo'],
        canonical_data: { offering_code: 'redes_informaticas', payment_plan: 'monthly_6' },
        retryable: false,
      },
      transition: {
        selected_offering_code: 'redes_informaticas',
        selected_payment_plan: 'monthly_6',
        stage: 'plan_selected',
        awaiting_reply: 'contact_details',
        payment_link_request: { status: 'pending' },
      },
    });
  });

  it('executes a direct call request immediately when canonical call data is complete', async () => {
    const prepared = await prepareAgentTurnV2({
      turn: { id: ids.turn, workspace_id: ids.workspace, conversation_id: ids.conversation, contact_id: ids.contact },
      workspace_slug: 'studyx', business_context: business, catalog_index: index,
      current_customer_messages: ['Llamame'],
      proposal: proposal({
        move: {
          schema_version: 1, move: 'request_call', secondary_moves: [], vetoes: [], confidence: 0.99,
        },
        response: { messages: ['Dale. ¿Puedes atender si te llamamos ahora?'] },
        proposed_action: { type: 'request_call_now', reason: 'direct_request' },
      }),
    }, {
      state_store: store(state()),
      contact_intake: completeIntake,
      now: () => Date.parse(index.as_of),
    });

    expect(prepared).toMatchObject({
      decision: {
        response: 'Dale. ¿Puedes atender si te llamamos ahora?',
        business_action: { type: 'request_call_now', reason: 'direct_request' },
      },
      transition: {
        call_preference: 'call',
        call_offer_status: 'accepted',
        awaiting_reply: 'none',
        stage: 'handoff',
      },
    });
  });

  it('keeps call intent but rejects dispatch while a known voice email is not typed in WhatsApp', async () => {
    const prepared = await prepareAgentTurnV2({
      turn: { id: ids.turn, workspace_id: ids.workspace, conversation_id: ids.conversation, contact_id: ids.contact },
      workspace_slug: 'studyx', business_context: business, catalog_index: index,
      current_customer_messages: ['Llamame'],
      proposal: proposal({
        move: { schema_version: 1, move: 'request_call', secondary_moves: [], vetoes: [], confidence: 0.99 },
        response: { messages: ['Escribime tu correo por acá y seguimos con la llamada.'] },
        proposed_action: { type: 'request_call_now', reason: 'direct_request' },
      }),
    }, {
      state_store: store(state()),
      contact_intake: completeIntake,
      call_intake_readiness: async () => ({
        status: 'needs_input',
        intake: await completeIntake(),
        requirements: [{ field: 'correo', reason: 'written_whatsapp_confirmation_required' }],
      }),
      now: () => Date.parse(index.as_of),
    });

    expect(prepared.decision.business_action).toBeNull();
    expect(prepared.action_rejection).toMatchObject({
      action: 'request_call_now',
      status: 'needs_input',
      missing_fields: ['correo'],
    });
    expect(prepared.transition).toMatchObject({
      call_preference: 'call', call_offer_status: 'accepted', awaiting_reply: 'contact_details',
    });
  });

  it('does not treat the final email as consent to call now', async () => {
    const prepared = await prepareAgentTurnV2({
      turn: { id: ids.turn, workspace_id: ids.workspace, conversation_id: ids.conversation, contact_id: ids.contact },
      workspace_slug: 'studyx', business_context: business, catalog_index: index,
      current_customer_messages: ['matia@example.test'],
      proposal: proposal({
        move: { schema_version: 1, move: 'request_call', secondary_moves: [], vetoes: [], confidence: 0.99 },
        response: { messages: ['Listo. Podés atender si te llamamos ahora?'] },
        proposed_action: { type: 'request_call_now', reason: 'direct_request' },
      }),
    }, {
      state_store: store(state({
        call_preference: 'call', call_offer_status: 'accepted', awaiting_reply: 'call_or_chat',
      })),
      contact_intake: completeIntake,
      call_intake_readiness: async () => ({
        status: 'ready', intake: await completeIntake(), requirements: [],
      }),
      now: () => Date.parse(index.as_of),
    });

    expect(prepared.decision.business_action).toBeNull();
    expect(prepared.transition).toMatchObject({
      call_preference: 'call', call_offer_status: 'accepted', awaiting_reply: 'call_or_chat',
    });
  });

  it.each([
    'Ahora puedo atender',
    'Estoy disponible',
    'Sí, ahora puedo',
  ])('accepts Agent A semantic evidence for natural current availability: %s', async (text) => {
    const prepared = await prepareAgentTurnV2({
      turn: { id: ids.turn, workspace_id: ids.workspace, conversation_id: ids.conversation, contact_id: ids.contact },
      workspace_slug: 'studyx', business_context: business, catalog_index: index,
      current_customer_messages: [text],
      proposal: proposal({
        move: { schema_version: 1, move: 'request_call', secondary_moves: [], vetoes: [], confidence: 0.99 },
        response: { messages: ['Perfecto, te llamamos ahora.'] },
        proposed_action: { type: 'request_call_now', reason: 'accepted_offer' },
      }),
    }, {
      state_store: store(state({
        call_preference: 'call', call_offer_status: 'accepted', awaiting_reply: 'call_or_chat',
      })),
      contact_intake: completeIntake,
      call_intake_readiness: async () => ({
        status: 'ready', intake: await completeIntake(), requirements: [],
      }),
      now: () => Date.parse(index.as_of),
    });

    expect(prepared.decision.business_action).toEqual({
      type: 'request_call_now', reason: 'direct_request',
    });
  });

  it('rejects semantic dispatch when the same turn only provides profile data', async () => {
    const prepared = await prepareAgentTurnV2({
      turn: { id: ids.turn, workspace_id: ids.workspace, conversation_id: ids.conversation, contact_id: ids.contact },
      workspace_slug: 'studyx', business_context: business, catalog_index: index,
      current_customer_messages: ['Mi correo es matia@example.test'],
      proposal: proposal({
        move: { schema_version: 1, move: 'request_call', secondary_moves: [], vetoes: [], confidence: 0.99 },
        response: { messages: ['Listo. ¿Podés atender ahora?'] },
        proposed_action: { type: 'request_call_now', reason: 'accepted_offer' },
        profile_updates: [{
          field: 'correo', operation: 'set', value: 'matia@example.test',
          source_message_id: '10000000-0000-4000-8000-000000000099',
          source_quote: 'matia@example.test',
        }],
      }),
    }, {
      state_store: store(state({
        call_preference: 'call', call_offer_status: 'accepted', awaiting_reply: 'call_or_chat',
      })),
      contact_intake: completeIntake,
      call_intake_readiness: async () => ({
        status: 'ready', intake: await completeIntake(), requirements: [],
      }),
      now: () => Date.parse(index.as_of),
    });

    expect(prepared.decision.business_action).toBeNull();
    expect(prepared.transition).toMatchObject({
      call_preference: 'call', call_offer_status: 'accepted', awaiting_reply: 'call_or_chat',
    });
  });

  it.each([
    'Mi correo es matia@example.test, gracias',
    'Soy Matia Pérez, mi correo es matia@example.test',
  ])('does not treat conversational profile data as availability: %s', async (text) => {
    const prepared = await prepareAgentTurnV2({
      turn: { id: ids.turn, workspace_id: ids.workspace, conversation_id: ids.conversation, contact_id: ids.contact },
      workspace_slug: 'studyx', business_context: business, catalog_index: index,
      current_customer_messages: [text],
      proposal: proposal({
        move: { schema_version: 1, move: 'request_call', secondary_moves: [], vetoes: [], confidence: 0.99 },
        response: { messages: ['Listo. ¿Podés atender ahora?'] },
        proposed_action: { type: 'request_call_now', reason: 'accepted_offer' },
      }),
    }, {
      state_store: store(state({
        call_preference: 'call', call_offer_status: 'accepted', awaiting_reply: 'call_or_chat',
      })),
      contact_intake: completeIntake,
      call_intake_readiness: async () => ({
        status: 'ready', intake: await completeIntake(), requirements: [],
      }),
      now: () => Date.parse(index.as_of),
    });

    expect(prepared.decision.business_action).toBeNull();
  });

  it('accepts semantic availability when the same turn also updates profile data', async () => {
    const prepared = await prepareAgentTurnV2({
      turn: { id: ids.turn, workspace_id: ids.workspace, conversation_id: ids.conversation, contact_id: ids.contact },
      workspace_slug: 'studyx', business_context: business, catalog_index: index,
      current_customer_messages: ['Mi correo es matia@example.test y ahora puedo atender'],
      proposal: proposal({
        move: { schema_version: 1, move: 'request_call', secondary_moves: [], vetoes: [], confidence: 0.99 },
        response: { messages: ['Perfecto, te llamamos ahora.'] },
        proposed_action: { type: 'request_call_now', reason: 'accepted_offer' },
        profile_updates: [{
          field: 'correo', operation: 'set', value: 'matia@example.test',
          source_message_id: '10000000-0000-4000-8000-000000000099',
          source_quote: 'matia@example.test',
        }],
      }),
    }, {
      state_store: store(state({
        call_preference: 'call', call_offer_status: 'accepted', awaiting_reply: 'call_or_chat',
      })),
      contact_intake: completeIntake,
      call_intake_readiness: async () => ({
        status: 'ready', intake: await completeIntake(), requirements: [],
      }),
      now: () => Date.parse(index.as_of),
    });

    expect(prepared.decision.business_action).toMatchObject({ type: 'request_call_now' });
  });

  it('rejects semantic dispatch after a later call refusal', async () => {
    const rejected = prepareAgentTurnV2({
      turn: { id: ids.turn, workspace_id: ids.workspace, conversation_id: ids.conversation, contact_id: ids.contact },
      workspace_slug: 'studyx', business_context: business, catalog_index: index,
      current_customer_messages: ['Ahora puedo atender', 'Ahora no puedo atender'],
      proposal: proposal({
        move: { schema_version: 1, move: 'request_call', secondary_moves: [], vetoes: [], confidence: 0.99 },
        response: { messages: ['Entendido, seguimos por chat.'] },
        proposed_action: { type: 'request_call_now', reason: 'accepted_offer' },
      }),
    }, {
      state_store: store(state({
        call_preference: 'call', call_offer_status: 'accepted', awaiting_reply: 'call_or_chat',
      })),
      contact_intake: completeIntake,
      call_intake_readiness: async () => ({
        status: 'ready', intake: await completeIntake(), requirements: [],
      }),
      now: () => Date.parse(index.as_of),
    });

    // P:208–212/236: do not commit a semantic acceptance of revoked consent.
    await expect(rejected).rejects.toMatchObject({ rejectionSubjects: ['call_consent_revoked'] });
  });

  it('prepares a direct call request and waits for a later availability confirmation', async () => {
    const prepared = await prepareAgentTurnV2({
      turn: { id: ids.turn, workspace_id: ids.workspace, conversation_id: ids.conversation, contact_id: ids.contact },
      workspace_slug: 'studyx', business_context: business, catalog_index: index,
      current_customer_messages: ['Llamame'],
      proposal: proposal({
        move: {
          schema_version: 1, move: 'request_call', secondary_moves: [], vetoes: [], confidence: 0.98,
        },
        response: { messages: ['Dale. ¿Puedes atender si te llamamos ahora?'] },
      }),
    }, {
      state_store: store(state()),
      contact_intake: completeIntake,
      now: () => Date.parse(index.as_of),
    });

    expect(prepared.decision.business_action).toBeNull();
    expect(prepared.transition).toMatchObject({
      call_preference: 'call',
      call_offer_status: 'accepted',
      awaiting_reply: 'call_or_chat',
    });
  });

  it('dispatches only after a later reply confirms availability', async () => {
    const prepared = await prepareAgentTurnV2({
      turn: { id: ids.turn, workspace_id: ids.workspace, conversation_id: ids.conversation, contact_id: ids.contact },
      workspace_slug: 'studyx', business_context: business, catalog_index: index,
      current_customer_messages: ['Sí'],
      proposal: proposal({
        move: {
          schema_version: 1, move: 'request_call', secondary_moves: [], vetoes: [], confidence: 0.98,
        },
        response: { messages: ['Dale, te llamamos ahora.'] },
        proposed_action: { type: 'request_call_now', reason: 'direct_request' },
      }),
    }, {
      state_store: store(state({
        call_preference: 'call', call_offer_status: 'accepted', awaiting_reply: 'call_or_chat',
      })),
      contact_intake: completeIntake,
      now: () => Date.parse(index.as_of),
    });

    expect(prepared.decision.business_action).toEqual({
      type: 'request_call_now',
      reason: 'direct_request',
    });
    expect(prepared.transition).toMatchObject({
      call_preference: 'call', call_offer_status: 'accepted', awaiting_reply: 'none', stage: 'handoff',
    });
  });

  it.each(['no', 'no, mejor no', 'ahora no', 'por ahora no', 'prefiero que no'])(
    'does not dispatch when a later message in the availability burst says %s',
    async (refusal) => {
      const rejected = prepareAgentTurnV2({
        turn: { id: ids.turn, workspace_id: ids.workspace, conversation_id: ids.conversation, contact_id: ids.contact },
        workspace_slug: 'studyx', business_context: business, catalog_index: index,
        current_customer_messages: ['sí, dale', refusal],
        proposal: proposal({
          move: {
            schema_version: 1, move: 'request_call', secondary_moves: [], vetoes: [], confidence: 0.98,
          },
          response: { messages: ['Perfecto, seguimos por acá.'] },
          proposed_action: { type: 'request_call_now', reason: 'direct_request' },
        }),
      }, {
        state_store: store(state({
          call_preference: 'call', call_offer_status: 'accepted', awaiting_reply: 'call_or_chat',
        })),
        contact_intake: completeIntake,
        now: () => Date.parse(index.as_of),
      });

      await expect(rejected).rejects.toMatchObject({ rejectionSubjects: ['call_consent_revoked'] });
    },
  );

  it('prepares a retry and asks availability before dispatching again', async () => {
    const prepared = await prepareAgentTurnV2({
      turn: { id: ids.turn, workspace_id: ids.workspace, conversation_id: ids.conversation, contact_id: ids.contact },
      workspace_slug: 'studyx', business_context: business, catalog_index: index,
      current_customer_messages: ['Sí, intenta nuevamente'],
      proposal: proposal({
        move: {
          schema_version: 1, move: 'request_call', secondary_moves: [], vetoes: [], confidence: 0.98,
        },
        response: { messages: ['Claro. ¿Puedes atender si te llamamos ahora?'] },
      }),
    }, {
      state_store: store(state()),
      call_facts: {
        async loadClaimedCallFacts() {
          return {
            open_offer: null,
            open_retry_prompt: {
              call_id: '10000000-0000-4000-8000-000000000005',
              offered_at: '2026-09-02T15:58:00.000Z',
            },
            active_call: null,
            last_call_result: {
              call_id: '10000000-0000-4000-8000-000000000005',
              result: 'no_answer',
              ended_at: '2026-09-02T15:57:30.000Z',
            },
            last_decline_at: null,
          };
        },
      },
      contact_intake: completeIntake,
      now: () => Date.parse(index.as_of),
    });

    expect(prepared.decision.business_action).toBeNull();
    expect(prepared.transition).toMatchObject({
      call_preference: 'call', call_offer_status: 'accepted', awaiting_reply: 'call_or_chat',
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

  it('records model-owned course interest and price objection without manufacturing a purchase selection', async () => {
    const prepared = await prepareAgentTurnV2({
      turn: { id: ids.turn, workspace_id: ids.workspace, conversation_id: ids.conversation, contact_id: ids.contact },
      workspace_slug: 'studyx', business_context: business, catalog_index: index,
      current_customer_messages: ['Redes me interesa, pero sigue fuera de mi presupuesto'],
      proposal: proposal({
        move: {
          schema_version: 1,
          move: 'ask_course_information',
          secondary_moves: [],
          vetoes: [],
          course_reference: 'redes',
          confidence: 1,
        },
        response: { messages: ['Te entiendo. Veamos qué valor concreto te puede aportar para decidirlo con claridad.'] },
        memory_candidates: [{
          type: 'objection',
          key: 'price_objection',
          value: 'El precio está fuera de su presupuesto',
          source_quote: 'sigue fuera de mi presupuesto',
          confidence: 1,
        }],
      }),
    }, { state_store: store(state()), now: () => Date.parse(index.as_of) });

    expect(prepared).toMatchObject({
      discussed_offering_code: 'redes_informaticas',
      commercial_interest_offering_code: 'redes_informaticas',
      records_price_objection: true,
      transition: { selected_offering_code: null },
    });
  });

  it('binds one canonical course named by Agent A to a model-owned price objection without selecting it', async () => {
    const prepared = await prepareAgentTurnV2({
      turn: { id: ids.turn, workspace_id: ids.workspace, conversation_id: ids.conversation, contact_id: ids.contact },
      workspace_slug: 'studyx', business_context: business, catalog_index: index,
      current_customer_messages: ['Sigue fuera de mi presupuesto'],
      proposal: proposal({
        move: {
          schema_version: 1,
          move: 'ask_course_information',
          secondary_moves: [],
          vetoes: [],
          confidence: 1,
        },
        response: { messages: ['Redes Informáticas puede servirte para empezar por una base concreta.'] },
        memory_candidates: [{
          type: 'objection',
          key: 'price_objection',
          value: 'El precio sigue fuera de su presupuesto',
          source_quote: 'Sigue fuera de mi presupuesto',
          confidence: 1,
        }],
      }),
    }, { state_store: store(state()), now: () => Date.parse(index.as_of) });

    expect(prepared).toMatchObject({
      discussed_offering_code: null,
      commercial_interest_offering_code: 'redes_informaticas',
      records_price_objection: true,
      transition: { selected_offering_code: null },
    });
  });

  it.each(['offer_available', 'accepted'] as const)(
    'keeps the paid course when an %s promotion response names only the bonus course', async status => {
      const englishIndex: CatalogIndexView = {
        ...index,
        offerings_total: 2,
        offerings: [
          { code: 'ingles_1', display_name: 'Inglés 1', academy: 'Academia Cultural', aliases: [] },
          { code: 'ingles_2', display_name: 'Inglés 2', academy: 'Academia Cultural', aliases: [] },
        ],
      };
      const englishBusiness: BusinessContextView = {
        ...business,
        offerings: [
          { ...business.offerings[0], code: 'ingles_1', display_name: 'Inglés 1' },
          { ...business.offerings[0], code: 'ingles_2', display_name: 'Inglés 2' },
        ],
      };
      const prepared = await prepareAgentTurnV2({
        turn: { id: ids.turn, workspace_id: ids.workspace, conversation_id: ids.conversation, contact_id: ids.contact },
        workspace_slug: 'studyx', business_context: englishBusiness, catalog_index: englishIndex,
        current_customer_messages: ['¿Qué incluye la propuesta?'],
        course_bonus_capability: {
          status,
          may_schedule_checkin: false,
          may_request_review: false,
          may_accept_offer: status === 'offer_available',
          may_send_promoted_payment: status === 'accepted',
          promotion_code: 'ingles_1_mas_ingles_2',
          interest_offering_code: 'ingles_1',
          bonus_offerings: [{ code: 'ingles_2', display_name: 'Inglés 2', position: 1 }],
        },
        proposal: proposal({
          response: { messages: ['Inglés 2 puede complementar tu formación.'] },
        }),
      }, { state_store: store(state()), now: () => Date.parse(index.as_of) });

      expect(prepared).toMatchObject({
        discussed_offering_code: null,
        commercial_interest_offering_code: 'ingles_1',
      });
    },
  );

  it.each((['offer_available','accepted','no_capability'] as const).flatMap(status =>
    (['select_course','request_call'] as const).map(move => ({status,move}))))('marks an effective course switch to retire previous payment intent ($status/$move)', async ({status,move}) => {
    const packageIndex: CatalogIndexView = {
      ...index,
      offerings_total: 2,
      offerings: [
        { code: 'redes_informaticas', display_name: 'Redes Informáticas', academy: 'Tecnología', aliases: ['redes'] },
        { code: 'excel_integral', display_name: 'Excel Integral', academy: 'Tecnología', aliases: ['excel'] },
      ],
    };
    const packageBusiness: BusinessContextView = {
      ...business,
      offerings: [
        business.offerings[0],
        { ...business.offerings[0], code: 'excel_integral', display_name: 'Excel Integral', aliases: ['excel'] },
      ],
    };
    const prepared = await prepareAgentTurnV2({
      turn: { id: ids.turn, workspace_id: ids.workspace, conversation_id: ids.conversation, contact_id: ids.contact },
      workspace_slug: 'studyx', business_context: packageBusiness, catalog_index: packageIndex,
      current_customer_messages: ['No quiero el paquete. Quiero comprar solamente Excel'],
      course_bonus_capability: status === 'no_capability' ? undefined : {
        status,
        may_schedule_checkin: false,
        may_request_review: false,
        may_accept_offer: true,
        may_send_promoted_payment: false,
        promotion_code: 'redes_con_excel',
        interest_offering_code: 'redes_informaticas',
        bonus_offerings: [{ code: 'excel_integral', display_name: 'Excel Integral', position: 1 }],
      },
      proposal: proposal({
        move: {
          schema_version: 1, move,
          secondary_moves: move === 'request_call' ? ['select_course'] : [],
          vetoes: [],
          course_reference: 'excel', confidence: 1,
        },
        response: { messages: ['Perfecto, seguimos únicamente con Excel Integral.'] },
      }),
    }, {
      state_store: store(state({ selected_offering_code: 'redes_informaticas', stage: 'course_selected' })),
      now: () => Date.parse(index.as_of),
    });

    expect(prepared).toMatchObject({
      abandons_course_bonus_offer: true,
      commercial_interest_offering_code: 'excel_integral',
      transition: { selected_offering_code: 'excel_integral' },
    });
  });

  it('clears the previous promotion focus when a closed sale starts generic catalog exploration', async () => {
    const catalogIndex: CatalogIndexView = {
      ...index,
      offerings_total: 2,
      offerings: [
        ...index.offerings,
        { code: 'excel_integral', display_name: 'Excel Integral', academy: 'Tecnología', aliases: ['excel'] },
      ],
    };
    const businessContext: BusinessContextView = {
      ...business,
      offerings: [
        ...business.offerings,
        { ...business.offerings[0]!, code: 'excel_integral', display_name: 'Excel Integral', aliases: ['excel'] },
      ],
    };
    const prepared = await prepareAgentTurnV2({
      turn: { id: ids.turn, workspace_id: ids.workspace, conversation_id: ids.conversation, contact_id: ids.contact },
      workspace_slug: 'studyx', business_context: businessContext, catalog_index: catalogIndex,
      current_customer_messages: ['Qué otros cursos tienen?'],
      course_bonus_capability: {
        status: 'accepted',
        may_schedule_checkin: false,
        may_request_review: false,
        may_accept_offer: false,
        may_send_promoted_payment: true,
        promotion_code: 'redes_con_excel',
        interest_offering_code: 'redes_informaticas',
        bonus_offerings: [{ code: 'excel_integral', display_name: 'Excel Integral', position: 1 }],
      },
      proposal: proposal({
        move: {
          schema_version: 1, move: 'browse_catalog', secondary_moves: [], vetoes: [], confidence: 1,
        },
        response: { messages: ['Podemos ver Redes Informáticas o Excel Integral según lo que quieras lograr.'] },
      }),
    }, {
      state_store: store(state({
        selected_offering_code: 'redes_informaticas',
        selected_payment_plan: 'monthly_6',
        stage: 'closed',
        call_preference: 'chat',
        call_offer_status: 'declined',
        call_offer_count: 2,
        payment_reported_at: '2026-10-20T12:00:00.000Z',
      })),
      now: () => Date.parse(index.as_of),
    });

    expect(prepared).toMatchObject({
      commercial_interest_offering_code: null,
      records_price_objection: false,
      resets_promotion_context: true,
      transition: {
        selected_offering_code: null,
        selected_payment_plan: null,
        stage: 'exploring',
        call_offer_count: 0,
        payment_reported: false,
        reset_payment_reported: true,
      },
    });
  });

  it.each([
    'No te recomiendo Redes Informáticas para lo que buscas.',
    'No necesitas Redes Informáticas para alcanzar ese objetivo.',
    'Redes Informáticas no sería adecuada para tu nivel.',
    'Redes Informáticas está descartada para este caso.',
  ])('does not turn a rejected canonical course mention into commercial interest: %s', async response => {
    const prepared = await prepareAgentTurnV2({
      turn: { id: ids.turn, workspace_id: ids.workspace, conversation_id: ids.conversation, contact_id: ids.contact },
      workspace_slug: 'studyx', business_context: business, catalog_index: index,
      current_customer_messages: ['Sigue fuera de mi presupuesto'],
      proposal: proposal({
        response: { messages: [response] },
        memory_candidates: [{
          type: 'objection', key: 'price_objection', value: 'El precio sigue fuera de su presupuesto',
          source_quote: 'Sigue fuera de mi presupuesto', confidence: 1,
        }],
      }),
    }, { state_store: store(state()), now: () => Date.parse(index.as_of) });

    expect(prepared).toMatchObject({
      discussed_offering_code: null,
      commercial_interest_offering_code: null,
      records_price_objection: false,
    });
  });

  it('does not transfer a rejected promotion review into price-objection evidence for a new course', async () => {
    const prepared = await prepareAgentTurnV2({
      turn: { id: ids.turn, workspace_id: ids.workspace, conversation_id: ids.conversation, contact_id: ids.contact },
      workspace_slug: 'studyx', business_context: business, catalog_index: index,
      current_customer_messages: ['Ahora quiero saber por Redes'],
      course_bonus_capability: {
        status: 'review_available',
        may_schedule_checkin: false,
        may_request_review: true,
        may_accept_offer: false,
        may_send_promoted_payment: false,
        promotion_code: null,
        interest_offering_code: 'excel_integral',
        bonus_offerings: [],
      },
      proposal: proposal({
        move: {
          schema_version: 1,
          move: 'ask_course_information',
          secondary_moves: [],
          vetoes: [],
          course_reference: 'redes',
          confidence: 1,
        },
        response: { messages: ['Claro, veamos Redes según lo que necesitas.'] },
        proposed_action: { type: 'request_promotion_review', reason: 'persistent_price_objection' },
      }),
    }, { state_store: store(state()), now: () => Date.parse(index.as_of) });

    expect(prepared).toMatchObject({
      response_messages: ['Claro, veamos Redes según lo que necesitas.'],
      discussed_offering_code: 'redes_informaticas',
      commercial_interest_offering_code: 'redes_informaticas',
      records_price_objection: false,
      transition: { selected_offering_code: null },
      action_rejection: { action: 'request_promotion_review', codes: ['ACTION_NOT_AUTHORIZED'] },
    });
    expect(prepared.decision.business_action).toBeNull();
  });
});

it('persists semantic call acceptance when the channel has no callable phone', async () => {
  const prepared = await prepareAgentTurnV2({
    turn: { id: ids.turn, workspace_id: ids.workspace, conversation_id: ids.conversation, contact_id: ids.contact },
    workspace_slug: 'studyx', business_context: business, catalog_index: index,
    current_customer_messages: ['Dsle llamame'],
    proposal: proposal({
      move: { schema_version: 1, move: 'request_call', secondary_moves: [], vetoes: [], confidence: 0.95 },
      response: { messages: ['A qué número con código de país y área puedo llamarte?'] },
    }),
  }, {
    state_store: store(state()), now: () => Date.parse(index.as_of),
    contact_intake: async () => ({ nombre: 'Ludmi', apellido: null, correo: null, telefono: null }),
  });
  expect(prepared.decision.business_action).toBeNull();
  expect(prepared.transition).toMatchObject({ call_preference: 'call', call_offer_status: 'accepted' });
});
