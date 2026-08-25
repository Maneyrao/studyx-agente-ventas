import {
  DecisionResponseTypeSchema,
  DecisionSchema,
  IntentSchema,
  MEMORY_CANDIDATE_TYPES,
  type Decision,
} from '../../schemas/contracts'
import { StudyxHttpError, withFullJitterRetry } from '../../utils/http'
import type { GenerateDecisionInput, GeneratedDecision } from './decision-generator'

export const DEFAULT_GROQ_MODEL = 'openai/gpt-oss-120b'

const GROQ_CHAT_COMPLETIONS_URL = 'https://api.groq.com/openai/v1/chat/completions'
const DEFAULT_TIMEOUT_MS = 10_000
const RETRYABLE_STATUSES = new Set([429, 503])

export { StudyxHttpError as GroqDecisionError }

const closedObject = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
})

function buildDecisionJsonSchema(): unknown {
  const nullSchema = { type: 'null' }
  const businessAction = {
    anyOf: [
      nullSchema,
      closedObject({
        type: { type: 'string', enum: ['mark_hot_lead'] },
        score: { type: 'number' },
      }),
      closedObject({
        type: { type: 'string', enum: ['log_objection'] },
        objection_key: { type: 'string' },
        quote: { type: 'string' },
      }),
      closedObject({
        type: { type: 'string', enum: ['request_call_now'] },
        reason: { type: 'string', enum: ['direct_request', 'accepted_offer'] },
        // Groq strict schemas require every property to be required and reject
        // overlapping anyOf discriminators. Null represents the canonical
        // action's optional course and is removed before Zod validation.
        course_of_interest: { anyOf: [{ type: 'string' }, nullSchema] },
      }),
      closedObject({
        type: { type: 'string', enum: ['send_payment_link'] },
        plan_code: { type: 'string', enum: ['monthly_12', 'monthly_6', 'one_time'] },
        offering_sku: { anyOf: [{ type: 'string' }, nullSchema] },
      }),
    ],
  }

  return closedObject({
    schema_version: { type: 'integer', enum: [3, 4] },
    intent: { type: 'string', enum: [...IntentSchema.options] },
    kind: { type: 'string', enum: ['reply', 'clarify', 'suppress'] },
    response: { anyOf: [{ type: 'string' }, nullSchema] },
    response_type: {
      anyOf: [
        { type: 'string', enum: [...DecisionResponseTypeSchema.options] },
        nullSchema,
      ],
    },
    confidence: { type: 'number' },
    reason_code: { type: 'string' },
    business_action: businessAction,
    memory_candidates: {
      type: 'array',
      items: closedObject({
        type: { type: 'string', enum: [...MEMORY_CANDIDATE_TYPES] },
        key: { type: 'string' },
        value: { type: 'string' },
        source_quote: { type: 'string' },
        confidence: { type: 'number' },
      }),
    },
    missing_information: { type: 'array', items: { type: 'string' } },
    next_state: { type: 'string', enum: ['completed', 'waiting_user'] },
    retrieval_used: {
      anyOf: [
        nullSchema,
        closedObject({
          kb: { type: 'boolean' },
          long_term_memory: { type: 'boolean' },
          summary_version: { anyOf: [{ type: 'integer' }, nullSchema] },
        }),
      ],
    },
  })
}

function buildRequestBody(instructions: string, model: string): unknown {
  const usesCompoundJsonMode = model === 'groq/compound' || model === 'groq/compound-mini'
  return {
    model,
    messages: [
      { role: 'system', content: instructions },
      {
        role: 'user',
        content: 'Generá únicamente el objeto JSON de decisión para el turno actual según las instrucciones.',
      },
    ],
    temperature: 0.1,
    stream: false,
    max_completion_tokens: 1_024,
    response_format: usesCompoundJsonMode
      ? { type: 'json_object' }
      : {
          type: 'json_schema',
          json_schema: {
            name: 'studyx_turn_decision',
            strict: true,
            schema: buildDecisionJsonSchema(),
          },
        },
  }
}

function extractContent(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const choices = (payload as { choices?: unknown }).choices
  if (!Array.isArray(choices) || choices.length === 0) return null
  const first = choices[0]
  if (!first || typeof first !== 'object') return null
  const message = (first as { message?: unknown }).message
  if (!message || typeof message !== 'object') return null
  const content = (message as { content?: unknown }).content
  return typeof content === 'string' ? content : null
}

function normalizeStrictDecision(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  let decision = value as Record<string, unknown>
  const action = decision.business_action
  if (action && typeof action === 'object' && !Array.isArray(action)) {
    const actionRecord = action as Record<string, unknown>
    if (actionRecord.type === 'request_call_now' && actionRecord.course_of_interest === null) {
      const { course_of_interest: _omitted, ...normalizedAction } = actionRecord
      decision = { ...decision, business_action: normalizedAction }
    }
  }

  // JSON Schema can guarantee field types, but not every cross-field rule in
  // DecisionSchema. A clarification has no side effect and always waits for
  // one missing answer, so this repair is deterministic and fail-safe.
  if (
    decision.kind === 'clarify'
    && typeof decision.response === 'string'
    && decision.response.length > 0
  ) {
    return {
      ...decision,
      response_type: 'clarification',
      business_action: null,
      missing_information:
        Array.isArray(decision.missing_information) && decision.missing_information.length > 0
          ? decision.missing_information
          : ['respuesta_del_cliente'],
      next_state: 'waiting_user',
    }
  }

  // A suppress decision intentionally emits no customer-facing text and can
  // never carry a side effect or durable memory. Some providers satisfy the
  // strict JSON schema with an empty string instead of null; canonicalize the
  // shape before the cross-field DecisionSchema validates it.
  if (decision.kind === 'suppress') {
    return {
      ...decision,
      response: null,
      response_type: null,
      business_action: null,
      memory_candidates: [],
      missing_information: [],
      next_state: 'completed',
    }
  }

  return decision
}

async function performAttempt(
  apiKey: string,
  body: unknown,
  signal: AbortSignal,
): Promise<Decision> {
  let response: Response
  try {
    response = await fetch(GROQ_CHAT_COMPLETIONS_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal,
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new StudyxHttpError('GROQ_NETWORK_ERROR', false)
  }

  if (!response.ok) {
    let providerErrorCode: unknown = null
    try {
      const errorPayload = await response.json() as {
        error?: { code?: unknown; type?: unknown }
      }
      providerErrorCode = errorPayload.error?.code ?? errorPayload.error?.type ?? null
    } catch {
      // The response body is untrusted and optional. Never include it in an
      // error code or log because providers can echo request contents.
    }
    const isSchemaGenerationFailure = response.status === 400
      && providerErrorCode === 'json_validate_failed'
    throw new StudyxHttpError(
      isSchemaGenerationFailure
        ? 'GROQ_HTTP_400_JSON_VALIDATE_FAILED'
        : `GROQ_HTTP_${response.status}`,
      RETRYABLE_STATUSES.has(response.status) || isSchemaGenerationFailure,
      response.status,
    )
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new StudyxHttpError('GROQ_INVALID_RESPONSE', false, response.status)
  }

  const content = extractContent(payload)
  if (content === null) {
    throw new StudyxHttpError('GROQ_EMPTY_RESPONSE', false, response.status)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    throw new StudyxHttpError('GROQ_INVALID_JSON', false, response.status)
  }

  const decision = DecisionSchema.safeParse(normalizeStrictDecision(parsed))
  if (!decision.success) {
    console.error('GROQ_SCHEMA_INVALID', JSON.stringify({
      issues: decision.error.issues.map((issue) => ({
        code: issue.code,
        path: issue.path,
        message: issue.message,
      })),
      parsed_keys: parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? Object.keys(parsed as Record<string, unknown>)
        : [],
    }))
    throw new StudyxHttpError('GROQ_SCHEMA_INVALID', true, response.status)
  }
  return decision.data
}

export async function generateGroqDecision(
  input: GenerateDecisionInput,
): Promise<GeneratedDecision> {
  const model = input.model || DEFAULT_GROQ_MODEL
  const controller = new AbortController()
  let timedOut = false
  const onParentAbort = () => controller.abort()
  input.signal.addEventListener('abort', onParentAbort, { once: true })
  if (input.signal.aborted) controller.abort()
  const timeout = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, input.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  const startedAt = Date.now()

  try {
    const decision = await withFullJitterRetry(
      () => performAttempt(input.apiKey, buildRequestBody(input.instructions, model), controller.signal),
      {
        signal: controller.signal,
        additionalRetries: 1,
        baseDelayMs: 200,
        maxDelayMs: 200,
        isRetryable: (error) => error instanceof StudyxHttpError && error.retryable,
      },
    )
    return {
      decision,
      provider: 'groq-direct',
      model,
      latencyMs: Date.now() - startedAt,
    }
  } catch (error) {
    if (controller.signal.aborted) {
      throw new StudyxHttpError(timedOut ? 'GROQ_TIMEOUT' : 'GROQ_ABORTED', false)
    }
    if (error instanceof StudyxHttpError) throw error
    throw new StudyxHttpError('GROQ_UNKNOWN_ERROR', false)
  } finally {
    clearTimeout(timeout)
    input.signal.removeEventListener('abort', onParentAbort)
  }
}
