import { withSerializableTransaction } from '@/lib/db/transaction';
import { loadBusinessWorkspaceConfig } from '@/lib/config';

export interface DeliveryContinuationInput {
  outbound_id: string;
  trace_id: string;
  delivery_attempt: number;
  workspaceSlug?: string;
}

export async function authorizeDeliveryContinuation(input: DeliveryContinuationInput) {
  const result = (outcome: 'authorized' | 'superseded' | 'not_owner', reason?: string, botpressMessageId?: string | null) => ({
    outcome, trace_id: input.trace_id, outbound_id: input.outbound_id, ...(reason ? { reason } : {}),
    ...(botpressMessageId ? { botpress_message_id: botpressMessageId } : {}),
  });
  const workspace = input.workspaceSlug ?? loadBusinessWorkspaceConfig().workspaceSlug;
  return withSerializableTransaction(async db => {
    const [delivery] = await db<Array<{ id: string; conversation_id: string; turn_id: string;
      decision_created_at: string; batch_id: string | null; state: string;
      physical_send_state: string | null; provider_message_id: string | null; leased_by: string | null }>>`
      SELECT od.id, od.conversation_id, od.state, od.physical_send_state, od.provider_message_id, od.leased_by,
        ad.turn_id, ad.created_at AS decision_created_at, origin.batch_id
      FROM outbound_deliveries od
      JOIN agent_decision_outbound_parts part ON part.message_id = od.message_id
      JOIN agent_decisions ad ON ad.id = part.decision_id
      JOIN messages origin ON origin.id = ad.turn_id
      JOIN workspace_contacts membership ON membership.contact_id = od.contact_id
      JOIN workspaces workspace ON workspace.id = membership.workspace_id
      WHERE od.message_id = ${input.outbound_id}::uuid
        AND workspace.slug = ${workspace} AND workspace.status = 'active'
        AND od.attempt_count = ${input.delivery_attempt}
        AND ad.trace_id = ${input.trace_id}::uuid
      FOR UPDATE OF od
    `;
    if (!delivery) return result('not_owner');
    if (delivery.provider_message_id || ['submitted', 'delivered'].includes(delivery.state)) {
      return result('not_owner', 'ALREADY_SUBMITTED', delivery.provider_message_id);
    }
    if (delivery.physical_send_state === 'started') return result('not_owner', 'SEND_ALREADY_STARTED');
    if (delivery.physical_send_state !== 'reserved') return result('not_owner', 'LEGACY_SEND_UNKNOWN');
    if (delivery.state !== 'leased' || (delivery.leased_by !== null && delivery.leased_by !== `botpress:${input.trace_id}`)) {
      return result('not_owner', 'DELIVERY_OWNER_CHANGED');
    }
    await db`SELECT id FROM conversations WHERE id = ${delivery.conversation_id}::uuid FOR UPDATE`;
    const [newer] = await db`
      SELECT newer.id FROM messages newer
      WHERE newer.conversation_id = ${delivery.conversation_id}::uuid AND newer.direction = 'inbound'
        AND newer.created_at > ${delivery.decision_created_at}::timestamptz
        AND (message_occurrence_v1(newer.metadata, newer.created_at), newer.conversation_seq) > (
          SELECT message_occurrence_v1(prior.metadata, prior.created_at), prior.conversation_seq
          FROM messages prior WHERE prior.conversation_id = ${delivery.conversation_id}::uuid
            AND prior.direction = 'inbound'
            AND (prior.id = ${delivery.turn_id}::uuid OR prior.batch_id = ${delivery.batch_id}::uuid)
            AND prior.created_at <= ${delivery.decision_created_at}::timestamptz
          ORDER BY message_occurrence_v1(prior.metadata, prior.created_at) DESC, prior.conversation_seq DESC LIMIT 1
        ) LIMIT 1
    `;
    // Rule A (owner 2026-11-02): the bubble that carries a committed direct
    // bonus offer is the effect itself. Cancelling it after "dame un segundo"
    // would leave the offer undelivered and the package cycle stuck.
    const [carriesCommittedOffer] = newer ? await db`
      SELECT 1 FROM promotion_offer_bonus_offerings
      WHERE offered_outbound_message_id = ${input.outbound_id}::uuid LIMIT 1` : [];
    if (newer && !carriesCommittedOffer) {
      await db`UPDATE outbound_deliveries SET state = 'cancelled', lease_until = NULL, leased_by = NULL,
        last_error_code = 'DELIVERY_CONTINUATION_SUPERSEDED', updated_at = now() WHERE id = ${delivery.id}::uuid`;
      await db`UPDATE outbox_events SET state = 'cancelled', lease_until = NULL, leased_by = NULL,
        last_error_code = 'DELIVERY_CONTINUATION_SUPERSEDED', updated_at = now() WHERE delivery_id = ${delivery.id}::uuid`;
      return result('superseded');
    }
    // A reservation is positive proof of no provider call. Expired/paused
    // leases can recover it; a started or legacy-unknown send cannot reenter.
    await db`UPDATE outbound_deliveries SET physical_send_state = 'started',
      reconciliation_state = NULL, reconciliation_reason = NULL, reconciled_at = NULL,
      leased_by = ${`botpress:${input.trace_id}`}, lease_until = now() + interval '5 minutes', updated_at = now()
      WHERE id = ${delivery.id}::uuid`;
    await db`UPDATE outbox_events SET lease_until = now() + interval '5 minutes', updated_at = now()
      WHERE delivery_id = ${delivery.id}::uuid AND state = 'leased'`;
    return result('authorized');
  }, { traceId: input.trace_id });
}
