import { sql } from '@/lib/db/orchestrator';
import { auditLog } from '@/lib/audit/logger';
import { logger } from '@/lib/observability/structured-log';

export interface Conversation {
  id: string;
  contact_id: string;
  channel: 'whatsapp' | 'voice';
  status: 'open' | 'closed' | 'transferred';
  current_intent: string | null;
  started_at: string;
  last_turn_at: string;
  created_at: string;
}

export class ConversationNotFoundError extends Error {
  readonly code = 'CONVERSATION_NOT_FOUND';
  constructor(id: string) {
    super(`Conversation not found: ${id}`);
    this.name = 'ConversationNotFoundError';
  }
}

export class ContactNotFoundError extends Error {
  readonly code = 'CONTACT_NOT_FOUND';
  constructor(id: string) {
    super(`Contact not found: ${id}`);
    this.name = 'ContactNotFoundError';
  }
}

export async function createConversation(params: {
  contact_id: string;
  channel: 'whatsapp' | 'voice';
}): Promise<Conversation> {
  const { contact_id, channel } = params;

  const contacts = await sql`SELECT id FROM contacts WHERE id = ${contact_id} AND deleted_at IS NULL LIMIT 1`;
  if (contacts.length === 0) throw new ContactNotFoundError(contact_id);

  const rows = await sql<Conversation[]>`
    INSERT INTO conversations (contact_id, channel)
    VALUES (${contact_id}, ${channel})
    RETURNING *
  `;
  const conversation = rows[0];

  logger.info({ event: 'conversation.created', conversation_id: conversation.id, contact_id, channel });

  await auditLog({
    action: 'conversation.created',
    entity_type: 'conversation',
    entity_id: conversation.id,
    payload: { contact_id, channel },
  });

  return conversation;
}

export async function updateConversation(
  id: string,
  updates: { status?: 'open' | 'closed' | 'transferred'; current_intent?: string }
): Promise<Conversation> {
  const rows = await sql<Conversation[]>`
    UPDATE conversations
    SET
      status = COALESCE(${updates.status ?? null}, status),
      current_intent = COALESCE(${updates.current_intent ?? null}, current_intent)
    WHERE id = ${id}
    RETURNING *
  `;
  if (rows.length === 0) throw new ConversationNotFoundError(id);

  const conversation = rows[0];

  logger.info({ event: 'conversation.updated', conversation_id: id, updates });

  await auditLog({
    action: 'conversation.updated',
    entity_type: 'conversation',
    entity_id: id,
    payload: updates,
  });

  return conversation;
}

export async function updateLastTurn(id: string): Promise<void> {
  await sql`UPDATE conversations SET last_turn_at = now() WHERE id = ${id}`;
}

export async function getConversation(id: string): Promise<Conversation> {
  const rows = await sql<Conversation[]>`SELECT * FROM conversations WHERE id = ${id} LIMIT 1`;
  if (rows.length === 0) throw new ConversationNotFoundError(id);
  return rows[0];
}

export async function findOpenConversation(
  contact_id: string,
  channel: 'whatsapp' | 'voice'
): Promise<Conversation | null> {
  const rows = await sql<Conversation[]>`
    SELECT * FROM conversations
    WHERE contact_id = ${contact_id}
      AND channel = ${channel}
      AND status = 'open'
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function getOrCreateOpenConversation(
  contact_id: string,
  channel: 'whatsapp' | 'voice'
): Promise<Conversation> {
  const existing = await findOpenConversation(contact_id, channel);
  if (existing) return existing;
  return createConversation({ contact_id, channel });
}
