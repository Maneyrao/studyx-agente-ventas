import { Trigger, configuration, secrets, z } from '@botpress/runtime'
import { requestStudyxJson } from '../utils/http'
import { AGENT_A_DEEPSEEK_MODEL } from '../config/agent-a-model'
import { STUDYX_AGENT_A_CANONICAL_PROMPT } from '../prompts/studyx-agent-a-canonical.generated'
import { resolveCanonicalPromptIdentityV1 } from '../prompts/agent-a-identity'
import { buildPostSaleInstructions, fallbackPostSaleNarrative, PostSaleClaimSchema } from '../utils/post-sale-instructions'

const Narrative = z.object({ intro: z.string().min(1).max(500), suggestion: z.string().max(180) })
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
    let narrative = fallbackPostSaleNarrative(claimed)
    try {
      const identity = resolveCanonicalPromptIdentityV1(STUDYX_AGENT_A_CANONICAL_PROMPT, {
        advisor_name: configuration.agentAAdvisorName, academy_name: claimed.academy_name, website: null, instagram: null,
      })
      if (identity.unresolved.length || !secrets.DEEPSEEK_API_KEY) throw new Error('POST_SALE_IDENTITY_OR_MODEL_MISSING')
      const instructions = buildPostSaleInstructions(identity.prompt, claimed)
      const response = await fetch('https://api.deepseek.com/responses', {
        method: 'POST', signal: AbortSignal.timeout(10000),
        headers: { authorization: `Bearer ${secrets.DEEPSEEK_API_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model: AGENT_A_DEEPSEEK_MODEL, instructions,
          input: JSON.stringify(claimed), reasoning: { effort: 'none' }, temperature: 0.2, stream: false,
          max_output_tokens: 350, text: { format: { type: 'json_schema', name: 'studyx_post_sale', schema: {
            type: 'object', additionalProperties: false, required: ['intro', 'suggestion'],
            properties: { intro: { type: 'string' }, suggestion: { type: 'string' } },
          } } },
        }),
      })
      if (!response.ok) throw new Error(`POST_SALE_MODEL_HTTP_${response.status}`)
      const payload = await response.json() as { output_text?: string; output?: Array<{ content?: Array<{ type: string; text?: string }> }> }
      const text = payload.output_text ?? payload.output?.flatMap(item => item.content ?? []).filter(item => item.type === 'output_text').map(item => item.text ?? '').join('')
      if (!text) throw new Error('POST_SALE_MODEL_EMPTY')
      narrative = Narrative.parse(JSON.parse(text))
    } catch {
      console.warn(JSON.stringify({ event: 'studyx.post_sale.narrative_fallback', notification_id: id }))
    }
    try {
      await requestStudyxJson({ path: `/api/agent/post-sale/${id}/deliver`,
        body: { claim_token: claimed.claim_token, botpress_conversation_id: conversationId, narrative },
        traceId, idempotencyKey: `post-sale-deliver:${id}:${claimed.claim_token}`, responseSchema: z.object({ outcome: z.string() }),
      })
    } catch {
      await requestStudyxJson({ path: `/api/agent/post-sale/${id}/release`,
        body: { claim_token: claimed.claim_token }, traceId, idempotencyKey: `post-sale-release:${id}:${claimed.claim_token}`,
        responseSchema: z.object({ outcome: z.string() }),
      })
      console.warn(JSON.stringify({ event: 'studyx.post_sale.retry', notification_id: id }))
    }
  },
})
