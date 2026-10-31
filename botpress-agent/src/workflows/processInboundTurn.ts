import { createTurnEvidenceJournal, isTurnEvidencePersistenceError, TurnEvidencePersistenceError } from '../lib/observability/turn-evidence'
import { persistTurnEvidence } from '../lib/observability/persist-turn-evidence'
import { commitDecisionWithRejectionReceiptV1, backendDecisionRejectionReason, backendDecisionRejectionSubjects } from '../lib/delivery/commit-decision-receipt'
import { eligibleContactRequestFieldsV1 } from '../lib/conversation/contact-profile-request-policy'
import { scheduleTurnRecovery } from '../actions/scheduleTurnRecovery'
import { bindRecoveryFeedbackV1 } from '../lib/conversation/recovery-feedback'
import { captureContactProfile, ContactProfileReceiptSchema } from '../actions/captureContactProfile'
import { randomUUID } from 'node:crypto'
import { Autonomous, Workflow, actions as runtimeActions, configuration, context, secrets, z } from '@botpress/runtime'
import { claimBatch } from '../actions/claimBatch'
import { commitDecision as commitDecisionUnobserved } from '../actions/commitDecision'
import { dispatchCall } from '../actions/dispatchCall'
import { flushLeadProjection } from '../actions/flushLeadProjection'
import { ingestTurn } from '../actions/ingestTurn'
import { synchronizeConversationInbound } from '../lib/inbound/sync-conversation-inbound'
import { analyzeImage } from '../actions/analyzeImage'
import { planConversation } from '../actions/planConversation'
import { reportDelivery } from '../actions/reportDelivery'
import { authorizeOutboundContinuation } from '../actions/authorizeOutboundContinuation'
import { persistDeliveryReportDurably, type PendingDeliveryReport } from '../lib/delivery/durable-delivery-report'
import { transcribeAudio } from '../actions/transcribeAudio'
import {
  ClaimedTurnSchema,
  DecisionSchema,
  InboundEnvelopeSchema,
  ProcessingStateSchema,
  WorkflowInputSchema,
  WorkflowResultSchema,
  type ClaimedTurn,
  type CommitDecisionResponse,
  type Decision,
  type IngestResponse,
  type TurnDiagnosticsV1,
  type WorkflowResult,
} from '../schemas/contracts'
import {
  AGENT_A_PROMPT_VERSION,
  buildAgentASalesBridgeCompactInstructions,
  buildAgentASalesBridgeInstructions,
} from '../prompts/agent-a-sales-bridge'
import { requestStudyxJson, StudyxHttpError } from '../utils/http'
import {
  applyDecisionPolicy,
  classifyBrainFailureReason,
  constrainModelToAdvisory,
  suppress,
  technicalFallback,
  technicalContinuityFallback,
  modelUnavailableFallback,
} from '../utils/decision-policy'
import {
  routeCommercialTurn,
} from '../utils/commercial-router'
import { verifyAuthorizedEgressPortable } from '../utils/authorized-egress'
import { generateGeminiDecision as generateGeminiUnobserved, MAX_GEMINI_DECISION_TIMEOUT_MS } from '../lib/decision/gemini-direct'
import { generateGroqDecision as generateGroqUnobserved } from '../lib/decision/groq-direct'
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
  claimsImmediateCallDispatchV1,
  generateDeepSeekAgentATurnProposalV1 as generateDeepSeekUnobserved,
  type GeneratedAgentATurnProposalV1,
} from '../lib/conversation/agent-a-brain'
import { claimsImmediatePaymentLinkDeliveryV1 } from '../../../src/shared/conversation/payment-link-claim'
import {
  classifyAgentAAttemptFailure,
  isAgentAProviderFailure,
  runAgentADeepSeekAttemptV1,
} from '../lib/conversation/agent-a-attempt'
import { resolveAgentAProposalV1 } from '../lib/conversation/resolve-agent-a-proposal'
import { resolveAgentAPlannerlessProposalV2 } from '../lib/conversation/resolve-agent-a-plannerless'
import { authorizedPromotionActionsV1, continueAgentAAfterActionFeedbackV1, fencedAgentARequestV1, plannerlessActionFeedbackV1 } from '../lib/conversation/agent-a-action-feedback'
import { evaluateCallOfferTurnPolicyV1 } from '../lib/conversation/call-offer-turn-policy'
import type { AgentATurnProposalV1 } from '../schemas/agent-a-brain'
import type { AgentATurnCommitV2 } from '../schemas/agent-turn-v2'
import type { TurnRejectionV1 } from '../schemas/turn-rejection'
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

// ADK 2.0.6 exposes integration actions at runtime, while its generated
// aggregate declaration can omit the alias in mixed workspace typechecks.
type WhatsappRuntimeActions = {
  startTypingIndicator(input: {
    conversationId: string
    messageId: string
    timeout?: number
  }): Promise<Record<string, never>>
  stopTypingIndicator(input: {
    conversationId: string
    messageId: string
  }): Promise<Record<string, never>>
}

const getWhatsappRuntimeActions = (): WhatsappRuntimeActions => (runtimeActions as typeof runtimeActions & {
  whatsapp: {
    startTypingIndicator(input: {
      conversationId: string
      messageId: string
      timeout?: number
    }): Promise<Record<string, never>>
    stopTypingIndicator(input: {
      conversationId: string
      messageId: string
    }): Promise<Record<string, never>>
  }
}).whatsapp

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
const INBOUND_RECOVERY_BASE_DELAY_MS = 2_000
const INBOUND_RECOVERY_MAX_DELAY_MS = 15_000

const MIN_INTER_BUBBLE_DELAY_MS = 650
const INTER_BUBBLE_DELAY_RANGE_MS = 251
const MIN_WHATSAPP_REPLY_LATENCY_MS = 8_000
const WHATSAPP_REPLY_LATENCY_RANGE_MS = 6_001
const VISIBLE_OUTBOUND_BUDGET_MS = 15_000

function interBubbleDelayMs(outboundId: string): number {
  let hash = 0
  for (const character of outboundId) hash = (hash * 31 + character.charCodeAt(0)) >>> 0
  return MIN_INTER_BUBBLE_DELAY_MS + hash % INTER_BUBBLE_DELAY_RANGE_MS
}

function stableJitterMs(value: string, rangeMs: number): number {
  let hash = 0
  for (const character of value) hash = (hash * 31 + character.charCodeAt(0)) >>> 0
  return hash % rangeMs
}

export function whatsappReplyTargetLatencyMs(externalMessageId: string): number {
  return MIN_WHATSAPP_REPLY_LATENCY_MS
    + stableJitterMs(externalMessageId, WHATSAPP_REPLY_LATENCY_RANGE_MS)
}

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

function normalizedVisibleText(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/gu, '').toLocaleLowerCase('es')
}

function mentionsProposedBonusOfferingV1(input: {
  readonly proposal: AgentATurnProposalV1
  readonly messages: readonly string[]
  readonly context: NonNullable<ReturnType<typeof buildAgentAContextV1>>
}): boolean {
  const action = input.proposal.proposed_action
  if (action.type !== 'offer_course_bonus') return false
  const bonusOffering = input.context.catalog.available_offerings.find((offering) => (
    offering.code === action.bonus_offering_code
  ))
  if (!bonusOffering) return false
  const identity = normalizedVisibleText(bonusOffering.display_name)
  return input.messages.some((message) => normalizedVisibleText(message).includes(identity))
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

function customerVisibleModelFallback(
  claimed: ClaimedTurn,
  reason?: Parameters<typeof modelUnavailableFallback>[1],
): Decision {
  return modelUnavailableFallback(claimed, reason)
}

/**
 * Exact model-authored conversation slices, ordered from most complete to
 * smallest. The helper never rewrites customer-facing copy: every candidate
 * still has to cross the complete fact/effect validator before commit.
 */
function literalConversationVariants(
  proposal: AgentATurnProposalV1,
): AgentATurnProposalV1[] {
  const variants: AgentATurnProposalV1[] = []
  const seen = new Set<string>()
  const isSubstantive = (messages: readonly string[]): boolean => {
    const tokens = messages.join(' ')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/gu, '')
      .toLocaleLowerCase('es')
      .match(/[\p{L}\p{N}]+/gu) ?? []
    const acknowledgements = new Set([
      'bien', 'bueno', 'claro', 'dale', 'de', 'acuerdo', 'entiendo',
      'gracias', 'listo', 'ok', 'okay', 'perfecto', 'si',
    ])
    return tokens.length > 0 && !tokens.every((token) => acknowledgements.has(token))
  }
  const pushMessages = (messages: string[]): void => {
    const normalized = messages.map((message) => message.trim()).filter(Boolean)
    if (normalized.length === 0 || !isSubstantive(normalized)) return
    const key = normalized.join('\u0000')
    if (seen.has(key)) return
    seen.add(key)
    variants.push({
      ...proposal,
      response: { ...proposal.response, messages: normalized },
    })
  }
  const originalMessages = [...proposal.response.messages]
  pushMessages(originalMessages)
  for (let length = originalMessages.length; length >= 1; length -= 1) {
    for (let start = 0; start + length <= originalMessages.length; start += 1) {
      pushMessages(originalMessages.slice(start, start + length))
    }
  }
  for (const message of originalMessages) {
    const boundaries = [0]
    for (const match of message.matchAll(/\n+|(?<=[.!?])\s+/gu)) {
      if (typeof match.index === 'number') boundaries.push(match.index + match[0].length)
    }
    boundaries.push(message.length)
    const uniqueBoundaries = [...new Set(boundaries)].sort((left, right) => left - right)
    for (let span = uniqueBoundaries.length - 1; span >= 1; span -= 1) {
      for (let start = 0; start + span < uniqueBoundaries.length; start += 1) {
        pushMessages([message.slice(
          uniqueBoundaries[start]!,
          uniqueBoundaries[start + span]!,
        )])
      }
    }
  }
  return variants
}

const workflowStateSchema = z.object({
  evidenceReview: z.object({ workflow_id: z.string(), subject_id: z.string(), reason: z.string(),
    evidence_location: z.string() }).nullable().default(null),
  pendingEvidence: z.array(z.object({ event_id: z.string().uuid(), kind: z.string(),
    data: z.record(z.string(), z.unknown()) })).default([]),
  phase: ProcessingStateSchema.default('received'),
  turnId: z.string().uuid().nullable().default(null),
  batchId: z.string().uuid().nullable().default(null),
  decisionId: z.string().uuid().nullable().default(null),
  outboundId: z.string().uuid().nullable().default(null),
  deliveryStatus: z.enum(['submitted_to_botpress', 'failed']).nullable().default(null),
  errorCode: z.string().nullable().default(null),
  needsOperator: z.boolean().default(false),
  inboundRecoveryDeadlineAt: z.number().nullable().default(null),
  pendingInboundRecovery: z.object({ stage: z.string(), errorCode: z.string(),
    attempt: z.number(), needsOperator: z.boolean(), nextRetryAt: z.number() }).nullable().default(null),
  pendingDeliveryReport: z.object({
    outboundId: z.string().uuid(), botpressMessageId: z.string().nullable(),
    stage: z.enum(['report', 'continuation', 'submission_review']),
    attempt: z.number(), errorCode: z.string(), needsOperator: z.boolean(),
    nextRetryAt: z.number(),
  }).nullable().default(null),
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

export function isConfirmedPreSubmissionBlock(code: string): boolean {
  return ['AUTOMATION_DISABLED', 'WHATSAPP_ROLLOUT_MODE_INVALID', 'WHATSAPP_CANARY_DISABLED',
    'WHATSAPP_CANARY_ALLOWLIST_INVALID', 'WHATSAPP_CANARY_PHONE_NOT_ALLOWED',
    'WHATSAPP_BOT_PHONE_ALLOWLIST_INVALID', 'WHATSAPP_BOT_PHONE_NOT_ALLOWED'].includes(code)
}

const PLANNERLESS_REJECTION_PREFIX = 'PLANNERLESS_PROPOSAL_REJECTED:'

function attemptFailureDiagnosticCodes(input: {
  readonly stage: string
  readonly code: string
}): string[] {
  if (input.stage === 'policy' && input.code.startsWith(PLANNERLESS_REJECTION_PREFIX)) {
    const policyCodes = input.code
      .slice(PLANNERLESS_REJECTION_PREFIX.length)
      .split(',')
      .map((code) => code.trim())
      .filter((code) => /^[A-Z0-9_:.-]+$/iu.test(code))
      .map((code) => `${PLANNERLESS_REJECTION_PREFIX}${code}`.slice(0, 128))
      .slice(0, 8)
    if (policyCodes.length > 0) return policyCodes
  }

  const diagnosticCode = input.code.split(':', 1)[0]!.slice(0, 128)
  return /^[A-Z0-9_.-]+$/u.test(diagnosticCode)
    ? [diagnosticCode]
    : ['UNKNOWN_ERROR']
}

function backendCommitTurnRejectionV1(input: {
  readonly error: unknown
  readonly proposal: AgentATurnProposalV1
  readonly context: NonNullable<ReturnType<typeof buildAgentAContextV1>>
  readonly rejectionId: string
}): TurnRejectionV1 | null {
  const reason = backendDecisionRejectionReason(input.error)
  if (reason === null) return null

  const actionSubject = input.proposal.proposed_action.type === 'none'
    ? 'backend_action'
    : input.proposal.proposed_action.type
  const factSubject = input.proposal.used_fact_ids[0] ?? 'backend_fact'
  const requirements = input.context.capabilities.required_contact_fields
  const callRequest = input.proposal.proposed_action.type === 'request_call_now'
    || input.proposal.move.move === 'request_call'
  const paymentRequest = input.proposal.proposed_action.type === 'send_payment_link'
    || input.proposal.proposed_action.type === 'send_test_payment_link'
    || input.proposal.move.move === 'request_payment_link'
  const relevantMissing = callRequest
    ? requirements?.call
    : paymentRequest
      ? requirements?.payment
      : requirements?.identity
  const missingInformation = relevantMissing ?? input.context.capabilities.intake_missing ?? []
  const missingSubject = missingInformation[0] ?? 'contact_details'
  const detailedSubjects = backendDecisionRejectionSubjects(input.error)
  const mapped: Array<TurnRejectionV1['rejections'][number]> = []
  const push = (code: TurnRejectionV1['rejections'][number]['code'], subject: string) => {
    if (!mapped.some((entry) => entry.code === code && entry.subject === subject)) {
      mapped.push({ code, subject })
    }
  }

  if (reason.startsWith('AGENT_TURN_V2_REJECTED:')) {
    for (const backendCode of reason.slice('AGENT_TURN_V2_REJECTED:'.length).split(',')) {
      switch (backendCode.trim()) {
        case 'FACT_NOT_AUTHORIZED': push('FACT_NOT_AUTHORIZED', factSubject); break
        case 'COMMERCIAL_TRUTH_VIOLATION': {
          if (detailedSubjects.length === 0) push('FACT_VALUE_MISMATCH', 'backend_commercial_fact')
          else detailedSubjects.forEach(subject => push('FACT_VALUE_MISMATCH', subject))
          break
        }
        case 'UNSUPPORTED_STATE_ASSERTION': {
          if (detailedSubjects.length === 0) push('UNSUPPORTED_OPERATIONAL_CLAIM', 'backend_state')
          else detailedSubjects.forEach((subject) => push('UNSUPPORTED_OPERATIONAL_CLAIM', subject))
          break
        }
        case 'ACTION_NOT_AUTHORIZED': push('ACTION_NOT_AUTHORIZED', actionSubject); break
        case 'MISSING_INTAKE': push('MISSING_INTAKE', missingSubject); break
        case 'CALL_OFFER_NOT_AUTHORIZED': push('CALL_BUDGET_EXHAUSTED', 'call_offer'); break
        case 'CALL_OFFER_MESSAGE_BOUNDARY_INVALID': push('CALL_OFFER_MESSAGE_BOUNDARY_INVALID', 'call_offer'); break
        case 'CALL_OFFER_REQUIRED': push('CALL_OFFER_REQUIRED', 'call_offer'); break
        case 'COURSE_NOT_RESOLVED': push('COURSE_NOT_RESOLVED', 'course_reference'); break
        case 'CHANNEL_PREFERENCE_NOT_SUPPORTED': push('CHANNEL_PREFERENCE_NOT_SUPPORTED', 'channel_preference'); break
      }
    }
  } else if (['PAYMENT_PLAN_MISMATCH', 'PAYMENT_OFFERING_REQUIRED', 'OFFERING_MISMATCH', 'OFFERING_NOT_FOUND'].includes(reason)) {
    push('ACTION_NOT_AUTHORIZED', 'send_payment_link')
    if (reason !== 'PAYMENT_PLAN_MISMATCH') push('COURSE_NOT_RESOLVED', 'course_reference')
  } else if (reason === 'CALL_PHONE_INVALID') {
    push('MISSING_INTAKE', 'telefono')
  } else if (reason.startsWith('CALL_') || reason === 'ACTIVE_CALL_IN_PROGRESS') {
    push('ACTION_NOT_AUTHORIZED', 'request_call_now')
  }
  if (mapped.length === 0) return null

  const factIds = [
    ...(input.context.catalog.selected_offering?.facts.map((fact) => fact.id) ?? []),
    ...input.context.catalog.available_offerings.map((offering) => offering.fact_id),
    ...input.context.catalog.areas.map((area) => area.fact_id),
    ...input.context.catalog.candidate_offerings.flatMap(offering => [offering.fact_id,
      ...(offering.facts?.map(fact => fact.id) ?? [])]),
    ...input.context.catalog.payment_plans.map((plan) => plan.fact_id),
    ...(input.context.catalog.test_payment_options?.map((option) => option.fact_id) ?? []),
  ]
  const actions = authorizedPromotionActionsV1(input.context)
  const promotionAcceptancePending = input.context.capabilities.course_bonus?.may_accept_offer === true
  if (input.context.capabilities.may_send_payment_link && !promotionAcceptancePending) {
    actions.push('send_payment_link')
  }
  if ((input.context.catalog.test_payment_options?.length ?? 0) > 0) actions.push('send_test_payment_link')
  if (input.context.capabilities.may_request_call_now) actions.push('request_call_now')
  const rejectedActions = new Set(mapped.flatMap((reason) => (
    reason.code === 'ACTION_NOT_AUTHORIZED' ? [reason.subject] : []
  )))

  return {
    schema_version: 1,
    rejection_id: input.rejectionId,
    attempt: 1,
    rejections: mapped,
    authorized_alternatives: {
      fact_ids: [...new Set(factIds)],
      // The durable backend receipt outranks the claim snapshot. Never feed
      // the exact rejected effect back as authorized merely because an older
      // local capability still allowed it.
      actions: actions.filter((action) => !rejectedActions.has(action)),
      missing_information: [...missingInformation],
    },
  }
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
  // Normal work expires after fifteen minutes. Pending transport recovery
  // renews this lifetime before each durable continuation.
  timeout: '15m',

  async handler({ input, state, step, execute, client, signal, workflow }) {
    input = WorkflowInputSchema.parse(input)
    state.phase = 'processing'
    state.errorCode = null
    let evidenceJournal: ReturnType<typeof createTurnEvidenceJournal> | null = null
    let whatsappTypingActive = false
    const startWhatsAppTyping = async (): Promise<void> => {
      if (whatsappTypingActive
        || input.channel !== 'whatsapp'
        || input.sandbox_provider === 'telegram_sandbox') return
      try {
        await getWhatsappRuntimeActions().startTypingIndicator({
          conversationId: input.botpress_conversation_id,
          messageId: input.external_message_id,
          timeout: 60_000,
        })
        whatsappTypingActive = true
        safeLog('studyx.turn.typing_indicator_started', { trace_id: input.trace_id })
      } catch (error) {
      if (isTurnEvidencePersistenceError(error)) throw error
        if (!(error instanceof Error)) throw error
        // Presence is UX only. A provider or integration failure must never
        // prevent the durable turn from producing the actual answer.
        safeLog('studyx.turn.typing_indicator_start_failed', {
          trace_id: input.trace_id,
          error_code: errorCode(error),
        })
      }
    }
    const stopWhatsAppTyping = async (): Promise<void> => {
      if (!whatsappTypingActive) return
      whatsappTypingActive = false
      try {
        await getWhatsappRuntimeActions().stopTypingIndicator({
          conversationId: input.botpress_conversation_id,
          messageId: input.external_message_id,
        })
      } catch (error) {
      if (isTurnEvidencePersistenceError(error)) throw error
        if (!(error instanceof Error)) throw error
        safeLog('studyx.turn.typing_indicator_stop_failed', {
          trace_id: input.trace_id,
          error_code: errorCode(error),
        })
      }
    }
    const finish = async (): Promise<WorkflowResult> => {
      await stopWhatsAppTyping()
      if (evidenceJournal) {
        evidenceJournal.capture({ kind: 'workflow_finished', phase: state.phase, error_code: state.errorCode, delivery_status: state.deliveryStatus })
        try { await evidenceJournal.flush() } catch {
          state.phase = 'paused_error'; state.errorCode = 'TURN_EVIDENCE_UNAVAILABLE'
        }
      }
      if (state.errorCode?.startsWith('TURN_EVIDENCE_')) {
        state.evidenceReview = { workflow_id: workflow.id, subject_id: state.turnId ?? input.external_message_id,
          reason: state.errorCode, evidence_location: 'workflow state.pendingEvidence and cached generation steps' }
        workflow.tags = { ...workflow.tags, studyxEvidenceReview: 'true' }
        safeLog('studyx.turn.evidence_review_required', state.evidenceReview)
      }
      return resultFromState(state, input.trace_id)
    }

    // A workflow may have been queued before a safer bundle was deployed.
    // Re-authorize the receiving WhatsApp business number before audio,
    // persistence, model calls, or any other external effect.
    if (input.channel === 'whatsapp' && input.sandbox_provider !== 'telegram_sandbox') {
      const authorization = evaluateWhatsAppCanarySend({
        automationEnabled: configuration.automationEnabled,
        whatsappPublicEnabled: configuration.whatsappPublicEnabled === true,
        whatsappCanaryEnabled: configuration.whatsappCanaryEnabled === true,
        allowlist: secrets.WHATSAPP_CANARY_PHONE_E164S,
        phoneE164: input.phone_e164,
        allowedBotPhoneNumberId: typeof configuration.whatsappAllowedBotPhoneNumberId === 'string'
          ? configuration.whatsappAllowedBotPhoneNumberId
          : undefined,
        botPhoneNumberId: input.message.metadata.bot_phone_number_id as string | undefined,
      })
      if (!authorization.allowed) {
        state.phase = 'abandoned'
        state.errorCode = authorization.reason
        safeLog('studyx.turn.whatsapp_business_number_blocked', {
          trace_id: input.trace_id,
          reason: authorization.reason,
        })
        return finish()
      }
    }

    // Per-stage wall-clock in milliseconds, logged once at every terminal
    // return via `emitTimings`. Content-free: stage names and durations only.
    // Best-effort under durable replays — a resumed workflow re-times only the
    // stages that actually re-run.
    const workflowStartedAt = Date.now()
    const recoveryJitterMs = (recovery: number): number => {
      // Stable per physical event so durable replays use the same schedule,
      // while different WhatsApp bubbles stop retrying in lockstep.
      let hash = recovery + 1
      for (const char of input.external_message_id) hash = ((hash * 33) ^ char.charCodeAt(0)) >>> 0
      return hash % 5_001
    }
    const recoverInboundOperation = async <T>(name: string, operation: () => Promise<T>): Promise<T> => {
      for (let recovery = 0; ; recovery += 1) {
        // Ingest and claim happen before the customer can receive a reply.
        // Keep recovery frequent even across consecutive transport failures;
        // an exponential five-minute gap turns a brief backend recovery into
        // customer-visible silence. The stable jitter still prevents a burst
        // of conversations from retrying in lockstep.
        const shortDelayMs = Math.min(
          INBOUND_RECOVERY_MAX_DELAY_MS,
          INBOUND_RECOVERY_BASE_DELAY_MS * 2 ** Math.min(recovery, 3)
            + recoveryJitterMs(recovery),
        )
        const receipt = await step(
          recovery === 0 ? name : `${name}-recovery-${recovery}`,
          async () => {
            try { return await operation() }
            catch (error) {
      if (isTurnEvidencePersistenceError(error)) throw error
              if (!(error instanceof Error)) throw error
              // ADK rehydrates thrown errors as plain Error. Persist a typed
              // receipt so a durable sleep can replay the retry decision.
              return { studyx_inbound_retry: {
                code: errorCode(error),
                retryable: error instanceof StudyxHttpError && error.retryable,
              } }
            }
          },
          { maxAttempts: 1 },
        )
        // Successful receipts stay in their original shape for workflows
        // whose ingest/claim steps were cached by an earlier deployment.
        if (!receipt || typeof receipt !== 'object' || !('studyx_inbound_retry' in receipt)) {
          state.pendingInboundRecovery = null
          state.phase = 'processing'
          state.errorCode = null
          state.needsOperator = false
          return receipt as T
        }
        const failure = receipt.studyx_inbound_retry
        // Older typed receipts have retry_allowed rather than retryable. They
        // represent transient HTTP failures too; their old deadline no longer
        // completes and silently strands the original event.
        const retryable = !('retryable' in failure) || failure.retryable
        const delayMs = retryable ? shortDelayMs : 300_000
        state.phase = 'retry_pending'
        state.errorCode = failure.code
        state.needsOperator = !retryable
        state.pendingInboundRecovery = { stage: name, errorCode: failure.code,
          attempt: recovery + 1, needsOperator: !retryable, nextRetryAt: Date.now() + delayMs }
        safeLog(retryable ? 'studyx.turn.inbound_recovery_scheduled'
          : 'studyx.turn.inbound_recovery_operator_required', {
          trace_id: input.trace_id, stage: name, recovery: recovery + 1,
          delay_ms: delayMs, error_code: failure.code, needs_operator: !retryable,
        })
        // Only idempotent ingest and claim use this retry. Never wrap a
        // provider send, payment or call dispatch in it.
        await step(`${name}-recovery-keepalive-${recovery + 1}`, async () => {
          await workflow.setTimeout({ in: '30m' })
        }, { maxAttempts: 1 })
        await step.sleep(`${name}-recovery-wait-${recovery + 1}`, delayMs)
      }
    }
    const timings: Record<string, number> = {}
    let occurredAtMs = Date.parse(input.message.occurred_at ?? '')
    let latestInboundAtMs = occurredAtMs
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
    // ingerir. El action ya contiene la cadena primaria/fallback: no se
    // reintenta el conjunto para evitar cobros y latencia duplicados.
    if (
      input.message.type === 'audio' &&
      input.message.audio_reference?.transcription_status === 'skipped'
    ) {
      const audioRef = input.message.audio_reference
      const providerSource = input.sandbox_provider === 'telegram_sandbox'
        ? 'telegram_sandbox'
        : input.channel === 'whatsapp'
          ? 'whatsapp_botpress'
          : null
      try {
        if (providerSource === null) throw new Error('UNSUPPORTED_AUDIO_SOURCE')
        const result = await step(
          'transcribe-audio',
          async () => {
            const r = await transcribeAudio.execute({
              input: {
                audio_reference: audioRef,
                provider_source: providerSource,
                ...(input.transport_media_url ? { media_download_url: input.transport_media_url } : {}),
              },
              client,
            })
            if (r.status !== 'ok') throw new Error(`TRANSCRIPTION_${r.reason ?? 'FAILED'}`)
            return r
          },
          { maxAttempts: 1 }
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
      if (isTurnEvidencePersistenceError(error)) throw error
        if (!(error instanceof Error)) throw error
        input.message.type = 'unsupported'
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

    if (
      input.message.type === 'image' &&
      input.message.text === '[imagen_pendiente_descripcion]'
    ) {
      try {
        if (input.channel !== 'whatsapp' || !input.transport_media_url) {
          throw new Error('UNSUPPORTED_IMAGE_SOURCE')
        }
        const result = await step(
          'analyze-image',
          async () => {
            const analyzed = await analyzeImage.execute({
              input: { media_download_url: input.transport_media_url },
              client,
            })
            if (analyzed.status !== 'ok') {
              throw new Error(`IMAGE_ANALYSIS_${analyzed.reason ?? 'FAILED'}`)
            }
            return analyzed
          },
          { maxAttempts: 1 },
        )
        input.message.text = result.text
        safeLog('studyx.turn.image_described', {
          trace_id: input.trace_id,
          provider: result.provider,
        })
      } catch (error) {
      if (isTurnEvidencePersistenceError(error)) throw error
        input.message.type = 'unsupported'
        input.message.text = '[imagen_no_interpretada]'
        safeLog('studyx.turn.image_description_failed', {
          trace_id: input.trace_id,
          error_code: errorCode(error),
        })
      }
    }

    // ---- Paso 3: persistir ------------------------------------------------
    let ingest: IngestResponse
    const ingestStartedAt = Date.now()
    try {
      ingest = input.preingested ?? await recoverInboundOperation(
        'ingest-canonical-turn',
        () => {
          const occurredAt = Date.parse(input.message.occurred_at)
          // Past this horizon the backend deliberately stops trusting provider
          // occurrence time. Preserve the original event for review instead of
          // retiming an old question after a newer refusal or consent change.
          if (input.channel !== 'emulator'
            && (!Number.isFinite(occurredAt) || Date.now() - occurredAt > 10 * 60_000)) {
            throw new StudyxHttpError('INBOUND_EVENT_REQUIRES_REVIEW', false)
          }
          return ingestTurn.execute({
          input: InboundEnvelopeSchema.parse({ ...input, identity_owner:
            configuration.agentAPlannerlessV2Enabled === true ? 'agent_a_v1' : undefined }),
          client,
          })
        },
      )
      timings.ingest_ms = Date.now() - ingestStartedAt
      state.turnId = ingest.turn_id
      state.batchId = ingest.batch.id
    } catch (error) {
      if (isTurnEvidencePersistenceError(error)) throw error
      // ADK durable suspension is a control object, not a failed request.
      if (!(error instanceof Error)) throw error
      timings.ingest_ms = Date.now() - ingestStartedAt
      state.phase = 'paused_error'
      state.errorCode = errorCode(error)
      safeLog('studyx.turn.ingest_failed', { trace_id: input.trace_id, error_code: state.errorCode })
      emitTimings()
      return finish()
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
        // the first submission happened. This createMessage path has no verified
        // provider idempotency contract.
        state.phase = 'retry_pending'
        state.errorCode = 'OUTBOUND_DELIVERY_UNRESOLVED'
      }
      safeLog('studyx.turn.replayed', {
        trace_id: input.trace_id,
        turn_id: ingest.turn_id,
        processing_state: state.phase,
      })
      emitTimings()
      return finish()
    }

    // Ingest already contains the canonical contact policy. Start presence
    // before the durable batch wait so WhatsApp shows activity during the
    // entire customer-visible wait, without leaking it to blocked contacts.
    if (ingest.policy.may_respond && !ingest.contact.blocked) {
      await startWhatsAppTyping()
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
        outcome = await recoverInboundOperation(
          `claim-inbound-batch-${attempt}`,
          async () => {
            // Read the durable transport source on every actual claim attempt,
            // including recovery after an outage, before canonical context closes.
            await synchronizeConversationInbound({ input, client })
            return claimBatch.execute({
              client,
              input: {
                batch_id: ingest.batch.id,
                trace_id: input.trace_id,
                claimed_by: `botpress:${workflow?.id ?? input.trace_id}`,
              },
            })
          },
        )
        timings.claim_ms += Date.now() - claimStartedAt
      } catch (error) {
      if (isTurnEvidencePersistenceError(error)) throw error
        if (!(error instanceof Error)) throw error
        timings.claim_ms += Date.now() - claimStartedAt
        state.phase = 'paused_error'
        state.errorCode = errorCode(error)
        safeLog('studyx.turn.claim_failed', {
          trace_id: input.trace_id,
          batch_id: ingest.batch.id,
          error_code: state.errorCode,
        })
        emitTimings()
        return finish()
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
      return finish()
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
      return finish()
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
      const lastBatchEventAtMs = Math.max(...batchEventTimes)
      occurredAtMs = Number.isFinite(occurredAtMs)
        ? Math.min(occurredAtMs, firstBatchEventAtMs)
        : firstBatchEventAtMs
      latestInboundAtMs = Number.isFinite(latestInboundAtMs)
        ? Math.max(latestInboundAtMs, lastBatchEventAtMs)
        : lastBatchEventAtMs
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
    const journal = createTurnEvidenceJournal(event => persistTurnEvidence({
      subject_type: 'turn', subject_id: owned.turn_id, trace_id: input.trace_id,
    }, event), state.pendingEvidence ?? [], pending => { state.pendingEvidence = pending })
    evidenceJournal = journal
    if ((state.pendingEvidence?.length ?? 0) > 0) {
      const generatedWithoutReceipt = state.pendingEvidence.some((event: { kind: string }) =>
        ['generation_started', 'model_raw', 'generation_failed'].includes(event.kind))
      try { await journal.flush() } catch {
        state.phase = 'paused_error'; state.errorCode = 'TURN_EVIDENCE_UNAVAILABLE'; return finish()
      }
      if (generatedWithoutReceipt) {
        state.phase = 'paused_error'; state.errorCode = 'TURN_EVIDENCE_RECOVERED_REQUIRES_REVIEW'
        return finish()
      }
    }
    const generateDeepSeekAgentATurnProposalV1: typeof generateDeepSeekUnobserved = args => journal.generate(
      observe => generateDeepSeekUnobserved({ ...args, observe }),
      { rejection: args.context.turn_rejection ?? null, conversation_only: args.conversation_only === true },
    )
    const generateGeminiDecision: typeof generateGeminiUnobserved = args => journal.generate(
      observe => generateGeminiUnobserved({ ...args, observe }), { route: 'legacy_gemini' },
    )
    const generateGroqDecision: typeof generateGroqUnobserved = args => journal.generate(
      observe => generateGroqUnobserved({ ...args, observe }), { route: 'legacy_groq' },
    )
    const commitDecision = { execute: async (args: Parameters<typeof commitDecisionUnobserved.execute>[0]) => {
      const wire = (args as { input: Record<string, unknown> }).input
      journal.capture({ kind: 'commit_proposed', proposal: wire.agent_turn_v2 ?? null,
        fallback_decision: wire.decision, model: wire.model })
      await journal.flush()
      try {
        const receipt = await commitDecisionUnobserved.execute(args)
        journal.capture({ kind: 'commit_receipt', receipt })
        await journal.flush()
        return receipt
      } catch (error) {
        if (isTurnEvidencePersistenceError(error)) throw error
        journal.capture({ kind: 'backend_rejection', code: errorCode(error),
          reason: backendDecisionRejectionReason(error), subjects: backendDecisionRejectionSubjects(error) })
        await journal.flush()
        throw error
      }
    } }
    const observedCreateMessage = async (args: Parameters<typeof client.createMessage>[0]) => {
      const wire = args as { payload: unknown; tags?: unknown; conversationId: string }
      journal.capture({ kind: 'provider_send_attempt', text: wire.payload, tags: wire.tags ?? null,
        conversation_id: wire.conversationId })
      await journal.flush()
      try {
        const receipt = await client.createMessage(args)
        journal.capture({ kind: 'provider_accepted', receipt })
        return receipt
      } catch (error) {
      if (isTurnEvidencePersistenceError(error)) throw error
        journal.capture({ kind: 'provider_send_ambiguous', code: errorCode(error) })
        throw error
      }
    }
    const agentABrainContext = buildAgentAContextV1(
      owned,
      typeof configuration.agentAAdvisorName === 'string' ? configuration.agentAAdvisorName : null,
    )
    const resumedRejection = agentABrainContext ? bindRecoveryFeedbackV1({
      feedback: input.recovery_feedback, batch_id: owned.batch.id,
      conversation_id: owned.batch.conversation_id, turn_id: owned.turn_id, context: agentABrainContext,
    }) : null
    const resumedEffectsAllowed = resumedRejection?.authorized_alternatives.actions
      .some((action) => action !== 'none') === true
    let latestRejection: TurnRejectionV1 | null = resumedRejection
    if (agentABrainContext && resumedRejection) agentABrainContext.turn_rejection = resumedRejection
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
    const precommitModelAuthoredCandidates: GeneratedAgentATurnProposalV1[] = []
    let turnDiagnostics: TurnDiagnosticsV1 | null = null
    let agentAGenerationAttempts: 0 | 1 | 2 | 3 = 0
    let physicalAgentARequests = 0
    let agentAConversationOnly = resumedRejection !== null && !resumedEffectsAllowed
    const accountAgentAProviderRequest = () => {
      if (physicalAgentARequests >= 3) {
        throw new Error('PLANNERLESS_PROPOSAL_REJECTED:ACTION_NOT_AUTHORIZED:generation_budget')
      }
      physicalAgentARequests += 1
      agentAGenerationAttempts = Math.max(agentAGenerationAttempts, physicalAgentARequests) as 1 | 2 | 3
    }
    const accountAgentAPrecommitRepairRequest = () => {
      // Keep the third and final physical request available for the
      // authoritative backend receipt. An internal JSON/schema retry must not
      // consume the only request that can correct a durable business-rule
      // rejection and leave the customer without a reply.
      if (physicalAgentARequests >= 2) {
        safeLog('studyx.turn.agent_a_precommit_repair_budget_reserved', {
          trace_id: input.trace_id,
          turn_id: owned.turn_id,
          physical_agent_a_requests: physicalAgentARequests,
          repair_budget_version: 'backend-reserve-v1',
        })
        throw new Error('PLANNERLESS_PROPOSAL_REJECTED:ACTION_NOT_AUTHORIZED:backend_repair_reserved')
      }
      accountAgentAProviderRequest()
    }
    let agentAContinuationFailure: unknown = null
    let callOfferAudit: {
      readonly call_offer_count_before: 0 | 1 | 2
      readonly call_offer_count_after: 0 | 1 | 2
      readonly offered_call: boolean
      readonly reason: string
      readonly call_accepted: boolean
      readonly call_rejected: boolean
      readonly chat_preference: boolean
    } | null = null
    const brainAuthoritative = owned.features?.agent_a_brain_v1_enabled === true
    const brainShadow = owned.features?.agent_a_brain_v1_shadow === true
    const plannerlessV2Enabled = configuration.agentAPlannerlessV2Enabled === true
    // Plannerless always returns a structured rejection to Agent A once and
    // lets Agent A rewrite its own response. Keeping this behind the legacy
    // rollout flag made a valid DeepSeek turn become MODEL_UNAVAILABLE when
    // the flag was omitted in production. The backend still authorizes facts
    // and effects; it never rewrites the customer's reply.
    const repairEnabled = plannerlessV2Enabled
      || owned.features?.agent_a_repair_enabled === true
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
    const deterministicDirectCallHandoff = deterministicCallHandoff
      && owned.deterministic_route === 'call_direct_request'
    const brainEligible = conversationalBaseEligible
      && (brainAuthoritative || brainShadow)
      && (owned.deterministic_route === null || brainAuthoritative)
      // An explicit direct call request is already fully authorized by the
      // claimed backend snapshot and is revalidated again on commit. Keep it
      // independent from model availability so a provider outage cannot block
      // the requested handoff. Accepted-offer projections still go through
      // Agent A because their surrounding conversational context can be stale.
      && !deterministicDirectCallHandoff
      && !(deterministicCallHandoff && !brainAuthoritative)
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

    if (deterministicDirectCallHandoff
      && owned.conversation_state_v1?.call_preference === 'call'
      && owned.conversation_state_v1.call_offer_status === 'accepted'
      && owned.conversation_state_v1.call_offer_count === 0
      && owned.conversation_state_v1.awaiting_reply === 'call_or_chat'
      && commercialRoute.kind === 'deterministic'
      && commercialRoute.decision.response !== null
      && commercialRoute.decision.business_action?.type === 'request_call_now'
      && commercialRoute.decision.business_action.reason === 'direct_request') {
      // A short availability answer ("sí, dale") is not a standalone direct
      // request. Preserve the model-free fast path, but send its structured
      // move through the backend Agent Turn authority so the persisted
      // accepted direct request is reloaded and proven before call consent is
      // materialized. A bare affirmative outside this state never reaches it.
      agentTurnV2Commit = {
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
          response: { messages: [commercialRoute.decision.response], call_offer: null },
          proposed_action: { type: 'request_call_now', reason: 'direct_request' },
          used_fact_ids: [],
          used_memory_ids: [],
          memory_candidates: [],
          profile_updates: [],
          profile_requests: [],
          repair_of: null,
        },
      }
      pipelineDecisionProvider = 'botpress'
      pipelineDecisionModel = 'deterministic:direct-call-availability-v1'
      pipelinePromptVersion = AGENT_A_PROMPT_VERSION
      turnDiagnostics = {
        schema_version: 1,
        generation_attempts: 0,
        failure_stage: 'none',
        failure_codes: [],
        action_status: 'authorized',
      }
    }

    let profileCapturePhase = 0
    // Data commits independently of prose and business effects. Every parsed
    // generation, including a repair, must pass here before it can be used.
    const persistProfileProposal = async (proposal: AgentATurnProposalV1, rejection?: TurnRejectionV1) => {
      if (!plannerlessV2Enabled || brainShadow || !owned.contact_profile || !agentABrainContext) return
      const updates = proposal.profile_updates ?? []
      if (updates.length > 0 || proposal.confirmed_phone) {
        const expectedVersion = owned.contact_profile.version
        const phase = profileCapturePhase++
        const receipt = ContactProfileReceiptSchema.parse(await step(
          `capture-agent-a-contact-profile-${phase}`,
          () => captureContactProfile.execute({ client, input: {
            trace_id: input.trace_id, turn_id: owned.turn_id, batch_id: owned.batch.id,
            claim_token: owned.batch.claim_token, expected_version: expectedVersion, updates,
            ...(proposal.confirmed_phone ? { confirmed_phone: proposal.confirmed_phone } : {}),
          } }), { maxAttempts: 1 },
        ))
        const currentProfile = receipt.contact_profile_snapshot
        const currentValues = currentProfile?.values ?? receipt.values
        const currentVersion = currentProfile?.version ?? receipt.version
        owned.contact_intake = currentValues
        owned.contact_intake_missing = (['nombre', 'apellido', 'correo', 'telefono'] as const)
          .filter(field => currentValues[field] === null)
        owned.call_intake_readiness = currentProfile?.call_intake_readiness
          ? {
              status: currentProfile.call_intake_readiness.status,
              requirements: currentProfile.call_intake_readiness.requirements,
            }
          : { status: 'unknown', requirements: [] }
        owned.contact.name = currentValues.nombre
          ? [currentValues.nombre, currentValues.apellido].filter(Boolean).join(' ') : null
        owned.contact_profile = { ...owned.contact_profile, version: currentVersion,
          pending_requests: owned.contact_profile.pending_requests.flatMap(request => {
            const fields = request.mode === 'clarify' ? request.fields.filter(field => !receipt.accepted_fields.includes(field))
              : request.fields.filter(field => currentValues[field] === null)
            return fields.length ? [{ ...request, fields }] : []
          }) }
        const refreshed = buildAgentAContextV1(owned,
          typeof configuration.agentAAdvisorName === 'string' ? configuration.agentAAdvisorName : null)
        if (refreshed) Object.assign(agentABrainContext, refreshed)
        safeLog('studyx.turn.contact_profile_persisted', { trace_id: input.trace_id,
          turn_id: owned.turn_id, version: currentVersion, accepted_fields: receipt.accepted_fields,
          rejection_codes: receipt.rejections.map(item => item.code) })
        // A profile receipt is deliberately field-granular. Accepted
        // observations are already durable and rejected observations remain
        // unconfirmed facts in the refreshed context. They must not invalidate
        // Agent A's safe prose or an independently authorized effect. The
        // action resolver below still gates calls and payments against the
        // refreshed canonical intake, so an invalid missing field cannot open
        // an effect by being ignored here.
      }
      const repeated = (proposal.profile_requests ?? []).flatMap(request => {
        const eligible = eligibleContactRequestFieldsV1({ values: owned.contact_intake,
          mode: request.mode, rejection,
          collectable_confirmed_fields: request.purpose === 'call'
            ? (agentABrainContext.capabilities.call_contact_requirements ?? [])
              .filter(({ reason }) => reason === 'written_whatsapp_confirmation_required')
              .map(({ field }) => field)
            : [] })
        return request.fields.filter(field => !eligible.includes(field))
      })
      if (repeated.length) {
        // La ficha canónica ya impide que esta pregunta altere datos o abra
        // efectos. Bloquear además la prosa dejaba al cliente en silencio por
        // una imperfección conversacional que Agent A debe poder corregir en
        // el turno siguiente.
        safeLog('studyx.turn.contact_profile_request_redundant', {
          trace_id: input.trace_id,
          turn_id: owned.turn_id,
          fields: [...new Set(repeated)],
        })
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
            ...(resumedRejection ? { conversation_only: agentAConversationOnly } : {}),
            on_provider_request: accountAgentAProviderRequest,
            apiKey: deepSeekApiKey,
            signal,
            model: typeof configuration.agentABrainDeepSeekModel === 'string'
              ? configuration.agentABrainDeepSeekModel
              : DEFAULT_AGENT_A_BRAIN_DEEPSEEK_MODEL,
          })
        const brainStartedAt = Date.now()
        let generationAttempt = 0
        let firstRetryCode: string | null = null
        const generatedAttempt = await runAgentADeepSeekAttemptV1({
          generate: async () => {
            generationAttempt += 1
            agentAGenerationAttempts = generationAttempt as 1 | 2
            return step(
              generationAttempt === 1
                ? 'generate-agent-a-turn-proposal-v1-deepseek'
                : 'retry-agent-a-turn-proposal-v1-deepseek',
              generateDeepSeekProposal,
              { maxAttempts: 1 },
            )
          },
          onRetry: (failure) => {
            firstRetryCode = failure.code
            safeLog('studyx.turn.agent_a_brain_retry', {
              trace_id: input.trace_id,
              turn_id: owned.turn_id,
              failure_code: failure.code,
              attempt: 2,
            })
          },
        })
        // A durable step may replay without invoking today's callback. Its
        // envelope still accounts for provider requests made before the crash.
        physicalAgentARequests = Math.max(physicalAgentARequests,
          generatedAttempt.attempts, generatedAttempt.value.attempt_count ?? 1)
        agentAGenerationAttempts = physicalAgentARequests as 1 | 2 | 3
        turnDiagnostics = {
          schema_version: 1,
          generation_attempts: agentAGenerationAttempts,
          failure_stage: firstRetryCode === null ? 'none' : 'provider_generation',
          failure_codes: firstRetryCode === null ? [] : [firstRetryCode],
          action_status: 'none',
        }
        let generated = generatedAttempt.value
        precommitModelAuthoredCandidates.push(generated)
        await persistProfileProposal(generated.proposal)
        timings.agent_a_brain_ms = Date.now() - brainStartedAt
        safeLog('studyx.turn.agent_a_brain_generation', {
          trace_id: input.trace_id,
          turn_id: owned.turn_id,
          agent_a_generation_attempts: generatedAttempt.attempts,
          first_retry_code: firstRetryCode,
        })

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
          const authoritativeMove = plannerlessV2Enabled
            ? generated.proposal.move
            : bindCurrentConversationalIntentToMoveV1(
                bindCurrentCatalogResolutionToMoveV1(generated.proposal.move, owned),
                owned,
              )
          if (plannerlessV2Enabled) {
            timings.planner_ms = 0
            const authoritativeGenerated = {
              ...generated,
              proposal: { ...generated.proposal, move: authoritativeMove },
            }
            const resolved = await resolveAgentAPlannerlessProposalV2({
              observe: journal.capture,
              initial: authoritativeGenerated,
              context: agentABrainContext,
              repair_enabled: repairEnabled,
              semantic_rejections: 'advisory',
              rejection_id: randomUUID(),
              repair: async (rejection) => {
                if (agentAGenerationAttempts >= 3) {
                  throw new Error('PLANNERLESS_PROPOSAL_REJECTED:ACTION_NOT_AUTHORIZED:generation_budget')
                }
                const repairEffectsAllowed = rejection.authorized_alternatives.actions
                  .some((action) => action !== 'none')
                agentAConversationOnly = !repairEffectsAllowed
                agentAGenerationAttempts = Math.max(agentAGenerationAttempts, 2) as 2 | 3
                if (typeof secrets.DEEPSEEK_API_KEY !== 'string'
                  || secrets.DEEPSEEK_API_KEY.length === 0) {
                  throw new Error('DEEPSEEK_API_KEY_MISSING')
                }
                try {
                const repaired = await step(
                  'repair-agent-a-turn-proposal-v2',
                  () => continueAgentAAfterActionFeedbackV1({
                    context: agentABrainContext,
                    on_provider_request: accountAgentAPrecommitRepairRequest,
                    rejection,
                    effects_allowed: repairEffectsAllowed,
                    apiKey: secrets.DEEPSEEK_API_KEY as string,
                    signal,
                    generate: generateDeepSeekAgentATurnProposalV1,
                    model: typeof configuration.agentABrainDeepSeekModel === 'string'
                      ? configuration.agentABrainDeepSeekModel
                      : DEFAULT_AGENT_A_BRAIN_DEEPSEEK_MODEL,
                  }),
                  { maxAttempts: 1 },
                )
                precommitModelAuthoredCandidates.push(repaired)
                await persistProfileProposal(repaired.proposal, rejection)
                return repaired
                } catch (continuationError) {
      if (isTurnEvidencePersistenceError(continuationError)) throw continuationError
                  agentAContinuationFailure = continuationError
                  throw continuationError
                }
              },
            })
            journal.capture({ kind: 'proposal_resolution', rejection: resolved.rejection, action_rejection: resolved.action_rejection, evidence: resolved.evidence })
            await journal.flush()
            let effectiveGenerated = resolved.effective
            if (resolved.action_rejection !== null) agentAConversationOnly = true
            if (resolved.action_rejection !== null && resolved.rejection !== null
              && !resolved.evidence.repair_attempted && agentAGenerationAttempts < 3) {
              agentAConversationOnly = true
              agentAGenerationAttempts = Math.max(agentAGenerationAttempts, 2) as 2 | 3
              try {
              effectiveGenerated = await step('continue-agent-a-after-authorization-result-v2',
                () => continueAgentAAfterActionFeedbackV1({
                  context: agentABrainContext, rejection: resolved.rejection!,
                  on_provider_request: accountAgentAPrecommitRepairRequest,
                  apiKey: secrets.DEEPSEEK_API_KEY as string, signal,
                  generate: generateDeepSeekAgentATurnProposalV1,
                  model: typeof configuration.agentABrainDeepSeekModel === 'string'
                    ? configuration.agentABrainDeepSeekModel : DEFAULT_AGENT_A_BRAIN_DEEPSEEK_MODEL,
                }), { maxAttempts: 1 })
              precommitModelAuthoredCandidates.push(effectiveGenerated)
              await persistProfileProposal(effectiveGenerated.proposal, resolved.rejection!)
              turnDiagnostics = {
                schema_version: 1, generation_attempts: agentAGenerationAttempts,
                failure_stage: 'action_authorization',
                failure_codes: resolved.action_rejection.codes.slice(0, 8), action_status: 'needs_input',
              }
              } catch (continuationError) {
      if (isTurnEvidencePersistenceError(continuationError)) throw continuationError
                if (!(continuationError instanceof Error)) throw continuationError
                // The first draft has already passed the resolver. Preserve
                // that safe Agent A reply if a better continuation fails.
                // The wrapper below fences every effect while preserving its
                // semantic state at the authoritative backend boundary.
                effectiveGenerated = resolved.effective
                safeLog('studyx.turn.agent_a_safe_reply_retained', {
                  trace_id: input.trace_id, turn_id: owned.turn_id,
                  error_code: errorCode(continuationError),
                })
              }
            }
            if (agentAConversationOnly) effectiveGenerated = {
              ...effectiveGenerated,
              proposal: { ...effectiveGenerated.proposal, proposed_action: { type: 'none' } },
            }
            generated = effectiveGenerated
            if (resolved.evidence.repair_attempted) {
              turnDiagnostics = {
                schema_version: 1,
                generation_attempts: agentAGenerationAttempts,
                failure_stage: 'proposal_validation',
                failure_codes: [...new Set([
                  ...(turnDiagnostics?.failure_codes ?? []),
                  ...resolved.evidence.rejection_codes,
                ])].filter((code) => /^[A-Z0-9_:.-]+$/u.test(code)).slice(0, 8),
                action_status: effectiveGenerated.proposal.proposed_action.type === 'none'
                  ? 'none' : 'authorized',
              }
            }
            turnDiagnostics = resolved.action_rejection === null
              ? {
                  ...(turnDiagnostics ?? {
                    schema_version: 1 as const,
                    generation_attempts: agentAGenerationAttempts,
                    failure_stage: 'none' as const,
                    failure_codes: [],
                  }),
                  action_status: effectiveGenerated.proposal.proposed_action.type === 'none'
                    ? 'none'
                    : 'authorized',
                }
              : {
                  schema_version: 1,
                  generation_attempts: agentAGenerationAttempts,
                  failure_stage: 'action_authorization',
                  failure_codes: resolved.action_rejection.codes
                    .filter((code) => /^[A-Z0-9_:.-]+$/u.test(code))
                    .slice(0, 8),
                  action_status: 'needs_input',
                }
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
              ...(agentAConversationOnly ? fencedAgentARequestV1() : {}),
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
      if (isTurnEvidencePersistenceError(plannerError)) throw plannerError
              if (!(plannerError instanceof Error)) throw plannerError
              timings.planner_ms = Date.now() - plannerStartedAt
              const plannerFailureCode = errorCode(plannerError).split(':', 1)[0]!
              turnDiagnostics = {
                schema_version: 1,
                generation_attempts: agentAGenerationAttempts,
                failure_stage: 'proposal_validation',
                failure_codes: /^[A-Z0-9_.-]+$/u.test(plannerFailureCode)
                  ? [plannerFailureCode]
                  : ['UNKNOWN_ERROR'],
                action_status: 'rejected',
              }
            pipelineFailureDecision = suppress('AGENT_A_CONTINUATION_REJECTED')
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
                      on_provider_request: accountAgentAProviderRequest,
                      apiKey: secrets.DEEPSEEK_API_KEY as string,
                      signal,
                      model: typeof configuration.agentABrainDeepSeekModel === 'string'
                        ? configuration.agentABrainDeepSeekModel
                        : DEFAULT_AGENT_A_BRAIN_DEEPSEEK_MODEL,
                    }),
                    { maxAttempts: 1 },
                  )
                } catch (repairError) {
      if (isTurnEvidencePersistenceError(repairError)) throw repairError
                  if (!(repairError instanceof Error)) throw repairError
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
      if (!(error instanceof Error)) throw error
        if (isTurnEvidencePersistenceError(error)) {
          state.phase = 'paused_error'; state.errorCode = 'TURN_EVIDENCE_UNAVAILABLE'; return finish()
        }
        const effectiveFailure = agentAContinuationFailure ?? error
        const failureCode = errorCode(effectiveFailure)
        const attemptFailure = classifyAgentAAttemptFailure(effectiveFailure)
        turnDiagnostics = {
          schema_version: 1,
          generation_attempts: agentAGenerationAttempts,
          failure_stage: attemptFailure.stage === 'provider_transport'
            || attemptFailure.stage === 'provider_rejected'
            || attemptFailure.stage === 'schema'
            ? 'provider_generation'
            : 'proposal_validation',
          failure_codes: attemptFailureDiagnosticCodes(attemptFailure),
          action_status: attemptFailure.stage === 'policy' ? 'rejected' : 'none',
        }
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
        // A rejected operation is structured input for A, not a channel outage.
        // The remaining bounded generation is conversation-only: Agent A keeps
        // the semantic move, while the physical effect stays explicitly fenced.
        if (brainAuthoritative) {
          if (!isAgentAProviderFailure(attemptFailure)) {
            // A policy/schema rejection is not a provider outage. If Agent A's
            // bounded corrections are also invalid, persist the exact
            // diagnostic without inventing a customer-facing backend reply.
            pipelineFailureDecision = suppress('AGENT_A_CONTINUATION_REJECTED')
            if (agentAGenerationAttempts < 3 && typeof secrets.DEEPSEEK_API_KEY === 'string') {
              agentAGenerationAttempts = 3
              try {
                const profileRejection = plannerlessActionFeedbackV1({ failure_code: failureCode,
                  context: agentABrainContext, rejection_id: randomUUID() })
                latestRejection = profileRejection
                const profileEffectsAllowed = profileRejection.authorized_alternatives.actions
                  .some((action) => action !== 'none')
                const continuation = await step('continue-agent-a-after-action-feedback-v1',
                  () => continueAgentAAfterActionFeedbackV1({
                    context: agentABrainContext,
                    on_provider_request: accountAgentAProviderRequest,
                    rejection: profileRejection,
                    effects_allowed: profileEffectsAllowed,
                    apiKey: secrets.DEEPSEEK_API_KEY as string, signal,
                    generate: generateDeepSeekAgentATurnProposalV1,
                    model: typeof configuration.agentABrainDeepSeekModel === 'string'
                      ? configuration.agentABrainDeepSeekModel : DEFAULT_AGENT_A_BRAIN_DEEPSEEK_MODEL,
                  }), { maxAttempts: 1 })
                precommitModelAuthoredCandidates.push(continuation)
                await persistProfileProposal(continuation.proposal, profileRejection)
                agentTurnV2Commit = {
                  schema_version: 2,
                  proposal: continuation.proposal,
                  ...(!profileEffectsAllowed ? fencedAgentARequestV1() : {}),
                }
                pipelineMemoryCandidates = continuation.proposal.memory_candidates
                pipelineDecisionProvider = continuation.provider
                pipelineDecisionModel = continuation.model
                pipelinePromptVersion = AGENT_A_BRAIN_PROMPT_VERSION
                pipelineFailureDecision = null
                turnDiagnostics = { ...turnDiagnostics,
                  generation_attempts: agentAGenerationAttempts,
                  action_status: continuation.proposal.proposed_action.type === 'none'
                    ? 'none'
                    : 'authorized',
                }
              } catch (continuationError) {
      if (isTurnEvidencePersistenceError(continuationError)) throw continuationError
                if (!(continuationError instanceof Error)) throw continuationError
                const continuationFailure = classifyAgentAAttemptFailure(continuationError)
                turnDiagnostics = { ...turnDiagnostics,
                  generation_attempts: agentAGenerationAttempts,
                  failure_codes: [...new Set([...turnDiagnostics.failure_codes,
                    ...attemptFailureDiagnosticCodes(continuationFailure)])].slice(0, 8) }
                if (isAgentAProviderFailure(continuationFailure)) {
                  pipelineFailureDecision = suppress('AGENT_A_CONTINUATION_REJECTED')
                }
              }
            }
            if (pipelineFailureDecision?.reason_code === 'AGENT_A_CONTINUATION_REJECTED') {
              candidateLoop: for (const candidate of [...precommitModelAuthoredCandidates].reverse()) {
                for (const candidateProposal of literalConversationVariants(candidate.proposal)) {
                  const candidateCopy = [
                    ...candidateProposal.response.messages,
                    candidateProposal.response.call_offer ?? '',
                  ]
                  if (mentionsProposedBonusOfferingV1({
                    proposal: candidateProposal,
                    messages: candidateCopy,
                    context: agentABrainContext,
                  })) continue
                  try {
                    const conversationCandidate = {
                      ...candidate,
                      proposal: {
                        ...candidateProposal,
                        proposed_action: { type: 'none' as const },
                      },
                    }
                    const revalidated = await resolveAgentAPlannerlessProposalV2({
              observe: journal.capture,
                      initial: conversationCandidate,
                      context: agentABrainContext,
                      repair_enabled: false,
                      semantic_rejections: 'blocking',
                      rejection_id: randomUUID(),
                      repair: async () => {
                        throw new Error('AGENT_A_PRECOMMIT_FLOOR_REPAIR_NOT_ALLOWED')
                      },
                    })
                    agentTurnV2Commit = {
                      schema_version: 2,
                      proposal: revalidated.effective.proposal,
                      ...fencedAgentARequestV1(),
                    }
                    pipelineCommit = null
                    pipelineMemoryCandidates = revalidated.effective.proposal.memory_candidates
                    pipelineDecisionProvider = revalidated.effective.provider
                    pipelineDecisionModel = revalidated.effective.model
                    pipelinePromptVersion = AGENT_A_BRAIN_PROMPT_VERSION
                    pipelineFailureDecision = null
                    turnDiagnostics = { ...turnDiagnostics, action_status: 'none' }
                    safeLog('studyx.turn.agent_a_precommit_conversational_floor', {
                      trace_id: input.trace_id,
                      turn_id: owned.turn_id,
                    })
                    break candidateLoop
                  } catch (floorError) {
      if (isTurnEvidencePersistenceError(floorError)) throw floorError
                    if (!(floorError instanceof Error)) throw floorError
                    safeLog('studyx.turn.agent_a_precommit_conversational_floor_invalid', {
                      trace_id: input.trace_id,
                      turn_id: owned.turn_id,
                      failure_code: errorCode(floorError),
                    })
                  }
                }
              }
            }
            if (pipelineFailureDecision?.reason_code === 'AGENT_A_CONTINUATION_REJECTED') {
              pipelineFailureDecision = technicalContinuityFallback(owned)
              safeLog('studyx.turn.agent_a_precommit_technical_continuity', {
                trace_id: input.trace_id,
                turn_id: owned.turn_id,
                failure_codes: turnDiagnostics.failure_codes,
              })
            }
          } else {
            pipelineFailureDecision = technicalContinuityFallback(owned)
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
    // Agent A plannerless is the sole conversational authority once it has
    // produced a commit. A stale deterministic call projection must not add a
    // second V1 authority: the backend correctly rejects that ambiguous turn,
    // which would otherwise leave the customer without an outbound response.
    if (!agentTurnV2Commit && !pipelineCommit && !pipelineFailureDecision
      && (deterministicPipelineMove || interpreterInput)) {
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
              journal.capture({ kind: 'sdk_exit_observed', route: 'managed_composer', raw_provider_text_available: false, output: generated.output })
              return generated.output
            },
          }),
          { maxAttempts: 1 },
        )
        await journal.flush()
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
        if (isTurnEvidencePersistenceError(error)) {
          state.phase = 'paused_error'; state.errorCode = 'TURN_EVIDENCE_UNAVAILABLE'; return finish()
        }
        if (!(error instanceof Error)) throw error
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
        pipelineFailureDecision = technicalFallback(
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
      decisionModel = 'policy:conversation-pipeline-v1-unavailable'
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
              journal.capture({ kind: 'sdk_exit_observed', route: 'managed_decision', raw_provider_text_available: false, output: generated.output })
              await journal.flush()
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
        if (isTurnEvidencePersistenceError(error)) {
          state.phase = 'paused_error'; state.errorCode = 'TURN_EVIDENCE_UNAVAILABLE'; return finish()
        }
        if (!(error instanceof Error)) throw error
        timings.model_ms = Date.now() - modelStartedAt
        safeLog('studyx.turn.model_failed', {
          trace_id: input.trace_id,
          turn_id: owned.turn_id,
          error_code: errorCode(error),
        })
        decision = owned.policy.allowed_response_types.includes('commercial_reply')
          || owned.policy.allowed_response_types.includes('technical_fallback')
          ? customerVisibleModelFallback(owned)
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

    // A failed Agent A turn remains unfinished work. The backend never turns
    // that failure into customer copy: it releases the owned batch and starts
    // a fresh, bounded workflow with current facts. Delays are 2s/10s, not the
    // old five-minute operator pause, and every replay is fenced by the batch
    // claim token so it cannot duplicate a send or an effect.
    const recoverRejectedTurn = async (): Promise<WorkflowResult> => {
      try {
        const recoveryCause = turnDiagnostics?.failure_codes.find(
          (code) => /^[A-Z0-9_]{1,128}$/u.test(code),
        ) ?? 'AGENT_A_CONTINUATION_REJECTED'
        const recovery = await step('schedule-rejected-turn-recovery-v1', () =>
          scheduleTurnRecovery.execute({ client, input: {
            batch_id: owned.batch.id,
            claim_token: owned.batch.claim_token,
            trace_id: input.trace_id,
            reason_code: recoveryCause,
          } }), { maxAttempts: 3 })
        state.errorCode = recovery.outcome === 'exhausted'
          ? 'AGENT_A_RECOVERY_EXHAUSTED'
          : 'AGENT_A_CONTINUATION_REJECTED'
        state.phase = recovery.outcome === 'scheduled'
          ? 'retry_pending'
          : recovery.outcome === 'exhausted'
            ? 'paused_error'
            : 'absorbed'
        safeLog('studyx.turn.recovery', {
          trace_id: input.trace_id,
          turn_id: owned.turn_id,
          batch_id: owned.batch.id,
          outcome: recovery.outcome,
          attempt: recovery.attempt,
        })
        if (recovery.outcome === 'scheduled') {
          await step.sleep(`rejected-turn-recovery-wait-${recovery.attempt}`, recovery.delay_ms)
          await step('start-rejected-turn-recovery-v1', () => processInboundTurn.getOrCreate({
            key: `recovery:${owned.batch.id}:${recovery.attempt}`,
            input: {
              ...input,
              preingested: null,
              transport_media_url: undefined,
              recovery_feedback: latestRejection && agentABrainContext ? {
                batch_id: owned.batch.id,
                conversation_id: owned.batch.conversation_id,
                turn_id: owned.turn_id,
                selected_offering_code: agentABrainContext.commercial_state.selected_offering_code,
                rejection: {
                  ...latestRejection,
                  authorized_alternatives: {
                    fact_ids: [],
                    actions: ['none'],
                    missing_information: [],
                  },
                },
              } : undefined,
            },
          }), { maxAttempts: 3 })
        }
      } catch (error) {
      if (isTurnEvidencePersistenceError(error)) throw error
        if (!(error instanceof Error)) throw error
        state.phase = 'paused_error'
        state.errorCode = errorCode(error)
        safeLog('studyx.turn.recovery_schedule_failed', {
          trace_id: input.trace_id,
          turn_id: owned.turn_id,
          error_code: state.errorCode,
        })
      }
      emitTimings()
      return finish()
    }
    if (decision.reason_code === 'AGENT_A_CONTINUATION_REJECTED') {
      return recoverRejectedTurn()
    }

    // ---- Paso 10: commitear en Next.js -----------------------------------
    let committed: CommitDecisionResponse | null = null
    const commitStartedAt = Date.now()
    const commitCurrentDecision = (stepName: string) => commitDecisionWithRejectionReceiptV1({
      name: stepName, step,
      commit: () => commitDecision.execute({
          client,
          input: {
            turn_id: owned.turn_id,
            trace_id: input.trace_id,
            // Canonical course identity resolved by the deterministic route
            // or preserved from the claim; the backend re-resolves it before
            // authorizing any protected fact.
            authorized_offering_code: authorizedOfferingCode,
            // Plannerless is the complete conversational authority. A legacy
            // payment token must not compete with its current-turn decision.
            authorized_payment_plan: agentTurnV2Commit === null
              ? authorizedPaymentPlan
              : null,
            conversation_pipeline_v1: pipelineCommit,
            agent_turn_v2: agentTurnV2Commit,
            supports_multi_outbound: true,
            supports_send_fencing: true,
            supports_turn_supersession: true,
            turn_diagnostics: turnDiagnostics,
            decision,
            model: {
              provider: decisionProvider,
              model: decisionModel,
              prompt_version: pipelineCommit || agentTurnV2Commit || pipelineFailureDecision?.reason_code.startsWith('BRAIN_')
                ? pipelinePromptVersion
                : AGENT_A_PROMPT_VERSION,
            },
            batch_id: owned.batch.id,
            claim_token: owned.batch.claim_token,
          },
        }),
    })
    try {
      try {
        committed = await commitCurrentDecision('commit-canonical-decision')
      } catch (initialCommitError) {
      if (isTurnEvidencePersistenceError(initialCommitError)) throw initialCommitError
        if (!(initialCommitError instanceof Error)) throw initialCommitError
      const rejectedProposal = agentTurnV2Commit?.proposal ?? null
      const repairContext = agentABrainContext
      const rejection = rejectedProposal !== null && repairContext !== null
        ? backendCommitTurnRejectionV1({
            error: initialCommitError,
            proposal: rejectedProposal,
            context: repairContext,
            rejectionId: randomUUID(),
          })
        : null

      journal.capture({ kind: 'backend_turn_rejection', rejection, code: errorCode(initialCommitError) })
      await journal.flush()

      if (rejection === null || rejectedProposal === null || repairContext === null) {
        throw initialCommitError
      }

      safeLog('studyx.turn.backend_commit_rejected_recoverably', {
        trace_id: input.trace_id,
        turn_id: owned.turn_id,
        rejection_id: rejection.rejection_id,
        rejection_codes: rejection.rejections.map((item) => item.code),
        rejection_subjects: rejection.rejections.map((item) => item.subject),
      })
        latestRejection = rejection
        let currentBackendRejection = rejection
        // Keep only proposals that already crossed the local authority
        // boundary. If their business effect becomes stale at commit time,
        // one of these can still provide Agent A's own conversational reply
        // after the effect is removed and the complete proposal is validated
        // again. Backend-authored deterministic copy is deliberately excluded.
        const modelAuthoredCommitCandidates: Array<{
          readonly proposal: AgentATurnProposalV1
          readonly provider: typeof decisionProvider
          readonly model: string
        }> = decisionProvider === 'botpress' ? [] : [{
          proposal: rejectedProposal,
          provider: decisionProvider,
          model: decisionModel,
        }]
        let rejectionCodes = [...new Set(
          rejection.rejections.map((item) => item.code),
        )].slice(0, 8)
        const rejectedEffectRemainsAuthorized = (
          proposal: AgentATurnProposalV1,
          receipt: typeof currentBackendRejection,
        ): boolean => proposal.proposed_action.type !== 'none'
          && receipt.authorized_alternatives.actions.includes(proposal.proposed_action.type)
        let repairEffectsAllowed = currentBackendRejection.authorized_alternatives.actions
          .some((action) => action !== 'none')
        const deepSeekApiKey = secrets.DEEPSEEK_API_KEY
        // A second backend rejection does not authorize the backend to write
        // a canned customer reply. Give the conversational owner one final,
        // effect-fenced correction with the exact rejection receipt.
        const mayRepairWithAgentA = plannerlessV2Enabled
          && repairEnabled
          && agentAGenerationAttempts < 3
          && typeof deepSeekApiKey === 'string'
          && deepSeekApiKey.length > 0
        safeLog('studyx.turn.agent_a_backend_repair_budget', {
          trace_id: input.trace_id,
          turn_id: owned.turn_id,
          physical_agent_a_requests: physicalAgentARequests,
          generation_attempts: agentAGenerationAttempts,
          may_repair: mayRepairWithAgentA,
          effects_allowed: repairEffectsAllowed,
          repair_budget_version: 'backend-reserve-v1',
        })
        let continuationFailure: ReturnType<typeof classifyAgentAAttemptFailure> | null = null

        if (mayRepairWithAgentA) {
          agentAGenerationAttempts = Math.max(agentAGenerationAttempts, 2) as 2 | 3
          try {
            const repaired = await step(
              'repair-agent-a-turn-after-backend-rejection-v1',
              () => continueAgentAAfterActionFeedbackV1({
                context: repairContext,
                on_provider_request: accountAgentAProviderRequest,
                rejection: currentBackendRejection,
                effects_allowed: repairEffectsAllowed,
                apiKey: deepSeekApiKey,
                signal,
                generate: generateDeepSeekAgentATurnProposalV1,
                model: typeof configuration.agentABrainDeepSeekModel === 'string'
                  ? configuration.agentABrainDeepSeekModel
                  : DEFAULT_AGENT_A_BRAIN_DEEPSEEK_MODEL,
              }),
              { maxAttempts: 1 },
            )
            await persistProfileProposal(repaired.proposal, currentBackendRejection)
            const resolvedRepair = await resolveAgentAPlannerlessProposalV2({
              observe: journal.capture,
              initial: repaired,
              context: repairContext,
              repair_enabled: false,
              semantic_rejections: 'blocking',
              rejection_id: currentBackendRejection.rejection_id,
              repair: async () => {
                throw new Error('AGENT_A_SECOND_REPAIR_NOT_ALLOWED')
              },
            })
            const effectiveRepair = resolvedRepair.effective
            modelAuthoredCommitCandidates.push({
              proposal: effectiveRepair.proposal,
              provider: effectiveRepair.provider,
              model: effectiveRepair.model,
            })
            agentTurnV2Commit = {
              schema_version: 2,
              proposal: effectiveRepair.proposal,
              ...(repairEffectsAllowed ? {} : fencedAgentARequestV1()),
            }
            pipelineCommit = null
            pipelineMemoryCandidates = effectiveRepair.proposal.memory_candidates
            decision = pipelinePlaceholder(pipelineMemoryCandidates)
            decisionProvider = effectiveRepair.provider
            decisionModel = effectiveRepair.model
            pipelinePromptVersion = AGENT_A_BRAIN_PROMPT_VERSION
            turnDiagnostics = {
              schema_version: 1,
              generation_attempts: agentAGenerationAttempts,
              failure_stage: 'backend_commit',
              failure_codes: rejectionCodes,
              action_status: effectiveRepair.proposal.proposed_action.type === 'none'
                ? 'none'
                : 'authorized',
            }
            committed = await commitCurrentDecision('commit-agent-a-repair-after-backend-rejection-v1')
            safeLog('studyx.turn.backend_commit_repaired_by_agent_a', {
              trace_id: input.trace_id,
              turn_id: owned.turn_id,
              rejection_id: currentBackendRejection.rejection_id,
              rejection_codes: rejectionCodes,
              repaired_action_type: effectiveRepair.proposal.proposed_action.type,
            })
          } catch (repairError) {
      if (isTurnEvidencePersistenceError(repairError)) throw repairError
            if (!(repairError instanceof Error)) throw repairError
            continuationFailure = classifyAgentAAttemptFailure(repairError)
            if (continuationFailure.stage === 'backend_rejected' && agentTurnV2Commit !== null) {
              const renewedRejection = backendCommitTurnRejectionV1({
                error: repairError,
                proposal: agentTurnV2Commit.proposal,
                context: repairContext,
                rejectionId: randomUUID(),
              })
              if (renewedRejection !== null) {
                currentBackendRejection = renewedRejection
                latestRejection = renewedRejection
                rejectionCodes = [...new Set(
                  renewedRejection.rejections.map((item) => item.code),
                )].slice(0, 8)
                repairEffectsAllowed = renewedRejection.authorized_alternatives.actions
                  .some((action) => action !== 'none')
              }
            }
            safeLog('studyx.turn.backend_commit_agent_a_repair_failed', {
              trace_id: input.trace_id,
              turn_id: owned.turn_id,
              rejection_id: currentBackendRejection.rejection_id,
              error_code: errorCode(repairError),
            })
          }
        }

        if (committed === null
          && continuationFailure?.stage === 'backend_rejected'
          && agentAGenerationAttempts < 3
          && typeof deepSeekApiKey === 'string'
          && deepSeekApiKey.length > 0) {
          agentAGenerationAttempts = 3
          try {
            const finalContinuation = await step(
              'final-agent-a-turn-after-backend-rejection-v1',
              () => continueAgentAAfterActionFeedbackV1({
                context: repairContext,
                on_provider_request: accountAgentAProviderRequest,
                rejection: currentBackendRejection,
                effects_allowed: repairEffectsAllowed,
                apiKey: deepSeekApiKey,
                signal,
                generate: generateDeepSeekAgentATurnProposalV1,
                model: typeof configuration.agentABrainDeepSeekModel === 'string'
                  ? configuration.agentABrainDeepSeekModel
                  : DEFAULT_AGENT_A_BRAIN_DEEPSEEK_MODEL,
              }),
              { maxAttempts: 1 },
            )
            await persistProfileProposal(finalContinuation.proposal, currentBackendRejection)
            modelAuthoredCommitCandidates.push({
              proposal: finalContinuation.proposal,
              provider: finalContinuation.provider,
              model: finalContinuation.model,
            })
            agentTurnV2Commit = {
              schema_version: 2,
              proposal: finalContinuation.proposal,
              ...(repairEffectsAllowed ? {} : fencedAgentARequestV1()),
            }
            pipelineCommit = null
            pipelineMemoryCandidates = finalContinuation.proposal.memory_candidates
            decision = pipelinePlaceholder(pipelineMemoryCandidates)
            decisionProvider = finalContinuation.provider
            decisionModel = finalContinuation.model
            pipelinePromptVersion = AGENT_A_BRAIN_PROMPT_VERSION
            turnDiagnostics = {
              schema_version: 1,
              generation_attempts: 3,
              failure_stage: 'backend_commit',
              failure_codes: rejectionCodes,
              action_status: finalContinuation.proposal.proposed_action.type === 'none'
                ? 'none'
                : 'authorized',
            }
            committed = await commitCurrentDecision('commit-final-agent-a-continuation-v1')
            continuationFailure = null
            safeLog('studyx.turn.backend_commit_final_agent_a_continuation', {
              trace_id: input.trace_id,
              turn_id: owned.turn_id,
              rejection_id: currentBackendRejection.rejection_id,
              rejection_codes: rejectionCodes,
            })
          } catch (finalError) {
      if (isTurnEvidencePersistenceError(finalError)) throw finalError
            if (!(finalError instanceof Error)) throw finalError
            continuationFailure = classifyAgentAAttemptFailure(finalError)
            if (continuationFailure.stage === 'backend_rejected' && agentTurnV2Commit !== null) {
              const renewedRejection = backendCommitTurnRejectionV1({
                error: finalError,
                proposal: agentTurnV2Commit.proposal,
                context: repairContext,
                rejectionId: randomUUID(),
              })
              if (renewedRejection !== null) {
                currentBackendRejection = renewedRejection
                latestRejection = renewedRejection
                rejectionCodes = [...new Set(
                  renewedRejection.rejections.map((item) => item.code),
                )].slice(0, 8)
                repairEffectsAllowed = renewedRejection.authorized_alternatives.actions
                  .some((action) => action !== 'none')
              }
            }
            safeLog('studyx.turn.backend_commit_final_agent_a_failed', {
              trace_id: input.trace_id,
              turn_id: owned.turn_id,
              rejection_id: currentBackendRejection.rejection_id,
              error_code: errorCode(finalError),
            })
          }
        }

        if (committed === null) {
          // A rejected effect must not erase independently safe conversation.
          // Try the newest model-authored candidate first, retain an effect
          // only when the latest authoritative receipt explicitly allows it,
          // and re-run the complete local fact/effect boundary. If a candidate
          // mixes safe prose with a rejected operational claim, exact leading
          // substantive sentences are tried without
          // rewriting any model text. Claims such as "te llamo" or "ya envié
          // el link" therefore cannot survive after their effect is removed.
          let floorCandidateIndex = 0
          candidateLoop: for (const candidate of [...modelAuthoredCommitCandidates].reverse()) {
            for (const candidateProposal of literalConversationVariants(candidate.proposal)) {
              const candidateIndex = floorCandidateIndex
              floorCandidateIndex += 1
              const candidateAction = candidateProposal.proposed_action.type
              const retainAuthorizedEffect = rejectedEffectRemainsAuthorized(
                candidateProposal,
                currentBackendRejection,
              )
              const rejectedCallEffect = currentBackendRejection.rejections.some((reason) => (
                reason.subject === 'request_call_now' || reason.subject.startsWith('call')
              ))
              const rejectedPaymentEffect = currentBackendRejection.rejections.some((reason) => (
                reason.subject === 'send_payment_link' || reason.subject.startsWith('payment')
              ))
              const candidateCopy = [
                ...candidateProposal.response.messages,
                candidateProposal.response.call_offer ?? '',
              ]
              const repeatsRejectedBonus = !retainAuthorizedEffect
                && mentionsProposedBonusOfferingV1({
                  proposal: candidateProposal,
                  messages: candidateCopy,
                  context: repairContext,
                })
              // The claim snapshot may still advertise a capability that the
              // authoritative commit has just rejected. In that case a floor
              // candidate cannot keep customer-facing success wording after
              // the structured effect is removed; only a literal prefix that
              // no longer makes the rejected claim may cross the boundary.
              if (!retainAuthorizedEffect && (
                rejectedCallEffect && candidateCopy.some((message) => (
                  claimsImmediateCallDispatchV1(
                    message,
                    repairContext.commercial_state.active_call?.status,
                  )
                ))
                || rejectedPaymentEffect && candidateCopy.some(claimsImmediatePaymentLinkDeliveryV1)
                || repeatsRejectedBonus
              )) continue
              const conversationCandidate = {
                ...candidate,
                proposal: {
                  ...candidateProposal,
                  proposed_action: retainAuthorizedEffect
                    ? candidateProposal.proposed_action
                    : { type: 'none' as const },
                },
              }
              try {
              const revalidated = await resolveAgentAPlannerlessProposalV2({
              observe: journal.capture,
                initial: conversationCandidate,
                context: repairContext,
                repair_enabled: false,
                semantic_rejections: 'blocking',
                rejection_id: currentBackendRejection.rejection_id,
                repair: async () => {
                  throw new Error('AGENT_A_CONVERSATIONAL_FLOOR_REPAIR_NOT_ALLOWED')
                },
              })
              const effectiveConversation = revalidated.effective
              agentTurnV2Commit = {
                schema_version: 2,
                proposal: effectiveConversation.proposal,
                ...(!retainAuthorizedEffect ? fencedAgentARequestV1() : {}),
              }
              pipelineCommit = null
              pipelineMemoryCandidates = effectiveConversation.proposal.memory_candidates
              decision = pipelinePlaceholder(pipelineMemoryCandidates)
              decisionProvider = effectiveConversation.provider
              decisionModel = effectiveConversation.model
              pipelinePromptVersion = AGENT_A_BRAIN_PROMPT_VERSION
              turnDiagnostics = {
                schema_version: 1,
                generation_attempts: agentAGenerationAttempts,
                failure_stage: 'backend_commit',
                failure_codes: rejectionCodes,
                action_status: retainAuthorizedEffect ? 'authorized' : 'none',
              }
              committed = await commitCurrentDecision(
                `commit-agent-a-conversational-floor-v1-${candidateIndex}`,
              )
              safeLog('studyx.turn.agent_a_conversational_floor_committed', {
                trace_id: input.trace_id,
                turn_id: owned.turn_id,
                candidate_index: candidateIndex,
                retained_action_type: retainAuthorizedEffect ? candidateAction : 'none',
                rejection_codes: rejectionCodes,
              })
                break candidateLoop
              } catch (floorError) {
      if (isTurnEvidencePersistenceError(floorError)) throw floorError
                if (!(floorError instanceof Error)) throw floorError
                const floorFailure = classifyAgentAAttemptFailure(floorError)
                if (floorFailure.stage === 'policy' || floorFailure.stage === 'schema') {
                  safeLog('studyx.turn.agent_a_conversational_floor_invalid', {
                    trace_id: input.trace_id,
                    turn_id: owned.turn_id,
                    candidate_index: candidateIndex,
                    failure_code: floorFailure.code,
                  })
                  continue
                }
                const floorRejection = backendCommitTurnRejectionV1({
                  error: floorError,
                  proposal: conversationCandidate.proposal,
                  context: repairContext,
                  rejectionId: randomUUID(),
                })
                if (floorRejection !== null) {
                  currentBackendRejection = floorRejection
                  latestRejection = floorRejection
                  rejectionCodes = [...new Set(
                    floorRejection.rejections.map((item) => item.code),
                  )].slice(0, 8)
                  safeLog('studyx.turn.agent_a_conversational_floor_rejected', {
                    trace_id: input.trace_id,
                    turn_id: owned.turn_id,
                    candidate_index: candidateIndex,
                    rejection_codes: rejectionCodes,
                  })
                  continue
                }
                // A transport or durable runtime failure is not safe to retry
                // as another commit because its outcome may be ambiguous.
                throw floorError
              }
            }
          }
        }

        if (committed === null) {
          // No authorized model-authored response survived both boundaries.
          // The existing technical continuity reply is deliberately free of
          // the rejected effect and commercial promises. Commit it now so a
          // provider/reparation failure never turns into customer silence;
          // this is a last-resort operational fallback, not a sales decision.
          agentTurnV2Commit = null
          pipelineCommit = null
          pipelineMemoryCandidates = []
          const generationUnavailable = continuationFailure !== null
            && isAgentAProviderFailure(continuationFailure)
          decision = technicalContinuityFallback(owned)
          decisionProvider = 'botpress'
          decisionModel = 'policy:agent-a-authorized-floor-unavailable'
          turnDiagnostics = {
            schema_version: 1,
            generation_attempts: agentAGenerationAttempts,
            failure_stage: generationUnavailable ? 'provider_generation' : 'backend_commit',
            failure_codes: continuationFailure === null ? rejectionCodes
              : [...new Set([...rejectionCodes, ...attemptFailureDiagnosticCodes(continuationFailure)])].slice(0, 8),
            action_status: 'rejected',
          }
          try {
            committed = await commitCurrentDecision('commit-agent-a-technical-continuity-v1')
            safeLog('studyx.turn.agent_a_technical_continuity_committed', {
              trace_id: input.trace_id,
              turn_id: owned.turn_id,
              rejection_codes: rejectionCodes,
            })
          } catch (continuityError) {
      if (isTurnEvidencePersistenceError(continuityError)) throw continuityError
            if (!(continuityError instanceof Error)) throw continuityError
            safeLog('studyx.turn.agent_a_technical_continuity_failed', {
              trace_id: input.trace_id,
              turn_id: owned.turn_id,
              error_code: errorCode(continuityError),
            })
            return await recoverRejectedTurn()
          }
        }
      }
    } catch (error) {
      // Durable runtime control signals are not commit failures. Transport
      // suspension remains valid even though semantic retries no longer
      // enqueue a fresh workflow.
      if (!(error instanceof Error)) throw error
      if (isTurnEvidencePersistenceError(error)) {
        state.phase = 'paused_error'; state.errorCode = 'TURN_EVIDENCE_UNAVAILABLE'; return finish()
      }
      timings.commit_ms = Date.now() - commitStartedAt
      state.phase = 'paused_error'
      state.errorCode = errorCode(error)
      safeLog('studyx.turn.commit_failed', {
        trace_id: input.trace_id,
        turn_id: owned.turn_id,
        error_code: state.errorCode,
      })
      if (agentTurnV2Commit !== null) {
        turnDiagnostics = {schema_version:1,generation_attempts:agentAGenerationAttempts,
          failure_stage:'backend_commit',failure_codes:['AGENT_A_COMMIT_FAILED'],action_status:'rejected'}
        return recoverRejectedTurn()
      }
      emitTimings()
      return finish()
    }

    if (committed === null) {
      state.phase = 'paused_error'
      state.errorCode = 'COMMIT_RESULT_MISSING'
      emitTimings()
      return finish()
    }

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
          proposed_call_offer: declaredCallOffer !== null,
          visible_call_offer: physicalCallOffer,
          offered_call: physicalCallOffer,
          reason: callOfferAudit.reason,
          call_accepted: callOfferAudit.call_accepted,
          call_rejected: callOfferAudit.call_rejected,
          chat_preference: callOfferAudit.chat_preference,
          commit_status: committed.status,
        })
    }

    if (committed.status === 'rejected' || !committed.outbound) {
      state.phase = committed.next_state
      emitTimings()
      return finish()
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
      if (isTurnEvidencePersistenceError(error)) throw error
        if (!(error instanceof Error)) throw error
        timings.call_dispatch_ms = Date.now() - dispatchStartedAt
        safeLog('studyx.turn.call_dispatch_unconfirmed', {
          trace_id: input.trace_id,
          turn_id: owned.turn_id,
          call_id: committed.call_request.call_id,
          error_code: errorCode(error),
        })
      }
    }

    const scheduleCommercialFollowups = async (messageId: string | null): Promise<void> => {
      for (const followup of committed.commercial_followups ?? []) {
        try {
          const delay = Math.max(0, Date.parse(followup.due_at) - Date.now())
          const scheduled = await step(
            `schedule-commercial-followup-${followup.id}`,
            () => client.createEvent({
              type: 'studyxCommercialFollowup',
              payload: { followup_id: followup.id },
              conversationId: input.botpress_conversation_id,
              ...(messageId ? { messageId } : {}),
              schedule: { delay },
            }),
            { maxAttempts: 3 },
          )
          await requestStudyxJson({
            path: `/api/agent/commercial-followups/${followup.id}/scheduled`,
            body: { provider_event_id: scheduled.event.id },
            traceId: input.trace_id,
            idempotencyKey: `commercial-followup-scheduled:${followup.id}:${scheduled.event.id}`,
            responseSchema: z.object({ recorded: z.boolean(), provider_event_id: z.string().nullable() }),
          })
          safeLog('studyx.turn.commercial_followup_scheduled', {
            trace_id: input.trace_id,
            turn_id: owned.turn_id,
            followup_id: followup.id,
            followup_kind: followup.kind,
            provider_event_id: scheduled.event.id,
            delay_ms: delay,
          })
        } catch (error) {
      if (isTurnEvidencePersistenceError(error)) throw error
          if (!(error instanceof Error)) throw error
          // The visible answer and the rest of the sale are never rolled back
          // because a secondary follow-up could not be scheduled.
          safeLog('studyx.turn.commercial_followup_schedule_failed', {
            trace_id: input.trace_id,
            turn_id: owned.turn_id,
            followup_id: followup.id,
            error_code: errorCode(error),
          })
        }
      }
    }

    const markDeliveryRecoveryPending = (outboundId: string, botpressMessageId: string | null,
      failure: PendingDeliveryReport): void => {
        state.phase = 'retry_pending'
        state.errorCode = failure.code
        state.needsOperator = !failure.retryable
        state.pendingDeliveryReport = { outboundId, botpressMessageId,
          stage: botpressMessageId ? 'report'
            : failure.code === 'OUTBOUND_SUBMISSION_AMBIGUOUS' ? 'submission_review' : 'continuation',
          attempt: failure.attempt, errorCode: failure.code,
          needsOperator: !failure.retryable, nextRetryAt: Date.now() + failure.delayMs }
        safeLog(failure.retryable ? 'studyx.turn.delivery_recovery_pending'
          : 'studyx.turn.delivery_recovery_operator_required', {
          trace_id: input.trace_id, turn_id: owned.turn_id, outbound_id: outboundId,
          stage: state.pendingDeliveryReport.stage, error_code: failure.code,
          recovery_attempt: failure.attempt, delay_ms: failure.delayMs,
          needs_operator: !failure.retryable,
        })
    }
    const recoverDeliveryOperation = <T>(name: string, outboundId: string,
      botpressMessageId: string | null, operation: () => Promise<T>) => persistDeliveryReportDurably({
      name, step, workflow, report: operation,
      onPending: failure => markDeliveryRecoveryPending(outboundId, botpressMessageId, failure),
      onRecovered: () => {
        state.pendingDeliveryReport = null
        state.errorCode = null
        state.needsOperator = false
        state.phase = 'decision_committed'
      },
    })

    type Submission = { message: { id: string } } | { continuationOutcome: 'superseded' }
    type AuthorizationRetry = { authorizationRetry: { code: string; retryable: boolean } }
    const waitForNaturalWhatsAppReply = async (outboundId: string): Promise<void> => {
      if (
        input.channel !== 'whatsapp'
        || input.sandbox_provider === 'telegram_sandbox'
        || !Number.isFinite(latestInboundAtMs)
      ) return
      const targetMs = whatsappReplyTargetLatencyMs(input.external_message_id)
      const elapsedMs = Math.max(0, Date.now() - latestInboundAtMs)
      const remainingMs = Math.max(0, targetMs - elapsedMs)
      if (remainingMs === 0) return
      safeLog('studyx.turn.natural_reply_wait', {
        trace_id: input.trace_id,
        turn_id: owned.turn_id,
        outbound_id: outboundId,
        target_ms: targetMs,
        remaining_ms: remainingMs,
      })
      // Durable sleep only. On wake, submitWithOwnership synchronizes the
      // conversation and asks the backend again; a newer inbound supersedes
      // this outbound instead of allowing a stale reply through.
      await step.sleep(`natural-whatsapp-reply-${outboundId}`, remainingMs)
    }
    const submitWithOwnership = async (name: string, outbound: { id: string; delivery_attempt: number },
      send: () => Promise<{ message: { id: string } }>): Promise<Submission> => {
      for (let attempt = 0; ; attempt += 1) {
        const receipt: Submission | AuthorizationRetry = await step(attempt === 0 ? name : `${name}-authorization-retry-${attempt}`, async () => {
          let checked
          try {
            await synchronizeConversationInbound({ input, client })
            checked = await authorizeOutboundContinuation.execute({ client, input: {
              outbound_id: outbound.id, trace_id: input.trace_id, delivery_attempt: outbound.delivery_attempt,
            } })
          } catch (error) {
      if (isTurnEvidencePersistenceError(error)) throw error
            if (!(error instanceof Error)) throw error
            return { authorizationRetry: { code: errorCode(error),
              retryable: error instanceof StudyxHttpError && error.retryable } }
          }
          if (checked.outcome === 'superseded') return { continuationOutcome: 'superseded' as const }
          if (checked.reason === 'ALREADY_SUBMITTED' && checked.botpress_message_id) {
            return { message: { id: checked.botpress_message_id as string } }
          }
          if (checked.outcome !== 'authorized') {
            // A lost start response may already have moved reserved → started.
            // The backend marker prevents any provider attempt; preserve review
            // ownership visibly and retry the authority check slowly after repair.
            return { authorizationRetry: { code: checked.reason ?? 'OUTBOUND_NOT_OWNER', retryable: false } }
          }
          state.pendingDeliveryReport = null
          state.errorCode = null
          state.needsOperator = false
          // This call is NEVER inside an HTTP retry. Any exception becomes a
          // cached failed physical step and is held for review by the caller.
          return send()
        }, { maxAttempts: 1 })
        if (!('authorizationRetry' in receipt)) return receipt
        const failure = receipt.authorizationRetry
        const delayMs = failure.retryable ? Math.min(300_000, 15_000 * 2 ** Math.min(attempt, 5)) : 300_000
        markDeliveryRecoveryPending(outbound.id, null, { ...failure, attempt: attempt + 1, delayMs })
        await step(`${name}-authorization-keepalive-${attempt}`, async () => {
          await workflow.setTimeout({ in: '30m' })
        }, { maxAttempts: 1 })
        await step.sleep(`${name}-authorization-wait-${attempt}`, delayMs)
      }
    }

    const holdAmbiguousSubmission = async (outbound: { id: string; delivery_attempt: number }): Promise<{ message: { id: string } }> => {
      state.deliveryStatus = null
      const proof = await recoverDeliveryOperation(`review-ambiguous-submission-${outbound.id}`, outbound.id, null,
        async () => {
          try {
            const checked = await authorizeOutboundContinuation.execute({ client, input: {
              outbound_id: outbound.id, trace_id: input.trace_id, delivery_attempt: outbound.delivery_attempt,
            } })
            if (checked.reason === 'ALREADY_SUBMITTED' && checked.botpress_message_id) {
              return { message: { id: checked.botpress_message_id as string } }
            }
          } catch (error) {
      if (isTurnEvidencePersistenceError(error)) throw error
            if (!(error instanceof Error)) throw error
          }
          throw new StudyxHttpError('OUTBOUND_SUBMISSION_AMBIGUOUS', false)
        })
      return proof.output
    }

    // New backend capability: each model-authored part has its own durable
    // message, manifest, delivery lease and report. Older backends omit the
    // array and continue through the singular compatibility path below.
    if ((committed.outbounds?.length ?? 0) > 0) {
      const multiSendStartedAt = Date.now()
      let lastBotpressMessageId: string | null = null
      let submittedPartsThisRun = 0

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
          return finish()
        }
        const verification = await verifyAuthorizedEgressPortable({
          content: outboundPart.content,
          manifest: outboundPart.authorized_egress,
        }).catch((error: unknown) => {
          if (!(error instanceof Error)) throw error
          return { ok: false, reason: 'CRYPTO_UNAVAILABLE' } as const
        })

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
      if (isTurnEvidencePersistenceError(reportError)) throw reportError
            if (!(reportError instanceof Error)) throw reportError
            safeLog('studyx.turn.delivery_report_failed', {
              trace_id: input.trace_id,
              turn_id: owned.turn_id,
              outbound_id: outboundPart.id,
              part_index: outboundPart.part_index,
              error_code: errorCode(reportError),
            })
          }
          emitTimings()
          return finish()
        }

        let delivery: Submission
        try {
          if (outboundPart.part_index === 0) {
            await waitForNaturalWhatsAppReply(outboundPart.id)
          }
          // Preserve the model-authored bubbles exactly, while avoiding the
          // machine-like effect of submitting every part in the same instant.
          // A replay resumes immediately from its first unfinished part: the
          // previous visible bubble was already sent in an earlier workflow.
          if (submittedPartsThisRun > 0) {
            await new Promise<void>((resolve) => {
              setTimeout(resolve, interBubbleDelayMs(outboundPart.id))
            })
          }
          delivery = await submitWithOwnership(
            `submit-outbound-to-botpress-part-${outboundPart.part_index}`,
            outboundPart,
            async () => {
              if (input.channel === 'whatsapp' && input.sandbox_provider !== 'telegram_sandbox') {
                  const canary = evaluateWhatsAppCanarySend({
                    automationEnabled: configuration.automationEnabled,
                    whatsappPublicEnabled: configuration.whatsappPublicEnabled === true,
                    whatsappCanaryEnabled: configuration.whatsappCanaryEnabled === true,
                    allowlist: secrets.WHATSAPP_CANARY_PHONE_E164S,
                    phoneE164: input.phone_e164,
                    allowedBotPhoneNumberId: typeof configuration.whatsappAllowedBotPhoneNumberId === 'string'
                      ? configuration.whatsappAllowedBotPhoneNumberId
                      : undefined,
                    botPhoneNumberId: input.message.metadata.bot_phone_number_id as string | undefined,
                    log: (event) => console.info(JSON.stringify(event)),
                  })
                  if (!canary.allowed) {
                    const blocked = new Error(canary.reason)
                    blocked.name = canary.reason
                    throw blocked
                  }
                }
                await stopWhatsAppTyping()
                return observedCreateMessage({
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
            )
        } catch (error) {
      if (isTurnEvidencePersistenceError(error)) {
            state.phase = 'paused_error'; state.errorCode = 'TURN_EVIDENCE_UNAVAILABLE'; return finish()
          }
          if (!(error instanceof Error)) throw error
          state.phase = 'paused_error'
          state.errorCode = errorCode(error)
          if (!isConfirmedPreSubmissionBlock(state.errorCode)) {
            // A provider error can happen after accepting the message. No ID
            // is not proof of no send; never publish a retry-authorizing failure.
            state.deliveryStatus = null
            state.errorCode = 'OUTBOUND_SUBMISSION_AMBIGUOUS'
            safeLog('studyx.turn.delivery_submission_ambiguous', {
              trace_id: input.trace_id, outbound_id: outboundPart.id, error_code: errorCode(error),
            })
            emitTimings()
            delivery = await holdAmbiguousSubmission(outboundPart)
          } else {
          state.deliveryStatus = 'failed'
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
      if (isTurnEvidencePersistenceError(reportError)) throw reportError
            if (!(reportError instanceof Error)) throw reportError
            safeLog('studyx.turn.delivery_report_failed', {
              trace_id: input.trace_id,
              turn_id: owned.turn_id,
              outbound_id: outboundPart.id,
              part_index: outboundPart.part_index,
              error_code: errorCode(reportError),
            })
          }
          emitTimings()
          return finish()
          }
        }

        if ('continuationOutcome' in delivery) {
          state.pendingDeliveryReport = null
          state.phase = 'absorbed'
          state.errorCode = 'OUTBOUND_SUPERSEDED'
          safeLog('studyx.turn.delivery_continuation_stopped', {
            trace_id: input.trace_id, outbound_id: outboundPart.id,
            outcome: delivery.continuationOutcome,
          })
          emitTimings()
          return finish()
        }

        // Report immediately. If this becomes ambiguous after createMessage
        // returned an id, stop before the next part; never resend this one.
        await recoverDeliveryOperation(
            `report-botpress-submission-part-${outboundPart.part_index}`,
            outboundPart.id, delivery.message.id,
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
          )
        lastBotpressMessageId = delivery.message.id
        submittedPartsThisRun += 1
      }

      timings.send_ms = Date.now() - multiSendStartedAt
      if (Number.isFinite(occurredAtMs)) {
        timings.event_to_visible_outbound_ms = Math.max(0, Date.now() - occurredAtMs)
        timings.event_to_visible_outbound_over_budget =
          timings.event_to_visible_outbound_ms >= VISIBLE_OUTBOUND_BUDGET_MS ? 1 : 0
      }
      state.deliveryStatus = 'submitted_to_botpress'
      await dispatchAcknowledgedCall()
      await scheduleCommercialFollowups(lastBotpressMessageId)
      try {
        await step(
          'flush-lead-projection-multi',
          () => flushLeadProjection.execute({ client, input: { trace_id: input.trace_id } }),
          { maxAttempts: 1 }
        )
      } catch (error) {
      if (isTurnEvidencePersistenceError(error)) throw error
        if (!(error instanceof Error)) throw error
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
      return finish()
    }

    // ---- Última barrera antes del único envío físico ---------------------
    // The backend owns the capability; this edge only verifies that the exact
    // content received here is still the content it authorized. Any malformed
    // or altered value is a terminal failed attempt, never a send retry.
    const egressStartedAt = Date.now()
    const egressVerification = await verifyAuthorizedEgressPortable({
      content: committed.outbound.content,
      manifest: committed.outbound.authorized_egress,
    }).catch((error: unknown) => {
      if (!(error instanceof Error)) throw error
      return { ok: false, reason: 'CRYPTO_UNAVAILABLE' } as const
    })
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
      if (isTurnEvidencePersistenceError(reportError)) throw reportError
        if (!(reportError instanceof Error)) throw reportError
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
      return finish()
    }

    // ---- Paso 11: un único envío físico ----------------------------------
    let delivery: Submission
    const sendStartedAt = Date.now()
    try {
      await waitForNaturalWhatsAppReply(committed.outbound.id)
      delivery = await submitWithOwnership(
        'submit-outbound-to-botpress',
        committed.outbound,
        async () => {
          // The WhatsApp production canary applies only to real WhatsApp. The
          // Telegram sandbox is identified independently by its true channel
          // and `sandbox_provider=telegram_sandbox` safety marker.
          if (input.channel === 'whatsapp' && input.sandbox_provider !== 'telegram_sandbox') {
            const canary = evaluateWhatsAppCanarySend({
              automationEnabled: configuration.automationEnabled,
              whatsappPublicEnabled: configuration.whatsappPublicEnabled === true,
              whatsappCanaryEnabled: configuration.whatsappCanaryEnabled === true,
              allowlist: secrets.WHATSAPP_CANARY_PHONE_E164S,
              phoneE164: input.phone_e164,
              allowedBotPhoneNumberId: typeof configuration.whatsappAllowedBotPhoneNumberId === 'string'
                ? configuration.whatsappAllowedBotPhoneNumberId
                : undefined,
              botPhoneNumberId: input.message.metadata.bot_phone_number_id as string | undefined,
              log: (event) => console.info(JSON.stringify(event)),
            })
            if (!canary.allowed) {
              const blocked = new Error(canary.reason)
              blocked.name = canary.reason
              throw blocked
            }
          }
          await stopWhatsAppTyping()
          return observedCreateMessage({
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
      )
      if ('continuationOutcome' in delivery) {
        state.pendingDeliveryReport = null
        state.phase = 'absorbed'
        state.errorCode = 'OUTBOUND_SUPERSEDED'
        emitTimings()
        return finish()
      }
      timings.send_ms = Date.now() - sendStartedAt
      if (Number.isFinite(occurredAtMs)) {
        // Returned createMessage is the first edge-owned proof that the
        // outbound is visible to the Botpress channel. Because the origin is
        // the inbound event timestamp, this includes the batching window.
        timings.event_to_visible_outbound_ms = Math.max(0, Date.now() - occurredAtMs)
        timings.event_to_visible_outbound_over_budget =
          timings.event_to_visible_outbound_ms >= VISIBLE_OUTBOUND_BUDGET_MS ? 1 : 0
      }
    } catch (error) {
      if (isTurnEvidencePersistenceError(error)) {
        state.phase = 'paused_error'; state.errorCode = 'TURN_EVIDENCE_UNAVAILABLE'; return finish()
      }
      if (!(error instanceof Error)) throw error
      timings.send_ms = Date.now() - sendStartedAt
      state.phase = 'paused_error'
      state.errorCode = errorCode(error)
      if (!isConfirmedPreSubmissionBlock(state.errorCode)) {
        state.deliveryStatus = null
        state.errorCode = 'OUTBOUND_SUBMISSION_AMBIGUOUS'
        safeLog('studyx.turn.delivery_submission_ambiguous', {
          trace_id: input.trace_id, outbound_id: committed.outbound.id, error_code: errorCode(error),
        })
        emitTimings()
        delivery = await holdAmbiguousSubmission(committed.outbound)
      } else {
      state.deliveryStatus = 'failed'

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
      if (isTurnEvidencePersistenceError(reportError)) throw reportError
        if (!(reportError instanceof Error)) throw reportError
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
      return finish()
      }
    }

    // ---- Paso 12: reportar la entrega ------------------------------------
    state.deliveryStatus = 'submitted_to_botpress'
    const reportStartedAt = Date.now()
    await recoverDeliveryOperation(
        'report-botpress-submission',
        committed.outbound.id, delivery.message.id,
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
      )
      timings.delivery_report_ms = Date.now() - reportStartedAt

    await dispatchAcknowledgedCall()
    await scheduleCommercialFollowups(delivery.message.id)

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
      if (isTurnEvidencePersistenceError(error)) throw error
      if (!(error instanceof Error)) throw error
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
    return finish()
  },
})
