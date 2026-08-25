import type {
  CanonicalWorkflowInput,
  ChannelAdapter,
  ChannelAdapterContext,
  ChannelAdapterResult,
} from './shared/normalize'
import { logEvent } from './shared/normalize'
import { emulatorChannel } from './emulator.channel'
import { telegramChannel } from './telegram.channel'
import { whatsappChannel } from './whatsapp.channel'

/**
 * Registered channel adapters, in dispatch priority order.
 *
 * INVARIANT: only ONE Botpress `Conversation` handler exists (the router).
 * Adding a new canal means adding an entry here, NOT a second Conversation
 * with `channel: '*'`. Two wildcard handlers would process each message twice.
 */
export const CHANNEL_ADAPTERS: ChannelAdapter[] = [
  whatsappChannel,
  telegramChannel,
  emulatorChannel,
]

export type DispatchResult =
  | { kind: 'envelope'; adapter: string; input: CanonicalWorkflowInput }
  | { kind: 'skip'; adapter: string | null; reason: string }

/** Pick the first matching adapter, run its normalizer, return either an envelope or a skip reason. */
export function dispatch(ctx: ChannelAdapterContext): DispatchResult {
  const adapter = CHANNEL_ADAPTERS.find((a) => a.matches(ctx))
  if (!adapter) {
    return { kind: 'skip', adapter: null, reason: 'CHANNEL_UNSUPPORTED' }
  }
  const result = adapter.toEnvelope(ctx)
  if (result.kind === 'skip') {
    return { kind: 'skip', adapter: adapter.name, reason: result.reason }
  }
  return { kind: 'envelope', adapter: adapter.name, input: result.input }
}

export { logEvent }
export type { ChannelAdapter, ChannelAdapterContext, ChannelAdapterResult }
