import { readFileSync } from 'node:fs'
import { generateGroqConversationMoveV1 } from '../src/lib/conversation/conversation-interpreter'
import { buildConversationInterpreterInstructionsV1 } from '../src/prompts/conversation-interpreter-v1'

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

async function main() {
  const apiKey = readKey()
  const cases = JSON.parse(readFileSync(
    new URL('../evals/conversation-pipeline-v1-heldout.json', import.meta.url), 'utf8',
  )) as Heldout[]
  const results: Array<Record<string, unknown>> = []
  for (const testCase of cases) {
    try {
      const generated = await generateGroqConversationMoveV1({
        apiKey,
        signal: new AbortController().signal,
        instructions: buildConversationInterpreterInstructionsV1({
        batch_messages: [{ id: testCase.id, text: testCase.message }],
        last_agent_question: lastQuestion(testCase.awaiting_reply),
        sales_context: {
          selected_offering_code: 'redes-informaticas',
          selected_payment_plan: 'monthly_6',
          stage: testCase.awaiting_reply.startsWith('payment_') ? 'plan_selected' : 'course_selected',
          call_preference: testCase.call_offer_status === 'declined' ? 'declined' : 'unknown',
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
            { code: 'monthly_12', position: 1 },
            { code: 'monthly_6', position: 2 },
            { code: 'one_time', position: 3 },
          ],
        },
        }),
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
      results.push({
        id: testCase.id,
        pass,
        expected_move: testCase.expected_move,
        actual_move: generated.move.move,
        latency_ms: generated.latency_ms,
      })
    } catch (error) {
      results.push({
        id: testCase.id,
        pass: false,
        expected_move: testCase.expected_move,
        actual_move: null,
        error_code: error instanceof Error ? error.message : 'UNKNOWN_ERROR',
        latency_ms: 0,
      })
    }
  }
  const latencies = results.map((entry) => Number(entry.latency_ms)).sort((a, b) => a - b)
  const p95 = latencies[Math.max(0, Math.ceil(latencies.length * 0.95) - 1)] ?? 0
  const passed = results.filter((entry) => entry.pass).length
  console.log(JSON.stringify({ passed, total: results.length, p95_ms: p95, results }, null, 2))
  if (passed !== results.length) process.exitCode = 1
}

main().catch((error) => {
  console.error(JSON.stringify({ error: error instanceof Error ? error.message : 'UNKNOWN_ERROR' }))
  process.exitCode = 1
})
