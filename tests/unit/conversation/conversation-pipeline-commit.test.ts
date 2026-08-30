import { describe, expect, it } from 'vitest';
import type { BusinessContextView, CatalogIndexView } from '@/features/orchestration/domain/business-context';
import type { ConversationStateV1 } from '@/features/conversation/domain/conversation-pipeline';
import type { ConversationStateStoreV1 } from '@/features/conversation/ports/conversation-state-store';
import { authoritativelyPlanConversationTurnV1 } from '@/features/conversation/application/plan-conversation-turn';
import {
  prepareConversationPipelineCommitV1,
  ConversationPlanMismatchError,
} from '@/features/conversation/application/prepare-conversation-pipeline-commit';
import {
  buildAuthorizedEgress,
  verifyAuthorizedEgress,
} from '@/features/orchestration/domain/egress-guard';

const ids = {
  workspace: '00000000-0000-4000-8000-000000000001',
  conversation: '00000000-0000-4000-8000-000000000002',
  contact: '00000000-0000-4000-8000-000000000003',
  turn: '00000000-0000-4000-8000-000000000004',
};

const index: CatalogIndexView = {
  as_of: '2026-08-27T16:00:00.000Z', offerings_total: 1,
  offerings: [{
    code: 'redes-informaticas', display_name: 'Redes Informáticas', academy: 'Tecnología', aliases: [],
  }],
  injection_suspected_count: 0,
};

const business = {
  as_of: index.as_of, prices_assertable: true,
  workspace: {
    slug: 'studyx', display_name: 'StudyX', environment: 'sandbox', default_locale: 'es-AR',
    timezone: 'America/Argentina/Buenos_Aires', payment_options: [{
      code: 'monthly_12', label: '12 cuotas mensuales', total: { amount: '360.00', currency: 'USD' },
      installments: 12, installment_amount: '30.00', payment_link: 'https://buy.stripe.com/test_authorized',
    }],
  },
  offerings: [{
    code: 'redes-informaticas', display_name: 'Redes Informáticas', aliases: [], academy: 'Tecnología',
    offering_type: 'course', description: 'Formación canónica en redes.', value_proposition: null,
    price_type: 'fixed', price: { amount: '360.00', currency: 'USD' }, price_assertable: true,
    billing_interval: null, modality: 'online', schedules: [], certification: true,
    hours_per_month: 8, classes: 24, modules: 4, includes: [], syllabus_published: true,
    language: 'Spanish', min_age: null,
    policies: { allowed_promise: null, forbidden_promises: [], price_message: null },
  }],
  qualification_fields: [], injection_suspected_count: 0, offerings_truncated: 0,
} satisfies BusinessContextView;

function state(overrides: Partial<ConversationStateV1> = {}): ConversationStateV1 {
  return {
    workspace_id: ids.workspace, conversation_id: ids.conversation, contact_id: ids.contact,
    selected_offering_code: 'redes-informaticas', selected_payment_plan: null,
    stage: 'course_selected', call_preference: 'unknown', call_offer_status: 'not_offered',
    call_offer_count: 0,
    awaiting_reply: 'none', source_turn_id: null, version: 2,
    created_at: '2099-01-01T00:00:00.000Z', updated_at: '2099-01-01T00:00:00.000Z', ...overrides,
  };
}

function store(current: ConversationStateV1): ConversationStateStoreV1 {
  return {
    async load() { return current; },
    async transition() { throw new Error('prepare must not persist'); },
  };
}

describe('prepareConversationPipelineCommitV1', () => {
  it('authorizes the second bounded offer while the first offer is still unanswered', async () => {
    const planned = await authoritativelyPlanConversationTurnV1({
      turn: { workspace_id: ids.workspace, conversation_id: ids.conversation, contact_id: ids.contact },
      workspace_slug: 'studyx',
      move: {
        schema_version: 1, move: 'ask_course_information', secondary_moves: [], vetoes: [], confidence: 0.96,
      },
      business_context: business,
      catalog_index: index,
    }, {
      state_store: store(state({ call_offer_status: 'offered', call_offer_count: 1, awaiting_reply: 'call_or_chat' })),
      call_facts: {
        async loadClaimedCallFacts() {
          return {
            open_offer: { decision_id: ids.turn, offered_at: index.as_of },
            active_call: null,
            last_call_result: null,
            last_decline_at: null,
          };
        },
      },
    });

    expect(planned.plan).toMatchObject({
      should_offer_call: true,
      next_call_offer_count: 2,
      next_call_offer_status: 'offered',
    });
  });

  it('replans, compares the hash and builds a canonical call offer decision', async () => {
    const stateStore = store(state());
    const move = {
      schema_version: 1 as const, move: 'ask_course_information' as const,
      secondary_moves: [], vetoes: [], confidence: 0.96,
    };
    const planned = await authoritativelyPlanConversationTurnV1({
      turn: { workspace_id: ids.workspace, conversation_id: ids.conversation, contact_id: ids.contact },
      workspace_slug: 'studyx', move, business_context: business, catalog_index: index,
    }, { state_store: stateStore });
    const prepared = await prepareConversationPipelineCommitV1({
      turn: { id: ids.turn, workspace_id: ids.workspace, conversation_id: ids.conversation, contact_id: ids.contact },
      workspace_slug: 'studyx', move, expected_plan_hash: planned.plan_hash,
      composition: {
        schema_version: 1,
        narrative: { opening: 'Te comparto la información disponible.', explanation: null, next_question: null },
        used_fact_ids: planned.fact_refs.map((fact) => fact.id),
      },
      business_context: business, catalog_index: index,
    }, { state_store: stateStore });

    expect(prepared.decision).toMatchObject({
      schema_version: 4, response_type: 'call_offer', business_action: null,
      next_state: 'waiting_user', reason_code: 'CONVERSATION_PIPELINE_V1',
    });
    expect(prepared.decision.response).toContain('24 clases');
    expect(prepared.authorized_protected_facts).toEqual(expect.arrayContaining([
      { kind: 'duration', value: '24 clases' },
      { kind: 'modality', value: 'online' },
    ]));
    expect(prepared.transition).toMatchObject({
      source_turn_id: ids.turn, call_offer_status: 'offered', awaiting_reply: 'call_or_chat',
    });
  });

  it('authorizes a natural offering assertion only when it names the canonical course', async () => {
    const stateStore = store(state());
    const move = {
      schema_version: 1 as const, move: 'ask_course_information' as const,
      secondary_moves: [], vetoes: [], course_reference: 'Redes Informáticas', confidence: 0.96,
    };
    const planned = await authoritativelyPlanConversationTurnV1({
      turn: { workspace_id: ids.workspace, conversation_id: ids.conversation, contact_id: ids.contact },
      workspace_slug: 'studyx', move, business_context: business, catalog_index: index,
    }, { state_store: stateStore });
    const nameFact = planned.fact_refs.find((fact) => fact.kind === 'offering_name');
    expect(nameFact).toBeDefined();

    const prepared = await prepareConversationPipelineCommitV1({
      turn: { id: ids.turn, workspace_id: ids.workspace, conversation_id: ids.conversation, contact_id: ids.contact },
      workspace_slug: 'studyx', move, expected_plan_hash: planned.plan_hash,
      composition: {
        schema_version: 1,
        narrative: {
          opening: 'Podés estudiar Redes Informáticas con nosotros.',
          explanation: 'Te acompaño a ver si encaja con tu objetivo.',
          next_question: '¿Lo buscás para trabajar o para formación personal?',
        },
        used_fact_ids: [nameFact!.id],
      },
      business_context: business, catalog_index: index,
    }, { state_store: stateStore });

    expect(prepared.authorized_protected_facts).toContainEqual({
      kind: 'offering',
      value: 'podés estudiar redes informáticas con nosotros',
    });
    const manifest = buildAuthorizedEgress({
      content: prepared.decision.response ?? '',
      authorized_urls: [],
      protected_facts: prepared.authorized_protected_facts,
    });
    expect(verifyAuthorizedEgress({
      content: prepared.decision.response ?? '',
      manifest,
    })).toEqual({ ok: true });
  });

  it('rejects a stale or tampered plan hash before creating authority', async () => {
    await expect(prepareConversationPipelineCommitV1({
      turn: { id: ids.turn, workspace_id: ids.workspace, conversation_id: ids.conversation, contact_id: ids.contact },
      workspace_slug: 'studyx',
      move: {
        schema_version: 1, move: 'request_payment_link', secondary_moves: [], vetoes: [], confidence: 1,
      },
      expected_plan_hash: '0'.repeat(64),
      composition: {
        schema_version: 1,
        narrative: { opening: 'Perfecto.', explanation: null, next_question: null },
        used_fact_ids: [],
      },
      business_context: business, catalog_index: index,
    }, { state_store: store(state({ selected_payment_plan: 'monthly_12', stage: 'plan_selected' })) }))
      .rejects.toBeInstanceOf(ConversationPlanMismatchError);
  });

  it('derives course and plan again and emits exactly the typed payment action', async () => {
    const stateStore = store(state({ selected_payment_plan: 'monthly_12', stage: 'plan_selected', awaiting_reply: 'payment_confirmation' }));
    const move = {
      schema_version: 1 as const, move: 'request_payment_link' as const,
      secondary_moves: [], vetoes: [], confidence: 0.98,
    };
    const planned = await authoritativelyPlanConversationTurnV1({
      turn: { workspace_id: ids.workspace, conversation_id: ids.conversation, contact_id: ids.contact },
      workspace_slug: 'studyx', move, business_context: business, catalog_index: index,
    }, { state_store: stateStore });
    const prepared = await prepareConversationPipelineCommitV1({
      turn: { id: ids.turn, workspace_id: ids.workspace, conversation_id: ids.conversation, contact_id: ids.contact },
      workspace_slug: 'studyx', move, expected_plan_hash: planned.plan_hash,
      composition: {
        schema_version: 1,
        narrative: { opening: 'Perfecto, podés avanzar.', explanation: null, next_question: null },
        used_fact_ids: planned.fact_refs.map((fact) => fact.id),
      },
      business_context: business, catalog_index: index,
    }, { state_store: stateStore });

    expect(prepared.decision.business_action).toEqual({
      type: 'send_payment_link', plan_code: 'monthly_12', offering_sku: 'redes-informaticas',
    });
    expect(prepared.authorized_payment_plan).toBe('monthly_12');
    expect(prepared.authorized_offering_code).toBe('redes-informaticas');
    expect(prepared.decision.response?.split('https://buy.stripe.com/test_authorized')).toHaveLength(2);
  });
});
