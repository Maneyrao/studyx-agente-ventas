export interface ModelObservation {
  readonly kind: string;
  readonly [key: string]: unknown;
}
export interface TurnEvidenceEvent {
  readonly event_id: string;
  readonly kind: string;
  readonly data: Record<string, unknown>;
}

/** Separate from provider errors: evidence failures may never request another generation. */
export class TurnEvidencePersistenceError extends Error {
  readonly code = 'TURN_EVIDENCE_UNAVAILABLE';
  constructor() { super('TURN_EVIDENCE_UNAVAILABLE'); this.name = 'TurnEvidencePersistenceError'; }
}

/** ADK restores failed steps as plain Error(message + runtime context). */
export function isTurnEvidencePersistenceError(error: unknown): error is TurnEvidencePersistenceError {
  return error instanceof TurnEvidencePersistenceError || Boolean(error instanceof Error
    && (error.message === 'TURN_EVIDENCE_UNAVAILABLE'
      || error.message.startsWith('TURN_EVIDENCE_UNAVAILABLE\n')
      || error.message.startsWith('TURN_EVIDENCE_UNAVAILABLE ')));
}

/** The ID and immutable payload survive persistence retries. No clocks or secrets. */
export function createTurnEvidenceJournal(save: (event: TurnEvidenceEvent) => Promise<void>,
  initial: readonly TurnEvidenceEvent[] = [], onPending?: (events: TurnEvidenceEvent[]) => void) {
  const pending: TurnEvidenceEvent[] = structuredClone([...initial]);
  const capture = ({ kind, ...data }: ModelObservation): void => {
    pending.push({ event_id: crypto.randomUUID(), kind, data: structuredClone(data) });
    onPending?.(structuredClone(pending));
  };
  const flush = async (): Promise<void> => {
    while (pending.length) {
      try { await save(pending[0]!); } catch { throw new TurnEvidencePersistenceError(); }
      pending.shift();
      onPending?.(structuredClone(pending));
    }
  };
  return {
    capture, flush,
    async generate<T>(generate: (observe: (event: ModelObservation) => void) => Promise<T>, data: Record<string, unknown>): Promise<T> {
      capture({ kind: 'generation_started', ...data });
      // Persistence is outside the provider's AbortController/deadline.
      // Content is copied synchronously before parsing/normalization, and
      // flushed even when parsing fails and no decision is ever committed.
      try { return await generate(capture); }
      catch (error) {
        capture({ kind: 'generation_failed', code: error instanceof Error ? error.message : 'UNKNOWN_ERROR' });
        throw error;
      } finally { await flush(); }
    },
  };
}

/** Source release identifier, deliberately NOT a compiled bundle hash or backend SHA. */
export const BOTPRESS_EVIDENCE_VERSION = 'studyx-botpress-turn-evidence-v1';
