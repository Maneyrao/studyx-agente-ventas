import { readFileSync } from 'node:fs'
import {
  ConversationInterpreterError,
  DEFAULT_CONVERSATION_INTERPRETER_MODEL,
  generateGroqConversationMoveV1,
} from '../src/lib/conversation/conversation-interpreter'
import {
  CONVERSATION_INTERPRETER_PROMPT_VERSION,
  buildConversationInterpreterInstructionsV1,
} from '../src/prompts/conversation-interpreter-v1'
import { planConversationTurn } from '../../src/features/conversation/domain/conversation-planner'
import type { ConversationMoveV1 } from '../../src/features/conversation/domain/conversation-pipeline'

type PaymentPlan = 'monthly_12' | 'monthly_6' | 'one_time'
type Heldout = {
  id: string
  message: string
  awaiting_reply: 'none' | 'area_choice' | 'course_choice' | 'call_or_chat' | 'payment_plan' | 'payment_confirmation'
  call_offer_status: 'not_offered' | 'offered' | 'accepted' | 'declined'
  expected_move: string
  expected_secondary_moves?: string[]
  expected_vetoes?: string[]
  expected_payment_plan?: PaymentPlan
}

function readKey(): string {
  if (process.env.GROQ_API_KEY?.trim()) return process.env.GROQ_API_KEY.trim()
  const path = process.env.GROQ_ENV_FILE
  if (!path) throw new Error('GROQ_API_KEY_NOT_AVAILABLE')
  const line = readFileSync(path, 'utf8').split(/\r?\n/).find((entry) => entry.startsWith('GROQ_API_KEY='))
  const value = line?.slice('GROQ_API_KEY='.length).trim().replace(/^['"]|['"]$/g, '')
  if (!value) throw new Error('GROQ_API_KEY_NOT_AVAILABLE')
  return value
}

function lastQuestion(awaiting: Heldout['awaiting_reply']): string | null {
  const questions: Record<Heldout['awaiting_reply'], string | null> = {
    none: null,
    area_choice: '¿Qué área te interesa?',
    course_choice: '¿Cuál de las opciones querés elegir?',
    call_or_chat: '¿Preferís llamada o continuar por chat?',
    payment_plan: '¿Cuál de las tres opciones de pago elegís?',
    payment_confirmation: '¿Querés avanzar ahora con el enlace del plan elegido?',
  }
  return questions[awaiting]
}

function includesAll(actual: readonly string[], expected: readonly string[] | undefined): boolean {
  return (expected ?? []).every((entry) => actual.includes(entry))
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

const max429Attempts = positiveInteger(process.env.HELDOUT_MAX_429_ATTEMPTS, 10)
const maxJsonValidationAttempts = positiveInteger(process.env.HELDOUT_MAX_JSON_ATTEMPTS, 5)
const initialBackoffMs = positiveInteger(process.env.HELDOUT_429_BACKOFF_MS, 2_000)

async function generateWithTransportBackoff(input: Parameters<typeof generateGroqConversationMoveV1>[0]) {
  let transport429s = 0
  let jsonValidationFailures = 0
  for (let attempt = 1; ; attempt += 1) {
    try {
      const generated = await generateGroqConversationMoveV1(input)
      return { generated, transport429s, jsonValidationFailures, attempts: attempt }
    } catch (error) {
      const code = error instanceof Error ? error.message : 'UNKNOWN_ERROR'
      const providerCode = error instanceof ConversationInterpreterError
        ? error.provider_code
        : null
      const is429 = code === 'INTERPRETER_HTTP_429'
      const isJsonValidation = code === 'INTERPRETER_HTTP_400'
        && providerCode === 'json_validate_failed'
      if (is429) transport429s += 1
      if (isJsonValidation) jsonValidationFailures += 1
      const retry429 = is429 && transport429s < max429Attempts
      const retryJsonValidation = isJsonValidation
        && jsonValidationFailures < maxJsonValidationAttempts
      if (!retry429 && !retryJsonValidation) {
        return { generated: null, error, transport429s, jsonValidationFailures, attempts: attempt }
      }
      const retryOrdinal = retry429 ? transport429s : jsonValidationFailures
      const delayMs = retry429
        ? Math.min(30_000, initialBackoffMs * (2 ** Math.max(0, retryOrdinal - 1)))
        : Math.min(8_000, 1_000 * (2 ** Math.max(0, retryOrdinal - 1)))
      process.stderr.write(JSON.stringify({
        event: 'heldout.transport_backoff', attempt, delay_ms: delayMs,
        reason: retry429 ? 'http_429' : 'json_validate_failed',
      }) + '\n')
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }
}

function stateFor(testCase: Heldout) {
  return {
    workspace_id: '00000000-0000-4000-8000-000000000001',
    conversation_id: '00000000-0000-4000-8000-000000000002',
    contact_id: '00000000-0000-4000-8000-000000000003',
    selected_offering_code: 'redes-informaticas',
    selected_payment_plan: 'monthly_6' as const,
    stage: testCase.awaiting_reply.startsWith('payment_') ? 'plan_selected' as const : 'course_selected' as const,
    call_preference: testCase.call_offer_status === 'declined' ? 'declined' as const : 'unknown' as const,
    call_offer_status: testCase.call_offer_status,
    awaiting_reply: testCase.awaiting_reply,
    source_turn_id: null,
    version: 1,
    created_at: '2026-08-27T00:00:00.000Z',
    updated_at: '2026-08-27T00:00:00.000Z',
  }
}

function unsafeAction(
  expectedMove: string,
  move: ConversationMoveV1,
  action: ReturnType<typeof planConversationTurn>['allowed_business_action'],
) {
  if (action.type === 'request_call_now') {
    return expectedMove !== 'request_call' || move.vetoes.includes('call')
  }
  return action.type === 'send_payment_link'
    && (expectedMove !== 'request_payment_link'
      || move.vetoes.includes('payment_link')
      || move.vetoes.includes('purchase'))
}

async function main() {
  const runStartedAt = Date.now()
  const apiKey = readKey()
  const corpus = process.env.HELDOUT_FILE
    ?? new URL('../evals/conversation-pipeline-v1-heldout.json', import.meta.url)
  const allCases = JSON.parse(readFileSync(corpus, 'utf8')) as Heldout[]
  const selectedIds = new Set((process.env.HELDOUT_IDS ?? '')
    .split(',').map((value) => value.trim()).filter(Boolean))
  const cases = selectedIds.size > 0
    ? allCases.filter((testCase) => selectedIds.has(testCase.id))
    : allCases
  const results: Array<Record<string, unknown>> = []
  let transport429s = 0
  let transportJsonValidationFailures = 0
  for (const testCase of cases) {
    try {
      const interpreterContext = {
        batch_messages: [{ id: testCase.id, text: testCase.message }],
        last_agent_question: lastQuestion(testCase.awaiting_reply),
        sales_context: {
          selected_offering_code: 'redes-informaticas',
          selected_payment_plan: 'monthly_6' as const,
          stage: testCase.awaiting_reply.startsWith('payment_') ? 'plan_selected' as const : 'course_selected' as const,
          call_preference: testCase.call_offer_status === 'declined' ? 'declined' as const : 'unknown' as const,
          call_offer_status: testCase.call_offer_status,
          awaiting_reply: testCase.awaiting_reply,
        },
        catalog: {
          areas: [{ code: 'tecnologia', display_name: 'Tecnología' }],
          offerings: [{
            code: 'redes-informaticas', display_name: 'Redes Informáticas',
            area_code: 'tecnologia', aliases: ['Infraestructura de redes'],
          }],
          payment_plans: [
            { code: 'monthly_12' as const, position: 1 },
            { code: 'monthly_6' as const, position: 2 },
            { code: 'one_time' as const, position: 3 },
          ],
        },
      }
      const evaluated = await generateWithTransportBackoff({
        apiKey,
        signal: new AbortController().signal,
        context: interpreterContext,
        instructions: buildConversationInterpreterInstructionsV1(interpreterContext),
      })
      transport429s += evaluated.transport429s
      transportJsonValidationFailures += evaluated.jsonValidationFailures
      if (evaluated.generated === null) {
        results.push({
          id: testCase.id,
          pass: false,
          expected_move: testCase.expected_move,
          actual_move: null,
          error_code: evaluated.error instanceof Error ? evaluated.error.message : 'UNKNOWN_ERROR',
          provider_error_code: evaluated.error instanceof ConversationInterpreterError
            ? evaluated.error.provider_code
            : null,
          transport_attempts: evaluated.attempts,
          transport_429s: evaluated.transport429s,
          transport_json_validation_failures: evaluated.jsonValidationFailures,
          latency_ms: 0,
        })
        continue
      }
      const generated = evaluated.generated
      const plan = planConversationTurn({
        move: generated.move,
        sales_context: stateFor(testCase),
        business_context: {
          catalog_available: true,
          areas: [{ code: 'tecnologia', display_name: 'Tecnología' }],
          offerings: [{
            code: 'redes-informaticas', display_name: 'Redes Informáticas',
            area_code: 'tecnologia', aliases: ['Infraestructura de redes'],
          }],
          payment_plans: ['monthly_12', 'monthly_6', 'one_time'],
        },
        proactive_call_offer_allowed: true,
      })
      const referencePresent = testCase.expected_move === 'select_area'
        ? Boolean(generated.move.area_reference)
        : testCase.expected_move === 'select_course'
          ? Boolean(generated.move.course_reference)
          : true
      const pass = generated.move.move === testCase.expected_move
        && includesAll(generated.move.secondary_moves, testCase.expected_secondary_moves)
        && includesAll(generated.move.vetoes, testCase.expected_vetoes)
        && (!testCase.expected_payment_plan || generated.move.payment_plan === testCase.expected_payment_plan)
        && referencePresent
      const actionUnsafe = unsafeAction(testCase.expected_move, generated.move, plan.allowed_business_action)
      results.push({
        id: testCase.id,
        pass: pass && !actionUnsafe,
        expected_move: testCase.expected_move,
        actual_move: generated.move.move,
        expected_secondary_moves: testCase.expected_secondary_moves ?? [],
        actual_secondary_moves: generated.move.secondary_moves,
        expected_vetoes: testCase.expected_vetoes ?? [],
        actual_vetoes: generated.move.vetoes,
        expected_payment_plan: testCase.expected_payment_plan ?? null,
        actual_payment_plan: generated.move.payment_plan ?? null,
        allowed_business_action: plan.allowed_business_action,
        unsafe_action: actionUnsafe,
        transport_attempts: evaluated.attempts,
        transport_429s: evaluated.transport429s,
        transport_json_validation_failures: evaluated.jsonValidationFailures,
        latency_ms: generated.latency_ms,
      })
    } catch (error) {
      results.push({
        id: testCase.id,
        pass: false,
        expected_move: testCase.expected_move,
        actual_move: null,
        error_code: error instanceof Error ? error.message : 'UNKNOWN_ERROR',
        provider_error_code: error instanceof ConversationInterpreterError
          ? error.provider_code
          : null,
        latency_ms: 0,
      })
    }
  }
  const latencies = results.map((entry) => Number(entry.latency_ms)).filter((value) => value > 0).sort((a, b) => a - b)
  const p95 = latencies[Math.max(0, Math.ceil(latencies.length * 0.95) - 1)] ?? 0
  const passed = results.filter((entry) => entry.pass).length
  const unsafeActions = results.filter((entry) => entry.unsafe_action === true).length
  console.log(JSON.stringify({
    prompt_version: CONVERSATION_INTERPRETER_PROMPT_VERSION,
    provider: 'groq-direct',
    model: DEFAULT_CONVERSATION_INTERPRETER_MODEL,
    passed,
    total: results.length,
    evaluated: results.filter((entry) => entry.actual_move !== null).length,
    transport_429s: transport429s,
    transport_json_validation_failures: transportJsonValidationFailures,
    unsafe_actions: unsafeActions,
    p95_ms: p95,
    wall_ms: Date.now() - runStartedAt,
    results,
  }, null, 2))
  if (passed !== results.length) process.exitCode = 1
}

main().catch((error) => {
  console.error(JSON.stringify({ error: error instanceof Error ? error.message : 'UNKNOWN_ERROR' }))
  process.exitCode = 1
})
