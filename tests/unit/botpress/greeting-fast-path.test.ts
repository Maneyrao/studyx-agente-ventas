import { describe, expect, it } from 'vitest';

/**
 * Deterministic greeting fast path: a backend-authorized batch made only of
 * greetings skips the model. Anything with an actual question must go through
 * the LLM. The produced decision must satisfy the full Decision v3 schema so
 * it commits through Next.js like any other decision.
 */
import {
  GREETING_FAST_PATH_MODEL,
  matchDeterministicGreeting,
} from '../../../botpress-agent/src/utils/greeting';
import { DecisionSchema, type ClaimedTurn } from '../../../botpress-agent/src/schemas/contracts';

const UUID = '18a823e8-27c2-4279-9956-058f45f33cd5';

function claimedTurn(overrides: {
  texts: string[];
  allowed?: string[];
  messageType?: string;
  route?: ClaimedTurn['deterministic_route'];
  contactName?: string | null;
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
      name: overrides.contactName ?? null,
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
    deterministic_route: overrides.route ?? null,
    existing_result: null,
  } as unknown as ClaimedTurn;
}

describe('matchDeterministicGreeting', () => {
  const unambiguous = ['hola', 'Hola', '¡Hola!', 'buenas', 'Buen día', 'buenas tardes', 'Buenas noches'];
  for (const text of unambiguous) {
    it(`matches the unambiguous greeting ${JSON.stringify(text)}`, () => {
      const decision = matchDeterministicGreeting(claimedTurn({ texts: [text], route: 'greeting' }));
      expect(decision).not.toBeNull();
      expect(decision!.response_type).toBe('social_reply');
      expect(decision!.reason_code).toBe('DETERMINISTIC_GREETING');
    });
  }

  it('produces a Decision v4 payload accepted by the canonical commit contract', () => {
    const decision = matchDeterministicGreeting(claimedTurn({ texts: ['hola'], route: 'greeting' }));
    expect(decision?.schema_version).toBe(4);
    expect(() => DecisionSchema.parse(decision)).not.toThrow();
  });

  it('greets with the configured workspace display name, never a hardcoded brand', () => {
    const claimed = claimedTurn({ texts: ['hola'], route: 'greeting' });
    (claimed as { business_context?: unknown }).business_context = {
      as_of: '2026-08-13T00:00:00.000Z',
      prices_assertable: false,
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
    };
    const decision = matchDeterministicGreeting(claimed);
    expect(decision!.response).toContain('Aburridont — Inglés IT (Sandbox)');
    expect(decision!.response).not.toContain('StudyX');
  });

  it('stays brand-neutral when business context is unavailable', () => {
    const decision = matchDeterministicGreeting(claimedTurn({ texts: ['hola'], route: 'greeting' }));
    expect(decision!.response).not.toMatch(/StudyX|Aburridont/);
    expect(decision!.response).toContain('asesora virtual');
  });

  it('uses only the first name, once, when the contact name is known', () => {
    const decision = matchDeterministicGreeting(claimedTurn({
      texts: ['hola'],
      route: 'greeting',
      contactName: 'Sofía Ramírez',
    }));

    expect(decision!.response).toContain('¡Hola, Sofía!');
    expect(decision!.response).not.toContain('Ramírez');
    expect(decision!.response!.match(/Sofía/gu)).toHaveLength(1);
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

  it('does not reclassify greeting text when the backend route is null', () => {
    expect(matchDeterministicGreeting(claimedTurn({ texts: ['hola'], route: null }))).toBeNull();
  });

  it('accepts a backend-authorized burst made only of greetings', () => {
    const decision = matchDeterministicGreeting(
      claimedTurn({ texts: ['Buen día', 'Hola'], route: 'greeting' }),
    );
    expect(decision).toMatchObject({
      response_type: 'social_reply',
      reason_code: 'DETERMINISTIC_GREETING',
    });
  });

  it('trusts the backend route instead of maintaining a second text classifier', () => {
    const decision = matchDeterministicGreeting(
      claimedTurn({ texts: ['opaque backend-classified input'], route: 'greeting' }),
    );
    expect(decision?.reason_code).toBe('DETERMINISTIC_GREETING');
  });

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
