import type { DbClient } from '@/lib/db/types';
import { jsonbParam } from '@/lib/db/json';
import type { InboundEnvelope } from './ingestion.service';

export class ChannelIdentityConflictError extends Error {
  readonly code = 'CHANNEL_IDENTITY_CONFLICT';
  constructor() { super('The provider conversation is already bound to another identity'); this.name = 'ChannelIdentityConflictError'; }
}

/** Resolve a transport alias only through an exact tenant/account/contact proof. */
export async function resolveInboundChannelThread(input: {
  db: DbClient; envelope: InboundEnvelope; contactId: string; provider: string;
  channel: string; workspaceSlug: string; occurredAt: string;
}): Promise<{ id: string }> {
  const { db, envelope, contactId, provider, channel, workspaceSlug, occurredAt } = input;
  // Route chronology uses the actual provider timestamp even when an old
  // event falls outside the business-order trust window. Redating such an
  // event to receipt time must not revive its retired transport destination.
  const providerMs = Date.parse(envelope.message.occurred_at);
  const destinationObservedAt = Number.isFinite(providerMs) && providerMs <= Date.now() + 120_000
    ? new Date(providerMs).toISOString() : occurredAt;
  const rawAccount = envelope.message.metadata?.bot_phone_number_id;
  const account = provider === 'botpress' && envelope.channel === 'whatsapp'
    && typeof rawAccount === 'string' && rawAccount.trim() ? rawAccount.trim() : null;
  const [workspace] = await db<Array<{ id: string }>>`SELECT workspace.id FROM workspaces workspace
    JOIN workspace_contacts membership ON membership.workspace_id = workspace.id
    WHERE workspace.slug = ${workspaceSlug} AND workspace.status = 'active'
      AND membership.contact_id = ${contactId}::uuid`;
  if (!workspace) throw new ChannelIdentityConflictError();
  const [alias] = await db<Array<{ canonical_thread_id: string; contact_id: string; workspace_id: string;
    channel: string; bot_phone_number_id: string }>>`SELECT * FROM channel_thread_aliases
    WHERE provider = ${provider} AND integration_id = ${envelope.integration_id}
      AND external_conversation_id = ${envelope.external_conversation_id}`;
  if (alias && (alias.contact_id !== contactId || alias.workspace_id !== workspace.id
    || alias.channel !== channel || alias.bot_phone_number_id !== account)) throw new ChannelIdentityConflictError();

  const binding = account ? (await db<Array<{ canonical_thread_id: string }>>`
    SELECT canonical_thread_id FROM channel_account_thread_bindings
    WHERE workspace_id = ${workspace.id}::uuid AND contact_id = ${contactId}::uuid
      AND provider = ${provider} AND integration_id = ${envelope.integration_id}
      AND channel = ${channel} AND bot_phone_number_id = ${account}`)[0] : undefined;
  if (alias && alias.canonical_thread_id !== binding?.canonical_thread_id) throw new ChannelIdentityConflictError();
  const metadata = { external_user_id: envelope.external_user_id,
    ...(envelope.botpress_conversation_id ? { botpress_conversation_id: envelope.botpress_conversation_id } : {}),
    ...(envelope.botpress_user_id ? { botpress_user_id: envelope.botpress_user_id } : {}),
    ...(account ? { bot_phone_number_id: account, destination_observed_at: destinationObservedAt } : {}) };
  let threadId = binding?.canonical_thread_id;
  if (!threadId) {
    const [thread] = await db<Array<{ id: string }>>`INSERT INTO channel_threads
      (contact_id, provider, integration_id, channel, external_conversation_id, metadata)
      VALUES (${contactId}::uuid, ${provider}, ${envelope.integration_id}, ${channel},
        ${envelope.external_conversation_id}, ${jsonbParam(db, metadata)})
      ON CONFLICT (provider, integration_id, external_conversation_id) DO UPDATE SET last_seen_at = now(),
        metadata = COALESCE(channel_threads.metadata, '{}'::jsonb) || EXCLUDED.metadata
      WHERE channel_threads.contact_id = EXCLUDED.contact_id AND channel_threads.channel = EXCLUDED.channel
        AND (${account}::text IS NULL OR channel_threads.metadata->>'bot_phone_number_id' IS NULL
          OR channel_threads.metadata->>'bot_phone_number_id' = ${account})
      RETURNING id`;
    if (!thread) throw new ChannelIdentityConflictError();
    threadId = thread.id;
    if (account) await db`INSERT INTO channel_account_thread_bindings
      (workspace_id, contact_id, provider, integration_id, channel, bot_phone_number_id, canonical_thread_id, reason)
      VALUES (${workspace.id}::uuid, ${contactId}::uuid, ${provider}, ${envelope.integration_id}, ${channel},
        ${account}, ${threadId}::uuid, 'VERIFIED_INBOUND_ACCOUNT')`;
  } else {
    // Preserve the immutable original external identity. Only the current route changes.
    // Older provider events must never restore a deleted Botpress destination.
    await db`UPDATE channel_threads SET last_seen_at = now(),
      metadata = CASE WHEN COALESCE(metadata->>'destination_observed_at', first_seen_at::text)::timestamptz < ${destinationObservedAt}::timestamptz
        THEN COALESCE(metadata, '{}'::jsonb) || ${jsonbParam(db, metadata)} ELSE metadata END
      WHERE id = ${threadId}::uuid`;
  }
  if (account && !alias) await db`INSERT INTO channel_thread_aliases
    (provider, integration_id, external_conversation_id, workspace_id, contact_id, channel, bot_phone_number_id, canonical_thread_id)
    VALUES (${provider}, ${envelope.integration_id}, ${envelope.external_conversation_id}, ${workspace.id}::uuid,
      ${contactId}::uuid, ${channel}, ${account}, ${threadId}::uuid)`;
  return { id: threadId };
}
