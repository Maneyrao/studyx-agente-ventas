import { describe, expect, it } from 'vitest';
import {
  bindCurrentCatalogResolutionToMoveV1,
  bindCurrentConversationalIntentToMoveV1,
  buildAgentAContextV1,
} from '../../../botpress-agent/src/lib/conversation/agent-a-context';
import type { ClaimedTurn } from '../../../botpress-agent/src/schemas/contracts';
import type { ConversationMoveV1 } from '../../../botpress-agent/src/schemas/conversation-pipeline';
import { resolveAgentAPlannerlessProposalV2 } from '../../../botpress-agent/src/lib/conversation/resolve-agent-a-plannerless';
import { authorizeAgentTurnV2 } from '@/features/conversation/domain/agent-turn-policy-v2';
import { createDefaultConversationStateV1 } from '@/features/conversation/domain/conversation-planner';
import type { AgentATurnProposalV1 } from '../../../botpress-agent/src/schemas/agent-a-brain';
import { deriveCourseBonusLadderV1 } from '@/shared/conversation/bonus-ladder';

const UUID = '18a823e8-27c2-4279-9956-058f45f33cd5';
const NOW = '2026-08-28T12:00:00.000Z';

function causallyLinkedRecentTurn(input: {
  readonly direction: 'inbound' | 'outbound';
  readonly content: string;
  readonly created_at: string;
  readonly batch_id: string | null;
  readonly in_reply_to: string | null;
}): ClaimedTurn['context']['recent_turns'][number] {
  // The causal links are claim metadata used only by the brain-context projection.
  return input as unknown as ClaimedTurn['context']['recent_turns'][number];
}

function claimedTurn(): ClaimedTurn {
  return {
    outcome: 'claimed',
    trace_id: UUID,
    batch: {
      id: UUID,
      claim_token: UUID,
      conversation_id: UUID,
      contact_id: UUID,
      lease_until: NOW,
      hard_deadline_at: NOW,
      message_count: 1,
      stolen: false,
    },
    turn_id: UUID,
    policy: { may_respond: true, allowed_response_types: ['commercial_reply'], reason: null },
    contact_intake_missing: [],
    contact: {
      id: UUID,
      status: 'prospecto',
      name: 'Matías',
      blocked: false,
      consent_status: 'allowed',
      opted_in_at: NOW,
    },
    context: {
      batch_messages: [{
        id: UUID,
        conversation_seq: 11,
        content: 'Quiero más información sobre Redes Informáticas',
        created_at: NOW,
        message_type: 'text',
      }],
      recent_turns: Array.from({ length: 20 }, (_, index) => ({
        direction: index % 2 === 0 ? 'inbound' as const : 'outbound' as const,
        content: `turno-${index + 1}`,
        created_at: `2026-08-28T11:${String(index).padStart(2, '0')}:00.000Z`,
      })),
      summary: { text: null, version: 0, updated_at: null },
      selected_memories: [
        ['memory-relevant', 0.99], ['memory-2', 0.95], ['memory-3', 0.9],
        ['memory-4', 0.85], ['memory-5', 0.8], ['memory-dropped', 0.79],
      ].map(([memory_id, similarity], index) => ({
        memory_id: String(memory_id),
        type: index === 0 ? 'study_goal' : 'preference',
        key: index === 0 ? 'career_goal' : `preference_${index}`,
        value: index === 0 ? 'busca salida laboral' : `preferencia ${index}`,
        source_quote: index === 0 ? 'Quiero estudiar para conseguir trabajo' : `prefiero ${index}`,
        similarity: Number(similarity),
        recorded_at: NOW,
      })),
      long_term_memory_available: true,
      knowledge_base: [],
      knowledge_base_available: true,
      knowledge_base_dropped: 0,
      injection_suspected_count: 0,
    },
    sales_context: {
      mode: 'awaiting_call_consent',
      stage: 'course_selected',
      course_of_interest: 'Redes Informáticas',
      offering_code: 'redes-informaticas',
      selected_payment_plan: null,
      open_call_offer: { decision_id: UUID, expires_at: NOW },
      accepted_call_offer: null,
      active_call: null,
      allowed_actions: ['offer_call', 'request_call_now'],
      last_call_result: null,
    },
    features: { agent_loop_v3_mode: 'off', conversation_pipeline_v1_enabled: true },
    conversation_state_v1: {
      selected_offering_code: 'redes-informaticas',
      selected_payment_plan: null,
      stage: 'course_selected',
      call_preference: 'unknown',
      call_offer_status: 'offered',
      call_offer_count: 1,
      awaiting_reply: 'call_or_chat',
      version: 2,
    },
    catalog_resolution: {
      kind: 'exact',
      offeringCode: 'redes-informaticas',
      displayName: 'Redes Informáticas',
      academy: 'Tecnología',
      match: 'canonical',
    },
    catalog_index: {
      as_of: NOW,
      offerings_total: 5,
      offerings: Array.from({ length: 5 }, (_, index) => ({
        code: index === 0 ? 'redes-informaticas' : `curso-${index}`,
        display_name: index === 0 ? 'Redes Informáticas' : `Curso ${index}`,
        academy: 'Tecnología',
        aliases: [],
      })),
      injection_suspected_count: 0,
    },
    deterministic_route: null,
    diagnostics: {
      timings: {
        claim_total_ms: 1,
        core_db_ms: 1,
        shared_embedding_ms: 1,
        memory_search_ms: 1,
        knowledge_search_ms: 1,
        business_snapshot_ms: 1,
      },
      counters: {
        embedding_calls: 1,
        memory_search_calls: 1,
        knowledge_search_calls: 1,
        business_snapshot_calls: 1,
        catalog_calls: 1,
      },
    },
    business_context: {
      as_of: NOW,
      prices_assertable: true,
      workspace: {
        slug: 'studyx',
        display_name: 'StudyX',
        environment: 'production',
        default_locale: 'es',
        timezone: 'America/New_York',
        payment_options: [{
          code: 'monthly_12',
          label: '12 pagos mensuales de USD 30',
          total: { amount: '360.00', currency: 'USD' },
          installments: 12,
          installment_amount: '30.00',
          payment_link: 'https://buy.stripe.com/secret-canonical-link',
        }],
      },
      offerings: [{
        code: 'redes-informaticas',
        display_name: 'Redes Informáticas',
        aliases: [],
        academy: 'Tecnología',
        offering_type: 'course',
        description: 'Aprendé fundamentos de redes.',
        value_proposition: null,
        price_type: 'fixed',
        price: { amount: '360.00', currency: 'USD' },
        price_assertable: true,
        billing_interval: null,
        modality: '100% online',
        schedules: [],
        certification: null,
        hours_per_month: null,
        classes: 38,
        modules: null,
        includes: [],
        syllabus_published: true,
        language: 'Spanish',
        min_age: 18,
        policies: { allowed_promise: null, forbidden_promises: [], price_message: null },
      }],
      qualification_fields: [],
      injection_suspected_count: 0,
      offerings_truncated: 0,
    },
    business_context_available: true,
    existing_result: null,
  } as ClaimedTurn;
}

describe('buildAgentAContextV1', () => {
  it('exposes recorded negotiation facts without converting them into bonus eligibility (P:106-120)', () => {
    const claimed = claimedTurn();
    const evidence = { status: 'confirmed' as const, offering_code: 'redes-informaticas',
      source_turn_id: UUID, source_message_id: UUID, source_quote: 'El precio es lo único que me frena',
      recorded_at: NOW, interpretation_source: 'committed_agent_observation' as const };
    Object.assign(claimed, { negotiation_facts: { price_objection_count: 5,
      latest_price_objection_source_turn_ids: [UUID], price_only_barrier: evidence } });
    claimed.conversation_state_v1 = { ...claimed.conversation_state_v1!, call_offer_status: 'declined', stage: 'closed' };
    const context = buildAgentAContextV1(claimed)!;
    expect(context.commercial_state).toMatchObject({ negotiation: {
      price_objections: { count: 5, scope: 'conversation_prior_recorded_sources', latest_source_turn_ids: [UUID] },
      price_only_barrier: evidence,
      call_invitation: { status: 'declined', authorization: 'not_authorized' },
      delivered_bonus_offers: null,
    } });
    expect(context.capabilities.course_bonus).toBeUndefined();
    expect(Object.keys((context.commercial_state as unknown as { negotiation: object }).negotiation))
      .not.toContain('next_step');
  });

  it('preserves unknown negotiation facts instead of claiming zero objections or no customer confirmation', () => {
    const context = buildAgentAContextV1(claimedTurn())!;
    expect(context.commercial_state).toMatchObject({ negotiation: {
      price_objections: { count: null, latest_source_turn_ids: [] },
      price_only_barrier: { status: 'unknown' }, delivered_bonus_offers: null,
    } });
  });

  it('does not reuse another course confirmation or treat offered bonuses as delivered', () => {
    const claimed = claimedTurn();
    Object.assign(claimed, { negotiation_facts: { price_objection_count: 3,
      latest_price_objection_source_turn_ids: [UUID], price_only_barrier: {
        status: 'confirmed', offering_code: 'other-course', source_turn_id: UUID, source_message_id: UUID,
        source_quote: 'sólo el precio', recorded_at: NOW, interpretation_source: 'committed_agent_observation',
      } } });
    expect(buildAgentAContextV1(claimed)!.commercial_state.negotiation?.price_only_barrier).toEqual({ status: 'unknown' });
    const offered = { code: 'curso-1', display_name: 'Curso 1', position: 1 };
    Object.assign(claimed, { course_bonus_capability: { status: 'offer_available', enabled: true,
      may_offer_bonus: true, may_schedule_checkin: false, may_request_review: false, may_accept_offer: false,
      may_send_promoted_payment: false, promotion_code: null, interest_offering_code: 'redes-informaticas',
      bonus_offerings: [offered], delivered_bonus_offerings: [],
    } });
    expect(buildAgentAContextV1(claimed)!.commercial_state.negotiation?.delivered_bonus_offers).toEqual([]);
    Object.assign(claimed.course_bonus_capability!, { delivered_bonus_offerings: [offered] });
    expect(buildAgentAContextV1(claimed)!.commercial_state.negotiation?.delivered_bonus_offers).toEqual([offered]);
  });

  it('projects the exact course syllabus as an authorized fact instead of leaving it only in retrieval text', () => {
    const claimed = claimedTurn();
    claimed.context.knowledge_base = [{
      source_uri: 'knowledge-source:11111111-1111-4111-8111-111111111111',
      title: 'Temario — Redes Informáticas',
      content: 'Clase 1: fundamentos de redes. Clase 2: direccionamiento IP.',
      similarity: 1,
      offering_code: 'redes-informaticas',
    }];

    const context = buildAgentAContextV1(claimed)!;

    expect(context.catalog.selected_offering?.facts).toContainEqual({
      id: 'knowledge-source:11111111-1111-4111-8111-111111111111',
      kind: 'offering_syllabus',
      value: 'Clase 1: fundamentos de redes. Clase 2: direccionamiento IP.',
    });
  });

  it('bounds a long syllabus to the canonical fact contract', () => {
    const claimed = claimedTurn();
    claimed.context.knowledge_base = [{
      source_uri: 'knowledge-source:11111111-1111-4111-8111-111111111111',
      title: 'Temario largo — Redes Informáticas',
      content: `Clase 1: ${'contenido '.repeat(180)}`,
      similarity: 1,
      offering_code: 'redes-informaticas',
    }];

    const context = buildAgentAContextV1(claimed)!;
    const syllabus = context.catalog.selected_offering?.facts.find((fact) => fact.kind === 'offering_syllabus');

    expect(syllabus?.value).toHaveLength(1_200);
  });

  it('exposes the pending availability checkpoint after accepted-call contact data is complete', () => {
    const claimed = claimedTurn();
    claimed.context.batch_messages[0] = {
      ...claimed.context.batch_messages[0]!,
      content: 'Soy Ana Pérez, ana@example.com, +5491112345678',
    };
    claimed.conversation_state_v1 = {
      ...claimed.conversation_state_v1!,
      call_preference: 'call',
      call_offer_status: 'accepted',
      awaiting_reply: 'call_or_chat',
    };
    claimed.call_intake_readiness = { status: 'ready', requirements: [] };
    claimed.sales_context.allowed_actions = [];

    const context = buildAgentAContextV1(claimed)!;

    expect(context.capabilities.call_execution).toEqual({
      next_step: 'confirm_availability',
      request_call_now_authorized: false,
    });
  });

  it('retires the call execution checkpoint when the customer explicitly chooses chat', () => {
    const claimed = claimedTurn();
    claimed.context.batch_messages[0] = {
      ...claimed.context.batch_messages[0]!,
      content: 'Ahora no puedo, sigamos por chat',
    };
    claimed.conversation_state_v1 = {
      ...claimed.conversation_state_v1!,
      call_preference: 'call',
      call_offer_status: 'accepted',
      awaiting_reply: 'call_or_chat',
    };
    claimed.call_intake_readiness = { status: 'ready', requirements: [] };
    claimed.sales_context.allowed_actions = [];

    const context = buildAgentAContextV1(claimed)!;

    expect(context.capabilities.call_execution).toEqual({
      next_step: 'none',
      request_call_now_authorized: false,
    });
  });

  it('authorizes dispatch when availability is confirmed after the checkpoint', () => {
    const claimed = claimedTurn();
    claimed.context.batch_messages[0] = {
      ...claimed.context.batch_messages[0]!,
      content: 'Sí, ahora puedo atender',
    };
    claimed.conversation_state_v1 = {
      ...claimed.conversation_state_v1!,
      call_preference: 'call',
      call_offer_status: 'accepted',
      awaiting_reply: 'call_or_chat',
    };
    claimed.call_intake_readiness = { status: 'ready', requirements: [] };
    claimed.sales_context.allowed_actions = [];

    const context = buildAgentAContextV1(claimed)!;

    expect(context.capabilities.call_execution).toEqual({
      next_step: 'dispatch_authorized',
      request_call_now_authorized: true,
    });
  });

  it.each(['offered','accepted','attached'] as const)('projects durable %s direct identity with new-offer creation disabled', status => {
    const claimed=claimedTurn();
    claimed.course_bonus_capability={enabled:false,max_bonus_courses:2,may_offer_bonus:false,
      status:status==='offered'?'offer_available':'accepted',may_schedule_checkin:false,may_request_review:false,
      may_accept_offer:status==='offered',may_send_promoted_payment:status!=='offered',
      promotion_code:'direct-package',promotion_cycle_id:UUID,offer_version:1,package_status:status,
      interest_offering_code:'redes-informaticas',accepted_at:status==='offered'?null:NOW,
      bonus_offerings:[{code:'ingles_1',display_name:'Inglés 1',position:1,offered_at:NOW}],
      delivered_bonus_offerings:[{code:'ingles_1',display_name:'Inglés 1',position:1}]};
    const projected=buildAgentAContextV1(claimed)!;
    expect(projected.commercial_state.promotion).toEqual({promotion_code:'direct-package',promotion_cycle_id:UUID,
      offer_version:1,status:status==='offered'?'offer_available':'accepted',interest_offering_code:'redes-informaticas',
      accepted_at:status==='offered'?null:NOW,
      bonus_offerings:[{offering_code:'ingles_1',name:'Inglés 1',position:1,offered_at:NOW}]});
    expect(projected.capabilities.course_bonus).toMatchObject({enabled:false,may_offer_bonus:false,
      may_accept_offer:status==='offered',package_status:status});
  });
  it('preserves the backend ladder facts in the model context', () => {
    const claimed = claimedTurn();
    const ladder = deriveCourseBonusLadderV1({ price_evidence: true, retention_used: false });
    claimed.course_bonus_capability = {
      status: 'not_eligible', may_schedule_checkin: false, may_request_review: false,
      may_accept_offer: false, may_send_promoted_payment: false,
      promotion_code: null, bonus_offerings: [], ladder,
    };
    expect(buildAgentAContextV1(claimed)!.capabilities.course_bonus?.ladder).toEqual(ladder);
  });

  it('projects the durable direct package into commercial state without deriving it from prose', () => {
    const claimed=claimedTurn();
    claimed.course_bonus_capability={enabled:true,max_bonus_courses:2,may_offer_bonus:true,
      status:'offer_available',may_schedule_checkin:false,may_request_review:false,may_accept_offer:true,
      may_send_promoted_payment:false,promotion_code:'p',promotion_cycle_id:UUID,offer_version:1,
      package_status:'offered',interest_offering_code:'redes-informaticas',accepted_at:null,
      bonus_offerings:[{code:'ingles_1',display_name:'Inglés 1',position:1,offered_at:NOW}],
      delivered_bonus_offerings:[{code:'ingles_1',display_name:'Inglés 1',position:1}]};
    expect(buildAgentAContextV1(claimed)!.commercial_state.promotion).toEqual({promotion_code:'p',
      promotion_cycle_id:UUID,offer_version:1,status:'offer_available',interest_offering_code:'redes-informaticas',
      accepted_at:null,bonus_offerings:[{offering_code:'ingles_1',name:'Inglés 1',position:1,offered_at:NOW}]});
  });
  it('projects durable summary memory and twenty logical interventions to Agent A', () => {
    const claimed = claimedTurn();
    claimed.context.summary = {
      text: 'Matías busca salida laboral y prefiere estudiar por la noche.',
      version: 7,
      updated_at: NOW,
    };

    const context = buildAgentAContextV1(claimed)!;

    expect(context.customer.conversation_summary).toEqual({
      text: 'Matías busca salida laboral y prefiere estudiar por la noche.',
      version: 7,
      updated_at: NOW,
    });
    expect(context.turn.recent_turns).toHaveLength(20);
    expect(context.turn.recent_turns[0]?.content).toBe('turno-1');
  });

  it.each([
    ['1', 'pago'],
    ['1 pago'],
    ['un pago de 360'],
  ])('lets Agent A persist the canonical one-time request after a call before reconfirmation: %j', async (...messages) => {
    const claimed = claimedTurn();
    claimed.catalog_resolution = { kind: 'no_catalog_intent' };
    claimed.context.batch_messages = messages.map((content, index) => ({
      ...claimed.context.batch_messages[0]!, id: `${UUID}-${index}`, content,
    }));
    claimed.context.recent_turns = [{ direction: 'outbound', created_at: NOW,
      content: 'Puedes elegir 12 pagos de USD 30, 6 pagos de USD 60 o 1 pago de USD 360.' }];
    claimed.conversation_state_v1 = { ...claimed.conversation_state_v1!,
      selected_payment_plan: null, stage: 'handoff', awaiting_reply: 'none',
      call_preference: 'call', call_offer_status: 'accepted' };
    claimed.contact_intake = {
      nombre: 'Matías', apellido: 'Damonte', correo: 'matias@example.test', telefono: '+5491112345678',
    };
    claimed.business_context!.workspace.payment_options = [{
      code: 'one_time', label: '1 pago de USD 360', total: { amount: '360.00', currency: 'USD' },
      installments: 1, installment_amount: '360.00', payment_link: 'https://buy.stripe.com/local-test',
    }];
    const move: ConversationMoveV1 = { schema_version: 1, move: 'select_payment_plan',
      secondary_moves: ['request_payment_link'], vetoes: [], payment_plan: 'one_time', confidence: 1 };
    const paymentProposal: AgentATurnProposalV1 = {
      schema_version: 1, move, response: { messages: ['Perfecto, te comparto el enlace seguro.'], call_offer: null },
      proposed_action: { type: 'send_payment_link', offering_code: 'redes-informaticas', payment_plan: 'one_time' },
      course_mentions: [], used_fact_ids: [], used_memory_ids: [], memory_candidates: [], repair_of: null,
    };
    const backend = authorizeAgentTurnV2({
      proposal: paymentProposal,
      state: { ...createDefaultConversationStateV1({ workspace_id: UUID, conversation_id: UUID, contact_id: UUID }),
        selected_offering_code: 'redes-informaticas', selected_payment_plan: null, stage: 'handoff' },
      offerings: [{ code: 'redes-informaticas', display_name: 'Redes Informáticas' }],
      facts: [{ id: 'payment:redes-informaticas:one_time:label:v1', kind: 'payment_plan_label',
        source: 'business_snapshot', value: '1 pago de USD 360', offering_code: 'redes-informaticas', payment_plan: 'one_time' }],
      contact_intake: claimed.contact_intake,
      current_customer_messages: messages,
      call_policy: { may_offer_call: false, may_request_call_now: false },
    });
    expect(backend).toMatchObject({ ok: true, action: { type: 'none' }, transition: {
      selected_payment_plan: 'one_time', stage: 'plan_selected', awaiting_reply: 'payment_confirmation',
      payment_link_request: { status: 'pending' },
    } });
    const context = buildAgentAContextV1(claimed)!;
    expect(context.capabilities.may_send_payment_link).toBe(true);
    expect(bindCurrentConversationalIntentToMoveV1(move, claimed)).toEqual(move);
    const result = await resolveAgentAPlannerlessProposalV2({
      initial: { proposal: { ...paymentProposal, move: bindCurrentConversationalIntentToMoveV1(move, claimed) },
        provider: 'deepseek-direct', model: 'offline-test', latency_ms: 0, attempt_count: 1 },
      context, repair_enabled: false, semantic_rejections: 'advisory', rejection_id: UUID,
      repair: async () => { throw new Error('Unexpected repair'); },
    });
    expect(result.effective.proposal.proposed_action).toEqual({
      type: 'send_payment_link', offering_code: 'redes-informaticas', payment_plan: 'one_time',
    });
    expect(result.evidence.repair_attempted).toBe(false);
  });

  it('preserves a model-interpreted payment choice outside the payment phrase parser', () => {
    const claimed = claimedTurn();
    claimed.context.batch_messages[0]!.content = '1 pago';
    const move: ConversationMoveV1 = { schema_version: 1, move: 'select_payment_plan',
      secondary_moves: ['request_payment_link'], vetoes: [], payment_plan: 'one_time', confidence: 1 };
    expect(bindCurrentConversationalIntentToMoveV1(move, claimed)).toEqual(move);
  });

  it.each(['blocked contact', 'opt-out policy', 'unknown course', 'missing intake', 'unreadable input', 'paid purchase'])(
    'keeps the payment resource unavailable for %s', condition => {
      const claimed = claimedTurn();
      claimed.catalog_resolution = { kind: 'no_catalog_intent' };
      claimed.conversation_state_v1 = { ...claimed.conversation_state_v1!, stage: 'handoff', awaiting_reply: 'none' };
      if (condition === 'blocked contact') claimed.contact.blocked = true;
      if (condition === 'opt-out policy') claimed.policy.may_respond = false;
      if (condition === 'unknown course') claimed.conversation_state_v1.selected_offering_code = 'unknown-course';
      if (condition === 'missing intake') claimed.contact_intake_missing = ['correo'];
      if (condition === 'unreadable input') claimed.context.batch_messages[0]!.message_type = 'unsupported';
      if (condition === 'paid purchase') claimed.payment_verification = {
        status: 'paid', offering_code: 'redes-informaticas', plan_code: 'monthly_12', paid_at: NOW,
      };
      expect(buildAgentAContextV1(claimed)!.capabilities.may_send_payment_link).toBe(false);
    },
  );

  it('projects the durable active call without authorizing another dispatch', () => {
    const claimed = claimedTurn();
    claimed.sales_context.active_call = { call_id: UUID, status: 'provider_accepted' };
    const context = buildAgentAContextV1(claimed);
    expect(context?.commercial_state.active_call).toEqual({ call_id: UUID, status: 'provider_accepted' });
    expect(context?.capabilities.may_request_call_now).toBe(false);
  });

  it('projects a terminal call result even when the provider supplied no classification', () => {
    const claimed = claimedTurn();
    claimed.sales_context.active_call = null;
    claimed.sales_context.last_call_result = {
      call_id: UUID,
      result: null,
      ended_at: '2026-08-28T11:03:00.000Z',
    };

    const context = buildAgentAContextV1(claimed);

    expect(context?.commercial_state.active_call).toBeNull();
    expect(context?.commercial_state.last_call_result).toEqual({
      call_id: UUID,
      result: null,
      ended_at: '2026-08-28T11:03:00.000Z',
    });
  });

  it('exposes an unreadable input as recoverable context without authorizing an action', () => {
    const claimed = claimedTurn();
    claimed.policy = {
      may_respond: true,
      allowed_response_types: ['commercial_reply', 'clarification', 'technical_fallback'],
      reason: 'UNSUPPORTED_MESSAGE_TYPE',
    };
    claimed.context.batch_messages = [{
      id: UUID,
      conversation_seq: 11,
      content: '[whatsapp_media_no_soportado]',
      created_at: NOW,
      message_type: 'unsupported',
    }];

    const context = buildAgentAContextV1(claimed);

    expect(context?.turn.input_capability).toEqual({
      status: 'unreadable',
      unavailable_message_count: 1,
    });
    expect(context?.turn.batch_messages).toEqual([{
      id: UUID,
      text: '[contenido_no_interpretable]',
    }]);
    expect(context?.capabilities.may_reply).toBe(true);
    expect(context?.capabilities.may_request_call_now).toBe(false);
  });

  it('keeps readable text and marks a mixed batch as partially understood', () => {
    const claimed = claimedTurn();
    claimed.context.batch_messages = [
      {
        id: UUID,
        conversation_seq: 11,
        content: 'Quiero información de Inglés 2',
        created_at: NOW,
        message_type: 'text',
      },
      {
        id: '11111111-1111-4111-8111-111111111111',
        conversation_seq: 12,
        content: '[whatsapp_media_no_soportado]',
        created_at: NOW,
        message_type: 'unsupported',
      },
    ];

    const context = buildAgentAContextV1(claimed);

    expect(context?.turn.input_capability).toEqual({
      status: 'partially_understood',
      unavailable_message_count: 1,
    });
    expect(context?.turn.batch_messages).toEqual([
      { id: UUID, text: 'Quiero información de Inglés 2' },
      {
        id: '11111111-1111-4111-8111-111111111111',
        text: '[contenido_no_interpretable]',
      },
    ]);
  });

  it('projects the latest canonical Stripe status without treating the customer claim as evidence', () => {
    const claimed = claimedTurn();
    (claimed as ClaimedTurn & {
      payment_verification: {
        status: 'paid'; offering_code: string; plan_code: null; paid_at: string;
      };
    }).payment_verification = {
      status: 'paid',
      offering_code: 'redes-informaticas',
      plan_code: null,
      paid_at: NOW,
    };

    const context = buildAgentAContextV1(claimed);

    expect(context?.commercial_state.payment_verification).toEqual({
      status: 'paid',
      offering_code: 'redes-informaticas',
      plan_code: null,
      paid_at: NOW,
    });
  });

  it('exposes the temporary USD 0.50 checkout as an authorized non-commercial payment option', () => {
    const context = buildAgentAContextV1(claimedTurn());

    expect(context?.catalog.test_payment_options).toEqual([{
      code: 'stripe_verification_050',
      fact_id: 'payment-test:stripe_verification_050:label:v1',
      label: 'Prueba temporal de pago de USD 0,50',
      action: 'send_test_payment_link',
    }]);
  });

  it('projects a fragmented customer batch and its three reply bubbles as two complete interactions', () => {
    const claimed = claimedTurn();
    claimed.context.recent_turns = [
      causallyLinkedRecentTurn({
        direction: 'inbound',
        content: 'Quiero información de Marketing Digital.',
        created_at: '2026-08-28T11:00:00.000Z',
        batch_id: '11111111-1111-4111-8111-111111111111',
        in_reply_to: null,
      }),
      causallyLinkedRecentTurn({
        direction: 'inbound',
        content: 'Me interesa para trabajar en redes.',
        created_at: '2026-08-28T11:00:01.000Z',
        batch_id: '11111111-1111-4111-8111-111111111111',
        in_reply_to: null,
      }),
      causallyLinkedRecentTurn({
        direction: 'outbound',
        content: 'Marketing Digital tiene 16 clases.',
        created_at: '2026-08-28T11:00:02.000Z',
        batch_id: null,
        in_reply_to: '22222222-2222-4222-8222-222222222222',
      }),
      causallyLinkedRecentTurn({
        direction: 'outbound',
        content: 'Vas a ver contenidos para gestionar redes.',
        created_at: '2026-08-28T11:00:03.000Z',
        batch_id: null,
        in_reply_to: '22222222-2222-4222-8222-222222222222',
      }),
      causallyLinkedRecentTurn({
        direction: 'outbound',
        content: '¿Querés que te cuente la modalidad?',
        created_at: '2026-08-28T11:00:04.000Z',
        batch_id: null,
        in_reply_to: '22222222-2222-4222-8222-222222222222',
      }),
    ];

    const context = buildAgentAContextV1(claimed);

    expect(context?.turn.recent_turns).toEqual([
      expect.objectContaining({
        direction: 'inbound',
        content: 'Quiero información de Marketing Digital.\nMe interesa para trabajar en redes.',
      }),
      expect.objectContaining({
        direction: 'outbound',
        content: [
          'Marketing Digital tiene 16 clases.',
          'Vas a ver contenidos para gestionar redes.',
          '¿Querés que te cuente la modalidad?',
        ].join('\n'),
      }),
    ]);
    expect(context?.continuity?.last_agent_reply).toBe([
      'Marketing Digital tiene 16 clases.',
      'Vas a ver contenidos para gestionar redes.',
      '¿Querés que te cuente la modalidad?',
    ].join('\n'));
  });

  it('prefers the complete backend logical projection over a physically truncated window', () => {
    const claimed = claimedTurn();
    claimed.context.recent_turns = [
      causallyLinkedRecentTurn({
        direction: 'outbound',
        content: 'Segunda burbuja.',
        created_at: '2026-08-28T11:00:02.000Z',
        batch_id: null,
        in_reply_to: '22222222-2222-4222-8222-222222222222',
      }),
      causallyLinkedRecentTurn({
        direction: 'outbound',
        content: 'Tercera burbuja.',
        created_at: '2026-08-28T11:00:03.000Z',
        batch_id: null,
        in_reply_to: '22222222-2222-4222-8222-222222222222',
      }),
    ];
    (claimed.context as unknown as {
      logical_recent_turns: Array<{
        direction: 'inbound' | 'outbound';
        content: string;
        created_at: string;
      }>;
    }).logical_recent_turns = [{
      direction: 'outbound',
      content: 'Primera burbuja.\nSegunda burbuja.\nTercera burbuja.',
      created_at: '2026-08-28T11:00:03.000Z',
    }];

    const context = buildAgentAContextV1(claimed);

    expect(context?.turn.recent_turns).toEqual([
      expect.objectContaining({
        direction: 'outbound',
        content: 'Primera burbuja.\nSegunda burbuja.\nTercera burbuja.',
      }),
    ]);
    expect(context?.continuity?.last_agent_reply).toBe(
      'Primera burbuja.\nSegunda burbuja.\nTercera burbuja.',
    );
  });

  it('carries unanswered customer interventions into the current logical turn', () => {
    const claimed = claimedTurn();
    (claimed.context as unknown as {
      logical_recent_turns: Array<{
        direction: 'inbound' | 'outbound';
        content: string;
        created_at: string;
      }>;
    }).logical_recent_turns = [
      {
        direction: 'outbound',
        content: 'Puedes elegir 12 pagos, 6 pagos o un pago único.',
        created_at: '2026-08-28T11:58:00.000Z',
      },
      {
        direction: 'inbound',
        content: 'Prefiero seguir por chat, en un solo pago está bien, qué datos necesitas?',
        created_at: '2026-08-28T11:59:00.000Z',
      },
    ];
    claimed.context.batch_messages[0] = {
      ...claimed.context.batch_messages[0],
      content: 'El pago es seguro?',
    };

    const context = buildAgentAContextV1(claimed);

    expect(context?.turn.batch_messages.map((message) => message.text)).toEqual([
      'Prefiero seguir por chat, en un solo pago está bien, qué datos necesitas?',
      'El pago es seguro?',
    ]);
  });

  it('preserves Agent A payment plan selected in an unanswered customer intervention', () => {
    const claimed = claimedTurn();
    claimed.catalog_resolution = { kind: 'no_catalog_intent' };
    (claimed.context as unknown as {
      logical_recent_turns: Array<{
        direction: 'inbound' | 'outbound';
        content: string;
        created_at: string;
      }>;
    }).logical_recent_turns = [
      {
        direction: 'outbound',
        content: 'Puedes elegir 12 pagos, 6 pagos o un pago único.',
        created_at: '2026-08-28T11:58:00.000Z',
      },
      {
        direction: 'inbound',
        content: 'Prefiero seguir por chat, en un solo pago está bien, qué datos necesitas?',
        created_at: '2026-08-28T11:59:00.000Z',
      },
    ];
    claimed.context.batch_messages[0] = {
      ...claimed.context.batch_messages[0],
      content: 'El pago es seguro?',
    };

    expect(bindCurrentConversationalIntentToMoveV1({
      schema_version: 1,
      move: 'select_payment_plan',
      payment_plan: 'one_time',
      secondary_moves: [],
      vetoes: [],
      confidence: 0.98,
    }, claimed)).toMatchObject({
      move: 'select_payment_plan',
      payment_plan: 'one_time',
    });
  });

  it('keeps up to ten complete interventions instead of truncating physical rows', () => {
    const claimed = claimedTurn();
    const histories = [
      ['Cliente 1', 'Agente 1'],
      ['Cliente 2', 'Agente 2'],
      ['Cliente 3', 'Agente 3'],
      ['Cliente 4', 'Agente 4'],
    ] as const;
    const batchIds = [
      '31111111-1111-4111-8111-111111111111',
      '32222222-2222-4222-8222-222222222222',
      '33333333-3333-4333-8333-333333333333',
      '34444444-4444-4444-8444-444444444444',
    ] as const;
    const replyIds = [
      '41111111-1111-4111-8111-111111111111',
      '42222222-2222-4222-8222-222222222222',
      '43333333-3333-4333-8333-333333333333',
      '44444444-4444-4444-8444-444444444444',
    ] as const;

    claimed.context.recent_turns = histories.flatMap(([customer, agent], index) => [
      causallyLinkedRecentTurn({
        direction: 'inbound',
        content: customer,
        created_at: `2026-08-28T11:0${index * 2}:00.000Z`,
        batch_id: batchIds[index]!,
        in_reply_to: null,
      }),
      ...(index === 1
        ? [
            'Agente 2, primera burbuja.',
            'Agente 2, segunda burbuja.',
            'Agente 2, tercera burbuja.',
          ].map((content, bubble) => causallyLinkedRecentTurn({
            direction: 'outbound',
            content,
            created_at: `2026-08-28T11:0${index * 2 + 1}:0${bubble}.000Z`,
            batch_id: null,
            in_reply_to: replyIds[index]!,
          }))
        : [causallyLinkedRecentTurn({
            direction: 'outbound',
            content: agent,
            created_at: `2026-08-28T11:0${index * 2 + 1}:00.000Z`,
            batch_id: null,
            in_reply_to: replyIds[index]!,
          })]),
    ]);

    const context = buildAgentAContextV1(claimed);

    expect(context?.turn.recent_turns.map((turn) => turn.content)).toEqual([
      'Cliente 1',
      'Agente 1',
      'Cliente 2',
      'Agente 2, primera burbuja.\nAgente 2, segunda burbuja.\nAgente 2, tercera burbuja.',
      'Cliente 3',
      'Agente 3',
      'Cliente 4',
      'Agente 4',
    ]);
  });

  it('keeps the complete preceding agent intervention visible for short references', () => {
    for (const shortReference of ['Ese', 'Eso', 'Mandámelo']) {
      const claimed = claimedTurn();
      claimed.context.batch_messages[0] = {
        ...claimed.context.batch_messages[0]!,
        content: shortReference,
      };
      claimed.context.recent_turns = [
        causallyLinkedRecentTurn({
          direction: 'inbound',
          content: '¿Qué incluye Marketing Digital?',
          created_at: '2026-08-28T11:00:00.000Z',
          batch_id: '51111111-1111-4111-8111-111111111111',
          in_reply_to: null,
        }),
        causallyLinkedRecentTurn({
          direction: 'outbound',
          content: 'Marketing Digital tiene 16 clases.',
          created_at: '2026-08-28T11:00:01.000Z',
          batch_id: null,
          in_reply_to: '52222222-2222-4222-8222-222222222222',
        }),
        causallyLinkedRecentTurn({
          direction: 'outbound',
          content: 'La modalidad es 100% online.',
          created_at: '2026-08-28T11:00:02.000Z',
          batch_id: null,
          in_reply_to: '52222222-2222-4222-8222-222222222222',
        }),
      ];

      const context = buildAgentAContextV1(claimed);
      const fullPreviousReply = 'Marketing Digital tiene 16 clases.\nLa modalidad es 100% online.';

      expect(context?.turn.batch_messages[0]?.text).toBe(shortReference);
      expect(context?.turn.recent_turns.at(-1)).toMatchObject({
        direction: 'outbound',
        content: fullPreviousReply,
      });
      expect(context?.continuity?.last_agent_reply).toBe(fullPreviousReply);
    }
  });

  it('makes prior introduction and a previously requested name explicit for the next reply', () => {
    const claimed = claimedTurn();
    claimed.contact.name = null;
    claimed.contact_intake_missing = ['nombre', 'apellido', 'correo', 'telefono'];
    claimed.context.batch_messages[0] = {
      ...claimed.context.batch_messages[0],
      content: 'info',
    };
    claimed.context.recent_turns = [
      { direction: 'inbound', content: 'Buenas', created_at: '2026-08-28T11:00:00.000Z' },
      {
        direction: 'outbound',
        content: 'Hola, soy el asistente virtual de StudyX. Cuéntame qué te interesa y tu primer nombre.',
        created_at: '2026-08-28T11:00:04.000Z',
      },
    ];

    expect(buildAgentAContextV1(claimed)?.continuity).toEqual({
      assistant_has_spoken: true,
      first_name_status: 'requested',
      last_agent_reply: 'Hola, soy el asistente virtual de StudyX. Cuéntame qué te interesa y tu primer nombre.',
    });
  });

  it('marks the name known after a fragmented follow-up without losing the previous question', () => {
    const claimed = claimedTurn();
    claimed.contact.name = 'Thiago';
    claimed.contact_intake_missing = ['apellido', 'correo', 'telefono'];
    claimed.context.batch_messages = [
      { ...claimed.context.batch_messages[0]!, id: `${UUID}-1`, content: 'Thiago' },
      { ...claimed.context.batch_messages[0]!, id: `${UUID}-2`, content: 'y me interesa algo de tecnología' },
    ];
    claimed.context.recent_turns = [{
      direction: 'outbound',
      content: 'Qué te gustaría aprender y cómo te llamas?',
      created_at: '2026-08-28T11:00:04.000Z',
    }];

    const context = buildAgentAContextV1(claimed);

    expect(context?.turn.batch_messages.map((message) => message.text)).toEqual([
      'Thiago',
      'y me interesa algo de tecnología',
    ]);
    expect(context?.continuity).toEqual({
      assistant_has_spoken: true,
      first_name_status: 'known',
      last_agent_reply: 'Qué te gustaría aprender y cómo te llamas?',
    });
  });

  it('does not authorize a real call while Telegram still lacks a declared phone', () => {
    const claimed = claimedTurn();
    claimed.contact_intake_missing = ['telefono'];
    claimed.sales_context.allowed_actions = ['request_call_now'];

    const context = buildAgentAContextV1(claimed);

    expect(context?.capabilities.may_request_call_now).toBe(false);
    expect(context?.capabilities.intake_missing).toContain('telefono');
  });

  it('does not re-authorize a call that the claim policy rejected as stale', () => {
    const claimed = claimedTurn();
    claimed.contact_intake_missing = [];
    claimed.contact_intake = {
      nombre: 'Thiago', apellido: 'Test', correo: 'thiago@example.test', telefono: '+5491112345678',
    };
    claimed.sales_context.allowed_actions = [];
    claimed.sales_context.open_call_offer = null;
    claimed.sales_context.accepted_call_offer = null;

    const context = buildAgentAContextV1(claimed);

    expect(context?.capabilities.may_request_call_now).toBe(false);
  });

  it('exposes the canonical intake values needed for a single confirmation step', () => {
    const claimed = claimedTurn();
    claimed.contact_intake = {
      nombre: 'Juan', apellido: 'Perez', correo: 'juan@example.com', telefono: '+5491112345678',
    };

    expect(buildAgentAContextV1(claimed)?.customer.contact_intake).toEqual(claimed.contact_intake);
  });

  it('normalizes blank persisted contact values instead of crashing the workflow', () => {
    const claimed = claimedTurn();
    claimed.contact.name = '';
    claimed.contact_intake = {
      nombre: '', apellido: '   ', correo: '', telefono: null,
    };
    claimed.contact_intake_missing = ['nombre', 'apellido', 'correo', 'telefono'];

    const context = buildAgentAContextV1(claimed);

    expect(context?.customer.display_name).toBeNull();
    expect(context?.customer.contact_intake).toEqual({
      nombre: null, apellido: null, correo: null, telefono: null,
    });
  });

  it('exposes the pending link for an explicitly requested redelivery', () => {
    const claimed = claimedTurn();
    claimed.catalog_resolution = { kind: 'no_catalog_intent' };
    claimed.conversation_state_v1 = {
      ...claimed.conversation_state_v1!,
      selected_payment_plan: 'monthly_12',
      stage: 'payment_link_sent',
      awaiting_reply: 'none',
    };

    const context = buildAgentAContextV1(claimed);

    expect(context?.capabilities.may_send_payment_link).toBe(true);
  });

  it('exposes the resource after contact intake without inferring link consent', () => {
    const claimed = claimedTurn();
    claimed.context.batch_messages[0] = {
      ...claimed.context.batch_messages[0]!,
      content: 'Mi apellido es Damonte, mi correo es matias@example.com y mi teléfono es +5491112345678',
    };
    claimed.contact_intake = {
      nombre: 'Matías', apellido: 'Damonte', correo: 'matias@example.com', telefono: '+5491112345678',
    };
    claimed.contact_intake_missing = [];
    claimed.catalog_resolution = { kind: 'no_catalog_intent' };
    claimed.conversation_state_v1 = {
      ...claimed.conversation_state_v1!,
      selected_payment_plan: 'monthly_12',
      stage: 'plan_selected',
      awaiting_reply: 'payment_confirmation',
    };

    const context = buildAgentAContextV1(claimed);

    expect(context?.capabilities.may_send_payment_link).toBe(true);
    expect(context?.customer.contact_intake).toEqual(claimed.contact_intake);
  });

  it('authorizes the pending payment request when the same turn completes contact intake', () => {
    const claimed = claimedTurn();
    claimed.context.batch_messages[0] = {
      ...claimed.context.batch_messages[0]!,
      content: 'Mi teléfono es +5491112345678',
    };
    claimed.contact_intake = {
      nombre: 'Matías', apellido: 'Damonte', correo: 'matias@example.com', telefono: '+5491112345678',
    };
    claimed.contact_intake_missing = [];
    claimed.catalog_resolution = { kind: 'no_catalog_intent' };
    claimed.conversation_state_v1 = {
      ...claimed.conversation_state_v1!,
      selected_payment_plan: 'monthly_12',
      stage: 'plan_selected',
      awaiting_reply: 'contact_details',
      payment_link_request: {
        status: 'pending', offering_code: 'redes-informaticas', payment_plan: 'monthly_12',
        requested_by_turn_id: '44444444-4444-4444-8444-444444444444',
        resolved_by_decision_id: null,
      },
    } as typeof claimed.conversation_state_v1;

    const context = buildAgentAContextV1(claimed);

    expect(context?.capabilities.may_send_payment_link).toBe(true);
  });

  it('authorizes the payment link only after contact confirmation is pending', () => {
    const claimed = claimedTurn();
    claimed.context.batch_messages[0] = {
      ...claimed.context.batch_messages[0]!,
      content: 'Sí, los datos están correctos. Envíame el link.',
    };
    claimed.contact_intake_missing = [];
    claimed.catalog_resolution = { kind: 'no_catalog_intent' };
    claimed.conversation_state_v1 = {
      ...claimed.conversation_state_v1!,
      selected_payment_plan: 'monthly_12',
      stage: 'plan_selected',
      awaiting_reply: 'payment_confirmation',
    };

    expect(buildAgentAContextV1(claimed)?.capabilities.may_send_payment_link).toBe(true);
  });

  it('does not use a missing first name as a backend veto for a conversational call offer', () => {
    const claimed = claimedTurn();
    claimed.contact.name = null;
    claimed.contact_intake_missing = ['nombre', 'apellido', 'correo', 'telefono'];
    claimed.conversation_state_v1 = {
      ...claimed.conversation_state_v1!,
      call_preference: 'unknown',
      call_offer_status: 'not_offered',
      call_offer_count: 0,
    };

    const context = buildAgentAContextV1(claimed);

    expect(context?.capabilities.may_offer_call).toBe(true);
  });

  it('takes the academy from the canonical snapshot and the advisor from configuration', () => {
    const context = buildAgentAContextV1(claimedTurn(), 'Camila');

    expect(context?.identity).toEqual({
      advisor_name: 'Camila',
      academy_name: 'StudyX',
      website: null,
      instagram: null,
    });
  });

  it('declares no identity rather than invent who is speaking', () => {
    // Sin nombre de asesor configurado el prompt canónico viaja sin resolver:
    // la regla del preámbulo ("never echo an unresolved placeholder") es
    // preferible a que el modelo se ponga un nombre.
    expect(buildAgentAContextV1(claimedTurn(), null)?.identity).toBeNull();
    expect(buildAgentAContextV1(claimedTurn(), '   ')?.identity).toBeNull();

    const withoutSnapshot = claimedTurn();
    withoutSnapshot.business_context = null;
    expect(buildAgentAContextV1(withoutSnapshot, 'Camila')?.identity).toBeNull();
  });

  it('does not revive a legacy sales selection after the conversation state was reset', () => {
    const claimed = claimedTurn();
    claimed.context.batch_messages[0] = {
      ...claimed.context.batch_messages[0],
      content: 'Hola',
    };
    claimed.catalog_resolution = { kind: 'no_catalog_intent' };
    claimed.conversation_state_v1 = {
      ...claimed.conversation_state_v1!,
      selected_offering_code: null,
      selected_payment_plan: null,
      stage: 'exploring',
      call_preference: 'unknown',
      call_offer_status: 'not_offered',
      call_offer_count: 0,
      awaiting_reply: 'none',
    };

    const context = buildAgentAContextV1(claimed);

    expect(context?.commercial_state.selected_offering_code).toBeNull();
    expect(context?.catalog.selected_offering).toBeNull();
  });

  it('keeps the call budget available for a course selected semantically in this turn', () => {
    const claimed = claimedTurn();
    claimed.context.batch_messages[0] = {
      ...claimed.context.batch_messages[0],
      content: 'El de celulares.',
    };
    claimed.catalog_resolution = { kind: 'no_catalog_intent' };
    claimed.conversation_state_v1 = {
      ...claimed.conversation_state_v1!,
      selected_offering_code: null,
      selected_payment_plan: null,
      stage: 'exploring',
      call_preference: 'unknown',
      call_offer_status: 'not_offered',
      call_offer_count: 0,
      awaiting_reply: 'course_choice',
    };

    const context = buildAgentAContextV1(claimed);

    expect(context?.catalog.available_offerings.length).toBeGreaterThan(0);
    expect(context?.capabilities.may_offer_call).toBe(true);
    expect(context?.capabilities.may_present_payment_options).toBe(true);
  });

  it('exposes an exact current course without inventing a durable selection', () => {
    const claimed = claimedTurn();
    claimed.context.batch_messages[0] = {
      ...claimed.context.batch_messages[0],
      content: 'Especialista en Ventas, ¿me das información?',
    };
    claimed.catalog_resolution = {
      kind: 'exact',
      offeringCode: 'redes-informaticas',
      displayName: 'Redes Informáticas',
      academy: 'Tecnología',
      match: 'canonical',
    };
    claimed.conversation_state_v1 = {
      ...claimed.conversation_state_v1!,
      selected_offering_code: null,
      selected_payment_plan: 'monthly_12',
      stage: 'exploring',
      call_preference: 'unknown',
      call_offer_status: 'not_offered',
      call_offer_count: 0,
      awaiting_reply: 'course_choice',
    };

    const context = buildAgentAContextV1(claimed);

    expect(context?.commercial_state).toMatchObject({
      selected_offering_code: null,
      selected_payment_plan: null,
      stage: 'exploring',
    });
    expect(context?.catalog.selected_offering?.facts.map((fact) => fact.kind)).toEqual([
      'offering_name', 'offering_description', 'offering_duration', 'offering_modality',
      'payment_plan_label', 'payment_plan_price',
    ]);
    expect(context?.capabilities).toMatchObject({
      may_offer_call: true,
      may_present_payment_options: true,
    });
  });

  it('binds an exact backend catalog resolution to a model move before planning', () => {
    const claimed = claimedTurn();
    claimed.catalog_resolution = {
      kind: 'exact',
      offeringCode: 'redes-informaticas',
      displayName: 'Redes Informáticas',
      academy: 'Tecnología',
      match: 'canonical',
    };

    expect(bindCurrentCatalogResolutionToMoveV1({
      schema_version: 1,
      move: 'ask_course_information',
      secondary_moves: [],
      vetoes: [],
      confidence: 0.96,
    }, claimed)).toMatchObject({
      move: 'ask_course_information',
      course_reference: 'redes-informaticas',
    });
  });

  it('turns a model selection into non-selecting browse when the backend resolution is ambiguous', () => {
    const claimed = claimedTurn();
    claimed.catalog_resolution = {
      kind: 'ambiguous',
      requestedText: 'Estoy entre Fotografía Profesional y Fotografía con Celulares.',
      candidateCodes: ['fotografia_profesional', 'fotografia_celulares'],
      clarification: 'choose_offering',
    };

    expect(bindCurrentCatalogResolutionToMoveV1({
      schema_version: 1,
      move: 'select_course',
      secondary_moves: [],
      vetoes: [],
      course_reference: 'fotografia_profesional',
      confidence: 0.98,
    }, claimed)).toEqual({
      schema_version: 1,
      move: 'browse_catalog',
      secondary_moves: [],
      vetoes: [],
      confidence: 1,
    });
  });

  it('keeps a catalog-browse move for an ambiguous backend-resolved family', () => {
    const claimed = claimedTurn();
    claimed.catalog_resolution = {
      kind: 'ambiguous',
      requestedText: 'info de inglés',
      candidateCodes: ['ingles_1', 'ingles_2', 'ingles_3'],
      clarification: 'choose_offering',
    };

    expect(bindCurrentCatalogResolutionToMoveV1({
      schema_version: 1,
      move: 'browse_catalog',
      secondary_moves: [],
      vetoes: [],
      confidence: 0.98,
    }, claimed)).toMatchObject({ move: 'browse_catalog' });
  });

  it('exposes a backend-confirmed missing course as catalog state without inventing an identity', () => {
    const claimed = claimedTurn();
    claimed.conversation_state_v1 = {
      ...claimed.conversation_state_v1!,
      selected_offering_code: null,
      selected_payment_plan: null,
      stage: 'exploring',
    };
    claimed.catalog_resolution = {
      kind: 'not_found',
      requestedText: 'consulta por una formación que no está en el catálogo',
      requestedArea: null,
      alternativeCodes: ['coaching_liderazgo'],
    };

    const context = buildAgentAContextV1(claimed);

    expect(context?.catalog).toMatchObject({ resolution: 'not_found' });
    expect(context?.catalog.selected_offering).toBeNull();
  });

  it('deja la intención elegida por el modelo ante un pedido genérico de info', () => {
    const claimed = claimedTurn();
    claimed.context.batch_messages[0] = {
      ...claimed.context.batch_messages[0],
      content: 'Info',
    };
    claimed.catalog_resolution = { kind: 'no_catalog_intent' };

    expect(bindCurrentConversationalIntentToMoveV1({
      schema_version: 1,
      move: 'greeting',
      secondary_moves: [],
      vetoes: [],
      confidence: 0.9,
    }, claimed)).toEqual({
      schema_version: 1,
      move: 'greeting',
      secondary_moves: [],
      vetoes: [],
      confidence: 0.9,
    });
  });

  it('retains a direct-call intent while the declared phone is still missing', () => {
    const claimed = claimedTurn();
    claimed.deterministic_route = 'call_phone_required';
    claimed.contact_intake_missing = ['telefono'];
    claimed.context.batch_messages[0] = {
      ...claimed.context.batch_messages[0],
      content: 'Dale, llamame',
    };

    expect(bindCurrentConversationalIntentToMoveV1({
      schema_version: 1,
      move: 'provide_contact_details',
      secondary_moves: [],
      vetoes: [],
      confidence: 0.91,
    }, claimed)).toEqual({
      schema_version: 1,
      move: 'request_call',
      secondary_moves: [],
      vetoes: [],
      confidence: 1,
    });
  });

  it('no reescribe la intención del modelo ante una pregunta de precio', () => {
    const claimed = claimedTurn();
    claimed.context.batch_messages[0] = {
      ...claimed.context.batch_messages[0],
      content: 'Coaching, decime también precios',
    };
    claimed.catalog_resolution = {
      kind: 'exact',
      offeringCode: 'coaching_liderazgo',
      displayName: 'Coaching y Liderazgo',
      academy: 'Academia de Negocios',
      match: 'canonical',
    };
    claimed.catalog_index!.offerings = [{
      code: 'coaching_liderazgo',
      display_name: 'Coaching y Liderazgo',
      academy: 'Academia de Negocios',
      aliases: ['Coaching', 'curso de Coaching'],
    }];

    expect(bindCurrentConversationalIntentToMoveV1({
      schema_version: 1,
      move: 'ask_payment_options',
      secondary_moves: [],
      vetoes: [],
      confidence: 0.95,
      course_reference: 'coaching_liderazgo',
    }, claimed)).toEqual({
      schema_version: 1,
      move: 'ask_payment_options',
      secondary_moves: [],
      vetoes: [],
      confidence: 0.95,
      course_reference: 'coaching_liderazgo',
    });
  });

  it('no convierte un nombre pedido durante el intake en una postergación de pago', () => {
    const claimed = claimedTurn();
    claimed.catalog_resolution = { kind: 'no_catalog_intent' };
    claimed.context.batch_messages[0] = {
      ...claimed.context.batch_messages[0],
      content: 'Inés',
    };
    claimed.conversation_state_v1 = {
      ...claimed.conversation_state_v1!,
      selected_payment_plan: 'one_time',
      awaiting_reply: 'contact_details',
    };

    expect(bindCurrentConversationalIntentToMoveV1({
      schema_version: 1,
      move: 'provide_contact_details',
      secondary_moves: [],
      vetoes: [],
      confidence: 0.91,
    }, claimed)).toEqual({
      schema_version: 1,
      move: 'provide_contact_details',
      secondary_moves: [],
      vetoes: [],
      confidence: 0.91,
    });
  });

  it('preserves Agent A explicit link confirmation with complete intake', () => {
    const claimed = claimedTurn();
    claimed.catalog_resolution = { kind: 'no_catalog_intent' };
    claimed.context.batch_messages[0] = {
      ...claimed.context.batch_messages[0],
      content: 'Está correcto, pásame el link',
    };
    claimed.contact_intake_missing = [];
    claimed.conversation_state_v1 = {
      ...claimed.conversation_state_v1!,
      selected_offering_code: 'redes-informaticas',
      selected_payment_plan: 'monthly_6',
      stage: 'plan_selected',
      awaiting_reply: 'contact_details',
    };

    expect(bindCurrentConversationalIntentToMoveV1({
      schema_version: 1,
      move: 'request_payment_link',
      secondary_moves: [],
      vetoes: [],
      confidence: 0.91,
    }, claimed)).toEqual({
      schema_version: 1,
      move: 'request_payment_link',
      secondary_moves: [],
      vetoes: [],
      confidence: 0.91,
    });
  });

  it('conserva una postergación de pago que el mensaje actual sí expresa', () => {
    const claimed = claimedTurn();
    claimed.catalog_resolution = { kind: 'no_catalog_intent' };
    claimed.context.batch_messages[0] = {
      ...claimed.context.batch_messages[0],
      content: 'Todavía no, prefiero pagar más adelante.',
    };
    claimed.conversation_state_v1 = {
      ...claimed.conversation_state_v1!,
      selected_payment_plan: 'one_time',
      awaiting_reply: 'contact_details',
    };
    const move: ConversationMoveV1 = {
      schema_version: 1,
      move: 'defer_payment',
      secondary_moves: [],
      vetoes: ['payment_link'],
      confidence: 0.99,
    };

    expect(bindCurrentConversationalIntentToMoveV1(move, claimed)).toEqual(move);
  });

  it.each([
    ['Por ahora no tengo correo; mi teléfono es +54 9 11 1234 5678', 'provide_contact_details', []],
    ['Después te paso mi apellido', 'provide_contact_details', []],
    ['Inés', 'provide_contact_details', []],
    ['No quiero comprar ahora.', 'defer_payment', ['payment_link']],
    ['No me voy a inscribir todavía.', 'defer_payment', ['payment_link']],
    ['Lo dejamos para otro momento.', 'defer_payment', ['payment_link']],
    ['Ya no me interesa.', 'decline_purchase', ['purchase']],
  ] as const)('preserves Agent A payment/intake interpretation without a second lexical classifier: %s', (content, kind, vetoes) => {
    const claimed = claimedTurn();
    claimed.catalog_resolution = { kind: 'no_catalog_intent' };
    claimed.context.batch_messages[0]!.content = content;
    claimed.conversation_state_v1 = { ...claimed.conversation_state_v1!,
      selected_payment_plan: 'one_time', awaiting_reply: 'contact_details' };
    const move: ConversationMoveV1 = { schema_version: 1, move: kind,
      secondary_moves: [], vetoes: [...vetoes], confidence: 0.91 };
    expect(bindCurrentConversationalIntentToMoveV1(move, claimed)).toEqual(move);
  });

  it('preserves an explicit payment-plan choice when the same message names the course', () => {
    const claimed = claimedTurn();
    claimed.context.batch_messages[0] = {
      ...claimed.context.batch_messages[0],
      content: 'Coaching, elijo seis pagos',
    };
    claimed.catalog_resolution = {
      kind: 'exact',
      offeringCode: 'coaching_liderazgo',
      displayName: 'Coaching y Liderazgo',
      academy: 'Academia de Negocios',
      match: 'canonical',
    };
    claimed.catalog_index!.offerings = [{
      code: 'coaching_liderazgo',
      display_name: 'Coaching y Liderazgo',
      academy: 'Academia de Negocios',
      aliases: ['Coaching', 'curso de Coaching'],
    }];

    expect(bindCurrentConversationalIntentToMoveV1({
      schema_version: 1,
      move: 'select_payment_plan',
      secondary_moves: [],
      vetoes: [],
      payment_plan: 'monthly_6',
      confidence: 0.98,
      course_reference: 'coaching_liderazgo',
    }, claimed)).toEqual({
      schema_version: 1,
      move: 'select_payment_plan',
      secondary_moves: [],
      vetoes: [],
      payment_plan: 'monthly_6',
      confidence: 0.98,
      course_reference: 'coaching_liderazgo',
    });
  });

  it('binds an exact academy mention to the canonical area before planning', () => {
    const claimed = claimedTurn();
    claimed.catalog_resolution = { kind: 'no_catalog_intent' };
    claimed.context.batch_messages[0] = {
      ...claimed.context.batch_messages[0],
      content: 'Academia de Negocios',
    };
    claimed.catalog_index!.offerings = [
      {
        code: 'excel_integral', display_name: 'Excel Integral',
        academy: 'Academia de Negocios', aliases: [],
      },
      {
        code: 'marketing_digital', display_name: 'Marketing Digital',
        academy: 'Academia de Marketing', aliases: [],
      },
    ];

    expect(bindCurrentConversationalIntentToMoveV1({
      schema_version: 1,
      move: 'select_area',
      secondary_moves: [],
      vetoes: [],
      confidence: 0.95,
    }, claimed)).toMatchObject({
      move: 'select_area',
      area_reference: 'Academia de Negocios',
    });
  });

  it('does not turn a prior enrollment intent into premature link authority', () => {
    const claimed = claimedTurn();
    claimed.catalog_resolution = { kind: 'no_catalog_intent' };
    claimed.context.recent_turns = [{
      direction: 'inbound',
      content: 'Quiero inscribirme en el curso.',
      created_at: NOW,
    }];

    expect(bindCurrentConversationalIntentToMoveV1({
      schema_version: 1,
      move: 'select_payment_plan',
      secondary_moves: [],
      vetoes: [],
      payment_plan: 'monthly_6',
      confidence: 0.98,
    }, claimed).secondary_moves).toEqual([]);
  });

  it('preserves Agent A decision to resume a deferred link', () => {
    const claimed = claimedTurn();
    claimed.catalog_resolution = { kind: 'no_catalog_intent' };
    claimed.context.recent_turns = [{
      direction: 'inbound',
      content: 'No me mandes el link todavía, quiero pensarlo.',
      created_at: NOW,
    }];
    claimed.context.batch_messages[0] = {
      ...claimed.context.batch_messages[0],
      content: 'Ahora sí: confirmo seis pagos.',
    };

    expect(bindCurrentConversationalIntentToMoveV1({
      schema_version: 1,
      move: 'select_payment_plan',
      secondary_moves: ['request_payment_link'],
      vetoes: [],
      payment_plan: 'monthly_6',
      confidence: 0.98,
    }, claimed).secondary_moves).toEqual(['request_payment_link']);
  });

  it('leaves a missing current plan for Agent A to supply', () => {
    const claimed = claimedTurn();
    claimed.catalog_resolution = { kind: 'no_catalog_intent' };
    claimed.context.batch_messages[0] = {
      ...claimed.context.batch_messages[0],
      content: 'Mandame el link del pago único',
    };

    expect(bindCurrentConversationalIntentToMoveV1({
      schema_version: 1,
      move: 'request_payment_link',
      secondary_moves: [],
      vetoes: [],
      confidence: 0.98,
    }, claimed)).toEqual({
      schema_version: 1, move: 'request_payment_link',
      secondary_moves: [], vetoes: [], confidence: 0.98,
    });
  });

  it('does not fill a missing model plan with a phrase parser', () => {
    const claimed = claimedTurn();
    claimed.catalog_resolution = { kind: 'no_catalog_intent' };
    claimed.context.batch_messages[0] = {
      ...claimed.context.batch_messages[0],
      content: 'Me quedo con las 6 cuotas',
    };

    expect(bindCurrentConversationalIntentToMoveV1({
      schema_version: 1,
      move: 'select_payment_plan',
      secondary_moves: [],
      vetoes: [],
      confidence: 0.98,
    }, claimed)).toEqual({
      schema_version: 1, move: 'select_payment_plan',
      secondary_moves: [], vetoes: [], confidence: 0.98,
    });
  });

  it('does not persist a plan merely because the customer asks which instalment is lowest', () => {
    const claimed = claimedTurn();
    claimed.catalog_resolution = { kind: 'no_catalog_intent' };
    claimed.context.batch_messages[0] = {
      ...claimed.context.batch_messages[0],
      content: '¿La cuota más baja cuál sería?',
    };

    expect(bindCurrentConversationalIntentToMoveV1({
      schema_version: 1,
      move: 'ask_payment_options',
      secondary_moves: [],
      vetoes: [],
      confidence: 0.95,
    }, claimed)).toEqual({
      schema_version: 1,
      move: 'ask_payment_options',
      secondary_moves: [],
      vetoes: [],
      confidence: 0.95,
    });
  });

  it('preserves Agent A contextual plan selection for a short acceptance', () => {
    const claimed = claimedTurn();
    claimed.catalog_resolution = { kind: 'no_catalog_intent' };
    claimed.context.batch_messages[0] = {
      ...claimed.context.batch_messages[0],
      content: 'Dale',
    };
    claimed.context.recent_turns.push({
      direction: 'outbound',
      content: 'Para que te quede más cómodo, te recomiendo 12 pagos de USD 30. ¿Te sirve esa opción?',
      created_at: NOW,
    });
    claimed.conversation_state_v1 = {
      ...claimed.conversation_state_v1!,
      selected_payment_plan: 'one_time',
      awaiting_reply: 'none',
    };

    expect(bindCurrentConversationalIntentToMoveV1({
      schema_version: 1,
      move: 'select_payment_plan',
      secondary_moves: [],
      vetoes: [],
      payment_plan: 'monthly_12',
      confidence: 0.99,
    }, claimed)).toMatchObject({
      move: 'select_payment_plan',
      payment_plan: 'monthly_12',
    });
  });

  it('does not bind a short acceptance to an older offer after a newer inbound turn', () => {
    const claimed = claimedTurn();
    claimed.catalog_resolution = { kind: 'no_catalog_intent' };
    claimed.context.batch_messages[0] = {
      ...claimed.context.batch_messages[0],
      content: 'Dale',
    };
    claimed.context.recent_turns.push(
      {
        direction: 'outbound',
        content: 'Te recomiendo 12 pagos de USD 30. ¿Te sirve esa opción?',
        created_at: NOW,
      },
      {
        direction: 'inbound',
        content: 'Antes quiero consultar otra cosa.',
        created_at: NOW,
      },
    );

    expect(bindCurrentConversationalIntentToMoveV1({
      schema_version: 1,
      move: 'ask_payment_options',
      secondary_moves: [],
      vetoes: [],
      confidence: 0.99,
    }, claimed)).toMatchObject({ move: 'ask_payment_options' });
  });

  it('never resumes a link when the current plan selection carries a payment veto', () => {
    const claimed = claimedTurn();
    claimed.catalog_resolution = { kind: 'no_catalog_intent' };
    claimed.context.batch_messages[0] = {
      ...claimed.context.batch_messages[0],
      content: 'Ahora sí elijo seis pagos, pero todavía no me mandes el link.',
    };

    expect(bindCurrentConversationalIntentToMoveV1({
      schema_version: 1,
      move: 'select_payment_plan',
      secondary_moves: [],
      vetoes: ['payment_link'],
      payment_plan: 'monthly_6',
      confidence: 0.98,
    }, claimed).secondary_moves).toEqual([]);
  });

  it('connects bounded recent turns, selected memories and canonical catalog without secrets', () => {
    const context = buildAgentAContextV1(claimedTurn());
    expect(context).not.toBeNull();
    expect(context!.turn.recent_turns).toHaveLength(20);
    expect(context!.turn.recent_turns.map((turn) => turn.content)).toEqual([
      'turno-1', 'turno-2', 'turno-3', 'turno-4', 'turno-5',
      'turno-6', 'turno-7', 'turno-8', 'turno-9', 'turno-10',
      'turno-11', 'turno-12', 'turno-13', 'turno-14', 'turno-15',
      'turno-16', 'turno-17', 'turno-18', 'turno-19', 'turno-20',
    ]);
    expect(context!.customer.memories.map((memory) => memory.id)).toEqual([
      'memory-relevant', 'memory-2', 'memory-3', 'memory-4', 'memory-5',
    ]);
    expect(context!.commercial_state.call_offer_status).toBe('offered');
    expect(context!.commercial_state.call_offer_count).toBe(1);
    expect(context!.catalog.available_offerings).toHaveLength(5);
    expect(context!.catalog.available_offerings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'redes-informaticas',
        fact_id: 'offering:redes-informaticas:name:v1',
        display_name: 'Redes Informáticas',
      }),
    ]));
    expect(context!.catalog.candidate_offerings).toHaveLength(0);
    expect(context!.catalog.areas[0]).toMatchObject({
      code: 'tecnologia',
      fact_id: 'area:tecnologia:name:v1',
    });
    expect(context!.catalog.selected_offering?.facts.map((fact) => fact.kind)).toEqual([
      'offering_name', 'offering_description', 'offering_duration', 'offering_modality',
      'payment_plan_label', 'payment_plan_price',
    ]);
    expect(JSON.stringify(context)).not.toContain('embedding');
    expect(JSON.stringify(context)).not.toContain('https://buy.stripe.com');
  });

  it.each(['Infoo', '?', '¿Qué cursos ofrecen?'])(
    'does not let contact-wide memory answer an underspecified current turn: %s',
    (text) => {
      const claimed = claimedTurn();
      claimed.context.batch_messages[0] = {
        ...claimed.context.batch_messages[0]!,
        content: text,
      };
      claimed.catalog_resolution = { kind: 'no_catalog_intent' };
      claimed.conversation_state_v1 = {
        ...claimed.conversation_state_v1!,
        selected_offering_code: null,
        selected_payment_plan: null,
        stage: 'exploring',
        call_offer_status: 'not_offered',
        call_offer_count: 0,
        awaiting_reply: 'none',
      };
      claimed.sales_context.offering_code = null;
      claimed.sales_context.course_of_interest = null;

      expect(buildAgentAContextV1(claimed)?.customer.memories).toEqual([]);
    },
  );

  it('keeps contact memory when the current turn explicitly asks to resume it', () => {
    const claimed = claimedTurn();
    claimed.context.batch_messages[0] = {
      ...claimed.context.batch_messages[0]!,
      content: 'Retomemos mi objetivo de conseguir trabajo',
    };
    claimed.catalog_resolution = { kind: 'no_catalog_intent' };
    claimed.conversation_state_v1 = {
      ...claimed.conversation_state_v1!,
      selected_offering_code: null,
      selected_payment_plan: null,
      stage: 'exploring',
    };

    expect(buildAgentAContextV1(claimed)?.customer.memories.map((memory) => memory.id))
      .toContain('memory-relevant');
  });

  it('limits navigation to three candidates and rejects an unavailable conversation state', () => {
    const claimed = claimedTurn();
    // Navigation has no current explicit course; exact references have their own tests.
    claimed.context.batch_messages[0]!.content = '¿Qué opciones tienen?';
    claimed.conversation_state_v1 = {
      ...claimed.conversation_state_v1!,
      selected_offering_code: null,
    };
    claimed.sales_context.offering_code = null;
    claimed.sales_context.course_of_interest = null;
    claimed.catalog_resolution = { kind: 'no_catalog_intent' };
    const context = buildAgentAContextV1(claimed);
    expect(context?.catalog.selected_offering).toBeNull();
    expect(context?.catalog.candidate_offerings).toHaveLength(3);
    expect(context?.catalog.candidate_offerings[0]).toMatchObject({
      fact_id: 'offering:redes-informaticas:name:v1',
    });

    claimed.conversation_state_v1 = null;
    expect(buildAgentAContextV1(claimed)).toBeNull();
  });

  it('includes canonical details for ambiguous candidates so a follow-up can answer naturally', () => {
    const claimed = claimedTurn();
    claimed.catalog_resolution = {
      kind: 'ambiguous', requestedText: 'inglés',
      candidateCodes: ['ingles-1', 'ingles-2'], clarification: 'choose_offering',
    };
    claimed.conversation_state_v1 = {
      ...claimed.conversation_state_v1!,
      selected_offering_code: null,
      stage: 'exploring',
    };
    claimed.catalog_index = {
      as_of: NOW,
      offerings_total: 2,
      offerings: [
        { code: 'ingles-1', display_name: 'Inglés 1', academy: 'Idiomas', aliases: [] },
        { code: 'ingles-2', display_name: 'Inglés 2', academy: 'Idiomas', aliases: [] },
      ],
      injection_suspected_count: 0,
    };
    claimed.business_context!.offerings = [
      { ...claimed.business_context!.offerings[0]!, code: 'ingles-1', display_name: 'Inglés 1', description: 'Inglés para empezar desde cero.', classes: 12 },
      { ...claimed.business_context!.offerings[0]!, code: 'ingles-2', display_name: 'Inglés 2', description: 'Inglés para continuar tus estudios.', classes: 12 },
    ];

    const candidates = buildAgentAContextV1(claimed)?.catalog.candidate_offerings;
    expect(candidates).toHaveLength(2);
    expect(candidates?.[0]?.facts).toEqual(expect.arrayContaining([
      { id: 'offering:ingles-1:description:v1', kind: 'offering_description', value: 'Inglés para empezar desde cero.' },
      { id: 'offering:ingles-1:duration:v1', kind: 'offering_duration', value: '12 clases' },
    ]));
  });

  it('keeps the most recent explicit candidate set on an indecision follow-up', () => {
    const claimed = claimedTurn();
    claimed.context.batch_messages[0] = {
      ...claimed.context.batch_messages[0],
      content: 'Sigo sin decidirme: cuál me conviene?',
    };
    claimed.context.recent_turns = [{
      direction: 'outbound',
      content: 'Estás entre Marketing Digital y Community Manager.',
      created_at: NOW,
    }];
    claimed.catalog_resolution = { kind: 'no_catalog_intent' };
    claimed.conversation_state_v1 = {
      ...claimed.conversation_state_v1!,
      selected_offering_code: null,
      selected_payment_plan: null,
      stage: 'exploring',
      call_preference: 'unknown',
      call_offer_status: 'offered',
      call_offer_count: 1,
      awaiting_reply: 'call_or_chat',
    };
    claimed.sales_context.offering_code = null;
    claimed.sales_context.course_of_interest = null;
    claimed.catalog_index = {
      as_of: NOW,
      offerings_total: 4,
      offerings: [
        { code: 'aires', display_name: 'Aires Acondicionados', academy: 'Oficios', aliases: [] },
        { code: 'marketing_digital', display_name: 'Marketing Digital', academy: 'Marketing', aliases: [] },
        { code: 'community_manager', display_name: 'Community Manager', academy: 'Marketing', aliases: [] },
        { code: 'excel', display_name: 'Excel Integral', academy: 'Negocios', aliases: [] },
      ],
      injection_suspected_count: 0,
    };

    expect(buildAgentAContextV1(claimed)?.catalog.candidate_offerings.map((offering) => offering.code))
      .toEqual(['marketing_digital', 'community_manager']);
  });

  it('exposes the complete sorted active catalog as compact identities while no course is selected', () => {
    const claimed = claimedTurn();
    claimed.catalog_resolution = { kind: 'no_catalog_intent' };
    claimed.conversation_state_v1 = {
      ...claimed.conversation_state_v1!,
      selected_offering_code: null,
      selected_payment_plan: null,
      stage: 'exploring',
      awaiting_reply: 'none',
    };
    claimed.sales_context.offering_code = null;
    claimed.sales_context.course_of_interest = null;
    const required = [
      ['fotografia_profesional', 'Fotografía Profesional', 'Emprendedores'],
      [
        'fotografia_celulares_tiendas_online',
        'Fotografía con Celulares para Tiendas Online',
        'Marketing',
      ],
      ['ingles_1', 'Inglés 1', 'Idiomas'],
      ['ingles_2', 'Inglés 2', 'Idiomas'],
      ['ingles_3', 'Inglés 3', 'Idiomas'],
    ] as const;
    const fillers = Array.from({ length: 35 }, (_, index) => ({
      code: `curso_${String(index + 1).padStart(2, '0')}`,
      display_name: `Curso ${String(index + 1).padStart(2, '0')}`,
      academy: index % 2 === 0 ? 'Tecnología' : 'Negocios',
      aliases: [`alias privado ${index + 1}`],
    }));
    claimed.catalog_index = {
      as_of: NOW,
      offerings_total: 40,
      offerings: [
        ...fillers,
        ...required.map(([code, display_name, academy]) => ({
          code, display_name, academy, aliases: ['alias privado'],
        })),
      ].reverse(),
      injection_suspected_count: 0,
    };

    const context = buildAgentAContextV1(claimed);
    const available = context?.catalog.available_offerings;

    expect(available).toHaveLength(40);
    expect(available).toEqual(expect.arrayContaining(required.map(([code]) => (
      expect.objectContaining({ code })
    ))));
    expect(available?.map((offering) => offering.code)).toEqual(
      [...(available ?? [])].map((offering) => offering.code).sort(),
    );
    for (const offering of available ?? []) {
      expect(Object.keys(offering).sort()).toEqual([
        'area_code', 'code', 'display_name', 'fact_id',
      ]);
      expect(offering).not.toHaveProperty('aliases');
      expect(offering).not.toHaveProperty('description');
      expect(offering).not.toHaveProperty('details');
      expect(offering).not.toHaveProperty('price');
      expect(offering).not.toHaveProperty('payment_link');
    }
  });
});

/**
 * Alcance del turno actual (causa raíz B).
 *
 * Spec revisada. La primera versión acotaba el turno vago suprimiendo también
 * el curso elegido, y eso resultó estar mal por dos motivos verificados en el
 * código: `claim-batch` ya entrega el estado con la sesión caducada
 * (`effectiveConversationStateV1`), así que un curso viejo de verdad llega en
 * `null` sin ayuda del ADK; y `may_offer_call`,
 * `may_present_payment_options` y `may_send_payment_link` cuelgan todas del
 * mismo código, con lo cual suprimirlo apagaba en silencio la llamada y los
 * planes a mitad de una compra viva.
 *
 * Lo que sí cruza sesiones son las memorias, que se recuperan por similitud:
 * de ahí salía el curso que el mensaje actual nunca nombró. Ese es el alcance
 * que se conserva.
 */
describe('alcance del turno actual', () => {
  function vagueTurn(text: string): ClaimedTurn {
    const turn = JSON.parse(JSON.stringify(claimedTurn())) as ClaimedTurn;
    const mutable = turn as unknown as Record<string, unknown>;
    (turn.context as unknown as Record<string, unknown>).batch_messages = [{
      id: UUID, conversation_seq: 40, content: text, created_at: NOW, message_type: 'text',
    }];
    mutable.catalog_resolution = { kind: 'none' };
    mutable.conversation_state_v1 = {
      ...turn.conversation_state_v1,
      selected_offering_code: 'redes-informaticas',
      selected_payment_plan: null,
      stage: 'course_selected',
      awaiting_reply: 'none',
    };
    return turn;
  }

  it('conserva la venta en curso cuando el mensaje actual es sólo puntuación', () => {
    const context = buildAgentAContextV1(vagueTurn('?'), 'Camila');

    expect(context?.commercial_state.selected_offering_code).toBe('redes-informaticas');
  });

  it.each(['?', 'Infoo', 'hola'])(
    'no le revoca los permisos comerciales a una venta viva ante "%s"',
    (text) => {
      const context = buildAgentAContextV1(vagueTurn(text), 'Camila');

      expect(context?.capabilities.may_offer_call).toBe(true);
      expect(context?.capabilities.may_present_payment_options).toBe(true);
    },
  );

  it('ofrece alternativas en vez de dejar al modelo sin nada de qué hablar', () => {
    const context = buildAgentAContextV1(vagueTurn('?'), 'Camila');

    expect(context?.catalog.candidate_offerings.length).toBeGreaterThan(0);
  });

  it('no reinyecta la memoria vieja en un turno vago', () => {
    const context = buildAgentAContextV1(vagueTurn('?'), 'Camila');

    expect(context?.customer.memories).toEqual([]);
  });

  it('trata "Infoo" con el mismo alcance que "Info"', () => {
    const typo = buildAgentAContextV1(vagueTurn('Infoo'), 'Camila');
    const clean = buildAgentAContextV1(vagueTurn('Info'), 'Camila');

    expect(typo?.catalog.selected_offering).toEqual(clean?.catalog.selected_offering);
    expect(typo?.commercial_state.selected_offering_code)
      .toBe(clean?.commercial_state.selected_offering_code);
  });

  it('conserva el curso cuando hay un paso pendiente, aunque el mensaje sea vago', () => {
    const turn = vagueTurn('?');
    (turn as unknown as Record<string, unknown>).conversation_state_v1 = {
      ...turn.conversation_state_v1,
      selected_offering_code: 'redes-informaticas',
      awaiting_reply: 'contact_details',
    };

    const context = buildAgentAContextV1(turn, 'Camila');

    expect(context?.commercial_state.selected_offering_code).toBe('redes-informaticas');
  });

  it('conserva el curso cuando el mensaje actual sí lo resuelve', () => {
    const context = buildAgentAContextV1(claimedTurn(), 'Camila');

    expect(context?.commercial_state.selected_offering_code).toBe('redes-informaticas');
  });

  it('expone otro curso consultado sin reemplazar la selección durable ni su plan', () => {
    const turn = claimedTurn();
    turn.context.batch_messages[0] = {
      ...turn.context.batch_messages[0]!,
      content: 'Y Community Manager de qué se trata?',
    };
    turn.conversation_state_v1 = {
      ...turn.conversation_state_v1!,
      selected_offering_code: 'redes-informaticas',
      selected_payment_plan: 'monthly_6',
      stage: 'plan_selected',
      awaiting_reply: 'payment_confirmation',
    };
    turn.catalog_resolution = {
      kind: 'exact', offeringCode: 'community_manager', displayName: 'Community Manager',
      academy: 'Marketing', match: 'canonical',
    };
    turn.catalog_index = {
      ...turn.catalog_index!,
      offerings: [
        ...turn.catalog_index!.offerings,
        { code: 'community_manager', display_name: 'Community Manager', academy: 'Marketing', aliases: [] },
      ],
    };
    turn.business_context!.offerings = [
      ...turn.business_context!.offerings,
      {
        ...turn.business_context!.offerings[0]!,
        code: 'community_manager',
        display_name: 'Community Manager',
        description: 'Gestión profesional de comunidades digitales.',
      },
    ];

    const context = buildAgentAContextV1(turn, 'Camila');

    expect(context?.commercial_state.selected_offering_code).toBe('redes-informaticas');
    expect(context?.commercial_state.selected_payment_plan).toBe('monthly_6');
    expect(context?.catalog.selected_offering?.code).toBe('community_manager');
  });

  it('mantiene la fase durable: el turno vago no retrocede la venta', () => {
    const context = buildAgentAContextV1(vagueTurn('?'), 'Camila');

    expect(context?.commercial_state.stage).toBe('course_selected');
  });
});

/**
 * Fases de venta marcadas.
 *
 * `capabilities` sólo dice qué PUEDE hacer el modelo. El comportamiento
 * canónico describe seis fases, y `commercial_state.stage` sabe en cuál está
 * la conversación, pero nada las unía: el modelo tenía el mapa y su posición
 * sin que nadie le dijera que eran lo mismo. `obligations` es el eje que
 * faltaba — qué DEBE este turno y qué todavía no puede hacer.
 *
 * El backend fija la fase y su deuda; la redacción sigue siendo del modelo.
 */
describe('obligaciones de fase (variante rígida, conservada para comparación)', () => {
  function turnWith(mutate: (claimed: ClaimedTurn) => void): ClaimedTurn {
    const claimed = JSON.parse(JSON.stringify(claimedTurn())) as ClaimedTurn;
    mutate(claimed);
    return claimed;
  }

  it('debe saludar cuando todavía no le habló nunca a esta persona', () => {
    const claimed = turnWith((turn) => {
      (turn.context as unknown as Record<string, unknown>).recent_turns = [
        { direction: 'inbound', content: 'Hola', created_at: NOW },
      ];
    });

    expect(buildAgentAContextV1(claimed, 'Camila', { rigidObligations: true })?.obligations!.owes).toContain('greeting');
  });

  it('no vuelve a saludar cuando ya hay una respuesta suya en el historial', () => {
    expect(buildAgentAContextV1(claimedTurn(), 'Camila', { rigidObligations: true })?.obligations!.owes)
      .not.toContain('greeting');
  });

  it('no da por elegido un curso sólo porque la resolución actual es exacta', () => {
    const claimed = turnWith((turn) => {
      (turn as unknown as Record<string, unknown>).conversation_state_v1 = {
        ...turn.conversation_state_v1, selected_offering_code: null, stage: 'exploring',
      };
    });

    expect(buildAgentAContextV1(claimed, 'Camila', { rigidObligations: true })?.obligations!.owes)
      .not.toContain('diagnostic_question');
  });

  it('no puede dar precio mientras no haya un curso elegido', () => {
    const claimed = turnWith((turn) => {
      (turn as unknown as Record<string, unknown>).catalog_resolution = { kind: 'none' };
      (turn as unknown as Record<string, unknown>).conversation_state_v1 = {
        ...turn.conversation_state_v1, selected_offering_code: null, stage: 'exploring',
      };
    });

    expect(buildAgentAContextV1(claimed, 'Camila', { rigidObligations: true })?.obligations!.not_yet).toContain('price');
  });

  it('libera el precio una vez que hay curso elegido', () => {
    expect(buildAgentAContextV1(claimedTurn(), 'Camila', { rigidObligations: true })?.obligations!.not_yet)
      .not.toContain('price');
  });

  it('debe los datos de contacto que todavía faltan, no el link', () => {
    const claimed = turnWith((turn) => {
      const mutable = turn as unknown as Record<string, unknown>;
      mutable.features = { ...turn.features, agent_a_context_scoping: true };
      mutable.contact_intake_missing = ['correo', 'telefono'];
      mutable.conversation_state_v1 = {
        ...turn.conversation_state_v1,
        selected_payment_plan: 'monthly_12',
        stage: 'plan_selected',
        awaiting_reply: 'contact_details',
      };
    });

    const owes = buildAgentAContextV1(claimed, 'Camila', { rigidObligations: true })?.obligations!.owes;

    expect(owes).toContain('contact_details');
    expect(owes).not.toContain('payment_link');
  });

  it('debe el link en el turno en que se completa el último dato', () => {
    const claimed = turnWith((turn) => {
      const mutable = turn as unknown as Record<string, unknown>;
      mutable.features = { ...turn.features, agent_a_context_scoping: true };
      mutable.contact_intake_missing = [];
      mutable.conversation_state_v1 = {
        ...turn.conversation_state_v1,
        selected_payment_plan: 'monthly_12',
        stage: 'plan_selected',
        awaiting_reply: 'contact_details',
      };
    });

    expect(buildAgentAContextV1(claimed, 'Camila', { rigidObligations: true })?.obligations!.owes)
      .toContain('payment_link');
  });

  it('expone la fase de venta junto a la deuda, no sólo el estado', () => {
    expect(buildAgentAContextV1(claimedTurn(), 'Camila', { rigidObligations: true })?.obligations!.stage)
      .toBe('course_selected');
  });
});

/**
 * Contradicciones del contexto, reproducidas sin modelo.
 *
 * Estas pruebas invocan `buildAgentAContextV1` real: portar la lógica a un
 * script aparte demuestra una hipótesis sobre el código, no lo que el contexto
 * efectivamente le entrega al modelo.
 *
 * Dos ideas que el contexto venía mezclando y que acá se separan:
 *
 * - `commercial_state` describe hechos persistidos, no fases de venta
 *   completadas. `course_selected` significa que hay un curso elegido; no
 *   significa que ya hubo diagnóstico, presentación ni precio.
 * - Un dato que nadie consultó no es un dato completo. `intake_missing` vacío
 *   sólo puede significar «la autoridad dice que no falta nada».
 */
describe('el contexto no confunde persistencia con fase de venta', () => {
  function turnoCon(mutar: (claimed: ClaimedTurn) => void): ClaimedTurn {
    const claimed = JSON.parse(JSON.stringify(claimedTurn())) as ClaimedTurn;
    mutar(claimed);
    return claimed;
  }

  it('quien avisa que pagó no recibe una orden de presentar el curso', () => {
    const claimed = turnoCon((turn) => {
      turn.context.batch_messages[0]!.content = 'Ya pagué el curso';
      (turn as unknown as Record<string, unknown>).catalog_resolution = { kind: 'no_catalog_intent' };
      (turn as unknown as Record<string, unknown>).conversation_state_v1 = {
        ...turn.conversation_state_v1,
        awaiting_reply: 'none',
        payment_reported: true,
      };
    });

    const context = buildAgentAContextV1(claimed, 'Camila');

    expect(context).not.toBeNull();
    expect(context!.obligations?.owes ?? []).not.toContain('presentation');
  });

  it('preguntar la duración sin plan elegido no obliga a re-presentar', () => {
    const claimed = turnoCon((turn) => {
      turn.context.batch_messages[0]!.content = '¿Cuánto dura la formación?';
      (turn as unknown as Record<string, unknown>).catalog_resolution = { kind: 'no_catalog_intent' };
      (turn as unknown as Record<string, unknown>).conversation_state_v1 = {
        ...turn.conversation_state_v1,
        awaiting_reply: 'none',
      };
    });

    const context = buildAgentAContextV1(claimed, 'Camila');

    expect(context!.obligations?.owes ?? []).not.toContain('presentation');
    // El curso sí se conserva: una pregunta sobre el curso no abandona la venta.
    expect(context!.commercial_state.selected_offering_code)
      .toBe(claimed.conversation_state_v1!.selected_offering_code);
  });

  it('quien se niega a dar sus datos no genera una deuda de link de pago', () => {
    const claimed = turnoCon((turn) => {
      turn.context.batch_messages[0]!.content = 'No te voy a dar mis datos';
      (turn as unknown as Record<string, unknown>).catalog_resolution = { kind: 'no_catalog_intent' };
      (turn as unknown as Record<string, unknown>).conversation_state_v1 = {
        ...turn.conversation_state_v1,
        selected_payment_plan: 'one_time',
        stage: 'plan_selected',
        awaiting_reply: 'contact_details',
      };
    });

    const context = buildAgentAContextV1(claimed, 'Camila');

    expect(context!.obligations?.owes ?? []).not.toContain('payment_link');
  });

  it('el scoping de memorias no decide qué datos faltan: eso lo dice la autoridad', () => {
    const claimed = turnoCon((turn) => {
      const mutable = turn as unknown as Record<string, unknown>;
      // El flag gobierna qué memorias se muestran. El intake lo responde el
      // claim, siempre, y esconderlo convertía «no consulté» en «no falta».
      mutable.features = { ...turn.features, agent_a_context_scoping: false };
      mutable.contact_intake_missing = ['apellido', 'correo'];
      mutable.conversation_state_v1 = {
        ...turn.conversation_state_v1,
        selected_payment_plan: 'monthly_12',
        stage: 'plan_selected',
        awaiting_reply: 'contact_details',
      };
    });

    const context = buildAgentAContextV1(claimed, 'Camila');

    expect(context!.capabilities.intake_status).toBe('known');
    expect(context!.capabilities.intake_missing).toContain('apellido');
    expect(context!.capabilities.intake_missing).toContain('correo');
    expect(context!.capabilities.may_send_payment_link).toBe(false);
  });

  it('un claim que no trae la respuesta de intake se declara desconocido y cierra el link', () => {
    const claimed = turnoCon((turn) => {
      const mutable = turn as unknown as Record<string, unknown>;
      delete mutable.contact_intake_missing;
      mutable.conversation_state_v1 = {
        ...turn.conversation_state_v1,
        selected_payment_plan: 'monthly_12',
        stage: 'plan_selected',
        awaiting_reply: 'contact_details',
      };
    });

    const context = buildAgentAContextV1(claimed, 'Camila');

    // Desconocido no es completo: el gate no se abre por ignorancia.
    expect(context!.capabilities.intake_status).toBe('unknown');
    expect(context!.capabilities.may_send_payment_link).toBe(false);
  });
});

it('keeps the exhausted call budget authoritative despite a retrieved preference for calls', () => {
  const claimed = claimedTurn();
  claimed.conversation_state_v1!.call_offer_count = 2;
  claimed.conversation_state_v1!.call_preference = 'chat';
  claimed.conversation_state_v1!.call_offer_status = 'declined';
  claimed.context.selected_memories = [{ memory_id: 'old-call-preference', type: 'preference',
    key: 'contact_preference', value: 'Prefiere llamadas', source_quote: 'Prefiero llamadas',
    similarity: 1, recorded_at: NOW }];
  const context = buildAgentAContextV1(claimed)!;
  expect(context.commercial_state).toMatchObject({ call_offer_count: 2, call_preference: 'chat' });
  expect(context.capabilities.may_offer_call).toBe(false);
  expect(context.capabilities.may_request_call_now).toBe(false);
});

it('opens a fresh call budget when a terminal sale receives an exact inquiry about another course', () => {
  const claimed = claimedTurn();
  claimed.conversation_state_v1 = {
    ...claimed.conversation_state_v1!,
    selected_offering_code: 'redes-informaticas',
    selected_payment_plan: 'monthly_12',
    stage: 'closed',
    call_preference: 'chat',
    call_offer_status: 'declined',
    call_offer_count: 2,
    awaiting_reply: 'none',
    payment_reported: true,
  };
  claimed.catalog_resolution = {
    kind: 'exact', offeringCode: 'curso-1', displayName: 'Curso 1', academy: 'Tecnología', match: 'canonical',
  };
  claimed.context.batch_messages[0] = {
    ...claimed.context.batch_messages[0]!,
    content: 'Ahora quiero saber si Curso 1 me sirve para trabajar',
  };

  const context = buildAgentAContextV1(claimed)!;

  expect(context.commercial_state).toMatchObject({
    selected_offering_code: null,
    selected_payment_plan: null,
    stage: 'exploring',
    call_preference: 'unknown',
    call_offer_status: 'not_offered',
    call_offer_count: 0,
    awaiting_reply: 'none',
    payment_reported: false,
  });
  expect(context.catalog.selected_offering?.code).toBe('curso-1');
  expect(context.capabilities.may_offer_call).toBe(true);
});

it('does not turn an included bonus-course question into a new sale after checkout', () => {
  const claimed = claimedTurn();
  claimed.conversation_state_v1 = {
    ...claimed.conversation_state_v1!,
    selected_offering_code: 'redes-informaticas',
    selected_payment_plan: 'monthly_12',
    stage: 'payment_link_sent',
    call_preference: 'chat',
    call_offer_status: 'declined',
    call_offer_count: 2,
    awaiting_reply: 'none',
  };
  claimed.course_bonus_capability = {
    enabled: false,
    max_bonus_courses: 2,
    may_offer_bonus: false,
    status: 'accepted',
    may_schedule_checkin: false,
    may_request_review: false,
    may_accept_offer: false,
    may_send_promoted_payment: true,
    promotion_code: 'redes-con-curso-1',
    promotion_cycle_id: UUID,
    offer_version: 1,
    package_status: 'attached',
    interest_offering_code: 'redes-informaticas',
    accepted_at: NOW,
    bonus_offerings: [{ code: 'curso-1', display_name: 'Curso 1', position: 1, offered_at: NOW }],
    delivered_bonus_offerings: [{ code: 'curso-1', display_name: 'Curso 1', position: 1 }],
  };
  claimed.catalog_resolution = {
    kind: 'exact', offeringCode: 'curso-1', displayName: 'Curso 1', academy: 'Tecnología', match: 'canonical',
  };
  claimed.context.batch_messages[0] = {
    ...claimed.context.batch_messages[0]!,
    content: 'Qué incluye Curso 1, que venía bonificado?',
  };

  const context = buildAgentAContextV1(claimed)!;

  expect(context.commercial_state).toMatchObject({
    selected_offering_code: 'redes-informaticas',
    selected_payment_plan: 'monthly_12',
    stage: 'payment_link_sent',
    call_offer_count: 2,
    promotion: { promotion_code: 'redes-con-curso-1', status: 'accepted' },
  });
  expect(context.capabilities.course_bonus).toMatchObject({
    interest_offering_code: 'redes-informaticas',
    package_status: 'attached',
  });
});

it('does not authorize an immediate call when contact intake was not loaded', () => {
  const claimed = claimedTurn();
  delete (claimed as Partial<ClaimedTurn>).contact_intake_missing;
  const context = buildAgentAContextV1(claimed)!;
  expect(context.capabilities.intake_status).toBe('unknown');
  expect(context.capabilities.may_request_call_now).toBe(false);
});

it.each(['nombre', 'apellido', 'telefono'] as const)(
  'does not authorize an immediate call while %s is missing',
  (missingField) => {
    const claimed = claimedTurn();
    claimed.contact_intake_missing = [missingField];

    const context = buildAgentAContextV1(claimed)!;

    expect(context.capabilities.may_request_call_now).toBe(false);
  },
);

it('does not authorize an immediate call when email is missing', () => {
  const claimed = claimedTurn();
  claimed.contact_intake_missing = ['correo'];
  (claimed as unknown as Record<string, unknown>).call_intake_readiness = {
    status: 'needs_input', requirements: [{ field: 'correo', reason: 'missing' }],
  };
  Object.assign(claimed.conversation_state_v1!, { call_preference: 'call',
    call_offer_status: 'accepted', awaiting_reply: 'call_or_chat' });

  const context = buildAgentAContextV1(claimed)!;

  expect(context.capabilities.may_request_call_now).toBe(false);
  expect(context.capabilities.required_contact_fields?.call).toEqual(['correo']);
});

it('does not treat acceptance of an open offer as the later availability confirmation', () => {
  const claimed = claimedTurn();
  claimed.context.batch_messages[0] = {
    ...claimed.context.batch_messages[0]!, content: 'dale de una',
  };
  claimed.contact_intake_missing = [];
  (claimed as unknown as Record<string, unknown>).call_intake_readiness = {
    status: 'ready', requirements: [],
  };
  Object.assign(claimed.conversation_state_v1!, {
    call_preference: 'unknown', call_offer_status: 'offered', call_offer_count: 1,
    awaiting_reply: 'call_or_chat', stage: 'course_selected',
  });

  const context = buildAgentAContextV1(claimed)!;

  expect(context.capabilities.may_request_call_now).toBe(false);
});

it('exposes a known voice email as awaiting written WhatsApp confirmation', () => {
  const claimed = claimedTurn();
  claimed.contact_intake = {
    nombre: 'Ana', apellido: 'Pérez', correo: 'ana@example.test', telefono: '+5491112345678',
  };
  claimed.contact_intake_missing = [];
  (claimed as unknown as Record<string, unknown>).call_intake_readiness = {
    status: 'needs_input',
    requirements: [{ field: 'correo', reason: 'written_whatsapp_confirmation_required' }],
  };
  Object.assign(claimed.conversation_state_v1!, { call_preference: 'call',
    call_offer_status: 'accepted', awaiting_reply: 'call_or_chat' });

  const context = buildAgentAContextV1(claimed)!;

  expect(context.capabilities.may_request_call_now).toBe(false);
  expect(context.capabilities.required_contact_fields?.call).toEqual(['correo']);
  expect(context.capabilities.call_contact_requirements).toEqual([
    { field: 'correo', reason: 'written_whatsapp_confirmation_required' },
  ]);
});

it('does not treat a final email as current consent to call now', () => {
  const claimed = claimedTurn();
  claimed.context.batch_messages[0] = {
    ...claimed.context.batch_messages[0]!, content: 'ana@example.test',
  };
  claimed.contact_intake = {
    nombre: 'Ana', apellido: 'Pérez', correo: 'ana@example.test', telefono: '+5491112345678',
  };
  claimed.contact_intake_missing = [];
  (claimed as unknown as Record<string, unknown>).call_intake_readiness = {
    status: 'ready', requirements: [],
  };
  Object.assign(claimed.conversation_state_v1!, { call_preference: 'call',
    call_offer_status: 'accepted', awaiting_reply: 'call_or_chat' });

  const context = buildAgentAContextV1(claimed)!;

  expect(context.capabilities.may_request_call_now).toBe(false);
});

it.each([
  'Ahora puedo atender',
  'Estoy disponible',
  'Sí, ahora puedo',
])('lets Agent A semantically interpret a natural availability confirmation: %s', (text) => {
  const claimed = claimedTurn();
  claimed.context.batch_messages[0] = {
    ...claimed.context.batch_messages[0]!, content: text,
  };
  claimed.contact_intake = {
    nombre: 'Ana', apellido: 'Pérez', correo: 'ana@example.test', telefono: '+5491112345678',
  };
  claimed.contact_intake_missing = [];
  (claimed as unknown as Record<string, unknown>).call_intake_readiness = {
    status: 'ready', requirements: [],
  };
  Object.assign(claimed.conversation_state_v1!, { call_preference: 'call',
    call_offer_status: 'accepted', awaiting_reply: 'call_or_chat' });

  const context = buildAgentAContextV1(claimed)!;

  expect(context.capabilities.may_request_call_now).toBe(true);
});

it('does not authorize a semantic availability path after a later call refusal', () => {
  const claimed = claimedTurn();
  claimed.context.batch_messages = [
    { ...claimed.context.batch_messages[0]!, id: 'm-available', content: 'Ahora puedo atender' },
    { ...claimed.context.batch_messages[0]!, id: 'm-decline', content: 'Ahora no puedo atender' },
  ];
  claimed.contact_intake_missing = [];
  (claimed as unknown as Record<string, unknown>).call_intake_readiness = {
    status: 'ready', requirements: [],
  };
  Object.assign(claimed.conversation_state_v1!, { call_preference: 'call',
    call_offer_status: 'accepted', awaiting_reply: 'call_or_chat' });

  const context = buildAgentAContextV1(claimed)!;

  expect(context.capabilities.may_request_call_now).toBe(false);
});

it('separates missing contact data by the purpose Agent A is pursuing', () => {
  const claimed = claimedTurn();
  claimed.contact_intake = {
    nombre: null,
    apellido: null,
    correo: null,
    telefono: '+5491169004497',
  };
  claimed.contact_intake_missing = ['nombre', 'apellido', 'correo'];
  (claimed as unknown as Record<string, unknown>).call_intake_readiness = {
    status: 'needs_input',
    requirements: [
      { field: 'nombre', reason: 'missing' },
      { field: 'apellido', reason: 'missing' },
      { field: 'correo', reason: 'missing' },
    ],
  };

  const context = buildAgentAContextV1(claimed)!;

  expect(context.capabilities.required_contact_fields).toEqual({
    call: ['nombre', 'apellido', 'correo'],
    payment: ['nombre', 'apellido', 'correo'],
    identity: ['nombre', 'apellido', 'correo'],
  });
});

describe('Agent A structured commercial context (sales_profile and fichas)', () => {
  const memory = (key: string, value: string, source_quote: string) => ({ key, value, source_quote });
  const emptyProfile = { objective: [], experience: [], tentative_interest: [], objections: [],
    constraints: [], preferences: [], timeline: [], contact_preference: [] };

  it('keeps the persisted objective even though customer.memories only carries the vector top-5', () => {
    const claimed = claimedTurn();
    Object.assign(claimed, { sales_profile: { ...emptyProfile,
      objective: [memory('work_goal', 'trabajar con marcas', 'quiero trabajar con marcas')],
      objections: [memory('price_objection', 'precio', 'está caro')] } });
    const context = buildAgentAContextV1(claimed)!;
    expect(context.customer.memories.some((item) => item.value.includes('marcas'))).toBe(false);
    expect(context.commercial_state.sales_profile).toMatchObject({
      objective: [{ key: 'work_goal', value: 'trabajar con marcas', source_quote: 'quiero trabajar con marcas' }],
      objections: [{ key: 'price_objection', source_quote: 'está caro' }],
      selected_course: { code: 'redes-informaticas' },
    });
  });

  it('projects chat preference, missing data and allowed effects from persisted state only', () => {
    const claimed = claimedTurn();
    claimed.conversation_state_v1 = { ...claimed.conversation_state_v1!, call_preference: 'declined' };
    claimed.contact_intake_missing = ['correo'];
    const profile = buildAgentAContextV1(claimed)!.commercial_state.sales_profile!;
    expect(profile.call_preference).toBe('chat');
    expect(profile.missing_data).toEqual(['correo']);
    expect(profile.retention_used).toBeNull();
    expect(profile.bonus_courses).toEqual([]);
  });

  describe('M5: offer_course_bonus in next_allowed_effects', () => {
    const cap = (ladder: unknown) => ({ enabled: true, max_bonus_courses: 3, may_offer_bonus: true, status: 'checkin_available',
      may_schedule_checkin: false, may_request_review: false, may_accept_offer: false, may_send_promoted_payment: false,
      promotion_code: null, interest_offering_code: 'redes-informaticas', bonus_offerings: [], delivered_bonus_offerings: [],
      ...(ladder ? { ladder } : {}) });
    const effects = (capability: unknown, patch: Record<string, unknown> = {}) => {
      const claimed = claimedTurn();
      claimed.conversation_state_v1 = { ...claimed.conversation_state_v1!, ...patch } as never;
      Object.assign(claimed, { course_bonus_capability: capability });
      return buildAgentAContextV1(claimed)!.commercial_state.sales_profile!.next_allowed_effects;
    };
    it('advertises it with price evidence, labels it without, and omits it in checkout', () => {
      const evidence = { eligible: true, price_evidence: true, retention_decline: false, retention_used: false, missing_steps: [] };
      const none = { eligible: false, price_evidence: false, retention_decline: false, retention_used: false, missing_steps: ['price_evidence'] };
      expect(effects(cap(evidence))).toContain('offer_course_bonus');
      const labelled = effects(cap(none));
      expect(labelled).not.toContain('offer_course_bonus');
      expect(labelled).toContain('offer_course_bonus_needs_price_evidence');
      for (const awaiting_reply of ['contact_details', 'payment_plan', 'payment_confirmation']) {
        const inCheckout = effects(cap(evidence), { awaiting_reply });
        expect(inCheckout.some((effect) => effect.startsWith('offer_course_bonus'))).toBe(false);
      }
    });
  });

  it('works without a claim projection (older backend) and never invents memories', () => {
    const profile = buildAgentAContextV1(claimedTurn())!.commercial_state.sales_profile!;
    expect(profile).toMatchObject(emptyProfile);
  });

  it('resumed informative-price conversation keeps the objective and the active promotion, and owes no probe or call', () => {
    // Deterministic projection only: fixed persisted data in, context out. Not a claim about model behavior.
    const claimed = claimedTurn();
    Object.assign(claimed, { sales_profile: { ...emptyProfile,
      objective: [memory('work_goal', 'trabajar con marcas', 'quiero trabajar con marcas')] },
    course_bonus_capability: { enabled: true, max_bonus_courses: 3, may_offer_bonus: false, status: 'offer_available',
      may_schedule_checkin: false, may_request_review: false, may_accept_offer: true, may_send_promoted_payment: false,
      promotion_code: 'marketing-con-redes', promotion_cycle_id: UUID, offer_version: 1, package_status: 'offered',
      interest_offering_code: 'redes-informaticas', accepted_at: null,
      bonus_offerings: [{ code: 'publicidad_redes_sociales', display_name: 'Publicidad en Redes Sociales', position: 1, offered_at: NOW }],
      delivered_bonus_offerings: [{ code: 'publicidad_redes_sociales', display_name: 'Publicidad en Redes Sociales', position: 1 }] } });
    const context = buildAgentAContextV1(claimed)!;
    const profile = context.commercial_state.sales_profile!;
    expect(profile.objective).toEqual([{ key: 'work_goal', value: 'trabajar con marcas', source_quote: 'quiero trabajar con marcas' }]);
    expect(profile.active_promotion).toMatchObject({ promotion_code: 'marketing-con-redes', status: 'offer_available' });
    expect(profile.bonus_courses.map((course) => course.code)).toEqual(['publicidad_redes_sociales']);
    expect(context.commercial_state.promotion?.bonus_offerings.map((course) => course.offering_code)).toEqual(['publicidad_redes_sociales']);
    // The backend owes the model no price probe and no call: the default context has no obligations at all.
    expect(context.obligations?.owes ?? []).toEqual([]);
    expect(JSON.stringify(context.obligations ?? {})).not.toMatch(/call|price|precio|llamada/iu);
  });

  it('sends only the focus ficha and the current bonus-candidate fichas to the model', () => {
    const claimed = claimedTurn();
    const ficha = (code: string, role: 'focus' | 'bonus_candidate') =>
      ({ offering_code: code, fact_id: `offering:${code}:ficha:v1`, role, value: `Ficha de ${code}` });
    Object.assign(claimed, {
      catalog_fichas: [ficha('redes-informaticas', 'focus'), ficha('otro-curso', 'bonus_candidate'),
        ficha('no-candidato', 'bonus_candidate')],
      course_bonus_capability: { enabled: true, status: 'checkin_available', may_schedule_checkin: false,
        may_request_review: false, may_accept_offer: false, may_send_promoted_payment: false,
        promotion_code: null, interest_offering_code: 'redes-informaticas', bonus_offerings: [],
        bonus_candidates: [{ code: 'otro-curso', display_name: 'Otro curso' }] },
    });
    const { catalog } = buildAgentAContextV1(claimed)!;
    expect(catalog.selected_offering?.facts).toContainEqual({
      id: 'offering:redes-informaticas:ficha:v1', kind: 'offering_syllabus', value: 'Ficha de redes-informaticas' });
    expect(catalog.bonus_candidate_fichas).toEqual([{ code: 'otro-curso',
      fact: { id: 'offering:otro-curso:ficha:v1', kind: 'offering_syllabus', value: 'Ficha de otro-curso' } }]);
  });
});
