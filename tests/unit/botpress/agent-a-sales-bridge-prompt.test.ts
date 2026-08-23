import { describe, expect, it } from 'vitest';

/**
 * Structural tests for the Agent A sales-bridge prompt builder.
 *
 * These tests do not call a model — they assert on the literal instructions
 * string, because that string IS the behavioral contract for a model that
 * cannot be unit-tested directly. Every assertion here maps to a spec rule:
 * answer before CTA, one question/CTA per turn, "asesora virtual" never a
 * human, allowed_actions gating for call proposals, catalog-only pricing
 * facts, and untrusted-context fencing. The final test locks out an obsolete
 * claim from the pre-sales-bridge prompt ("there is no human to escalate
 * to") that must not survive now that a call path exists.
 */
import {
  AGENT_A_PROMPT_VERSION,
  buildAgentASalesBridgeInstructions,
} from '../../../botpress-agent/src/prompts/agent-a-sales-bridge';
import type { ClaimedTurn } from '../../../botpress-agent/src/schemas/contracts';

const UUID = '18a823e8-27c2-4279-9956-058f45f33cd5';

const PRICE_BEARING_STUDYX_KNOWLEDGE = [
  {
    source_uri: 'studyx://policy/commercial-limits',
    title: 'Límites comerciales (T&C literales)',
    content:
      'El valor total es USD 360: 12 pagos mensuales de USD 30, 6 pagos mensuales de USD 60 o un pago único de USD 360.',
    similarity: 0.99,
  },
  {
    source_uri: 'studyx://sales/close',
    title: 'Beca StudyX y cierre',
    content:
      'Cuando elige una opción se comparte el link de Stripe. No ofrecer descuentos ni una cuarta opción de pago.',
    similarity: 0.95,
  },
  {
    source_uri: 'studyx://faq/fees',
    title: 'Preguntas frecuentes',
    content: 'El curso cuesta 360 dólares y se abona en 12 mensualidades, sin costo adicional.',
    similarity: 0.94,
  },
  {
    source_uri: 'https://buy.stripe.com/hidden-checkout',
    title: 'Continuidad académica',
    content: 'La inscripción continúa desde este recurso.',
    similarity: 0.93,
  },
];

const NON_COMMERCIAL_STUDYX_KNOWLEDGE = {
  source_uri: 'studyx://curriculum/interviews',
  title: 'Práctica de entrevistas',
  content: 'Incluye simulaciones y devolución pedagógica sobre las respuestas del alumno.',
  similarity: 0.92,
};

function claimedTurn(overrides: {
  texts?: string[];
  allowed?: string[];
  recentTurns?: Array<{ direction: 'inbound' | 'outbound'; content: string; created_at: string }>;
  salesContext?: Partial<ClaimedTurn['sales_context']>;
}): ClaimedTurn {
  const texts = overrides.texts ?? ['¿Cuánto sale el curso de Python?'];
  const allowed = overrides.allowed ?? [
    'social_reply',
    'commercial_reply',
    'clarification',
    'complaint_ack',
    'automation_only',
    'out_of_scope',
    'technical_fallback',
  ];
  return {
    outcome: 'claimed',
    trace_id: UUID,
    batch: {
      id: UUID,
      claim_token: UUID,
      conversation_id: UUID,
      contact_id: UUID,
      lease_until: '2026-08-16T00:00:10.000Z',
      hard_deadline_at: '2026-08-16T00:00:04.000Z',
      message_count: texts.length,
      stolen: false,
    },
    turn_id: UUID,
    policy: { may_respond: true, allowed_response_types: allowed, reason: null },
    contact: {
      id: UUID,
      status: 'prospecto',
      name: null,
      blocked: false,
      consent_status: 'allowed',
      opted_in_at: '2026-08-12T00:00:00.000Z',
    },
    context: {
      batch_messages: texts.map((text, index) => ({
        id: UUID,
        conversation_seq: index + 1,
        content: text,
        created_at: '2026-08-16T00:00:00.000Z',
        message_type: 'text',
      })),
      recent_turns: overrides.recentTurns ?? [],
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
      course_of_interest: null,
      open_call_offer: null,
      active_call: null,
      allowed_actions: ['offer_call'],
      last_call_result: null,
      ...overrides.salesContext,
    },
    existing_result: null,
  } as unknown as ClaimedTurn;
}

describe('AGENT_A_PROMPT_VERSION', () => {
  it('is the pinned sales-bridge version', () => {
    expect(AGENT_A_PROMPT_VERSION).toBe('studyx-agent-a-sales-v6');
  });
});

describe('buildAgentASalesBridgeInstructions', () => {
  it('requires memory values to stay literally grounded instead of renaming the course', () => {
    const instructions = buildAgentASalesBridgeInstructions(claimedTurn({}));

    expect(instructions).toMatch(
      /Do not\s+rename, canonicalize or enrich the value with words absent from that source_quote/,
    );
  });

  it('sends an explicitly selected payment link without inventing a profile form', () => {
    const instructions = buildAgentASalesBridgeInstructions(claimedTurn({}));

    expect(instructions).toContain('Never make sending the chosen link conditional on profile data');
    expect(instructions).toMatch(/If\s+qualification_fields is empty, ask for no profile fields/);
    expect(instructions).not.toContain('Ask for full name, email, city and ZIP code');
  });

  it('derives the sales identity from the fenced business snapshot, with no hardcoded brand', () => {
    const withBusiness = claimedTurn({});
    ;(withBusiness as { business_context?: unknown }).business_context = {
      as_of: '2026-08-16T00:00:00.000Z',
      prices_assertable: true,
      workspace: {
        slug: 'aburridont-english-it-sandbox',
        display_name: 'Aburridont — Inglés IT (Sandbox)',
        environment: 'sandbox',
        default_locale: 'es-AR',
        timezone: 'America/Argentina/Buenos_Aires',
      },
      offerings: [],
      qualification_fields: [],
      injection_suspected_count: 0,
      offerings_truncated: 0,
    }
    ;(withBusiness as { business_context_available?: boolean }).business_context_available = true
    const instructions = buildAgentASalesBridgeInstructions(withBusiness);
    expect(instructions).toContain('context.business_snapshot.workspace.display_name');
    expect(instructions.match(/Aburridont — Inglés IT \(Sandbox\)/g)).toHaveLength(1);
    expect(instructions).not.toContain('StudyX');

    const withoutBusiness = buildAgentASalesBridgeInstructions(claimedTurn({}));
    expect(withoutBusiness).not.toMatch(/StudyX|Aburridont/);
    expect(withoutBusiness).toContain('never invent one');
  });

  it('instructs Decision v4 with the call protocol invariants', () => {
    const instructions = buildAgentASalesBridgeInstructions(claimedTurn({}));
    expect(instructions).toContain('schema_version must be 4');
    expect(instructions).not.toContain('schema_version must be 3');
    // call_offer is side-effect free…
    expect(instructions).toMatch(/call_offer[\s\S]*(no side effect|nothing is dialed)/i);
    // …and call_confirmation ⇔ request_call_now as an inseparable pair.
    expect(instructions).toMatch(/call_confirmation[\s\S]*request_call_now[\s\S]*inseparable pair/i);
    expect(instructions).toMatch(/direct_request[\s\S]*accepted_offer/);
  });

  it('marks conversational declines with intent commercial_decline for the cooldown', () => {
    const instructions = buildAgentASalesBridgeInstructions(claimedTurn({}));
    expect(instructions).toContain('commercial_decline');
    expect(instructions).toMatch(/declines a call[\s\S]*commercial_decline/i);
  });

  it('continues the complete sales journey in WhatsApp after a call decline', () => {
    const instructions = buildAgentASalesBridgeInstructions(claimedTurn({}));
    expect(instructions).toMatch(/call decline[\s\S]*not a (sales|conversation) decline/i);
    expect(instructions).toMatch(/continue[\s\S]*(entire|complete)[\s\S]*(sales|commercial)[\s\S]*(WhatsApp|chat)/i);
    expect(instructions).toMatch(/answer[\s\S]*pending question/i);
    expect(instructions).toMatch(/qualification[\s\S]*payment link[\s\S]*WhatsApp/i);
  });

  it('distinguishes declining a call from opting out of WhatsApp messages', () => {
    const instructions = buildAgentASalesBridgeInstructions(claimedTurn({}));
    expect(instructions).toMatch(/declining (the |a )?call[\s\S]*(does not|is not)[\s\S]*opt[- ]out/i);
    expect(instructions).toMatch(/stop messaging|do not write|no me escribas/i);
  });

  it('honors a direct call request that arrives inside a multi-message burst', () => {
    const instructions = buildAgentASalesBridgeInstructions(claimedTurn({}));
    expect(instructions).toMatch(/direct call request[\s\S]*burst|burst[\s\S]*direct call request/i);
    expect(instructions).toMatch(/answer the rest of the batch in the same response/i);
  });

  it('treats qualification as conversational, never a prerequisite form', () => {
    const instructions = buildAgentASalesBridgeInstructions(claimedTurn({}));
    expect(instructions).toContain('business_snapshot.qualification_fields');
    expect(instructions).toMatch(/never as a prerequisite/i);
    expect(instructions).toMatch(/at most one per turn/i);
  });

  it('forbids naming a number for quote-priced offerings', () => {
    const instructions = buildAgentASalesBridgeInstructions(claimedTurn({}));
    expect(instructions).toMatch(/price_type "quote"[\s\S]*NEVER name a number/i);
  });

  it('requires answering the actual question before any call CTA', () => {
    const instructions = buildAgentASalesBridgeInstructions(claimedTurn({}));
    expect(instructions).toMatch(/answer(s)? .*before.*(call|cta)/i);
  });

  it('caps the response to at most one question or CTA, never a questionnaire', () => {
    const instructions = buildAgentASalesBridgeInstructions(claimedTurn({}));
    expect(instructions).toMatch(/at most one question or (call-to-action|cta)/i);
    expect(instructions).toMatch(/never .*(questionnaire|qualification questionnaire)/i);
  });

  it('says "asesora virtual" and forbids promising a human or a transfer', () => {
    const instructions = buildAgentASalesBridgeInstructions(claimedTurn({}));
    expect(instructions).toContain('asesora virtual');
    expect(instructions).toMatch(/never (say|promise|claim) .*(humano|human)/i);
  });

  it('gates any call proposal on sales_context.allowed_actions', () => {
    const instructions = buildAgentASalesBridgeInstructions(claimedTurn({}));
    expect(instructions).toContain('sales_context.allowed_actions');
    expect(instructions).toContain('offer_call');
    expect(instructions).toContain('request_call_now');
    expect(instructions).toMatch(/request_call_now.*only.*(allowed_actions|explicit consent)/i);
  });

  it('leaves the course optional for a direct call request', () => {
    const instructions = buildAgentASalesBridgeInstructions(claimedTurn({}));
    expect(instructions).toMatch(/course.*optional/i);
  });

  it('forbids asking for email, budget, country or availability before an immediate call unless essential', () => {
    const instructions = buildAgentASalesBridgeInstructions(claimedTurn({}));
    expect(instructions).toMatch(/email|budget|country|availability/i);
    expect(instructions).toMatch(/unless essential/i);
  });

  it('forbids re-asking data already present in context', () => {
    const instructions = buildAgentASalesBridgeInstructions(claimedTurn({}));
    expect(instructions).toMatch(/never re-ask|do not re-ask/i);
  });

  it('grounds prices, promotions, duration and certificates only in the structured catalog / knowledge base', () => {
    const instructions = buildAgentASalesBridgeInstructions(claimedTurn({}));
    expect(instructions).toMatch(/prices_assertable/);
    expect(instructions).toMatch(/never invent/i);
  });

  it('forbids claiming payment or acceptance without structured evidence', () => {
    const instructions = buildAgentASalesBridgeInstructions(claimedTurn({}));
    expect(instructions).toMatch(/payment|acceptance/i);
    expect(instructions).toMatch(/structured evidence/i);
  });

  it('limits memory candidates to literal safe facts with the backend type vocabulary', () => {
    const instructions = buildAgentASalesBridgeInstructions(claimedTurn({}));
    expect(instructions).toMatch(/memory_candidates.*\[\].*no literal safe fact/i);
    expect(instructions).toMatch(/source_quote[\s\S]*verbatim/i);
    for (const type of [
      'study_goal',
      'study_context',
      'preference',
      'constraint',
      'objection',
      'timeline',
      'contact_preference',
    ]) {
      expect(instructions).toContain(`${type} →`);
    }
    expect(instructions).toMatch(/declined call[\s\S]*contact_preference/i);
  });

  it('limits checkout structurally to the three configured payment plans without static prices', () => {
    const instructions = buildAgentASalesBridgeInstructions(claimedTurn({}));
    expect(instructions).toMatch(/three canonical configured (payment )?options/i);
    expect(instructions).not.toMatch(/USD\s*(?:360|30|60)|(?:360|30|60)\.00/i);
    expect(instructions).toMatch(/never (invent|offer).*(fourth|another|different).*option/i);
    expect(instructions).toMatch(/ONLY after the customer explicitly chooses/i);
    expect(instructions).toMatch(/exactly one.*payment link|one.*payment link/i);
    expect(instructions).toMatch(/Apple Pay/i);
  });

  it('enforces the supplied WhatsApp sales behavior without claiming a payment from a screenshot', () => {
    const instructions = buildAgentASalesBridgeInstructions(claimedTurn({}));
    expect(instructions).toMatch(/one diagnostic question/i);
    expect(instructions).toMatch(/One idea per message, maximum 3-4 short lines/i);
    expect(instructions).toMatch(/never.*AI.*bot|AI.*bot.*never/i);
    expect(instructions).toMatch(/choice.?based close|close.*by choice/i);
    expect(instructions).toContain('screenshot can be acknowledged as received, but it is NOT payment');
    expect(instructions).toContain('Only a verified Stripe webhook is');
  });

  it('fences the untrusted context with explicit markers', () => {
    const instructions = buildAgentASalesBridgeInstructions(claimedTurn({}));
    expect(instructions).toContain('UNTRUSTED_CONTEXT_START');
    expect(instructions).toContain('UNTRUSTED_CONTEXT_END');
    const start = instructions.indexOf('UNTRUSTED_CONTEXT_START');
    const end = instructions.indexOf('UNTRUSTED_CONTEXT_END');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
  });

  it('embeds sales_context inside the fenced payload so the model can see allowed_actions', () => {
    const instructions = buildAgentASalesBridgeInstructions(
      claimedTurn({ salesContext: { mode: 'awaiting_call_consent', allowed_actions: ['offer_call'] } }),
    );
    const start = instructions.indexOf('UNTRUSTED_CONTEXT_START');
    const end = instructions.indexOf('UNTRUSTED_CONTEXT_END');
    const fenced = instructions.slice(start, end);
    const payload = JSON.parse(fenced.split('\n').slice(1, -1).join('\n'));
    expect(payload.sales_context.mode).toBe('awaiting_call_consent');
    expect(payload.sales_context.allowed_actions).toEqual(['offer_call']);
  });

  it('projects one compact business snapshot inside the fence with no catalog/offerings duplicate', () => {
    const businessContext = {
      as_of: '2026-08-16T00:00:00.000Z',
      prices_assertable: true,
      workspace: {
        slug: 'aburridont-english-it-sandbox',
        display_name: 'Aburridont — Inglés IT (Sandbox)',
        environment: 'sandbox',
        default_locale: 'es-AR',
        timezone: 'America/Argentina/Buenos_Aires',
        payment_options: [],
      },
      offerings: [
        {
          code: 'group_it_english',
          display_name: 'Plan Grupal IT',
          offering_type: 'course',
          description: null,
          value_proposition: null,
          price_type: 'fixed',
          price: { amount: '85000.00', currency: 'ARS' },
          price_assertable: true,
          billing_interval: 'monthly',
          modality: 'video_hibrido_unico',
          schedules: [{ days: ['tuesday', 'thursday'], start: '21:00', end: null, timezone: null }],
          certification: true,
          hours_per_month: 8,
          classes: 38,
          modules: 5,
          includes: ['prácticas'],
          syllabus_published: true,
          language: 'Spanish',
          min_age: 18,
          policies: { allowed_promise: null, forbidden_promises: [], price_message: null },
        },
      ],
      qualification_fields: [],
      injection_suspected_count: 0,
      offerings_truncated: 0,
    };
    const claimed = claimedTurn({});
    ;(claimed as { business_context?: unknown }).business_context = businessContext
    ;(claimed as { business_context_available?: boolean }).business_context_available = true

    const instructions = buildAgentASalesBridgeInstructions(claimed);
    const start = instructions.indexOf('UNTRUSTED_CONTEXT_START');
    const end = instructions.indexOf('UNTRUSTED_CONTEXT_END');
    const fenced = instructions.slice(start, end);
    const payload = JSON.parse(fenced.split('\n').slice(1, -1).join('\n'));
    expect(payload.business_snapshot.workspace.display_name).toBe('Aburridont — Inglés IT (Sandbox)');
    expect(payload.business_snapshot.as_of).toBe('2026-08-16T00:00:00.000Z');
    expect(payload.business_snapshot.prices_assertable).toBe(true);
    expect(payload.business_snapshot.offerings_truncated).toBe(0);
    expect(payload.business_snapshot.offerings[0].price).toEqual({ amount: '85000.00', currency: 'ARS' });
    expect(payload.business_snapshot_available).toBe(true);
    expect(payload).not.toHaveProperty('catalog');
    expect(payload).not.toHaveProperty('business_context');
    // Dynamic business content must not leak outside the fence.
    expect(instructions.slice(0, start)).not.toContain('85000.00');
    expect(instructions.match(/Aburridont — Inglés IT \(Sandbox\)/g)).toHaveLength(1);
    expect(instructions.match(/85000\.00/g)).toHaveLength(1);
    expect(instructions.match(/video_hibrido_unico/g)).toHaveLength(1);
  });

  it('projects each StudyX commercial value exactly once from the fenced snapshot', () => {
    const claimed = claimedTurn({});
    claimed.context.knowledge_base = [
      ...PRICE_BEARING_STUDYX_KNOWLEDGE,
      NON_COMMERCIAL_STUDYX_KNOWLEDGE,
    ];
    claimed.context.knowledge_base_available = true;
    ;(claimed as { business_context?: unknown }).business_context = {
      as_of: '2026-08-21T15:00:00.000Z',
      prices_assertable: true,
      workspace: {
        slug: 'studyx-production',
        display_name: 'StudyX',
        environment: 'production',
        default_locale: 'es-AR',
        timezone: 'America/Argentina/Buenos_Aires',
        payment_options: [
          {
            code: 'monthly_12',
            label: '12 pagos mensuales de USD 30 (total USD 360)',
            total: { amount: '360.00', currency: 'USD' },
            installments: 12,
            installment_amount: '30.00',
            payment_link: 'https://buy.stripe.com/studyx-12',
          },
          {
            code: 'monthly_6',
            label: '6 pagos mensuales de USD 60 (total USD 360)',
            total: { amount: '360.00', currency: 'USD' },
            installments: 6,
            installment_amount: '60.00',
            payment_link: 'https://buy.stripe.com/studyx-6',
          },
          {
            code: 'one_time',
            label: 'Pago único de USD 360',
            total: { amount: '360.00', currency: 'USD' },
            installments: 1,
            installment_amount: '360.00',
            payment_link: 'https://buy.stripe.com/studyx-once',
          },
        ],
      },
      offerings: [
        {
          code: 'studyx_course',
          display_name: 'Curso StudyX',
          offering_type: 'course',
          description: 'Curso completo.',
          value_proposition: null,
          price_type: 'fixed',
          price: { amount: '360.00', currency: 'USD' },
          price_assertable: true,
          billing_interval: null,
          modality: 'online',
          schedules: [],
          certification: true,
          hours_per_month: null,
          classes: null,
          modules: null,
          includes: [],
          syllabus_published: true,
          language: 'Spanish',
          min_age: null,
          policies: {
            allowed_promise: 'Acceso al curso según los términos configurados.',
            forbidden_promises: [],
            price_message:
              'Precio total USD 360: 12 pagos de USD 30, 6 pagos de USD 60 o pago único de USD 360.',
          },
        },
      ],
      qualification_fields: [],
      injection_suspected_count: 0,
      offerings_truncated: 0,
    }
    ;(claimed as { business_context_available?: boolean }).business_context_available = true

    const instructions = buildAgentASalesBridgeInstructions(claimed);
    const start = instructions.indexOf('UNTRUSTED_CONTEXT_START');
    const end = instructions.indexOf('UNTRUSTED_CONTEXT_END');
    const staticInstructions = instructions.slice(0, start);
    const fenced = instructions.slice(start, end);
    const payload = JSON.parse(fenced.split('\n').slice(1, -1).join('\n'));

    expect(staticInstructions).not.toMatch(/USD\s*(?:360|30|60)|(?:360|30|60)\.00/i);
    expect(fenced.match(/360\.00/g)).toHaveLength(1);
    expect(fenced.match(/(?<!\d)30\.00(?!\d)/g)).toHaveLength(1);
    expect(fenced.match(/(?<!\d)60\.00(?!\d)/g)).toHaveLength(1);
    expect(fenced.match(/https:\/\/buy\.stripe\.com\/studyx-/g)).toHaveLength(3);
    expect(fenced).not.toContain('USD 360');
    expect(fenced).not.toContain('studyx://policy/commercial-limits');
    expect(fenced).not.toContain('studyx://sales/close');
    expect(fenced).not.toContain('hidden-checkout');
    expect(fenced).not.toContain('cuesta 360 dólares');
    expect(fenced).not.toContain('price_message');
    expect(fenced).not.toContain('Precio total USD 360');
    expect(payload.knowledge_base).toEqual([
      {
        title: NON_COMMERCIAL_STUDYX_KNOWLEDGE.title,
        content: NON_COMMERCIAL_STUDYX_KNOWLEDGE.content,
        similarity: NON_COMMERCIAL_STUDYX_KNOWLEDGE.similarity,
      },
    ]);
    expect(payload.knowledge_base_commercial_items_dropped).toBe(4);
    expect(staticInstructions).not.toMatch(
      /pricing[\s\S]{0,120}(?:context\.)?knowledge_base/i,
    );
  });

  it('degrades the one business snapshot to prices_assertable=false when unavailable', () => {
    const claimed = claimedTurn({});
    // Even a contradictory transport flag must fail closed when the snapshot
    // itself is absent.
    ;(claimed as { business_context_available?: boolean }).business_context_available = true
    const instructions = buildAgentASalesBridgeInstructions(claimed);
    const start = instructions.indexOf('UNTRUSTED_CONTEXT_START');
    const end = instructions.indexOf('UNTRUSTED_CONTEXT_END');
    const fenced = instructions.slice(start, end);
    const payload = JSON.parse(fenced.split('\n').slice(1, -1).join('\n'));
    expect(payload.business_snapshot).toEqual({
      as_of: null,
      prices_assertable: false,
      offerings_truncated: 0,
      workspace: null,
      offerings: [],
      qualification_fields: [],
    });
    expect(payload.business_snapshot_available).toBe(false);
    expect(instructions).not.toMatch(/USD\s*(?:360|30|60)|(?:360|30|60)\.00/i);
  });

  it('removes all price amounts and payment links when the snapshot is not assertable', () => {
    const claimed = claimedTurn({});
    claimed.context.knowledge_base = PRICE_BEARING_STUDYX_KNOWLEDGE;
    claimed.context.knowledge_base_available = true;
    ;(claimed as { business_context?: unknown }).business_context = {
      as_of: '2026-08-21T15:00:00.000Z',
      prices_assertable: false,
      workspace: {
        slug: 'studyx-production',
        display_name: 'StudyX',
        environment: 'production',
        default_locale: 'es-AR',
        timezone: 'America/Argentina/Buenos_Aires',
        payment_options: [
          {
            code: 'monthly_12',
            label: '12 pagos de USD 30',
            total: { amount: '360.00', currency: 'USD' },
            installments: 12,
            installment_amount: '30.00',
            payment_link: 'https://buy.stripe.com/should-not-leak',
          },
        ],
      },
      offerings: [
        {
          code: 'studyx_course',
          display_name: 'Curso StudyX',
          offering_type: 'course',
          description: null,
          value_proposition: null,
          price_type: 'fixed',
          price: { amount: '360.00', currency: 'USD' },
          price_assertable: true,
          billing_interval: null,
          modality: 'online',
          schedules: [],
          certification: null,
          hours_per_month: null,
          classes: null,
          modules: null,
          includes: [],
          syllabus_published: null,
          language: null,
          min_age: null,
          policies: {
            allowed_promise: null,
            forbidden_promises: [],
            price_message: 'Precio USD 360 o cuotas de USD 30.',
          },
        },
      ],
      qualification_fields: [],
      injection_suspected_count: 0,
      offerings_truncated: 0,
    }
    ;(claimed as { business_context_available?: boolean }).business_context_available = true

    const instructions = buildAgentASalesBridgeInstructions(claimed);
    const start = instructions.indexOf('UNTRUSTED_CONTEXT_START');
    const end = instructions.indexOf('UNTRUSTED_CONTEXT_END');
    const payload = JSON.parse(instructions.slice(start, end).split('\n').slice(1, -1).join('\n'));

    expect(payload.business_snapshot.prices_assertable).toBe(false);
    expect(payload.business_snapshot.workspace.payment_options).toEqual([]);
    expect(payload.business_snapshot.offerings[0].price).toBeNull();
    expect(payload.business_snapshot.offerings[0].price_assertable).toBe(false);
    expect(instructions).not.toMatch(/USD\s*(?:360|30|60)|(?:360|30|60)\.00/i);
    expect(instructions).not.toContain('https://buy.stripe.com/should-not-leak');
    expect(instructions).toMatch(
      /prices_assertable is false[\s\S]*never (quote|name)[\s\S]*price[\s\S]*payment link/i,
    );
  });

  it('defensively removes current batch messages from recent turns before fencing', () => {
    const duplicate = {
      direction: 'inbound' as const,
      content: '¿Cuánto sale el curso de Python?',
      created_at: '2026-08-16T00:00:00.000Z',
    };
    const instructions = buildAgentASalesBridgeInstructions(claimedTurn({ recentTurns: [duplicate] }));
    const start = instructions.indexOf('UNTRUSTED_CONTEXT_START');
    const end = instructions.indexOf('UNTRUSTED_CONTEXT_END');
    const payload = JSON.parse(instructions.slice(start, end).split('\n').slice(1, -1).join('\n'));
    expect(payload.batch_messages).toHaveLength(1);
    expect(payload.recent_turns).toEqual([]);
  });

  it('bounds recent_turns to the last 10 entries, each capped at 280 characters', () => {
    const recentTurns = Array.from({ length: 15 }, (_, i) => ({
      direction: (i % 2 === 0 ? 'inbound' : 'outbound') as 'inbound' | 'outbound',
      content: i === 14 ? 'x'.repeat(400) : `turn ${i}`,
      created_at: '2026-08-16T00:00:00.000Z',
    }));
    const instructions = buildAgentASalesBridgeInstructions(claimedTurn({ recentTurns }));
    const start = instructions.indexOf('UNTRUSTED_CONTEXT_START');
    const end = instructions.indexOf('UNTRUSTED_CONTEXT_END');
    const fenced = instructions.slice(start, end);
    const payload = JSON.parse(fenced.split('\n').slice(1, -1).join('\n'));
    expect(payload.recent_turns).toHaveLength(10);
    const lastTurn = payload.recent_turns[payload.recent_turns.length - 1];
    expect(lastTurn.content.length).toBeLessThanOrEqual(281); // 280 chars + ellipsis
    expect(lastTurn.content.endsWith('…')).toBe(true);
  });

  it('does NOT contain the obsolete claim that no call path exists', () => {
    const instructions = buildAgentASalesBridgeInstructions(claimedTurn({}));
    expect(instructions).not.toMatch(/there is no human to escalate to/i);
    expect(instructions).not.toMatch(/no (call|voice) (path|feature) exists/i);
  });

  it('defines a deterministic priority order for conflicting customer signals', () => {
    const instructions = buildAgentASalesBridgeInstructions(claimedTurn({}));
    expect(instructions).toMatch(/priority order|orden de prioridad/i);
    expect(instructions).toMatch(
      /opt[- ]out[\s\S]*(complaint|reclamo)[\s\S]*(direct call|pedido directo de llamada)[\s\S]*(call decline|rechazo de llamada)[\s\S]*(commercial|consulta comercial)/i,
    );
  });

  it('treats the current customer correction as newer than stale memory without changing canonical business facts', () => {
    const instructions = buildAgentASalesBridgeInstructions(claimedTurn({}));
    expect(instructions).toMatch(/current batch|lote actual/i);
    expect(instructions).toMatch(/correction|corrige|correcci[oó]n/i);
    expect(instructions).toMatch(/older|anterior|vieja|stale/i);
    expect(instructions).toMatch(/canonical business|hechos can[oó]nicos del negocio/i);
  });

  it('gives a concise objection-handling sequence without inventing concessions', () => {
    const instructions = buildAgentASalesBridgeInstructions(claimedTurn({}));
    expect(instructions).toMatch(/objection|objeci[oó]n/i);
    expect(instructions).toMatch(/acknowledge|reconoc[eé]/i);
    expect(instructions).toMatch(/grounded|fundamentad/i);
    expect(instructions).toMatch(/discount|descuento/i);
    expect(instructions).toMatch(/next step|siguiente paso/i);
  });

  it('clarifies an ambiguous payment-link request instead of choosing a plan', () => {
    const instructions = buildAgentASalesBridgeInstructions(claimedTurn({}));
    expect(instructions).toMatch(/ambiguous|ambiguo/i);
    expect(instructions).toMatch(/payment link|enlace de pago/i);
    expect(instructions).toMatch(/clarif|which option|qu[eé] opci[oó]n/i);
    expect(instructions).toMatch(/never choose|no elijas|no elegir/i);
  });

  it('forbids the model from ever writing, pasting or typing a payment URL itself', () => {
    const instructions = buildAgentASalesBridgeInstructions(claimedTurn({}));
    expect(instructions).toMatch(/never write, paste, or type a payment url/i);
    expect(instructions).toMatch(/never (?:be )?free text/i);
  });

  it('sends the payment link only via the typed send_payment_link business_action, never as prose', () => {
    const instructions = buildAgentASalesBridgeInstructions(claimedTurn({}));
    expect(instructions).toMatch(/"type":"send_payment_link"/);
    expect(instructions).toMatch(/"plan_code"/);
    expect(instructions).toMatch(/"offering_sku"/);
    expect(instructions).toMatch(/backend appends exactly\s+one payment link/i);
    expect(instructions).toContain('send_payment_link","plan_code":c,"offering_sku":s|null');
  });

  it('handles an unverified paid claim without confirming access or automatically resending checkout', () => {
    const instructions = buildAgentASalesBridgeInstructions(claimedTurn({}));
    expect(instructions).toMatch(/already paid|ya pag[oó]|dice que pag[oó]/i);
    expect(instructions).toMatch(/pending verification|pendiente de verificaci[oó]n/i);
    expect(instructions).toMatch(/do not resend|no reenv[ií]es|no volver a enviar/i);
    expect(instructions).toMatch(
      /unless (?:the customer|they)(?: explicitly)? asks|salvo que (?:el cliente|lo) pida/i,
    );
  });
});
