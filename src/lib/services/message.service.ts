import { z } from 'zod';
import { sql } from '@/lib/db/orchestrator';
import { auditLog } from '@/lib/audit/logger';
import { logger } from '@/lib/observability/structured-log';
import { counter } from '@/lib/observability/counters';
import { generateDocumentEmbedding } from '@/lib/embeddings/gemini';
import { jsonbParam } from '@/lib/db/json';
import { updateLastTurn, getConversation, ConversationNotFoundError } from './conversation.service';
import type { DbClient } from '@/lib/db/types';

export const registerMessageSchema = z.object({
  conversation_id: z.string().uuid(),
  direction: z.enum(['inbound', 'outbound']),
  content: z.string().min(1).max(4096),
  in_reply_to: z.string().uuid().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  source_event_id: z.string().uuid().optional(),
});

export type RegisterMessageInput = z.infer<typeof registerMessageSchema>;

export interface Message {
  id: string;
  conversation_id: string;
  contact_id: string;
  direction: 'inbound' | 'outbound';
  content: string;
  in_reply_to: string | null;
  metadata: unknown;
  created_at: string;
  source_event_id: string | null;
}

export class MessageNotFoundError extends Error {
  readonly code = 'MESSAGE_NOT_FOUND';
  constructor(id: string) {
    super(`Message not found: ${id}`);
    this.name = 'MessageNotFoundError';
  }
}

export async function getMessageById(id: string, db: DbClient = sql): Promise<Message> {
  const rows = await db<Message[]>`SELECT * FROM messages WHERE id = ${id} LIMIT 1`;
  if (rows.length === 0) throw new MessageNotFoundError(id);
  return rows[0];
}

export async function registerMessage(
  input: RegisterMessageInput,
  options: {
    db?: DbClient;
    embedding?: 'sync' | 'enqueue' | 'skip';
    audit?: {
      event_key?: string;
      correlation_id?: string;
      causation_id?: string;
      source_event_id?: string;
    };
  } = {}
): Promise<{ message: Message; embedding_status: 'indexed' | 'pending' }> {
  const { conversation_id, direction, content, metadata, source_event_id } = input;
  const { db = sql, embedding = 'sync', audit } = options;

  const conversation = await getConversation(conversation_id, db);
  if (conversation.status !== 'open') {
    throw new ConversationNotFoundError(conversation_id);
  }

  const { in_reply_to } = input;

  const rows = await db<Message[]>`
    INSERT INTO messages (conversation_id, contact_id, direction, content, in_reply_to, metadata, source_event_id)
    VALUES (
      ${conversation_id},
      ${conversation.contact_id},
      ${direction},
      ${content},
      ${in_reply_to ?? null},
      ${jsonbParam(db, metadata)},
      ${source_event_id ?? null}::uuid
    )
    RETURNING *
  `;
  const message = rows[0];

  // I1 fix: increment messages_registered immediately after INSERT, before embedding attempt
  counter.increment('messages_registered');

  await updateLastTurn(conversation_id, db);

  let embedding_status: 'indexed' | 'pending' = 'pending';

  if (embedding === 'enqueue') {
    await db`
      INSERT INTO message_embeddings (message_id, contact_id, embedding, status)
      VALUES (${message.id}, ${message.contact_id}, NULL, 'pending')
      ON CONFLICT (message_id) DO NOTHING
    `;
    counter.increment('pending_embeddings');
  } else if (embedding === 'sync') try {
    const embedding = await generateDocumentEmbedding({ title: 'message', text: content, kind: 'message' });
    await db`
      INSERT INTO message_embeddings (message_id, contact_id, embedding, status)
      VALUES (${message.id}, ${message.contact_id}, ${JSON.stringify(embedding)}::extensions.vector, 'indexed')
    `;
    embedding_status = 'indexed';
  } catch (embeddingError) {
    logger.warn({
      event: 'message.embedding.failed',
      message_id: message.id,
      error: String(embeddingError),
    });
    await db`
      INSERT INTO message_embeddings (message_id, contact_id, embedding, status)
      VALUES (${message.id}, ${message.contact_id}, NULL, 'pending')
    `.catch((insertError) => {
      logger.error({
        event: 'message.embedding_job.failed',
        message_id: message.id,
        error: String(insertError),
      });
    });
    counter.increment('pending_embeddings');
  }

  logger.info({
    event: 'message.registered',
    message_id: message.id,
    conversation_id,
    direction,
    embedding_status,
  });

  await auditLog({
    action: 'message.registered',
    entity_type: 'message',
    entity_id: message.id,
    payload: { conversation_id, direction, embedding_status },
    ...audit,
  }, db);

  return { message, embedding_status };
}
