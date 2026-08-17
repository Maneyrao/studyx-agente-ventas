import { describe, expect, it } from 'vitest';

/**
 * Deterministic greeting fast path: only an unambiguous, single-message
 * greeting skips the model. Anything with an actual question — or any batch
 * with more than one message — must go through the LLM. The produced decision
 * must satisfy the full Decision v3 schema so it commits through Next.js like
 * any other decision.
 */
import {
  GREETING_FAST_PATH_MODEL,
  matchDeterministicGreeting,
  normalizeGreetingText,
} from '../../../botpress-agent/src/utils/greeting';
import { DecisionSchema, type ClaimedTurn } from '../../../botpress-agent/src/schemas/contracts';

const UUID = '18a823e8-27c2-4279-9956-058f45f33cd5';

function claimedTurn(overrides: {
  texts: string[];
  allowed?: string[];
  messageType?: string;
}): ClaimedTurn {
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
      lease_until: '2026-08-13T00:00:10.000Z',
      hard_deadline_at: '2026-08-13T00:00:04.000Z',
      message_count: overrides.texts.length,
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
      batch_messages: overrides.texts.map((text, index) => ({
        id: UUID,
        conversation_seq: index + 1,
        content: text,
        created_at: '2026-08-13T00:00:00.000Z',
        message_type: overrides.messageType ?? 'text',
      })),
      recent_turns: [],
      summary: { text: null, version: 0, updated_at: null },
      selected_memories: [],
      long_term_memory_available: false,
      knowledge_base: [],
      knowledge_base_available: false,
      knowledge_base_dropped: 0,
      injection_suspected_count: 0,
    },
    existing_result: null,
  } as unknown as ClaimedTurn;
}

describe('normalizeGreetingText', () => {
  it('strips punctuation, emoji, accents and case', () => {
    expect(normalizeGreetingText('¡Hola!! 👋')).toBe('hola');
    expect(normalizeGreetingText('Buen día')).toBe('buen dia');
    expect(normalizeGreetingText('  BUENAS   TARDES. ')).toBe('buenas tardes');
  });

  it('preserves interior content so extra words defeat the exact match', () => {
    expect(normalizeGreetingText('hola, quiero el precio')).toBe('hola quiero el precio');
  });
});

describe('matchDeterministicGreeting', () => {
  const unambiguous = ['hola', 'Hola', '¡Hola!', 'buenas', 'Buen día', 'buenas tardes', 'Buenas noches'];
  for (const text of unambiguous) {
    it(`matches the unambiguous greeting ${JSON.stringify(text)}`, () => {
      const decision = matchDeterministicGreeting(claimedTurn({ texts: [text] }));
      expect(decision).not.toBeNull();
      expect(decision!.response_type).toBe('social_reply');
      expect(decision!.reason_code).toBe('DETERMINISTIC_GREETING');
    });
  }

  it('produces a decision that passes the full Decision v3 schema', () => {
    const decision = matchDeterministicGreeting(claimedTurn({ texts: ['hola'] }));
    expect(() => DecisionSchema.parse(decision)).not.toThrow();
  });

  it('greets with the configured workspace display name, never a hardcoded brand', () => {
    const claimed = claimedTurn({ texts: ['hola'] });
    (claimed as { business_context?: unknown }).business_context = {
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
    };
    const decision = matchDeterministicGreeting(claimed);
    expect(decision!.response).toContain('Aburridont — Inglés IT (Sandbox)');
    expect(decision!.response).not.toContain('StudyX');
  });

  it('stays brand-neutral when business context is unavailable', () => {
    const decision = matchDeterministicGreeting(claimedTurn({ texts: ['hola'] }));
    expect(decision!.response).not.toMatch(/StudyX|Aburridont/);
    expect(decision!.response).toContain('asesora virtual');
  });

  const ambiguous = [
    'hola, quiero información del curso',
    'hola precios?',
    'buenas, cuánto sale?',
    'quiero info',
    'gracias',
    'hola hola hola que tal todo',
  ];
  for (const text of ambiguous) {
    it(`sends ${JSON.stringify(text)} to the model (no fast path)`, () => {
      expect(matchDeterministicGreeting(claimedTurn({ texts: [text] }))).toBeNull();
    });
  }

  it('never fast-paths a batch with more than one message', () => {
    expect(matchDeterministicGreeting(claimedTurn({ texts: ['hola', 'precio?'] }))).toBeNull();
  });

  it('never fast-paths a non-text message', () => {
    expect(
      matchDeterministicGreeting(claimedTurn({ texts: ['hola'], messageType: 'audio' })),
    ).toBeNull();
  });

  it('never fast-paths when policy does not allow social_reply', () => {
    expect(
      matchDeterministicGreeting(
        claimedTurn({ texts: ['hola'], allowed: ['out_of_scope', 'technical_fallback'] }),
      ),
    ).toBeNull();
  });

  it('exposes a stable versioned model identifier for the commit metadata', () => {
    expect(GREETING_FAST_PATH_MODEL).toBe('deterministic:greeting-fast-path-v2');
  });
});
