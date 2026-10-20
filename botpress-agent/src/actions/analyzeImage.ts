import { Action, secrets, z } from '@botpress/runtime'
import { downloadBotpressImage } from '../lib/transcription/botpress-media-downloader'
import { describeImageWithGemini } from '../lib/transcription/gemini'

export const AnalyzeImageInputSchema = z.object({
  media_download_url: z.string().url().max(2048),
})

export const AnalyzeImageOutputSchema = z.object({
  status: z.enum(['ok', 'failed']),
  text: z.string(),
  provider: z.string(),
  reason: z.string().nullable().default(null),
})

export type AnalyzeImageOutput = z.infer<typeof AnalyzeImageOutputSchema>

export const analyzeImage = new Action<any, any>({
  name: 'analyzeImage',
  title: 'Understand an inbound image message',
  description: 'Downloads a WhatsApp image from Botpress Files and converts it to safe conversational text with Gemini.',
  input: AnalyzeImageInputSchema as any,
  output: AnalyzeImageOutputSchema as any,
  cached: false,
  async handler({ input }: { input: unknown }): Promise<AnalyzeImageOutput> {
    const parsed = AnalyzeImageInputSchema.parse(input)
    const apiKey = secrets.GEMINI_API_KEY
    if (typeof apiKey !== 'string' || apiKey.trim() === '') {
      return {
        status: 'failed',
        text: '[imagen_no_interpretada]',
        provider: 'disabled',
        reason: 'MISSING_GEMINI_API_KEY',
      }
    }

    const download = await downloadBotpressImage({ url: parsed.media_download_url })
    if (download.status === 'failed') {
      return {
        status: 'failed',
        text: '[imagen_no_interpretada]',
        provider: 'botpress_files',
        reason: `DOWNLOAD_${download.reason}`,
      }
    }

    const description = await describeImageWithGemini({
      image_bytes: download.bytes,
      mime_type: download.mime_type,
      api_key: apiKey,
    })
    if (description.status === 'failed') {
      return {
        status: 'failed',
        text: '[imagen_no_interpretada]',
        provider: description.provider,
        reason: description.reason,
      }
    }
    return {
      status: 'ok',
      text: description.text,
      provider: description.provider,
      reason: null,
    }
  },
})
