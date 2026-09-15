import { describe, expect, it } from 'vitest';
import {
  bindCurrentCatalogResolutionToMoveV1,
  bindCurrentConversationalIntentToMoveV1,
  buildAgentAContextV1,
} from '../../../botpress-agent/src/lib/conversation/agent-a-context';
import type { ClaimedTurn } from '../../../botpress-agent/src/schemas/contracts';
import type { ConversationMoveV1 } from '../../../botpress-agent/src/schemas/conversation-pipeline';

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

  it('exposes the canonical intake values needed for a single confirmation step', () => {
    const claimed = claimedTurn();
    claimed.contact_intake = {
      nombre: 'Juan', apellido: 'Perez', correo: 'juan@example.com', telefono: '+5491112345678',
    };

    expect(buildAgentAContextV1(claimed)?.customer.contact_intake).toEqual(claimed.contact_intake);
  });

  it('does not authorize a second payment-link action after the canonical link was sent', () => {
    const claimed = claimedTurn();
    claimed.catalog_resolution = { kind: 'no_catalog_intent' };
    claimed.conversation_state_v1 = {
      ...claimed.conversation_state_v1!,
      selected_payment_plan: 'monthly_12',
      stage: 'payment_link_sent',
      awaiting_reply: 'none',
    };

    const context = buildAgentAContextV1(claimed);

    expect(context?.capabilities.may_send_payment_link).toBe(false);
  });

  it('does not authorize the payment link in the same turn that completes contact intake', () => {
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

    expect(context?.capabilities.may_send_payment_link).toBe(false);
    expect(context?.customer.contact_intake).toEqual(claimed.contact_intake);
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

  it('keeps the call invitation unavailable until the first name is known', () => {
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

    expect(context?.capabilities.may_offer_call).toBe(false);
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
    expect(context?.capabilities.may_present_payment_options).toBe(false);
  });

  it('projects an exact current course into the brain despite an older exploring state', () => {
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
      selected_offering_code: 'redes-informaticas',
      selected_payment_plan: null,
      stage: 'course_selected',
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
      move: 'defer_payment',
      secondary_moves: [],
      vetoes: ['payment_link'],
      confidence: 0.91,
    }, claimed)).toEqual({
      schema_version: 1,
      move: 'provide_contact_details',
      secondary_moves: [],
      vetoes: [],
      confidence: 1,
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
    'Por ahora no tengo correo; mi teléfono es +54 9 11 1234 5678',
    'Después te paso mi apellido',
  ])('no convierte timing del intake en postergación de pago: %s', (content) => {
    const claimed = claimedTurn();
    claimed.catalog_resolution = { kind: 'no_catalog_intent' };
    claimed.context.batch_messages[0] = {
      ...claimed.context.batch_messages[0],
      content,
    };
    claimed.conversation_state_v1 = {
      ...claimed.conversation_state_v1!,
      selected_payment_plan: 'one_time',
      awaiting_reply: 'contact_details',
    };

    expect(bindCurrentConversationalIntentToMoveV1({
      schema_version: 1,
      move: 'defer_payment',
      secondary_moves: [],
      vetoes: ['payment_link'],
      confidence: 0.91,
    }, claimed)).toMatchObject({
      move: 'provide_contact_details',
      vetoes: [],
    });
  });

  it('reencuadra un decline_purchase inventado como continuación del intake', () => {
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
      move: 'decline_purchase',
      secondary_moves: [],
      vetoes: ['purchase'],
      confidence: 0.91,
    }, claimed)).toEqual({
      schema_version: 1,
      move: 'provide_contact_details',
      secondary_moves: [],
      vetoes: [],
      confidence: 1,
    });
  });

  it.each([
    'No quiero comprar ahora.',
    'No me voy a inscribir todavía.',
  ])('reencuadra un rechazo temporal como defer_payment: %s', (content) => {
    const claimed = claimedTurn();
    claimed.catalog_resolution = { kind: 'no_catalog_intent' };
    claimed.context.batch_messages[0] = {
      ...claimed.context.batch_messages[0],
      content,
    };
    claimed.conversation_state_v1 = {
      ...claimed.conversation_state_v1!,
      selected_payment_plan: 'one_time',
      awaiting_reply: 'contact_details',
    };

    expect(bindCurrentConversationalIntentToMoveV1({
      schema_version: 1,
      move: 'decline_purchase',
      secondary_moves: [],
      vetoes: ['purchase'],
      confidence: 0.91,
    }, claimed)).toEqual({
      schema_version: 1,
      move: 'defer_payment',
      secondary_moves: [],
      vetoes: [],
      confidence: 1,
    });
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

  it('resumes a deferred link only when the customer explicitly says now yes', () => {
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
      secondary_moves: [],
      vetoes: [],
      payment_plan: 'monthly_6',
      confidence: 0.98,
    }, claimed).secondary_moves).toEqual(['request_payment_link']);
  });

  it('binds the canonical plan when a direct link request omitted it from the model JSON', () => {
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
    }, claimed)).toMatchObject({
      move: 'request_payment_link',
      payment_plan: 'one_time',
      secondary_moves: ['select_payment_plan'],
    });
  });

  it('binds an explicitly selected canonical plan when the model omitted the field', () => {
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
    }, claimed)).toMatchObject({
      move: 'select_payment_plan',
      payment_plan: 'monthly_6',
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
      move: 'select_payment_plan',
      secondary_moves: [],
      vetoes: [],
      payment_plan: 'monthly_12',
      confidence: 0.95,
    }, claimed)).toEqual({
      schema_version: 1,
      move: 'ask_payment_options',
      secondary_moves: [],
      vetoes: [],
      confidence: 1,
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
      move: 'select_payment_plan',
      secondary_moves: [],
      vetoes: [],
      payment_plan: 'monthly_12',
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
    expect(context!.turn.recent_turns).toHaveLength(8);
    expect(context!.turn.recent_turns.map((turn) => turn.content)).toEqual([
      'turno-3', 'turno-4', 'turno-5', 'turno-6', 'turno-7', 'turno-8', 'turno-9', 'turno-10',
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

  it('debe la pregunta de diagnóstico en el turno en que se elige el curso', () => {
    const claimed = turnWith((turn) => {
      (turn as unknown as Record<string, unknown>).conversation_state_v1 = {
        ...turn.conversation_state_v1, selected_offering_code: null, stage: 'exploring',
      };
    });

    expect(buildAgentAContextV1(claimed, 'Camila', { rigidObligations: true })?.obligations!.owes)
      .toContain('diagnostic_question');
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
