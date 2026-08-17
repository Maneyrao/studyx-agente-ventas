import {
  detectStructuredContradiction,
  evaluateMemoryCandidate,
  memoryDedupeHash,
  normalizeMemoryText,
  type MemoryCandidateInput,
  type MemoryRejectionReason,
  type StructuredMemoryFacts,
} from '../domain/memory-selection';
import type { MemoryStore } from '../ports/memory-store';

/**
 * Turn the memory candidates of one decision into durable, audited memories.
 *
 * Three properties this use case is responsible for, none of which the model
 * can be trusted to provide:
 *
 * 1. **Nothing is dropped in silence.** A rejected candidate is archived with
 *    its reason. During the Telegram pilot that archive is the difference
 *    between "the agent invented something" and a row that names what and why.
 * 2. **A memory failure never costs a turn.** Writes are per-candidate and
 *    wrapped; the conversation continues on structured facts, recent messages
 *    and the summary, exactly as when pgvector is down.
 * 3. **The turn cannot flood the store.** A decision proposing thirty facts is
 *    itself a symptom; the excess is counted and discarded, not written.
 */

export const MAX_MEMORY_CANDIDATES_PER_TURN = 10;

/** Rejections this layer adds on top of the domain's structural ones. */
type ApplicationRejectionReason = 'CONTRADICTS_STRUCTURED_DATA';

export type SelectMemoriesRejectionReason = MemoryRejectionReason | ApplicationRejectionReason;

export interface SelectMemoriesInput {
  readonly contact_id: string;
  readonly conversation_id: string;
  readonly source_batch_id: string | null;
  readonly decision_id: string | null;
  readonly trace_id: string;
  /** The claimed batch, contact-scoped. The only admissible citation source. */
  readonly batch_messages: ReadonlyArray<{ id: string; content: string }>;
  readonly structured_facts: StructuredMemoryFacts;
  readonly candidates: ReadonlyArray<MemoryCandidateInput>;
  readonly min_confidence?: number;
}

export interface SelectMemoriesResult {
  readonly accepted: Array<{ memory_id: string; type: string; key: string }>;
  readonly rejected: Array<{ reason: SelectMemoriesRejectionReason; type: string; key: string }>;
  readonly duplicates: number;
  readonly superseded: string[];
  /** Store writes that threw. The turn survives them. */
  readonly failed: number;
  /** Candidates beyond the per-turn cap. */
  readonly skipped: number;
}

export interface SelectMemoriesDependencies {
  readonly store: MemoryStore;
  readonly log?: (event: string, fields: Record<string, unknown>) => void;
}

export async function selectMemories(
  input: SelectMemoriesInput,
  deps: SelectMemoriesDependencies
): Promise<SelectMemoriesResult> {
  const log = deps.log ?? (() => {});
  const accepted: SelectMemoriesResult['accepted'] = [];
  const rejected: SelectMemoriesResult['rejected'] = [];
  const superseded: string[] = [];
  let duplicates = 0;
  let failed = 0;

  const considered = input.candidates.slice(0, MAX_MEMORY_CANDIDATES_PER_TURN);
  const skipped = input.candidates.length - considered.length;
  if (skipped > 0) {
    log('orchestration.memory.candidates_capped', {
      trace_id: input.trace_id,
      contact_id: input.contact_id,
      proposed: input.candidates.length,
      cap: MAX_MEMORY_CANDIDATES_PER_TURN,
      skipped,
    });
  }

  for (const candidate of considered) {
    const evaluation = evaluateMemoryCandidate(candidate, {
      contact_id: input.contact_id,
      batch_messages: input.batch_messages,
      min_confidence: input.min_confidence,
    });

    if (evaluation.status === 'rejected') {
      await archiveRejection(candidate, evaluation.reason, null, null);
      continue;
    }

    const memory = evaluation.memory;
    const contradicts = detectStructuredContradiction(memory, input.structured_facts);
    if (contradicts) {
      await archiveRejection(
        candidate,
        'CONTRADICTS_STRUCTURED_DATA',
        contradicts,
        memory.source_message_id
      );
      continue;
    }

    try {
      const stored = await deps.store.recordAccepted({
        contact_id: input.contact_id,
        conversation_id: input.conversation_id,
        source_message_id: memory.source_message_id,
        source_batch_id: input.source_batch_id,
        decision_id: input.decision_id,
        memory_type: memory.type,
        memory_key: memory.key,
        value_normalized: memory.value,
        source_quote: memory.source_quote,
        confidence: memory.confidence,
        dedupe_hash: memory.dedupe_hash,
        ttl_days: memory.ttl_days,
        trace_id: input.trace_id,
      });

      if (stored.outcome === 'duplicate') {
        duplicates += 1;
        continue;
      }

      accepted.push({ memory_id: stored.memory_id, type: memory.type, key: memory.key });
      if (stored.superseded_memory_id) superseded.push(stored.superseded_memory_id);
    } catch (error) {
      failed += 1;
      log('orchestration.memory.record_failed', {
        trace_id: input.trace_id,
        contact_id: input.contact_id,
        memory_type: memory.type,
        memory_key: memory.key,
        error: String(error),
      });
    }
  }

  log('orchestration.memory.selection_completed', {
    trace_id: input.trace_id,
    contact_id: input.contact_id,
    proposed: input.candidates.length,
    accepted: accepted.length,
    rejected: rejected.length,
    duplicates,
    superseded: superseded.length,
    failed,
    skipped,
  });

  return { accepted, rejected, duplicates, superseded, failed, skipped };

  async function archiveRejection(
    candidate: MemoryCandidateInput,
    reason: SelectMemoriesRejectionReason,
    contradictsField: string | null,
    sourceMessageId: string | null
  ): Promise<void> {
    const type = normalizeMemoryText(candidate.type);
    const key = normalizeMemoryText(candidate.key);
    rejected.push({ reason, type, key });

    try {
      await deps.store.recordRejected({
        contact_id: input.contact_id,
        conversation_id: input.conversation_id,
        source_message_id: sourceMessageId,
        source_batch_id: input.source_batch_id,
        decision_id: input.decision_id,
        memory_type: type,
        memory_key: key,
        value_normalized: normalizeMemoryText(candidate.value),
        source_quote: candidate.source_quote,
        confidence: Number.isFinite(candidate.confidence)
          ? Math.min(Math.max(candidate.confidence, 0), 1)
          : 0,
        dedupe_hash: memoryDedupeHash({
          contact_id: input.contact_id,
          type,
          key,
          value: candidate.value,
        }),
        rejection_reason: reason,
        contradicts_field: contradictsField,
        trace_id: input.trace_id,
      });
    } catch (error) {
      // Losing the audit trail of a rejection is bad; losing the customer's
      // turn over it is worse. Count it and keep going.
      failed += 1;
      log('orchestration.memory.rejection_archive_failed', {
        trace_id: input.trace_id,
        contact_id: input.contact_id,
        reason,
        error: String(error),
      });
    }
  }
}
