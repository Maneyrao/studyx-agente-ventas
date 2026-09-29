import type { CallEndReason, CallResult } from '@/lib/contracts/call-event';
import type { CallStatus } from '../domain/call-state';
import type { PostCallFollowupBriefV1 } from '../domain/post-call-followup';

/**
 * Port for the post-call followup sweep (spec 007). Narrow on purpose, same
 * spirit as the orchestration reconciliation port: this is the only process
 * that initiates a channel message nobody asked for, so the surface it can
 * touch is exactly what closing that loop requires.
 */

export interface TerminalCallForFollowup {
  readonly call_id: string;
  readonly contact_id: string;
  readonly conversation_id: string;
  /** NULL is retained for ambiguous/orphan legacy calls; only DNC may act on it. */
  readonly workspace_id: string | null;
  readonly channel: 'telegram' | 'whatsapp';
  readonly provider: 'telegram_sandbox' | 'retell';
  readonly status: CallStatus;
  readonly result: CallResult | null;
  readonly analysis_status: 'pending' | 'completed' | 'failed';
  readonly prompt_version: string;
  readonly disconnection_reason: CallEndReason | null;
  readonly provider_disconnection_reason: string | null;
  readonly do_not_contact?: boolean;
}

export interface PostCallFollowupStore {
  /**
   * Converge provider-accepted calls that never emitted a start/lifecycle
   * event. Optional so narrow test doubles written before this recovery keep
   * their existing surface; the production PostgreSQL adapter implements it.
   */
  expireStaleAcceptedCalls?(input: {
    readonly timeout_seconds: number;
  }): Promise<number>;

  /**
   * Terminal call_sessions rows with no matching system_call_result
   * channel_event yet. `grace_seconds` gives a pending `analyzed` event room
   * to arrive before the sweep resolves the call as analysis-unavailable.
   */
  listPendingFollowups(input: {
    readonly limit: number;
    readonly grace_seconds: number;
    readonly call_id?: string;
  }): Promise<TerminalCallForFollowup[]>;

  /**
   * Re-read the durable call/consent state after listing and before any
   * provider send.  A DNC found here is revoked and completed atomically by
   * the adapter, so a late analysis cannot race a stale list snapshot into an
   * outbound branch.
   */
  revalidateFollowup?(input: {
    readonly call_id: string;
    readonly trace_id: string;
  }): Promise<{ readonly do_not_contact: boolean }>;

  /** True if the contact has a payment with status 'paid' in this workspace. */
  hasVerifiedPayment(contactId: string, workspaceId: string, callId: string, provider: 'telegram_sandbox' | 'retell'): Promise<boolean>;

  /** True if the contact is currently blocked/opted-out on the target channel. */
  isContactBlocked(contactId: string, channel: 'telegram' | 'whatsapp'): Promise<boolean>;

  revokeContact(input: {
    readonly contact_id: string;
    readonly call_id: string;
    readonly trace_id: string;
  }): Promise<void>;

  /** Durable completion marker written only after a provider accepts the message. */
  markFollowupCompleted(input: {
    readonly call_id: string;
    readonly contact_id: string;
    readonly conversation_id: string;
    readonly trace_id: string;
    readonly followup?: PostCallFollowupBriefV1;
  }): Promise<void>;
}
