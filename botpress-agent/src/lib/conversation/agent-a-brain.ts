import {
  supportsCallRequestV1,
  supportsChatPreferenceV1,
} from './channel-preference-evidence';
import type { TurnRejectionV1 } from '../../schemas/turn-rejection'
import {
  AgentATurnProposalV1Schema,
  type AgentAContextV1,
  type AgentATurnProposalV1,
} from '../../schemas/agent-a-brain';
import {
  ComposedNarrativeV1Schema,
  ConversationMoveV1Schema,
  type ComposedNarrativeV1,
  type TurnPlanV1,
} from '../../schemas/conversation-pipeline';
import { buildAgentABrainInstructionsV1 } from '../../prompts/agent-a-brain-v1';
import { lastAgentReplyV1 } from './conversation-composer';
import {
  extractProtectedFacts,
  extractUrlCandidates,
  isValueFreeNarrativePortable,
} from '../../utils/authorized-egress';
import {
  hasExplicitPurchaseDecline,
  hasTemporalPaymentDeferral,
} from '../../utils/payment-choice';
import {
  AGENT_A_DEEPSEEK_MODEL,
  resolveAgentADeepSeekModelV1,
} from '../../config/agent-a-model';

const GROQ_CHAT_COMPLETIONS_URL = 'https://api.groq.com/openai/v1/chat/completions';
const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';
const DEEPSEEK_RESPONSES_URL = 'https://api.deepseek.com/responses';
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
export const DEFAULT_AGENT_A_BRAIN_MODEL = 'openai/gpt-oss-120b';
export const DEFAULT_AGENT_A_BRAIN_OPENAI_MODEL = 'gpt-5.6-terra';
export const DEFAULT_AGENT_A_BRAIN_OPENAI_FALLBACK_MODEL = 'gpt-5.6-luna';
export const DEFAULT_AGENT_A_BRAIN_DEEPSEEK_MODEL = AGENT_A_DEEPSEEK_MODEL;
export const DEFAULT_AGENT_A_BRAIN_GEMINI_MODEL = 'gemini-2.5-flash';
export const AGENT_A_BRAIN_DEADLINE_MS = 4_500;
export const AGENT_A_BRAIN_DEEPSEEK_DEADLINE_MS = 10_000;
export const AGENT_A_BRAIN_OPENAI_DEADLINE_MS = 6_000;
export const AGENT_A_BRAIN_GEMINI_DEADLINE_MS = 8_000;

export class AgentABrainError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number | null = null,
    public readonly detail: string | null = null,
    public readonly retry_after_ms: number | null = null,
  ) {
    super(code);
    this.name = 'AgentABrainError';
  }
}

export interface GeneratedAgentATurnProposalV1 {
  readonly proposal: AgentATurnProposalV1;
  readonly provider: 'groq-direct' | 'google-ai-direct' | 'openai-direct' | 'deepseek-direct';
  readonly model: string;
  readonly latency_ms: number;
  readonly attempt_count: 1 | 2;
  readonly token_usage?: {
    readonly input_tokens: number;
    readonly cached_input_tokens: number;
    readonly output_tokens: number;
    readonly total_tokens: number;
  };
}

function parseDeepSeekJsonContent(content: string): unknown {
  const trimmed = content.trim();
  const fenced = /^```json[\t ]*\r?\n([\s\S]*?)\r?\n```$/iu.exec(trimmed);
  return JSON.parse(fenced?.[1] ?? trimmed);
}

const DEEPSEEK_PROPOSAL_ROOT_FIELDS = new Set([
  'schema_version',
  'move',
  'response',
  'proposed_action',
  'used_fact_ids',
  'used_memory_ids',
  'memory_candidates',
  'repair_of',
]);

function stripDeepSeekRootMetadata(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => (
    DEEPSEEK_PROPOSAL_ROOT_FIELDS.has(key)
  )));
}

function extractResponsesTokenUsage(payload: unknown): GeneratedAgentATurnProposalV1['token_usage'] {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined;
  const usage = (payload as Record<string, unknown>).usage;
  if (!usage || typeof usage !== 'object' || Array.isArray(usage)) return undefined;
  const values = usage as Record<string, unknown>;
  const inputTokens = values.input_tokens;
  const outputTokens = values.output_tokens;
  const totalTokens = values.total_tokens;
  if (
    !Number.isSafeInteger(inputTokens) || Number(inputTokens) < 0
    || !Number.isSafeInteger(outputTokens) || Number(outputTokens) < 0
    || !Number.isSafeInteger(totalTokens) || Number(totalTokens) < 0
  ) return undefined;
  const details = values.input_tokens_details;
  const cached = details && typeof details === 'object' && !Array.isArray(details)
    ? (details as Record<string, unknown>).cached_tokens
    : 0;
  const cachedInputTokens = Number.isSafeInteger(cached) && Number(cached) >= 0
    ? Math.min(Number(inputTokens), Number(cached))
    : 0;
  return {
    input_tokens: Number(inputTokens),
    cached_input_tokens: cachedInputTokens,
    output_tokens: Number(outputTokens),
    total_tokens: Number(totalTokens),
  };
}

function addTokenUsage(
  left: GeneratedAgentATurnProposalV1['token_usage'],
  right: GeneratedAgentATurnProposalV1['token_usage'],
): GeneratedAgentATurnProposalV1['token_usage'] {
  if (!left) return right;
  if (!right) return left;
  return {
    input_tokens: left.input_tokens + right.input_tokens,
    cached_input_tokens: left.cached_input_tokens + right.cached_input_tokens,
    output_tokens: left.output_tokens + right.output_tokens,
    total_tokens: left.total_tokens + right.total_tokens,
  };
}

export async function generateDeepSeekAgentATurnProposalV1(input: {
  readonly context: AgentAContextV1;
  readonly apiKey: string;
  readonly signal: AbortSignal;
  readonly model?: string;
  readonly timeout_ms?: number;
}): Promise<GeneratedAgentATurnProposalV1> {
  const model = resolveAgentADeepSeekModelV1(input.model);
  const timeoutMs = Math.min(
    AGENT_A_BRAIN_DEEPSEEK_DEADLINE_MS,
    Math.max(1, input.timeout_ms ?? AGENT_A_BRAIN_DEEPSEEK_DEADLINE_MS),
  );
  const startedAt = Date.now();
  const controller = new AbortController();
  let timedOut = false;
  const parentAbort = () => controller.abort();
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  input.signal.addEventListener('abort', parentAbort, { once: true });
  if (input.signal.aborted) controller.abort();

  try {
    let accumulatedTokenUsage: GeneratedAgentATurnProposalV1['token_usage'];
    let retryDiagnostic: string | null = null;
    for (const attempt of [1, 2] as const) {
      let response: Response;
      try {
        response = await fetch(DEEPSEEK_RESPONSES_URL, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${input.apiKey}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model,
            instructions: buildAgentABrainInstructionsV1(input.context),
            input: `Current customer messages: ${JSON.stringify(input.context.turn.batch_messages.map((message) => message.text))}\nAnswer these messages and return only the single AgentATurnProposalV1 JSON object.${retryDiagnostic ? `\nThe previous output failed validation at ${retryDiagnostic}. Return a corrected full object. When call_offer is non-null, response.messages must contain exactly one item and call_offer must be declarative without a question mark.` : ''}`,
            reasoning: { effort: 'none' },
            temperature: 0.2,
            stream: false,
            max_output_tokens: 800,
            text: {
              format: {
                type: 'json_schema',
                name: 'studyx_agent_a_turn_proposal_v1',
                schema: proposalJsonSchema(input.context),
              },
            },
          }),
          signal: controller.signal,
        });
      } catch {
        throw new AgentABrainError(
          timedOut ? 'BRAIN_DEEPSEEK_TIMEOUT' : 'BRAIN_DEEPSEEK_NETWORK_ERROR',
        );
      }
      if (!response.ok) {
        throw new AgentABrainError(
          response.status === 429
            ? 'BRAIN_DEEPSEEK_RATE_LIMITED'
            : `BRAIN_DEEPSEEK_HTTP_${response.status}`,
          response.status,
          null,
          retryAfterMs(response),
        );
      }
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new AgentABrainError(
          timedOut ? 'BRAIN_DEEPSEEK_TIMEOUT' : 'BRAIN_DEEPSEEK_INVALID_RESPONSE',
          response.status,
        );
      }
      accumulatedTokenUsage = addTokenUsage(
        accumulatedTokenUsage,
        extractResponsesTokenUsage(payload),
      );
      const content = extractResponsesContent(payload);
      if (content === null) throw new AgentABrainError('BRAIN_DEEPSEEK_EMPTY_RESPONSE', response.status);
      let decoded: unknown;
      try {
        decoded = parseDeepSeekJsonContent(content);
      } catch {
        if (attempt === 1 && !controller.signal.aborted) { retryDiagnostic = 'root:invalid_json'; continue; }
        throw new AgentABrainError('BRAIN_DEEPSEEK_INVALID_JSON', response.status);
      }
      let proposal: AgentATurnProposalV1;
      try {
        proposal = parseAgentATurnProposalV1(
          stripDeepSeekRootMetadata(decoded),
          input.context,
        );
      } catch (error) {
        if (
          attempt === 1
          && error instanceof AgentABrainError
          && error.code === 'BRAIN_INVALID_SCHEMA'
          && !controller.signal.aborted
        ) {
          retryDiagnostic = error.detail ?? 'root:invalid_schema';
          continue;
        }
        throw error;
      }
      return {
        proposal,
        provider: 'deepseek-direct',
        model,
        latency_ms: Date.now() - startedAt,
        attempt_count: attempt,
        ...(accumulatedTokenUsage
          ? { token_usage: accumulatedTokenUsage }
          : {}),
      };
    }
    throw new AgentABrainError('BRAIN_INVALID_SCHEMA');
  } finally {
    clearTimeout(timeout);
    input.signal.removeEventListener('abort', parentAbort);
  }
}

function geminiRequestBody(context: AgentAContextV1): unknown {
  return {
    systemInstruction: { parts: [{ text: buildAgentABrainInstructionsV1(context) }] },
    contents: [{
      role: 'user',
      parts: [{ text: 'Return only the single AgentATurnProposalV1 JSON object.' }],
    }],
    generationConfig: {
      temperature: 0.2,
      responseMimeType: 'application/json',
    },
  };
}

function extractGeminiContent(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const candidates = (payload as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  const content = candidates[0] && typeof candidates[0] === 'object'
    ? (candidates[0] as { content?: unknown }).content
    : null;
  const parts = content && typeof content === 'object'
    ? (content as { parts?: unknown }).parts
    : null;
  if (!Array.isArray(parts) || parts.length === 0) return null;
  const text = parts[0] && typeof parts[0] === 'object'
    ? (parts[0] as { text?: unknown }).text
    : null;
  return typeof text === 'string' ? text : null;
}

export async function generateGeminiAgentATurnProposalV1(input: {
  readonly context: AgentAContextV1;
  readonly apiKey: string;
  readonly signal: AbortSignal;
  readonly model?: string;
  readonly timeout_ms?: number;
}): Promise<GeneratedAgentATurnProposalV1> {
  const model = input.model?.trim() || DEFAULT_AGENT_A_BRAIN_GEMINI_MODEL;
  const timeoutMs = Math.min(
    AGENT_A_BRAIN_GEMINI_DEADLINE_MS,
    Math.max(1, input.timeout_ms ?? AGENT_A_BRAIN_GEMINI_DEADLINE_MS),
  );
  const startedAt = Date.now();
  const controller = new AbortController();
  let timedOut = false;
  const parentAbort = () => controller.abort();
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  input.signal.addEventListener('abort', parentAbort, { once: true });
  if (input.signal.aborted) controller.abort();

  try {
    let response: Response;
    try {
      response = await fetch(
        `${GEMINI_API_BASE}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(input.apiKey)}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(geminiRequestBody(input.context)),
          signal: controller.signal,
        },
      );
    } catch {
      throw new AgentABrainError(timedOut ? 'BRAIN_GEMINI_TIMEOUT' : 'BRAIN_GEMINI_NETWORK_ERROR');
    }
    if (!response.ok) {
      throw new AgentABrainError(`BRAIN_GEMINI_HTTP_${response.status}`, response.status);
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new AgentABrainError('BRAIN_GEMINI_INVALID_RESPONSE', response.status);
    }
    const content = extractGeminiContent(payload);
    if (content === null) throw new AgentABrainError('BRAIN_GEMINI_EMPTY_RESPONSE', response.status);
    let decoded: unknown;
    try {
      decoded = JSON.parse(content);
    } catch {
      throw new AgentABrainError('BRAIN_GEMINI_INVALID_JSON', response.status);
    }
    return {
      proposal: parseAgentATurnProposalV1(decoded, input.context),
      provider: 'google-ai-direct',
      model,
      latency_ms: Date.now() - startedAt,
      attempt_count: 1,
    };
  } finally {
    clearTimeout(timeout);
    input.signal.removeEventListener('abort', parentAbort);
  }
}

const MOVE_KINDS = [
  'greeting', 'browse_catalog', 'select_area', 'select_course', 'ask_course_information',
  'continue_by_chat', 'request_call', 'decline_call', 'ask_payment_options',
  'select_payment_plan', 'defer_payment', 'request_payment_link', 'report_payment',
  'ask_current_state', 'provide_contact_details', 'decline_purchase', 'unknown',
] as const;
const SECONDARY_MOVE_KINDS = MOVE_KINDS.filter(
  (kind) => kind !== 'greeting' && kind !== 'unknown',
);
const MEMORY_TYPES = [
  'study_goal', 'study_context', 'preference', 'constraint',
  'objection', 'timeline', 'contact_preference',
] as const;
const PAYMENT_PLANS = ['monthly_12', 'monthly_6', 'one_time'] as const;
const COURSE_REFERENCE_MOVES = new Set([
  'select_course', 'ask_course_information', 'request_call', 'ask_payment_options',
  'select_payment_plan', 'defer_payment', 'request_payment_link', 'decline_purchase',
]);
const AREA_REFERENCE_MOVES = new Set(['browse_catalog', 'select_area']);
const PAYMENT_PLAN_MOVES = new Set(['select_payment_plan', 'defer_payment', 'request_payment_link']);
const MOVE_SEMANTICS = `Classify only the current customer message, using prior state solely to resolve short contextual replies. continue_by_chat and decline_call require an explicit channel preference or a refusal of a pending call offer; study goals and ordinary diagnostic replies are not channel choices. greeting is a current greeting or social opening. report_payment requires an explicit current-message claim that payment already happened; never use it for a greeting, a status question, a future intention, or merely because a link was sent earlier. ask_current_state is a question about what is already selected, sent, or recorded. provide_contact_details means the current message actually supplies identity details. select_payment_plan records a chosen plan; request_payment_link requires an explicit request to receive or advance with the link. unknown is only for meaning that remains unresolved after applying awaiting_reply.`;

function closedObject(properties: Record<string, unknown>) {
  return { type: 'object', properties, required: Object.keys(properties), additionalProperties: false };
}

function proposalJsonSchema(context: AgentAContextV1): unknown {
  const nullableString = { anyOf: [{ type: 'string' }, { type: 'null' }] };
  const move = closedObject({
    schema_version: { type: 'integer', enum: [1] },
    move: { type: 'string', enum: [...MOVE_KINDS], description: MOVE_SEMANTICS },
    secondary_moves: {
      type: 'array',
      maxItems: 2,
      description: 'Additional distinct compatible intentions explicitly present in the current customer message. Never infer one and never include greeting or unknown.',
      items: { type: 'string', enum: [...SECONDARY_MOVE_KINDS] },
    },
    vetoes: {
      type: 'array',
      maxItems: 3,
      description: 'Include a veto only when the current customer message explicitly refuses that action: call, payment_link, or purchase. Otherwise return an empty array.',
      items: { type: 'string', enum: ['call', 'payment_link', 'purchase'] },
    },
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
      messages: {
        type: 'array', minItems: 1, maxItems: 2, items: { type: 'string' },
        description: 'Use at most two short messages; when call_offer is non-null, return exactly one response message.',
      },
      call_offer: {
        anyOf: [{ type: 'string' }, { type: 'null' }],
        description: 'Brief declarative invitation to a phone call, required when the call policy in the instructions applies and the capability allows it; otherwise null. It must not contain a question.',
      },
    }),
    proposed_action: proposedAction,
    // The single repair must echo its actual rejection. Omitting this field
    // from a closed provider schema made every conforming repair fail the
    // resolver's correlation check, even when its rewritten text was valid.
    repair_of: context.turn_rejection
      ? closedObject({
        rejection_id: { type: 'string', enum: [context.turn_rejection.rejection_id] },
        attempt: { type: 'integer', enum: [1] },
      })
      : { type: 'null' },
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
    reasoning_effort: 'low',
    stream: false,
    max_completion_tokens: 800,
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'studyx_agent_a_turn_proposal_v1',
        strict: true,
        schema: proposalJsonSchema(context),
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

function extractResponsesContent(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const record = payload as Record<string, unknown>;
  if (typeof record.output_text === 'string') return record.output_text;
  if (!Array.isArray(record.output)) return null;
  const fragments: string[] = [];
  for (const output of record.output) {
    if (!output || typeof output !== 'object') continue;
    const content = (output as Record<string, unknown>).content;
    if (!Array.isArray(content)) continue;
    for (const item of content) {
      if (!item || typeof item !== 'object') continue;
      const candidate = item as Record<string, unknown>;
      if (candidate.type === 'output_text' && typeof candidate.text === 'string') {
        fragments.push(candidate.text);
      }
    }
  }
  return fragments.length > 0 ? fragments.join('') : null;
}

export async function generateOpenAIAgentATurnProposalV1(input: {
  readonly context: AgentAContextV1;
  readonly apiKey: string;
  readonly signal: AbortSignal;
  readonly model?: string;
  readonly timeout_ms?: number;
}): Promise<GeneratedAgentATurnProposalV1> {
  const model = input.model?.trim() || DEFAULT_AGENT_A_BRAIN_OPENAI_MODEL;
  const timeoutMs = Math.min(
    AGENT_A_BRAIN_OPENAI_DEADLINE_MS,
    Math.max(1, input.timeout_ms ?? AGENT_A_BRAIN_OPENAI_DEADLINE_MS),
  );
  const startedAt = Date.now();
  const controller = new AbortController();
  let timedOut = false;
  const parentAbort = () => controller.abort();
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  input.signal.addEventListener('abort', parentAbort, { once: true });
  if (input.signal.aborted) controller.abort();

  try {
    let response: Response;
    try {
      response = await fetch(OPENAI_RESPONSES_URL, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${input.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model,
          input: [
            {
              role: 'developer',
              content: [{ type: 'input_text', text: buildAgentABrainInstructionsV1(input.context) }],
            },
            {
              role: 'user',
              content: [{ type: 'input_text', text: 'Return only the single AgentATurnProposalV1 JSON object.' }],
            },
          ],
          reasoning: { effort: 'none' },
          store: false,
          max_output_tokens: 800,
          text: {
            format: {
              type: 'json_schema',
              name: 'studyx_agent_a_turn_proposal_v1',
              strict: true,
              schema: proposalJsonSchema(input.context),
            },
          },
        }),
        signal: controller.signal,
      });
    } catch {
      throw new AgentABrainError(
        timedOut ? 'BRAIN_OPENAI_TIMEOUT' : 'BRAIN_OPENAI_NETWORK_ERROR',
      );
    }
    if (!response.ok) {
      throw new AgentABrainError(
        response.status === 429 ? 'BRAIN_OPENAI_RATE_LIMITED' : `BRAIN_OPENAI_HTTP_${response.status}`,
        response.status,
        null,
        retryAfterMs(response),
      );
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new AgentABrainError('BRAIN_OPENAI_INVALID_RESPONSE', response.status);
    }
    const content = extractResponsesContent(payload);
    if (content === null) throw new AgentABrainError('BRAIN_OPENAI_EMPTY_RESPONSE', response.status);
    let decoded: unknown;
    try {
      decoded = JSON.parse(content);
    } catch {
      throw new AgentABrainError('BRAIN_OPENAI_INVALID_JSON', response.status);
    }
    return {
      proposal: parseAgentATurnProposalV1(decoded, input.context),
      provider: 'openai-direct',
      model,
      latency_ms: Date.now() - startedAt,
      attempt_count: 1,
    };
  } finally {
    clearTimeout(timeout);
    input.signal.removeEventListener('abort', parentAbort);
  }
}

function normalizeStrictProposal(value: unknown, context: AgentAContextV1): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const proposal = value as Record<string, unknown>;
  const normalizedProposal = { ...proposal };
  const response = proposal.response;
  if (response && typeof response === 'object' && !Array.isArray(response)) {
    const messages = (response as Record<string, unknown>).messages;
    if (Array.isArray(messages)) {
      const safeMessages = messages.filter((message) => (
        typeof message === 'string'
        && !/https?:\/\//iu.test(message)
        && !/\{\{[^}]+\}\}/u.test(message)
      ));
      const rawMove = typeof proposal.move === 'string'
        ? proposal.move
        : proposal.move && typeof proposal.move === 'object' && !Array.isArray(proposal.move)
          ? (proposal.move as Record<string, unknown>).move
          : null;
      const actionType = proposal.proposed_action
        && typeof proposal.proposed_action === 'object'
        && !Array.isArray(proposal.proposed_action)
        ? (proposal.proposed_action as Record<string, unknown>).type
        : null;
      const normalizedMessages = safeMessages.length === 0
        && messages.length > 0
        && context.capabilities.may_send_payment_link
        && (rawMove === 'request_payment_link' || actionType === 'send_payment_link')
        ? ['Perfecto, te comparto el enlace autorizado para continuar.']
        : safeMessages;
      if (normalizedMessages.length > 0 && safeMessages.length !== messages.length) {
        normalizedProposal.response = {
          ...(response as Record<string, unknown>),
          messages: normalizedMessages,
        };
      }
    }
  }
  let move = proposal.move;
  if (typeof move === 'string' && (MOVE_KINDS as readonly string[]).includes(move)) {
    move = {
      schema_version: 1,
      move,
      secondary_moves: [],
      vetoes: [],
      confidence: 1,
    };
  }
  if (!move || typeof move !== 'object' || Array.isArray(move)) return value;
  const normalizedMove = { ...(move as Record<string, unknown>) };
  for (const key of ['course_reference', 'area_reference', 'payment_plan']) {
    if (normalizedMove[key] === null || normalizedMove[key] === '') delete normalizedMove[key];
  }
  if (Array.isArray(normalizedMove.secondary_moves)) {
    normalizedMove.secondary_moves = [...new Set(normalizedMove.secondary_moves)]
      .filter((kind) => kind !== normalizedMove.move);
  }
  if (Array.isArray(normalizedMove.vetoes)) {
    normalizedMove.vetoes = [...new Set(normalizedMove.vetoes)];
  }
  const moveKinds = new Set([
    normalizedMove.move,
    ...(Array.isArray(normalizedMove.secondary_moves) ? normalizedMove.secondary_moves : []),
  ].filter((item): item is string => typeof item === 'string'));
  if (![...moveKinds].some((kind) => COURSE_REFERENCE_MOVES.has(kind))) {
    delete normalizedMove.course_reference;
  }
  if (typeof normalizedMove.course_reference === 'string') {
    const referenceKey = (reference: string) => reference
      .trim()
      .toLocaleLowerCase('es')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/gu, '')
      .replace(/\s+/gu, ' ');
    const visibleOfferings = [
      ...(context.catalog.selected_offering ? [{
        code: context.catalog.selected_offering.code,
        display_name: context.catalog.selected_offering.display_name,
      }] : []),
      ...context.catalog.candidate_offerings,
      ...context.catalog.available_offerings,
    ];
    const key = referenceKey(normalizedMove.course_reference);
    const matches = [...new Map(visibleOfferings.map((offering) => [offering.code, offering])).values()]
      .filter((offering) => (
        referenceKey(offering.code) === key
        || referenceKey(offering.display_name) === key
      ));
    if (matches.length !== 1) {
      throw new AgentABrainError('BRAIN_UNKNOWN_COURSE_REFERENCE');
    }
    normalizedMove.course_reference = matches[0].code;
  }
  if (![...moveKinds].some((kind) => AREA_REFERENCE_MOVES.has(kind))) {
    delete normalizedMove.area_reference;
  }
  if (![...moveKinds].some((kind) => PAYMENT_PLAN_MOVES.has(kind))) {
    delete normalizedMove.payment_plan;
  }
  return { ...normalizedProposal, move: normalizedMove };
}

function authorizedFactIds(context: AgentAContextV1): Set<string> {
  const ids = new Set(context.catalog.selected_offering?.facts.map((fact) => fact.id) ?? []);
  for (const area of context.catalog.areas) ids.add(area.fact_id);
  for (const offering of context.catalog.available_offerings) ids.add(offering.fact_id);
  for (const offering of context.catalog.candidate_offerings) {
    ids.add(offering.fact_id);
  }
  for (const plan of context.catalog.payment_plans) ids.add(plan.fact_id);
  return ids;
}

function schemaIssueDiagnostic(issue: {
  readonly code: string;
  readonly path: readonly PropertyKey[];
  readonly errors?: readonly (readonly {
    readonly code: string;
    readonly path: readonly PropertyKey[];
    readonly errors?: readonly unknown[];
  }[])[];
}, parentPath: readonly PropertyKey[] = []): string {
  const path = [...parentPath, ...issue.path];
  const nested = issue.errors?.[0]?.[0];
  if (nested) {
    return schemaIssueDiagnostic(
      nested as Parameters<typeof schemaIssueDiagnostic>[0],
      path,
    );
  }
  const suffix = path
    .map((segment) => typeof segment === 'string' && /^[a-z][a-z0-9_]*$/u.test(segment)
      ? segment
      : 'item')
    .join('.');
  return `${suffix || 'root'}:${issue.code}`;
}

export function parseAgentATurnProposalV1(raw: unknown, context: AgentAContextV1): AgentATurnProposalV1 {
  const normalized = normalizeStrictProposal(raw, context);
  const normalizedMove = normalized && typeof normalized === 'object' && !Array.isArray(normalized)
    ? (normalized as Record<string, unknown>).move
    : undefined;
  const parsedMove = ConversationMoveV1Schema.safeParse(normalizedMove);
  if (!parsedMove.success) {
    const first = parsedMove.error.issues[0];
    const suffix = first?.path
      .map((segment) => typeof segment === 'string' && /^[a-z][a-z0-9_]*$/u.test(segment)
        ? segment
        : 'item')
      .join('.') || '';
    throw new AgentABrainError(
      'BRAIN_INVALID_SCHEMA',
      null,
      `${suffix ? `move.${suffix}` : 'move'}:${first?.code ?? 'invalid'}`,
    );
  }
  const parsed = AgentATurnProposalV1Schema.safeParse(normalized);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new AgentABrainError(
      'BRAIN_INVALID_SCHEMA',
      null,
      first ? schemaIssueDiagnostic(first).slice(0, 160) : null,
    );
  }
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

function commercialValuesByFactId(context: AgentAContextV1): ReadonlyMap<string, string> {
  const values = new Map<string, string>();
  for (const fact of context.catalog.selected_offering?.facts ?? []) values.set(fact.id, fact.value);
  for (const area of context.catalog.areas) values.set(area.fact_id, area.display_name);
  for (const offering of context.catalog.available_offerings) {
    values.set(offering.fact_id, offering.display_name);
  }
  for (const offering of context.catalog.candidate_offerings) values.set(offering.fact_id, offering.display_name);
  for (const plan of context.catalog.payment_plans) values.set(plan.fact_id, plan.label);
  return values;
}

function canonicalPrerequisiteStatement(
  facts: ReadonlyMap<string, NonNullable<AgentAContextV1['catalog']['selected_offering']>['facts'][number]>,
  plannedIds: ReadonlySet<string>,
): { readonly factId: string; readonly message: string } | null {
  for (const [factId, fact] of facts) {
    if (fact.kind !== 'offering_description' || !plannedIds.has(factId)) continue;
    if (/\bno requiere conocimientos previos\b/iu.test(fact.value)) {
      return { factId, message: 'No requiere conocimientos previos.' };
    }
    if (/\b(?:diseñad[oa]|disenad[oa]) para empezar desde cero\b/iu.test(fact.value)) {
      return { factId, message: 'Está diseñado para empezar desde cero.' };
    }
  }
  return null;
}

/**
 * The model owns the wording. Canonical values are allowed in that wording
 * only when the proposal cites their fact IDs and the authoritative planner
 * independently selected the same IDs. Invented facts and URLs remain blocked.
 */
export function buildSafeAgentABrainCompositionV1(input: {
  readonly proposal: AgentATurnProposalV1;
  readonly context: AgentAContextV1;
  readonly response_goal: TurnPlanV1['response_goal'];
  readonly planned_fact_ids: readonly string[];
}): ComposedNarrativeV1 {
  const compactMessage = (message: string) => message
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu, 'tu correo')
    .replace(/\s+/gu, ' ')
    .trim();
  const currentCustomerText = input.context.turn.batch_messages
    .map((message) => message.text)
    .join(' ');
  const asksAboutUnspecifiedPrerequisites = /\b(?:requisitos?|prerrequisitos?|conocimientos?\s+previos?|experiencia\s+previa|qu[eé]\s+necesito\s+saber\s+antes)\b/iu
    .test(currentCustomerText);
  const asksAboutDuration = /\b(?:cu[aá]ntas?\s+clases|cu[aá]nto\s+dura|duraci[oó]n)\b/iu
    .test(currentCustomerText);
  const asksAboutDescription = /\b(?:qu[eé]\s+(?:me\s+)?aporta|qu[eé]\s+aprendo|qu[eé]\s+incluye|programa|temario)\b/iu
    .test(currentCustomerText);
  const plannedIds = new Set(input.planned_fact_ids);
  const selectedFactsById = new Map(
    input.context.catalog.selected_offering?.facts.map((fact) => [fact.id, fact]) ?? [],
  );
  const prerequisiteStatement = asksAboutUnspecifiedPrerequisites
    ? canonicalPrerequisiteStatement(selectedFactsById, plannedIds)
    : null;
  const citedIds = new Set(input.proposal.used_fact_ids.filter((id) => {
    if (!plannedIds.has(id)) return false;
    const kind = selectedFactsById.get(id)?.kind;
    if (asksAboutUnspecifiedPrerequisites) {
      return id === prerequisiteStatement?.factId
        || (asksAboutDuration && (kind === 'offering_name' || kind === 'offering_duration'));
    }
    const selectedCode = input.context.catalog.selected_offering?.code ?? null;
    const changesCourse = selectedCode !== null
      && selectedCode !== input.context.commercial_state.selected_offering_code;
    if (changesCourse && !asksAboutDuration && !asksAboutDescription) {
      return kind === 'offering_name';
    }
    return true;
  }));
  if (asksAboutDuration || asksAboutDescription) {
    for (const [id, fact] of selectedFactsById) {
      if (!plannedIds.has(id)) continue;
      if (
        fact.kind === 'offering_name'
        || (asksAboutDuration && fact.kind === 'offering_duration')
        || (asksAboutDescription && fact.kind === 'offering_description')
      ) citedIds.add(id);
    }
  }
  if (prerequisiteStatement) citedIds.add(prerequisiteStatement.factId);
  const valuesById = commercialValuesByFactId(input.context);
  const unauthorizedValues = [...valuesById]
    .filter(([id]) => !citedIds.has(id))
    .map(([, value]) => value.normalize('NFKC').trim().toLocaleLowerCase('es'))
    .filter((value) => value.length >= 3);
  const citedValues = [...valuesById]
    .filter(([id]) => citedIds.has(id))
    .map(([, value]) => value);
  const unsupportedPrerequisiteClaim = /\b(?:no\s+(?:necesit[aá]s?|hace\s+falta|requiere)|(?:requisitos?|prerrequisitos?|conocimientos?\s+previos?|experiencia\s+previa)\s+(?:no\s+)?(?:son|es|est[aá]n|se\s+requieren?))\b/iu;
  const safeMessages = input.proposal.response.messages.map(compactMessage).filter((message) => {
    const normalized = message.normalize('NFKC').toLocaleLowerCase('es');
    // This layer owns composition, not business truth. The structured parser
    // already blocks URLs and unknown evidence IDs; the backend sees the exact
    // text next and validates every protected commercial assertion against its
    // canonical snapshot. Filtering by sales vocabulary here caused valid
    // natural language (for example "tenemos opciones") to be replaced by a
    // canned fallback before the authority boundary could inspect it.
    return !unauthorizedValues.some((value) => normalized.includes(value))
      && citesOnlyAuthorizedValues(message, citedValues)
      && (!asksAboutUnspecifiedPrerequisites || !unsupportedPrerequisiteClaim.test(message));
  });
  // A transactional goal constrains which FACTS may appear, never who writes
  // the sentence. `safeMessages` has already dropped anything carrying an
  // uncited commercial value, so what survives is the model's own wording of
  // an authorized turn: keep it, and fall back to the fixed phrasing only when
  // nothing survived. Substituting it unconditionally is what made the agent
  // answer every payment question with the same sentence.
  const messages = asksAboutUnspecifiedPrerequisites
    ? [prerequisiteStatement?.message
      ?? 'Los requisitos previos no están especificados en la información confirmada.']
    : safeMessages.length > 0
      ? safeMessages
      : [transactionalFallback(input.response_goal)
        ?? safeContextualOpening(input.response_goal, input.context.commercial_state.call_offer_count)];

  return ComposedNarrativeV1Schema.parse({
    schema_version: 1,
    narrative: {
      opening: messages[0],
      explanation: messages[1] ?? null,
      next_question: messages[2] ?? null,
    },
    call_offer: input.proposal.response.call_offer
      && isValueFreeNarrativePortable(input.proposal.response.call_offer)
      ? compactMessage(input.proposal.response.call_offer)
      : null,
    used_fact_ids: [...citedIds],
  });
}

/**
 * Regla de composición para un turno de pago.
 *
 * Antes se descartaba el mensaje entero si contenía cualquier hecho protegido
 * (`isValueFreeNarrativePortable`). Como toda respuesta de pago menciona un
 * precio, el mensaje del modelo se caía siempre y disparaba la frase fija: por
 * eso dos consultas de precio devolvían texto idéntico.
 *
 * Ahora el modelo aporta la narrativa y la referencia estructurada —cita el
 * `fact_id` del plan— y sólo puede pronunciar los HECHOS que esa referencia
 * autoriza. La comparación es hecho contra hecho, no cadena contra cadena:
 * DeepSeek acorta "6 pagos mensuales de USD 60" a "6 pagos de USD 60", y el
 * precio sigue siendo el mismo hecho canónico. Un precio inventado, un plan no
 * citado o una URL propia siguen cayendo. El backend materializa igual los hechos canónicos y el
 * egress guard revalida el texto final: acá no se afloja nada, se deja de
 * destruir la redacción.
 */
function citesOnlyAuthorizedValues(
  message: string,
  citedValues: readonly string[],
): boolean {
  if (extractUrlCandidates(message).length > 0) return false;
  const authorized = new Set(citedValues.flatMap(
    (value) => extractProtectedFacts(value).map((fact) => `${fact.kind}\u0000${fact.value}`),
  ));
  return extractProtectedFacts(message).every(
    (fact) => fact.kind === 'offering'
      || authorized.has(`${fact.kind}\u0000${fact.value}`),
  );
}

function transactionalFallback(responseGoal: TurnPlanV1['response_goal']): string | null {
  switch (responseGoal) {
    case 'confirm_selected_plan':
      return 'Queda registrada tu elección. Avisame cuando quieras avanzar.';
    // `confirm_payment_link` tenía acá una cadena que pedía tres campos
    // fuera del contrato comercial y fusionaba nombre con apellido. Quién
    // pide los datos es el modelo; cuáles faltan lo dice `intake_missing`,
    // no una cadena fija del backend. Sin fallback cae en
    // safeContextualOpening, que no nombra ningún campo.
    case 'acknowledge_payment_deferral':
      return 'De acuerdo, lo dejamos para más adelante.';
    default:
      return null;
  }
}

function safeContextualOpening(
  responseGoal: TurnPlanV1['response_goal'],
  callOfferCount: 0 | 1 | 2,
): string {
  switch (responseGoal) {
    case 'greet_and_discover':
      return 'Contame qué te gustaría aprender y te ayudo a encontrar una opción.';
    case 'guide_area_choice':
      return 'Contame qué área te interesa y te ayudo a ordenar las opciones.';
    case 'guide_course_choice':
      return 'Elegí una de las opciones disponibles y seguimos desde ahí.';
    case 'explain_selected_course':
      return [
        'Te comparto la información confirmada para que conozcas esta opción.',
        'Amplío la información confirmada para que puedas evaluarla.',
        'Seguimos con los datos confirmados de la formación elegida.',
      ][callOfferCount]!;
    case 'continue_course_advice':
      return 'Seguimos por chat con la información que necesitás.';
    case 'offer_call_or_chat':
      return 'Podés elegir cómo preferís continuar.';
    case 'acknowledge_chat_preference':
      return 'Perfecto, seguimos por chat.';
    case 'acknowledge_call_decline':
      return 'Entendido, continuamos por este medio.';
    case 'confirm_call_request':
      return 'Perfecto, queda registrada tu solicitud.';
    case 'present_payment_options':
      return 'Estas son las opciones disponibles para que elijas cómo avanzar.';
    case 'confirm_selected_plan':
      return 'Queda registrada tu elección. Avisame cuando quieras avanzar.';
    case 'acknowledge_payment_deferral':
      return 'De acuerdo, lo dejamos para más adelante.';
    case 'confirm_payment_link':
      return 'Listo, te comparto el paso autorizado para continuar.';
    case 'request_contact_details':
      return 'Para dejarlo listo necesito unos datos tuyos.';
    case 'acknowledge_payment_report':
      return 'Gracias por avisar. Queda registrado para que una persona lo revise.';
    case 'confirm_current_state':
      return 'Te confirmo en qué punto quedamos.';
    case 'acknowledge_purchase_decline':
      return 'Entendido. Si querés, podemos seguir revisando tus opciones.';
    case 'catalog_temporarily_unavailable':
      return 'Ahora no puedo consultar las opciones confirmadas. Podemos retomar tu objetivo apenas estén disponibles.';
    case 'clarify_current_step':
      return 'Decime cómo preferís continuar y te acompaño desde este punto.';
  }
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
          null,
          delayMs,
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

// ─────────────────────────────────────────────────────────────────────────
// V1–V7 · Validación con motivo estructurado (§ 05).
//
// `buildSafeAgentABrainCompositionV1` sigue existiendo y sigue podando. Lo que
// cambia es que la poda deja de ser la ÚNICA respuesta posible a un rechazo.
//
// Antes, una propuesta con una acción no autorizada se degradaba a una frase
// fija: el modelo nunca se enteraba de por qué, y el cliente recibía la misma
// oración enlatada cada vez. Ahora el rechazo puede volver al modelo con los
// códigos y las alternativas, y darle una oportunidad de reescribir.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Devuelve `null` si la propuesta es válida, o el motivo estructurado si no.
 * Los motivos se ACUMULAN: devolver sólo el primero obligaría al modelo a
 * reparar de a uno por vez, y sólo hay una reparación.
 */
/**
 * Compara lo que el cliente realmente lee. El espaciado no cambia el mensaje,
 * así que dos borradores que sólo difieren en blancos son el mismo turno.
 */
function sameVisibleText(messages: readonly string[], previous: string): boolean {
  const normalize = (value: string): string => value.replace(/\s+/gu, ' ').trim();
  const draft = normalize(messages.join(' '));
  return draft.length > 0 && draft === normalize(previous);
}

function normalizedQuestionKeys(value: string): Set<string> {
  const questions = value.split('?').slice(0, -1).map((fragment) => {
    const start = Math.max(
      fragment.lastIndexOf('¿'),
      fragment.lastIndexOf('\n'),
      fragment.lastIndexOf('.'),
      fragment.lastIndexOf('!'),
    );
    return fragment.slice(start + 1);
  });
  return new Set(questions.map((question) => question
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLocaleLowerCase('es')
    .replace(/[^a-z0-9]+/gu, ' ')
    .trim())
    .filter(Boolean));
}

function repeatsPreviousQuestion(messages: readonly string[], previous: string): boolean {
  const previousQuestions = normalizedQuestionKeys(previous);
  if (previousQuestions.size === 0) return false;
  return [...normalizedQuestionKeys(messages.join('\n'))]
    .some((question) => previousQuestions.has(question));
}

const CUSTOMER_REQUESTS_REPEAT = /\b(?:repet|otra\s+vez|no\s+entend|de\s+nuevo)\w*/iu;
const UNSUPPORTED_PREREQUISITE_ASSERTION = /(?:\bno\s+(?:necesit\w*|hace\s+falta|se\s+requiere)\b[^.!?\n]{0,80}\b(?:experiencia|conocimientos?|requisitos?)\b|\bsin\s+(?:experiencia|conocimientos?\s+previos?)\b|\b(?:pod[eé]s|puedes|empez[aá]s?|part[ií]s?)\b[^.!?\n]{0,32}\bdesde\s+cero\b|\bdesde\s+los\s+fundamentos\b)/iu;

/**
 * Preguntar por los conocimientos previos no es afirmar que no hacen falta.
 *
 * El guard existe para que el modelo no deduzca «no necesitás experiencia» de
 * un ejemplo del comportamiento canónico cuando el catálogo no lo confirma. Esa
 * parte se conserva entera.
 *
 * Lo que no puede seguir haciendo es rechazar la pregunta que el propio prompt
 * canónico PRESCRIBE en la Fase 2 —«¿Tenés conocimientos previos o partís desde
 * cero?»—, que el patrón matchea por la rama `partís desde cero`. El agente
 * quedaba rechazado por obedecer: en la corrida `v13iter2` eso produjo 4
 * reparaciones sobre 26 turnos, 15,4% contra un gate de 5%, tres de ellas en el
 * mismo caso y todas por esta regla.
 *
 * Se evalúa oración por oración y se saltean las interrogativas. Una afirmación
 * no se salva por venir en el mismo mensaje que una pregunta: la oración que
 * afirma sigue disparando el rechazo.
 */
export function assertsUnsupportedPrerequisitesV1(message: string): boolean {
  return message
    .split(/(?<=[.!?\n])/u)
    .filter((sentence) => !sentence.includes('?'))
    .some((sentence) => UNSUPPORTED_PREREQUISITE_ASSERTION.test(sentence));
}

/**
 * Quita la pregunta ya hecha, no el mensaje que la contiene.
 *
 * Descartar el mensaje entero funcionaba sólo cuando la repetición venía sola.
 * Pegada a algo útil —"Perfecto, seguimos por chat. ¿Ya tenías pensado
 * estudiar maquillaje...?"— el filtro dejaba el turno sin mensajes, la poda se
 * abortaba por lista vacía y la repetición llegaba igual al cliente.
 *
 * Se corta por oración y se descarta sólo la interrogativa que ya se hizo. Si
 * de un mensaje no queda nada, ese mensaje desaparece; si no queda ninguno, el
 * llamador decide qué hacer, como antes.
 *
 * Cuando la persona pide que se lo repitan, no se poda nada: ahí repetir es la
 * respuesta correcta.
 */
export function removeRepeatedAgentQuestionMessagesV1(
  messages: readonly string[],
  previous: string,
  currentCustomerText: string,
): string[] {
  if (CUSTOMER_REQUESTS_REPEAT.test(currentCustomerText)) return [...messages];
  return messages
    .map((message) => message
      .split(/(?<=[.!?\n])/u)
      .filter((sentence) => !repeatsPreviousQuestion([sentence], previous))
      .join('')
      .replace(/\s+/gu, ' ')
      .trim())
    .filter((message) => message.length > 0);
}

function mentionsMissingIntakeField(messages: readonly string[], missing: readonly string[]): boolean {
  const text = messages.join(' ').normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLocaleLowerCase('es');
  const requested = new Set<string>();
  for (const clause of text.split(/[.;!?]+/u)) {
    const cue = clause.match(/\b(?:faltan?|necesito|necesitamos|pasame|decime|dime|indicame|confirmame|comparti(?:me)?|comparte|enviame|dame|me\s+(?:das|pasas|compartis|confirmas))\b|¿/u);
    if (!cue) continue;
    // «Ya tengo tu nombre» no es una petición. Sólo los campos posteriores
    // al pedido deben coincidir con el intake pendiente de este turno.
    const request = clause.slice(cue.index);
    for (const [field, pattern] of [
      ['nombre', /\bnombre\b/u], ['apellido', /\bapellido\b/u],
      ['correo', /\b(?:correo|email|e mail)\b/u],
      ['telefono', /\b(?:telefono|celular|numero)\b/u],
    ] as const) {
      if (pattern.test(request)) requested.add(field);
    }
  }
  return requested.size > 0 && [...requested].every((field) => missing.includes(field));
}

/** Únicos géneros que el ADK sigue bloqueando por su cuenta. */
const ADK_BLOCKING_FACT_KINDS = new Set(['price', 'promise']);

function comparableProtectedFact(fact: ReturnType<typeof extractProtectedFacts>[number]): string {
  // Zero cents in the catalog's dot-decimal format do not change an amount.
  // Do not normalize commas: the portable extractor can truncate 360,000 to
  // 360,00. Keep currency, qualifiers and all
  // non-zero digits intact; this is only the draft check, not the signed
  // egress representation or the backend's final commercial authorization.
  const value = fact.kind === 'price'
    ? fact.value.replace(/(\d)\.0{1,2}(?!\d)/gu, '$1')
    : fact.value;
  return `${fact.kind}\u0000${value}`;
}

export function validateAgentATurnProposalV1(input: {
  readonly proposal: AgentATurnProposalV1;
  readonly context: AgentAContextV1;
  readonly planned_fact_ids: readonly string[];
  readonly rejection_id: string;
}): TurnRejectionV1 | null {
  const rejections: Array<{ code: TurnRejectionV1['rejections'][number]['code']; subject: string }> = [];
  const planned = new Set(input.planned_fact_ids);
  const cited = new Set(input.proposal.used_fact_ids);

  // V8 — el borrador es, palabra por palabra, el mensaje anterior del agente.
  //
  // Dos turnos seguidos pueden recibir el mismo trío (move, objetivo, hechos):
  // cuando el material autorizado no cambia, repetir es la salida más probable
  // del modelo, y quien repregunta recibe de vuelta el párrafo que ya leyó.
  //
  // El backend no reescribe la copia —eso sería redactar por el modelo— pero
  // sí puede rechazar y abrir la única reparación. No se piden hechos nuevos ni
  // se autoriza nada: la alternativa autorizada es exactamente la misma.
  const previousReply = lastAgentReplyV1(input.context.turn.recent_turns);
  if (previousReply && sameVisibleText(input.proposal.response.messages, previousReply)) {
    rejections.push({ code: 'REPEATED_AGENT_REPLY', subject: 'previous_agent_reply' });
  }
  const currentCustomerText = input.context.turn.batch_messages.map((message) => message.text).join('\n');
  if (
    previousReply
    && !CUSTOMER_REQUESTS_REPEAT.test(currentCustomerText)
    && repeatsPreviousQuestion(input.proposal.response.messages, previousReply)
  ) {
    rejections.push({ code: 'REPEATED_AGENT_REPLY', subject: 'previous_agent_question' });
  }

  // V2 — cada hecho citado existe en el registro materializado del turno.
  for (const factId of input.proposal.used_fact_ids) {
    if (!planned.has(factId)) {
      rejections.push({ code: 'FACT_NOT_AUTHORIZED', subject: factId })
    }
  }

  // V3 — omitir la cita no puede convertir una afirmación comercial en
  // narrativa libre. El egress final ya hace esta comprobación, pero esperar
  // hasta el commit transformaba un borrador reparable en el fallback técnico
  // visible. Acá se comparan los hechos detectados con los valores que el
  // planner materializó para este turno y se abre la única reescritura N2.
  const authorizedProtectedFacts = new Set(
    [...commercialValuesByFactId(input.context)]
      .filter(([factId]) => planned.has(factId))
      .flatMap(([, value]) => extractProtectedFacts(value))
      .map(comparableProtectedFact),
  );
  const unauthorizedKinds = new Set<string>();
  const authoredNarrative = [
    ...input.proposal.response.messages,
    ...(input.proposal.response.call_offer ? [input.proposal.response.call_offer] : []),
  ];
  const selectedFactsById = new Map(
    input.context.catalog.selected_offering?.facts.map((fact) => [fact.id, fact]) ?? [],
  );
  if (
    canonicalPrerequisiteStatement(selectedFactsById, planned) === null
    && authoredNarrative.some(assertsUnsupportedPrerequisitesV1)
  ) {
    rejections.push({ code: 'FACT_VALUE_MISMATCH', subject: 'prerequisites' });
  }
  // Dinero y promesa siguen siendo frontera acá: el error es caro y conviene
  // abrir la reparación antes del commit. El resto de los sustantivos
  // comerciales —modalidad, certificación, duración, nombre de curso— los
  // verifica el backend por VALOR contra el registro canónico
  // (`commercial-truth-guard`). Exigir además una CITA por cada uno convertía
  // cualquier frase natural en un rechazo y, con la reparación apagada, en el
  // piso técnico: era la causa raíz de que el modelo no pudiera conversar.
  for (const message of authoredNarrative) {
    for (const fact of extractProtectedFacts(message)) {
      if (!ADK_BLOCKING_FACT_KINDS.has(fact.kind)) continue;
      if (!authorizedProtectedFacts.has(comparableProtectedFact(fact))) {
        unauthorizedKinds.add(fact.kind);
      }
    }
  }
  for (const kind of unauthorizedKinds) {
    rejections.push({ code: 'FACT_VALUE_MISMATCH', subject: kind });
  }

  // V4 — la acción y sus precondiciones.
  const claimsIncompleteIntakeAsRecorded = (input.context.capabilities.intake_missing ?? []).length > 0
    && input.proposal.response.messages.some((message) => {
      const normalized = message.normalize('NFD')
        .replace(/[\u0300-\u036f]/gu, '')
        .toLocaleLowerCase('es');
      return normalized.split(/[.!?\n]+/u).some((clause) => {
        // «Para dejarlo registrado necesito…» describes the purpose of the
        // request. It is not evidence that any field was already persisted.
        // Remove only that prospective phrase so a later, real assertion in
        // the same sentence (for example «ya tengo tu correo») is still seen.
        const assertiveClause = clause.replace(
          /\bpara\s+(?:poder\s+)?(?:dejar(?:lo|la|te|los|las)?|que\s+quede(?:n)?|quedar)(?:\s+(?:tus?\s+)?datos?)?\s+registrad[oa]s?\b/gu,
          '',
        );
        const claim = /\b(?:quedo|registre|registro|registrado|registrada|guarde|guardo|guardado|guardada|tengo|tenemos)\w*\b[^.!?]{0,60}\b(?:datos|nombre|apellido|correo|email|telefono)\b/u;
        const negatedClaim = /\b(?:no|aun\s+no|todavia\s+no)\b[^.!?]{0,24}\b(?:quedo|registre|registro|registrado|registrada|guarde|guardo|guardado|guardada|tengo|tenemos)\w*\b/u;
        return claim.test(assertiveClause) && !negatedClaim.test(assertiveClause);
      });
    });
  if (claimsIncompleteIntakeAsRecorded) {
    rejections.push({ code: 'UNSUPPORTED_OPERATIONAL_CLAIM', subject: 'contact_details' });
  }

  const action = input.proposal.proposed_action
  if (action.type === 'send_payment_link') {
    if (!input.context.capabilities.may_send_payment_link) {
      rejections.push({ code: 'ACTION_NOT_AUTHORIZED', subject: 'send_payment_link' })
    }
    if (input.context.commercial_state.selected_offering_code === null) {
      rejections.push({ code: 'COURSE_NOT_RESOLVED', subject: 'course_selection' })
    }
    if (input.context.commercial_state.selected_payment_plan === null) {
      rejections.push({ code: 'PLAN_NOT_SELECTED', subject: 'payment_plan' })
    }
    // `?? []`: un contexto construido a mano —tests, replay— no pasó por el
    // default del schema. El validador no puede asumir que Zod ya corrió.
    for (const field of input.context.capabilities.intake_missing ?? []) {
      rejections.push({ code: 'MISSING_INTAKE', subject: field })
    }
  }
  if (action.type === 'request_call_now' && !input.context.capabilities.may_request_call_now) {
    rejections.push({ code: 'ACTION_NOT_AUTHORIZED', subject: 'request_call_now' })
  }

  const moves = new Set([
    input.proposal.move.move,
    ...input.proposal.move.secondary_moves,
  ]);
  const missingIntake = input.context.capabilities.intake_missing ?? [];
  const currentPaymentDeferral = hasTemporalPaymentDeferral(
    input.context.turn.batch_messages.map((message) => ({ content: message.text })),
    input.context.commercial_state.awaiting_reply === 'payment_confirmation'
      || input.context.commercial_state.awaiting_reply === 'contact_details',
  );
  const currentPurchaseDecline = hasExplicitPurchaseDecline(
    input.context.turn.batch_messages.map((message) => ({ content: message.text })),
  );
  const paymentDeferred = (moves.has('decline_purchase') && currentPurchaseDecline) || (
    currentPaymentDeferral && (
      moves.has('defer_payment')
      || input.proposal.move.vetoes.includes('payment_link')
      || input.proposal.move.vetoes.includes('purchase')
    )
  );
  const mustGuideIntake = missingIntake.length > 0 && !paymentDeferred && (
    input.context.commercial_state.awaiting_reply === 'contact_details'
    || moves.has('request_payment_link')
  );
  if (
    mustGuideIntake
    && !mentionsMissingIntakeField(input.proposal.response.messages, missingIntake)
    && !rejections.some((reason) => reason.code === 'MISSING_INTAKE')
  ) {
    rejections.push({ code: 'MISSING_INTAKE', subject: missingIntake[0]! });
  }

  // V6 — ofertas visibles <= ledger, tope dos. Una oferta que el modelo
  // escribe dentro de su propia narrativa cuenta igual que la del campo.
  const declaredCallOffer = input.proposal.response.call_offer;
  // A declaration that also claims an enrolment already exists is removed by
  // the backend's state guard, so it cannot count as the required visible offer.
  const unsupportedDeclaredOffer = typeof declaredCallOffer === 'string'
    && /\b(?:inscripci[oó]n|matr[ií]cula|preinscripci[oó]n)\b[^.!?]{0,48}\b(?:confirmad|cargad|completad|realizad|registrad)\w*/iu.test(declaredCallOffer);
  if (unsupportedDeclaredOffer) {
    rejections.push({ code: 'UNSUPPORTED_OPERATIONAL_CLAIM', subject: 'call_offer' });
  }
  const offersACall = !unsupportedDeclaredOffer && typeof declaredCallOffer === 'string'
    && solicitsACallV1(declaredCallOffer, true)
    || input.proposal.response.messages.some((message) => solicitsACallV1(message))
  if (offersACall && !input.context.capabilities.may_offer_call) {
    rejections.push({ code: 'CALL_BUDGET_EXHAUSTED', subject: 'call_offer' })
  }

  const channelChoice = moves.has('continue_by_chat') || moves.has('decline_call');
  if ((channelChoice || input.proposal.move.vetoes.includes('call')) && !supportsChatPreferenceV1(
    currentCustomerText, input.context.commercial_state.awaiting_reply === 'call_or_chat',
  )) {
    rejections.push({ code: 'CHANNEL_PREFERENCE_NOT_SUPPORTED', subject: 'call_preference' });
  }
  if (input.proposal.move.vetoes.includes('call') && !channelChoice) rejections.push({ code: 'CHANNEL_PREFERENCE_NOT_SUPPORTED', subject: 'call_preference' });
  if (channelChoice && offersACall) rejections.push({ code: 'CHANNEL_PREFERENCE_NOT_SUPPORTED', subject: 'call_offer' });
  const callRequestSupported = supportsCallRequestV1(
    currentCustomerText,
    input.context.commercial_state.awaiting_reply === 'call_or_chat',
  );
  const requestedCallNow = moves.has('request_call') && input.proposal.proposed_action.type === 'request_call_now'
    && input.context.capabilities.may_request_call_now && callRequestSupported;
  if ((moves.has('request_call') || input.proposal.proposed_action.type === 'request_call_now')
      && !requestedCallNow
      && !rejections.some((reason) => reason.code === 'ACTION_NOT_AUTHORIZED' && reason.subject === 'request_call_now')) {
    rejections.push({ code: 'ACTION_NOT_AUTHORIZED', subject: 'request_call_now' });
  }
  const state = input.context.commercial_state;
  if ((moves.has('select_course') || moves.has('ask_course_information'))
    && state.selected_offering_code !== null && input.context.capabilities.may_offer_call
    && state.call_offer_count === 0 && state.call_preference === 'unknown'
    && state.call_offer_status === 'not_offered' && !channelChoice
    && !requestedCallNow && !offersACall) {
    rejections.push({ code: 'CALL_OFFER_REQUIRED', subject: 'call_offer' });
  }

  // V7 — ninguna URL escrita por el modelo. El link lo inserta el backend.
  for (const message of input.proposal.response.messages) {
    if (extractUrlCandidates(message).length > 0) {
      rejections.push({ code: 'FACT_VALUE_MISMATCH', subject: 'model_authored_url' })
      break
    }
  }

  if (rejections.length === 0) return null

  return {
    schema_version: 1,
    rejection_id: input.rejection_id,
    attempt: 1,
    rejections,
    authorized_alternatives: {
      fact_ids: [...planned],
      actions: authorizedActionsV1(input.context),
      missing_information: [...(input.context.capabilities.intake_missing ?? [])],
    },
  }
}

function authorizedActionsV1(context: AgentAContextV1): string[] {
  const actions: string[] = ['none']
  if (context.capabilities.may_send_payment_link) actions.push('send_payment_link')
  if (context.capabilities.may_request_call_now) actions.push('request_call_now')
  return actions
}

/**
 * Solicitud de llamada dentro de la narrativa del modelo. Mencionar una
 * llamada no es ofrecerla: confirmar una que el cliente pidió, o reconocer que
 * la rechazó, habla de llamadas sin gastar presupuesto.
 */
const CALL_SOLICITATION_V1 = /\b(?:te\s+llamo|te\s+llamamos|una\s+llamada|coordinamos\s+una\s+llamada|prefer[íi]s\s+que\s+te\s+llame)\b/iu
const NOT_AN_OFFER_V1 = /\b(?:ya\s+(?:qued|registr|solicit)|no\s+te\s+llam|sin\s+llamada)/iu
const DECLARED_CALL_CHANNEL_V1 = /\b(?:llam|videollam)|tel[eé]fon|telef[oó]n|\bvoz\b|\bcontact(?:arte|emos)\b/iu

function solicitsACallV1(message: string, declaredOffer = false): boolean {
  if (declaredOffer) {
    return message.split(/[.;!?…¿¡,]|\s+(?:y|pero|aunque|sin embargo)\s+/iu)
      .some(clause => DECLARED_CALL_CHANNEL_V1.test(clause) && !NOT_AN_OFFER_V1.test(clause))
  }
  return CALL_SOLICITATION_V1.test(message)
    && !NOT_AN_OFFER_V1.test(message)
}

/**
 * Escalera de reparación (§ 07). Se baja un escalón sólo cuando el anterior no
 * alcanza, y el tercero es un piso, no una opción.
 *
 * N1 se acepta sólo si conserva contenido. Antes, podar hasta dejar la nada se
 * resolvía con una frase fija: el cliente recibía una oración que no contestaba
 * lo que había preguntado, y el modelo nunca se enteraba.
 */
export type RepairLevelV1 =
  | { readonly level: 'N1'; readonly messages: readonly string[] }
  | { readonly level: 'N2'; readonly messages: readonly [] }
  | { readonly level: 'N3'; readonly messages: readonly [] }

export function decideRepairLevelV1(input: {
  readonly rejection: TurnRejectionV1
  readonly pruned_messages: readonly string[]
  readonly repair_enabled: boolean
  readonly already_repaired?: boolean
  /** Último mensaje del agente, para no resolver podando hacia él. */
  readonly previous_agent_reply?: string | null
}): RepairLevelV1 {
  const survives = input.pruned_messages.some((message) => message.trim().length > 0)

  // Un rechazo de acción no es podable: no hay oración que quitar que vuelva
  // válida una acción sin precondición. Una repetición tampoco: quitar
  // oraciones sólo puede acercar el borrador al turno anterior, nunca alejarlo.
  const prunable = !input.rejection.rejections.some((reason) => (
    reason.code === 'ACTION_NOT_AUTHORIZED'
    || reason.code === 'CALL_BUDGET_EXHAUSTED'
    || reason.code === 'MISSING_INTAKE'
    || reason.code === 'REPEATED_AGENT_REPLY'
    || reason.code === 'CALL_OFFER_REQUIRED'
    || reason.code === 'CHANNEL_PREFERENCE_NOT_SUPPORTED'
  ))

  // La repetición puede aparecer recién al podar: el borrador traía además
  // algo no autorizado, se le quitó, y lo que quedó es el mensaje anterior.
  // Entregarlo sería contestar con el turno previo, así que la poda deja de
  // ser una resolución válida.
  const prunesIntoRepeat = input.previous_agent_reply !== null
    && input.previous_agent_reply !== undefined
    && sameVisibleText(input.pruned_messages, input.previous_agent_reply)

  if (prunable && survives && !prunesIntoRepeat) {
    return { level: 'N1', messages: input.pruned_messages }
  }
  // A5: tope duro. Una reparación ya intentada no abre otra, o un rechazo
  // determinista produciría un lazo.
  if (input.repair_enabled && input.already_repaired !== true) {
    return { level: 'N2', messages: [] }
  }
  // R2: apagar el flag cae a N3, nunca a silencio.
  return { level: 'N3', messages: [] }
}
