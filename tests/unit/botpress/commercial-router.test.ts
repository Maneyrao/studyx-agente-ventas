import { describe, expect, it } from 'vitest';

import {
  DecisionSchema,
  type ClaimedTurn,
  type Decision,
} from '../../../botpress-agent/src/schemas/contracts';
import { routeCommercialTurn } from '../../../botpress-agent/src/utils/commercial-router';
import { applyDecisionPolicy } from '../../../botpress-agent/src/utils/decision-policy';

const UUID = '18a823e8-27c2-4279-9956-058f45f33cd5';

type BusinessOffering = NonNullable<ClaimedTurn['business_context']>['offerings'][number];

function businessOffering(
  code: string,
  displayName: string,
  academy: string | null,
): BusinessOffering {
  return {
    code,
    display_name: displayName,
    aliases: [],
    academy,
    offering_type: 'course',
    description: null,
    value_proposition: null,
    price_type: 'fixed',
    price: { amount: '360.00', currency: 'USD' },
    price_assertable: true,
    billing_interval: null,
    modality: null,
    schedules: [],
    certification: null,
    hours_per_month: null,
    classes: 16,
    modules: null,
    includes: [],
    syllabus_published: null,
    language: null,
    min_age: null,
    policies: { allowed_promise: null, forbidden_promises: [], price_message: null },
  };
}

type ClaimedOverrides = {
  texts?: string[];
  mayRespond?: boolean;
  allowedResponseTypes?: ClaimedTurn['policy']['allowed_response_types'];
  policyReason?: string | null;
  blocked?: boolean;
  consentStatus?: ClaimedTurn['contact']['consent_status'];
  route?: ClaimedTurn['deterministic_route'];
  allowedActions?: ClaimedTurn['sales_context']['allowed_actions'];
  acceptedOffer?: boolean;
  courseOfInterest?: string | null;
  offeringCode?: string | null;
  name?: string | null;
  recentInbound?: string[];
  catalogResolution?: ClaimedTurn['catalog_resolution'];
  offerings?: BusinessOffering[];
  optOutAckEligible?: boolean;
};

function claimedTurn(overrides: ClaimedOverrides = {}): ClaimedTurn {
  const texts = overrides.texts ?? ['Quiero información'];
  return {
    outcome: 'claimed',
    trace_id: UUID,
    batch: {
      id: UUID,
      claim_token: UUID,
      conversation_id: UUID,
      contact_id: UUID,
      lease_until: '2026-08-25T12:00:10.000Z',
      hard_deadline_at: '2026-08-25T12:00:04.000Z',
      message_count: texts.length,
      stolen: false,
    },
    turn_id: UUID,
    policy: {
      may_respond: overrides.mayRespond ?? true,
      allowed_response_types: overrides.allowedResponseTypes ?? [
        'social_reply',
        'commercial_reply',
        'clarification',
        'technical_fallback',
      ],
      reason: overrides.policyReason ?? null,
    },
    contact: {
      id: UUID,
      status: 'prospecto',
      name: overrides.name ?? null,
      blocked: overrides.blocked ?? false,
      consent_status: overrides.consentStatus ?? 'allowed',
      opted_in_at: '2026-08-20T12:00:00.000Z',
    },
    context: {
      batch_messages: texts.map((text, index) => ({
        id: UUID,
        conversation_seq: index + 1,
        content: text,
        created_at: '2026-08-25T12:00:00.000Z',
        message_type: 'text',
        opt_out_ack_eligible: overrides.optOutAckEligible === true && index === texts.length - 1,
      })),
      recent_turns: (overrides.recentInbound ?? []).map((content) => ({
        direction: 'inbound' as const,
        content,
        created_at: '2026-08-25T11:59:00.000Z',
      })),
      summary: { text: null, version: 0, updated_at: null },
      selected_memories: [],
      long_term_memory_available: false,
      knowledge_base: [],
      knowledge_base_available: false,
      knowledge_base_dropped: 0,
      injection_suspected_count: 0,
    },
    sales_context: {
      mode: 'advising',
      course_of_interest: overrides.courseOfInterest === undefined
        ? 'Redes Informáticas'
        : overrides.courseOfInterest,
      offering_code: overrides.offeringCode ?? null,
      open_call_offer: null,
      accepted_call_offer: overrides.acceptedOffer
        ? { decision_id: UUID, expires_at: '2026-08-25T12:15:00.000Z' }
        : null,
      active_call: null,
      allowed_actions: overrides.allowedActions ?? ['offer_call'],
      last_call_result: null,
    },
    catalog_resolution: overrides.catalogResolution ?? { kind: 'no_catalog_intent' },
    deterministic_route: overrides.route ?? null,
    business_context_available: true,
    business_context: {
      as_of: '2026-08-25T12:00:00.000Z',
      prices_assertable: true,
      workspace: {
        slug: 'studyx',
        display_name: 'StudyX',
        environment: 'sandbox',
        default_locale: 'es-AR',
        timezone: 'America/Argentina/Buenos_Aires',
        payment_options: [
          {
            code: 'monthly_12',
            label: '12 pagos',
            total: { amount: '360.00', currency: 'USD' },
            installments: 12,
            installment_amount: '30.00',
            payment_link: 'https://example.test/12',
          },
          {
            code: 'monthly_6',
            label: '6 pagos',
            total: { amount: '360.00', currency: 'USD' },
            installments: 6,
            installment_amount: '60.00',
            payment_link: 'https://example.test/6',
          },
          {
            code: 'one_time',
            label: 'Pago único',
            total: { amount: '360.00', currency: 'USD' },
            installments: 1,
            installment_amount: '360.00',
            payment_link: 'https://example.test/one',
          },
        ],
      },
      offerings: overrides.offerings ?? [
        businessOffering('redes-informaticas', 'Redes Informáticas', 'Oficios'),
      ],
      qualification_fields: [],
      injection_suspected_count: 0,
      offerings_truncated: 0,
    },
    existing_result: null,
  } as unknown as ClaimedTurn;
}

function expectDecisionRoute(
  route: ReturnType<typeof routeCommercialTurn>,
): asserts route is Extract<ReturnType<typeof routeCommercialTurn>, { decision: Decision }> {
  expect(route.kind).not.toBe('model_required');
  if (route.kind === 'model_required') throw new Error('EXPECTED_DECISION_ROUTE');
  expect(() => DecisionSchema.parse(route.decision)).not.toThrow();
  expect(route.reason).toBe(route.decision.reason_code);
}

describe('routeCommercialTurn', () => {
  it.each([
    ['No sé qué estudiar, orientame', 'ADVISORY_REQUIRES_SALES_MODEL'],
    ['Es caro, no sé si me conviene', 'OBJECTION_REQUIRES_SALES_MODEL'],
    ['Prefiero seguir por chat', 'CALL_DECLINE_REQUIRES_SALES_MODEL'],
  ] as const)('%s is owned by the sales model', (message, reason) => {
    const route = routeCommercialTurn({
      automationEnabled: true,
      claimed: claimedTurn({
        texts: [message],
        courseOfInterest: null,
        offeringCode: null,
        catalogResolution: { kind: 'no_catalog_intent' },
      }),
    });
    expect(route).toMatchObject({ kind: 'model_required', origin: 'advisory_model', reason });
  });

  it('answers an exact canonical course fact without waiting for the model', () => {
    const route = routeCommercialTurn({
      automationEnabled: true,
      claimed: claimedTurn({
        texts: ['¿Cuántas clases tiene Redes Informáticas?'],
        courseOfInterest: null,
        offeringCode: null,
        catalogResolution: {
          kind: 'exact', offeringCode: 'redes-informaticas',
          displayName: 'Redes Informáticas', academy: 'Oficios', match: 'canonical',
        },
      }),
    });
    expect(route).toMatchObject({
      kind: 'deterministic', origin: 'course_facts', reason: 'DETERMINISTIC_COURSE_FACTS',
    });
  });

  it.each([
    ['dame de baja', 'opt_out_ack'],
    ['llamame ahora', 'call_handoff'],
    ['quiero 12 cuotas', 'payment_selection'],
    ['hola', 'greeting'],
  ] as const)('%s remains deterministic for safety/action handling', (message, origin) => {
    const route = routeCommercialTurn({
      automationEnabled: true,
      claimed: claimedTurn({
        texts: [message],
        route: origin === 'call_handoff' ? 'call_direct_request' : origin === 'greeting' ? 'greeting' : null,
        allowedActions: origin === 'call_handoff' ? ['request_call_now'] : undefined,
        optOutAckEligible: origin === 'opt_out_ack',
        allowedResponseTypes: origin === 'opt_out_ack' ? ['opt_out_ack'] : undefined,
      }),
    });
    expect(route.kind).toBe('deterministic');
    if (route.kind === 'deterministic') expect(route.origin).toBe(origin);
  });
  it.each([
    'Estoy buscando algo para trabajar, qué me recomendás?',
    'No sé qué estudiar, orientame',
  ])('leaves open-ended commercial language to Gemini: %s', (text) => {
    const route = routeCommercialTurn({
      automationEnabled: true,
      claimed: claimedTurn({
        texts: [text],
        courseOfInterest: null,
        offeringCode: null,
        catalogResolution: { kind: 'not_found', requestedText: text, requestedArea: null, alternativeCodes: [] },
      }),
    });

    expect(route).toMatchObject({ kind: 'model_required', origin: 'advisory_model' });
  });

  it('answers a canonical payment-plan comparison without the model', () => {
    const route = routeCommercialTurn({
      automationEnabled: true,
      claimed: claimedTurn({
        texts: ['¿Cuál es la diferencia entre el plan corto y el plan largo de pago?'],
        courseOfInterest: 'Fotografía Profesional',
        offeringCode: 'fotografia_profesional',
      }),
    });

    expect(route).toMatchObject({ kind: 'deterministic', origin: 'payment_comparison' });
  });

  it('returns an explicit suppression decision when automation is disabled', () => {
    const route = routeCommercialTurn({
      automationEnabled: false,
      claimed: claimedTurn({
        texts: ['Llamame'],
        route: 'call_direct_request',
        allowedActions: ['request_call_now'],
      }),
    });

    expect(route).toMatchObject({
      kind: 'suppressed',
      origin: 'automation_disabled',
      reason: 'AUTOMATION_DISABLED',
      model: 'policy:automation-disabled',
      decision: {
        kind: 'suppress',
        reason_code: 'AUTOMATION_DISABLED',
        business_action: null,
      },
    });
    if (route.kind !== 'suppressed') throw new Error('EXPECTED_SUPPRESSED_ROUTE');
    expect(() => DecisionSchema.parse(route.decision)).not.toThrow();
  });

  it('never lets the opt-out acknowledgement bypass the automation kill switch', () => {
    const route = routeCommercialTurn({
      automationEnabled: false,
      claimed: claimedTurn({
        texts: ['Dame de baja'],
        blocked: true,
        consentStatus: 'revoked',
        mayRespond: true,
        allowedResponseTypes: ['opt_out_ack'],
        policyReason: 'EXPLICIT_OPT_OUT_ACK_ONLY',
        optOutAckEligible: true,
      }),
    });

    expect(route).toMatchObject({
      kind: 'suppressed',
      origin: 'automation_disabled',
      reason: 'AUTOMATION_DISABLED',
      decision: { kind: 'suppress', response: null },
    });
  });

  it.each([
    {
      name: 'blocked contact over a direct-call route',
      overrides: {
        blocked: true,
        texts: ['Llamame'],
        route: 'call_direct_request' as const,
        allowedActions: ['request_call_now' as const],
      },
      origin: 'contact_blocked',
      reason: 'CONTACT_BLOCKED',
      model: 'policy:contact-blocked',
    },
    {
      name: 'revoked consent over a payment choice',
      overrides: {
        consentStatus: 'revoked' as const,
        mayRespond: false,
        policyReason: 'CONSENT_REVOKED',
        texts: ['Confirmo 12 cuotas'],
      },
      origin: 'opt_out',
      reason: 'CONSENT_REVOKED',
      model: 'policy:opt-out',
    },
    {
      name: 'opt-out-only policy over an accepted call offer',
      overrides: {
        allowedResponseTypes: ['opt_out_ack' as const],
        policyReason: 'EXPLICIT_OPT_OUT_ACK_ONLY',
        texts: ['Sí'],
        route: 'call_accepted_offer' as const,
        acceptedOffer: true,
        allowedActions: ['request_call_now' as const],
      },
      origin: 'opt_out',
      reason: 'EXPLICIT_OPT_OUT_ACK_ONLY',
      model: 'policy:opt-out',
    },
    {
      name: 'generic turn-policy suppression over a payment choice',
      overrides: {
        mayRespond: false,
        policyReason: 'LIFECYCLE_SUPPRESSED',
        texts: ['Confirmo pago único'],
      },
      origin: 'turn_policy',
      reason: 'LIFECYCLE_SUPPRESSED',
      model: 'policy:suppressed',
    },
  ])('applies suppression precedence: $name', ({ overrides, origin, reason, model }) => {
    const route = routeCommercialTurn({
      automationEnabled: true,
      claimed: claimedTurn(overrides),
    });

    expect(route).toMatchObject({
      kind: 'suppressed',
      origin,
      reason,
      model,
      decision: { kind: 'suppress', business_action: null, response: null },
    });
    expectDecisionRoute(route);
  });

  it('acknowledges the current explicit opt-out even when the contact is already blocked and revoked', () => {
    const route = routeCommercialTurn({
      automationEnabled: true,
      claimed: claimedTurn({
        texts: ['Redes Informáticas, dame de baja'],
        blocked: true,
        consentStatus: 'revoked',
        mayRespond: true,
        allowedResponseTypes: ['opt_out_ack'],
        policyReason: 'EXPLICIT_OPT_OUT_ACK_ONLY',
        optOutAckEligible: true,
        route: 'call_direct_request',
        allowedActions: ['request_call_now'],
      }),
    });

    expect(route).toMatchObject({
      kind: 'deterministic',
      origin: 'opt_out_ack',
      reason: 'EXPLICIT_OPT_OUT_ACK',
      model: 'deterministic:opt-out-ack-v1',
      decision: {
        intent: 'opt_out',
        kind: 'reply',
        response_type: 'opt_out_ack',
        business_action: null,
        memory_candidates: [],
        missing_information: [],
        next_state: 'completed',
      },
    });
    expectDecisionRoute(route);

    if (route.kind !== 'deterministic') throw new Error('EXPECTED_OPT_OUT_ACK');
    const afterPolicy = applyDecisionPolicy(route.decision, claimedTurn({
      texts: ['Redes Informáticas, dame de baja'],
      blocked: true,
      consentStatus: 'revoked',
      mayRespond: true,
      allowedResponseTypes: ['opt_out_ack'],
      policyReason: 'EXPLICIT_OPT_OUT_ACK_ONLY',
    }));
    expect(afterPolicy).toMatchObject({
      intent: 'opt_out',
      response_type: 'opt_out_ack',
      memory_candidates: [],
      business_action: null,
    });
    expect(() => DecisionSchema.parse(afterPolicy)).not.toThrow();
  });

  it('does not acknowledge an old revocation when the current batch is not an opt-out', () => {
    const route = routeCommercialTurn({
      automationEnabled: true,
      claimed: claimedTurn({
        texts: ['Sí'],
        blocked: true,
        consentStatus: 'revoked',
        mayRespond: true,
        allowedResponseTypes: ['opt_out_ack'],
        policyReason: 'EXPLICIT_OPT_OUT_ACK_ONLY',
      }),
    });

    expect(route).toMatchObject({
      kind: 'suppressed',
      origin: 'contact_blocked',
      decision: { kind: 'suppress', response: null },
    });
  });

  it.each([
    ['Dame de baja, pero confirmo 12 cuotas'],
    ['Confirmo 12 cuotas', 'Sacame de la lista definitivamente'],
  ])('fails closed when an explicit opt-out lacks policy authorization for its acknowledgement: %j', (...texts) => {
    const route = routeCommercialTurn({
      automationEnabled: true,
      claimed: claimedTurn({
        texts,
        route: 'call_direct_request',
        allowedActions: ['request_call_now'],
        optOutAckEligible: true,
      }),
    });

    expect(route).toMatchObject({
      kind: 'suppressed',
      origin: 'opt_out',
      reason: 'EXPLICIT_OPT_OUT_IN_BATCH',
      decision: { business_action: null },
    });
  });

  it.each([
    {
      name: 'a greeting followed by a question',
      texts: ['Hola', '¿Cuánto sale?'],
      // Claim only authorizes `greeting` when every message in the burst is
      // a greeting; this batch must still reach the commercial model.
      route: null,
    },
    {
      name: 'a payment choice followed by a call decline',
      texts: ['Confirmo 12 cuotas', 'No, mejor no me llames'],
      route: 'call_direct_request' as const,
    },
  ])('sends every ambiguous multi-message batch to the model: $name', ({ texts, route }) => {
    const result = routeCommercialTurn({
      automationEnabled: true,
      claimed: claimedTurn({ texts, route, allowedActions: ['request_call_now'] }),
    });

    expect(result).toMatchObject({ kind: 'model_required', origin: 'advisory_model' });
  });

  it('routes a backend-authorized greeting-only burst without invoking a model', () => {
    const result = routeCommercialTurn({
      automationEnabled: true,
      claimed: claimedTurn({
        texts: ['Buen día', 'Hola'],
        route: 'greeting',
      }),
    });

    expect(result).toMatchObject({
      kind: 'deterministic',
      origin: 'greeting',
      reason: 'DETERMINISTIC_GREETING',
    });
  });

  it.each([
    {
      name: 'a catalog request followed by a direct call request',
      texts: ['Busco Python', 'Llamame ahora'],
      catalogResolution: {
        kind: 'not_found' as const,
        requestedText: 'Busco Python\nLlamame ahora',
        requestedArea: null,
        alternativeCodes: [],
      },
    },
    {
      name: 'a greeting followed by a direct call request while the snapshot is missing',
      texts: ['Hola', 'Llamame ahora'],
      catalogResolution: { kind: 'unavailable' as const, reason: 'snapshot_missing' as const },
    },
  ])('lets an authorized direct call outrank catalog state: $name', ({ texts, catalogResolution }) => {
    const route = routeCommercialTurn({
      automationEnabled: true,
      claimed: claimedTurn({
        texts,
        catalogResolution,
        route: 'call_direct_request',
        allowedActions: ['request_call_now'],
      }),
    });

    expect(route).toMatchObject({
      kind: 'deterministic',
      origin: 'call_handoff',
      reason: 'CALL_DIRECT_REQUEST',
      decision: {
        business_action: { type: 'request_call_now', reason: 'direct_request' },
      },
    });
    expectDecisionRoute(route);
  });

  it('lets an authorized greeting outrank an accidental missing-snapshot state', () => {
    const route = routeCommercialTurn({
      automationEnabled: true,
      claimed: claimedTurn({
        texts: ['Hola'],
        route: 'greeting',
        catalogResolution: { kind: 'unavailable', reason: 'snapshot_missing' },
      }),
    });

    expect(route).toMatchObject({
      kind: 'deterministic',
      origin: 'greeting',
      reason: 'DETERMINISTIC_GREETING',
      decision: { response_type: 'social_reply', business_action: null },
    });
    expectDecisionRoute(route);
  });

  it('does not let not-found catalog state override an explicit course rejection', () => {
    const text = 'No me interesa el curso de Python';
    const route = routeCommercialTurn({
      automationEnabled: true,
      claimed: claimedTurn({
        texts: [text],
        catalogResolution: {
          kind: 'not_found',
          requestedText: text,
          requestedArea: null,
          alternativeCodes: [],
        },
      }),
    });

    expect(route).toEqual({
      kind: 'model_required',
      origin: 'advisory_model',
      reason: 'NEGATIVE_SIGNAL_REQUIRES_MODEL',
    });
  });

  it('does not erase a course-fact question attached to a call refusal', () => {
    expect(routeCommercialTurn({
      automationEnabled: true,
      claimed: claimedTurn({
        texts: ['No quiero una llamada. ¿Cuántas clases tiene Redes Informáticas?'],
      }),
    })).toMatchObject({ kind: 'model_required', origin: 'advisory_model', reason: 'CALL_DECLINE_REQUIRES_SALES_MODEL' });
  });

  it('asks for the course when a multi-message plan selection has no canonical offering', () => {
    const claimed = claimedTurn({
      texts: ['Busco Python', 'Confirmo 12 cuotas'],
      courseOfInterest: null,
      offeringCode: null,
      catalogResolution: {
        kind: 'not_found',
        requestedText: 'Busco Python\nConfirmo 12 cuotas',
        requestedArea: null,
        alternativeCodes: [],
      },
    });
    const route = routeCommercialTurn({ automationEnabled: true, claimed });

    expect(route).toMatchObject({
      kind: 'deterministic',
      origin: 'payment_selection',
      reason: 'OFFERING_REQUIRED',
      decision: {
        kind: 'clarify',
        business_action: null,
        missing_information: ['course_of_interest'],
      },
    });
    expect(route.kind === 'deterministic' ? route.authorizedPaymentPlan : undefined).toBeUndefined();
    expectDecisionRoute(route);

    const afterPolicy = applyDecisionPolicy(route.decision, claimed);
    expect(afterPolicy).toMatchObject({
      kind: 'clarify',
      reason_code: 'OFFERING_REQUIRED',
      business_action: null,
      missing_information: ['course_of_interest'],
    });
  });

  it('does not treat an accidental near-course word plus unavailable state as catalog intent', () => {
    const route = routeCommercialTurn({
      automationEnabled: true,
      claimed: claimedTurn({
        texts: ['El oratorio está cerrado'],
        offerings: [businessOffering('oratoria', 'Oratoria', 'Comunicación')],
        catalogResolution: { kind: 'unavailable', reason: 'snapshot_missing' },
      }),
    });

    expect(route).toEqual({
      kind: 'model_required',
      origin: 'advisory_model',
      reason: expect.any(String),
    });
  });

  it('does not treat a generic availability verb as catalog intent by itself', () => {
    const route = routeCommercialTurn({
      automationEnabled: true,
      claimed: claimedTurn({
        texts: ['¿Tienen horarios los sábados?'],
        courseOfInterest: null,
        offeringCode: null,
        catalogResolution: { kind: 'unavailable', reason: 'snapshot_missing' },
      }),
    });

    expect(route).toMatchObject({ kind: 'model_required', origin: 'advisory_model' });
    expect(route.kind).toBe('model_required');
  });

  it('routes a genuinely requested unknown program through the fail-closed catalog path', () => {
    const text = 'Necesito información del programa de Astronomía';
    const route = routeCommercialTurn({
      automationEnabled: true,
      claimed: claimedTurn({
        texts: [text],
        courseOfInterest: null,
        offeringCode: null,
        catalogResolution: {
          kind: 'not_found',
          requestedText: text,
          requestedArea: null,
          alternativeCodes: [],
        },
      }),
    });

    expect(route).toMatchObject({ kind: 'deterministic', origin: 'catalog_not_found' });
  });

  it.each([
    '¿Se puede hacer sin usar un programa de diseño?',
    'Nunca usé un programa de diseño, ¿igual puedo hacer el curso?',
  ])('does not mirror a program-requirement follow-up as unavailable catalog: %s', (text) => {
    const route = routeCommercialTurn({
      automationEnabled: true,
      claimed: claimedTurn({
        texts: [text],
        courseOfInterest: 'Decoración de Interiores',
        offeringCode: 'decoracion_de_interiores',
        offerings: [businessOffering(
          'decoracion_de_interiores',
          'Decoración de Interiores',
          'Diseño',
        )],
        catalogResolution: { kind: 'unavailable', reason: 'snapshot_missing' },
      }),
    });

    expect(route.origin).not.toBe('catalog_unavailable');
  });

  it('prioritizes a later explicit unknown-program request over experience context', () => {
    const text = 'Nunca usé un programa de diseño; necesito información del programa de Astronomía';
    const route = routeCommercialTurn({
      automationEnabled: true,
      claimed: claimedTurn({
        texts: [text],
        courseOfInterest: null,
        offeringCode: null,
        catalogResolution: {
          kind: 'not_found',
          requestedText: text,
          requestedArea: null,
          alternativeCodes: [],
        },
      }),
    });

    expect(route).toMatchObject({ kind: 'deterministic', origin: 'catalog_not_found' });
  });

  it('preserves the direct-call request semantics already authorized by the claim', () => {
    const route = routeCommercialTurn({
      automationEnabled: true,
      claimed: claimedTurn({
        texts: ['Llamame ahora'],
        route: 'call_direct_request',
        allowedActions: ['request_call_now'],
      }),
    });

    expect(route).toMatchObject({
      kind: 'deterministic',
      origin: 'call_handoff',
      reason: 'CALL_DIRECT_REQUEST',
      model: 'deterministic:call-handoff-fast-path-v1',
      decision: {
        response_type: 'call_confirmation',
        business_action: { type: 'request_call_now', reason: 'direct_request' },
      },
    });
    expectDecisionRoute(route);
  });

  it('preserves acceptance of a currently authorized call offer', () => {
    const route = routeCommercialTurn({
      automationEnabled: true,
      claimed: claimedTurn({
        texts: ['Sí'],
        route: 'call_accepted_offer',
        acceptedOffer: true,
        allowedActions: ['request_call_now'],
      }),
    });

    expect(route).toMatchObject({
      kind: 'deterministic',
      origin: 'call_handoff',
      decision: {
        response_type: 'call_confirmation',
        business_action: { type: 'request_call_now', reason: 'accepted_offer' },
      },
    });
    expectDecisionRoute(route);
  });

  it('clarifies a bare acceptance without an active offer and invents no call', () => {
    const route = routeCommercialTurn({
      automationEnabled: true,
      claimed: claimedTurn({ texts: ['Sí'], route: 'call_acceptance_clarification' }),
    });

    expect(route).toMatchObject({
      kind: 'deterministic',
      origin: 'call_handoff',
      reason: 'CALL_CONSENT_AMBIGUOUS',
      decision: {
        kind: 'clarify',
        response_type: 'clarification',
        business_action: null,
        next_state: 'waiting_user',
      },
    });
    expectDecisionRoute(route);
  });

  it.each([
    {
      name: 'call cancellation over an inconsistent positive call route',
      text: 'Llamame; no, mejor cancelá la llamada.',
      expectedKind: 'deterministic',
      expectedOrigin: 'call_handoff',
      expectedReason: 'CALL_DIRECT_REQUEST',
    },
    {
      name: 'commercial deferral over a selected payment plan',
      text: 'Confirmo 12 cuotas, pero por ahora no me voy a anotar.',
      expectedKind: 'deterministic',
      expectedOrigin: 'call_handoff',
      expectedReason: 'CALL_DIRECT_REQUEST',
    },
    {
      name: 'unrendered call decline over a selected payment plan',
      text: 'No me llames, pero confirmo 12 cuotas.',
      expectedKind: 'model_required',
      expectedOrigin: 'advisory_model',
      expectedReason: 'CALL_DECLINE_REQUIRES_SALES_MODEL',
    },
    {
      name: 'unrendered commercial rejection over a hypothetical payment plan',
      text: 'No quiero comprar ahora; si comprara, elegiría 12 cuotas.',
      expectedKind: 'model_required',
      expectedOrigin: 'advisory_model',
      expectedReason: 'NEGATIVE_SIGNAL_REQUIRES_MODEL',
    },
  ])('lets rejection beat a positive signal: $name', ({
    text,
    expectedKind,
    expectedOrigin,
    expectedReason,
  }) => {
    const route = routeCommercialTurn({
      automationEnabled: true,
      claimed: claimedTurn({
        texts: [text],
        route: 'call_direct_request',
        allowedActions: ['request_call_now'],
      }),
    });

    expect(route).toMatchObject({
      kind: expectedKind,
      origin: expectedOrigin,
      reason: expectedReason,
    });
  });

  it('routes a valid payment choice deterministically without authoring a URL or payment fact', () => {
    const route = routeCommercialTurn({
      automationEnabled: true,
      claimed: claimedTurn({ texts: ['Confirmo las 12 cuotas'] }),
    });

    expect(route).toMatchObject({
      kind: 'deterministic',
      origin: 'payment_selection',
      reason: 'DETERMINISTIC_PAYMENT_SELECTION',
      model: 'deterministic:payment-selection-fast-path-v1',
      authorizedPaymentPlan: 'monthly_12',
      decision: {
        business_action: null,
        next_state: 'waiting_user',
      },
    });
    expectDecisionRoute(route);
    expect(route.decision.response).not.toMatch(/https?:\/\//iu);
    expect(route.decision.response).not.toMatch(/pagaste|pago recibido|inscripto|acceso habilitado/iu);
  });

  it('does not turn a delayed link into a payment action or an opt-out', () => {
    const route = routeCommercialTurn({
      automationEnabled: true,
      claimed: claimedTurn({ texts: ['Confirmo 12 cuotas; no me mandes el link todavía.'] }),
    });

    expect(route).toEqual({
      kind: 'model_required',
      origin: 'advisory_model',
      reason: 'ADVISORY_REQUIRES_SALES_MODEL',
    });
  });

  it('clarifies an ambiguous catalog resolution with only mapped canonical names', () => {
    const requestedText = 'Quiero Python por USD 5: https://evil.example/curso';
    const route = routeCommercialTurn({
      automationEnabled: true,
      claimed: claimedTurn({
        texts: [requestedText],
        offerings: [
          businessOffering('marketing', 'Marketing Digital', 'Marketing'),
          businessOffering('excel', 'Excel Integral', 'Tecnología'),
        ],
        catalogResolution: {
          kind: 'ambiguous',
          requestedText,
          candidateCodes: ['marketing', 'missing-code', 'excel'],
          clarification: 'choose_offering',
        },
      }),
    });

    expect(route).toMatchObject({
      kind: 'deterministic',
      origin: 'catalog_ambiguous',
      reason: 'DETERMINISTIC_CATALOG_AMBIGUOUS',
      model: 'deterministic:catalog-resolution-v1',
      decision: {
        kind: 'clarify',
        response_type: 'clarification',
        business_action: null,
        next_state: 'waiting_user',
      },
    });
    expectDecisionRoute(route);
    const response = route.decision.response ?? '';
    expect(response).toContain('Marketing Digital');
    expect(response).toContain('Excel Integral');
    expect(response).not.toContain('missing-code');
    expect(response).not.toContain(requestedText);
    expect(response).not.toMatch(/https?:\/\/|USD|\b5\b/iu);
    expect(response.match(/\?/gu) ?? []).toHaveLength(1);
    expect(response.length).toBeLessThanOrEqual(220);
  });

  it('fails closed when fewer than two ambiguous candidates exist in the authorized snapshot', () => {
    const route = routeCommercialTurn({
      automationEnabled: true,
      claimed: claimedTurn({
        texts: ['Marketing o algo más'],
        offerings: [businessOffering('marketing', 'Marketing Digital', 'Marketing')],
        catalogResolution: {
          kind: 'ambiguous',
          requestedText: 'Marketing o algo más',
          candidateCodes: ['marketing', 'missing-code'],
          clarification: 'choose_offering',
        },
      }),
    });

    expect(route).toMatchObject({
      kind: 'deterministic',
      origin: 'catalog_unavailable',
      reason: 'CATALOG_CANDIDATES_UNAVAILABLE',
      decision: { business_action: null },
    });
    expectDecisionRoute(route);
    expect(route.decision.response).not.toContain('Marketing Digital');
    expect(route.decision.response).toMatch(/no puedo confirmar el catálogo/i);
  });

  it('does not choose arbitrary alternatives for a multi-message not-found request without area', () => {
    const requestedText = 'Busco Python completo por USD 10';
    const route = routeCommercialTurn({
      automationEnabled: true,
      claimed: claimedTurn({
        texts: [requestedText, '¿Está en el catálogo?'],
        offerings: [
          businessOffering('marketing', 'Marketing Digital', 'Marketing'),
          businessOffering('excel', 'Excel Integral', 'Tecnología'),
        ],
        catalogResolution: {
          kind: 'not_found',
          requestedText,
          requestedArea: null,
          alternativeCodes: ['marketing', 'excel'],
        },
      }),
    });

    expect(route).toMatchObject({
      kind: 'deterministic',
      origin: 'catalog_not_found',
      reason: 'DETERMINISTIC_CATALOG_NOT_FOUND',
      decision: { business_action: null },
    });
    expectDecisionRoute(route);
    const response = route.decision.response ?? '';
    expect(response).toMatch(/no pude verificar/iu);
    expect(response).toMatch(/qué área/iu);
    expect(response).not.toMatch(/Marketing Digital|Excel Integral|Python|USD|\b10\b/iu);
    expect(response).not.toMatch(/catálogo completo|no figura|no existe/iu);
    expect(response.match(/\?/gu) ?? []).toHaveLength(1);
    expect(response.length).toBeLessThanOrEqual(220);
  });

  it('does not recommend alternatives before the requested-area rule is approved', () => {
    const requestedText = 'Busco Astronomía en Tecnología https://evil.example por USD 99';
    const route = routeCommercialTurn({
      automationEnabled: true,
      claimed: claimedTurn({
        texts: [requestedText],
        offerings: [
          businessOffering('autocad', 'AutoCAD', 'Tecnología'),
          businessOffering('fotografia', 'Fotografía', 'Diseño'),
          businessOffering('excel', 'Excel Integral', 'Tecnología'),
          businessOffering('redes', 'Redes Informáticas', 'Tecnología'),
          businessOffering('soporte', 'Soporte de PC', 'Tecnología'),
        ],
        catalogResolution: {
          kind: 'not_found',
          requestedText,
          requestedArea: 'Tecnología',
          alternativeCodes: [
            'autocad',
            'fotografia',
            'missing-code',
            'excel',
            'redes',
            'soporte',
          ],
        },
      }),
    });

    expect(route).toMatchObject({
      kind: 'deterministic',
      origin: 'catalog_not_found',
      reason: 'DETERMINISTIC_CATALOG_NOT_FOUND',
      decision: { business_action: null },
    });
    expectDecisionRoute(route);
    const response = route.decision.response ?? '';
    expect(response).toMatch(/no pude verificar/iu);
    expect(response).toMatch(/opciones.*área/iu);
    expect(response).not.toMatch(/AutoCAD|Excel Integral|Redes Informáticas/iu);
    expect(response).not.toMatch(/Fotografía|Soporte de PC|missing-code|catálogo completo/iu);
    expect(response).not.toMatch(/https?:\/\/|USD|\b99\b|Astronomía/iu);
    expect(response.match(/\?/gu) ?? []).toHaveLength(1);
    expect(response.length).toBeLessThanOrEqual(220);
  });

  it.each([
    ['snapshot_missing', 'CATALOG_SNAPSHOT_MISSING'],
    ['snapshot_truncated', 'CATALOG_SNAPSHOT_TRUNCATED'],
    ['snapshot_invalid', 'CATALOG_SNAPSHOT_INVALID'],
  ] as const)(
    'fails closed for unavailable catalog state %s even in a multi-message batch',
    (unavailableReason, expectedReason) => {
      const route = routeCommercialTurn({
        automationEnabled: true,
        claimed: claimedTurn({
          texts: ['Busco Python', '¿Cuántas clases tiene?'],
          catalogResolution: { kind: 'unavailable', reason: unavailableReason },
        }),
      });

      expect(route).toMatchObject({
        kind: 'deterministic',
        origin: 'catalog_unavailable',
        reason: expectedReason,
        model: 'deterministic:catalog-resolution-v1',
        decision: { business_action: null },
      });
      expectDecisionRoute(route);
      const response = route.decision.response ?? '';
      expect(response).toMatch(/no puedo confirmar el catálogo/i);
      expect(response).not.toMatch(/no figura|no existe|sí existe|https?:\/\/|precio/iu);
      expect(response.match(/\?/gu) ?? []).toHaveLength(1);
      expect(response.length).toBeLessThanOrEqual(180);
    },
  );

  it('suppresses an unavailable catalog fallback when policy authorizes no safe text type', () => {
    const route = routeCommercialTurn({
      automationEnabled: true,
      claimed: claimedTurn({
        texts: ['Busco Python'],
        allowedResponseTypes: [],
        catalogResolution: { kind: 'unavailable', reason: 'snapshot_missing' },
      }),
    });

    expect(route).toMatchObject({
      kind: 'suppressed',
      origin: 'catalog_unavailable',
      reason: 'CATALOG_RESPONSE_NOT_ALLOWED',
      decision: { kind: 'suppress', response: null, business_action: null },
    });
    expectDecisionRoute(route);
  });

  it.each([
    {
      name: 'call before payment',
      overrides: {
        texts: ['Llamame y confirmo 12 cuotas'],
        route: 'call_direct_request' as const,
        allowedActions: ['request_call_now' as const],
      },
      origin: 'call_handoff',
      reason: 'CALL_DIRECT_REQUEST',
    },
    {
      name: 'payment before captured identity',
      overrides: {
        texts: ['Bruno, bruno@example.test; confirmo 12 cuotas'],
        name: 'Bruno',
      },
      origin: 'payment_selection',
      reason: 'DETERMINISTIC_PAYMENT_SELECTION',
    },
    {
      name: 'captured identity before course facts',
      overrides: {
        texts: ['Bruno, bruno@example.test. ¿Cuántas clases tiene?'],
        name: 'Bruno',
      },
      origin: 'contact_capture',
      reason: 'DETERMINISTIC_CONTACT_CAPTURE',
    },
    {
      name: 'course facts before course discovery',
      overrides: {
        texts: ['¿Cuántas clases tiene Redes Informáticas?'],
        catalogResolution: {
          kind: 'exact' as const,
          offeringCode: 'redes-informaticas',
          displayName: 'Redes Informáticas',
          academy: 'Oficios',
          match: 'canonical' as const,
        },
      },
      origin: 'course_facts',
      reason: 'DETERMINISTIC_COURSE_FACTS',
    },
    {
      name: 'course discovery before social fallback',
      overrides: { texts: ['Redes Informáticas'] },
      origin: 'course_discovery',
      reason: 'DETERMINISTIC_COURSE_DISCOVERY',
    },
    {
      name: 'backend-authorized greeting',
      overrides: { texts: ['Hola'], route: 'greeting' as const },
      origin: 'greeting',
      reason: 'DETERMINISTIC_GREETING',
    },
  ])('uses one stable fast-path precedence: $name', ({ overrides, origin, reason }) => {
    const route = routeCommercialTurn({
      automationEnabled: true,
      claimed: claimedTurn(overrides),
    });

    expect(route).toMatchObject({ kind: 'deterministic', origin, reason });
    if (route.kind !== 'model_required') expectDecisionRoute(route);
  });

  it('returns a traceable model requirement when no deterministic route concludes', () => {
    expect(routeCommercialTurn({
      automationEnabled: true,
      claimed: claimedTurn({ texts: ['No estoy seguro; contame qué me conviene'] }),
    })).toMatchObject({ kind: 'model_required', origin: 'advisory_model' });
  });

  it('carries the canonical authorization resolved by a referential course discovery', () => {
    const route = routeCommercialTurn({
      automationEnabled: true,
      claimed: claimedTurn({
        texts: ['El de sacar fotos de productos con el celu.'],
        courseOfInterest: null,
        offeringCode: null,
        recentInbound: [
          'Estoy entre Fotografía Profesional y Fotografía con Celulares para Tiendas Online.',
        ],
        offerings: [
          businessOffering('foto_celular', 'Fotografía con Celulares para Tiendas Online', 'Marketing'),
          businessOffering('foto_profesional', 'Fotografía Profesional', 'Emprendedores'),
        ],
      }),
    });

    expect(route).toMatchObject({ kind: 'deterministic', origin: 'course_discovery' });
    if (route.kind !== 'model_required') expect(route.decision.response?.length).toBeLessThanOrEqual(220);
  });

  it('uses the backend exact catalog resolution for colloquial course language', () => {
    const route = routeCommercialTurn({
      automationEnabled: true,
      claimed: claimedTurn({
        texts: ['La primera opción.'],
        courseOfInterest: null,
        offeringCode: null,
        catalogResolution: {
          kind: 'exact',
          offeringCode: 'foto_celular',
          displayName: 'Fotografía con Celulares para Tiendas Online',
          academy: 'Marketing',
          match: 'canonical',
        },
        offerings: [
          businessOffering('foto_celular', 'Fotografía con Celulares para Tiendas Online', 'Marketing'),
          businessOffering('foto_profesional', 'Fotografía Profesional', 'Emprendedores'),
        ],
      }),
    });

    expect(route).toMatchObject({
      kind: 'deterministic',
      origin: 'course_discovery',
      authorizedOfferingCode: 'foto_celular',
    });
    if (route.kind !== 'model_required') {
      expect(route.decision.response).toMatch(/Fotografía con Celulares.*16 clases/u);
    }
  });

  it('clarifies a course fact from an unresolved two-course history', () => {
    const route = routeCommercialTurn({
      automationEnabled: true,
      claimed: claimedTurn({
        texts: ['¿Cuántas clases tiene?'],
        courseOfInterest: null,
        offeringCode: null,
        recentInbound: [
          'Estoy entre Fotografía Profesional y Fotografía con Celulares para Tiendas Online.',
        ],
        offerings: [
          businessOffering('foto_celular', 'Fotografía con Celulares para Tiendas Online', 'Marketing'),
          businessOffering('foto_profesional', 'Fotografía Profesional', 'Emprendedores'),
        ],
      }),
    });

    expect(route).toMatchObject({ kind: 'deterministic', origin: 'course_facts' });
    if (route.kind !== 'model_required') {
      expect(route.decision).toMatchObject({ kind: 'clarify', response_type: 'clarification' });
      expect(route.decision.response).not.toMatch(/20 clases|41 clases/u);
      expect(route.decision.response?.length).toBeLessThanOrEqual(160);
    }
  });

  it('authorizes the sole alternative selected by an "el otro" course-fact question', () => {
    const route = routeCommercialTurn({
      automationEnabled: true,
      claimed: claimedTurn({
        texts: ['¿Y el otro cuántas clases tiene?'],
        courseOfInterest: 'Fotografía con Celulares para Tiendas Online',
        offeringCode: 'foto_celular',
        recentInbound: [
          'Estoy entre Fotografía Profesional y Fotografía con Celulares para Tiendas Online.',
        ],
        offerings: [
          businessOffering('foto_celular', 'Fotografía con Celulares para Tiendas Online', 'Marketing'),
          businessOffering('foto_profesional', 'Fotografía Profesional', 'Emprendedores'),
        ],
      }),
    });

    expect(route).toMatchObject({ kind: 'deterministic', origin: 'course_facts' });
  });

  it('does not overwrite canonical course memory from a generic experience sentence', () => {
    const claimed = claimedTurn({
      texts: ['Nunca trabajé en ventas, ¿igual me sirve el curso?'],
      courseOfInterest: 'Especialista en Ventas',
      offeringCode: 'especialista_ventas',
      offerings: [businessOffering('especialista_ventas', 'Especialista en Ventas', 'Negocios')],
    });
    const route = routeCommercialTurn({ automationEnabled: true, claimed });
    if (route.kind === 'model_required') throw new Error('expected deterministic course facts');

    const decision = applyDecisionPolicy(route.decision, claimed);

    expect(decision.memory_candidates).not.toContainEqual(expect.objectContaining({
      type: 'study_goal',
      key: 'target_course',
      value: 'ventas',
    }));
  });

  it('returns the raw decision for exactly one later decision-policy application', () => {
    const route = routeCommercialTurn({
      automationEnabled: true,
      claimed: claimedTurn({
        texts: ['Hola'],
        route: 'greeting',
        recentInbound: ['Ya veníamos conversando'],
      }),
    });

    expectDecisionRoute(route);
    expect(route.decision.response).toMatch(/^¡Hola!/u);
  });

  it('is referentially transparent for the same claimed snapshot', () => {
    const input = {
      automationEnabled: true,
      claimed: claimedTurn({ texts: ['¿Cuántas clases tiene?'] }),
    } as const;

    expect(routeCommercialTurn(input)).toEqual(routeCommercialTurn(input));
  });

  describe('closest-match alternatives request', () => {
    const alternativesOfferings = [
      businessOffering('autocad', 'AutoCAD orientado al Diseño de Interiores', 'Academia de Diseño Informático'),
      businessOffering('corel', 'Diseño Gráfico con Corel Draw', 'Academia de Diseño Informático'),
      businessOffering('marketing', 'Especialista en Marketing Digital', 'Academia de Marketing'),
      businessOffering('paisajismo', 'Paisajismo', 'Academia de Oficios'),
    ];

    it('answers "lo más parecido" deterministically with snapshot academies only', () => {
      const route = routeCommercialTurn({
        automationEnabled: true,
        claimed: claimedTurn({
          texts: ['Ah, no sabía que no lo tienen. ¿Qué es lo más parecido que ofrecen?'],
          courseOfInterest: null,
          offeringCode: null,
          offerings: alternativesOfferings,
        }),
      });

      expectDecisionRoute(route);
      expect(route).toMatchObject({
        kind: 'deterministic',
        origin: 'catalog_not_found',
        reason: 'DETERMINISTIC_CATALOG_ALTERNATIVES',
      });
      expect(route.decision.response).toContain('Academia de Diseño Informático');
      expect(route.decision.response).toContain('Academia de Marketing');
      expect(route.decision.response).toContain('Academia de Oficios');
      // Course names never appear: only areas may be offered as alternatives.
      expect(route.decision.response).not.toMatch(/AutoCAD|Corel|Marketing Digital|Paisajismo(?! )/u);
      expect(route.decision.business_action).toBeNull();
    });

    it('fails closed when the alternatives request has no business snapshot', () => {
      const claimed = claimedTurn({
        texts: ['¿Qué alternativas tienen?'],
        courseOfInterest: null,
        offeringCode: null,
      }) as ClaimedTurn & { business_context: unknown; business_context_available: boolean };
      claimed.business_context = null;
      claimed.business_context_available = false;

      const route = routeCommercialTurn({ automationEnabled: true, claimed });

      expectDecisionRoute(route);
      expect(route.reason).toBe('CATALOG_SNAPSHOT_MISSING');
      expect(route.decision.response).toContain('No puedo confirmar el catálogo ahora');
    });

    it('does not hijack a similar-course question when a course is already confirmed', () => {
      const route = routeCommercialTurn({
        automationEnabled: true,
        claimed: claimedTurn({
          texts: ['¿Tienen algo parecido?'],
          courseOfInterest: 'Redes Informáticas',
          offeringCode: 'redes-informaticas',
          offerings: alternativesOfferings,
        }),
      });

      expect(route).toMatchObject({
        kind: 'model_required',
        origin: 'advisory_model',
      });
    });
  });

  describe('catalog navigation', () => {
    const navigationOfferings = [
      businessOffering('ingles-1', 'Inglés 1', 'Academia Cultural'),
      businessOffering('ingles-2', 'Inglés 2', 'Academia Cultural'),
      businessOffering('ingles-3', 'Inglés 3', 'Academia Cultural'),
      businessOffering('diseno', 'Diseño Gráfico', 'Academia de Diseño Informático'),
      businessOffering('emprender', 'Emprendimientos', 'Academia de Emprendedores'),
      businessOffering('marketing', 'Marketing Digital', 'Academia de Marketing'),
      businessOffering('redes', 'Publicidad en Redes', 'Academia de Marketing'),
      businessOffering('ventas', 'Ventas por Internet', 'Academia de Marketing'),
      businessOffering('copy', 'Copywriting Comercial', 'Academia de Marketing'),
      businessOffering('belleza', 'Belleza Integral', 'Academia de Moda y Belleza'),
      businessOffering('negocios', 'Administración', 'Academia de Negocios'),
      businessOffering('oficios', 'Redes Informáticas', 'Academia de Oficios'),
      businessOffering('salud', 'Bienestar Integral', 'Academia de Salud y Bienestar'),
      businessOffering('gastronomia', 'Cocina Profesional', 'Academia Gastronómica'),
    ];

    it('orients a generic catalog request with every canonical area and no course list', () => {
      const route = routeCommercialTurn({
        automationEnabled: true,
        claimed: claimedTurn({
          texts: ['¿Qué cursos tienen?'],
          courseOfInterest: null,
          offeringCode: null,
          offerings: navigationOfferings,
        }),
      });

      expectDecisionRoute(route);
      expect(route).toMatchObject({
        kind: 'deterministic',
        origin: 'catalog_navigation',
        reason: 'DETERMINISTIC_CATALOG_NAVIGATION',
      });
      const response = route.decision.response ?? '';
      expect(response).toMatch(/Cultural.*Diseño Informático.*Emprendedores.*Marketing/u);
      expect(response).toMatch(/Moda y Belleza.*Negocios.*Oficios.*Salud y Bienestar.*Gastronómica/u);
      expect(response).not.toMatch(/Inglés 1|Marketing Digital|Publicidad en Redes/u);
      expect(response.match(/\?/gu) ?? []).toHaveLength(1);
    });

    it.each([
      'Info de los cursos',
      'Información de los cursos?',
      '¿Cuáles hay disponibles?',
      '¿Qué ofrecen?',
      'Quiero estudiar algo',
      'Hola, ¿qué cursos tienen?',
      'Me pasás los cursos disponibles?',
    ])('resolves the real generic catalog phrasing without a model: %s', (text) => {
      const route = routeCommercialTurn({
        automationEnabled: true,
        claimed: claimedTurn({
          texts: [text],
          courseOfInterest: null,
          offeringCode: null,
          offerings: navigationOfferings,
          catalogResolution: {
            kind: 'not_found',
            requestedText: text,
            requestedArea: null,
            alternativeCodes: [],
          },
        }),
      });

      expectDecisionRoute(route);
      expect(route).toMatchObject({
        kind: 'deterministic',
        origin: 'catalog_navigation',
        reason: 'DETERMINISTIC_CATALOG_NAVIGATION',
      });
      expect(route.decision.response).not.toMatch(/Inglés 1|Marketing Digital|Diseño Gráfico/u);
      expect(route.decision.response?.match(/\?/gu) ?? []).toHaveLength(1);
    });

    it.each([
      {
        texts: ['Info de los cursos', 'Hola información', '??'],
        catalogResolution: {
          kind: 'not_found' as const,
          requestedText: 'Info de los cursos\nHola información\n??',
          requestedArea: null,
          alternativeCodes: [],
        },
      },
      {
        texts: ['Hola', 'Quiero ver los cursos'],
        catalogResolution: { kind: 'no_catalog_intent' as const },
      },
    ])('answers the catalog request in a message burst without restarting: $texts', ({ texts, catalogResolution }) => {
      const route = routeCommercialTurn({
        automationEnabled: true,
        claimed: claimedTurn({
          texts,
          courseOfInterest: null,
          offeringCode: null,
          offerings: navigationOfferings,
          catalogResolution,
        }),
      });

      expectDecisionRoute(route);
      expect(route).toMatchObject({
        kind: 'deterministic',
        origin: 'catalog_navigation',
        reason: 'DETERMINISTIC_CATALOG_NAVIGATION',
      });
      expect(route.decision.response).not.toMatch(/No pude verificar|Inglés 1|Marketing Digital/u);
      expect(route.decision.response?.match(/\?/gu) ?? []).toHaveLength(1);
    });

    it('recognizes the Rioplatense generic catalog phrasing used in chat', () => {
      const route = routeCommercialTurn({
        automationEnabled: true,
        claimed: claimedTurn({
          texts: ['¿Qué cursos tenés disponibles?'],
          courseOfInterest: null,
          offeringCode: null,
          offerings: navigationOfferings,
          catalogResolution: {
            kind: 'not_found',
            requestedText: '¿Qué cursos tenés disponibles?',
            requestedArea: null,
            alternativeCodes: [],
          },
        }),
      });

      expectDecisionRoute(route);
      expect(route).toMatchObject({
        kind: 'deterministic',
        origin: 'catalog_navigation',
        reason: 'DETERMINISTIC_CATALOG_NAVIGATION',
      });
      expect(route.decision.response).toMatch(/Diseño Informático.*Marketing/u);
    });

    it('recognizes a customer asking to discover the available courses', () => {
      const text = 'Hola, quiero conocer los cursos disponibles';
      const route = routeCommercialTurn({
        automationEnabled: true,
        claimed: claimedTurn({
          texts: [text],
          courseOfInterest: null,
          offeringCode: null,
          offerings: navigationOfferings,
          catalogResolution: {
            kind: 'not_found',
            requestedText: text,
            requestedArea: null,
            alternativeCodes: [],
          },
        }),
      });

      expectDecisionRoute(route);
      expect(route).toMatchObject({
        kind: 'deterministic',
        origin: 'catalog_navigation',
        reason: 'DETERMINISTIC_CATALOG_NAVIGATION',
      });
    });

    it('lists at most three canonical offerings for a requested area', () => {
      const route = routeCommercialTurn({
        automationEnabled: true,
        claimed: claimedTurn({
          texts: ['¿Qué cursos tienen de Academia de Marketing?'],
          courseOfInterest: null,
          offeringCode: null,
          offerings: navigationOfferings,
        }),
      });

      expectDecisionRoute(route);
      expect(route).toMatchObject({
        kind: 'deterministic',
        origin: 'catalog_navigation',
        reason: 'DETERMINISTIC_CATALOG_NAVIGATION',
      });
      const response = route.decision.response ?? '';
      expect(response).toMatch(/Marketing Digital.*Publicidad en Redes.*Ventas por Internet/u);
      expect(response).not.toMatch(/Copywriting Comercial|Diseño Gráfico/u);
      expect(response.match(/\?/gu) ?? []).toHaveLength(1);
    });

    it.each(['Marketing', 'Me interesa marketing'])('lists at most three canonical courses when the customer chooses an area: %s', (text) => {
      const route = routeCommercialTurn({
        automationEnabled: true,
        claimed: claimedTurn({
          texts: [text],
          courseOfInterest: null,
          offeringCode: null,
          offerings: navigationOfferings,
          recentInbound: ['Podemos orientarte por áreas. ¿Qué te gustaría aprender?'],
          catalogResolution: { kind: 'no_catalog_intent' },
        }),
      });

      expectDecisionRoute(route);
      expect(route).toMatchObject({
        kind: 'deterministic',
        origin: 'catalog_navigation',
        reason: 'DETERMINISTIC_CATALOG_NAVIGATION',
      });
      expect(route.decision.response).toMatch(/Marketing Digital.*Publicidad en Redes.*Ventas por Internet/u);
      expect(route.decision.response).not.toMatch(/Copywriting Comercial|Diseño Gráfico/u);
      expect(route.decision.response?.match(/\?/gu) ?? []).toHaveLength(1);
    });

    it('lists the three canonical English levels for the supervised-smoke phrasing', () => {
      const route = routeCommercialTurn({
        automationEnabled: true,
        claimed: claimedTurn({
          texts: ['Me interesa inglés'],
          courseOfInterest: null,
          offeringCode: null,
          offerings: navigationOfferings,
          recentInbound: ['Tenemos varias áreas. ¿Qué te gustaría aprender?'],
          catalogResolution: { kind: 'no_catalog_intent' },
        }),
      });

      expectDecisionRoute(route);
      expect(route).toMatchObject({
        kind: 'deterministic',
        origin: 'catalog_navigation',
        reason: 'DETERMINISTIC_CATALOG_NAVIGATION',
      });
      expect(route.decision.response).toMatch(/Inglés 1.*Inglés 2.*Inglés 3/u);
      expect(route.decision.response?.match(/\?/gu) ?? []).toHaveLength(1);
    });

    it('does not recommend the negated topic when the customer asks for something different', () => {
      const route = routeCommercialTurn({
        automationEnabled: true,
        claimed: claimedTurn({
          texts: ['En realidad quiero algo que no tenga que ver con inglés'],
          courseOfInterest: 'Inglés 1',
          offeringCode: 'ingles-1',
          offerings: navigationOfferings,
          catalogResolution: { kind: 'no_catalog_intent' },
        }),
      });

      expect(route).toMatchObject({
        kind: 'deterministic',
        origin: 'catalog_navigation',
        reason: 'DETERMINISTIC_CATALOG_NAVIGATION',
      });
      if (route.kind !== 'deterministic') throw new Error('expected deterministic route');
      expect(route.decision.response).toMatch(/dejamos ingl[eé]s de lado/iu);
      expect(route.decision.response).not.toMatch(/Inglés 1|Inglés 2|Inglés 3/u);
      expect(route.decision.response?.match(/\?/gu) ?? []).toHaveLength(1);
    });
  });
});
