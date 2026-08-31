import { Autonomous, Workflow, adk, configuration, context, secrets, z } from '@botpress/runtime'
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
  constrainModelToAdvisory,
  suppress,
  modelUnavailableFallback,
} from '../utils/decision-policy'
import { routeCommercialTurn } from '../utils/commercial-router'
import { verifyAuthorizedEgressPortable } from '../utils/authorized-egress'
import { generateGeminiDecision, MAX_GEMINI_DECISION_TIMEOUT_MS } from '../lib/decision/gemini-direct'
import { generateGroqDecision } from '../lib/decision/groq-direct'
import {
  generateGroqConversationMoveV1,
  type ConversationInterpreterInputV1,
} from '../lib/conversation/conversation-interpreter'
import {
  composeConversationNarrativeWithFallbackV1,
} from '../lib/conversation/conversation-composer'
import {
  bindCurrentCatalogResolutionToMoveV1,
  buildAgentAContextV1,
} from '../lib/conversation/agent-a-context'
import {
  DEFAULT_AGENT_A_BRAIN_MODEL,
  DEFAULT_AGENT_A_BRAIN_DEEPSEEK_MODEL,
  DEFAULT_AGENT_A_BRAIN_GEMINI_MODEL,
  DEFAULT_AGENT_A_BRAIN_OPENAI_FALLBACK_MODEL,
  DEFAULT_AGENT_A_BRAIN_OPENAI_MODEL,
  buildSafeAgentABrainCompositionV1,
  generateAgentATurnProposalV1,
  generateDeepSeekAgentATurnProposalV1,
  generateGeminiAgentATurnProposalV1,
  generateOpenAIAgentATurnProposalV1,
  parseAgentATurnProposalV1,
} from '../lib/conversation/agent-a-brain'
import { AgentATurnProposalV1Schema, type AgentATurnProposalV1 } from '../schemas/agent-a-brain'
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
  buildAgentABrainInstructionsV1,
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

const AgentABrainExit = new Autonomous.Exit({
  name: 'agent_a_turn_proposal_v1',
  description: 'Return exactly one AgentATurnProposalV1 using the supplied canonical sales behavior.',
  schema: AgentATurnProposalV1Schema,
})

const AGENT_A_BRAIN_MANAGED_MODELS = [
  'google-ai:gemini-3.6-flash',
  'google-ai:gemini-3.5-flash',
  'anthropic:claude-haiku-4-5-20251001',
] as const

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

    const owned = claimed
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
    const agentABrainContext = buildAgentAContextV1(owned)
    if (agentABrainContext) {
      safeLog('studyx.turn.agent_a_context_built', {
        trace_id: input.trace_id,
        turn_id: owned.turn_id,
        context_recent_turn_count: agentABrainContext.turn.recent_turns.length,
        context_memory_count: agentABrainContext.customer.memories.length,
      })
    }

    // One pure router owns capability precedence for both this workflow and
    // the local evaluator. It chooses a deterministic decision, suppression,
    // or one model request; it never applies the final policy itself.
    const commercialRoute = routeCommercialTurn({
      automationEnabled: configuration.automationEnabled,
      claimed: owned,
    })
    const authorizedOfferingCode = commercialRoute.kind === 'deterministic'
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
    let pipelineFailureDecision: Decision | null = null
    let pipelineDecisionProvider: 'botpress' | 'google-ai-direct' | 'groq-direct' | 'openai-direct' | 'deepseek-direct' = 'botpress'
    let pipelineDecisionModel = 'conversation-pipeline-v1'
    let pipelinePromptVersion = `${CONVERSATION_INTERPRETER_PROMPT_VERSION}+${CONVERSATION_COMPOSER_PROMPT_VERSION}+${STUDYX_SALES_BEHAVIOR_VERSION}`
    let pipelineMemoryCandidates: Decision['memory_candidates'] = []
    const brainAuthoritative = owned.features?.agent_a_brain_v1_enabled === true
    const brainShadow = owned.features?.agent_a_brain_v1_shadow === true
    const conversationalBaseEligible = configuration.automationEnabled
      && owned.policy.may_respond
      && (owned.policy.allowed_response_types.includes('commercial_reply')
        || (brainAuthoritative && owned.policy.allowed_response_types.includes('social_reply')))
    const legacyPipelineEligible = conversationalBaseEligible
      && owned.features?.conversation_pipeline_v1_enabled === true
    const brainEligible = conversationalBaseEligible
      && (brainAuthoritative || brainShadow)
      && (owned.deterministic_route === null || brainAuthoritative)
      && agentABrainContext !== null

    if (brainEligible) {
      try {
        let generated: {
          proposal: AgentATurnProposalV1
          provider: 'botpress' | 'google-ai-direct' | 'groq-direct' | 'openai-direct' | 'deepseek-direct'
          model: string
          latency_ms: number
          attempt_count: number
        } | undefined
        const deepSeekApiKey = secrets.DEEPSEEK_API_KEY
        const openAIApiKey = secrets.OPENAI_API_KEY
        let directError: unknown = new Error('DEEPSEEK_API_KEY_MISSING')
        let openAIFallbackError: unknown = new Error('OPENAI_FALLBACK_NOT_ATTEMPTED')
        if (typeof deepSeekApiKey === 'string' && deepSeekApiKey.length > 0) {
          try {
            generated = await step(
              'generate-agent-a-turn-proposal-v1-deepseek-primary',
              () => generateDeepSeekAgentATurnProposalV1({
                context: agentABrainContext,
                apiKey: deepSeekApiKey,
                signal,
                model: typeof configuration.agentABrainDeepSeekModel === 'string'
                  ? configuration.agentABrainDeepSeekModel
                  : DEFAULT_AGENT_A_BRAIN_DEEPSEEK_MODEL,
              }),
              { maxAttempts: 1 },
            )
          } catch (error) {
            directError = error
          }
        }
        if (generated === undefined && typeof openAIApiKey === 'string' && openAIApiKey.length > 0) {
          try {
            generated = await step(
              'generate-agent-a-turn-proposal-v1-openai-primary',
              () => generateOpenAIAgentATurnProposalV1({
                context: agentABrainContext,
                apiKey: openAIApiKey,
                signal,
                model: typeof configuration.agentABrainOpenAIModel === 'string'
                  ? configuration.agentABrainOpenAIModel
                  : DEFAULT_AGENT_A_BRAIN_OPENAI_MODEL,
              }),
              { maxAttempts: 1 },
            )
          } catch (error) {
            directError = error
            try {
              generated = await step(
                'generate-agent-a-turn-proposal-v1-openai-fallback',
                () => generateOpenAIAgentATurnProposalV1({
                  context: agentABrainContext,
                  apiKey: openAIApiKey,
                  signal,
                  model: typeof configuration.agentABrainOpenAIFallbackModel === 'string'
                    ? configuration.agentABrainOpenAIFallbackModel
                    : DEFAULT_AGENT_A_BRAIN_OPENAI_FALLBACK_MODEL,
                  timeout_ms: 3_000,
                }),
                { maxAttempts: 1 },
              )
              safeLog('studyx.turn.agent_a_brain_provider_failover', {
                trace_id: input.trace_id,
                turn_id: owned.turn_id,
                from_provider: 'openai-direct-primary',
                to_provider: 'openai-direct-fallback',
                direct_error_code: errorCode(directError),
              })
            } catch (fallbackError) {
              openAIFallbackError = fallbackError
            }
          }
        }

        if (generated === undefined && !(typeof openAIApiKey === 'string' && openAIApiKey.length > 0)) {
          const apiKey = secrets.GROQ_API_KEY
          if (typeof apiKey !== 'string' || apiKey === '') {
            throw new StudyxHttpError('AGENT_A_BRAIN_PROVIDER_KEY_MISSING', false)
          }
          try {
            generated = await step(
              'generate-agent-a-turn-proposal-v1-groq-compatibility',
              () => generateAgentATurnProposalV1({
                context: agentABrainContext,
                apiKey,
                signal,
                model: typeof configuration.agentABrainModel === 'string'
                  ? configuration.agentABrainModel
                  : DEFAULT_AGENT_A_BRAIN_MODEL,
              }),
              { maxAttempts: 1 },
            )
          } catch (error) {
            directError = error
          }
        }

        if (generated === undefined) {
          // A provider quota must not replace the full sales brain with a
          // canned response. First use the separately provisioned direct
          // Gemini boundary, which keeps the exact prompt and schema without
          // consuming Botpress AI Spend. Managed models remain the last model
          // failover before the contextual deterministic response.
          let geminiError: unknown = typeof openAIApiKey === 'string' && openAIApiKey.length > 0
            ? openAIFallbackError
            : new Error('GEMINI_API_KEY_MISSING')
          const geminiApiKey = secrets.GEMINI_API_KEY
          if (!(typeof openAIApiKey === 'string' && openAIApiKey.length > 0)
            && typeof geminiApiKey === 'string' && geminiApiKey.length > 0) {
            try {
              generated = await step(
                'generate-agent-a-turn-proposal-v1-gemini',
                () => generateGeminiAgentATurnProposalV1({
                  context: agentABrainContext,
                  apiKey: geminiApiKey,
                  signal,
                  model: DEFAULT_AGENT_A_BRAIN_GEMINI_MODEL,
                }),
                { maxAttempts: 1 },
              )
              safeLog('studyx.turn.agent_a_brain_provider_failover', {
                trace_id: input.trace_id,
                turn_id: owned.turn_id,
                from_provider: 'groq-direct',
                to_provider: 'google-ai-direct',
                direct_error_code: errorCode(directError),
              })
            } catch (error) {
              geminiError = error
            }
          }

          if (generated === undefined) {
            try {
              const managedStartedAt = Date.now()
              generated = await step(
                'generate-agent-a-turn-proposal-v1-managed',
                async () => {
                  const managed = await execute({
                    instructions: buildAgentABrainInstructionsV1(agentABrainContext),
                    exits: [AgentABrainExit],
                    temperature: 0.2,
                    model: [...AGENT_A_BRAIN_MANAGED_MODELS],
                    reasoningEffort: 'low',
                    iterations: 2,
                    signal,
                  })
                  if (!managed.is(AgentABrainExit)) throw new Error('AGENT_A_BRAIN_EXIT_NOT_REACHED')
                  return {
                    proposal: parseAgentATurnProposalV1(managed.output, agentABrainContext),
                    provider: 'botpress' as const,
                    model: AGENT_A_BRAIN_MANAGED_MODELS.join('>'),
                    latency_ms: Date.now() - managedStartedAt,
                    attempt_count: 1 as const,
                  }
                },
                { maxAttempts: 1 },
              )
              safeLog('studyx.turn.agent_a_brain_provider_failover', {
                trace_id: input.trace_id,
                turn_id: owned.turn_id,
                from_provider: 'groq-direct',
                to_provider: 'botpress',
                direct_error_code: errorCode(directError),
                gemini_error_code: errorCode(geminiError),
              })
            } catch (managedError) {
              try {
                const extractStartedAt = Date.now()
                const extracted = await step(
                  'generate-agent-a-turn-proposal-v1-managed-extract',
                  () => adk.zai.extract(
                    `${buildAgentABrainInstructionsV1(agentABrainContext)}\n\nReturn only the single AgentATurnProposalV1 JSON object.`,
                    AgentATurnProposalV1Schema,
                  ),
                  { maxAttempts: 1 },
                )
                generated = {
                  proposal: parseAgentATurnProposalV1(extracted, agentABrainContext),
                  provider: 'botpress',
                  model: 'botpress-zai-extract',
                  latency_ms: Date.now() - extractStartedAt,
                  attempt_count: 1,
                }
                safeLog('studyx.turn.agent_a_brain_provider_failover', {
                  trace_id: input.trace_id,
                  turn_id: owned.turn_id,
                  from_provider: 'botpress-autonomous',
                  to_provider: 'botpress-zai-extract',
                  direct_error_code: errorCode(directError),
                  gemini_error_code: errorCode(geminiError),
                  managed_error_code: errorCode(managedError),
                })
              } catch (extractError) {
                safeLog('studyx.turn.agent_a_brain_provider_failover_failed', {
                  trace_id: input.trace_id,
                  turn_id: owned.turn_id,
                  direct_error_code: errorCode(directError),
                  gemini_error_code: errorCode(geminiError),
                  managed_error_code: errorCode(managedError),
                  extract_error_code: errorCode(extractError),
                })
                throw directError
              }
            }
          }
        }
        if (generated === undefined) throw new Error('AGENT_A_BRAIN_PROVIDER_CHAIN_EMPTY')
        timings.agent_a_brain_ms = generated.latency_ms

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
          const authoritativeMove = bindCurrentCatalogResolutionToMoveV1(
            generated.proposal.move,
            owned,
          )
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
            const composition = buildSafeAgentABrainCompositionV1({
              proposal: generated.proposal,
              context: agentABrainContext,
              response_goal: planned.plan.response_goal,
              planned_fact_ids: planned.fact_refs.map((fact: { id: string }) => fact.id),
            })
            pipelineCommit = {
              move: authoritativeMove,
              plan_hash: planned.plan_hash,
              composition,
            }
            pipelineMemoryCandidates = generated.proposal.memory_candidates
            safeLog('studyx.turn.agent_a_brain_v1', {
              trace_id: input.trace_id,
              turn_id: owned.turn_id,
              rollout_mode: 'authoritative',
              brain_prompt_version: AGENT_A_BRAIN_PROMPT_VERSION,
              brain_model: generated.model,
              brain_source: 'model',
              brain_failure_reason: null,
              context_recent_turn_count: agentABrainContext.turn.recent_turns.length,
              context_memory_count: agentABrainContext.customer.memories.length,
              used_memory_count: generated.proposal.used_memory_ids.length,
              call_offer_transition: `${agentABrainContext.commercial_state.call_offer_count}->${planned.plan.next_call_offer_count}`,
              proposed_action_type: generated.proposal.proposed_action.type,
              authorized_action_type: planned.plan.allowed_business_action.type,
            })
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
          brain_model: typeof configuration.agentABrainModel === 'string'
            ? configuration.agentABrainModel
            : DEFAULT_AGENT_A_BRAIN_MODEL,
          brain_source: 'fallback',
          brain_failure_reason: brainFailureReason,
          context_recent_turn_count: agentABrainContext.turn.recent_turns.length,
          context_memory_count: agentABrainContext.customer.memories.length,
          used_memory_count: 0,
          call_offer_transition: `${agentABrainContext.commercial_state.call_offer_count}->${agentABrainContext.commercial_state.call_offer_count}`,
          proposed_action_type: 'none',
          authorized_action_type: 'none',
        })
        // Authoritative means the conversational brain owns all customer
        // copy. Never substitute a catalog, greeting, call, or payment
        // template when generation/planning fails: commit a silent decision
        // and preserve the backend safety boundaries instead.
        if (brainAuthoritative) {
          pipelineFailureDecision = suppress('BRAIN_UNAVAILABLE_NO_CANNED_FALLBACK')
        }
      }
    }

    const deterministicPipelineMove = conversationalBaseEligible
      && (legacyPipelineEligible || brainAuthoritative)
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
        const authoritativeMove = bindCurrentCatalogResolutionToMoveV1(
          interpreted.move,
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
        pipelineFailureDecision = modelUnavailableFallback(owned, brainFailureReason)
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
    if (pipelineCommit) {
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
              // Canonical course identity resolved by the deterministic route
              // or preserved from the claim; the backend re-resolves it before
              // authorizing any protected fact.
              authorized_offering_code: authorizedOfferingCode,
              // A deterministic current-batch selection only. The backend
              // re-derives it before persisting plan_selected.
              authorized_payment_plan: authorizedPaymentPlan,
              conversation_pipeline_v1: pipelineCommit,
              decision,
              model: {
                provider: decisionProvider,
                model: decisionModel,
                prompt_version: pipelineCommit || pipelineFailureDecision?.reason_code.startsWith('BRAIN_')
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
