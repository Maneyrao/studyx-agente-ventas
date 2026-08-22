import { Action, configuration, secrets, z } from '@botpress/runtime'

const FlushLeadProjectionInputSchema = z.object({
  trace_id: z.string().uuid(),
})

const FlushLeadProjectionResponseSchema = z.object({
  status: z.enum(['flushed', 'unavailable']),
  completed: z.number().int().nonnegative().default(0),
})

/** Never lets a slow or unreachable Sheets flush cost the turn anything. */
const FLUSH_TIMEOUT_MS = 3_000

/**
 * Opportunistic, best-effort trigger for the Sheets outbox
 * (docs/contracts/agent-a-operational-mvp.md §5). `enqueueLeadProjection`
 * already queued the `payment_link_sent` row from the backend right after
 * delivery was confirmed (decision.service.ts's `recordDeliveryReport`) —
 * this action only asks the SAME worker that `/api/cron/flush-projections`
 * runs on a schedule to drain the outbox a few seconds sooner, so an
 * operator usually sees the sheet update close to real time instead of
 * waiting for the next tick.
 *
 * Bounded and fire-and-forget by construction: one attempt, a short
 * timeout, and any failure — missing credential, network, non-2xx —
 * degrades to `unavailable` without throwing. The row this call could not
 * flush stays `pending`/`failed_retryable` in `sheet_projection_rows`
 * exactly as it already was; the next cron tick still drains it. There is
 * never a reason to retry this action or to let its outcome affect the
 * turn's own result.
 *
 * This calls the existing cron endpoint with the same
 * `Authorization: Bearer <CRON_SECRET>` scheme `/api/cron/flush-projections`
 * already requires (see src/proxy.ts, which exempts `/api/cron/*` from the
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
  title: 'Flush pending Sheets lead projections',
  description: 'Opportunistically asks the backend to drain pending Sheets rows after a delivered signal.',
  input: FlushLeadProjectionInputSchema as any,
  output: FlushLeadProjectionResponseSchema as any,
  cached: false,
  async handler({ input }: { input: unknown }) {
    const { trace_id } = FlushLeadProjectionInputSchema.parse(input)

    // Read defensively: the secret is not declared in agent.config.ts yet
    // (see the KNOWN GAP note above), so this must degrade gracefully rather
    // than throw a "secret not declared" error from the runtime.
    const cronSecret = (secrets as Record<string, string | undefined>).CRON_SECRET

    if (!cronSecret) {
      console.info(JSON.stringify({
        event: 'studyx.projection_flush.unavailable',
        trace_id,
        reason: 'MISSING_CRON_SECRET',
      }))
      return { status: 'unavailable' as const, completed: 0 }
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), FLUSH_TIMEOUT_MS)
    try {
      const url = new URL('/api/cron/flush-projections', configuration.apiBaseUrl)
      const response = await fetch(url, {
        method: 'GET',
        headers: { authorization: `Bearer ${cronSecret}` },
        signal: controller.signal,
      })
      if (!response.ok) {
        console.info(JSON.stringify({
          event: 'studyx.projection_flush.unavailable',
          trace_id,
          reason: `HTTP_${response.status}`,
        }))
        return { status: 'unavailable' as const, completed: 0 }
      }
      const payload = (await response.json().catch(() => null)) as { completed?: number } | null
      return { status: 'flushed' as const, completed: payload?.completed ?? 0 }
    } catch (error) {
      console.info(JSON.stringify({
        event: 'studyx.projection_flush.unavailable',
        trace_id,
        reason: error instanceof Error ? error.name : 'UNKNOWN_ERROR',
      }))
      return { status: 'unavailable' as const, completed: 0 }
    } finally {
      clearTimeout(timeout)
    }
  },
})
