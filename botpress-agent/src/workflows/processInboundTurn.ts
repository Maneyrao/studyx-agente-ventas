import { Autonomous, Workflow, configuration, context, secrets, z } from '@botpress/runtime'
import { claimBatch } from '../actions/claimBatch'
import { commitDecision } from '../actions/commitDecision'
import { dispatchCall } from '../actions/dispatchCall'
import { flushLeadProjection } from '../actions/flushLeadProjection'
import { ingestTurn } from '../actions/ingestTurn'
import { reportDelivery } from '../actions/reportDelivery'
import { transcribeAudio } from '../actions/transcribeAudio'
import {
  ClaimedTurnSchema,
  DecisionSchema,
  ProcessingStateSchema,
  WorkflowInputSchema,
  WorkflowResultSchema,
  type ClaimedTurn,
  type Decision,
  type IngestResponse,
  type WorkflowResult,
} from '../schemas/contracts'
import {
  AGENT_A_PROMPT_VERSION,
  buildAgentASalesBridgeCompactInstructions,
  buildAgentASalesBridgeInstructions,
} from '../prompts/agent-a-sales-bridge'
import { GREETING_FAST_PATH_MODEL, matchDeterministicGreeting } from '../utils/greeting'
import { CALL_HANDOFF_FAST_PATH_MODEL, matchCallHandoffFastPath } from '../utils/call-handoff-fast-path'
import {
  CONVERSATION_CLOSE_FAST_PATH_MODEL,
  CONTACT_CAPTURE_FAST_PATH_MODEL,
  COURSE_DISCOVERY_FAST_PATH_MODEL,
  COURSE_FACTS_FAST_PATH_MODEL,
  PAYMENT_SELECTION_FAST_PATH_MODEL,
  matchContactCaptureFastPath,
  matchConversationCloseFastPath,
  matchCourseDiscoveryFastPath,
  matchCourseFactsFastPath,
  matchPaymentSelectionFastPath,
} from '../utils/transaction-fast-path'
import { StudyxHttpError } from '../utils/http'
import { applyDecisionPolicy, suppress, technicalFallback } from '../utils/decision-policy'
import { generateGeminiDecision } from '../lib/decision/gemini-direct'
import { generateGroqDecision } from '../lib/decision/groq-direct'

/**
 * One inbound turn, end to end.
 *
 *   Telegram → normalize → /ingest → sleep until due_at → /claim
 *            → prompt from the claimed context only → Decision v3
 *            → /decision → at most one createMessage → /delivery
 *
 * Three properties this file is responsible for, and the reason each exists:
 *
 * 1. **Nothing happens before the claim.** A workflow that loses the claim
 *    stops right there: no model call, no send, no cost. Three fast messages
 *    open one window and produce one answer, because the window — not this
 *    workflow — decides when a turn is ready.
 *
 * 2. **The prompt is exactly the claimed context.** Not the raw event, not
 *    whatever the channel happened to carry. Everything the model sees is
 *    inside one untrusted fence, and no retrieved text is ever promoted to an
 *    instruction.
 *
 * 3. **At most one physical send.** Every ambiguous outcome pauses instead of
 *    retrying. A message with a confirmed Botpress ID is never created again.
 */

/**
 * Explicit, versioned model choice — the remote bot configuration has no say.
 * The array is a FAILOVER chain, not a balancer: Botpress only moves past the
 * first entry when it fails.
 *
 * gemini-3.6-flash is the newer latency-class model (`adk models` lists it as
 * recommended in the same family); measured baseline with 3.5-flash was
 * model_ms 5.9-7.3s on real production turns (traces edfaa3f4, a68019b8).
 * 3.5-flash stays as first failover with the proven claude-haiku-4-5 behind
 * it, and every output still passes DecisionSchema + Next.js validation with
 * the technical fallback as the last resort.
 */
const DECISION_MODELS = [
  'google-ai:gemini-3.6-flash',
  'google-ai:gemini-3.5-flash',
  'anthropic:claude-haiku-4-5-20251001',
] as const

/**
 * A second iteration is available only when the first generated value fails
 * the structured exit. Live eval evidence showed Gemini confusing the
 * `offer_call` permission token with the `call_offer` response type; the
 * correction iteration lets it repair that shape without exposing fallback.
 */
const DECISION_ITERATIONS = 2

/** Bounded: the window slides, but not forever. */
const MAX_CLAIM_ATTEMPTS = 6

const DecisionExit = new Autonomous.Exit({
  name: 'turn_decision',
  description: 'Return exactly one safe, structured decision for the current sales turn.',
  schema: DecisionSchema,
})

const workflowStateSchema = z.object({
  phase: ProcessingStateSchema.default('received'),
  turnId: z.string().uuid().nullable().default(null),
  batchId: z.string().uuid().nullable().default(null),
  decisionId: z.string().uuid().nullable().default(null),
  outboundId: z.string().uuid().nullable().default(null),
  deliveryStatus: z.enum(['submitted_to_botpress', 'failed']).nullable().default(null),
  errorCode: z.string().nullable().default(null),
})

function safeLog(event: string, fields: Record<string, unknown>): void {
  console.info(JSON.stringify({ event, ...fields }))
}

function errorCode(error: unknown): string {
  if (error instanceof StudyxHttpError) return error.code
  if (error instanceof Error && error.name) return error.name.slice(0, 128)
  return 'UNKNOWN_ERROR'
}

function resultFromState(state: z.infer<typeof workflowStateSchema>, traceId: string): WorkflowResult {
  return {
    status: state.phase,
    trace_id: traceId,
    turn_id: state.turnId,
    decision_id: state.decisionId,
    outbound_id: state.outboundId,
    delivery_status: state.deliveryStatus,
    error_code: state.errorCode,
  }
}

export const processInboundTurn = new Workflow({
  name: 'processInboundTurn',
  description: 'Idempotently coordinates one Botpress inbound turn through the canonical StudyX API.',
  input: WorkflowInputSchema as any,
  output: WorkflowResultSchema as any,
  state: workflowStateSchema as any,
  // La ventana de lote desliza hasta `hard_deadline_at` y después vienen claim,
  // modelo y entrega. 2 minutos dejaban el turno sin margen.
  timeout: '5m',

  async handler({ input, state, step, execute, client, signal, workflow }) {
    input = WorkflowInputSchema.parse(input)
    state.phase = 'processing'
    state.errorCode = null

    // Per-stage wall-clock in milliseconds, logged once at every terminal
    // return via `emitTimings`. Content-free: stage names and durations only.
    // Best-effort under durable replays — a resumed workflow re-times only the
    // stages that actually re-run.
    const workflowStartedAt = Date.now()
    const timings: Record<string, number> = {}
    const occurredAtMs = Date.parse(input.message.occurred_at ?? '')
    if (Number.isFinite(occurredAtMs)) {
      timings.telegram_to_router_ms = Math.max(0, workflowStartedAt - occurredAtMs)
    }
    const emitTimings = (extra: Record<string, unknown> = {}): void => {
      safeLog('studyx.turn.timings', {
        trace_id: input.trace_id,
        turn_id: state.turnId,
        phase: state.phase,
        ...timings,
        total_workflow_ms: Date.now() - workflowStartedAt,
        ...extra,
      })
    }

    // ---- Paso 1-2: normalizar audio pendiente ----------------------------
    // Si el adapter dejó la transcripción pendiente, se resuelve antes de
    // ingerir. Hasta 3 intentos; al fallar definitivamente el turno sigue con
    // un marcador, para no perder el mensaje en silencio.
    if (
      input.message.type === 'audio' &&
      input.message.audio_reference?.transcription_status === 'skipped' &&
      input.sandbox_provider === 'telegram_sandbox'
    ) {
      const audioRef = input.message.audio_reference
      try {
        const result = await step(
          'transcribe-audio',
          async () => {
            const r = await transcribeAudio.execute({
              input: { audio_reference: audioRef, provider_source: 'telegram_sandbox' },
              client,
            })
            if (r.status !== 'ok') throw new Error(`TRANSCRIPTION_${r.reason ?? 'FAILED'}`)
            return r
          },
          { maxAttempts: 3 }
        )
        input.message.text = result.text
        input.message.audio_reference = {
          ...audioRef,
          transcription_status: 'ok',
          transcription_provider: result.provider,
        }
        safeLog('studyx.turn.audio_transcribed', {
          trace_id: input.trace_id,
          provider: result.provider,
        })
      } catch (error) {
        input.message.text = '[audio_no_transcrito]'
        input.message.audio_reference = {
          ...audioRef,
          transcription_status: 'failed',
        }
        safeLog('studyx.turn.audio_transcription_failed', {
          trace_id: input.trace_id,
          error_code: errorCode(error),
        })
      }
    }

    // ---- Paso 3: persistir ------------------------------------------------
    let ingest: IngestResponse
    const ingestStartedAt = Date.now()
    try {
      ingest = await step(
        'ingest-canonical-turn',
        () => ingestTurn.execute({ input, client }),
        { maxAttempts: 1 }
      )
      timings.ingest_ms = Date.now() - ingestStartedAt
      state.turnId = ingest.turn_id
      state.batchId = ingest.batch.id
    } catch (error) {
      timings.ingest_ms = Date.now() - ingestStartedAt
      state.phase = 'paused_error'
      state.errorCode = errorCode(error)
      safeLog('studyx.turn.ingest_failed', { trace_id: input.trace_id, error_code: state.errorCode })
      emitTimings()
      return resultFromState(state, input.trace_id)
    }

    if (ingest.existing_result?.decision_id) {
      state.decisionId = ingest.existing_result.decision_id
      state.outboundId = ingest.existing_result.outbound_id
      if (!ingest.existing_result.outbound_id) {
        state.phase = ingest.existing_result.next_state
      } else if (ingest.existing_result.delivery_status === 'submitted_to_botpress') {
        state.deliveryStatus = 'submitted_to_botpress'
        state.phase = ingest.existing_result.next_state
      } else if (ingest.existing_result.delivery_status === 'failed') {
        state.deliveryStatus = 'failed'
        state.phase = 'paused_error'
        state.errorCode = 'EXISTING_DELIVERY_FAILED'
      } else {
        // Never make a second physical send while the backend cannot prove whether
        // the first submission happened. ADK 2.0.5 exposes no idempotent send here.
        state.phase = 'retry_pending'
        state.errorCode = 'OUTBOUND_DELIVERY_UNRESOLVED'
      }
      safeLog('studyx.turn.replayed', {
        trace_id: input.trace_id,
        turn_id: ingest.turn_id,
        processing_state: state.phase,
      })
      emitTimings()
      return resultFromState(state, input.trace_id)
    }

    // ---- Pasos 4-6: dormir hasta due_at y reclamar ------------------------
    //
    // El sueño es un step durable: si el runtime recicla el workflow, se
    // reanuda en el mismo punto en vez de reprocesar el turno. Un reclamante
    // perdedor sale acá y nunca llega al modelo.
    //
    // No usar `step.sleepUntil`: el runtime le resta MIN_STEP_REMAINING_TIME_MS
    // (10s) al objetivo, así que cualquier ventana menor a 10s se convierte en
    // una espera de 0ms y el loop quema todos los intentos antes de `due_at`
    // (observado en prod: claim_exhausted en <1s con debounce de 2s).
    // `step.sleep(ms)` sí espera los ms exactos cuando son cortos y escala a
    // reprogramación durable cuando son largos.
    let claimed: ClaimedTurn | null = null
    let dueAt = ingest.batch.due_at
    timings.batch_wait_ms = 0
    timings.batch_wait_actual_ms = 0
    timings.batch_wait_scheduled_ms = 0
    timings.claim_ms = 0

    for (let attempt = 0; attempt < MAX_CLAIM_ATTEMPTS; attempt += 1) {
      const waitMs = Math.max(0, new Date(dueAt).getTime() - Date.now())
      const waitStartedAt = Date.now()
      await step.sleep(`await-batch-window-${attempt}`, waitMs)
      const actualWaitMs = Math.max(0, Date.now() - waitStartedAt)
      timings.batch_wait_actual_ms += actualWaitMs
      // Keep the established aggregate name, but make it report observed wall
      // time rather than the requested delay. The requested delay is useful
      // separately when diagnosing durable scheduler overhead.
      timings.batch_wait_ms += actualWaitMs
      timings.batch_wait_scheduled_ms += waitMs

      let outcome
      const claimStartedAt = Date.now()
      try {
        outcome = await step(
          `claim-inbound-batch-${attempt}`,
          () =>
            claimBatch.execute({
              client,
              input: {
                batch_id: ingest.batch.id,
                trace_id: input.trace_id,
                claimed_by: `botpress:${workflow?.id ?? input.trace_id}`,
              },
            }),
          { maxAttempts: 1 }
        )
        timings.claim_ms += Date.now() - claimStartedAt
      } catch (error) {
        timings.claim_ms += Date.now() - claimStartedAt
        state.phase = 'paused_error'
        state.errorCode = errorCode(error)
        safeLog('studyx.turn.claim_failed', {
          trace_id: input.trace_id,
          batch_id: ingest.batch.id,
          error_code: state.errorCode,
        })
        emitTimings()
        return resultFromState(state, input.trace_id)
      }

      if (outcome.outcome === 'claimed') {
        claimed = ClaimedTurnSchema.parse(outcome)
        break
      }

      if (outcome.outcome === 'waiting') {
        // La ventana sigue abierta porque llegó otro mensaje: se corre el
        // despertador, no se fuerza la decisión.
        dueAt = new Date(Date.now() + Math.max(outcome.retry_after_ms, 250)).toISOString()
        continue
      }

      // absorbed / completed / abandoned / not_found: este workflow no es
      // dueño del turno. Se detiene sin llamar al modelo y sin enviar nada.
      state.phase = outcome.outcome === 'abandoned' || outcome.outcome === 'not_found'
        ? 'abandoned'
        : outcome.outcome === 'completed'
          ? 'completed'
          : 'absorbed'
      safeLog('studyx.turn.not_batch_owner', {
        trace_id: input.trace_id,
        batch_id: ingest.batch.id,
        outcome: outcome.outcome,
      })
      emitTimings()
      return resultFromState(state, input.trace_id)
    }

    if (!claimed) {
      state.phase = 'paused_error'
      state.errorCode = 'CLAIM_ATTEMPTS_EXHAUSTED'
      safeLog('studyx.turn.claim_exhausted', {
        trace_id: input.trace_id,
        batch_id: ingest.batch.id,
        attempts: MAX_CLAIM_ATTEMPTS,
      })
      emitTimings()
      return resultFromState(state, input.trace_id)
    }

    const owned = claimed
    state.turnId = owned.turn_id
    Object.assign(timings, owned.diagnostics.timings, owned.diagnostics.counters)
    safeLog('studyx.turn.claimed', {
      trace_id: input.trace_id,
      batch_id: owned.batch.id,
      turn_id: owned.turn_id,
      message_count: owned.batch.message_count,
      stolen: owned.batch.stolen,
      knowledge_base_available: owned.context.knowledge_base_available,
      long_term_memory_available: owned.context.long_term_memory_available,
      injection_suspected: owned.context.injection_suspected_count,
    })

    // ---- Fast path determinista: saludo inequívoco -----------------------
    // Un lote de UN mensaje que es exactamente un saludo no necesita modelo ni
    // catálogo. La decisión igual se commitea en Next.js como cualquier otra:
    // misma validación, mismo outbound, mismo envío único.
    const automatable =
      configuration.automationEnabled && owned.policy.may_respond && !owned.contact.blocked
    // El fast path de llamada corre primero: un pedido directo o una
    // aceptación inequívoca no necesitan catálogo ni modelo, y el backend
    // re-valida el consentimiento en el commit de todas formas.
    const callFastPath = automatable ? matchCallHandoffFastPath(owned) : null
    const paymentFastPath = !callFastPath && automatable ? matchPaymentSelectionFastPath(owned) : null
    const contactFastPath = !callFastPath && !paymentFastPath && automatable
      ? matchContactCaptureFastPath(owned)
      : null
    const courseFactsFastPath = !callFastPath && !paymentFastPath && !contactFastPath && automatable
      ? matchCourseFactsFastPath(owned)
      : null
    const conversationCloseFastPath = !callFastPath && !paymentFastPath && !contactFastPath
      && !courseFactsFastPath && automatable
      ? matchConversationCloseFastPath(owned)
      : null
    const courseDiscoveryFastPath = !callFastPath && !paymentFastPath && !contactFastPath
      && !courseFactsFastPath && !conversationCloseFastPath && automatable
      ? matchCourseDiscoveryFastPath(owned)
      : null
    const greetingFastPath = !callFastPath && !paymentFastPath && !contactFastPath
      && !courseFactsFastPath && !courseDiscoveryFastPath && automatable
      ? matchDeterministicGreeting(owned)
      : null
    const fastPathDecision = callFastPath ?? paymentFastPath ?? contactFastPath
      ?? courseFactsFastPath ?? conversationCloseFastPath ?? courseDiscoveryFastPath ?? greetingFastPath
    const fastPathModel = callFastPath
      ? CALL_HANDOFF_FAST_PATH_MODEL
      : paymentFastPath
        ? PAYMENT_SELECTION_FAST_PATH_MODEL
        : contactFastPath
          ? CONTACT_CAPTURE_FAST_PATH_MODEL
          : courseFactsFastPath
            ? COURSE_FACTS_FAST_PATH_MODEL
            : conversationCloseFastPath
              ? CONVERSATION_CLOSE_FAST_PATH_MODEL
              : courseDiscoveryFastPath
                ? COURSE_DISCOVERY_FAST_PATH_MODEL
                : GREETING_FAST_PATH_MODEL
    if (fastPathDecision) {
      const fastPathEvent = callFastPath
        ? 'studyx.turn.call_fast_path'
        : paymentFastPath
          ? 'studyx.turn.payment_fast_path'
          : contactFastPath
            ? 'studyx.turn.contact_fast_path'
            : courseFactsFastPath
              ? 'studyx.turn.course_facts_fast_path'
              : 'studyx.turn.greeting_fast_path'
      safeLog(fastPathEvent, {
        trace_id: input.trace_id,
        turn_id: owned.turn_id,
      })
    }

    // ---- Pasos 7-9: generar y validar localmente -------------------------
    // The claim already carries the one coherent business snapshot. The
    // standalone catalog action remains available to non-turn callers, but a
    // normal turn never performs a second commercial read.
    let decision: Decision
    let decisionModel: string = DECISION_MODELS[0]
    let decisionProvider: 'botpress' | 'google-ai-direct' | 'groq-direct' = 'botpress'
    timings.model_ms = 0
    if (!configuration.automationEnabled) {
      decision = suppress('AUTOMATION_DISABLED')
      decisionModel = 'policy:automation-disabled'
    } else if (!owned.policy.may_respond || owned.contact.blocked) {
      decision = suppress(owned.policy.reason ?? 'CONTACT_BLOCKED')
      decisionModel = 'policy:suppressed'
    } else if (fastPathDecision) {
      decision = fastPathDecision
      decisionModel = fastPathModel
      timings.model_ms = 0
    } else {
      const modelStartedAt = Date.now()
      try {
        const generatedTurn = await step(
          'generate-structured-decision',
          async () => {
            // The prompt is identical for both providers: only the executor
            // differs below. This is the ONE call site where a raw model
            // decision becomes a policy-checked `Decision` — every provider
            // routes through the same `applyDecisionPolicy` call at the end
            // of this callback, never a provider-specific gate.
            const instructions = configuration.decisionProvider === 'groq_direct'
              ? buildAgentASalesBridgeCompactInstructions(owned)
              : buildAgentASalesBridgeInstructions(owned)
            let rawDecision: Decision
            let provider: 'botpress' | 'google-ai-direct' | 'groq-direct' = 'botpress'
            let model: string = DECISION_MODELS[0]

            if (configuration.decisionProvider === 'gemini_direct') {
              const apiKey = secrets.GEMINI_API_KEY
              if (typeof apiKey !== 'string' || apiKey === '') {
                // No PII, no key: a fixed error code only. Caught below and
                // routed through the same existing technical-fallback path
                // as any other model failure.
                throw new StudyxHttpError('GEMINI_API_KEY_MISSING', false)
              }
              const generated = await generateGeminiDecision({
                instructions,
                apiKey,
                model: configuration.geminiDecisionModel ?? '',
                signal,
              })
              rawDecision = generated.decision
              provider = generated.provider
              model = generated.model
              safeLog('studyx.turn.model_generated', {
                trace_id: input.trace_id,
                turn_id: owned.turn_id,
                provider: generated.provider,
                model: generated.model,
                latency_ms: generated.latencyMs,
                schema_valid: true,
              })
            } else if (configuration.decisionProvider === 'groq_direct') {
              const apiKey = secrets.GROQ_API_KEY
              if (typeof apiKey !== 'string' || apiKey === '') {
                throw new StudyxHttpError('GROQ_API_KEY_MISSING', false)
              }
              const generated = await generateGroqDecision({
                instructions,
                apiKey,
                model: configuration.groqDecisionModel ?? '',
                signal,
                timeoutMs: configuration.requestTimeoutMs,
              })
              rawDecision = generated.decision
              provider = generated.provider
              model = generated.model
              safeLog('studyx.turn.model_generated', {
                trace_id: input.trace_id,
                turn_id: owned.turn_id,
                provider: generated.provider,
                model: generated.model,
                latency_ms: generated.latencyMs,
                schema_valid: true,
              })
            } else {
              const generated = await execute({
                instructions,
                exits: [DecisionExit],
                temperature: 0.1,
                // Sin herramientas, una iteración debe alcanzar el exit
                // estructurado. El array de modelos es failover, no balanceo.
                model: [...DECISION_MODELS],
                reasoningEffort: 'none',
                iterations: DECISION_ITERATIONS,
                signal,
              })
              if (!generated.is(DecisionExit)) throw new Error('DECISION_EXIT_NOT_REACHED')
              rawDecision = DecisionSchema.parse(generated.output)
              safeLog('studyx.turn.model_generated', {
                trace_id: input.trace_id,
                turn_id: owned.turn_id,
                model_chain: DECISION_MODELS.join('>'),
                iterations_used: generated.iterations?.length ?? null,
                instructions_chars: instructions.length,
              })
            }

            return {
              decision: applyDecisionPolicy(rawDecision, owned),
              provider,
              model,
            }
          },
          // One bounded retry prevents a transient model timeout from becoming
          // a customer-visible technical fallback. The step remains durable,
          // and no business side effect exists before the decision is committed.
          {
            maxAttempts:
              configuration.decisionProvider === 'gemini_direct'
              || configuration.decisionProvider === 'groq_direct'
                ? 1
                : 2,
          }
        )
        decision = generatedTurn.decision
        decisionProvider = generatedTurn.provider
        decisionModel = generatedTurn.model
        timings.model_ms = Date.now() - modelStartedAt
      } catch (error) {
        timings.model_ms = Date.now() - modelStartedAt
        safeLog('studyx.turn.model_failed', {
          trace_id: input.trace_id,
          turn_id: owned.turn_id,
          error_code: errorCode(error),
        })
        decision = owned.policy.allowed_response_types.includes('technical_fallback')
          ? technicalFallback()
          : suppress('MODEL_UNAVAILABLE')
        decisionModel = 'policy:model-unavailable'
      }
    }

    if (Number.isFinite(occurredAtMs)) {
      timings.event_to_decision_ms = Math.max(0, Date.now() - occurredAtMs)
    }

    // ---- Paso 10: commitear en Next.js -----------------------------------
    let committed
    const commitStartedAt = Date.now()
    try {
      committed = await step(
        'commit-canonical-decision',
        () =>
          commitDecision.execute({
            client,
            input: {
              turn_id: owned.turn_id,
              trace_id: input.trace_id,
              decision,
              model: {
                provider: decisionProvider,
                model: decisionModel,
                prompt_version: AGENT_A_PROMPT_VERSION,
              },
              // Batch fencing pair (spec §8): lets the backend try
              // `completeBatch` right after this commit or its replay,
              // never before and never on a rejected decision.
              batch_id: owned.batch.id,
              claim_token: owned.batch.claim_token,
            },
          }),
        { maxAttempts: 1 }
      )
      timings.commit_ms = Date.now() - commitStartedAt
      state.decisionId = committed.decision_id
      state.outboundId = committed.outbound?.id ?? null
      state.phase = 'decision_committed'
      // Passthrough-only field (spec §8): whether the claimed batch actually
      // reached `completed`. Never gates anything here — a non-`completed`/
      // `duplicate` value is the backend's reconciler's job, not this
      // workflow's; this is purely so it is visible in the trace.
      safeLog('studyx.turn.batch_completion', {
        trace_id: input.trace_id,
        turn_id: owned.turn_id,
        batch_id: owned.batch.id,
        batch_completion: committed.batch_completion ?? null,
      })
    } catch (error) {
      timings.commit_ms = Date.now() - commitStartedAt
      state.phase = 'paused_error'
      state.errorCode = errorCode(error)
      safeLog('studyx.turn.commit_failed', {
        trace_id: input.trace_id,
        turn_id: owned.turn_id,
        error_code: state.errorCode,
      })
      emitTimings()
      return resultFromState(state, input.trace_id)
    }

    // ---- Dispatch inmediato de la llamada reservada ----------------------
    // Corre DESPUÉS del commit canónico y es idempotente por call_id. Un
    // timeout o resultado ambiguo queda como dispatch_ambiguous del lado
    // backend y lo reconcilia otro proceso: acá jamás se rediscca ni se
    // reintenta, y el turno sigue su curso normal (el mensaje al cliente ya
    // dice "intenta comunicarse", nunca que la llamada está conectada).
    if (committed.call_request) {
      const dispatchStartedAt = Date.now()
      try {
        const dispatched = await step(
          'dispatch-voice-call',
          () =>
            dispatchCall.execute({
              client,
              input: {
                call_id: committed.call_request!.call_id,
                trace_id: input.trace_id,
              },
            }),
          { maxAttempts: 1 }
        )
        timings.call_dispatch_ms = Date.now() - dispatchStartedAt
        safeLog('studyx.turn.call_dispatch_result', {
          trace_id: input.trace_id,
          turn_id: owned.turn_id,
          call_id: committed.call_request.call_id,
          dispatch_status: dispatched.status,
        })
      } catch (error) {
        timings.call_dispatch_ms = Date.now() - dispatchStartedAt
        safeLog('studyx.turn.call_dispatch_unconfirmed', {
          trace_id: input.trace_id,
          turn_id: owned.turn_id,
          call_id: committed.call_request.call_id,
          error_code: errorCode(error),
        })
      }
    }

    if (committed.status === 'rejected' || !committed.outbound) {
      state.phase = committed.next_state
      emitTimings()
      return resultFromState(state, input.trace_id)
    }

    // ---- Paso 11: un único envío físico ----------------------------------
    let delivery: { message: { id: string } }
    const sendStartedAt = Date.now()
    try {
      delivery = await step(
        'submit-outbound-to-botpress',
        () =>
          client.createMessage({
            conversationId: input.botpress_conversation_id,
            // Un mensaje del bot se crea con el userId del BOT (así lo hace el
            // propio runtime en conversation.send). Con el userId del contacto
            // la API responde 403 "not authorized to create messages as an
            // integration" y la entrega falla (observado en prod).
            userId: context.get('botId'),
            type: 'text',
            payload: { text: committed.outbound!.content },
            tags: {
              studyxOutboundId: committed.outbound!.id,
              studyxTraceId: input.trace_id,
            },
          }) as Promise<{ message: { id: string } }>,
        { maxAttempts: 1 }
      )
      timings.send_ms = Date.now() - sendStartedAt
    } catch (error) {
      timings.send_ms = Date.now() - sendStartedAt
      state.deliveryStatus = 'failed'
      state.phase = 'paused_error'
      state.errorCode = errorCode(error)

      try {
        await step(
          'report-botpress-failure',
          () =>
            reportDelivery.execute({
              client,
              input: {
                outbound_id: committed.outbound!.id,
                trace_id: input.trace_id,
                status: 'failed',
                botpress_message_id: null,
                replayed: false,
                error_code: state.errorCode,
                delivery_attempt: committed.outbound!.delivery_attempt,
              },
            }),
          { maxAttempts: 1 }
        )
      } catch (reportError) {
        safeLog('studyx.turn.delivery_report_failed', {
          trace_id: input.trace_id,
          turn_id: owned.turn_id,
          error_code: errorCode(reportError),
        })
      }

      safeLog('studyx.turn.delivery_failed', {
        trace_id: input.trace_id,
        turn_id: owned.turn_id,
        outbound_id: committed.outbound.id,
        error_code: state.errorCode,
      })
      emitTimings()
      return resultFromState(state, input.trace_id)
    }

    // ---- Paso 12: reportar la entrega ------------------------------------
    state.deliveryStatus = 'submitted_to_botpress'
    const reportStartedAt = Date.now()
    try {
      await step(
        'report-botpress-submission',
        () =>
          reportDelivery.execute({
            client,
            input: {
              outbound_id: committed.outbound!.id,
              trace_id: input.trace_id,
              status: 'submitted_to_botpress',
              botpress_message_id: delivery.message.id,
              replayed: false,
              error_code: null,
              delivery_attempt: committed.outbound!.delivery_attempt,
            },
          }),
        { maxAttempts: 1 }
      )
      timings.delivery_report_ms = Date.now() - reportStartedAt
    } catch (error) {
      timings.delivery_report_ms = Date.now() - reportStartedAt
      // Botpress returned a message ID, so delivery must never be downgraded to
      // failed. Pause for reconciliation instead of risking a duplicate send.
      state.phase = 'paused_error'
      state.errorCode = errorCode(error)
      safeLog('studyx.turn.delivery_report_failed', {
        trace_id: input.trace_id,
        turn_id: owned.turn_id,
        outbound_id: committed.outbound.id,
        botpress_message_id: delivery.message.id,
        error_code: state.errorCode,
      })
      emitTimings()
      return resultFromState(state, input.trace_id)
    }

    // ---- Opcional: adelantar el flush de Sheets ---------------------------
    // El backend ya encoló la proyección `payment_link_sent` (si corresponde)
    // dentro de `report-botpress-submission`. Este paso es puramente una
    // optimización de latencia percibida por el operador: pide drenar el
    // outbox unos segundos antes del próximo tick del cron. Nunca bloquea ni
    // afecta el resultado del turno — un fallo queda para el cron/runner
    // (spec §5).
    try {
      await step(
        'flush-lead-projection',
        () => flushLeadProjection.execute({ client, input: { trace_id: input.trace_id } }),
        { maxAttempts: 1 }
      )
    } catch (error) {
      safeLog('studyx.turn.projection_flush_skipped', {
        trace_id: input.trace_id,
        turn_id: owned.turn_id,
        error_code: errorCode(error),
      })
    }

    state.phase = committed.next_state
    safeLog('studyx.turn.completed', {
      trace_id: input.trace_id,
      turn_id: owned.turn_id,
      batch_id: owned.batch.id,
      outbound_id: committed.outbound.id,
      botpress_message_id: delivery.message.id,
      botpress_message_replayed: false,
    })
    emitTimings({
      model: decisionModel,
      fast_path: fastPathDecision !== null,
    })
    return resultFromState(state, input.trace_id)
  },
})
