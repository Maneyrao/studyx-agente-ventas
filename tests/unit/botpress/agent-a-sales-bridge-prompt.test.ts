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
      sku: 'PY-101',
      name: 'Python desde cero',
      description: 'Curso intensivo',
      duration_weeks: 8,
      modality: 'live',
      price: { ars_cents: 15000000, usd_cents: 1500000 },
      price_source: 'list',
      promo: null,
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
    expect(AGENT_A_PROMPT_VERSION).toBe('studyx-agent-a-sales-bridge-v1');
  });
});

describe('buildAgentASalesBridgeInstructions', () => {
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
