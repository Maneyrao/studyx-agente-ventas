import type { WorkflowInputSchema } from '../../schemas/contracts'
import type { z } from '@botpress/runtime'

// Re-exported for convenience; source of truth is `./emulator-envelope`.
export { E164_PATTERN, DEFAULT_DEVELOPMENT_EMULATOR_PHONE_E164 } from './emulator-envelope'

export type CanonicalWorkflowInput = z.infer<typeof WorkflowInputSchema>

/**
 * Context passed to a channel adapter for one Botpress message event.
 *
 * `raw` is the untrusted event as received by the conversation router.
 * The adapter must never assume any field beyond what its own `matches`
 * function has guaranteed.
 */
export type ChannelAdapterContext = {
  type: string
  channel: string
  message: unknown
  conversation: {
    id: string
    alias?: string
    integration?: string
    tags?: Record<string, string>
  }
  traceId: string
}

export type ChannelAdapterResult =
  | { kind: 'envelope'; input: CanonicalWorkflowInput }
  | { kind: 'skip'; reason: string }

/**
 * A channel-specific adapter. Each canal (emulator, whatsapp, telegram)
 * implements one. The single wildcard `Conversation` router dispatches
 * to the first adapter whose `matches` returns true.
 */
export type ChannelAdapter = {
  /** Stable identifier used in logs and to pick an adapter deterministically. */
  name: string
  /** Deterministic recognition. Runs BEFORE `toEnvelope`; must be cheap and pure. */
  matches(ctx: ChannelAdapterContext): boolean
  /**
   * Build the canonical WorkflowInput or return a skip decision.
   * Adapters MUST NOT throw for unsupported message shapes — use `skip`.
   */
  toEnvelope(ctx: ChannelAdapterContext): ChannelAdapterResult
}

/**
 * Resolve a stable integration_id from the Botpress conversation record.
 * Falls back to `emulator:<channel>` when neither alias nor integration are set,
 * which matches the identity strategy used before the router refactor.
 */
export function resolveIntegrationId(
  conversation: ChannelAdapterContext['conversation'],
  channel: string,
): string {
  if (typeof conversation.alias === 'string' && conversation.alias !== '') return conversation.alias
  if (typeof conversation.integration === 'string' && conversation.integration !== '') {
    return conversation.integration
  }
  return `emulator:${channel}`
}

/** Log helper: single JSON line, no coloring, no formatting. */
export function logEvent(event: string, fields: Record<string, unknown>): void {
  console.info(JSON.stringify({ event, ...fields }))
}
