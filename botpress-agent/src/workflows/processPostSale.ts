import { createTurnEvidenceJournal, isTurnEvidencePersistenceError, TurnEvidencePersistenceError, type TurnEvidenceEvent } from '../lib/observability/turn-evidence'
import { persistTurnEvidence } from '../lib/observability/persist-turn-evidence'
import { Workflow, configuration, secrets, z } from '@botpress/runtime'
import { requestStudyxJson } from '../utils/http'
import { AGENT_A_DEEPSEEK_MODEL } from '../config/agent-a-model'
import { STUDYX_AGENT_A_CANONICAL_PROMPT } from '../prompts/studyx-agent-a-canonical.generated'
import { resolveCanonicalPromptIdentityV1 } from '../prompts/agent-a-identity'
import { buildPostSaleInstructions, fallbackPostSaleNarrative, PostSaleClaimSchema } from '../utils/post-sale-instructions'

const Narrative = z.object({
  intro: z.string().min(1).max(500),
  suggestion: z.string().max(180),
}).strict()

const Delivery = z.object({
  outcome: z.string(),
  reason: z.string().optional(),
})

function responseText(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const record = payload as {
    output_text?: unknown
    output?: Array<{ content?: Array<{ type?: unknown; text?: unknown }> }>
  }
  if (typeof record.output_text === 'string') return record.output_text
  const parts = record.output?.flatMap(item => item.content ?? [])
    .filter(item => item.type === 'output_text' && typeof item.text === 'string')
    .map(item => String(item.text)) ?? []
  return parts.length > 0 ? parts.join('') : null
}

export const processPostSale = new Workflow({
  name: 'processPostSale',
  input: z.object({ notification_id: z.string().uuid(), conversation_id: z.string().min(1) }) as any,
  output: z.object({ outcome: z.string(), workflow_id: z.string().optional(), evidence_location: z.string().optional() }) as any,
  state: z.object({ trace_id: z.string().uuid().nullable().default(null),
    evidence_review: z.unknown().nullable().default(null) }) as any,
  timeout: '24h',
  handler: async ({ input, state, step, workflow }) => {
    const id = input.notification_id
    const conversationId = input.conversation_id
    const traceId = state.trace_id ?? crypto.randomUUID()
    state.trace_id = traceId
    const requireEvidenceReview = () => {
      const evidence_location = 'cached generate-post-sale step output.events and output.narrative'
      state.evidence_review = { workflow_id: workflow.id, notification_id: id,
        reason: 'TURN_EVIDENCE_UNAVAILABLE', evidence_location }
      workflow.tags = { ...workflow.tags, studyxEvidenceReview: 'true' }
      return { outcome: 'evidence_review_required', workflow_id: workflow.id, evidence_location }
    }
    const claimed = await step('claim-post-sale', () => requestStudyxJson({ path: `/api/agent/post-sale/${id}/claim`,
      body: { botpress_conversation_id: conversationId }, traceId, idempotencyKey: `post-sale-claim:${id}`, responseSchema: PostSaleClaimSchema }), { maxAttempts: 1 })
    if (!claimed.claimed) return { outcome: 'not_claimed' }
    // Model output and failures are cached by the durable runtime BEFORE any
    // diagnostic HTTP write. Replaying persistence cannot regenerate prose.
    const generateNarrative = async (rejectionCode?: string, rejectedNarrative?: z.infer<typeof Narrative>) => {
      const events: TurnEvidenceEvent[] = []
      const capture = (kind: string, data: Record<string, unknown>) => events.push({ event_id: crypto.randomUUID(), kind, data })
      capture('generation_started', { route: 'post_sale', rejection_code: rejectionCode ?? null })
    let narrative: z.infer<typeof Narrative>
    let usedFallback = false
    try {
      const identity = resolveCanonicalPromptIdentityV1(STUDYX_AGENT_A_CANONICAL_PROMPT, {
        advisor_name: typeof configuration.agentAAdvisorName === 'string'
          ? configuration.agentAAdvisorName
          : '',
        academy_name: claimed.academy_name,
        website: null,
        instagram: null,
      })
      if (identity.unresolved.length > 0 || !secrets.DEEPSEEK_API_KEY) {
        throw new Error('POST_SALE_IDENTITY_OR_MODEL_MISSING')
      }
      const response = await fetch('https://api.deepseek.com/responses', {
        method: 'POST',
        signal: AbortSignal.timeout(6_000),
        headers: {
          authorization: `Bearer ${secrets.DEEPSEEK_API_KEY}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: AGENT_A_DEEPSEEK_MODEL,
          instructions: buildPostSaleInstructions(identity.prompt, claimed)
            + (rejectionCode ? `\n<turn_rejection>${JSON.stringify({ subject: 'post_sale_narrative', code: rejectionCode, rejected_narrative: rejectedNarrative })}</turn_rejection>\nReescribe la respuesta completa corrigiendo únicamente el hecho o requisito rechazado; conserva tu voz. No afirmes efectos nuevos.` : ''),
          input: JSON.stringify(claimed),
          reasoning: { effort: 'none' },
          temperature: 0.3,
          stream: false,
          max_output_tokens: 350,
          text: { format: { type: 'json_schema', name: 'studyx_post_sale', schema: {
            type: 'object', additionalProperties: false, required: ['intro', 'suggestion'],
            properties: {
              intro: { type: 'string', minLength: 1, maxLength: 500 },
              suggestion: { type: 'string', maxLength: 180 },
            },
          } } },
        }),
      })
      if (!response.ok) throw new Error(`POST_SALE_MODEL_HTTP_${response.status}`)
      const raw = responseText(await response.json())
      capture('model_raw', { raw_content: raw, model: AGENT_A_DEEPSEEK_MODEL, status: response.status })
      if (!raw) throw new Error('POST_SALE_MODEL_EMPTY')
      narrative = Narrative.parse(JSON.parse(raw))
    } catch (error) {
      capture('generation_failed', { code: error instanceof Error ? error.message : 'UNKNOWN_ERROR' })
      // Verified payment/access is transactional and must not depend on model
      // availability. The fallback contains no identity, URL or credential;
      // those immutable values are still appended and authorized by backend.
      narrative = fallbackPostSaleNarrative(claimed)
      usedFallback = true
      console.warn(JSON.stringify({ event: 'studyx.post_sale.fallback', notification_id: id, reason: 'MODEL_UNAVAILABLE' }))
    }
      capture('post_sale_narrative', { narrative, used_fallback: usedFallback })
      return { narrative, usedFallback, events }
    }
    const generated = await step('generate-post-sale', () => generateNarrative(), { maxAttempts: 1 })
    let { narrative, usedFallback } = generated
    const subject = { subject_type: 'post_sale' as const, subject_id: id, trace_id: traceId }
    const journal = createTurnEvidenceJournal(event => persistTurnEvidence(subject, event), generated.events)
    try { await journal.flush() } catch { return requireEvidenceReview() }
    const recordStage = async (kind: string, data: Record<string, unknown>) => {
      const event = await step(`evidence-event-${kind}`, async () => ({ event_id: crypto.randomUUID(), kind, data }), { maxAttempts: 1 })
      try { await persistTurnEvidence(subject, event) } catch { throw new TurnEvidencePersistenceError() }
    }
    try {
      let delivery = await step('deliver-post-sale', () => requestStudyxJson({ path: `/api/agent/post-sale/${id}/deliver`,
        body: { claim_token: claimed.claim_token, botpress_conversation_id: conversationId, narrative },
        traceId, idempotencyKey: `post-sale-deliver:${id}:${claimed.claim_token}`, responseSchema: Delivery,
      }), { maxAttempts: 1 })
      await recordStage('post_sale_primary_receipt', { receipt: delivery })
      if (delivery.outcome === 'invalid_content' && !usedFallback) {
        console.warn(JSON.stringify({ event: 'studyx.post_sale.content_rejected', notification_id: id,
          reason: delivery.reason ?? 'POST_SALE_CONTENT_INVALID' }))
        const repaired = await step('repair-post-sale', () => generateNarrative(delivery.reason ?? 'POST_SALE_CONTENT_INVALID', narrative), { maxAttempts: 1 })
        const repairJournal = createTurnEvidenceJournal(event => persistTurnEvidence(subject, event), repaired.events)
        await repairJournal.flush()
        narrative = repaired.narrative
        usedFallback = repaired.usedFallback
        delivery = await step('deliver-post-sale-repair', () => requestStudyxJson({
          path: `/api/agent/post-sale/${id}/deliver`,
          body: { claim_token: claimed.claim_token, botpress_conversation_id: conversationId, narrative },
          traceId, idempotencyKey: `post-sale-deliver:${id}:${claimed.claim_token}`, responseSchema: Delivery,
        }), { maxAttempts: 1 })
        await recordStage('post_sale_repair_receipt', { receipt: delivery, narrative, used_fallback: usedFallback })
      }
      if (delivery.outcome === 'invalid_content' && !usedFallback) {
        console.warn(JSON.stringify({
          event: 'studyx.post_sale.content_rejected', notification_id: id,
          reason: delivery.reason ?? 'POST_SALE_CONTENT_INVALID',
        }))
        narrative = fallbackPostSaleNarrative(claimed)
        usedFallback = true
        delivery = await step('deliver-post-sale-fallback', () => requestStudyxJson({ path: `/api/agent/post-sale/${id}/deliver`,
          body: { claim_token: claimed.claim_token, botpress_conversation_id: conversationId, narrative },
          traceId, idempotencyKey: `post-sale-deliver:${id}:${claimed.claim_token}`,
          responseSchema: Delivery,
        }), { maxAttempts: 1 })
      }
      await recordStage('post_sale_final_receipt', { receipt: delivery, narrative, used_fallback: usedFallback })
      if (delivery.outcome === 'invalid_content') {
        console.warn(JSON.stringify({
          event: 'studyx.post_sale.safe_fallback_rejected', notification_id: id,
          reason: delivery.reason ?? 'POST_SALE_CONTENT_INVALID',
        }))
        throw new Error('POST_SALE_SAFE_FALLBACK_INVALID')
      }
      return { outcome: delivery.outcome }
    } catch (error) {
      if (isTurnEvidencePersistenceError(error)) return requireEvidenceReview()
      await requestStudyxJson({ path: `/api/agent/post-sale/${id}/release`,
        body: { claim_token: claimed.claim_token }, traceId, idempotencyKey: `post-sale-release:${id}:${claimed.claim_token}`,
        responseSchema: z.object({ outcome: z.string() }),
      })
      console.warn(JSON.stringify({ event: 'studyx.post_sale.retry', notification_id: id }))
      return { outcome: 'released' }
    }
  },
})
