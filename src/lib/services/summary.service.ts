import OpenAI from 'openai';
import { sql } from '@/lib/db/orchestrator';
import { auditLog } from '@/lib/audit/logger';
import { logger } from '@/lib/observability/structured-log';
import { counter } from '@/lib/observability/counters';
import { config } from '@/lib/config';

let openai: OpenAI | null = null;

function getOpenAIClient(): OpenAI {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not set');
  openai ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return openai;
}

interface RecentMessage {
  direction: 'inbound' | 'outbound';
  content: string;
  created_at: string;
}

async function getContactRecentMessages(contact_id: string): Promise<RecentMessage[]> {
  return sql<RecentMessage[]>`
    SELECT direction, content, created_at
    FROM messages
    WHERE contact_id = ${contact_id}
    ORDER BY created_at DESC
    LIMIT 30
  `;
}

function buildSummaryPrompt(messages: RecentMessage[]): string {
  const turns = messages
    .slice()
    .reverse()
    .map((m) => `${m.direction === 'inbound' ? 'Prospecto' : 'Agente'}: ${m.content}`)
    .join('\n');

  return `Eres un asistente que genera resúmenes compactos y fieles de conversaciones de ventas.
Usa SOLO la información de los mensajes proporcionados. No inventes datos, precios ni cursos que no aparezcan en la conversación.

Conversación:
${turns}

Genera un resumen en 2-4 oraciones que capture: intereses del prospecto, objeciones expresadas, datos que compartió y estado comercial actual. Solo datos reales de la conversación.`;
}

export async function regenerateSummary(contact_id: string): Promise<string> {
  const messages = await getContactRecentMessages(contact_id);

  const prompt = buildSummaryPrompt(messages);

  const response = await getOpenAIClient().chat.completions.create({
    model: config.summaryModel,
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 300,
    temperature: 0.3,
  });

  const summary = response.choices[0]?.message?.content?.trim() ?? '';

  await sql`
    UPDATE contacts
    SET summary = ${summary}, summary_updated_at = now()
    WHERE id = ${contact_id}
  `;

  await auditLog({
    action: 'contact.summary_regenerated',
    entity_type: 'contact',
    entity_id: contact_id,
    payload: { model: config.summaryModel },
  });

  counter.increment('summaries_regenerated');
  logger.info({ event: 'summary.regenerated', contact_id, model: config.summaryModel });

  return summary;
}
