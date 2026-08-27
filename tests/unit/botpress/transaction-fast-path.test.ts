import { describe, expect, it } from 'vitest';

import { DecisionSchema, type ClaimedTurn } from '../../../botpress-agent/src/schemas/contracts';
import {
  matchConversationCloseFastPath,
  matchCourseDiscoveryFastPath,
  matchCourseFactsFastPath,
  matchContactCaptureFastPath,
  matchPaymentComparisonFastPath,
  matchPaymentSelectionFastPath,
} from '../../../botpress-agent/src/utils/transaction-fast-path';

const UUID = '18a823e8-27c2-4279-9956-058f45f33cd5';

function claimed(text: string, overrides: { name?: string | null; prices?: boolean } = {}): ClaimedTurn {
  return {
    outcome: 'claimed', trace_id: UUID,
    batch: { id: UUID, claim_token: UUID, conversation_id: UUID, contact_id: UUID,
      lease_until: '2026-08-13T00:00:10.000Z', hard_deadline_at: '2026-08-13T00:00:04.000Z',
      message_count: 1, stolen: false },
    turn_id: UUID,
    policy: { may_respond: true, allowed_response_types: ['commercial_reply', 'clarification', 'technical_fallback'], reason: null },
    contact: { id: UUID, status: 'prospecto', name: overrides.name ?? null, blocked: false,
      consent_status: 'allowed', opted_in_at: '2026-08-12T00:00:00.000Z' },
    context: { batch_messages: [{ id: UUID, conversation_seq: 1, content: text,
      created_at: '2026-08-13T00:00:00.000Z', message_type: 'text' }], recent_turns: [],
      summary: { text: null, version: 0, updated_at: null }, selected_memories: [],
      long_term_memory_available: false, knowledge_base: [], knowledge_base_available: false,
      knowledge_base_dropped: 0, injection_suspected_count: 0 },
    sales_context: { mode: 'advising', stage: 'exploring', course_of_interest: 'Redes Informáticas', offering_code: 'redes-informaticas', selected_payment_plan: null, open_call_offer: null,
      accepted_call_offer: null, active_call: null, allowed_actions: ['offer_call'], last_call_result: null },
    catalog_resolution: { kind: 'no_catalog_intent' },
    catalog_index: null,
    deterministic_route: null,
    diagnostics: {
      timings: { claim_total_ms: 0, core_db_ms: 0, shared_embedding_ms: 0,
        memory_search_ms: 0, knowledge_search_ms: 0, business_snapshot_ms: 0 },
      counters: { embedding_calls: 0, memory_search_calls: 0, knowledge_search_calls: 0,
        business_snapshot_calls: 0, catalog_calls: 0 },
    },
    business_context_available: true,
    business_context: {
      as_of: '2026-08-13T00:00:00.000Z', prices_assertable: overrides.prices ?? true,
      workspace: { slug: 'studyx', display_name: 'StudyX', environment: 'sandbox', default_locale: 'es-AR',
        timezone: 'America/Argentina/Buenos_Aires', payment_options: [
          { code: 'monthly_12', label: '12 pagos', total: { amount: '360.00', currency: 'USD' },
            installments: 12, installment_amount: '30.00', payment_link: 'https://example.test/12' },
          { code: 'monthly_6', label: '6 pagos', total: { amount: '360.00', currency: 'USD' },
            installments: 6, installment_amount: '60.00', payment_link: 'https://example.test/6' },
          { code: 'one_time', label: 'Pago único', total: { amount: '360.00', currency: 'USD' },
            installments: 1, installment_amount: '360.00', payment_link: 'https://example.test/one' },
        ] }, offerings: [{
          code: 'redes-informaticas', display_name: 'Redes Informáticas', aliases: [], academy: 'Oficios',
          offering_type: 'course', description: null, value_proposition: null, price_type: 'fixed',
          price: { amount: '360.00', currency: 'USD' }, price_assertable: true,
          billing_interval: null, modality: null, schedules: [], certification: null,
          hours_per_month: null, classes: 16, modules: null, includes: [], syllabus_published: null,
          language: null, min_age: null,
          policies: { allowed_promise: null, forbidden_promises: [], price_message: null },
        }], qualification_fields: [], injection_suspected_count: 0, offerings_truncated: 0,
    },
    existing_result: null,
  } as ClaimedTurn;
}

describe('transaction fast paths', () => {
  it('closes a deferred sale politely without another call or payment push', () => {
    const decision = matchConversationCloseFastPath(claimed(
      'Buena info, gracias. Todavía no me voy a anotar, quería averiguar nomás.',
    ));

    expect(decision).toMatchObject({
      intent: 'commercial_decline',
      response_type: 'commercial_reply',
      business_action: null,
    });
    expect(decision?.response).not.toMatch(/llamada|pago|link/i);
  });

  it('acknowledges a temporary payment-link pause without opting the customer out', () => {
    const decision = matchConversationCloseFastPath(claimed(
      'No me mandes el link todavía, quiero pensarlo.',
    ));

    expect(decision).toMatchObject({
      intent: 'commercial_decline',
      response_type: 'commercial_reply',
      business_action: null,
    });
    expect(decision?.response).not.toMatch(/https?:\/\/|baja|desuscrip|\?/i);
  });

  it('acknowledges a call cancellation and continues by chat', () => {
    const decision = matchConversationCloseFastPath(claimed(
      'Uy no, mejor cancelá la llamada. Seguimos por acá.',
    ));

    expect(decision?.response).toMatch(/no avanzamos con la llamada.*seguimos por chat/i);
    expect(decision?.business_action).toBeNull();
    expect(decision).toMatchObject({
      reason_code: 'DETERMINISTIC_CALL_DECLINE_CONTINUE',
      next_state: 'waiting_user',
    });
  });

  it('does not collapse a call refusal that also asks a course fact', () => {
    expect(matchConversationCloseFastPath(claimed(
      'No quiero una llamada. ¿Cuántas clases tiene Redes Informáticas?',
    ))).toBeNull();
  });

  it('guides a minimal unique course mention toward a call or continued chat', () => {
    const turn = claimed('publicidad redes');
    turn.sales_context.course_of_interest = null;
    turn.business_context!.offerings[0].code = 'publicidad_redes';
    turn.business_context!.offerings[0].display_name = 'Publicidad en Redes Sociales';
    turn.business_context!.offerings[0].classes = 10;

    const decision = matchCourseDiscoveryFastPath(turn);

    expect(decision).toMatchObject({ response_type: 'call_offer', business_action: null });
    expect(decision?.response).toMatch(/Publicidad en Redes Sociales.*10 clases/i);
    expect(decision?.response).toMatch(/llamada ahora.*seguimos por chat/i);
  });

  it('resolves a course from the full name inside a longer customer sentence', () => {
    const turn = claimed('En realidad quiero cocinar para eventos. Mejor Introducción al Catering.');
    turn.sales_context.course_of_interest = null;
    turn.business_context!.offerings[0].display_name = 'Introducción al Catering';
    turn.business_context!.offerings[0].classes = 20;

    expect(matchCourseDiscoveryFastPath(turn)?.response).toMatch(/Introducción al Catering.*20 clases/i);
  });

  it('does not offer a call when the same message explicitly prefers text', () => {
    const turn = claimed('Quiero Excel Integral, pero no me gustan las llamadas; prefiero texto.');
    turn.business_context!.offerings[0].display_name = 'Excel Integral';

    const decision = matchCourseDiscoveryFastPath(turn);

    expect(decision?.response_type).toBe('commercial_reply');
    expect(decision?.response).not.toMatch(/llamada/i);
  });

  it('offers a call only when authorized and identifies our virtual advisor', () => {
    const authorized = claimed('Redes Informáticas');
    const unauthorized = claimed('Redes Informáticas');
    unauthorized.sales_context.allowed_actions = [];

    expect(matchCourseDiscoveryFastPath(authorized)).toMatchObject({
      response_type: 'call_offer',
      response: expect.stringMatching(/nuestra asesora virtual/i),
    });
    expect(matchCourseDiscoveryFastPath(unauthorized)).toMatchObject({
      response_type: 'commercial_reply',
    });
    expect(matchCourseDiscoveryFastPath(unauthorized)?.response).not.toMatch(/llamada|asesora/i);
  });

  it.each([
    ['Buena info, gracias.', 'Redes Informáticas'],
    ['¿Cuántas clases tiene el curso?', 'Fotografía con Celulares para Tiendas Online'],
    ['Confirmo definitivamente.', 'Instalación y Configuración de Cámaras de Seguridad'],
  ])('does not map an unrelated single fuzzy word to %s', (text, displayName) => {
    const turn = claimed(text);
    turn.sales_context.course_of_interest = null;
    turn.business_context!.offerings[0].display_name = displayName;

    expect(matchCourseDiscoveryFastPath(turn)).toBeNull();
  });

  it.each([
    ['confirmo 12 cuotas de 30 dólares', 'monthly_12'],
    ['me quedo con las 6 cuotas de 60', 'monthly_6'],
    ['confirmo pago único de 360 dólares', 'one_time'],
  ])('confirms an exact payment selection without sending a link yet: %s', (text, plan) => {
    const decision = matchPaymentSelectionFastPath(claimed(text));
    expect(DecisionSchema.parse(decision)).toMatchObject({
      business_action: null,
      reason_code: 'DETERMINISTIC_PAYMENT_SELECTION',
    });
    expect(decision?.response).toContain(plan === 'monthly_12'
      ? '12 cuotas'
      : plan === 'monthly_6' ? '6 cuotas' : 'pago único');
    expect(decision?.response).not.toMatch(/comparto|envío|acá.*link|https?:\/\//iu);
  });

  it('keeps the durable canonical offering code when two courses share a display name', () => {
    const turn = claimed('confirmo pago único y pasame el link');
    turn.sales_context.course_of_interest = 'Inglés Inicial';
    (turn.sales_context as typeof turn.sales_context & { offering_code: string | null })
      .offering_code = 'ingles_sur';
    const template = turn.business_context!.offerings[0];
    turn.business_context!.offerings = [
      { ...template, code: 'ingles_norte', display_name: 'Inglés Inicial', academy: 'Idiomas Norte' },
      { ...template, code: 'ingles_sur', display_name: 'Inglés Inicial', academy: 'Idiomas Sur' },
    ];

    expect(matchPaymentSelectionFastPath(turn)?.business_action).toMatchObject({
      type: 'send_payment_link',
      offering_sku: 'ingles_sur',
    });
  });

  it('does not send a link for an ambiguous or unavailable payment choice', () => {
    expect(matchPaymentSelectionFastPath(claimed('pasame el link'))).toBeNull();
    expect(matchPaymentSelectionFastPath(claimed('12 cuotas o pago único'))).toBeNull();
    expect(matchPaymentSelectionFastPath(claimed('confirmo 12 cuotas', { prices: false }))).toBeNull();
  });

  it('sends the link when the same turn explicitly chooses a plan and requests it', () => {
    expect(matchPaymentSelectionFastPath(
      claimed('Confirmo 12 cuotas y pasame el link'),
    )?.business_action).toMatchObject({
      type: 'send_payment_link',
      plan_code: 'monthly_12',
      offering_sku: 'redes-informaticas',
    });
  });

  it('sends the link from a durable selected plan when the customer asks on the next turn', () => {
    const turn = claimed('Ahora sí, pasame el link');
    turn.sales_context.selected_payment_plan = 'monthly_12';

    expect(matchPaymentSelectionFastPath(turn)?.business_action).toMatchObject({
      type: 'send_payment_link',
      plan_code: 'monthly_12',
      offering_sku: 'redes-informaticas',
    });
  });

  it('compares the short and long payment plans without prices, links, or selecting one', () => {
    const decision = matchPaymentComparisonFastPath(claimed(
      '¿Cuál es la diferencia entre el plan corto y el plan largo de pago?',
    ));

    expect(decision).toMatchObject({
      response_type: 'commercial_reply',
      reason_code: 'DETERMINISTIC_PAYMENT_COMPARISON',
      business_action: null,
    });
    expect(decision?.response).toMatch(/más cuotas.*cuota mensual más baja/i);
    expect(decision?.response).not.toMatch(/USD|\$|https?:\/\/|\b(?:6|12|30|60|360)\b/i);
  });

  it('answers a one-time-payment advantage question without inventing benefits', () => {
    const decision = matchPaymentComparisonFastPath(claimed(
      'Si pago de una, ¿hay alguna ventaja además de terminar antes?',
    ));

    expect(decision).toMatchObject({
      reason_code: 'DETERMINISTIC_PAYMENT_COMPARISON',
      business_action: null,
    });
    expect(decision?.response).toMatch(/no tengo confirmada una ventaja adicional/i);
    expect(decision?.response).not.toMatch(/inter[eé]s|acceso inmediato|descuento|https?:\/\//i);
  });

  it.each([
    'Confirmo 12 cuotas; no me mandes el link todavía.',
    'Confirmo 12 cuotas después.',
    'Solo consultaba por las 12 cuotas.',
    'Si comprara, elegiría 12 cuotas.',
  ])('does not emit a payment action for a deferred or hypothetical selection: %s', (text) => {
    expect(matchPaymentSelectionFastPath(claimed(text))).toBeNull();
  });

  it('acknowledges an identity already captured by the backend without echoing it', () => {
    const decision = matchContactCaptureFastPath(claimed(
      'Soy Bruno Aguilar, bruno@example.test.',
      { name: 'Bruno Aguilar' },
    ));
    expect(DecisionSchema.parse(decision).business_action).toBeNull();
    expect(decision?.response).not.toContain('Bruno');
    expect(decision?.response).not.toContain('bruno@example.test');
  });

  it('acknowledges captured identity even when the customer omits the word soy', () => {
    const decision = matchContactCaptureFastPath(claimed(
      'Bruno Aguilar, bruno@example.test.',
      { name: 'Bruno Aguilar' },
    ));

    expect(decision?.response).toMatch(/ya tengo tus datos/i);
    expect(decision?.response).not.toContain('bruno@example.test');
  });

  it('does not acknowledge uncaptured or non-identity text', () => {
    expect(matchContactCaptureFastPath(claimed('bruno@example.test'))).toBeNull();
    expect(matchContactCaptureFastPath(claimed('¿Cuántas clases?', { name: 'Bruno' }))).toBeNull();
  });

  it('answers class count and unknown prerequisites from structured facts without inventing them', () => {
    const decision = matchCourseFactsFastPath(claimed(
      '¿Cuántas clases tiene y qué necesito saber antes de empezar?',
    ));
    expect(DecisionSchema.parse(decision)).toMatchObject({
      response_type: 'commercial_reply',
      business_action: null,
      retrieval_used: { kb: false },
    });
    expect(decision?.response).toContain('16 clases');
    expect(decision?.response).toMatch(/requisitos[^.]*no están especificados/i);
    expect(decision?.response).not.toMatch(/computadora|internet|conocimientos básicos/i);
  });

  it('uses the closed canonical copy for a 34-class course and unknown certification', () => {
    const turn = claimed('¿Cuántas clases tiene y qué certificado entrega?');
    turn.sales_context.course_of_interest = 'Decoración de Interiores';
    turn.sales_context.offering_code = 'decoracion-interiores';
    turn.business_context!.offerings[0] = {
      ...turn.business_context!.offerings[0],
      code: 'decoracion-interiores',
      display_name: 'Decoración de Interiores',
      classes: 34,
      certification: null,
    };

    expect(matchCourseFactsFastPath(turn)?.response).toBe(
      'El curso de Decoración de Interiores tiene 34 clases. '
      + 'La certificación de Decoración de Interiores no está especificada en la información disponible. '
      + '¿Querés que revisemos otro dato?',
    );
  });

  it('renders at most two requested facts followed by one CTA', () => {
    const decision = matchCourseFactsFastPath(claimed(
      '¿Cuántas clases tiene, qué requisitos pide, qué devolución ofrece, quién emite el certificado y qué horarios hay?',
    ));
    const response = decision?.response ?? '';

    expect(response).toContain('16 clases');
    expect(response).toMatch(/requisitos[^.]*no están especificados/i);
    expect(response).not.toMatch(/devolución|reembolso|certificado|horarios publicados|horarios fijos/i);
    expect(response.match(/\?/gu) ?? []).toHaveLength(1);
  });

  it('uses a matching canonical knowledge chunk when the bounded offering window omitted the course', () => {
    const turn = claimed('¿Cuántas clases tiene?');
    turn.business_context!.offerings = [];
    turn.sales_context.course_of_interest = null;
    turn.context.recent_turns = [{
      direction: 'inbound',
      content: 'Quiero anotarme en Redes Informáticas.',
      created_at: '2026-08-13T00:00:00.000Z',
    }];
    turn.context.knowledge_base = [{
      source_uri: 'studyx://manual/redes',
      title: 'Manual StudyX — Redes Informáticas',
      content: 'Este diplomado cuenta con 16 clases, 8 exámenes parciales y 1 examen final.',
      similarity: 0.9,
    }];
    turn.context.knowledge_base_available = true;

    const decision = matchCourseFactsFastPath(turn);

    expect(decision?.response).toContain('16 clases');
    expect(decision?.retrieval_used).toMatchObject({ kb: true });
  });

  it('resolves the course from recent inbound history and the business snapshot', () => {
    const turn = claimed('¿Cuántas clases tiene?');
    turn.sales_context.course_of_interest = null;
    turn.context.recent_turns = [{
      direction: 'inbound', content: 'Quiero anotarme en Redes Informáticas.',
      created_at: '2026-08-13T00:00:00.000Z',
    }];

    const decision = matchCourseFactsFastPath(turn);

    expect(decision?.response).toContain('Redes Informáticas');
    expect(decision?.response).toContain('16 clases');
  });

  it('uses the most recently mentioned course after the customer changes direction', () => {
    const turn = claimed('Confirmame en cuál quedé y cuántas clases tiene.');
    turn.sales_context.course_of_interest = null;
    const catering = { ...turn.business_context!.offerings[0], code: 'catering',
      display_name: 'Introducción al Catering', classes: 20 };
    turn.business_context!.offerings.push(catering);
    turn.context.recent_turns = [
      { direction: 'inbound', content: 'Quiero Redes Informáticas.', created_at: '2026-08-13T00:00:00.000Z' },
      { direction: 'inbound', content: 'Mejor Introducción al Catering.', created_at: '2026-08-13T00:00:01.000Z' },
    ];

    expect(matchCourseFactsFastPath(turn)?.response).toMatch(/Introducción al Catering.*20 clases/i);
  });

  it('resolves a unique short alias from history for course facts', () => {
    const turn = claimed('¿Cuántas clases tiene y qué software necesito?');
    turn.sales_context.course_of_interest = null;
    turn.business_context!.offerings[0].code = 'autocad_interiores';
    turn.business_context!.offerings[0].display_name = 'AutoCAD orientado al Diseño de Interiores';
    turn.business_context!.offerings[0].classes = 11;
    turn.context.recent_turns = [{
      direction: 'inbound', content: 'Quiero saber todo sobre AutoCAD.',
      created_at: '2026-08-13T00:00:00.000Z',
    }];

    const decision = matchCourseFactsFastPath(turn);

    expect(decision?.response).toContain('AutoCAD orientado al Diseño de Interiores');
    expect(decision?.response).toContain('11 clases');
    expect(decision?.response).toMatch(/no están especificados/i);
  });

  it('answers a specific-or-generic question from the canonical course name', () => {
    const turn = claimed('¿Sirve para diseño de interiores específicamente o es genérico?');
    turn.sales_context.course_of_interest = 'AutoCAD';
    turn.business_context!.offerings[0].code = 'autocad_interiores';
    turn.business_context!.offerings[0].display_name = 'AutoCAD orientado al Diseño de Interiores';

    const decision = matchCourseFactsFastPath(turn);

    expect(decision?.response).toMatch(/orientado específicamente al diseño de interiores/i);
    expect(decision?.response).not.toMatch(/genérico general|sirve para todo/i);
  });

  it('does not intercept a turn that did not ask for a class count', () => {
    expect(matchCourseFactsFastPath(claimed('¿Qué salida laboral tiene?'))).toBeNull();
  });

  it('answers a prerequisites-only follow-up without inventing prior experience', () => {
    const decision = matchCourseFactsFastPath(claimed(
      '¿Se puede hacer sin haber usado nunca un programa de diseño?',
    ));

    expect(decision?.response).toMatch(/requisitos[^.]*no están especificados/i);
    expect(decision?.response).not.toMatch(/principiantes|sin experiencia|sí, se puede/i);
  });

  it('answers a price follow-up only from the assertable catalog snapshot', () => {
    const decision = matchCourseFactsFastPath(claimed('precio'));

    expect(decision?.response).toContain('USD 360');
    expect(decision?.response).toMatch(/12 cuotas, 6 cuotas o un pago único/i);
    expect(matchCourseFactsFastPath(claimed('precio', { prices: false }))).toBeNull();
  });

  it('guides a colloquial payment-options question without emitting a link', () => {
    const decision = matchCourseFactsFastPath(claimed('y komo pago? tngo poca plata'));

    expect(decision?.response).toMatch(/12 cuotas, 6 cuotas o un pago único/i);
    expect(decision?.business_action).toBeNull();
    expect(decision?.response).not.toMatch(/https?:\/\//i);
  });

  it('does not invent a refund or reimbursement policy', () => {
    const decision = matchCourseFactsFastPath(claimed(
      '¿Tienen política de devolución o garantía de reembolso si no me gusta?',
    ));

    expect(decision?.response).toMatch(/no está especificada.*información disponible/i);
    expect(decision?.response).not.toMatch(/garantizamos|te devolvemos|no contamos/i);
  });

  it('does not invent certificate validity, issuer or unstructured schedules', () => {
    const certificate = matchCourseFactsFastPath(claimed(
      '¿El certificado es válido y lo emite StudyX o otra entidad?',
    ));
    const schedule = matchCourseFactsFastPath(claimed(
      '¿Hay horarios fijos o puedo entrar cuando quiera?',
    ));

    expect(certificate?.response).toMatch(/certificación de Redes Informáticas no está especificada.*información disponible/i);
    expect(certificate?.response).not.toMatch(/válido oficialmente|lo emite StudyX/i);
    expect(schedule?.response).toMatch(/horarios fijos.*disponibilidad libre.*no están especificados/i);
    expect(schedule?.response).not.toMatch(/cuando quieras|24\/7|a tu ritmo/i);
  });
});
