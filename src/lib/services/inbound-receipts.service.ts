import { sql } from '@/lib/db/orchestrator';
import { loadBusinessWorkspaceConfig } from '@/lib/config';

export interface InboundReceiptsQuery {
  integration_id: string;
  external_conversation_id: string;
  channel: 'emulator' | 'whatsapp' | 'telegram';
  sandbox_provider?: 'telegram_sandbox' | null;
  external_message_ids: string[];
  workspaceSlug?: string;
}
export async function persistedInboundReceipts(query: InboundReceiptsQuery): Promise<string[]> {
  if (query.external_message_ids.length === 0) return [];
  const provider = query.sandbox_provider ?? (query.channel === 'emulator' ? 'botpress_emulator' : 'botpress');
  const workspace = query.workspaceSlug ?? loadBusinessWorkspaceConfig().workspaceSlug;
  const rows = await sql<Array<{ external_message_id: string }>>`
    SELECT DISTINCT event.external_message_id FROM channel_events event
    JOIN messages message ON message.source_event_id = event.id
    JOIN workspace_contacts membership ON membership.contact_id = message.contact_id
    JOIN workspaces workspace ON workspace.id = membership.workspace_id
    WHERE event.provider = ${provider} AND event.integration_id = ${query.integration_id}
      AND event.external_conversation_id = ${query.external_conversation_id}
      AND event.external_message_id = ANY(${query.external_message_ids}::text[])
      AND message.direction = 'inbound' AND event.status = 'processed'
      AND workspace.slug = ${workspace} AND workspace.status = 'active'
  `;
  return rows.map(row => row.external_message_id);
}
