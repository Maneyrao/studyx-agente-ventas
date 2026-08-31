import {
  AgentATurnProposalV1Schema,
  type AgentAContextV1,
  type AgentATurnProposalV1,
} from '../../schemas/agent-a-brain';
import {
  ComposedNarrativeV1Schema,
  type ComposedNarrativeV1,
  type TurnPlanV1,
} from '../../schemas/conversation-pipeline';
import { buildAgentABrainInstructionsV1 } from '../../prompts/agent-a-brain-v1';
import { isValueFreeNarrativePortable } from '../../utils/authorized-egress';

const GROQ_CHAT_COMPLETIONS_URL = 'https://api.groq.com/openai/v1/chat/completions';
const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';
const DEEPSEEK_RESPONSES_URL = 'https://api.deepseek.com/responses';
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
export const DEFAULT_AGENT_A_BRAIN_MODEL = 'openai/gpt-oss-120b';
export const DEFAULT_AGENT_A_BRAIN_OPENAI_MODEL = 'gpt-5.6-terra';
export const DEFAULT_AGENT_A_BRAIN_OPENAI_FALLBACK_MODEL = 'gpt-5.6-luna';
export const DEFAULT_AGENT_A_BRAIN_DEEPSEEK_MODEL = 'deepseek-v4-flash';
export const DEFAULT_AGENT_A_BRAIN_GEMINI_MODEL = 'gemini-2.5-flash';
export const AGENT_A_BRAIN_DEADLINE_MS = 4_500;
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
}

function parseDeepSeekJsonContent(content: string): unknown {
  const trimmed = content.trim();
  const fenced = /^```json[\t ]*\r?\n([\s\S]*?)\r?\n```$/iu.exec(trimmed);
  return JSON.parse(fenced?.[1] ?? trimmed);
}

export async function generateDeepSeekAgentATurnProposalV1(input: {
  readonly context: AgentAContextV1;
  readonly apiKey: string;
  readonly signal: AbortSignal;
  readonly model?: string;
  readonly timeout_ms?: number;
}): Promise<GeneratedAgentATurnProposalV1> {
  const model = input.model?.trim() || DEFAULT_AGENT_A_BRAIN_DEEPSEEK_MODEL;
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
      response = await fetch(DEEPSEEK_RESPONSES_URL, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${input.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model,
          instructions: buildAgentABrainInstructionsV1(input.context),
          input: 'Return only the single AgentATurnProposalV1 JSON object.',
          reasoning: { effort: 'none' },
          temperature: 0.2,
          stream: false,
          max_output_tokens: 800,
          text: {
            format: {
              type: 'json_schema',
              name: 'studyx_agent_a_turn_proposal_v1',
              schema: proposalJsonSchema(),
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
      throw new AgentABrainError('BRAIN_DEEPSEEK_INVALID_RESPONSE', response.status);
    }
    const content = extractResponsesContent(payload);
    if (content === null) throw new AgentABrainError('BRAIN_DEEPSEEK_EMPTY_RESPONSE', response.status);
    let decoded: unknown;
    try {
      decoded = parseDeepSeekJsonContent(content);
    } catch {
      throw new AgentABrainError('BRAIN_DEEPSEEK_INVALID_JSON', response.status);
    }
    return {
      proposal: parseAgentATurnProposalV1(decoded, input.context),
      provider: 'deepseek-direct',
      model,
      latency_ms: Date.now() - startedAt,
      attempt_count: 1,
    };
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
  'select_payment_plan', 'defer_payment', 'request_payment_link', 'decline_purchase', 'unknown',
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

function closedObject(properties: Record<string, unknown>) {
  return { type: 'object', properties, required: Object.keys(properties), additionalProperties: false };
}

function proposalJsonSchema(): unknown {
  const nullableString = { anyOf: [{ type: 'string' }, { type: 'null' }] };
  const move = closedObject({
    schema_version: { type: 'integer', enum: [1] },
    move: { type: 'string', enum: [...MOVE_KINDS] },
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
      messages: { type: 'array', minItems: 1, maxItems: 3, items: { type: 'string' } },
      call_offer: { anyOf: [{ type: 'string' }, { type: 'null' }] },
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
    reasoning_effort: 'low',
    stream: false,
    max_completion_tokens: 800,
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

function extractResponsesContent(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const record = payload as Record<string, unknown>;
  if (typeof record.output_text === 'string') return record.output_text;
  if (!Array.isArray(record.output)) return null;
  for (const output of record.output) {
    if (!output || typeof output !== 'object') continue;
    const content = (output as Record<string, unknown>).content;
    if (!Array.isArray(content)) continue;
    for (const item of content) {
      if (!item || typeof item !== 'object') continue;
      const candidate = item as Record<string, unknown>;
      if (candidate.type === 'output_text' && typeof candidate.text === 'string') {
        return candidate.text;
      }
    }
  }
  return null;
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
              schema: proposalJsonSchema(),
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

function normalizeStrictProposal(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const proposal = value as Record<string, unknown>;
  const move = proposal.move;
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
  if (![...moveKinds].some((kind) => AREA_REFERENCE_MOVES.has(kind))) {
    delete normalizedMove.area_reference;
  }
  if (![...moveKinds].some((kind) => PAYMENT_PLAN_MOVES.has(kind))) {
    delete normalizedMove.payment_plan;
  }
  return { ...proposal, move: normalizedMove };
}

function authorizedFactIds(context: AgentAContextV1): Set<string> {
  const ids = new Set(context.catalog.selected_offering?.facts.map((fact) => fact.id) ?? []);
  for (const area of context.catalog.areas) ids.add(area.fact_id);
  for (const offering of context.catalog.candidate_offerings) {
    ids.add(offering.fact_id);
  }
  return ids;
}

export function parseAgentATurnProposalV1(raw: unknown, context: AgentAContextV1): AgentATurnProposalV1 {
  const parsed = AgentATurnProposalV1Schema.safeParse(normalizeStrictProposal(raw));
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new AgentABrainError(
      'BRAIN_INVALID_SCHEMA',
      null,
      first ? `${first.path.join('.') || 'root'}:${first.message}`.slice(0, 240) : null,
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
  for (const offering of context.catalog.candidate_offerings) values.set(offering.fact_id, offering.display_name);
  return values;
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
  const plannedIds = new Set(input.planned_fact_ids);
  const citedIds = new Set(input.proposal.used_fact_ids.filter((id) => plannedIds.has(id)));
  const valuesById = commercialValuesByFactId(input.context);
  const unauthorizedValues = [...valuesById]
    .filter(([id]) => !citedIds.has(id))
    .map(([, value]) => value.normalize('NFKC').trim().toLocaleLowerCase('es'))
    .filter((value) => value.length >= 3);
  const safeMessages = input.proposal.response.messages.filter((message) => {
    const normalized = message.normalize('NFKC').toLocaleLowerCase('es');
    // This layer owns composition, not business truth. The structured parser
    // already blocks URLs and unknown evidence IDs; the backend sees the exact
    // text next and validates every protected commercial assertion against its
    // canonical snapshot. Filtering by sales vocabulary here caused valid
    // natural language (for example "tenemos opciones") to be replaced by a
    // canned fallback before the authority boundary could inspect it.
    return !unauthorizedValues.some((value) => normalized.includes(value));
  });
  const messages = safeMessages.length > 0
    ? safeMessages
    : [safeContextualOpening(input.response_goal, input.context.commercial_state.call_offer_count)];

  return ComposedNarrativeV1Schema.parse({
    schema_version: 1,
    narrative: {
      opening: messages[0],
      explanation: messages[1] ?? null,
      next_question: messages[2] ?? null,
    },
    call_offer: input.proposal.response.call_offer
      && isValueFreeNarrativePortable(input.proposal.response.call_offer)
      ? input.proposal.response.call_offer
      : null,
    used_fact_ids: [...citedIds],
  });
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
