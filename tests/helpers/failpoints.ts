export type StudyXFailpoint =
  | 'after_idempotency_claim'
  | 'after_contact_insert'
  | 'after_conversation_insert'
  | 'after_inbound_insert'
  | 'after_audit_event_insert'
  | 'after_outbound_insert'
  | 'after_delivery_outbox_insert'
  | 'after_transaction_commit'
  | 'after_provider_send'
  | 'after_delivery_confirmation';

interface ArmedFailpoint {
  remainingHits: number;
  error: Error;
}

export class FailpointController {
  private readonly armed = new Map<StudyXFailpoint, ArmedFailpoint>();

  arm(point: StudyXFailpoint, remainingHits = 1, error = new Error(`Injected failure: ${point}`)): void {
    if (!Number.isInteger(remainingHits) || remainingHits < 1) {
      throw new Error('remainingHits must be a positive integer.');
    }
    this.armed.set(point, { remainingHits, error });
  }

  hit(point: StudyXFailpoint): void {
    const state = this.armed.get(point);
    if (!state) return;

    state.remainingHits -= 1;
    if (state.remainingHits === 0) {
      this.armed.delete(point);
      throw state.error;
    }
  }

  clear(): void {
    this.armed.clear();
  }
}
