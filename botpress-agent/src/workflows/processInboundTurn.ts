import { randomUUID } from 'node:crypto'
import { Autonomous, Workflow, configuration, context, secrets, z } from '@botpress/runtime'
import { claimBatch } from '../actions/claimBatch'
import { commitDecision } from '../actions/commitDecision'
import { dispatchCall } from '../actions/dispatchCall'
import { flushLeadProjection } from '../actions/flushLeadProjection'
import { ingestTurn } from '../actions/ingestTurn'
import { planConversation } from '../actions/planConversation'
import { reportDelivery } from '../actions/reportDelivery'
import { transcribeAudio } from '../actions/transcribeAudio'
import {
  ClaimedTurnSchema,
  DecisionSchema,
  ProcessingStateSchema,
  WorkflowInputSchema,
  WorkflowResultSchema,
  type ClaimedTurn,
  type CommitDecisionResponse,
  type Decision,
  type IngestResponse,
  type WorkflowResult,
} from '../schemas/contracts'
import {
  AGENT_A_PROMPT_VERSION,
  buildAgentASalesBridgeCompactInstructions,
  buildAgentASalesBridgeInstructions,
} from '../prompts/agent-a-sales-bridge'
import { StudyxHttpError } from '../utils/http'
import {
  applyDecisionPolicy,
  classifyBrainFailureReason,
  callPhoneRequiredFallback,
  constrainModelToAdvisory,
  suppress,
  technicalFallback,
  modelUnavailableFallback,
  policyRejectedStateFallback,
} from '../utils/decision-policy'
import {
  routeCanonicalCatalogFailureFallback,
  routeCommercialTurn,
} from '../utils/commercial-router'
import { verifyAuthorizedEgressPortable } from '../utils/authorized-egress'
import { generateGeminiDecision, MAX_GEMINI_DECISION_TIMEOUT_MS } from '../lib/decision/gemini-direct'
import { generateGroqDecision } from '../lib/decision/groq-direct'
import {
  generateGroqConversationMoveV1,
  type ConversationInterpreterInputV1,
} from '../lib/conversation/conversation-interpreter'
import {
  composeConversationNarrativeWithFallbackV1,
  lastAgentReplyV1,
} from '../lib/conversation/conversation-composer'
import {
  bindCurrentCatalogResolutionToMoveV1,
  bindCurrentConversationalIntentToMoveV1,
  buildAgentAContextV1,
} from '../lib/conversation/agent-a-context'
import { isLegacyConversationPipelineEligibleV1 } from '../lib/conversation/agent-a-routing'
import {
  DEFAULT_AGENT_A_BRAIN_DEEPSEEK_MODEL,
  generateDeepSeekAgentATurnProposalV1,
} from '../lib/conversation/agent-a-brain'
import { resolveAgentAProposalV1 } from '../lib/conversation/resolve-agent-a-proposal'
import { resolveAgentAPlannerlessProposalV2 } from '../lib/conversation/resolve-agent-a-plannerless'
import { evaluateCallOfferTurnPolicyV1 } from '../lib/conversation/call-offer-turn-policy'
import type { AgentATurnProposalV1 } from '../schemas/agent-a-brain'
import type { AgentATurnCommitV2 } from '../schemas/agent-turn-v2'
import {
  ComposedNarrativeV1Schema,
  type ConversationPipelineCommitV1,
} from '../schemas/conversation-pipeline'
import {
  CONVERSATION_INTERPRETER_PROMPT_VERSION,
  buildConversationInterpreterInstructionsV1,
} from '../prompts/conversation-interpreter-v1'
import { CONVERSATION_COMPOSER_PROMPT_VERSION } from '../prompts/conversation-composer-v2'
import { STUDYX_SALES_BEHAVIOR_VERSION } from '../prompts/studyx-sales-behavior-v1'
import {
  AGENT_A_BRAIN_PROMPT_VERSION,
} from '../prompts/agent-a-brain-v1'
import { evaluateWhatsAppCanarySend } from '../channels/whatsapp.channel'

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

const ComposerExit = new Autonomous.Exit({
  name: 'conversation_narrative_v1',
  description: 'Return natural narrative and cite every canonical fact it uses.',
  schema: ComposedNarrativeV1Schema,
})

function areaCode(value: string | null): string | null {
  if (!value) return null
  let output = ''
  let pendingSeparator = false
  for (const character of value.trim().toLocaleLowerCase('es').normalize('NFD')) {
    const code = character.codePointAt(0) ?? 0
    if (code >= 0x0300 && code <= 0x036f) continue
    const separator = character === ' ' || character === '\t' || character === '\n' || character === '\r'
    if (separator) {
      pendingSeparator = output.length > 0
      continue
    }
    if (pendingSeparator) output += '-'
    output += character
    pendingSeparator = false
  }
  return output || null
}

function buildInterpreterInput(owned: ClaimedTurn): ConversationInterpreterInputV1 | null {
  const state = owned.conversation_state_v1
  if (!state) return null
  let lastAgentQuestion: string | null = null
  for (let index = owned.context.recent_turns.length - 1; index >= 0; index -= 1) {
    const turn = owned.context.recent_turns[index]
    if (turn.direction === 'outbound') {
      lastAgentQuestion = turn.content
      break
    }
  }
  const areas = new Map<string, string>()
  const offerings = (owned.catalog_index?.offerings ?? []).map((offering) => {
    const code = areaCode(offering.academy)
    if (code && offering.academy) areas.set(code, offering.academy)
    return {
      code: offering.code,
      display_name: offering.display_name,
      area_code: code,
      aliases: offering.aliases,
    }
  })
  return {
    batch_messages: owned.context.batch_messages.map((message) => ({
      id: message.id,
      text: message.content,
    })),
    last_agent_question: lastAgentQuestion,
    sales_context: state,
    catalog: {
      areas: [...areas].map(([code, display_name]) => ({ code, display_name })),
      offerings,
      payment_plans: (owned.business_context?.workspace.payment_options ?? []).map((option, index) => ({
        code: option.code,
        position: index + 1,
      })),
    },
  }
}

function pipelinePlaceholder(memoryCandidates: Decision['memory_candidates'] = []): Decision {
  return {
    schema_version: 4,
    intent: 'commercial',
    kind: 'reply',
    response: 'El backend preparará la respuesta autorizada.',
    response_type: 'commercial_reply',
    confidence: 1,
    reason_code: 'CONVERSATION_PIPELINE_V1_PENDING_BACKEND',
    business_action: null,
    memory_candidates: memoryCandidates,
    missing_information: [],
    next_state: 'waiting_user',
    retrieval_used: null,
  }
}

function callPhoneRequiredAgentTurn(): AgentATurnCommitV2 {
  return {
    schema_version: 2,
    proposal: {
      schema_version: 1,
      move: {
        schema_version: 1,
        move: 'request_call',
        secondary_moves: [],
        vetoes: [],
        confidence: 1,
      },
      response: {
        messages: ['De acuerdo. Pásame el número completo con código de país y área, por ejemplo +54 9 11…, para poder llamarte 🙂'],
        call_offer: null,
      },
      proposed_action: { type: 'none' },
      used_fact_ids: [],
      used_memory_ids: [],
      memory_candidates: [],
      repair_of: null,
    },
  }
}

function needsCallPhoneRecovery(claimed: ClaimedTurn, failureCode: string): boolean {
  return claimed.deterministic_route === 'call_phone_required'
    || (
      claimed.contact_intake_missing.includes('telefono')
      && failureCode.includes('ACTION_NOT_AUTHORIZED:request_call_now')
    )
}

/**
 * Preserve the model-owned conversation when the authoritative planner cannot
 * authorize its move. This is deliberately a presentation-only decision:
 * proposed actions, call offers and model-authored memories never cross the
 * boundary. The backend still validates the exact text and canonical facts
 * before it can become an outbound message.
 */
function brainAdvisoryOnlyDecision(
  proposal: AgentATurnProposalV1,
  claimed: ClaimedTurn,
): Decision {
  const allowed = claimed.policy.allowed_response_types as readonly string[]
  const responseType = proposal.move.move === 'greeting' && allowed.includes('social_reply')
    ? 'social_reply' as const
    : allowed.includes('commercial_reply')
      ? 'commercial_reply' as const
      : allowed.includes('social_reply')
        ? 'social_reply' as const
        : null
  if (responseType === null) return suppress('BRAIN_ADVISORY_RESPONSE_NOT_ALLOWED')

  return DecisionSchema.parse({
    schema_version: 4,
    intent: responseType === 'social_reply' ? 'social' : 'commercial',
    kind: 'reply',
    response: proposal.response.messages.join('\n\n'),
    response_type: responseType,
    confidence: proposal.move.confidence,
    reason_code: 'BRAIN_ADVISORY_ONLY_PLANNER_REJECTED',
    business_action: null,
    memory_candidates: [],
    missing_information: [],
    next_state: 'waiting_user',
    retrieval_used: null,
  })
}

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
  if (
    error !== null
    && typeof error === 'object'
    && 'code' in error
    && typeof error.code === 'string'
    && error.code.startsWith('BRAIN_')
  ) return error.code.slice(0, 128)
  if (
    error instanceof Error
    && error.message.startsWith('PLANNERLESS_PROPOSAL_REJECTED:')
  ) return error.message.slice(0, 256)
  if (error instanceof Error && error.name) return error.name.slice(0, 128)
  return 'UNKNOWN_ERROR'
}

function isTransientDeepSeekFailure(code: string): boolean {
  return code === 'BRAIN_DEEPSEEK_TIMEOUT'
    || code === 'BRAIN_DEEPSEEK_NETWORK_ERROR'
    || /^BRAIN_DEEPSEEK_HTTP_5\d\d$/u.test(code)
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
    let occurredAtMs = Date.parse(input.message.occurred_at ?? '')
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

    const claimedAgentLoopV3Mode = claimed.features?.agent_loop_v3_mode ?? 'off'
    const agentLoopV3KillSwitch = configuration.agentAAgentLoopV3KillSwitch === true
    // Normalize the claimed context once, before any current or future loop
    // branch can observe it. The bundle brake dominates every DB rollout mode.
    const owned: ClaimedTurn = agentLoopV3KillSwitch
      ? {
          ...claimed,
          features: {
            conversation_pipeline_v1_enabled:
              claimed.features?.conversation_pipeline_v1_enabled ?? false,
            ...claimed.features,
            agent_loop_v3_mode: 'off',
          },
        }
      : claimed
    state.turnId = owned.turn_id
    const batchEventTimes = owned.context.batch_messages
      .map((message) => Date.parse(message.occurred_at ?? message.created_at))
      .filter((value) => Number.isFinite(value))
    if (batchEventTimes.length > 0) {
      const firstBatchEventAtMs = Math.min(...batchEventTimes)
      occurredAtMs = Number.isFinite(occurredAtMs)
        ? Math.min(occurredAtMs, firstBatchEventAtMs)
        : firstBatchEventAtMs
    }
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
    safeLog('studyx.turn.agent_loop_v3_rollout', {
      trace_id: input.trace_id,
      turn_id: owned.turn_id,
      claimed_mode: claimedAgentLoopV3Mode,
      effective_mode: owned.features?.agent_loop_v3_mode ?? 'off',
      kill_switch: agentLoopV3KillSwitch,
    })
    const agentABrainContext = buildAgentAContextV1(
      owned,
      typeof configuration.agentAAdvisorName === 'string' ? configuration.agentAAdvisorName : null,
    )
    if (agentABrainContext) {
      safeLog('studyx.turn.agent_a_context_built', {
        trace_id: input.trace_id,
        turn_id: owned.turn_id,
        context_recent_turn_count: agentABrainContext.turn.recent_turns.length,
        context_memory_count: agentABrainContext.customer.memories.length,
        // Sin identidad resuelta el prompt canónico viaja con
        // `{{NOMBRE_ASESOR}}` sin sustituir, y la regla de no imprimir un
        // placeholder hace que el modelo se saltee la apertura entera. El
        // agujero es de configuración (`agentAAdvisorName`), así que tiene que
        // verse en el log en vez de manifestarse como un saludo ausente.
        identity_resolved: agentABrainContext.identity !== null,
        obligations_owed: agentABrainContext.obligations?.owes ?? [],
      })
    }

    // One pure router owns capability precedence for both this workflow and
    // the local evaluator. It chooses a deterministic decision, suppression,
    // or one model request; it never applies the final policy itself.
    const commercialRoute = routeCommercialTurn({
      automationEnabled: configuration.automationEnabled,
      claimed: owned,
    })
    let authorizedOfferingCode = commercialRoute.kind === 'deterministic'
      ? commercialRoute.authorizedOfferingCode ?? owned.sales_context.offering_code
      : owned.sales_context.offering_code
    const authorizedPaymentPlan = commercialRoute.kind === 'deterministic'
      ? commercialRoute.authorizedPaymentPlan ?? null
      : null
    safeLog('studyx.turn.commercial_route', {
      trace_id: input.trace_id,
      turn_id: owned.turn_id,
      route_kind: commercialRoute.kind,
      route_origin: commercialRoute.origin,
      route_reason: commercialRoute.reason,
    })

    let pipelineCommit: ConversationPipelineCommitV1 | null = null
    let agentTurnV2Commit: AgentATurnCommitV2 | null = null
    let pipelineFailureDecision: Decision | null = null
    let pipelineDecisionProvider: 'botpress' | 'google-ai-direct' | 'groq-direct' | 'openai-direct' | 'deepseek-direct' = 'botpress'
    let pipelineDecisionModel = 'conversation-pipeline-v1'
    let pipelinePromptVersion = `${CONVERSATION_INTERPRETER_PROMPT_VERSION}+${CONVERSATION_COMPOSER_PROMPT_VERSION}+${STUDYX_SALES_BEHAVIOR_VERSION}`
    let pipelineMemoryCandidates: Decision['memory_candidates'] = []
    let callOfferAudit: {
      readonly call_offer_count_before: 0 | 1 | 2
      readonly call_offer_count_after: 0 | 1 | 2
      readonly offered_call: boolean
      readonly reason: string
      readonly call_accepted: boolean
      readonly call_rejected: boolean
      readonly chat_preference: boolean
    } | null = null
    // R1: conducta nueva, apagada por defecto. Apagada, un rechazo no podable
    // cae a N3 y nunca a silencio (R2).
    const repairEnabled = owned.features?.agent_a_repair_enabled === true
    const brainAuthoritative = owned.features?.agent_a_brain_v1_enabled === true
    const brainShadow = owned.features?.agent_a_brain_v1_shadow === true
    const plannerlessV2Enabled = configuration.agentAPlannerlessV2Enabled === true
    const conversationalBaseEligible = configuration.automationEnabled
      && owned.policy.may_respond
      && (owned.policy.allowed_response_types.includes('commercial_reply')
        || (brainAuthoritative && owned.policy.allowed_response_types.includes('social_reply')))
    const legacyPipelineEligible = isLegacyConversationPipelineEligibleV1({
      conversationalBaseEligible,
      conversationPipelineEnabled: owned.features?.conversation_pipeline_v1_enabled === true,
      singleRoute: owned.features?.agent_a_single_route === true,
    })
    const deterministicCallHandoff = commercialRoute.kind === 'deterministic'
      && commercialRoute.origin === 'call_handoff'
    const brainEligible = conversationalBaseEligible
      && (brainAuthoritative || brainShadow)
      && (owned.deterministic_route === null || brainAuthoritative)
      // An explicit, already-authorized call request is an action boundary,
      // not a second conversational interpretation. Waiting for DeepSeek here
      // can strand the claimed batch before commit and leave the customer in
      // silence even though the requested action is unambiguous.
      && !deterministicCallHandoff
      && agentABrainContext !== null

    if (agentABrainContext !== null) {
      const policy = evaluateCallOfferTurnPolicyV1({ context: agentABrainContext })
      const count = agentABrainContext.commercial_state.call_offer_count
      callOfferAudit = {
        call_offer_count_before: count,
        call_offer_count_after: count,
        offered_call: false,
        reason: policy.reason,
        call_accepted: policy.customer_signal === 'acceptance',
        call_rejected: policy.customer_signal === 'rejection',
        chat_preference: policy.customer_signal === 'chat_preference',
      }
    }

    if (brainEligible) {
      try {
        const deepSeekApiKey = secrets.DEEPSEEK_API_KEY
        if (typeof deepSeekApiKey !== 'string' || deepSeekApiKey.length === 0) {
          throw new StudyxHttpError('DEEPSEEK_API_KEY_MISSING', false)
        }
        const generateDeepSeekProposal = () => generateDeepSeekAgentATurnProposalV1({
            context: agentABrainContext,
            apiKey: deepSeekApiKey,
            signal,
            model: typeof configuration.agentABrainDeepSeekModel === 'string'
              ? configuration.agentABrainDeepSeekModel
              : DEFAULT_AGENT_A_BRAIN_DEEPSEEK_MODEL,
            timeout_ms: 8_000,
          })
        const brainStartedAt = Date.now()
        let generated
        try {
          generated = await step(
            'generate-agent-a-turn-proposal-v1-deepseek',
            generateDeepSeekProposal,
            { maxAttempts: 1 },
          )
        } catch (firstError) {
          const firstFailureCode = errorCode(firstError)
          if (!isTransientDeepSeekFailure(firstFailureCode)) throw firstError
          safeLog('studyx.turn.agent_a_brain_retry', {
            trace_id: input.trace_id,
            turn_id: owned.turn_id,
            reason: firstFailureCode,
            attempt: 2,
          })
          generated = await step(
            'retry-agent-a-turn-proposal-v1-deepseek',
            generateDeepSeekProposal,
            { maxAttempts: 1 },
          )
        }
        timings.agent_a_brain_ms = Date.now() - brainStartedAt

        if (brainShadow) {
          const currentCount = agentABrainContext.commercial_state.call_offer_count
          safeLog('studyx.turn.agent_a_brain_v1', {
            trace_id: input.trace_id,
            turn_id: owned.turn_id,
            rollout_mode: 'shadow',
            brain_prompt_version: AGENT_A_BRAIN_PROMPT_VERSION,
            brain_model: generated.model,
            brain_source: 'model',
            brain_failure_reason: null,
            context_recent_turn_count: agentABrainContext.turn.recent_turns.length,
            context_memory_count: agentABrainContext.customer.memories.length,
            used_memory_count: generated.proposal.used_memory_ids.length,
            call_offer_transition: `${currentCount}->${currentCount}`,
            proposed_action_type: generated.proposal.proposed_action.type,
            authorized_action_type: 'none',
          })
        } else {
          pipelineDecisionProvider = generated.provider
          pipelineDecisionModel = generated.model
          pipelinePromptVersion = AGENT_A_BRAIN_PROMPT_VERSION
          const authoritativeMove = bindCurrentConversationalIntentToMoveV1(
            plannerlessV2Enabled
              ? generated.proposal.move
              : bindCurrentCatalogResolutionToMoveV1(generated.proposal.move, owned),
            owned,
          )
          if (plannerlessV2Enabled) {
            timings.planner_ms = 0
            const authoritativeGenerated = {
              ...generated,
              proposal: { ...generated.proposal, move: authoritativeMove },
            }
            const resolved = await resolveAgentAPlannerlessProposalV2({
              initial: authoritativeGenerated,
              context: agentABrainContext,
              repair_enabled: repairEnabled,
              rejection_id: randomUUID(),
              repair: async (rejection) => {
                if (typeof secrets.DEEPSEEK_API_KEY !== 'string'
                  || secrets.DEEPSEEK_API_KEY.length === 0) {
                  throw new Error('DEEPSEEK_API_KEY_MISSING')
                }
                const repaired = await step(
                  'repair-agent-a-turn-proposal-v2',
                  () => generateDeepSeekAgentATurnProposalV1({
                    context: { ...agentABrainContext, turn_rejection: rejection },
                    apiKey: secrets.DEEPSEEK_API_KEY as string,
                    signal,
                    model: typeof configuration.agentABrainDeepSeekModel === 'string'
                      ? configuration.agentABrainDeepSeekModel
                      : DEFAULT_AGENT_A_BRAIN_DEEPSEEK_MODEL,
                  }),
                  { maxAttempts: 1 },
                )
                const repairedMove = bindCurrentConversationalIntentToMoveV1(
                  repaired.proposal.move,
                  owned,
                )
                return { ...repaired, proposal: { ...repaired.proposal, move: repairedMove } }
              },
            })
            const effectiveGenerated = resolved.effective
            generated = effectiveGenerated
            const policy = evaluateCallOfferTurnPolicyV1({
              context: agentABrainContext,
              response_messages: effectiveGenerated.proposal.response.messages,
              proposed_course_reference: effectiveGenerated.proposal.move.course_reference,
            })
            const offeredCall = typeof effectiveGenerated.proposal.response.call_offer === 'string'
              && effectiveGenerated.proposal.response.call_offer.trim().length > 0
            const beforeCount = agentABrainContext.commercial_state.call_offer_count
            callOfferAudit = {
              call_offer_count_before: beforeCount,
              call_offer_count_after: offeredCall
                ? Math.min(2, beforeCount + 1) as 1 | 2
                : beforeCount,
              offered_call: offeredCall,
              reason: policy.reason,
              call_accepted: policy.customer_signal === 'acceptance'
                || effectiveGenerated.proposal.proposed_action.type === 'request_call_now',
              call_rejected: policy.customer_signal === 'rejection',
              chat_preference: policy.customer_signal === 'chat_preference',
            }
            agentTurnV2Commit = {
              schema_version: 2,
              proposal: effectiveGenerated.proposal,
            }
            pipelineMemoryCandidates = effectiveGenerated.proposal.memory_candidates
            safeLog('studyx.turn.agent_a_plannerless_v2', {
              trace_id: input.trace_id,
              turn_id: owned.turn_id,
              rollout_mode: 'authoritative',
              brain_prompt_version: AGENT_A_BRAIN_PROMPT_VERSION,
              brain_model: effectiveGenerated.model,
              used_memory_count: effectiveGenerated.proposal.used_memory_ids.length,
              proposed_action_type: effectiveGenerated.proposal.proposed_action.type,
              repair_attempted: resolved.evidence.repair_attempted,
              repaired: resolved.evidence.repaired,
              rejection_codes: resolved.evidence.rejection_codes,
            })
          } else {
            const plannerStartedAt = Date.now()
            let planned: Awaited<ReturnType<typeof planConversation.execute>> | null = null
            try {
              planned = await step(
                'plan-agent-a-turn-v1',
                () => planConversation.execute({
                  client,
                  input: {
                    turn_id: owned.turn_id,
                    trace_id: input.trace_id,
                    move: authoritativeMove,
                  },
                }),
                { maxAttempts: 1 },
              )
            } catch (plannerError) {
              timings.planner_ms = Date.now() - plannerStartedAt
              pipelineFailureDecision = brainAdvisoryOnlyDecision(generated.proposal, owned)
              safeLog('studyx.turn.agent_a_brain_v1', {
                trace_id: input.trace_id,
                turn_id: owned.turn_id,
                rollout_mode: 'authoritative',
                brain_prompt_version: AGENT_A_BRAIN_PROMPT_VERSION,
                brain_model: generated.model,
                brain_source: 'model',
                brain_failure_reason: classifyBrainFailureReason(
                  errorCode(plannerError),
                  owned.business_context_available && owned.catalog_index !== null,
                ),
                context_recent_turn_count: agentABrainContext.turn.recent_turns.length,
                context_memory_count: agentABrainContext.customer.memories.length,
                used_memory_count: 0,
                call_offer_transition: `${agentABrainContext.commercial_state.call_offer_count}->${agentABrainContext.commercial_state.call_offer_count}`,
                proposed_action_type: generated.proposal.proposed_action.type,
                authorized_action_type: 'none',
              })
            }
            if (planned !== null) {
            timings.planner_ms = Date.now() - plannerStartedAt
            const plannedFactIds = planned.fact_refs.map((fact: { id: string }) => fact.id)
            const resolved = await resolveAgentAProposalV1({
              initial: generated,
              context: agentABrainContext,
              response_goal: planned.plan.response_goal,
              planned_fact_ids: plannedFactIds,
              repair_enabled: repairEnabled,
              rejection_id: randomUUID(),
              repair: async (rejection) => {
                try {
                  return await step(
                    'repair-agent-a-turn-proposal-v1',
                    () => generateDeepSeekAgentATurnProposalV1({
                      context: { ...agentABrainContext, turn_rejection: rejection },
                      apiKey: secrets.DEEPSEEK_API_KEY as string,
                      signal,
                      model: typeof configuration.agentABrainDeepSeekModel === 'string'
                        ? configuration.agentABrainDeepSeekModel
                        : DEFAULT_AGENT_A_BRAIN_DEEPSEEK_MODEL,
                    }),
                    { maxAttempts: 1 },
                  )
                } catch (repairError) {
                  safeLog('studyx.turn.agent_a_repair_failed', {
                    trace_id: input.trace_id,
                    turn_id: owned.turn_id,
                    rejection_id: rejection.rejection_id,
                    error_code: errorCode(repairError),
                  })
                  throw repairError
                }
              },
            })
            if (resolved.rejection !== null) {
              safeLog('studyx.turn.agent_a_repair', {
                trace_id: input.trace_id,
                turn_id: owned.turn_id,
                rejection_id: resolved.rejection.rejection_id,
                level: resolved.resolution_level,
                codes: resolved.rejection.rejections.map((reason) => reason.code),
                subjects: resolved.rejection.rejections.map((reason) => reason.subject),
              })
            }
            const effective = resolved.effective
            pipelineCommit = {
              move: authoritativeMove,
              plan_hash: planned.plan_hash,
              composition: resolved.composition,
            }
            pipelineMemoryCandidates = effective.proposal.memory_candidates
            safeLog('studyx.turn.agent_a_brain_v1', {
              trace_id: input.trace_id,
              turn_id: owned.turn_id,
              rollout_mode: 'authoritative',
              brain_prompt_version: AGENT_A_BRAIN_PROMPT_VERSION,
              brain_model: effective.model,
              brain_source: 'model',
              brain_failure_reason: null,
              context_recent_turn_count: agentABrainContext.turn.recent_turns.length,
              context_memory_count: agentABrainContext.customer.memories.length,
              used_memory_count: effective.proposal.used_memory_ids.length,
              call_offer_transition: `${agentABrainContext.commercial_state.call_offer_count}->${planned.plan.next_call_offer_count}`,
              proposed_action_type: effective.proposal.proposed_action.type,
              authorized_action_type: planned.plan.allowed_business_action.type,
            })
            }
          }
        }
      } catch (error) {
        const failureCode = errorCode(error)
        const brainFailureReason = classifyBrainFailureReason(
          failureCode,
          owned.business_context_available && owned.catalog_index !== null,
        )
        safeLog('studyx.turn.agent_a_brain_v1', {
          trace_id: input.trace_id,
          turn_id: owned.turn_id,
          rollout_mode: brainShadow ? 'shadow' : 'authoritative',
          brain_prompt_version: AGENT_A_BRAIN_PROMPT_VERSION,
          brain_model: typeof configuration.agentABrainDeepSeekModel === 'string'
            ? configuration.agentABrainDeepSeekModel
            : DEFAULT_AGENT_A_BRAIN_DEEPSEEK_MODEL,
          brain_source: 'fallback',
          brain_failure_reason: brainFailureReason,
          failure_code: failureCode,
          context_recent_turn_count: agentABrainContext.turn.recent_turns.length,
          context_memory_count: agentABrainContext.customer.memories.length,
          used_memory_count: 0,
          call_offer_transition: `${agentABrainContext.commercial_state.call_offer_count}->${agentABrainContext.commercial_state.call_offer_count}`,
          proposed_action_type: 'none',
          authorized_action_type: 'none',
        })
        // Keep the brain as the normal commercial author. On failure, reuse
        // only a canonical deterministic route already proven by the claim;
        // otherwise return the narrow state/technical recovery below.
        if (brainAuthoritative) {
          const callPhoneFallback = needsCallPhoneRecovery(owned, failureCode)
          const deterministicCommercialFallback = commercialRoute.kind === 'deterministic'
            && commercialRoute.decision.business_action === null
            ? commercialRoute
            : routeCanonicalCatalogFailureFallback(owned)
          if (callPhoneFallback) {
            agentTurnV2Commit = callPhoneRequiredAgentTurn()
            pipelineDecisionProvider = 'botpress'
            pipelineDecisionModel = 'policy:call-phone-required'
            pipelinePromptVersion = AGENT_A_BRAIN_PROMPT_VERSION
          }
          const stateFallback = brainFailureReason === 'policy_rejected'
            ? policyRejectedStateFallback(owned)
            : null
          if (!callPhoneFallback) {
            pipelineFailureDecision = deterministicCommercialFallback?.decision
              ?? stateFallback
              ?? technicalFallback(
                  owned.policy.allowed_response_types.includes('technical_fallback')
                    ? 'technical_fallback'
                    : 'commercial_reply',
                )
            if (deterministicCommercialFallback) {
              pipelineDecisionProvider = 'botpress'
              pipelineDecisionModel = `fallback:${deterministicCommercialFallback.model}`
              authorizedOfferingCode = deterministicCommercialFallback.authorizedOfferingCode
                ?? authorizedOfferingCode
            }
          }
        }
      }
    }

    const deterministicPipelineMove = conversationalBaseEligible
      && (legacyPipelineEligible || brainAuthoritative)
      && !deterministicCallHandoff
      && (owned.deterministic_route === 'call_direct_request'
        || owned.deterministic_route === 'call_accepted_offer')
      ? {
          schema_version: 1 as const,
          move: 'request_call' as const,
          secondary_moves: [],
          vetoes: [],
          confidence: 1,
        }
      : null
    const interpreterInput = legacyPipelineEligible
      && !brainAuthoritative
      && owned.deterministic_route === null
      ? buildInterpreterInput(owned)
      : null
    if (!pipelineCommit && !pipelineFailureDecision && (deterministicPipelineMove || interpreterInput)) {
      try {
        const interpreted = deterministicPipelineMove
          ? {
              move: deterministicPipelineMove,
              model: `backend:${owned.deterministic_route}`,
              latency_ms: 0,
            }
          : await (async () => {
              const apiKey = secrets.GROQ_API_KEY
              if (typeof apiKey !== 'string' || apiKey === '') {
                throw new StudyxHttpError('GROQ_API_KEY_MISSING', false)
              }
              const interpreterStartedAt = Date.now()
              const generated = await step(
                'interpret-conversation-move-v1',
                () => generateGroqConversationMoveV1({
                  instructions: buildConversationInterpreterInstructionsV1(interpreterInput!),
                  context: interpreterInput!,
                  apiKey,
                  signal,
                }),
                { maxAttempts: 1 },
              )
              timings.interpreter_ms = Date.now() - interpreterStartedAt
              return generated
            })()
        if (deterministicPipelineMove) {
          timings.interpreter_ms = 0
          pipelineDecisionProvider = 'botpress'
          pipelineDecisionModel = interpreted.model
        }
        const authoritativeMove = bindCurrentConversationalIntentToMoveV1(
          bindCurrentCatalogResolutionToMoveV1(interpreted.move, owned),
          owned,
        )

        const plannerStartedAt = Date.now()
        const planned = await step(
          'plan-conversation-turn-v1',
          () => planConversation.execute({
            client,
            input: {
              turn_id: owned.turn_id,
              trace_id: input.trace_id,
              move: authoritativeMove,
            },
          }),
          { maxAttempts: 1 },
        )
        timings.planner_ms = Date.now() - plannerStartedAt

        const composerStartedAt = Date.now()
        const composition = await step(
          'compose-conversation-narrative-v1',
          () => composeConversationNarrativeWithFallbackV1({
            plan: planned.plan,
            fact_refs: planned.fact_refs,
            customer_goal: null,
            last_reply: lastAgentReplyV1(owned.context.recent_turns),
          }, {
            signal,
            generate: async ({ instructions, signal: composerSignal }) => {
              const generated = await execute({
                instructions,
                exits: [ComposerExit],
                temperature: 0.2,
                model: 'google-ai:gemini-3.6-flash',
                reasoningEffort: 'none',
                iterations: 1,
                signal: composerSignal,
              })
              if (!generated.is(ComposerExit)) throw new Error('COMPOSER_EXIT_NOT_REACHED')
              return generated.output
            },
          }),
          { maxAttempts: 1 },
        )
        timings.composer_ms = Date.now() - composerStartedAt
        pipelineCommit = {
          move: authoritativeMove,
          plan_hash: planned.plan_hash,
          composition,
        }
        safeLog('studyx.turn.conversation_pipeline_v1_planned', {
          trace_id: input.trace_id,
          turn_id: owned.turn_id,
          move: authoritativeMove.move,
          secondary_move_count: authoritativeMove.secondary_moves.length,
          veto_count: authoritativeMove.vetoes.length,
          interpreter_model: interpreted.model,
          interpreter_latency_ms: interpreted.latency_ms,
          composer_prompt_version: CONVERSATION_COMPOSER_PROMPT_VERSION,
          sales_behavior_version: STUDYX_SALES_BEHAVIOR_VERSION,
        })
      } catch (error) {
        const failureCode = errorCode(error)
        const brainFailureReason = classifyBrainFailureReason(
          failureCode,
          owned.business_context_available && owned.catalog_index !== null,
        )
        safeLog('studyx.turn.conversation_pipeline_v1_failed', {
          trace_id: input.trace_id,
          turn_id: owned.turn_id,
          error_code: failureCode,
          brain_source: 'fallback',
          brain_failure_reason: brainFailureReason,
        })
        // No lexical sales substitute. A factual intake-status question may
        // use the canonical claim; every other failure stays technical.
        const callPhoneFallback = needsCallPhoneRecovery(owned, failureCode)
          ? callPhoneRequiredFallback(owned)
          : null
        const stateFallback = brainFailureReason === 'policy_rejected'
          ? policyRejectedStateFallback(owned)
          : null
        pipelineFailureDecision = callPhoneFallback
          ? callPhoneFallback
          : stateFallback
          ? stateFallback
          : technicalFallback(
              owned.policy.allowed_response_types.includes('technical_fallback')
                ? 'technical_fallback'
                : 'commercial_reply',
            )
      }
    }

    // ---- Pasos 7-9: generar y validar localmente -------------------------
    // The claim already carries the one coherent business snapshot. The
    // standalone catalog action remains available to non-turn callers, but a
    // normal turn never performs a second commercial read.
    let decision: Decision
    let decisionWasModel = false
    let decisionModel: string = DECISION_MODELS[0]
    let decisionProvider: 'botpress' | 'google-ai-direct' | 'groq-direct' | 'openai-direct' | 'deepseek-direct' = 'botpress'
    timings.model_ms = 0
    if (pipelineCommit || agentTurnV2Commit) {
      decision = pipelinePlaceholder(pipelineMemoryCandidates)
      decisionProvider = pipelineDecisionProvider
      decisionModel = pipelineDecisionModel
    } else if (pipelineFailureDecision) {
      decision = pipelineFailureDecision
      if (pipelineFailureDecision.reason_code === 'BRAIN_ADVISORY_ONLY_PLANNER_REJECTED') {
        decisionProvider = pipelineDecisionProvider
        decisionModel = pipelineDecisionModel
      } else {
        decisionModel = 'policy:conversation-pipeline-v1-unavailable'
      }
    } else if (commercialRoute.kind !== 'model_required') {
      decision = commercialRoute.decision
      decisionModel = commercialRoute.model
      timings.model_ms = 0
    } else {
      const modelStartedAt = Date.now()
      try {
        const generatedTurn = await step(
          'generate-structured-decision',
          async () => {
            // The prompt is identical for both providers: only the executor
            // differs below. This is the ONE call site where a raw model
            // decision is parsed here. The single provider-independent policy
            // call runs below after deterministic/model/fallback convergence.
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
                timeoutMs: Math.min(
                  configuration.requestTimeoutMs,
                  MAX_GEMINI_DECISION_TIMEOUT_MS,
                ),
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
              decision: rawDecision,
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
        decisionWasModel = true
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
        decision = owned.policy.allowed_response_types.includes('commercial_reply')
          || owned.policy.allowed_response_types.includes('technical_fallback')
          ? modelUnavailableFallback(owned)
          : suppress('MODEL_UNAVAILABLE')
        decisionModel = 'policy:model-unavailable'
      }
    }

    // Exactly one policy call for every route: deterministic, suppressed,
    // model and technical fallback all converge here before commit.
    if (decisionWasModel) decision = constrainModelToAdvisory(decision, owned)
    decision = applyDecisionPolicy(decision, owned)

    if (Number.isFinite(occurredAtMs)) {
      timings.event_to_decision_ms = Math.max(0, Date.now() - occurredAtMs)
    }

    // ---- Paso 10: commitear en Next.js -----------------------------------
    let committed: CommitDecisionResponse
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
              // Canonical course identity resolved by the deterministic route
              // or preserved from the claim; the backend re-resolves it before
              // authorizing any protected fact.
              authorized_offering_code: authorizedOfferingCode,
              // A deterministic current-batch selection only. The backend
              // re-derives it before persisting plan_selected.
              // Plannerless is the complete conversational authority. A
              // deterministic legacy route may have noticed a plan token, but
              // leaking that parallel interpretation into this commit can
              // reject a valid objection turn with PAYMENT_PLAN_MISMATCH.
              authorized_payment_plan: agentTurnV2Commit === null
                ? authorizedPaymentPlan
                : null,
              conversation_pipeline_v1: pipelineCommit,
              agent_turn_v2: agentTurnV2Commit,
              supports_multi_outbound: true,
              supports_turn_supersession: true,
              decision,
              model: {
                provider: decisionProvider,
                model: decisionModel,
                prompt_version: pipelineCommit || agentTurnV2Commit || pipelineFailureDecision?.reason_code.startsWith('BRAIN_')
                  ? pipelinePromptVersion
                  : AGENT_A_PROMPT_VERSION,
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
      if (callOfferAudit !== null) {
        const committedAudit = committed.status === 'committed' || committed.status === 'duplicate'
        const committedOutbounds = Array.isArray(committed.outbounds)
          ? committed.outbounds
          : null
        const declaredCallOffer = agentTurnV2Commit?.proposal.response.call_offer?.trim() ?? null
        const physicalCallOffer = committedAudit && declaredCallOffer !== null && (
          committedOutbounds === null
            ? callOfferAudit.offered_call
            : committedOutbounds.some((outbound) => outbound.content.trim() === declaredCallOffer)
        )
        safeLog('studyx.turn.call_offer_policy_v1', {
          trace_id: input.trace_id,
          turn_id: owned.turn_id,
          call_offer_count_before: callOfferAudit.call_offer_count_before,
          call_offer_count_after: physicalCallOffer
            ? Math.min(2, callOfferAudit.call_offer_count_before + 1)
            : callOfferAudit.call_offer_count_before,
          offered_call: physicalCallOffer,
          reason: callOfferAudit.reason,
          call_accepted: callOfferAudit.call_accepted,
          call_rejected: callOfferAudit.call_rejected,
          chat_preference: callOfferAudit.chat_preference,
          commit_status: committed.status,
        })
      }
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

    if (committed.status === 'rejected' || !committed.outbound) {
      state.phase = committed.next_state
      emitTimings()
      return resultFromState(state, input.trace_id)
    }

    // A reserved call is a deferred side effect. Agent A must first submit
    // its visible acknowledgement and durably record that submission. Only
    // then may this edge ask the voice provider to call. A channel failure or
    // an ambiguous delivery report returns before this function is reached,
    // so the customer can never receive an unexplained call.
    const dispatchAcknowledgedCall = async (): Promise<void> => {
      if (!committed.call_request) return
      const dispatchStartedAt = Date.now()
      try {
        const dispatched = await step(
          'dispatch-voice-call-after-agent-a-ack',
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

    // New backend capability: each model-authored part has its own durable
    // message, manifest, delivery lease and report. Older backends omit the
    // array and continue through the singular compatibility path below.
    if ((committed.outbounds?.length ?? 0) > 0) {
      const multiSendStartedAt = Date.now()
      let lastBotpressMessageId: string | null = null

      for (const outboundPart of committed.outbounds) {
        // A replay may contain parts already acknowledged by Botpress. Their
        // durable delivery state is the fence: never submit those texts again;
        // continue from the first unfinished part only.
        if (outboundPart.status === 'submitted_to_botpress') {
          safeLog('studyx.turn.outbound_part_already_submitted', {
            trace_id: input.trace_id,
            turn_id: owned.turn_id,
            outbound_id: outboundPart.id,
            part_index: outboundPart.part_index,
          })
          continue
        }
        if (outboundPart.status === 'failed') {
          // Retry leasing belongs to the delivery reconciler. A workflow
          // replay has no new attempt token and therefore must not redeliver.
          state.deliveryStatus = 'failed'
          state.phase = 'retry_pending'
          state.errorCode = 'OUTBOUND_RETRY_PENDING'
          emitTimings()
          return resultFromState(state, input.trace_id)
        }
        const verification = await verifyAuthorizedEgressPortable({
          content: outboundPart.content,
          manifest: outboundPart.authorized_egress,
        }).catch(() => ({ ok: false, reason: 'CRYPTO_UNAVAILABLE' } as const))

        if (!verification.ok) {
          state.deliveryStatus = 'failed'
          state.phase = 'paused_error'
          state.errorCode = `EGRESS_${verification.reason}`
          try {
            await step(
              `report-egress-verification-failure-part-${outboundPart.part_index}`,
              () => reportDelivery.execute({
                client,
                input: {
                  outbound_id: outboundPart.id,
                  trace_id: input.trace_id,
                  status: 'failed',
                  botpress_message_id: null,
                  replayed: false,
                  error_code: state.errorCode,
                  delivery_attempt: outboundPart.delivery_attempt,
                },
              }),
              { maxAttempts: 1 }
            )
          } catch (reportError) {
            safeLog('studyx.turn.delivery_report_failed', {
              trace_id: input.trace_id,
              turn_id: owned.turn_id,
              outbound_id: outboundPart.id,
              part_index: outboundPart.part_index,
              error_code: errorCode(reportError),
            })
          }
          emitTimings()
          return resultFromState(state, input.trace_id)
        }

        let delivery: { message: { id: string } }
        try {
          delivery = await step(
            `submit-outbound-to-botpress-part-${outboundPart.part_index}`,
            () => {
              if (input.channel === 'whatsapp' && input.sandbox_provider !== 'telegram_sandbox') {
                const canary = evaluateWhatsAppCanarySend({
                  automationEnabled: configuration.automationEnabled,
                  whatsappCanaryEnabled: configuration.whatsappCanaryEnabled === true,
                  allowlist: secrets.WHATSAPP_CANARY_PHONE_E164S,
                  phoneE164: input.phone_e164,
                  log: (event) => console.info(JSON.stringify(event)),
                })
                if (!canary.allowed) {
                  const blocked = new Error(canary.reason)
                  blocked.name = canary.reason
                  throw blocked
                }
              }
              return client.createMessage({
                conversationId: input.botpress_conversation_id,
                userId: context.get('botId'),
                type: 'text',
                payload: { text: outboundPart.content },
                tags: {
                  studyxOutboundId: outboundPart.id,
                  studyxTraceId: input.trace_id,
                  studyxPartIndex: String(outboundPart.part_index),
                  studyxPartCount: String(outboundPart.part_count),
                },
              }) as Promise<{ message: { id: string } }>
            },
            { maxAttempts: 1 }
          )
        } catch (error) {
          state.deliveryStatus = 'failed'
          state.phase = 'paused_error'
          state.errorCode = errorCode(error)
          try {
            await step(
              `report-botpress-failure-part-${outboundPart.part_index}`,
              () => reportDelivery.execute({
                client,
                input: {
                  outbound_id: outboundPart.id,
                  trace_id: input.trace_id,
                  status: 'failed',
                  botpress_message_id: null,
                  replayed: false,
                  error_code: state.errorCode,
                  delivery_attempt: outboundPart.delivery_attempt,
                },
              }),
              { maxAttempts: 1 }
            )
          } catch (reportError) {
            safeLog('studyx.turn.delivery_report_failed', {
              trace_id: input.trace_id,
              turn_id: owned.turn_id,
              outbound_id: outboundPart.id,
              part_index: outboundPart.part_index,
              error_code: errorCode(reportError),
            })
          }
          emitTimings()
          return resultFromState(state, input.trace_id)
        }

        // Report immediately. If this becomes ambiguous after createMessage
        // returned an id, stop before the next part; never resend this one.
        try {
          await step(
            `report-botpress-submission-part-${outboundPart.part_index}`,
            () => reportDelivery.execute({
              client,
              input: {
                outbound_id: outboundPart.id,
                trace_id: input.trace_id,
                status: 'submitted_to_botpress',
                botpress_message_id: delivery.message.id,
                replayed: false,
                error_code: null,
                delivery_attempt: outboundPart.delivery_attempt,
              },
            }),
            { maxAttempts: 1 }
          )
        } catch (error) {
          state.phase = 'paused_error'
          state.errorCode = errorCode(error)
          safeLog('studyx.turn.delivery_report_failed', {
            trace_id: input.trace_id,
            turn_id: owned.turn_id,
            outbound_id: outboundPart.id,
            part_index: outboundPart.part_index,
            botpress_message_id: delivery.message.id,
            error_code: state.errorCode,
          })
          emitTimings()
          return resultFromState(state, input.trace_id)
        }
        lastBotpressMessageId = delivery.message.id
      }

      timings.send_ms = Date.now() - multiSendStartedAt
      if (Number.isFinite(occurredAtMs)) {
        timings.event_to_visible_outbound_ms = Math.max(0, Date.now() - occurredAtMs)
        timings.event_to_visible_outbound_over_budget =
          timings.event_to_visible_outbound_ms >= 10_000 ? 1 : 0
      }
      state.deliveryStatus = 'submitted_to_botpress'
      await dispatchAcknowledgedCall()
      try {
        await step(
          'flush-lead-projection-multi',
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
        outbound_ids: committed.outbounds.map((part) => part.id),
        botpress_message_id: lastBotpressMessageId,
        botpress_message_replayed: false,
      })
      emitTimings({
        model: decisionModel,
        fast_path: commercialRoute.kind === 'deterministic',
      })
      return resultFromState(state, input.trace_id)
    }

    // ---- Última barrera antes del único envío físico ---------------------
    // The backend owns the capability; this edge only verifies that the exact
    // content received here is still the content it authorized. Any malformed
    // or altered value is a terminal failed attempt, never a send retry.
    const egressStartedAt = Date.now()
    const egressVerification = await verifyAuthorizedEgressPortable({
      content: committed.outbound.content,
      manifest: committed.outbound.authorized_egress,
    }).catch(() => ({ ok: false, reason: 'CRYPTO_UNAVAILABLE' } as const))
    timings.egress_verify_ms = Date.now() - egressStartedAt
    if (!egressVerification.ok) {
      state.deliveryStatus = 'failed'
      state.phase = 'paused_error'
      state.errorCode = `EGRESS_${egressVerification.reason}`

      try {
        await step(
          'report-egress-verification-failure',
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

      safeLog('studyx.turn.egress_blocked', {
        trace_id: input.trace_id,
        turn_id: owned.turn_id,
        outbound_id: committed.outbound.id,
        reason: egressVerification.reason,
      })
      emitTimings()
      return resultFromState(state, input.trace_id)
    }

    // ---- Paso 11: un único envío físico ----------------------------------
    let delivery: { message: { id: string } }
    const sendStartedAt = Date.now()
    try {
      delivery = await step(
        'submit-outbound-to-botpress',
        () => {
          // Telegram deliberately traverses the WhatsApp-shaped backend contract
          // with `sandbox_provider=telegram_sandbox`. The WhatsApp production
          // canary must never fence that sandbox egress.
          if (input.channel === 'whatsapp' && input.sandbox_provider !== 'telegram_sandbox') {
            const canary = evaluateWhatsAppCanarySend({
              automationEnabled: configuration.automationEnabled,
              whatsappCanaryEnabled: configuration.whatsappCanaryEnabled === true,
              allowlist: secrets.WHATSAPP_CANARY_PHONE_E164S,
              phoneE164: input.phone_e164,
              log: (event) => console.info(JSON.stringify(event)),
            })
            if (!canary.allowed) {
              const blocked = new Error(canary.reason)
              blocked.name = canary.reason
              throw blocked
            }
          }
          return client.createMessage({
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
          }) as Promise<{ message: { id: string } }>
        },
        { maxAttempts: 1 }
      )
      timings.send_ms = Date.now() - sendStartedAt
      if (Number.isFinite(occurredAtMs)) {
        // Returned createMessage is the first edge-owned proof that the
        // outbound is visible to the Botpress channel. Because the origin is
        // the inbound event timestamp, this includes the batching window.
        timings.event_to_visible_outbound_ms = Math.max(0, Date.now() - occurredAtMs)
        timings.event_to_visible_outbound_over_budget =
          timings.event_to_visible_outbound_ms >= 10_000 ? 1 : 0
      }
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

    await dispatchAcknowledgedCall()

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
      fast_path: commercialRoute.kind === 'deterministic',
    })
    return resultFromState(state, input.trace_id)
  },
})
