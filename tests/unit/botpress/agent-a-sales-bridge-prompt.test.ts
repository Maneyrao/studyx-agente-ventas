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
  AGENT_A_SALES_PLAYBOOK_V16,
  buildAgentASalesBridgeCompactInstructions,
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
    expect(AGENT_A_PROMPT_VERSION).toBe('studyx-agent-a-sales-v17');
  });
});

// v11 additions (informe 2026-08-23): refund fail-closed, identity
// registration honesty, canonical offering_sku for the operator sheet.
describe('v11 hard rules', () => {
  it('forbids affirming or denying a refund policy and derives to inscripciones', () => {
    const instructions = buildAgentASalesBridgeInstructions(claimedTurn({}));
    expect(instructions).toMatch(/NEVER affirm NOR deny that a refund\/return\/guarantee/);
    expect(instructions).toMatch(/equipo de inscripciones/);
  });

  it('forbids echoing the customer email and gates registration claims on contact.name', () => {
    const instructions = buildAgentASalesBridgeInstructions(claimedTurn({}));
    expect(instructions).toMatch(/NEVER write the customer's email address inside\s+any response/);
    expect(instructions).toMatch(/registered ONLY when context\.contact\.name is\s+present/);
  });

  it('keeps canonical offering authorization out of the model prompt', () => {
    const instructions = buildAgentASalesBridgeInstructions(claimedTurn({}));
    expect(instructions).toMatch(/backend decides and authorizes course identity/i);
    expect(instructions).not.toContain('offering_sku');
  });
});

describe('buildAgentASalesBridgeInstructions', () => {
  it('includes the v16 commercial process in both prompt builders', () => {
    const instructions = buildAgentASalesBridgeInstructions(claimedTurn({}));
    const compactInstructions = buildAgentASalesBridgeCompactInstructions(claimedTurn({}));
    for (const instruction of [
      'responder primero', 'una sola pregunta', 'recomendar entre una y tres',
      'backend maneja cualquier llamada', 'continuar y completar por chat',
      'resolver la objeción', 'cerrar por elección', 'decide exclusivamente el backend',
    ]) expect(instructions.toLowerCase()).toContain(instruction);
    expect(compactInstructions).toContain('SALES_PLAYBOOK_V16');
    expect(AGENT_A_SALES_PLAYBOOK_V16).toContain('SALES_PLAYBOOK_V16');
  });
  it('requires memory values to stay literally grounded instead of renaming the course', () => {
    const instructions = buildAgentASalesBridgeInstructions(claimedTurn({}));

    expect(instructions).toMatch(
      /Do not\s+rename, canonicalize or enrich the value with words absent from that source_quote/,
    );
  });

  it('leaves payment execution to the backend without inventing a profile form', () => {
    const instructions = buildAgentASalesBridgeInstructions(claimedTurn({}));

    expect(instructions).toContain('Never make the next step conditional on profile data');
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

  it('instructs Decision v4 as an advisory-only model contract', () => {
    const instructions = buildAgentASalesBridgeInstructions(claimedTurn({}));
    expect(instructions).toContain('schema_version must be 4');
    expect(instructions).not.toContain('schema_version must be 3');
    expect(instructions).toMatch(/business_action must be null on every model response/i);
    expect(instructions).toMatch(/Never use call_offer or call_confirmation/i);
    expect(instructions).toMatch(/backend decides and authorizes/i);
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

  it('leaves every direct call request to the deterministic backend route', () => {
    const instructions = buildAgentASalesBridgeInstructions(claimedTurn({}));
    expect(instructions).toMatch(/Direct call requests[\s\S]*handled deterministically/i);
    expect(instructions).toMatch(/Never claim a call is being placed/i);
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

  it('guides a broad catalog question by academy instead of dumping every course', () => {
    const instructions = buildAgentASalesBridgeInstructions(claimedTurn({}));
    expect(instructions).toMatch(/Catalog navigation is consultative, never a dump/i);
    expect(instructions).toMatch(/does NOT ask for every course name/i);
    expect(instructions).toMatch(/academy\/area values/i);
    expect(instructions).toMatch(/Do not list individual courses in this first answer/i);
    expect(instructions).toMatch(/at most\s+THREE grounded courses/i);
    expect(instructions).not.toMatch(/list every offering present/i);
  });

  it('includes the grounded class count when recommending a named course', () => {
    const instructions = buildAgentASalesBridgeInstructions(claimedTurn({}));
    expect(instructions).toMatch(
      /when recommending a specific named course[\s\S]*include its structured classes count/i,
    );
  });

  it('puts the canonical academy beside each offering in the fenced snapshot', () => {
    const claimed = claimedTurn({});
    ;(claimed as { business_context?: unknown }).business_context = {
      as_of: '2026-08-23T00:00:00.000Z',
      prices_assertable: true,
      workspace: {
        slug: 'studyx-production', display_name: 'StudyX', environment: 'production',
        default_locale: 'es-AR', timezone: 'America/Argentina/Buenos_Aires', payment_options: [],
      },
      offerings: [{
        code: 'marketing_digital', display_name: 'Marketing Digital', academy: 'Academia de Marketing',
        offering_type: 'course', description: null, value_proposition: null, price_type: 'fixed',
        price: { amount: '360.00', currency: 'USD' }, price_assertable: true, billing_interval: 'custom',
        modality: 'online', schedules: [], certification: null, hours_per_month: null, classes: 16,
        modules: null, includes: [], syllabus_published: true, language: 'Spanish', min_age: 18,
        policies: { allowed_promise: null, forbidden_promises: [], price_message: null },
      }],
      qualification_fields: [], injection_suspected_count: 0, offerings_truncated: 0,
    };
    ;(claimed as { business_context_available?: boolean }).business_context_available = true;

    const instructions = buildAgentASalesBridgeInstructions(claimed);
    const start = instructions.indexOf('UNTRUSTED_CONTEXT_START');
    const end = instructions.indexOf('UNTRUSTED_CONTEXT_END');
    const payload = JSON.parse(instructions.slice(start, end).split('\n').slice(1, -1).join('\n'));
    expect(payload.business_snapshot.offerings[0].academy).toBe('Academia de Marketing');
  });

  it('keeps call decisions in the backend while preserving chat sales', () => {
    const instructions = buildAgentASalesBridgeInstructions(claimedTurn({}));
    expect(instructions).toMatch(/backend owns the call lifecycle/i);
    expect(instructions).toMatch(/continue answering in writing/i);
    expect(instructions).toMatch(/business_action null/i);
  });

  it('caps the response to at most one question or CTA, never a questionnaire', () => {
    const instructions = buildAgentASalesBridgeInstructions(claimedTurn({}));
    expect(instructions).toMatch(/at most one question or (call-to-action|cta)/i);
    expect(instructions).toMatch(/never[\s\S]{0,80}(questionnaire|qualification questionnaire)/i);
  });

  it('forbids the advisory model from promising a human, transfer or call outcome', () => {
    const instructions = buildAgentASalesBridgeInstructions(claimedTurn({}));
    expect(instructions).toMatch(/Never promise a human transfer or a call outcome/i);
  });

  it('forbids any model-authored call proposal regardless of allowed_actions', () => {
    const instructions = buildAgentASalesBridgeInstructions(claimedTurn({}));
    expect(instructions).toContain('request_call_now');
    expect(instructions).toMatch(/Never emit call_offer, call_confirmation or request_call_now/i);
  });

  it('does not turn course collection into a prerequisite for answering', () => {
    const instructions = buildAgentASalesBridgeInstructions(claimedTurn({}));
    expect(instructions).toMatch(/NEVER as a prerequisite before answering a question/i);
  });

  it('forbids inventing identity or profile requirements before the next step', () => {
    const instructions = buildAgentASalesBridgeInstructions(claimedTurn({}));
    expect(instructions).toMatch(/Never invent a\s+requirement for name, email, phone, city, ZIP code, country or budget/i);
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
    expect(instructions).toMatch(/backend decides whether course and plan are explicit enough/i);
    expect(instructions).toMatch(/Never claim a link was sent/i);
    expect(instructions).toMatch(/Apple Pay/i);
  });

  it('never repeats a payment action from history when the current batch only supplies profile data', () => {
    const instructions = buildAgentASalesBridgeInstructions(claimedTurn({}));
    expect(instructions).toMatch(/Never infer an executable payment action from recent_turns/i);
  });

  it('enforces the supplied WhatsApp sales behavior without claiming a payment from a screenshot', () => {
    const instructions = buildAgentASalesBridgeInstructions(claimedTurn({}));
    expect(instructions).toMatch(/one diagnostic question/i);
    expect(instructions).toMatch(/One idea per message, maximum 3-4 short lines/i);
    expect(instructions).toMatch(/never[\s\S]{0,100}AI, bot|AI, bot[\s\S]{0,100}never/i);
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

  it('keeps a 40-course catalog below the direct-provider request budget', () => {
    const claimed = claimedTurn({ texts: ['¿Qué cursos tienen disponibles?'] });
    ;(claimed as { business_context?: unknown }).business_context = {
      as_of: '2026-08-24T00:00:00.000Z',
      prices_assertable: true,
      workspace: {
        slug: 'studyx', display_name: 'StudyX', environment: 'sandbox',
        default_locale: 'es-AR', timezone: 'America/Argentina/Buenos_Aires',
        payment_options: [],
      },
      offerings: Array.from({ length: 40 }, (_, index) => ({
        code: `course_${index}`,
        display_name: `Curso ${index}`,
        academy: `Academia ${index % 5}`,
        offering_type: 'course',
        description: `Descripción pedagógica extensa ${index} `.repeat(12),
        value_proposition: `Propuesta de valor extensa ${index} `.repeat(8),
        price_type: 'fixed',
        price: { amount: '360.00', currency: 'USD' },
        price_assertable: true,
        billing_interval: null,
        modality: 'online',
        schedules: [],
        certification: true,
        hours_per_month: null,
        classes: 16,
        modules: 4,
        includes: ['material', 'acompañamiento'],
        syllabus_published: true,
        language: 'Spanish',
        min_age: null,
        policies: {
          allowed_promise: 'Acceso según los términos configurados.',
          forbidden_promises: ['No garantizar resultados laborales.'],
          price_message: null,
        },
      })),
      qualification_fields: [],
      injection_suspected_count: 0,
      offerings_truncated: 42,
    };
    ;(claimed as { business_context_available?: boolean }).business_context_available = true;

    const instructions = buildAgentASalesBridgeInstructions(claimed);

    expect(instructions.length).toBeLessThan(38_000);
    expect(instructions).not.toContain('Descripción pedagógica extensa');
    expect(instructions).toContain('"academy":"Academia 0"');
    expect(instructions).not.toContain('"classes":16');
  });

  it('projects the complete compact index while retaining detail only for a course resolved past the old detail cap', () => {
    const claimed = claimedTurn({
      texts: ['Quiero Curso 41'],
      salesContext: { offering_code: 'course_41', course_of_interest: 'Curso 41' },
    });
    ;(claimed as { business_context?: unknown }).business_context = {
      as_of: '2026-08-24T00:00:00.000Z', prices_assertable: true,
      workspace: { slug: 'studyx', display_name: 'StudyX', environment: 'sandbox', default_locale: 'es-AR', timezone: 'America/Argentina/Buenos_Aires', payment_options: [] },
      offerings: [{
        code: 'course_41', display_name: 'Curso 41', aliases: [], academy: 'Academia 1',
        offering_type: 'course', description: null, value_proposition: null, price_type: 'fixed',
        price: { amount: '360.00', currency: 'USD' }, price_assertable: true, billing_interval: null,
        modality: 'online', schedules: [], certification: true, hours_per_month: null, classes: 16,
        modules: 4, includes: [], syllabus_published: true, language: null, min_age: null,
        policies: { allowed_promise: null, forbidden_promises: [], price_message: null },
      }], qualification_fields: [], injection_suspected_count: 0, offerings_truncated: 1,
    };
    ;(claimed as { business_context_available?: boolean }).business_context_available = true;
    ;(claimed as { catalog_index?: unknown }).catalog_index = {
      as_of: '2026-08-24T00:00:00.000Z', offerings_total: 41,
      offerings: Array.from({ length: 41 }, (_, index) => ({
        code: `course_${index + 1}`, display_name: `Curso ${index + 1}`,
        academy: `Academia ${(index + 1) % 5}`, aliases: [],
      })), injection_suspected_count: 0,
    };

    const instructions = buildAgentASalesBridgeInstructions(claimed);
    const start = instructions.indexOf('UNTRUSTED_CONTEXT_START');
    const end = instructions.indexOf('UNTRUSTED_CONTEXT_END');
    const payload = JSON.parse(instructions.slice(start, end).split('\n').slice(1, -1).join('\n'));
    const offerings = payload.business_snapshot.offerings;

    expect(offerings).toHaveLength(41);
    expect(offerings.find((offering: { code: string }) => offering.code === 'course_1')).toEqual({
      code: 'course_1', display_name: 'Curso 1', academy: 'Academia 1',
    });
    expect(offerings.find((offering: { code: string }) => offering.code === 'course_41')).toMatchObject({
      code: 'course_41', price: { amount: '360.00', currency: 'USD' }, classes: 16,
    });
  });

  it('builds a Groq-safe compact contract without dropping critical sales rules', () => {
    const claimed = claimedTurn({ texts: ['Prefiero seguir por chat. ¿Cuánto cuesta?'] });
    const instructions = buildAgentASalesBridgeCompactInstructions(claimed);

    expect(instructions.length).toBeLessThan(20_000);
    expect(instructions).toContain('COMPACT_AGENT_A_V16');
    expect(instructions).toMatch(/solo tres opciones de pago/i);
    expect(instructions).toMatch(/no uses call_offer, call_confirmation ni request_call_now/i);
    expect(instructions).toMatch(/rechaza la llamada/i);
    expect(instructions).toMatch(/baja de mensajes/i);
    expect(instructions).toMatch(/devoluciones/i);
    expect(instructions).toMatch(/memory_candidates/i);
    expect(instructions).toMatch(
      /kind=clarify[\s\S]*missing_information[\s\S]*next_state=waiting_user/i,
    );
    expect(instructions).toMatch(
      /kind=reply[\s\S]*response no puede ser null[\s\S]*response_type no puede ser null/i,
    );
    expect(instructions).toMatch(
      /requisito[^.]*no informado[^.]*no está especificado/i,
    );
    expect(instructions).toContain('UNTRUSTED_CONTEXT_START');
  });

  it('keeps the selected canonical SKU in the compact snapshot when names are homonymous', () => {
    const claimed = claimedTurn({
      texts: ['Confirmo pago único'],
      salesContext: {
        course_of_interest: 'Inglés Inicial',
        offering_code: 'ingles_selected',
      },
    });
    const offering = (code: string) => ({
      code,
      display_name: 'Inglés Inicial',
      academy: `Academia ${code}`,
      offering_type: 'course' as const,
      description: null,
      value_proposition: null,
      price_type: 'fixed' as const,
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
    });
    ;(claimed as { business_context?: unknown }).business_context = {
      as_of: '2026-08-24T00:00:00.000Z',
      prices_assertable: true,
      workspace: {
        slug: 'studyx', display_name: 'StudyX', environment: 'sandbox',
        default_locale: 'es-AR', timezone: 'America/Argentina/Buenos_Aires',
        payment_options: [],
      },
      offerings: [
        ...Array.from({ length: 13 }, (_, index) => offering(`ingles_${index}`)),
        offering('ingles_selected'),
      ],
      qualification_fields: [],
      injection_suspected_count: 0,
      offerings_truncated: 0,
    };
    ;(claimed as { business_context_available?: boolean }).business_context_available = true;

    const instructions = buildAgentASalesBridgeCompactInstructions(claimed);
    const fenced = instructions
      .split('UNTRUSTED_CONTEXT_START\n')[1]
      .split('\nUNTRUSTED_CONTEXT_END')[0];
    const payload = JSON.parse(fenced);

    expect(payload.business_snapshot.offerings.map((item: { sku: string }) => item.sku))
      .toContain('ingles_selected');
  });

  it('keeps a named course grounded without sending the entire catalog to Groq', () => {
    const claimed = claimedTurn({
      texts: ['Quiero anotarme en Redes Informáticas y saber cuántas clases tiene.'],
    });
    const offerings = Array.from({ length: 225 }, (_, index) => ({
      code: index === 73 ? 'redes_informaticas' : `curso_${index}`,
      display_name: index === 73 ? 'Redes Informáticas' : `Curso irrelevante ${index}`,
      academy: index === 73 ? 'Academia de IT' : `Academia ${index % 6}`,
      offering_type: 'course',
      description: null,
      value_proposition: null,
      price_type: 'fixed',
      price: { amount: '360.00', currency: 'USD' },
      price_assertable: true,
      billing_interval: null,
      modality: 'online',
      schedules: [],
      certification: true,
      hours_per_month: null,
      classes: index === 73 ? 16 : 8,
      modules: null,
      includes: [],
      syllabus_published: true,
      language: 'Spanish',
      min_age: 18,
      policies: { allowed_promise: null, forbidden_promises: [], price_message: null },
    }));
    ;(claimed as { business_context?: unknown }).business_context = {
      as_of: '2026-08-24T00:00:00.000Z',
      prices_assertable: true,
      workspace: {
        slug: 'studyx-production', display_name: 'StudyX', environment: 'production',
        default_locale: 'es-AR', timezone: 'America/Argentina/Buenos_Aires', payment_options: [],
      },
      offerings,
      qualification_fields: [],
      injection_suspected_count: 0,
      offerings_truncated: 0,
    };
    ;(claimed as { business_context_available?: boolean }).business_context_available = true;

    const instructions = buildAgentASalesBridgeCompactInstructions(claimed);
    const start = instructions.indexOf('UNTRUSTED_CONTEXT_START');
    const end = instructions.indexOf('UNTRUSTED_CONTEXT_END');
    const payload = JSON.parse(instructions.slice(start, end).split('\n').slice(1, -1).join('\n'));

    expect(instructions.length).toBeLessThan(14_000);
    expect(payload.business_snapshot.areas).toContain('Academia de IT');
    expect(payload.business_snapshot.offerings).toContainEqual(expect.objectContaining({
      sku: 'redes_informaticas',
      name: 'Redes Informáticas',
      classes: 16,
    }));
    expect(payload.business_snapshot.offerings.length).toBeLessThanOrEqual(12);
    expect(instructions).not.toContain('Curso irrelevante 224');
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

  it('keeps both model prompts advisory: the backend alone owns every action', () => {
    for (const instructions of [
      buildAgentASalesBridgeInstructions(claimedTurn({})),
      buildAgentASalesBridgeCompactInstructions(claimedTurn({})),
    ]) {
      expect(instructions).toMatch(/business_action (?:must be|debe ser) null/i);
      expect(instructions).toMatch(/backend.*(?:decide|owns|autoriza)/i);
      expect(instructions).not.toMatch(/set business_action to exactly/i);
      expect(instructions).not.toMatch(/business_action=\{"type":"send_payment_link"/i);
      expect(instructions).not.toMatch(/business_action=\{"type":"request_call_now"/i);
    }
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
