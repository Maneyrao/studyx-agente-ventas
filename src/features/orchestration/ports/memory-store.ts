/**
 * Port for the selected-memory store.
 *
 * Deliberately narrow: the application layer may propose a memory, archive a
 * rejection, and nothing else. There is no delete and no free-form update, so
 * "the agent quietly rewrote what it remembered about a customer" is not a
 * reachable state through this interface.
 */

export interface MemoryRecordInput {
  readonly contact_id: string;
  readonly conversation_id: string;
  /** null only for a rejection whose citation never resolved to a message. */
  readonly source_message_id: string | null;
  readonly source_batch_id: string | null;
  readonly decision_id: string | null;
  readonly memory_type: string;
  readonly memory_key: string;
  readonly value_normalized: string;
  readonly source_quote: string;
  readonly confidence: number;
  readonly dedupe_hash: string;
  readonly trace_id: string;
}

export interface AcceptedMemoryInput extends MemoryRecordInput {
  readonly source_message_id: string;
  /** null = holds until superseded. The store stamps now() + ttl itself. */
  readonly ttl_days: number | null;
}

export interface RejectedMemoryInput extends MemoryRecordInput {
  readonly rejection_reason: string;
  readonly contradicts_field: string | null;
}

export interface RecordedMemory {
  /** `duplicate` means the same fact was already held; validity was refreshed. */
  readonly outcome: 'recorded' | 'duplicate';
  readonly memory_id: string;
  /** The memory this one replaced, if it took over an occupied key slot. */
  readonly superseded_memory_id: string | null;
}

export interface MemoryStore {
  recordAccepted(input: AcceptedMemoryInput): Promise<RecordedMemory>;
  recordRejected(input: RejectedMemoryInput): Promise<string>;
  /** Moves every `active` memory past its validity into `expired`. */
  expireDueMemories(limit?: number): Promise<Array<{ memory_id: string; contact_id: string }>>;
}
