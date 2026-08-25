import { verifyAuthorizedEgress } from '../../src/features/orchestration/domain/egress-guard';

export interface LocalDeliveryReport {
  readonly outbound_id: string;
  readonly trace_id: string;
  readonly status: 'submitted_to_botpress' | 'failed';
  readonly botpress_message_id: string | null;
  readonly replayed: false;
  readonly error_code: string | null;
  readonly delivery_attempt: number;
}

export type LocalAuthorizedDeliveryOutcome =
  | { readonly kind: 'blocked'; readonly reason: string }
  | {
      readonly kind: 'submitted';
      readonly content: string;
      readonly message_id: string;
    };

interface LocalOutbound {
  readonly id: string;
  readonly content: string;
  readonly delivery_attempt: number;
  readonly authorized_egress: unknown;
}

/**
 * Local transport use case. It owns the ordering invariant: verification,
 * then exactly one delivery report, then (and only then) exposing content to
 * the conversation evaluator.
 */
export async function deliverAuthorizedLocalOutbound(input: {
  readonly trace_id: string;
  readonly outbound: LocalOutbound;
  readonly createMessageId: () => string;
  readonly reportDelivery: (report: LocalDeliveryReport) => Promise<void>;
  readonly afterSubmitted: () => Promise<void>;
}): Promise<LocalAuthorizedDeliveryOutcome> {
  const verification = verifyAuthorizedEgress({
    content: input.outbound.content,
    manifest: input.outbound.authorized_egress,
  });

  if (!verification.ok) {
    await input.reportDelivery({
      outbound_id: input.outbound.id,
      trace_id: input.trace_id,
      status: 'failed',
      botpress_message_id: null,
      replayed: false,
      error_code: `EGRESS_${verification.reason}`,
      delivery_attempt: input.outbound.delivery_attempt,
    });
    return { kind: 'blocked', reason: verification.reason };
  }

  const messageId = input.createMessageId();
  await input.reportDelivery({
    outbound_id: input.outbound.id,
    trace_id: input.trace_id,
    status: 'submitted_to_botpress',
    botpress_message_id: messageId,
    replayed: false,
    error_code: null,
    delivery_attempt: input.outbound.delivery_attempt,
  });
  await input.afterSubmitted();
  return {
    kind: 'submitted',
    content: input.outbound.content,
    message_id: messageId,
  };
}
