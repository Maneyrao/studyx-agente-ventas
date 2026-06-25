import { z } from 'zod';
import { sql } from '@/lib/db/orchestrator';
import { auditLog } from '@/lib/audit/logger';
import { logger } from '@/lib/observability/structured-log';
import { counter } from '@/lib/observability/counters';
import { generateEmbedding } from '@/lib/embeddings/openai';
import { updateLastTurn, getConversation, ConversationNotFoundError } from './conversation.service';

export const registerMessageSchema = z.object({
  conversation_id: z.string().uuid(),
  direction: z.enum(['inbound', 'outbound']),
  content: z.string().min(1).max(4096),
  in_reply_to: z.string().uuid().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
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
}

export class MessageNotFoundError extends Error {
  readonly code = 'MESSAGE_NOT_FOUND';
  constructor(id: string) {
    super(`Message not found: ${id}`);
    this.name = 'MessageNotFoundError';
  }
}

export async function getMessageById(id: string): Promise<Message> {
  const rows = await sql<Message[]>`SELECT * FROM messages WHERE id = ${id} LIMIT 1`;
  if (rows.length === 0) throw new MessageNotFoundError(id);
  return rows[0];
}

export async function registerMessage(
  input: RegisterMessageInput
): Promise<{ message: Message; embedding_status: 'indexed' | 'pending' }> {
  const { conversation_id, direction, content, metadata } = input;

  const conversation = await getConversation(conversation_id);
  if (conversation.status !== 'open') {
    throw new ConversationNotFoundError(conversation_id);
  }

  const { in_reply_to } = input;

  const rows = await sql<Message[]>`
    INSERT INTO messages (conversation_id, contact_id, direction, content, in_reply_to, metadata)
    VALUES (
      ${conversation_id},
      ${conversation.contact_id},
      ${direction},
      ${content},
      ${in_reply_to ?? null},
      ${metadata ? JSON.stringify(metadata) : null}::jsonb
    )
    RETURNING *
  `;
  const message = rows[0];

  // I1 fix: increment messages_registered immediately after INSERT, before embedding attempt
  counter.increment('messages_registered');

  await updateLastTurn(conversation_id);

  let embedding_status: 'indexed' | 'pending' = 'pending';

  try {
    const embedding = await generateEmbedding(content);
    await sql`
      INSERT INTO message_embeddings (message_id, contact_id, embedding, status)
      VALUES (${message.id}, ${message.contact_id}, ${JSON.stringify(embedding)}::extensions.vector, 'indexed')
    `;
    embedding_status = 'indexed';
  } catch (embeddingError) {
    // console.error('EMBEDDING GENERATION FAILED:', embeddingError);
    await sql`
      INSERT INTO message_embeddings (message_id, contact_id, embedding, status)
      VALUES (${message.id}, ${message.contact_id}, array_fill(0, ARRAY[1536])::extensions.vector, 'pending')
    `.catch((insertError) => {
      // console.error('FALLBACK INSERT ALSO FAILED:', insertError);
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
  });

  return { message, embedding_status };
}
