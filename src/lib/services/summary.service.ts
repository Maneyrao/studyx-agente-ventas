import { sql } from '@/lib/db/orchestrator';
import { auditLog } from '@/lib/audit/logger';
import { logger } from '@/lib/observability/structured-log';
import { counter } from '@/lib/observability/counters';
import { config } from '@/lib/config';

const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const SUMMARY_TIMEOUT_MS = 20000;

/**
 * Summaries are deliberately disabled until they have their own durable,
 * fenced queue. The request path never invokes this module; keeping that
 * decision explicit avoids presenting a stale summary as active memory.
 */
export const SUMMARY_MODE: 'disabled_pending_durable_queue' | 'enabled' = 'disabled_pending_durable_queue';

interface GeminiGenerateResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: unknown }> };
  }>;
}

async function generateSummaryText(prompt: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set');

  const model = config.summaryModel;
  const url = `${GEMINI_BASE_URL}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 300,
      responseMimeType: 'text/plain',
    },
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SUMMARY_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`GEMINI_SUMMARY_HTTP_${response.status}${detail ? `:${detail.slice(0, 200)}` : ''}`);
  }

  const payload = (await response.json()) as GeminiGenerateResponse;
  const parts = payload?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts) || parts.length === 0) return '';
  const text = parts
    .map((p) => (p && typeof p.text === 'string' ? p.text : ''))
    .join('')
    .trim();
  return text;
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

export interface RegeneratedSummary {
  summary: string;
  version: number;
  summary_updated_at: string;
}

export async function regenerateSummary(contact_id: string): Promise<RegeneratedSummary> {
  if (SUMMARY_MODE !== 'enabled') {
    throw new Error('SUMMARY_DISABLED_PENDING_DURABLE_QUEUE');
  }
  const messages = await getContactRecentMessages(contact_id);

  const prompt = buildSummaryPrompt(messages);
  const summary = await generateSummaryText(prompt);

  const rows = await sql<Array<{ summary_version: number; summary_updated_at: string }>>`
    UPDATE contacts
    SET
      summary = ${summary},
      summary_updated_at = now(),
      summary_version = summary_version + 1,
      pending_turns = 0
    WHERE id = ${contact_id}
    RETURNING summary_version, summary_updated_at
  `;

  const row = rows[0];
  if (!row) throw new Error(`Contact not found: ${contact_id}`);

  await auditLog({
    action: 'contact.summary_regenerated',
    entity_type: 'contact',
    entity_id: contact_id,
    payload: { model: config.summaryModel, version: row.summary_version },
  });

  counter.increment('summaries_regenerated');
  logger.info({
    event: 'summary.regenerated',
    contact_id,
    model: config.summaryModel,
    version: row.summary_version,
  });

  return {
    summary,
    version: row.summary_version,
    summary_updated_at: row.summary_updated_at,
  };
}
