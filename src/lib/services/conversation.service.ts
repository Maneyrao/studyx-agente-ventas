import { sql } from '@/lib/db/orchestrator';
import { auditLog } from '@/lib/audit/logger';
import { logger } from '@/lib/observability/structured-log';
import type { DbClient } from '@/lib/db/types';

export interface Conversation {
  id: string;
  contact_id: string;
  channel: 'whatsapp' | 'voice';
  status: 'open' | 'closed';
  current_intent: string | null;
  started_at: string;
  last_turn_at: string;
  created_at: string;
  channel_thread_id: string | null;
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
  channel_thread_id?: string | null;
  db?: DbClient;
}): Promise<Conversation> {
  const { contact_id, channel, channel_thread_id = null, db = sql } = params;

  const contacts = await db`SELECT id FROM contacts WHERE id = ${contact_id} AND deleted_at IS NULL LIMIT 1`;
  if (contacts.length === 0) throw new ContactNotFoundError(contact_id);

  const rows = await db<Conversation[]>`
    INSERT INTO conversations (contact_id, channel, channel_thread_id)
    VALUES (${contact_id}, ${channel}, ${channel_thread_id})
    RETURNING *
  `;
  const conversation = rows[0];

  logger.info({ event: 'conversation.created', conversation_id: conversation.id, contact_id, channel });

  await auditLog({
    action: 'conversation.created',
    entity_type: 'conversation',
    entity_id: conversation.id,
    payload: { contact_id, channel },
  }, db);

  return conversation;
}

export async function updateConversation(
  id: string,
  updates: { status?: 'open' | 'closed'; current_intent?: string },
  db: DbClient = sql
): Promise<Conversation> {
  const rows = await db<Conversation[]>`
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
  }, db);

  return conversation;
}

export async function updateLastTurn(id: string, db: DbClient = sql): Promise<void> {
  await db`UPDATE conversations SET last_turn_at = now() WHERE id = ${id}`;
}

export async function getConversation(id: string, db: DbClient = sql): Promise<Conversation> {
  const rows = await db<Conversation[]>`SELECT * FROM conversations WHERE id = ${id} LIMIT 1`;
  if (rows.length === 0) throw new ConversationNotFoundError(id);
  return rows[0];
}

export async function findOpenConversation(
  contact_id: string,
  channel: 'whatsapp' | 'voice',
  db: DbClient = sql,
  channel_thread_id?: string | null
): Promise<Conversation | null> {
  const rows = await db<Conversation[]>`
    SELECT * FROM conversations
    WHERE contact_id = ${contact_id}
      AND channel = ${channel}
      AND status = 'open'
      AND (${channel_thread_id ?? null}::uuid IS NULL OR channel_thread_id = ${channel_thread_id ?? null})
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function getOrCreateOpenConversation(
  contact_id: string,
  channel: 'whatsapp' | 'voice',
  options: { db?: DbClient; channel_thread_id?: string | null } = {}
): Promise<Conversation> {
  const { db = sql, channel_thread_id = null } = options;

  // Both partial unique indexes are serialization points. If concurrent callers
  // race, only one inserts and every caller reads the same open conversation.
  const inserted = await db<Conversation[]>`
    INSERT INTO conversations (contact_id, channel, channel_thread_id)
    VALUES (${contact_id}, ${channel}, ${channel_thread_id})
    ON CONFLICT (contact_id, channel) WHERE status = 'open'
    DO NOTHING
    RETURNING *
  `;
  if (inserted[0]) {
    await auditLog({
      action: 'conversation.created',
      entity_type: 'conversation',
      entity_id: inserted[0].id,
      payload: { contact_id, channel, channel_thread_id },
    }, db);
    return inserted[0];
  }

  const existing = await findOpenConversation(contact_id, channel, db, channel_thread_id);
  if (existing) return existing;
  throw new Error('Open conversation conflict could not be resolved');
}
