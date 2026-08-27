import {
  ConversationMoveV1Schema,
  type ConversationMoveV1,
} from '../../schemas/conversation-pipeline'
import { buildConversationInterpreterInstructionsV1 } from '../../prompts/conversation-interpreter-v1'

export const DEFAULT_CONVERSATION_INTERPRETER_MODEL = 'openai/gpt-oss-20b'
export const CONVERSATION_INTERPRETER_TIMEOUT_MS = 1_800
const GROQ_CHAT_COMPLETIONS_URL = 'https://api.groq.com/openai/v1/chat/completions'

type PaymentPlan = 'monthly_12' | 'monthly_6' | 'one_time'
type AwaitingReply = 'none' | 'area_choice' | 'course_choice' | 'call_or_chat' | 'payment_plan' | 'payment_confirmation'
type CallPreference = 'unknown' | 'call' | 'chat' | 'declined'
type CallOfferStatus = 'not_offered' | 'offered' | 'accepted' | 'declined'

export interface ConversationInterpreterInputV1 {
  readonly batch_messages: ReadonlyArray<{ readonly id: string; readonly text: string }>
  readonly last_agent_question: string | null
  readonly sales_context: {
    readonly selected_offering_code: string | null
    readonly selected_payment_plan: PaymentPlan | null
    readonly stage: 'exploring' | 'qualified' | 'course_selected' | 'plan_selected' | 'payment_link_sent' | 'handoff' | 'closed'
    readonly call_preference: CallPreference
    readonly call_offer_status: CallOfferStatus
    readonly awaiting_reply: AwaitingReply
  }
  readonly catalog: {
    readonly areas: ReadonlyArray<{ readonly code: string; readonly display_name: string }>
    readonly offerings: ReadonlyArray<{
      readonly code: string
      readonly display_name: string
      readonly area_code: string | null
      readonly aliases: readonly string[]
    }>
    readonly payment_plans: ReadonlyArray<{ readonly code: PaymentPlan; readonly position: number }>
  }
}

export class ConversationInterpreterError extends Error {
  constructor(public readonly code: string) {
    super(code)
    this.name = 'ConversationInterpreterError'
  }
}

export interface GeneratedConversationMoveV1 {
  readonly move: ConversationMoveV1
  readonly provider: 'groq-direct'
  readonly model: string
  readonly latency_ms: number
}

const MOVE_KINDS = [
  'greeting', 'browse_catalog', 'select_area', 'select_course', 'ask_course_information',
  'continue_by_chat', 'request_call', 'decline_call', 'ask_payment_options',
  'select_payment_plan', 'defer_payment', 'request_payment_link', 'decline_purchase', 'unknown',
] as const

function closedObject(properties: Record<string, unknown>) {
  return { type: 'object', properties, required: Object.keys(properties), additionalProperties: false }
}

function moveJsonSchema(): unknown {
  const nullableString = { anyOf: [{ type: 'string' }, { type: 'null' }] }
  return closedObject({
    schema_version: { type: 'integer', enum: [1] },
    move: { type: 'string', enum: [...MOVE_KINDS] },
    secondary_moves: { type: 'array', items: { type: 'string', enum: [...MOVE_KINDS] } },
    vetoes: { type: 'array', items: { type: 'string', enum: ['call', 'payment_link', 'purchase'] } },
    course_reference: nullableString,
    area_reference: nullableString,
    payment_plan: { anyOf: [{ type: 'string', enum: ['monthly_12', 'monthly_6', 'one_time'] }, { type: 'null' }] },
    confidence: { type: 'number' },
  })
}

function extractContent(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const choices = (payload as { choices?: unknown }).choices
  if (!Array.isArray(choices) || choices.length === 0) return null
  const message = choices[0] && typeof choices[0] === 'object'
    ? (choices[0] as { message?: unknown }).message
    : null
  if (!message || typeof message !== 'object') return null
  const content = (message as { content?: unknown }).content
  return typeof content === 'string' ? content : null
}

function omitNullReferences(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const record = value as Record<string, unknown>
  const output = { ...record }
  for (const field of ['course_reference', 'area_reference', 'payment_plan'] as const) {
    if (output[field] === null || output[field] === '') delete output[field]
  }
  const moves = new Set([
    typeof output.move === 'string' ? output.move : '',
    ...(Array.isArray(output.secondary_moves)
      ? output.secondary_moves.filter((move): move is string => typeof move === 'string')
      : []),
  ])
  if (![...moves].some((move) => [
    'select_course', 'ask_course_information', 'request_call', 'ask_payment_options',
    'select_payment_plan', 'defer_payment', 'request_payment_link', 'decline_purchase',
  ].includes(move))) delete output.course_reference
  if (![...moves].some((move) => ['browse_catalog', 'select_area'].includes(move))) {
    delete output.area_reference
  }
  if (![...moves].some((move) => [
    'select_payment_plan', 'defer_payment', 'request_payment_link',
  ].includes(move))) delete output.payment_plan
  return output
}

export async function generateGroqConversationMoveV1(input: {
  readonly instructions: string
  readonly apiKey: string
  readonly signal: AbortSignal
  readonly model?: string
  readonly timeout_ms?: number
}): Promise<GeneratedConversationMoveV1> {
  const model = input.model ?? DEFAULT_CONVERSATION_INTERPRETER_MODEL
  const controller = new AbortController()
  let timedOut = false
  const parentAbort = () => controller.abort()
  input.signal.addEventListener('abort', parentAbort, { once: true })
  if (input.signal.aborted) controller.abort()
  const timeout = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, input.timeout_ms ?? CONVERSATION_INTERPRETER_TIMEOUT_MS)
  const startedAt = Date.now()
  try {
    let response: Response
    try {
      response = await fetch(GROQ_CHAT_COMPLETIONS_URL, {
        method: 'POST',
        headers: { authorization: `Bearer ${input.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: input.instructions },
            { role: 'user', content: 'Return the single structured conversation move.' },
          ],
          temperature: 0,
          stream: false,
          max_completion_tokens: 320,
          response_format: {
            type: 'json_schema',
            json_schema: { name: 'studyx_conversation_move_v1', strict: true, schema: moveJsonSchema() },
          },
        }),
        signal: controller.signal,
      })
    } catch (error) {
      if (controller.signal.aborted) {
        throw new ConversationInterpreterError(timedOut ? 'INTERPRETER_TIMEOUT' : 'INTERPRETER_ABORTED')
      }
      throw new ConversationInterpreterError('INTERPRETER_NETWORK_ERROR')
    }
    if (!response.ok) throw new ConversationInterpreterError(`INTERPRETER_HTTP_${response.status}`)
    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      throw new ConversationInterpreterError('INTERPRETER_INVALID_RESPONSE')
    }
    const content = extractContent(payload)
    if (content === null) throw new ConversationInterpreterError('INTERPRETER_EMPTY_RESPONSE')
    let decoded: unknown
    try {
      decoded = JSON.parse(content)
    } catch {
      throw new ConversationInterpreterError('INTERPRETER_INVALID_JSON')
    }
    const parsed = ConversationMoveV1Schema.safeParse(omitNullReferences(decoded))
    if (!parsed.success) {
      console.error('INTERPRETER_SCHEMA_INVALID', JSON.stringify({
        issues: parsed.error.issues.map((issue) => ({ code: issue.code, path: issue.path })),
      }))
      throw new ConversationInterpreterError('INTERPRETER_SCHEMA_INVALID')
    }
    return { move: parsed.data, provider: 'groq-direct', model, latency_ms: Date.now() - startedAt }
  } finally {
    clearTimeout(timeout)
    input.signal.removeEventListener('abort', parentAbort)
  }
}

export async function interpretConversationMoveV1(
  input: ConversationInterpreterInputV1,
  deps: {
    readonly generate: (request: {
      readonly instructions: string
      readonly signal: AbortSignal
    }) => Promise<unknown>
    readonly signal?: AbortSignal
  },
): Promise<ConversationMoveV1> {
  const generated = await deps.generate({
    instructions: buildConversationInterpreterInstructionsV1(input),
    signal: deps.signal ?? new AbortController().signal,
  })
  const wrappedMove = generated && typeof generated === 'object' && !Array.isArray(generated)
    ? (generated as { move?: unknown }).move
    : undefined
  const candidate = wrappedMove && typeof wrappedMove === 'object' ? wrappedMove : generated
  const parsed = ConversationMoveV1Schema.safeParse(candidate)
  if (!parsed.success) throw new ConversationInterpreterError('INTERPRETER_SCHEMA_INVALID')
  return parsed.data
}
