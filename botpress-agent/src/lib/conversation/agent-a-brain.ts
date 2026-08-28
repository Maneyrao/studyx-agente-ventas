import {
  AgentATurnProposalV1Schema,
  type AgentAContextV1,
  type AgentATurnProposalV1,
} from '../../schemas/agent-a-brain';
import { buildAgentABrainInstructionsV1 } from '../../prompts/agent-a-brain-v1';

const GROQ_CHAT_COMPLETIONS_URL = 'https://api.groq.com/openai/v1/chat/completions';
export const DEFAULT_AGENT_A_BRAIN_MODEL = 'openai/gpt-oss-120b';
export const AGENT_A_BRAIN_DEADLINE_MS = 4_500;

export class AgentABrainError extends Error {
  constructor(public readonly code: string, public readonly status: number | null = null) {
    super(code);
    this.name = 'AgentABrainError';
  }
}

export interface GeneratedAgentATurnProposalV1 {
  readonly proposal: AgentATurnProposalV1;
  readonly provider: 'groq-direct';
  readonly model: string;
  readonly latency_ms: number;
  readonly attempt_count: 1 | 2;
}

const MOVE_KINDS = [
  'greeting', 'browse_catalog', 'select_area', 'select_course', 'ask_course_information',
  'continue_by_chat', 'request_call', 'decline_call', 'ask_payment_options',
  'select_payment_plan', 'defer_payment', 'request_payment_link', 'decline_purchase', 'unknown',
] as const;
const MEMORY_TYPES = [
  'study_goal', 'study_context', 'preference', 'constraint',
  'objection', 'timeline', 'contact_preference',
] as const;
const PAYMENT_PLANS = ['monthly_12', 'monthly_6', 'one_time'] as const;

function closedObject(properties: Record<string, unknown>) {
  return { type: 'object', properties, required: Object.keys(properties), additionalProperties: false };
}

function proposalJsonSchema(): unknown {
  const nullableString = { anyOf: [{ type: 'string' }, { type: 'null' }] };
  const move = closedObject({
    schema_version: { type: 'integer', enum: [1] },
    move: { type: 'string', enum: [...MOVE_KINDS] },
    secondary_moves: { type: 'array', maxItems: 2, items: { type: 'string', enum: [...MOVE_KINDS] } },
    vetoes: { type: 'array', maxItems: 3, items: { type: 'string', enum: ['call', 'payment_link', 'purchase'] } },
    course_reference: nullableString,
    area_reference: nullableString,
    payment_plan: { anyOf: [{ type: 'string', enum: [...PAYMENT_PLANS] }, { type: 'null' }] },
    confidence: { type: 'number' },
  });
  const proposedAction = {
    anyOf: [
      closedObject({ type: { type: 'string', enum: ['none'] } }),
      closedObject({
        type: { type: 'string', enum: ['request_call_now'] },
        reason: { type: 'string', enum: ['direct_request', 'accepted_offer'] },
      }),
      closedObject({
        type: { type: 'string', enum: ['send_payment_link'] },
        offering_code: { type: 'string' },
        payment_plan: { type: 'string', enum: [...PAYMENT_PLANS] },
      }),
    ],
  };
  return closedObject({
    schema_version: { type: 'integer', enum: [1] },
    move,
    response: closedObject({
      messages: { type: 'array', minItems: 1, maxItems: 3, items: { type: 'string' } },
    }),
    proposed_action: proposedAction,
    used_fact_ids: { type: 'array', maxItems: 32, items: { type: 'string' } },
    used_memory_ids: { type: 'array', maxItems: 5, items: { type: 'string' } },
    memory_candidates: {
      type: 'array',
      maxItems: 10,
      items: closedObject({
        type: { type: 'string', enum: [...MEMORY_TYPES] },
        key: { type: 'string' },
        value: { type: 'string' },
        source_quote: { type: 'string' },
        confidence: { type: 'number' },
      }),
    },
  });
}

function requestBody(context: AgentAContextV1, model: string): unknown {
  return {
    model,
    messages: [
      { role: 'system', content: buildAgentABrainInstructionsV1(context) },
      { role: 'user', content: 'Return only the single AgentATurnProposalV1 JSON object.' },
    ],
    temperature: 0.2,
    stream: false,
    max_completion_tokens: 1_500,
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'studyx_agent_a_turn_proposal_v1',
        strict: true,
        schema: proposalJsonSchema(),
      },
    },
  };
}

function extractContent(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const first = choices[0];
  if (!first || typeof first !== 'object') return null;
  const message = (first as { message?: unknown }).message;
  if (!message || typeof message !== 'object') return null;
  const content = (message as { content?: unknown }).content;
  return typeof content === 'string' ? content : null;
}

function normalizeStrictProposal(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const proposal = value as Record<string, unknown>;
  const move = proposal.move;
  if (!move || typeof move !== 'object' || Array.isArray(move)) return value;
  const normalizedMove = { ...(move as Record<string, unknown>) };
  for (const key of ['course_reference', 'area_reference', 'payment_plan']) {
    if (normalizedMove[key] === null || normalizedMove[key] === '') delete normalizedMove[key];
  }
  return { ...proposal, move: normalizedMove };
}

function authorizedFactIds(context: AgentAContextV1): Set<string> {
  const ids = new Set(context.catalog.selected_offering?.facts.map((fact) => fact.id) ?? []);
  for (const area of context.catalog.areas) ids.add(`area:${area.code}:name:v1`);
  for (const offering of context.catalog.candidate_offerings) {
    ids.add(`offering:${offering.code}:name:v1`);
  }
  return ids;
}

export function parseAgentATurnProposalV1(raw: unknown, context: AgentAContextV1): AgentATurnProposalV1 {
  const parsed = AgentATurnProposalV1Schema.safeParse(normalizeStrictProposal(raw));
  if (!parsed.success) throw new AgentABrainError('BRAIN_INVALID_SCHEMA');
  const facts = authorizedFactIds(context);
  if (parsed.data.used_fact_ids.some((id) => !facts.has(id))) {
    throw new AgentABrainError('BRAIN_UNKNOWN_FACT_ID');
  }
  const memories = new Set(context.customer.memories.map((memory) => memory.id));
  if (parsed.data.used_memory_ids.some((id) => !memories.has(id))) {
    throw new AgentABrainError('BRAIN_UNKNOWN_MEMORY_ID');
  }
  return parsed.data;
}

function retryAfterMs(response: Response): number | null {
  const raw = response.headers.get('retry-after');
  if (raw === null) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1_000);
  const date = Date.parse(raw);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

function wait(delayMs: number, signal: AbortSignal): Promise<void> {
  if (delayMs <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, delayMs);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    }, { once: true });
  });
}

export async function generateAgentATurnProposalV1(input: {
  readonly context: AgentAContextV1;
  readonly apiKey: string;
  readonly signal: AbortSignal;
  readonly model?: string;
  readonly timeout_ms?: number;
}): Promise<GeneratedAgentATurnProposalV1> {
  const model = input.model ?? DEFAULT_AGENT_A_BRAIN_MODEL;
  const budgetMs = Math.min(AGENT_A_BRAIN_DEADLINE_MS, Math.max(1, input.timeout_ms ?? AGENT_A_BRAIN_DEADLINE_MS));
  const startedAt = Date.now();
  const deadlineAt = startedAt + budgetMs;
  const controller = new AbortController();
  let timedOut = false;
  const parentAbort = () => controller.abort();
  input.signal.addEventListener('abort', parentAbort, { once: true });
  if (input.signal.aborted) controller.abort();
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, budgetMs);

  try {
    for (const attempt of [1, 2] as const) {
      let response: Response;
      try {
        response = await fetch(GROQ_CHAT_COMPLETIONS_URL, {
          method: 'POST',
          headers: { authorization: `Bearer ${input.apiKey}`, 'content-type': 'application/json' },
          body: JSON.stringify(requestBody(input.context, model)),
          signal: controller.signal,
        });
      } catch {
        if (controller.signal.aborted) {
          throw new AgentABrainError(timedOut ? 'BRAIN_TIMEOUT' : 'BRAIN_ABORTED');
        }
        throw new AgentABrainError('BRAIN_NETWORK_ERROR');
      }

      if (!response.ok) {
        const retryable = response.status === 429 || (response.status >= 500 && response.status <= 599);
        const delayMs = retryAfterMs(response);
        if (attempt === 1 && retryable && delayMs !== null && Date.now() + delayMs < deadlineAt) {
          await wait(delayMs, controller.signal);
          continue;
        }
        throw new AgentABrainError(
          response.status === 429 ? 'BRAIN_RATE_LIMITED' : `BRAIN_HTTP_${response.status}`,
          response.status,
        );
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new AgentABrainError('BRAIN_INVALID_RESPONSE', response.status);
      }
      const content = extractContent(payload);
      if (content === null) throw new AgentABrainError('BRAIN_EMPTY_RESPONSE', response.status);
      let decoded: unknown;
      try {
        decoded = JSON.parse(content);
      } catch {
        throw new AgentABrainError('BRAIN_INVALID_JSON', response.status);
      }
      return {
        proposal: parseAgentATurnProposalV1(decoded, input.context),
        provider: 'groq-direct',
        model,
        latency_ms: Date.now() - startedAt,
        attempt_count: attempt,
      };
    }
    throw new AgentABrainError('BRAIN_RETRY_EXHAUSTED');
  } catch (error) {
    if (error instanceof AgentABrainError) throw error;
    if (controller.signal.aborted) {
      throw new AgentABrainError(timedOut ? 'BRAIN_TIMEOUT' : 'BRAIN_ABORTED');
    }
    throw new AgentABrainError('BRAIN_UNKNOWN_ERROR');
  } finally {
    clearTimeout(timeout);
    input.signal.removeEventListener('abort', parentAbort);
  }
}
