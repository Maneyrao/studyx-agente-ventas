import { describe, expect, it } from 'vitest';
import { applyDecisionPolicy } from '../../../botpress-agent/src/utils/decision-policy';
import type { ClaimedTurn, Decision } from '../../../botpress-agent/src/schemas/contracts';

/**
 * Parity guarantee: both decision providers (the Botpress-managed model call
 * and the direct Gemini provider) MUST pass their raw model output through
 * this same `applyDecisionPolicy` gate before it is ever committed. These
 * tests exercise the gate directly, independent of either provider, so a
 * regression here fails regardless of which provider produced the decision.
 *
 * Fixtures mirror the shape used by
 * `tests/unit/botpress/process-inbound-turn-hot-path.test.ts`'s
 * `claimedResponse()` / `runModelDecision()` helpers, trimmed to what the
 * policy actually reads.
 */

const UUID = '18a823e8-27c2-4279-9956-058f45f33cd5';
const NOW = '2026-08-21T12:00:00.000Z';

function claimedTurn(overrides: {
  allowed_response_types?: string[];
  allowed_actions?: string[];
  batch_message_content?: string;
  recent_turns?: Array<{ direction: 'inbound' | 'outbound'; content: string; created_at: string }>;
  offering_names?: string[];
  knowledge_names?: string[];
  course_of_interest?: string | null;
  offering_code?: string | null;
  catalog_resolution?: ClaimedTurn['catalog_resolution'];
} = {}): ClaimedTurn {
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
    policy: {
      may_respond: true,
      allowed_response_types: overrides.allowed_response_types ?? ['commercial_reply'],
      reason: null,
    },
    contact: {
      id: UUID,
      status: 'prospecto',
      name: null,
      blocked: false,
      consent_status: 'allowed',
      opted_in_at: NOW,
    },
    context: {
      batch_messages: [{
        id: UUID,
        conversation_seq: 1,
        content: overrides.batch_message_content ?? '¿Cuánto sale el curso?',
        created_at: NOW,
        message_type: 'text',
      }],
      recent_turns: overrides.recent_turns ?? [],
      summary: { text: null, version: 0, updated_at: null },
      selected_memories: [],
      long_term_memory_available: true,
      knowledge_base: (overrides.knowledge_names ?? []).map((name) => ({
        id: UUID,
        document_id: UUID,
        source_uri: `studyx://manual/${name}`,
        title: `Manual StudyX — ${name}`,
        content: `Curso oficial ${name}.`,
        similarity: 0.9,
      })),
      knowledge_base_available: true,
      knowledge_base_dropped: 0,
      injection_suspected_count: 0,
    },
    sales_context: {
      mode: 'advising',
      course_of_interest: overrides.course_of_interest ?? null,
      offering_code: overrides.offering_code ?? null,
      open_call_offer: null,
      active_call: null,
      allowed_actions: overrides.allowed_actions ?? ['offer_call'],
      last_call_result: null,
    },
    catalog_resolution: overrides.catalog_resolution ?? { kind: 'no_catalog_intent' },
    deterministic_route: null,
    diagnostics: {
      timings: {
        claim_total_ms: 7,
        core_db_ms: 2,
        shared_embedding_ms: 1,
        memory_search_ms: 1,
        knowledge_search_ms: 1,
        business_snapshot_ms: 2,
      },
      counters: {
        embedding_calls: 1,
        memory_search_calls: 1,
        knowledge_search_calls: 1,
        business_snapshot_calls: 1,
        catalog_calls: 0,
      },
    },
    business_context: overrides.offering_names ? {
      as_of: NOW,
      prices_assertable: true,
      workspace: { slug: 'studyx', display_name: 'StudyX', environment: 'sandbox',
        default_locale: 'es-AR', timezone: 'America/Argentina/Buenos_Aires', payment_options: [] },
      offerings: overrides.offering_names.map((display_name, index) => ({
        code: `course_${index}`, display_name, academy: null, offering_type: 'course',
        description: null, value_proposition: null, price_type: 'fixed',
        price: { amount: '360.00', currency: 'USD' }, price_assertable: true,
        billing_interval: null, modality: null, schedules: [], certification: null,
        hours_per_month: null, classes: 16, modules: null, includes: [], syllabus_published: null,
        language: null, min_age: null,
        policies: { allowed_promise: null, forbidden_promises: [], price_message: null },
      })),
      qualification_fields: [], injection_suspected_count: 0, offerings_truncated: 0,
    } : null,
    business_context_available: Boolean(overrides.offering_names),
    existing_result: null,
  } as unknown as ClaimedTurn;
}

function modelDecision(overrides: Partial<Decision> = {}): Decision {
  return {
    schema_version: 4,
    intent: 'commercial',
    kind: 'reply',
    response: 'Te cuento.',
    response_type: 'commercial_reply',
    confidence: 0.9,
    reason_code: 'ANSWER',
    business_action: null,
    memory_candidates: [],
    missing_information: [],
    next_state: 'waiting_user',
    retrieval_used: null,
    ...overrides,
  } as Decision;
}

describe('applyDecisionPolicy — provider parity', () => {
  it('suppress válido: a suppress decision passes through as a clean suppress', () => {
    const claimed = claimedTurn();
    const decision = applyDecisionPolicy(
      modelDecision({
        kind: 'suppress',
        response: null,
        response_type: null,
        business_action: null,
        reason_code: 'OPT_OUT',
        next_state: 'completed',
      }),
      claimed,
    );

    expect(decision).toMatchObject({
      kind: 'suppress',
      response: null,
      response_type: null,
      reason_code: 'OPT_OUT',
    });
  });

  it('response type prohibido: an unauthorized response_type downgrades to an allowed text reply', () => {
    const claimed = claimedTurn({ allowed_response_types: ['commercial_reply'], allowed_actions: [] });
    const decision = applyDecisionPolicy(
      modelDecision({
        response: 'Te llamamos ahora.',
        response_type: 'call_offer',
        reason_code: 'UNAUTHORIZED_CALL_OFFER',
      }),
      claimed,
    );

    expect(decision).toMatchObject({
      kind: 'reply',
      response_type: 'commercial_reply',
      reason_code: 'RESPONSE_TYPE_NOT_ALLOWED',
    });
    expect(decision.response).toBeTruthy();
  });

  it('pago ambiguo: send_payment_link downgrades to clarification when the batch names no plan', () => {
    const claimed = claimedTurn({
      allowed_response_types: ['commercial_reply', 'clarification'],
      batch_message_content: '¿Cuánto sale el curso?',
    });
    const decision = applyDecisionPolicy(
      modelDecision({
        response: 'Te mando el link del plan de 12 cuotas.',
        reason_code: 'PAYMENT_LINK',
        business_action: { type: 'send_payment_link', plan_code: 'monthly_12', offering_sku: null },
      }),
      claimed,
    );

    expect(decision).toMatchObject({
      kind: 'clarify',
      response_type: 'clarification',
      business_action: null,
      reason_code: 'AMBIGUOUS_OR_ABSENT_CHOICE',
      next_state: 'waiting_user',
    });
  });

  it('plan discordante: send_payment_link downgrades to clarification when the model plan contradicts the batch', () => {
    const claimed = claimedTurn({
      allowed_response_types: ['commercial_reply', 'clarification'],
      batch_message_content: 'Quiero las 12 cuotas de 30 dólares',
    });
    const decision = applyDecisionPolicy(
      modelDecision({
        response: 'Perfecto, te paso el plan de 6 cuotas.',
        reason_code: 'PAYMENT_LINK',
        business_action: { type: 'send_payment_link', plan_code: 'monthly_6', offering_sku: null },
      }),
      claimed,
    );

    expect(decision).toMatchObject({
      kind: 'clarify',
      response_type: 'clarification',
      business_action: null,
      reason_code: 'PLAN_MISMATCH',
    });
  });

  it('pago sin curso canónico: clarifies instead of emitting an unscoped payment action', () => {
    const claimed = claimedTurn({
      allowed_response_types: ['commercial_reply', 'clarification'],
      batch_message_content: 'Confirmo pago único de 360 dólares',
    });
    const decision = applyDecisionPolicy(
      modelDecision({
        response: 'Perfecto, avanzamos con el pago único.',
        reason_code: 'PAYMENT_LINK',
        business_action: { type: 'send_payment_link', plan_code: 'one_time', offering_sku: null },
      }),
      claimed,
    );

    expect(decision).toMatchObject({
      kind: 'clarify',
      response_type: 'clarification',
      business_action: null,
      reason_code: 'OFFERING_REQUIRED',
    });
  });

  it('derives the exact canonical SKU before preserving a payment action', () => {
    const claimed = claimedTurn({
      allowed_response_types: ['commercial_reply', 'clarification'],
      batch_message_content: 'Confirmo pago único de 360 dólares',
      offering_names: ['Redes Informáticas'],
      course_of_interest: 'Redes Informáticas',
      catalog_resolution: {
        kind: 'exact',
        offeringCode: 'course_0',
        displayName: 'Redes Informáticas',
        academy: 'Oficios',
        match: 'canonical',
      },
    });

    const decision = applyDecisionPolicy(
      modelDecision({
        business_action: {
          type: 'send_payment_link',
          plan_code: 'one_time',
          offering_sku: null,
        },
      }),
      claimed,
    );

    expect(decision.business_action).toEqual({
      type: 'send_payment_link',
      plan_code: 'one_time',
      offering_sku: 'course_0',
    });
  });

  it('replaces a model-selected SKU with the active canonical course', () => {
    const claimed = claimedTurn({
      allowed_response_types: ['commercial_reply', 'clarification'],
      batch_message_content: 'Confirmo pago único',
      offering_names: ['Redes Informáticas', 'Excel Integral'],
      course_of_interest: 'Redes Informáticas',
      catalog_resolution: { kind: 'no_catalog_intent' },
    });

    const decision = applyDecisionPolicy(
      modelDecision({
        business_action: {
          type: 'send_payment_link',
          plan_code: 'one_time',
          offering_sku: 'course_1',
        },
      }),
      claimed,
    );

    expect(decision.business_action).toMatchObject({ offering_sku: 'course_0' });
  });

  it('uses the durable offering code rather than guessing between homonymous courses', () => {
    const claimed = claimedTurn({
      allowed_response_types: ['commercial_reply', 'clarification'],
      batch_message_content: 'Confirmo pago único',
      offering_names: ['Inglés Inicial', 'Inglés Inicial'],
      course_of_interest: 'Inglés Inicial',
      offering_code: 'course_1',
      catalog_resolution: { kind: 'no_catalog_intent' },
    });

    const decision = applyDecisionPolicy(
      modelDecision({
        business_action: {
          type: 'send_payment_link',
          plan_code: 'one_time',
          offering_sku: 'course_0',
        },
      }),
      claimed,
    );

    expect(decision.business_action).toMatchObject({ offering_sku: 'course_1' });
  });

  it('llamada permitida: a call_offer stays intact when the sales context explicitly allows offer_call', () => {
    const claimed = claimedTurn({ allowed_response_types: ['commercial_reply'], allowed_actions: ['offer_call'] });
    const decision = applyDecisionPolicy(
      modelDecision({
        response: '¿Querés que nuestra asesora virtual te llame y te oriente?',
        response_type: 'call_offer',
        reason_code: 'CALL_OFFER',
      }),
      claimed,
    );

    expect(decision).toMatchObject({
      kind: 'reply',
      response_type: 'call_offer',
      reason_code: 'CALL_OFFER',
    });
  });

  it('persists one exact catalog course mention even when the model omitted memory', () => {
    const claimed = claimedTurn({
      batch_message_content: 'Me interesa Fotografía Profesional, pero todavía estoy comparando pagos.',
      offering_names: ['Fotografía Profesional', 'Fotografía con Celulares'],
    });

    const decision = applyDecisionPolicy(modelDecision(), claimed);

    expect(decision.memory_candidates).toContainEqual({
      type: 'study_goal',
      key: 'target_course',
      value: 'Fotografía Profesional',
      source_quote: 'Fotografía Profesional',
      confidence: 1,
    });
  });

  it('does not guess a course when two catalog names occur or the mention is explicitly negative', () => {
    const ambiguous = applyDecisionPolicy(modelDecision(), claimedTurn({
      batch_message_content: 'Comparo Fotografía Profesional con Fotografía con Celulares.',
      offering_names: ['Fotografía Profesional', 'Fotografía con Celulares'],
    }));
    const negative = applyDecisionPolicy(modelDecision(), claimedTurn({
      batch_message_content: 'Ya no me interesa Fotografía Profesional.',
      offering_names: ['Fotografía Profesional'],
    }));

    expect(ambiguous.memory_candidates).toEqual([]);
    expect(negative.memory_candidates).toEqual([]);
  });

  it('persists an exact course named by a canonical manual chunk outside the offering window', () => {
    const decision = applyDecisionPolicy(modelDecision(), claimedTurn({
      batch_message_content: 'Estoy entre pagar Especialista en Marketing en cuotas o de una sola vez.',
      knowledge_names: ['Especialista en Marketing'],
    }));

    expect(decision.memory_candidates).toContainEqual(expect.objectContaining({
      type: 'study_goal',
      key: 'target_course',
      value: 'Especialista en Marketing',
      confidence: 1,
    }));
  });

  it('maps a short literal alias only when it identifies one unique catalog course', () => {
    const decision = applyDecisionPolicy(modelDecision(), claimedTurn({
      batch_message_content: 'Quiero saber todo sobre el curso de AutoCAD antes de decidir.',
      offering_names: ['AutoCAD orientado al Diseño de Interiores', 'Diseño Gráfico con Corel Draw'],
    }));

    expect(decision.memory_candidates).toContainEqual(expect.objectContaining({
      key: 'target_course',
      value: 'AutoCAD',
      source_quote: 'AutoCAD',
    }));
  });

  it('maps a colloquial prefix only when it resolves to one unique catalog course', () => {
    const decision = applyDecisionPolicy(modelDecision(), claimedTurn({
      batch_message_content: 'ola quiero aprender a reparar celu',
      offering_names: ['Reparación de Celulares', 'Armado y Reparación de PC'],
    }));

    expect(decision.memory_candidates).toContainEqual(expect.objectContaining({
      key: 'target_course',
      value: 'reparar celu',
      source_quote: 'reparar celu',
    }));
  });

  it('keeps exact course memory when an invalid payment action is downgraded', () => {
    const decision = applyDecisionPolicy(modelDecision({
      business_action: { type: 'send_payment_link', plan_code: 'monthly_12', offering_sku: null },
    }), claimedTurn({
      batch_message_content: 'Mejor Introducción al Catering.',
      offering_names: ['Introducción al Catering'],
    }));

    expect(decision.reason_code).toBe('AMBIGUOUS_OR_ABSENT_CHOICE');
    expect(decision.memory_candidates).toContainEqual(expect.objectContaining({
      key: 'target_course',
      value: 'Introducción al Catering',
    }));
  });
});
