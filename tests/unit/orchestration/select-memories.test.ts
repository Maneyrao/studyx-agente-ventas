import { describe, expect, it, vi } from 'vitest';
import { selectMemories } from '@/features/orchestration/application/select-memories';
import type {
  AcceptedMemoryInput,
  MemoryStore,
  RecordedMemory,
  RejectedMemoryInput,
} from '@/features/orchestration/ports/memory-store';

const CONTACT = '11111111-1111-4111-8111-111111111111';
const CONVERSATION = '22222222-2222-4222-8222-222222222222';
const MESSAGE = '33333333-3333-4333-8333-333333333333';
const BATCH = '44444444-4444-4444-8444-444444444444';
const DECISION = '55555555-5555-4555-8555-555555555555';
const TRACE = '66666666-6666-4666-8666-666666666666';

class FakeMemoryStore implements MemoryStore {
  readonly accepted: AcceptedMemoryInput[] = [];
  readonly rejected: RejectedMemoryInput[] = [];
  private readonly held = new Map<string, string>();
  private readonly slots = new Map<string, string>();
  private sequence = 0;
  failNext: Error | null = null;

  async recordAccepted(input: AcceptedMemoryInput): Promise<RecordedMemory> {
    if (this.failNext) {
      const error = this.failNext;
      this.failNext = null;
      throw error;
    }
    this.accepted.push(input);
    const held = this.held.get(`${input.contact_id}:${input.dedupe_hash}`);
    if (held) return { outcome: 'duplicate', memory_id: held, superseded_memory_id: null };

    const slotKey = `${input.contact_id}:${input.memory_type}:${input.memory_key}`;
    const previous = this.slots.get(slotKey) ?? null;
    this.sequence += 1;
    const id = `memory-${this.sequence}`;
    this.held.set(`${input.contact_id}:${input.dedupe_hash}`, id);
    this.slots.set(slotKey, id);
    return { outcome: 'recorded', memory_id: id, superseded_memory_id: previous };
  }

  async recordRejected(input: RejectedMemoryInput): Promise<string> {
    this.rejected.push(input);
    this.sequence += 1;
    return `rejected-${this.sequence}`;
  }

  async expireDueMemories(): Promise<Array<{ memory_id: string; contact_id: string }>> {
    return [];
  }
}

function input(overrides: Partial<Parameters<typeof selectMemories>[0]> = {}) {
  return {
    contact_id: CONTACT,
    conversation_id: CONVERSATION,
    source_batch_id: BATCH,
    decision_id: DECISION,
    trace_id: TRACE,
    batch_messages: [{ id: MESSAGE, content: 'Quiero rendir el final de anatomía en marzo' }],
    structured_facts: {
      contact_name: null,
      contact_status: 'prospecto' as const,
      consent_status: 'granted' as const,
    },
    candidates: [
      {
        type: 'study_goal',
        key: 'objetivo',
        value: 'rendir el final de anatomía en marzo',
        source_quote: 'Quiero rendir el final de anatomía en marzo',
        confidence: 0.9,
      },
    ],
    ...overrides,
  };
}

describe('selectMemories', () => {
  it('stores a grounded candidate and reports it as accepted', async () => {
    const store = new FakeMemoryStore();
    const result = await selectMemories(input(), { store });

    expect(result.accepted).toHaveLength(1);
    expect(result.rejected).toHaveLength(0);
    expect(result.duplicates).toBe(0);
    expect(store.accepted[0]).toMatchObject({
      contact_id: CONTACT,
      source_message_id: MESSAGE,
      memory_type: 'study_goal',
      memory_key: 'objetivo',
      ttl_days: 365,
    });
  });

  it('archives a rejection with its reason instead of dropping it silently', async () => {
    const store = new FakeMemoryStore();
    const result = await selectMemories(
      input({
        candidates: [
          {
            type: 'study_goal',
            key: 'objetivo',
            value: 'ya pagó la inscripción',
            source_quote: 'Ya pagué todo',
            confidence: 0.95,
          },
        ],
      }),
      { store }
    );

    expect(result.accepted).toHaveLength(0);
    expect(result.rejected).toEqual([
      expect.objectContaining({ reason: 'QUOTE_NOT_FOUND', key: 'objetivo' }),
    ]);
    expect(store.rejected[0]).toMatchObject({
      rejection_reason: 'QUOTE_NOT_FOUND',
      source_message_id: null,
    });
  });

  it('counts a repeated fact as a duplicate rather than a second memory', async () => {
    const store = new FakeMemoryStore();
    await selectMemories(input(), { store });
    const second = await selectMemories(input(), { store });

    expect(second.duplicates).toBe(1);
    expect(second.accepted).toHaveLength(0);
  });

  it('reports the replaced memory when a new value takes over the key slot', async () => {
    const store = new FakeMemoryStore();
    await selectMemories(input(), { store });

    const replacement = await selectMemories(
      input({
        batch_messages: [{ id: MESSAGE, content: 'Ahora quiero rendir el final de fisiología en julio' }],
        candidates: [
          {
            type: 'study_goal',
            key: 'objetivo',
            value: 'rendir el final de fisiología en julio',
            source_quote: 'Ahora quiero rendir el final de fisiología en julio',
            confidence: 0.9,
          },
        ],
      }),
      { store }
    );

    expect(replacement.accepted).toHaveLength(1);
    expect(replacement.superseded).toEqual(['memory-1']);
  });

  it('rejects a candidate that contradicts the structured contact status', async () => {
    const store = new FakeMemoryStore();
    const result = await selectMemories(
      input({
        structured_facts: {
          contact_name: null,
          contact_status: 'prospecto',
          consent_status: 'granted',
        },
        batch_messages: [{ id: MESSAGE, content: 'Ya soy cliente' }],
        candidates: [
          {
            type: 'study_context',
            key: 'estado_cliente',
            value: 'ya soy cliente',
            source_quote: 'Ya soy cliente',
            confidence: 0.99,
          },
        ],
      }),
      { store }
    );

    expect(result.rejected).toEqual([
      expect.objectContaining({ reason: 'CONTRADICTS_STRUCTURED_DATA' }),
    ]);
    expect(store.rejected[0]?.contradicts_field).toBe('contacts.status');
  });

  it('rejects a candidate that contradicts the structured consent state', async () => {
    const store = new FakeMemoryStore();
    const quote = 'No me escribas nunca más por favor';
    const result = await selectMemories(
      input({
        structured_facts: {
          contact_name: null,
          contact_status: 'prospecto',
          consent_status: 'granted',
        },
        batch_messages: [{ id: MESSAGE, content: quote }],
        candidates: [
          {
            type: 'contact_preference',
            key: 'canal',
            value: 'no me escribas nunca mas',
            source_quote: quote,
            confidence: 0.9,
          },
        ],
      }),
      { store }
    );

    expect(result.rejected).toEqual([
      expect.objectContaining({ reason: 'CONTRADICTS_STRUCTURED_DATA' }),
    ]);
    expect(store.rejected[0]?.contradicts_field).toBe('contact_channel_permissions.consent_status');
  });

  it('never lets a store failure take down the turn', async () => {
    const store = new FakeMemoryStore();
    store.failNext = new Error('pgvector unavailable');
    const log = vi.fn();

    const result = await selectMemories(input(), { store, log });

    expect(result.accepted).toHaveLength(0);
    expect(result.failed).toBe(1);
    expect(log).toHaveBeenCalledWith(
      'orchestration.memory.record_failed',
      expect.objectContaining({ trace_id: TRACE })
    );
  });

  it('does nothing at all when the decision proposed no memory', async () => {
    const store = new FakeMemoryStore();
    const result = await selectMemories(input({ candidates: [] }), { store });

    expect(result).toMatchObject({ accepted: [], rejected: [], duplicates: 0, failed: 0 });
    expect(store.accepted).toHaveLength(0);
    expect(store.rejected).toHaveLength(0);
  });

  it('caps how many candidates one turn may propose', async () => {
    const store = new FakeMemoryStore();
    const many = Array.from({ length: 30 }, (_unused, index) => ({
      type: 'preference',
      key: `pref_${index}`,
      value: 'cursar de noche',
      source_quote: 'Prefiero cursar de noche',
      confidence: 0.9,
    }));

    const result = await selectMemories(
      input({
        batch_messages: [{ id: MESSAGE, content: 'Prefiero cursar de noche' }],
        candidates: many,
      }),
      { store }
    );

    expect(result.accepted.length + result.rejected.length + result.duplicates).toBeLessThanOrEqual(
      10
    );
    expect(result.skipped).toBe(20);
  });
});
