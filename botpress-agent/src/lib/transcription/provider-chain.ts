import { transcribeWithGemini, type TranscriptionResult } from './gemini'
import { transcribeWithGroq } from './groq'

export type SttProvider = 'groq' | 'gemini'
export type SttProviderConfiguration = {
  provider: SttProvider
  api_key: string | undefined
  model: string
}

type ProviderAdapter = (input: {
  audio_bytes: Uint8Array
  mime_type: string
  api_key: string
  model: string
}) => Promise<TranscriptionResult>

export type ProviderChainInput = {
  audio_bytes: Uint8Array
  mime_type: string
  providers: readonly SttProviderConfiguration[]
  adapters?: { groq: ProviderAdapter; gemini: ProviderAdapter }
}

const DEFAULT_ADAPTERS = {
  groq: transcribeWithGroq,
  gemini: transcribeWithGemini,
} satisfies Record<SttProvider, ProviderAdapter>

/** At most one attempt per distinct configured provider; no hidden retry loop. */
export async function transcribeWithProviderChain(
  input: ProviderChainInput,
): Promise<TranscriptionResult> {
  const adapters = input.adapters ?? DEFAULT_ADAPTERS
  const attempted = new Set<SttProvider>()
  let lastFailure: TranscriptionResult | null = null

  for (const candidate of input.providers) {
    if (attempted.has(candidate.provider)) continue
    if (typeof candidate.api_key !== 'string' || candidate.api_key.trim() === '') continue
    if (candidate.model.trim() === '') continue
    attempted.add(candidate.provider)
    let result: TranscriptionResult
    try {
      result = await adapters[candidate.provider]({
        audio_bytes: input.audio_bytes,
        mime_type: input.mime_type,
        api_key: candidate.api_key,
        model: candidate.model,
      })
    } catch {
      result = {
        status: 'failed',
        reason: 'PROVIDER_ERROR',
        provider: `${candidate.provider}/${candidate.model}`,
      }
    }
    if (result.status === 'ok') return result
    lastFailure = result
  }

  return lastFailure ?? { status: 'failed', reason: 'STT_DISABLED', provider: 'disabled' }
}
