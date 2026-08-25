import {
  DecisionResponseTypeSchema,
  DecisionSchema,
  IntentSchema,
  MEMORY_CANDIDATE_TYPES,
  type Decision,
} from '../../schemas/contracts'
import { StudyxHttpError, withFullJitterRetry } from '../../utils/http'
import type { GenerateDecisionInput, GeneratedDecision } from './decision-generator'

/**
 * Direct-Gemini decision provider. Calls the Gemini API straight from the
 * ADK runtime instead of routing through Botpress AI Spend. This adapter
 * only executes an already-composed prompt (`input.instructions`) and
 * validates the model's JSON output against the canonical `DecisionSchema`
 * — it never builds prompts and never applies its own validation rules.
 *
 * Retry/backoff and error shape are NOT reimplemented here: the package
 * already ships `withFullJitterRetry` (abort-aware backoff) and
 * `StudyxHttpError` ({code, retryable, status}) in `utils/http.ts`, used
 * elsewhere by `requestStudyxJson`. This adapter reuses both directly and
 * only supplies a retry predicate scoped to 429/503, per its own contract.
 */

export const DEFAULT_GEMINI_MODEL = 'gemini-3.6-flash'

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'

/** Only these statuses are worth a single retry; everything else is final. */
const RETRYABLE_STATUSES = new Set([429, 503])

/** Exactly one retry beyond the first attempt (2 attempts total). */
const ADDITIONAL_RETRIES = 1

/**
 * Small, bounded, fixed backoff before the single retry — short enough that
 * tests never need to sleep real time (fake timers drive `withFullJitterRetry`'s
 * internal, abort-aware sleep instead).
 */
const RETRY_BACKOFF_MS = 200

/**
 * Every Gemini-direct failure is a `StudyxHttpError` — the same
 * {code, retryable, status} shape `requestStudyxJson` already uses — so
 * callers get one consistent, typed/identifiable error taxonomy instead of
 * a parallel near-identical class. Re-exported under a Gemini-specific name
 * so call sites can `instanceof GeminiDecisionError` without reaching into
 * `utils/http`.
 */
export { StudyxHttpError as GeminiDecisionError }

function buildGeminiUrl(model: string, apiKey: string): string {
  return `${GEMINI_API_BASE}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`
}

/**
 * Gemini structured-output schema (OpenAPI 3.0 subset — no `oneOf`/discriminated
 * unions with `.strict()`-style semantics, `enum` only applies to STRING type,
 * `nullable` is a sibling flag rather than part of `type`) mirroring the shape
 * of `DecisionSchema` in `../../schemas/contracts`.
 *
 * Why this exists: the managed (`Autonomous.execute`) path constrains model
 * output via the ADK exit's own structured schema. This adapter only ever
 * sent free-form prose instructions, so the model had no hard guarantee of
 * emitting the exact field names/enums/nesting `DecisionSchema` requires —
 * confirmed live: gemini-3.5-flash returned `text` instead of `response`,
 * invented an `intent` enum value, omitted `confidence`/`reason_code`
 * entirely, and shaped `retrieval_used` as an array instead of an object.
 * `responseSchema` makes the API itself constrain generation to this shape.
 *
 * Deliberately NOT a source of truth: `DecisionSchema.strict().superRefine(...)`
 * still does the real validation after parsing. `business_action` here is a
 * permissive object (Gemini's schema format has no clean way to express a
 * 4-way discriminated union) — it only steers the model toward the right key
 * names when it does emit an action; `DecisionSchema` is what rejects an
 * invalid one. `kind` and `next_state`'s enums are inlined (small, stable,
 * not exported by contracts.ts) with a comment tying them back to their
 * source; every other enum is imported directly so this schema can never
 * silently drift from `DecisionSchema`.
 */
function buildDecisionResponseSchema(): unknown {
  return {
    type: 'OBJECT',
    properties: {
      schema_version: { type: 'INTEGER' },
      intent: { type: 'STRING', enum: [...IntentSchema.options] },
      // DecisionSchema.kind: z.enum(['reply', 'clarify', 'suppress'])
      kind: { type: 'STRING', enum: ['reply', 'clarify', 'suppress'] },
      response: { type: 'STRING', nullable: true },
      response_type: { type: 'STRING', enum: [...DecisionResponseTypeSchema.options], nullable: true },
      confidence: { type: 'NUMBER' },
      reason_code: { type: 'STRING' },
      business_action: {
        type: 'OBJECT',
        nullable: true,
        properties: {
          type: {
            type: 'STRING',
            enum: ['mark_hot_lead', 'log_objection', 'request_call_now', 'send_payment_link'],
          },
          score: { type: 'NUMBER' },
          objection_key: { type: 'STRING' },
          quote: { type: 'STRING' },
          reason: { type: 'STRING', enum: ['direct_request', 'accepted_offer'] },
          course_of_interest: { type: 'STRING' },
          plan_code: { type: 'STRING', enum: ['monthly_12', 'monthly_6', 'one_time'] },
          offering_sku: { type: 'STRING', nullable: true },
        },
      },
      memory_candidates: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            type: { type: 'STRING', enum: [...MEMORY_CANDIDATE_TYPES] },
            key: { type: 'STRING' },
            value: { type: 'STRING' },
            source_quote: { type: 'STRING' },
            confidence: { type: 'NUMBER' },
          },
          required: ['type', 'key', 'value', 'source_quote', 'confidence'],
        },
      },
      missing_information: { type: 'ARRAY', items: { type: 'STRING' } },
      // DecisionSchema.next_state: z.enum(['completed', 'waiting_user'])
      next_state: { type: 'STRING', enum: ['completed', 'waiting_user'] },
      retrieval_used: {
        type: 'OBJECT',
        nullable: true,
        properties: {
          kb: { type: 'BOOLEAN' },
          long_term_memory: { type: 'BOOLEAN' },
          summary_version: { type: 'INTEGER', nullable: true },
        },
        required: ['kb', 'long_term_memory', 'summary_version'],
      },
    },
    // Every DecisionSchema key is a required key of the *object* — several
    // (response, response_type, business_action, retrieval_used) are
    // z.nullable() rather than z.optional(), so the key itself is mandatory
    // even when its value is null.
    required: [
      'schema_version',
      'intent',
      'kind',
      'response',
      'response_type',
      'confidence',
      'reason_code',
      'business_action',
      'memory_candidates',
      'missing_information',
      'next_state',
      'retrieval_used',
    ],
  }
}

function buildRequestBody(instructions: string): unknown {
  return {
    // No `role` field: 'system' is not a documented Content.role value for
    // the Gemini REST API's systemInstruction — only `parts` is expected.
    systemInstruction: {
      parts: [{ text: instructions }],
    },
    // Minimal ADK-style user turn: the model already has the full decision
    // prompt in systemInstruction, this just triggers a response.
    contents: [
      {
        role: 'user',
        parts: [{ text: 'Genera la decisión para el turno actual según las instrucciones del sistema.' }],
      },
    ],
    generationConfig: {
      temperature: 0.1,
      responseMimeType: 'application/json',
      responseSchema: buildDecisionResponseSchema(),
    },
  }
}

function normalizeGeminiDecision(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  // The schema version is an adapter-owned envelope field, not business
  // content. Older/smaller models sometimes emit 1 despite the v4 prompt;
  // normalize it before the canonical schema validates every semantic field.
  let decision: Record<string, unknown> = {
    ...(value as Record<string, unknown>),
    schema_version: 4,
  }
  const rawAction = decision.business_action
  if (rawAction && typeof rawAction === 'object' && !Array.isArray(rawAction)) {
    const action = rawAction as Record<string, unknown>
    let normalizedAction: Record<string, unknown> | null = action
    if (action.type === 'mark_hot_lead') {
      normalizedAction = typeof action.score === 'number'
        ? { type: action.type, score: action.score }
        : null
    } else if (action.type === 'log_objection') {
      normalizedAction =
        typeof action.objection_key === 'string'
        && action.objection_key.length > 0
        && typeof action.quote === 'string'
        && action.quote.length > 0
          ? { type: action.type, objection_key: action.objection_key, quote: action.quote }
          : null
    } else if (action.type === 'request_call_now') {
      normalizedAction = action.reason === 'direct_request' || action.reason === 'accepted_offer'
        ? { type: action.type, reason: action.reason }
        : null
      if (
        normalizedAction
        && typeof action.course_of_interest === 'string'
        && action.course_of_interest.length > 0
      ) {
        normalizedAction.course_of_interest = action.course_of_interest
      }
    } else if (action.type === 'send_payment_link') {
      normalizedAction = ['monthly_12', 'monthly_6', 'one_time'].includes(String(action.plan_code))
        ? {
            type: action.type,
            plan_code: action.plan_code,
            offering_sku:
              typeof action.offering_sku === 'string' && action.offering_sku.length > 0
                ? action.offering_sku
                : null,
          }
        : null
    }
    decision = { ...decision, business_action: normalizedAction }
  }

  // Gemini's response schema controls primitive types but cannot express
  // DecisionSchema's cross-field rules. This repair only fills the safe,
  // side-effect-free clarification shape; it never invents answer content.
  if (
    decision.kind === 'clarify'
    && typeof decision.response === 'string'
    && decision.response.length > 0
  ) {
    decision = {
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

  return decision
}

function extractFirstCandidateText(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const candidates = (payload as { candidates?: unknown }).candidates
  if (!Array.isArray(candidates) || candidates.length === 0) return null

  const first = candidates[0]
  if (!first || typeof first !== 'object') return null

  const content = (first as { content?: unknown }).content
  if (!content || typeof content !== 'object') return null

  const parts = (content as { parts?: unknown }).parts
  if (!Array.isArray(parts) || parts.length === 0) return null

  const firstPart = parts[0]
  if (!firstPart || typeof firstPart !== 'object') return null

  const text = (firstPart as { text?: unknown }).text
  return typeof text === 'string' ? text : null
}

/**
 * The model may wrap the JSON object in prose or a ```json code fence.
 * Isolates the first balanced `{ ... }` substring, respecting strings so
 * braces inside string values don't throw off the depth count.
 */
function extractJsonObject(text: string): string | null {
  const start = text.indexOf('{')
  if (start === -1) return null

  let depth = 0
  let inString = false
  let escapeNext = false

  for (let index = start; index < text.length; index++) {
    const char = text[index]

    if (escapeNext) {
      escapeNext = false
      continue
    }
    if (char === '\\') {
      escapeNext = true
      continue
    }
    if (char === '"') {
      inString = !inString
      continue
    }
    if (inString) continue

    if (char === '{') {
      depth++
    } else if (char === '}') {
      depth--
      if (depth === 0) return text.slice(start, index + 1)
    }
  }

  return null
}

/** Scopes `withFullJitterRetry`'s generic retry predicate to 429/503 only. */
function isGeminiRetryable(error: unknown): boolean {
  return (
    error instanceof StudyxHttpError &&
    error.status !== null &&
    RETRYABLE_STATUSES.has(error.status)
  )
}

/**
 * Any error that escapes `withFullJitterRetry` that is not already a
 * `StudyxHttpError` is either the raw abort `DOMException` it rethrows
 * as-is (signal aborted before/between attempts, or during backoff) or —
 * defensively — something unexpected. Both get normalized into the
 * adapter's typed error shape at the public boundary. Never reads the
 * original error's `.message`: a fetch failure can legitimately embed the
 * request URL (which carries `?key=...`), so nothing from the underlying
 * cause is ever copied into the thrown error — the code is always a fixed,
 * leak-proof string.
 */
function normalizeBoundaryError(error: unknown): StudyxHttpError {
  if (error instanceof StudyxHttpError) return error
  if (error instanceof DOMException && error.name === 'AbortError') {
    return new StudyxHttpError('GEMINI_ABORTED', false)
  }
  return new StudyxHttpError('GEMINI_UNKNOWN_ERROR', false)
}

async function performAttempt(
  url: string,
  body: unknown,
  signal: AbortSignal,
): Promise<Decision> {
  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new StudyxHttpError('GEMINI_NETWORK_ERROR', false)
  }

  if (!response.ok) {
    throw new StudyxHttpError(
      `GEMINI_HTTP_${response.status}`,
      RETRYABLE_STATUSES.has(response.status),
      response.status,
    )
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new StudyxHttpError('GEMINI_INVALID_RESPONSE', false, response.status)
  }

  const text = extractFirstCandidateText(payload)
  if (text === null) {
    throw new StudyxHttpError('GEMINI_EMPTY_RESPONSE', false, response.status)
  }

  const jsonSubstring = extractJsonObject(text)
  if (jsonSubstring === null) {
    throw new StudyxHttpError('GEMINI_INVALID_JSON', false, response.status)
  }

  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(jsonSubstring)
  } catch {
    throw new StudyxHttpError('GEMINI_INVALID_JSON', false, response.status)
  }

  const result = DecisionSchema.safeParse(normalizeGeminiDecision(parsedJson))
  if (!result.success) {
    console.error('GEMINI_SCHEMA_INVALID', JSON.stringify({
      issues: result.error.issues.map((issue) => ({
        code: issue.code,
        path: issue.path,
        message: issue.message,
      })),
      parsed_keys: parsedJson && typeof parsedJson === 'object' && !Array.isArray(parsedJson)
        ? Object.keys(parsedJson as Record<string, unknown>)
        : [],
      action_keys:
        parsedJson
        && typeof parsedJson === 'object'
        && !Array.isArray(parsedJson)
        && (parsedJson as Record<string, unknown>).business_action
        && typeof (parsedJson as Record<string, unknown>).business_action === 'object'
        && !Array.isArray((parsedJson as Record<string, unknown>).business_action)
          ? Object.keys((parsedJson as Record<string, Record<string, unknown>>).business_action)
          : [],
    }))
    throw new StudyxHttpError('GEMINI_SCHEMA_INVALID', false, response.status)
  }

  return result.data
}

export async function generateGeminiDecision(
  input: GenerateDecisionInput,
): Promise<GeneratedDecision> {
  const model = input.model || DEFAULT_GEMINI_MODEL
  const url = buildGeminiUrl(model, input.apiKey)
  const body = buildRequestBody(input.instructions)
  const startedAt = Date.now()

  try {
    const decision = await withFullJitterRetry(
      () => performAttempt(url, body, input.signal),
      {
        signal: input.signal,
        additionalRetries: ADDITIONAL_RETRIES,
        baseDelayMs: RETRY_BACKOFF_MS,
        maxDelayMs: RETRY_BACKOFF_MS,
        isRetryable: isGeminiRetryable,
      },
    )

    return {
      decision,
      provider: 'google-ai-direct',
      model,
      latencyMs: Date.now() - startedAt,
    }
  } catch (error) {
    throw normalizeBoundaryError(error)
  }
}
