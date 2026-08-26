import { z } from 'zod';
import { auditLog } from '@/lib/audit/logger';
import { sql } from '@/lib/db/orchestrator';
import { jsonbParam } from '@/lib/db/json';
import type { DbClient } from '@/lib/db/types';
import { decideDeliveryOutcome, type SendOutcome } from '../domain/delivery-outcome';
import { evaluateSendEligibility } from '../domain/eligibility';
import { selectChannels } from '../domain/channel-selection';
import type { ChannelIdentityStore } from '../ports/channel-identity-store';
import type {
  OutboundContentAuthorizer,
  OutboundSideEffectAuthorizer,
} from '../ports/outbound-authorization';
import {
  AmbiguousChannelError,
  ConfirmedChannelError,
  type MessageChannel,
  type MessagingChannelName,
} from '../ports/message-channel';

/**
 * Delivers one message to one contact and reports what actually happened.
 *
 * Internal on purpose: no HTTP route exposes this. Its consumer is the voice
 * tool in the next spec, and publishing a send endpoint before anything needs
 * it would be attack surface with no user (Constitution II).
 */

export const SendOutboundMessageInputSchema = z.object({
  workspaceId: z.string().uuid(),
  contactId: z.string().uuid(),
  // 4096 is the shared ceiling of both providers.
  text: z.string().trim().min(1).max(4096),
  authorizedEgress: z.unknown().refine((value) => value !== undefined, {
    message: 'authorizedEgress is required',
  }),
  idempotencyKey: z.string().trim().min(1).max(255),
  preferredChannel: z.enum(['telegram', 'whatsapp']).optional(),
  purpose: z.enum(['conversational', 'transactional', 'support', 'consent_confirmation']),
});

export type SendOutboundMessageInput = z.infer<typeof SendOutboundMessageInputSchema>;

export interface SendOutboundMessageResult {
  outcome: SendOutcome;
  channel: MessagingChannelName | null;
  providerMessageId: string | null;
  deliveryId: string | null;
  reason: string | null;
}

export interface SendOutboundMessageDeps {
  identities: ChannelIdentityStore;
  /** Configured channels, keyed by name. An absent channel is simply skipped. */
  channels: Partial<Record<MessagingChannelName, MessageChannel>>;
  preferenceOrder: MessagingChannelName[];
  contentAuthorizer: OutboundContentAuthorizer;
  sideEffectAuthorizer: OutboundSideEffectAuthorizer;
  db?: DbClient;
  now?: () => Date;
}

export async function sendOutboundMessage(
  rawInput: SendOutboundMessageInput,
  deps: SendOutboundMessageDeps,
): Promise<SendOutboundMessageResult> {
  const input = SendOutboundMessageInputSchema.parse(rawInput);
  const db = deps.db ?? sql;
  const now = deps.now ?? (() => new Date());

  /**
   * A refusal leaves a trace (FR-014).
   *
   * Nothing is written to the delivery ledger for a message that was never
   * attempted, so without this the safest outcome would also be the most
   * invisible one: an audit could not tell "we correctly declined to write to a
   * revoked contact" apart from "the request never arrived".
   */
  const refuse = async (reason: string): Promise<SendOutboundMessageResult> => {
    await auditLog({
      action: 'outbound_send_refused',
      entity_type: 'contact',
      entity_id: input.contactId,
      event_key: `outbound-refusal:${input.idempotencyKey}`,
      payload: { reason, workspace_id: input.workspaceId, purpose: input.purpose },
    }, db).catch(() => {
      // Never let the audit trail turn a clean refusal into a thrown error:
      // the refusal itself is the safety-critical behaviour.
    });
    return { outcome: 'rejected_by_policy', channel: null, providerMessageId: null, deliveryId: null, reason };
  };

  const contentAuthorization = deps.contentAuthorizer.verify(input.text, input.authorizedEgress);
  if (!contentAuthorization.allowed) return await refuse(contentAuthorization.reason);

  // 1–2. Tenant boundary, then the policy gate — both before any provider is
  // contacted and before anything is written.
  const facts = await deps.identities.loadEligibilityFacts(input.workspaceId, input.contactId);
  if (!facts) return await refuse('CONTACT_NOT_IN_WORKSPACE');

  const eligibility = evaluateSendEligibility(facts);
  if (!eligibility.allowed) return await refuse(eligibility.reason ?? 'NOT_ELIGIBLE');

  // 3. Which channels can carry it right now.
  const identities = await deps.identities.listUsableIdentities(input.workspaceId, input.contactId);
  const configuredChannels = (Object.keys(deps.channels) as MessagingChannelName[])
    .filter((name) => deps.channels[name]);

  const candidates = selectChannels({
    identities,
    replyWindowExpiresAt: facts.replyWindowExpiresAt,
    configuredChannels,
    preferenceOrder: deps.preferenceOrder,
    preferredChannel: input.preferredChannel,
    now: now(),
  });

  if (candidates.length === 0) {
    // Distinct from a failure: retrying changes nothing. A salesperson on a
    // live call needs to hear this so they can offer another way instead of
    // promising a message that will never arrive.
    return {
      outcome: 'unreachable', channel: null, providerMessageId: null,
      deliveryId: null, reason: 'NO_USABLE_CHANNEL',
    };
  }

  let lastResult: SendOutboundMessageResult | null = null;

  for (const identity of candidates) {
    const channel = deps.channels[identity.channel];
    if (!channel) continue;

    const sideEffectAuthorization = await deps.sideEffectAuthorizer.authorize({
      workspaceId: input.workspaceId,
      contactId: input.contactId,
      channel: identity.channel,
      destination: identity.destination,
      purpose: input.purpose,
    });
    if (!sideEffectAuthorization.allowed) return await refuse(sideEffectAuthorization.reason);

    // 4. Idempotency, before anything is written.
    //
    // The ledger's UNIQUE (provider, integration_id, idempotency_key) is the
    // real guarantee, but it must be *consulted* first rather than only caught:
    // creating the outbound message row up front would leave an orphan message
    // behind on every replay, and the contact's history would fill with
    // messages that were never sent.
    const existing = await findDeliveryByKey(db, channel.provider, channel.integrationId, input.idempotencyKey);
    const replay = existing ? replayResult(existing, identity.channel) : null;
    if (replay) return replay;

    let deliveryId = existing?.id ?? null;

    if (!deliveryId) {
      const conversationId = await resolveConversationId(db, input.contactId, identity.channel);
      if (!conversationId) {
        lastResult = { outcome: 'unreachable', channel: identity.channel, providerMessageId: null, deliveryId: null, reason: 'NO_CONVERSATION' };
        continue;
      }

      try {
        deliveryId = await reserveOutboundDelivery(db, {
          conversationId,
          contactId: input.contactId,
          text: input.text,
          idempotencyKey: input.idempotencyKey,
          provider: channel.provider,
          integrationId: channel.integrationId,
          channel: identity.channel,
          purpose: input.purpose,
          destination: identity.destination,
        });
      } catch (error) {
        // Lost a race against a concurrent request carrying the same key. The
        // constraint did its job; read the winner's row and defer to it rather
        // than sending a second message.
        if (!isUniqueViolation(error)) throw error;
        const winner = await findDeliveryByKey(db, channel.provider, channel.integrationId, input.idempotencyKey);
        if (!winner) throw error;
        const winnerReplay = replayResult(winner, identity.channel);
        if (winnerReplay) return winnerReplay;
        deliveryId = winner.id;
      }
    }

    // The lease is what makes "exactly one send" true, not the unique
    // constraint alone. Two requests sharing a key both reach this row: the
    // constraint stops the second from creating a *second* row, but nothing
    // stops it from sending against the same one. Only one UPDATE can move the
    // row out of 'pending', so whoever loses must not contact the provider.
    const leased = await db<Array<{ id: string }>>`
      UPDATE outbound_deliveries
      SET state = 'leased',
          leased_by = ${`direct:${input.idempotencyKey}`},
          lease_until = now() + interval '1 minute',
          attempt_count = attempt_count + 1
      WHERE id = ${deliveryId}::uuid AND state IN ('pending', 'failed_retryable')
      RETURNING id
    `;

    if (leased.length === 0) {
      const concurrent = await readSettledDelivery(db, deliveryId);
      const settledReplay = concurrent
        ? replayResult({ id: deliveryId, ...concurrent }, identity.channel)
        : null;
      if (settledReplay) return settledReplay;
      // Another request holds the lease and is talking to the provider right
      // now. Sending too would duplicate the message; claiming success would
      // assert an outcome that is not ours to report.
      return {
        outcome: 'retryable', channel: identity.channel, providerMessageId: null,
        deliveryId, reason: 'CONCURRENT_SEND_IN_PROGRESS',
      };
    }

    const providerResult = await attemptSend(channel, identity.destination, input);
    const decision = decideDeliveryOutcome(providerResult);

    if (decision.retireIdentity) {
      await deps.identities.markIdentityUnusable(
        input.workspaceId, input.contactId, identity.channel,
        identity.destination, decision.reason ?? 'PERMANENT_REJECTION',
      );
    }
    if (decision.closeWindow) {
      await deps.identities.closeReplyWindow(input.workspaceId, input.contactId, identity.channel);
    }

    if (decision.tryNextChannel) {
      // Not a failure: the provider told us this channel is shut right now.
      // Leave the ledger row unsettled and try the next one.
      await db`
        UPDATE outbound_deliveries SET state = 'cancelled'
        WHERE id = ${deliveryId}::uuid AND state = 'leased'
      `;
      lastResult = {
        outcome: 'unreachable', channel: identity.channel, providerMessageId: null,
        deliveryId, reason: decision.reason,
      };
      continue;
    }

    await settleDelivery(db, deliveryId, decision.state!, {
      providerMessageId: providerResult.status === 'accepted' ? providerResult.providerMessageId : null,
      errorCode: decision.reason,
      retryAfterSeconds: decision.retryAfterSeconds,
    });

    return {
      outcome: decision.outcome!,
      channel: identity.channel,
      providerMessageId: providerResult.status === 'accepted' ? providerResult.providerMessageId : null,
      deliveryId,
      reason: decision.reason,
    };
  }

  return lastResult ?? {
    outcome: 'unreachable', channel: null, providerMessageId: null,
    deliveryId: null, reason: 'NO_USABLE_CHANNEL',
  };
}

async function attemptSend(
  channel: MessageChannel,
  destination: string,
  input: SendOutboundMessageInput,
) {
  try {
    const sent = await channel.sendText({
      destination, text: input.text, correlationId: input.idempotencyKey,
    });
    return { status: 'accepted' as const, providerMessageId: sent.providerMessageId };
  } catch (error) {
    if (error instanceof ConfirmedChannelError) {
      return {
        status: 'failed' as const, kind: error.kind, code: error.code,
        retryAfterSeconds: error.retryAfterSeconds,
      };
    }
    if (error instanceof AmbiguousChannelError) {
      return { status: 'ambiguous' as const, code: error.code };
    }
    // An unrecognised throw is not evidence the message failed to arrive.
    // Treating it as definitive would invite a duplicate resend.
    return { status: 'ambiguous' as const, code: 'CHANNEL_SEND_AMBIGUOUS' };
  }
}

async function resolveConversationId(
  db: DbClient,
  contactId: string,
  channel: MessagingChannelName,
): Promise<string | null> {
  const rows = await db<Array<{ id: string }>>`
    SELECT id FROM conversations
    WHERE contact_id = ${contactId}::uuid AND channel = ${channel}
    ORDER BY last_turn_at DESC
    LIMIT 1
  `;
  return rows[0]?.id ?? null;
}

async function reserveOutboundDelivery(
  db: DbClient,
  args: {
    conversationId: string;
    contactId: string;
    text: string;
    idempotencyKey: string;
    provider: string;
    integrationId: string;
    channel: MessagingChannelName;
    purpose: SendOutboundMessageInput['purpose'];
    destination: string;
  },
): Promise<string> {
  // One PostgreSQL statement makes message + delivery reservation atomic. If
  // the delivery UNIQUE loses a race, the inserted message rolls back too.
  const rows = await db<Array<{ delivery_id: string }>>`
    WITH inserted_message AS (
      INSERT INTO messages (conversation_id, contact_id, direction, content, metadata)
      VALUES (
        ${args.conversationId}::uuid,
        ${args.contactId}::uuid,
        'outbound',
        ${args.text},
        ${jsonbParam(db, { origin: 'direct_outbound', idempotency_key: args.idempotencyKey })}
      )
      RETURNING id
    )
    SELECT queued.delivery_id
    FROM inserted_message AS message
    CROSS JOIN LATERAL enqueue_outbound_delivery(
      message.id,
      ${args.provider},
      ${args.integrationId},
      ${args.channel},
      ${args.purpose},
      ${args.destination},
      ${args.idempotencyKey},
      ${jsonbParam(db, { text: args.text, purpose: args.purpose })},
      ${3}
    ) AS queued
  `;
  return rows[0].delivery_id;
}

interface LedgerRow {
  id: string;
  state: string;
  provider_message_id: string | null;
  last_error_code: string | null;
}

async function findDeliveryByKey(
  db: DbClient,
  provider: string,
  integrationId: string,
  idempotencyKey: string,
): Promise<LedgerRow | null> {
  const rows = await db<LedgerRow[]>`
    SELECT id, state, provider_message_id, last_error_code
    FROM outbound_deliveries
    WHERE provider = ${provider}
      AND integration_id = ${integrationId}
      AND idempotency_key = ${idempotencyKey}
  `;
  return rows[0] ?? null;
}

/**
 * What a repeated request should be told about an already-settled delivery.
 *
 * Null means the row is not settled — a previous attempt failed retryably — so
 * the caller continues on that same row rather than opening a second one.
 */
function replayResult(
  row: LedgerRow,
  channel: MessagingChannelName,
): SendOutboundMessageResult | null {
  if (row.state === 'submitted' || row.state === 'delivered') {
    return {
      outcome: 'sent', channel,
      providerMessageId: row.provider_message_id, deliveryId: row.id, reason: null,
    };
  }
  if (row.state === 'dead_letter') {
    return {
      outcome: 'permanent', channel, providerMessageId: null,
      deliveryId: row.id, reason: row.last_error_code ?? 'PREVIOUSLY_DEAD_LETTERED',
    };
  }
  return null;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null
    && (error as { code?: string }).code === '23505';
}

async function readSettledDelivery(db: DbClient, deliveryId: string) {
  const rows = await db<Array<{
    state: string; provider_message_id: string | null; last_error_code: string | null;
  }>>`
    SELECT state, provider_message_id, last_error_code
    FROM outbound_deliveries WHERE id = ${deliveryId}::uuid
  `;
  return rows[0] ?? null;
}

async function settleDelivery(
  db: DbClient,
  deliveryId: string,
  state: string,
  args: { providerMessageId: string | null; errorCode: string | null; retryAfterSeconds: number | null },
) {
  const retryInterval = args.retryAfterSeconds ?? 30;
  await db`
    UPDATE outbound_deliveries
    SET state = ${state},
        provider_message_id = COALESCE(${args.providerMessageId}, provider_message_id),
        submitted_at = CASE WHEN ${state} = 'submitted' THEN now() ELSE submitted_at END,
        last_error_code = ${args.errorCode},
        next_attempt_at = CASE
          WHEN ${state} = 'failed_retryable'
          THEN now() + make_interval(secs => ${retryInterval})
          ELSE next_attempt_at END,
        lease_until = NULL,
        leased_by = NULL
    WHERE id = ${deliveryId}::uuid
  `;
}
