import { Trigger, configuration, secrets, z } from '@botpress/runtime'
import { requestStudyxJson } from '../utils/http'
import { AGENT_A_DEEPSEEK_MODEL } from '../config/agent-a-model'
import { STUDYX_AGENT_A_CANONICAL_PROMPT } from '../prompts/studyx-agent-a-canonical.generated'
import { resolveCanonicalPromptIdentityV1 } from '../prompts/agent-a-identity'
import {
  buildCommercialFollowupInstructions,
  CommercialFollowupClaimSchema,
  fallbackCommercialFollowupNarrative,
} from '../utils/commercial-followup-instructions'

const Narrative = z.object({ message: z.string().trim().min(1).max(900) }).strict()
const Delivery = z.object({ outcome: z.string(), reason: z.string().optional() })

function responseText(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const record = payload as {
    output_text?: unknown
    output?: Array<{ content?: Array<{ type?: unknown; text?: unknown }> }>
  }
  if (typeof record.output_text === 'string') return record.output_text
  const parts = record.output?.flatMap((item) => item.content ?? [])
    .filter((item) => item.type === 'output_text' && typeof item.text === 'string')
    .map((item) => String(item.text)) ?? []
  return parts.length > 0 ? parts.join('') : null
}

export default new Trigger({
  name: 'onStudyxCommercialFollowup',
  events: ['studyxCommercialFollowup'],
  handler: async ({ event }) => {
    const id = event.payload.followup_id
    const conversationId = event.conversationId
    if (!conversationId) return
    const traceId = crypto.randomUUID()
    const claimed = await requestStudyxJson({
      path: `/api/agent/commercial-followups/${id}/claim`,
      body: { botpress_conversation_id: conversationId, provider_event_id: event.id },
      traceId,
      idempotencyKey: `commercial-followup-claim:${id}:${event.id}`,
      responseSchema: CommercialFollowupClaimSchema,
    })
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
        throw new Error('COMMERCIAL_FOLLOWUP_IDENTITY_OR_MODEL_MISSING')
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
          instructions: buildCommercialFollowupInstructions(identity.prompt, claimed),
          input: JSON.stringify(claimed),
          reasoning: { effort: 'none' },
          temperature: 0.45,
          stream: false,
          max_output_tokens: 300,
          text: { format: { type: 'json_schema', name: 'studyx_commercial_followup', schema: {
            type: 'object', additionalProperties: false, required: ['message'],
            properties: { message: { type: 'string', minLength: 1, maxLength: 900 } },
          } } },
        }),
      })
      if (!response.ok) throw new Error(`COMMERCIAL_FOLLOWUP_MODEL_HTTP_${response.status}`)
      const raw = responseText(await response.json())
      if (!raw) throw new Error('COMMERCIAL_FOLLOWUP_MODEL_EMPTY')
      narrative = Narrative.parse(JSON.parse(raw))
    } catch {
      narrative = fallbackCommercialFollowupNarrative(claimed)
      usedFallback = true
      console.warn(JSON.stringify({ event: 'studyx.commercial_followup.fallback', followup_id: id }))
    }

    try {
      let delivery = await requestStudyxJson({
        path: `/api/agent/commercial-followups/${id}/deliver`,
        body: { claim_token: claimed.claim_token, botpress_conversation_id: conversationId, narrative },
        traceId,
        idempotencyKey: `commercial-followup-deliver:${id}:${claimed.claim_token}`,
        responseSchema: Delivery,
      })
      if (delivery.outcome === 'invalid_content' && !usedFallback) {
        console.warn(JSON.stringify({
          event: 'studyx.commercial_followup.content_rejected',
          followup_id: id,
          reason: delivery.reason ?? 'COMMERCIAL_FOLLOWUP_CONTENT_INVALID',
        }))
        narrative = fallbackCommercialFollowupNarrative(claimed)
        usedFallback = true
        delivery = await requestStudyxJson({
          path: `/api/agent/commercial-followups/${id}/deliver`,
          body: { claim_token: claimed.claim_token, botpress_conversation_id: conversationId, narrative },
          traceId,
          idempotencyKey: `commercial-followup-deliver-fallback:${id}:${claimed.claim_token}`,
          responseSchema: Delivery,
        })
      }
      if (delivery.outcome === 'invalid_content') throw new Error(delivery.reason ?? 'COMMERCIAL_FOLLOWUP_SAFE_FALLBACK_INVALID')
    } catch {
      await requestStudyxJson({
        path: `/api/agent/commercial-followups/${id}/release`,
        body: { claim_token: claimed.claim_token },
        traceId,
        idempotencyKey: `commercial-followup-release:${id}:${claimed.claim_token}`,
        responseSchema: z.object({ outcome: z.string() }),
      })
      console.warn(JSON.stringify({ event: 'studyx.commercial_followup.retry', followup_id: id }))
    }
  },
})
