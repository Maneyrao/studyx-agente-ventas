/**
 * What may be done with a delivery that nobody finished.
 *
 * This is the most dangerous decision in the system, so it is a pure function
 * with no I/O: given the facts, the verdict is fixed and testable.
 *
 * The rule that governs everything here:
 *
 *   **A resend requires affirmative evidence that no physical send happened.**
 *
 * Not the absence of evidence that it did — affirmative evidence that it did
 * not. "The lease expired and we never heard back" is exactly the case where
 * Botpress may have created the message and the reporting call died on the way
 * home. Resending there sends the customer the same message twice, which is
 * worse than sending nothing, because it is unrecoverable and visible.
 *
 * So the state space is split in three, and only the first may be resent:
 *
 *   1. Provably not sent — never leased, or reported `failed` with no Botpress
 *      message id. Botpress raised before producing one.
 *   2. Provably sent — a Botpress message id exists, or the state is
 *      `submitted`/`delivered`. Terminal. Never created again.
 *   3. Unknowable — leased, lease expired, nothing reported. Paused for a human
 *      to look at. Never resent automatically, at any attempt count.
 */

export type DeliveryReconciliationAction =
  /** Provably unsent and still within its attempt budget: a resend is authorized. */
  | 'authorize_resend'
  /** Provably unsent, attempts exhausted: stop trying, keep the record. */
  | 'abandon'
  /** Provably sent: converge the record and stop looking at it. */
  | 'mark_sent'
  /** Unknowable: pause for review. Never resent by machine. */
  | 'pause_ambiguous'
  /** Still owned by a live lease, or already terminal: leave it alone. */
  | 'wait';

export interface DeliveryReconciliationFacts {
  readonly state:
    | 'pending'
    | 'leased'
    | 'submitted'
    | 'delivered'
    | 'failed_retryable'
    | 'dead_letter'
    | 'cancelled';
  /** The Botpress message id. Its presence is proof the send happened. */
  readonly provider_message_id: string | null;
  readonly attempt_count: number;
  readonly max_attempts: number;
  /** null = not leased. Compared against `now`. */
  readonly lease_until: string | null;
  /** A delivery report exists for this outbound. */
  readonly reported_status: 'submitted_to_botpress' | 'failed' | null;
  /** Set by a previous reconciliation pass; a paused delivery stays paused. */
  readonly reconciliation_state: string | null;
  readonly now: number;
}

export interface DeliveryReconciliationVerdict {
  readonly action: DeliveryReconciliationAction;
  readonly reason: string;
}

function leaseIsLive(facts: DeliveryReconciliationFacts): boolean {
  if (facts.lease_until === null) return false;
  const until = Date.parse(facts.lease_until);
  return Number.isFinite(until) && until > facts.now;
}

export function decideDeliveryReconciliation(
  facts: DeliveryReconciliationFacts
): DeliveryReconciliationVerdict {
  // Proof of send outranks every other signal, including the state column.
  // A record that says `failed` while carrying a Botpress message id is a
  // record that lost a race, not a message that never left.
  if (facts.provider_message_id !== null || facts.reported_status === 'submitted_to_botpress') {
    return { action: 'mark_sent', reason: 'PROVIDER_MESSAGE_ID_PRESENT' };
  }

  if (facts.state === 'submitted' || facts.state === 'delivered') {
    return { action: 'mark_sent', reason: 'DELIVERY_ALREADY_TERMINAL_SUCCESS' };
  }

  if (facts.state === 'dead_letter' || facts.state === 'cancelled') {
    return { action: 'wait', reason: 'DELIVERY_TERMINAL' };
  }

  // A pause is sticky. Re-deriving it every sweep would eventually flip to a
  // resend the moment some other field changed.
  if (facts.reconciliation_state === 'ambiguous_paused') {
    return { action: 'wait', reason: 'ALREADY_PAUSED_FOR_REVIEW' };
  }

  if (leaseIsLive(facts)) {
    return { action: 'wait', reason: 'LEASE_STILL_HELD' };
  }

  const budgetLeft = facts.attempt_count < facts.max_attempts;

  // Reported `failed` with no message id: Botpress raised before it produced
  // one. That is affirmative evidence of no physical send.
  if (facts.reported_status === 'failed') {
    return budgetLeft
      ? { action: 'authorize_resend', reason: 'REPORTED_FAILED_BEFORE_SEND' }
      : { action: 'abandon', reason: 'MAX_ATTEMPTS_EXHAUSTED' };
  }

  // Never leased: no workflow ever picked it up, so nothing was sent.
  if (facts.state === 'pending' && facts.lease_until === null && facts.attempt_count === 0) {
    return budgetLeft
      ? { action: 'authorize_resend', reason: 'NEVER_LEASED' }
      : { action: 'abandon', reason: 'MAX_ATTEMPTS_EXHAUSTED' };
  }

  // `failed_retryable` without a report is a state the backend wrote itself,
  // which it only does after a report — so reaching here means the report is
  // gone and we cannot tell. Treat it as unknowable.
  if (facts.state === 'failed_retryable') {
    return { action: 'pause_ambiguous', reason: 'FAILED_WITHOUT_REPORT' };
  }

  // Leased, lease expired, nothing reported: the workflow died somewhere
  // around `createMessage`. This is precisely the case that must never resend.
  return { action: 'pause_ambiguous', reason: 'LEASE_EXPIRED_WITHOUT_REPORT' };
}
