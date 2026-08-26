import type { MessagingChannelName } from './message-channel';

export type OutboundAuthorizationDecision =
  | { allowed: true; reason: null }
  | { allowed: false; reason: string };

/** Verifies that the exact outbound content was authorized by a trusted materializer. */
export interface OutboundContentAuthorizer {
  verify(content: string, manifest: unknown): OutboundAuthorizationDecision;
}

/** Final side-effect boundary. Implementations own canary/production activation policy. */
export interface OutboundSideEffectAuthorizer {
  authorize(input: {
    workspaceId: string;
    contactId: string;
    channel: MessagingChannelName;
    destination: string;
    purpose: 'conversational' | 'transactional' | 'support' | 'consent_confirmation';
  }): Promise<OutboundAuthorizationDecision>;
}
