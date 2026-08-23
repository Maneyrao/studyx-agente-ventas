import { Action, configuration, secrets, z } from '@botpress/runtime'

const FlushLeadProjectionInputSchema = z.object({
  trace_id: z.string().uuid(),
})

const FlushLeadProjectionResponseSchema = z.object({
  status: z.enum(['flushed', 'unavailable']),
  completed: z.number().int().nonnegative().default(0),
  memory_completed: z.number().int().nonnegative().default(0),
})

/** Never lets slow derived work cost the customer-facing turn anything. */
const FLUSH_TIMEOUT_MS = 3_000

interface FlushPostTurnWorkInput {
  api_base_url: string
  cron_secret: string
  trace_id: string
  fetch_impl?: typeof fetch
}

/**
 * Runs derived work only after the customer-facing message was accepted by
 * Botpress. The two queues are independent: a Sheets outage cannot stop a
 * memory embedding, and an embedding outage cannot stop a Sheets update.
 */
export async function flushPostTurnWork(input: FlushPostTurnWorkInput) {
  const fetchImpl = input.fetch_impl ?? fetch
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FLUSH_TIMEOUT_MS)

  const drain = async (path: string): Promise<{ ok: boolean; completed: number }> => {
    try {
      const response = await fetchImpl(new URL(path, input.api_base_url), {
        method: 'GET',
        headers: {
          authorization: `Bearer ${input.cron_secret}`,
          'x-trace-id': input.trace_id,
        },
        signal: controller.signal,
      })
      if (!response.ok) return { ok: false, completed: 0 }
      const payload = (await response.json().catch(() => null)) as { completed?: number } | null
      return {
        ok: true,
        completed: typeof payload?.completed === 'number' ? payload.completed : 0,
      }
    } catch {
      return { ok: false, completed: 0 }
    }
  }

  try {
    const [sheets, memory] = await Promise.all([
      drain('/api/cron/flush-projections'),
      drain('/api/cron/memory-maintenance'),
    ])
    return {
      status: sheets.ok || memory.ok ? 'flushed' as const : 'unavailable' as const,
      completed: sheets.completed,
      memory_completed: memory.completed,
    }
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Opportunistic, best-effort trigger for both post-turn queues: the Sheets
 * outbox and selected-memory embeddings. Their scheduled cron jobs remain the
 * durable fallback; this action only reduces time-to-Sheet and time-to-recall.
 *
 * Bounded and fire-and-forget by construction: one attempt, a short
 * timeout, and any failure — missing credential, network, non-2xx —
 * degrades to `unavailable` without throwing. Unfinished rows remain queued
 * for the next cron tick; this outcome never changes the turn's own result.
 *
 * This calls the existing cron endpoint with the same
 * `Authorization: Bearer <CRON_SECRET>` scheme the two `/api/cron/*` routes
 * require (see src/proxy.ts, which exempts `/api/cron/*` from the
 * orchestrator-key/HMAC scheme every other `/api/agent/*` action uses).
 * `CRON_SECRET` is declared in `agent.config.ts`'s `secrets` block (no value
 * there — only the declaration; `.adk/secrets.json` and the deployed
 * environment provision the actual value per environment). Until a value is
 * provisioned, `secrets.CRON_SECRET` resolves to undefined and this action
 * degrades to `unavailable` exactly as it would for any other failure —
 * safe, inert for that one environment, and self-healing the moment the
 * secret is set: no code change needed.
 */
export const flushLeadProjection = new Action<any, any>({
  name: 'flushLeadProjection',
  title: 'Flush pending post-turn projections',
  description: 'Opportunistically drains pending Sheets rows and selected-memory embeddings after delivery.',
  input: FlushLeadProjectionInputSchema as any,
  output: FlushLeadProjectionResponseSchema as any,
  cached: false,
  async handler({ input }: { input: unknown }) {
    const { trace_id } = FlushLeadProjectionInputSchema.parse(input)

    // Read defensively: a declared but unprovisioned secret must degrade
    // safely instead of failing the already-delivered customer turn.
    const cronSecret = (secrets as Record<string, string | undefined>).CRON_SECRET

    if (!cronSecret) {
      console.info(JSON.stringify({
        event: 'studyx.projection_flush.unavailable',
        trace_id,
        reason: 'MISSING_CRON_SECRET',
      }))
      return { status: 'unavailable' as const, completed: 0, memory_completed: 0 }
    }

    const result = await flushPostTurnWork({
      api_base_url: configuration.apiBaseUrl,
      cron_secret: cronSecret,
      trace_id,
    })
    if (result.status === 'unavailable') {
      console.info(JSON.stringify({
        event: 'studyx.projection_flush.unavailable',
        trace_id,
        reason: 'ALL_POST_TURN_WORK_UNAVAILABLE',
      }))
    }
    return result
  },
})
