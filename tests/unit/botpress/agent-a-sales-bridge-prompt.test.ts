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
import type { CatalogResponse, ClaimedTurn } from '../../../botpress-agent/src/schemas/contracts';

const UUID = '18a823e8-27c2-4279-9956-058f45f33cd5';

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

const NO_CATALOG: CatalogResponse | null = null;

const LOADED_CATALOG: CatalogResponse = {
  items: [
    {
      sku: 'group_it_english',
      name: 'Plan Grupal IT',
      description: 'Clases grupales de inglés IT',
      offering_type: 'course',
      modality: 'virtual',
      billing_interval: 'monthly',
      price: { amount: '85000.00', currency: 'ARS' },
      price_type: 'fixed',
      price_assertable: true,
    },
  ],
  count: 1,
  dropped: 0,
  stale_promotions_dropped: 0,
  injection_suspected_count: 0,
  as_of: '2026-08-16T00:00:00.000Z',
  prices_assertable: true,
};

describe('AGENT_A_PROMPT_VERSION', () => {
  it('is the pinned sales-bridge version', () => {
    expect(AGENT_A_PROMPT_VERSION).toBe('studyx-agent-a-sales-v2');
  });
});

describe('buildAgentASalesBridgeInstructions', () => {
  it('derives the sales identity from business_context, with no hardcoded brand', () => {
    const withBusiness = claimedTurn({});
    ;(withBusiness as { business_context?: unknown }).business_context = {
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
    }
    const instructions = buildAgentASalesBridgeInstructions(withBusiness, LOADED_CATALOG);
    expect(instructions).toContain('the sales advisor for Aburridont — Inglés IT (Sandbox)');
    expect(instructions).not.toContain('StudyX');

    const withoutBusiness = buildAgentASalesBridgeInstructions(claimedTurn({}), LOADED_CATALOG);
    expect(withoutBusiness).not.toMatch(/StudyX|Aburridont/);
    expect(withoutBusiness).toContain('never invent one');
  });

  it('instructs Decision v4 with the call protocol invariants', () => {
    const instructions = buildAgentASalesBridgeInstructions(claimedTurn({}), LOADED_CATALOG);
    expect(instructions).toContain('schema_version must be 4');
    expect(instructions).not.toContain('schema_version must be 3');
    // call_offer is side-effect free…
    expect(instructions).toMatch(/call_offer[\s\S]*(no side effect|nothing is dialed)/i);
    // …and call_confirmation ⇔ request_call_now as an inseparable pair.
    expect(instructions).toMatch(/call_confirmation[\s\S]*request_call_now[\s\S]*inseparable pair/i);
    expect(instructions).toMatch(/direct_request[\s\S]*accepted_offer/);
  });

  it('marks conversational declines with intent commercial_decline for the cooldown', () => {
    const instructions = buildAgentASalesBridgeInstructions(claimedTurn({}), LOADED_CATALOG);
    expect(instructions).toContain('commercial_decline');
    expect(instructions).toMatch(/declines a call[\s\S]*commercial_decline/i);
  });

  it('continues the complete sales journey in WhatsApp after a call decline', () => {
    const instructions = buildAgentASalesBridgeInstructions(claimedTurn({}), LOADED_CATALOG);
    expect(instructions).toMatch(/call decline[\s\S]*not a (sales|conversation) decline/i);
    expect(instructions).toMatch(/continue[\s\S]*(entire|complete)[\s\S]*(sales|commercial)[\s\S]*(WhatsApp|chat)/i);
    expect(instructions).toMatch(/answer[\s\S]*pending question/i);
    expect(instructions).toMatch(/qualification[\s\S]*payment link[\s\S]*WhatsApp/i);
  });

  it('distinguishes declining a call from opting out of WhatsApp messages', () => {
    const instructions = buildAgentASalesBridgeInstructions(claimedTurn({}), LOADED_CATALOG);
    expect(instructions).toMatch(/declining (the |a )?call[\s\S]*(does not|is not)[\s\S]*opt[- ]out/i);
    expect(instructions).toMatch(/stop messaging|do not write|no me escribas/i);
  });

  it('honors a direct call request that arrives inside a multi-message burst', () => {
    const instructions = buildAgentASalesBridgeInstructions(claimedTurn({}), LOADED_CATALOG);
    expect(instructions).toMatch(/direct call request[\s\S]*burst|burst[\s\S]*direct call request/i);
    expect(instructions).toMatch(/answer the rest of the batch in the same response/i);
  });

  it('treats qualification as conversational, never a prerequisite form', () => {
    const instructions = buildAgentASalesBridgeInstructions(claimedTurn({}), LOADED_CATALOG);
    expect(instructions).toContain('business_context.qualification_fields');
    expect(instructions).toMatch(/never as a prerequisite/i);
    expect(instructions).toMatch(/at most one per turn/i);
  });

  it('forbids naming a number for quote-priced offerings', () => {
    const instructions = buildAgentASalesBridgeInstructions(claimedTurn({}), LOADED_CATALOG);
    expect(instructions).toMatch(/price_type "quote"[\s\S]*NEVER name a number/i);
  });

  it('requires answering the actual question before any call CTA', () => {
    const instructions = buildAgentASalesBridgeInstructions(claimedTurn({}), LOADED_CATALOG);
    expect(instructions).toMatch(/answer(s)? .*before.*(call|cta)/i);
  });

  it('caps the response to at most one question or CTA, never a questionnaire', () => {
    const instructions = buildAgentASalesBridgeInstructions(claimedTurn({}), LOADED_CATALOG);
    expect(instructions).toMatch(/at most one question or (call-to-action|cta)/i);
    expect(instructions).toMatch(/never .*(questionnaire|qualification questionnaire)/i);
  });

  it('says "asesora virtual" and forbids promising a human or a transfer', () => {
    const instructions = buildAgentASalesBridgeInstructions(claimedTurn({}), LOADED_CATALOG);
    expect(instructions).toContain('asesora virtual');
    expect(instructions).toMatch(/never (say|promise|claim) .*(humano|human)/i);
  });

  it('gates any call proposal on sales_context.allowed_actions', () => {
    const instructions = buildAgentASalesBridgeInstructions(claimedTurn({}), LOADED_CATALOG);
    expect(instructions).toContain('sales_context.allowed_actions');
    expect(instructions).toContain('offer_call');
    expect(instructions).toContain('request_call_now');
    expect(instructions).toMatch(/request_call_now.*only.*(allowed_actions|explicit consent)/i);
  });

  it('leaves the course optional for a direct call request', () => {
    const instructions = buildAgentASalesBridgeInstructions(claimedTurn({}), LOADED_CATALOG);
    expect(instructions).toMatch(/course.*optional/i);
  });

  it('forbids asking for email, budget, country or availability before an immediate call unless essential', () => {
    const instructions = buildAgentASalesBridgeInstructions(claimedTurn({}), LOADED_CATALOG);
    expect(instructions).toMatch(/email|budget|country|availability/i);
    expect(instructions).toMatch(/unless essential/i);
  });

  it('forbids re-asking data already present in context', () => {
    const instructions = buildAgentASalesBridgeInstructions(claimedTurn({}), LOADED_CATALOG);
    expect(instructions).toMatch(/never re-ask|do not re-ask/i);
  });

  it('grounds prices, promotions, duration and certificates only in the structured catalog / knowledge base', () => {
    const instructions = buildAgentASalesBridgeInstructions(claimedTurn({}), LOADED_CATALOG);
    expect(instructions).toMatch(/prices_assertable/);
    expect(instructions).toMatch(/never invent/i);
  });

  it('forbids claiming payment or acceptance without structured evidence', () => {
    const instructions = buildAgentASalesBridgeInstructions(claimedTurn({}), LOADED_CATALOG);
    expect(instructions).toMatch(/payment|acceptance/i);
    expect(instructions).toMatch(/structured evidence/i);
  });

  it('limits checkout to the three owner-approved payment plans', () => {
    const instructions = buildAgentASalesBridgeInstructions(claimedTurn({}), LOADED_CATALOG);
    expect(instructions).toMatch(/exactly three payment options/i);
    expect(instructions).toContain('12 monthly\n  payments of USD 30');
    expect(instructions).toContain('6 monthly payments of USD 60');
    expect(instructions).toContain('one single payment of\n  USD 360');
    expect(instructions).toMatch(/There is no fourth option/i);
    expect(instructions).toMatch(/ONLY after the customer explicitly chooses/i);
    expect(instructions).toMatch(/exactly one.*payment link|one.*payment link/i);
    expect(instructions).toMatch(/Apple Pay/i);
  });

  it('enforces the supplied WhatsApp sales behavior without claiming a payment from a screenshot', () => {
    const instructions = buildAgentASalesBridgeInstructions(claimedTurn({}), LOADED_CATALOG);
    expect(instructions).toMatch(/one diagnostic question/i);
    expect(instructions).toMatch(/One idea per message, maximum 3-4 short lines/i);
    expect(instructions).toMatch(/never.*AI.*bot|AI.*bot.*never/i);
    expect(instructions).toMatch(/choice.?based close|close.*by choice/i);
    expect(instructions).toContain('screenshot can be acknowledged as received, but it is NOT payment');
    expect(instructions).toContain('Only a verified Stripe webhook is');
  });

  it('fences the untrusted context with explicit markers', () => {
    const instructions = buildAgentASalesBridgeInstructions(claimedTurn({}), LOADED_CATALOG);
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
      LOADED_CATALOG,
    );
    const start = instructions.indexOf('UNTRUSTED_CONTEXT_START');
    const end = instructions.indexOf('UNTRUSTED_CONTEXT_END');
    const fenced = instructions.slice(start, end);
    const payload = JSON.parse(fenced.split('\n').slice(1, -1).join('\n'));
    expect(payload.sales_context.mode).toBe('awaiting_call_consent');
    expect(payload.sales_context.allowed_actions).toEqual(['offer_call']);
  });

  it('embeds business_context inside the fenced payload, never outside it', () => {
    const businessContext = {
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
          modality: 'virtual',
          schedules: [{ days: ['tuesday', 'thursday'], start: '21:00', end: null, timezone: null }],
          certification: true,
          hours_per_month: 8,
          policies: { allowed_promise: null, forbidden_promises: [], price_message: null },
        },
      ],
      qualification_fields: [],
      injection_suspected_count: 0,
    };
    const claimed = claimedTurn({});
    ;(claimed as { business_context?: unknown }).business_context = businessContext
    ;(claimed as { business_context_available?: boolean }).business_context_available = true

    const instructions = buildAgentASalesBridgeInstructions(claimed, LOADED_CATALOG);
    const start = instructions.indexOf('UNTRUSTED_CONTEXT_START');
    const end = instructions.indexOf('UNTRUSTED_CONTEXT_END');
    const fenced = instructions.slice(start, end);
    const payload = JSON.parse(fenced.split('\n').slice(1, -1).join('\n'));
    expect(payload.business_context.workspace.display_name).toBe('Aburridont — Inglés IT (Sandbox)');
    expect(payload.business_context.offerings[0].price).toEqual({ amount: '85000.00', currency: 'ARS' });
    expect(payload.business_context_available).toBe(true);
    // Dynamic business content must not leak outside the fence.
    expect(instructions.slice(0, start)).not.toContain('85000.00');
  });

  it('degrades catalog to prices_assertable=false when no catalog is available', () => {
    const instructions = buildAgentASalesBridgeInstructions(claimedTurn({}), NO_CATALOG);
    const start = instructions.indexOf('UNTRUSTED_CONTEXT_START');
    const end = instructions.indexOf('UNTRUSTED_CONTEXT_END');
    const fenced = instructions.slice(start, end);
    const payload = JSON.parse(fenced.split('\n').slice(1, -1).join('\n'));
    expect(payload.catalog.prices_assertable).toBe(false);
    expect(payload.catalog.items).toEqual([]);
  });

  it('bounds recent_turns to the last 10 entries, each capped at 280 characters', () => {
    const recentTurns = Array.from({ length: 15 }, (_, i) => ({
      direction: (i % 2 === 0 ? 'inbound' : 'outbound') as 'inbound' | 'outbound',
      content: i === 14 ? 'x'.repeat(400) : `turn ${i}`,
      created_at: '2026-08-16T00:00:00.000Z',
    }));
    const instructions = buildAgentASalesBridgeInstructions(claimedTurn({ recentTurns }), LOADED_CATALOG);
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
    const instructions = buildAgentASalesBridgeInstructions(claimedTurn({}), LOADED_CATALOG);
    expect(instructions).not.toMatch(/there is no human to escalate to/i);
    expect(instructions).not.toMatch(/no (call|voice) (path|feature) exists/i);
  });
});
