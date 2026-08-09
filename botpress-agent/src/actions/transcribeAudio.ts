import { Action, secrets, z } from '@botpress/runtime'
import { AudioReferenceSchema } from '../schemas/contracts'
import { transcribeWithGemini } from '../lib/transcription/gemini'
import { downloadTelegramFile } from '../lib/transcription/telegram-downloader'

export const TranscribeAudioInputSchema = z.object({
  audio_reference: AudioReferenceSchema,
  provider_source: z.enum(['telegram_sandbox']),
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
  description: 'Downloads an audio file from the source provider and returns the transcribed text via Gemini.',
  input: TranscribeAudioInputSchema as any,
  output: TranscribeAudioOutputSchema as any,
  cached: false,
  async handler({ input }: { input: unknown }): Promise<TranscribeAudioOutput> {
    const parsed = TranscribeAudioInputSchema.parse(input)
    const { audio_reference, provider_source } = parsed

    // Step 1 — download audio bytes from the source provider.
    let bytes: Uint8Array
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
    } else {
      return {
        status: 'failed',
        text: '[audio_no_transcrito]',
        provider: provider_source,
        reason: 'UNSUPPORTED_PROVIDER',
      }
    }

    // Step 2 — transcribe with Gemini.
    const apiKey = secrets.GEMINI_API_KEY
    if (typeof apiKey !== 'string' || apiKey === '') {
      return {
        status: 'failed',
        text: '[audio_no_transcrito]',
        provider: 'gemini',
        reason: 'MISSING_GEMINI_API_KEY',
      }
    }

    const transcription = await transcribeWithGemini({
      audio_bytes: bytes,
      mime_type: audio_reference.mime_type,
      api_key: apiKey,
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
