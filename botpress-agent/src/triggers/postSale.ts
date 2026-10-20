import { Trigger, configuration, secrets, z } from '@botpress/runtime'
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

export default new Trigger({
  name: 'onStudyxPostSale',
  events: ['studyxPostSale'],
  handler: async ({ event }) => {
    const id = event.payload.notification_id
    const conversationId = event.conversationId
    if (!conversationId) return
    const traceId = crypto.randomUUID()
    const claimed = await requestStudyxJson({ path: `/api/agent/post-sale/${id}/claim`,
      body: { botpress_conversation_id: conversationId }, traceId, idempotencyKey: `post-sale-claim:${id}`, responseSchema: PostSaleClaimSchema })
    if (!claimed.claimed) return
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
          instructions: buildPostSaleInstructions(identity.prompt, claimed),
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
      if (!raw) throw new Error('POST_SALE_MODEL_EMPTY')
      narrative = Narrative.parse(JSON.parse(raw))
    } catch {
      // Verified payment/access is transactional and must not depend on model
      // availability. The fallback contains no identity, URL or credential;
      // those immutable values are still appended and authorized by backend.
      narrative = fallbackPostSaleNarrative(claimed)
      usedFallback = true
      console.warn(JSON.stringify({ event: 'studyx.post_sale.fallback', notification_id: id, reason: 'MODEL_UNAVAILABLE' }))
    }
    try {
      let delivery = await requestStudyxJson({ path: `/api/agent/post-sale/${id}/deliver`,
        body: { claim_token: claimed.claim_token, botpress_conversation_id: conversationId, narrative },
        traceId, idempotencyKey: `post-sale-deliver:${id}:${claimed.claim_token}`, responseSchema: Delivery,
      })
      if (delivery.outcome === 'invalid_content' && !usedFallback) {
        console.warn(JSON.stringify({
          event: 'studyx.post_sale.content_rejected', notification_id: id,
          reason: delivery.reason ?? 'POST_SALE_CONTENT_INVALID',
        }))
        narrative = fallbackPostSaleNarrative(claimed)
        usedFallback = true
        delivery = await requestStudyxJson({ path: `/api/agent/post-sale/${id}/deliver`,
          body: { claim_token: claimed.claim_token, botpress_conversation_id: conversationId, narrative },
          traceId, idempotencyKey: `post-sale-deliver-fallback:${id}:${claimed.claim_token}`,
          responseSchema: Delivery,
        })
      }
      if (delivery.outcome === 'invalid_content') {
        console.warn(JSON.stringify({
          event: 'studyx.post_sale.safe_fallback_rejected', notification_id: id,
          reason: delivery.reason ?? 'POST_SALE_CONTENT_INVALID',
        }))
        throw new Error('POST_SALE_SAFE_FALLBACK_INVALID')
      }
    } catch {
      await requestStudyxJson({ path: `/api/agent/post-sale/${id}/release`,
        body: { claim_token: claimed.claim_token }, traceId, idempotencyKey: `post-sale-release:${id}:${claimed.claim_token}`,
        responseSchema: z.object({ outcome: z.string() }),
      })
      console.warn(JSON.stringify({ event: 'studyx.post_sale.retry', notification_id: id }))
    }
  },
})
