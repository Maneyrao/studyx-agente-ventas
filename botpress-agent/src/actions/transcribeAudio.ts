import { Action, configuration, secrets, z } from '@botpress/runtime'
import { AudioReferenceSchema } from '../schemas/contracts'
import { downloadBotpressAudio } from '../lib/transcription/botpress-media-downloader'
import {
  transcribeWithProviderChain,
  type SttProvider,
  type SttProviderConfiguration,
} from '../lib/transcription/provider-chain'
import { DEFAULT_GROQ_TRANSCRIPTION_MODEL } from '../lib/transcription/groq'
import { downloadTelegramFile } from '../lib/transcription/telegram-downloader'

export const TranscribeAudioInputSchema = z.object({
  audio_reference: AudioReferenceSchema,
  provider_source: z.enum(['telegram_sandbox', 'whatsapp_botpress']),
  media_download_url: z.string().url().max(2048).optional(),
})

export const TranscribeAudioOutputSchema = z.object({
  status: z.enum(['ok', 'failed']),
  text: z.string(),
  provider: z.string(),
  reason: z.string().nullable().default(null),
})

export type TranscribeAudioInput = z.infer<typeof TranscribeAudioInputSchema>
export type TranscribeAudioOutput = z.infer<typeof TranscribeAudioOutputSchema>

// ADK 2.0.5 duplicate-zui workaround (same pattern used by ingestTurn).
export const transcribeAudio = new Action<any, any>({
  name: 'transcribeAudio',
  title: 'Transcribe an inbound audio message',
  description: 'Downloads an audio file and transcribes it through the configured primary/fallback STT providers.',
  input: TranscribeAudioInputSchema as any,
  output: TranscribeAudioOutputSchema as any,
  cached: false,
  async handler({ input }: { input: unknown }): Promise<TranscribeAudioOutput> {
    const parsed = TranscribeAudioInputSchema.parse(input)
    const { audio_reference, provider_source, media_download_url } = parsed

    const configuredProviders = [
      configuration.audioTranscriptionPrimaryProvider,
      configuration.audioTranscriptionFallbackProvider,
    ].filter((provider): provider is SttProvider => provider === 'groq' || provider === 'gemini')
    const groqModel = typeof configuration.groqTranscriptionModel === 'string'
      ? configuration.groqTranscriptionModel
      : DEFAULT_GROQ_TRANSCRIPTION_MODEL
    const geminiModel = typeof configuration.geminiTranscriptionModel === 'string'
      ? configuration.geminiTranscriptionModel
      : ''
    const providerConfigurations: SttProviderConfiguration[] = configuredProviders.map((provider) => ({
      provider,
      api_key: provider === 'groq' ? secrets.GROQ_API_KEY : secrets.GEMINI_API_KEY,
      model: provider === 'groq'
        ? groqModel
        : geminiModel,
    }))
    const hasUsableProvider = providerConfigurations.some((provider) => (
      typeof provider.api_key === 'string'
      && provider.api_key.trim() !== ''
      && provider.model.trim() !== ''
    ))
    if (!hasUsableProvider) {
      return {
        status: 'failed',
        text: '[audio_no_transcrito]',
        provider: 'disabled',
        reason: configuredProviders.length === 0 ? 'STT_DISABLED' : 'STT_CONFIGURATION_INCOMPLETE',
      }
    }

    // Step 1 — download audio bytes from the source provider.
    let bytes: Uint8Array
    let mimeType = audio_reference.mime_type
    if (provider_source === 'telegram_sandbox') {
      const token = secrets.TELEGRAM_BOT_A_TOKEN
      if (typeof token !== 'string' || token === '') {
        return {
          status: 'failed',
          text: '[audio_no_transcrito]',
          provider: 'telegram_sandbox',
          reason: 'MISSING_TELEGRAM_BOT_A_TOKEN',
        }
      }
      const download = await downloadTelegramFile({
        file_id: audio_reference.provider_file_id,
        bot_token: token,
      })
      if (download.status === 'failed') {
        return {
          status: 'failed',
          text: '[audio_no_transcrito]',
          provider: 'telegram_sandbox',
          reason: `DOWNLOAD_${download.reason}`,
        }
      }
      bytes = download.bytes
    } else if (provider_source === 'whatsapp_botpress') {
      if (typeof media_download_url !== 'string' || media_download_url === '') {
        return {
          status: 'failed',
          text: '[audio_no_transcrito]',
          provider: provider_source,
          reason: 'MISSING_MEDIA_DOWNLOAD_URL',
        }
      }
      const download = await downloadBotpressAudio({ url: media_download_url })
      if (download.status === 'failed') {
        return {
          status: 'failed',
          text: '[audio_no_transcrito]',
          provider: provider_source,
          reason: `DOWNLOAD_${download.reason}`,
        }
      }
      bytes = download.bytes
      mimeType = download.mime_type
    } else {
      return { status: 'failed', text: '[audio_no_transcrito]', provider: provider_source, reason: 'UNSUPPORTED_PROVIDER' }
    }

    // Step 2 — one request per configured provider, in configured order.
    const transcription = await transcribeWithProviderChain({
      audio_bytes: bytes,
      mime_type: mimeType,
      providers: providerConfigurations,
    })

    if (transcription.status === 'ok') {
      return {
        status: 'ok',
        text: transcription.text,
        provider: transcription.provider,
        reason: null,
      }
    }
    return {
      status: 'failed',
      text: '[audio_no_transcrito]',
      provider: transcription.provider,
      reason: transcription.reason,
    }
  },
})
