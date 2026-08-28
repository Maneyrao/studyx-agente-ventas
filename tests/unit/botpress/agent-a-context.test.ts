import { describe, expect, it } from 'vitest';
import { buildAgentAContextV1 } from '../../../botpress-agent/src/lib/conversation/agent-a-context';
import type { ClaimedTurn } from '../../../botpress-agent/src/schemas/contracts';

const UUID = '18a823e8-27c2-4279-9956-058f45f33cd5';
const NOW = '2026-08-28T12:00:00.000Z';

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
      recent_turns: Array.from({ length: 10 }, (_, index) => ({
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
    features: { conversation_pipeline_v1_enabled: true },
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
  it('connects bounded recent turns, selected memories and canonical catalog without secrets', () => {
    const context = buildAgentAContextV1(claimedTurn());
    expect(context).not.toBeNull();
    expect(context!.turn.recent_turns).toHaveLength(8);
    expect(context!.turn.recent_turns.map((turn) => turn.content)).toEqual([
      'turno-3', 'turno-4', 'turno-5', 'turno-6', 'turno-7', 'turno-8', 'turno-9', 'turno-10',
    ]);
    expect(context!.customer.memories.map((memory) => memory.id)).toEqual([
      'memory-relevant', 'memory-2', 'memory-3', 'memory-4', 'memory-5',
    ]);
    expect(context!.commercial_state.call_offer_status).toBe('offered');
    expect(context!.commercial_state.call_offer_count).toBe(1);
    expect(context!.catalog.candidate_offerings).toHaveLength(0);
    expect(context!.catalog.selected_offering?.facts.map((fact) => fact.kind)).toEqual([
      'offering_name', 'offering_description', 'offering_duration', 'offering_modality',
      'payment_plan_label', 'payment_plan_price',
    ]);
    expect(JSON.stringify(context)).not.toContain('embedding');
    expect(JSON.stringify(context)).not.toContain('https://buy.stripe.com');
  });

  it('limits navigation to three candidates and rejects an unavailable conversation state', () => {
    const claimed = claimedTurn();
    claimed.conversation_state_v1 = {
      ...claimed.conversation_state_v1!,
      selected_offering_code: null,
    };
    claimed.sales_context.offering_code = null;
    claimed.sales_context.course_of_interest = null;
    const context = buildAgentAContextV1(claimed);
    expect(context?.catalog.selected_offering).toBeNull();
    expect(context?.catalog.candidate_offerings).toHaveLength(3);

    claimed.conversation_state_v1 = null;
    expect(buildAgentAContextV1(claimed)).toBeNull();
  });
});
