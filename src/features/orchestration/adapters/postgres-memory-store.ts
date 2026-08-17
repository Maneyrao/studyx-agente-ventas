import { sql } from '@/lib/db/orchestrator';
import type { DbClient } from '@/lib/db/types';
import type {
  AcceptedMemoryInput,
  MemoryStore,
  RecordedMemory,
  RejectedMemoryInput,
} from '../ports/memory-store';

/**
 * PostgreSQL adapter for the selected-memory store.
 *
 * Every write goes through a SQL function rather than an INSERT. Dedupe,
 * supersession and activation have to happen under one row lock: doing them
 * from here would leave a window where two turns of the same contact both
 * activate a value for the same key, and the partial unique index would answer
 * with a bare 23505 that this layer could only guess at.
 *
 * Accepts a `DbClient` so a caller inside `withSerializableTransaction` can
 * make the memory part of the same atomic decision commit.
 */
export class PostgresMemoryStore implements MemoryStore {
  constructor(private readonly db: DbClient = sql) {}

  async recordAccepted(input: AcceptedMemoryInput): Promise<RecordedMemory> {
    const rows = await this.db<Array<{
      outcome: 'recorded' | 'duplicate';
      memory_id: string;
      superseded_memory_id: string | null;
    }>>`
      SELECT outcome, memory_id, superseded_memory_id
      FROM record_selected_memory(
        ${input.contact_id}::uuid,
        ${input.conversation_id}::uuid,
        ${input.source_message_id}::uuid,
        ${input.source_batch_id}::uuid,
        ${input.decision_id}::uuid,
        ${input.memory_type},
        ${input.memory_key},
        ${input.value_normalized},
        ${input.source_quote},
        ${input.confidence},
        ${input.dedupe_hash},
        ${input.ttl_days},
        ${input.trace_id}::uuid
      )
    `;
    const row = rows[0];
    if (!row) throw new Error('record_selected_memory returned no row');
    return {
      outcome: row.outcome,
      memory_id: row.memory_id,
      superseded_memory_id: row.superseded_memory_id,
    };
  }

  async recordRejected(input: RejectedMemoryInput): Promise<string> {
    const rows = await this.db<Array<{ record_rejected_memory: string }>>`
      SELECT record_rejected_memory(
        ${input.contact_id}::uuid,
        ${input.conversation_id}::uuid,
        ${input.source_message_id}::uuid,
        ${input.source_batch_id}::uuid,
        ${input.decision_id}::uuid,
        ${input.memory_type},
        ${input.memory_key},
        ${input.value_normalized},
        ${input.source_quote},
        ${input.confidence},
        ${input.dedupe_hash},
        ${input.rejection_reason},
        ${input.contradicts_field},
        ${input.trace_id}::uuid
      )
    `;
    return rows[0].record_rejected_memory;
  }

  async expireDueMemories(limit = 500): Promise<Array<{ memory_id: string; contact_id: string }>> {
    return this.db<Array<{ memory_id: string; contact_id: string }>>`
      SELECT memory_id, contact_id FROM expire_selected_memories(${limit})
    `;
  }
}

export const memoryStore = new PostgresMemoryStore();
