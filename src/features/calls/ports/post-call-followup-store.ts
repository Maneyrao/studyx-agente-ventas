import type { CallResult } from '@/lib/contracts/call-event';
import type { CallStatus } from '../domain/call-state';

/**
 * Port for the post-call followup sweep (spec 007). Narrow on purpose, same
 * spirit as the orchestration reconciliation port: this is the only process
 * that initiates a WhatsApp message nobody asked for, so the surface it can
 * touch is exactly what closing that loop requires.
 */

export interface TerminalCallForFollowup {
  readonly call_id: string;
  readonly contact_id: string;
  readonly conversation_id: string;
  readonly status: CallStatus;
  readonly result: CallResult | null;
  readonly analysis_status: 'pending' | 'completed' | 'failed';
  readonly prompt_version: string;
}

export interface PostCallFollowupStore {
  /**
   * Terminal call_sessions rows with no matching system_call_result
   * channel_event yet. `grace_seconds` gives a pending `analyzed` event room
   * to arrive before the sweep resolves the call as analysis-unavailable.
   */
  listPendingFollowups(input: {
    readonly limit: number;
    readonly grace_seconds: number;
  }): Promise<TerminalCallForFollowup[]>;

  /** True if the contact has a payment with status 'paid' for any offering. */
  hasVerifiedPayment(contactId: string): Promise<boolean>;

  /** True if the contact is currently blocked/opted-out on whatsapp. */
  isContactBlocked(contactId: string): Promise<boolean>;

  revokeContact(input: {
    readonly contact_id: string;
    readonly call_id: string;
    readonly trace_id: string;
  }): Promise<void>;
}
