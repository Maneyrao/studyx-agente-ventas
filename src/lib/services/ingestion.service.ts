import { resolveContact, Contact } from './contact.service';
import { getOrCreateOpenConversation } from './conversation.service';
import { registerMessage, getMessageById, MessageNotFoundError, Message } from './message.service';
import { getRecentMessages, semanticSearch, SearchResult } from './memory.service';
import { regenerateSummary } from './summary.service';
import { referencesPast } from '@/lib/heuristics/reference-detection';
import { isTrivial } from '@/lib/heuristics/triviality';
import { config } from '@/lib/config';
import { logger } from '@/lib/observability/structured-log';
import { counter } from '@/lib/observability/counters';
import { sql } from '@/lib/db/orchestrator';

export class TurnNotFoundError extends Error {
  readonly code = 'TURN_NOT_FOUND';
  constructor(turn_id: string) {
    super(`Turn not found or not inbound: ${turn_id}`);
    this.name = 'TurnNotFoundError';
  }
}

export class TurnAlreadyAnsweredError extends Error {
  readonly code = 'TURN_ALREADY_ANSWERED';
  constructor(turn_id: string) {
    super(`Turn already has a reply: ${turn_id}`);
    this.name = 'TurnAlreadyAnsweredError';
  }
}

export interface AgentReplyResult {
  message: Message;
  summary_regenerated: boolean;
  pending_turns: number;
}

export interface ContactContext {
  id: string;
  status: 'prospecto' | 'cliente' | 'inactivo';
  name: string | null;
  blocked: boolean;
  summary: string | null;
  summary_updated_at: string | null;
}

export interface IngestContext {
  turn_id: string;
  contact: ContactContext;
  recent_turns: Pick<Message, 'direction' | 'content' | 'created_at'>[];
  long_term_memory: Pick<SearchResult, 'content' | 'similarity' | 'created_at'>[] | null;
  long_term_memory_available: boolean;
}

export async function processInboundMessage(params: {
  phone: string;
  content: string;
  channel: 'whatsapp' | 'voice';
}): Promise<IngestContext> {
  const { phone, content, channel } = params;

  const { contact } = await resolveContact({ phone, channel });
  const conversation = await getOrCreateOpenConversation(contact.id, channel);

  const { message: inbound } = await registerMessage({
    conversation_id: conversation.id,
    direction: 'inbound',
    content,
  });

  const { messages: recentMessages } = await getRecentMessages({
    conversation_id: conversation.id,
    limit: config.recentTurnsLimit,
  });

  const recent_turns = recentMessages.map((m) => ({
    direction: m.direction,
    content: m.content,
    created_at: m.created_at,
  }));

  let long_term_memory: IngestContext['long_term_memory'] = null;
  let long_term_memory_available = true;

  // FR-006: un mensaje trivial (saludo/ack/agradecimiento) NUNCA dispara búsqueda
  // vectorial, aunque contenga un marcador de referencia. La trivialidad se evalúa
  // PRIMERO como short-circuit, de modo que SC-001 (cero búsquedas en turnos triviales)
  // se cumple siempre, sin importar el contenido.
  const trivial = isTrivial(content);
  const shouldRetrieveMemory = !trivial && referencesPast(content);

  if (shouldRetrieveMemory) {
    try {
      const { results } = await semanticSearch({
        contact_id: contact.id,
        query: content,
        limit: config.ltmResultsLimit,
      });
      long_term_memory = results.map((r) => ({
        content: r.content,
        similarity: r.similarity,
        created_at: r.created_at,
      }));
    } catch (err) {
      long_term_memory_available = false;
      logger.error({ event: 'ingestion.long_term_memory.failed', contact_id: contact.id, error: String(err) });
      counter.increment('ingest_long_term_memory_errors');
    }
  }

  counter.increment('ingest_processed');

  logger.info({
    event: 'ingestion.processed',
    contact_id: contact.id,
    conversation_id: conversation.id,
    turn_id: inbound.id,
    trivial,
    memory_search_attempted: shouldRetrieveMemory,
    long_term_memory_available,
  });

  return {
    turn_id: inbound.id,
    contact: {
      id: contact.id,
      status: contact.status,
      name: contact.name,
      // C1 / Edge case opt-out: señal explícita para que el agente NO continúe la
      // conversación comercial cuando el contacto está inactivo/bloqueado.
      blocked: contact.status === 'inactivo',
      summary: contact.summary,
      summary_updated_at: contact.summary_updated_at,
    },
    recent_turns,
    long_term_memory,
    long_term_memory_available,
  };
}

export async function registerAgentReply(params: {
  turn_id: string;
  content: string;
}): Promise<AgentReplyResult> {
  const { turn_id, content } = params;

  // Validate that the turn exists and is an inbound message in an open conversation
  let inbound: Message;
  try {
    inbound = await getMessageById(turn_id);
  } catch (err) {
    if (err instanceof MessageNotFoundError) throw new TurnNotFoundError(turn_id);
    throw err;
  }

  if (inbound.direction !== 'inbound') throw new TurnNotFoundError(turn_id);

  // Register outbound (unique index prevents double-answering the same turn)
  let outbound: Message;
  try {
    const result = await registerMessage({
      conversation_id: inbound.conversation_id,
      direction: 'outbound',
      content,
      in_reply_to: turn_id,
    });
    outbound = result.message;
  } catch (err) {
    // Unique index violation = turn already answered
    const msg = String(err);
    if (msg.includes('messages_in_reply_to_unique') || msg.includes('unique') || msg.includes('duplicate')) {
      throw new TurnAlreadyAnsweredError(turn_id);
    }
    throw err;
  }

  // Increment pending_turns and read back the new count
  const updated = await sql<{ contact_id: string; pending_turns: number }[]>`
    UPDATE contacts
    SET pending_turns = pending_turns + 1
    WHERE id = ${inbound.contact_id}
    RETURNING id AS contact_id, pending_turns
  `;
  const pending_turns = updated[0]?.pending_turns ?? 0;

  counter.increment('replies_registered');

  // Regenerate summary if threshold crossed and turn is non-trivial
  let summary_regenerated = false;

  if (pending_turns >= config.summaryThreshold && !isTrivial(inbound.content)) {
    try {
      await regenerateSummary(inbound.contact_id);
      await sql`UPDATE contacts SET pending_turns = 0 WHERE id = ${inbound.contact_id}`;
      summary_regenerated = true;
    } catch (err) {
      logger.error({ event: 'ingestion.summary_regeneration.failed', contact_id: inbound.contact_id, error: String(err) });
    }
  }

  logger.info({
    event: 'ingestion.reply_registered',
    turn_id,
    outbound_id: outbound.id,
    contact_id: inbound.contact_id,
    pending_turns,
    summary_regenerated,
  });

  return {
    message: outbound,
    summary_regenerated,
    pending_turns: summary_regenerated ? 0 : pending_turns,
  };
}
