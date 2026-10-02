import type { TranscriptionResult } from './gemini'

const GROQ_TRANSCRIPTION_URL = 'https://api.groq.com/openai/v1/audio/transcriptions'
export const DEFAULT_GROQ_TRANSCRIPTION_MODEL = 'whisper-large-v3-turbo'

export type GroqTranscribeInput = {
  audio_bytes: Uint8Array
  mime_type: string
  api_key: string
  model?: string
  fetch_impl?: typeof fetch
  timeout_ms?: number
}

function extensionForMime(mimeType: string): string {
  if (mimeType.includes('mpeg') || mimeType.includes('mp3')) return 'mp3'
  if (mimeType.includes('mp4') || mimeType.includes('m4a')) return 'm4a'
  if (mimeType.includes('wav')) return 'wav'
  if (mimeType.includes('flac')) return 'flac'
  if (mimeType.includes('webm')) return 'webm'
  return 'ogg'
}

/** OpenAI-compatible Groq STT adapter. It returns taxonomy only, never provider bodies. */
export async function transcribeWithGroq(input: GroqTranscribeInput): Promise<TranscriptionResult> {
  const model = input.model?.trim() || DEFAULT_GROQ_TRANSCRIPTION_MODEL
  const provider = `groq/${model}`
  const form = new FormData()
  const audioBuffer = new ArrayBuffer(input.audio_bytes.byteLength)
  new Uint8Array(audioBuffer).set(input.audio_bytes)
  form.set('file', new Blob([audioBuffer], { type: input.mime_type }), `audio.${extensionForMime(input.mime_type)}`)
  form.set('model', model)
  form.set('response_format', 'json')
  form.set('temperature', '0')

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), input.timeout_ms ?? 30_000)
  let response: Response
  try {
    response = await (input.fetch_impl ?? fetch)(GROQ_TRANSCRIPTION_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${input.api_key}` },
      body: form,
      signal: controller.signal,
    })
  } catch (error) {
    return {
      status: 'failed',
      reason: error instanceof Error && error.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_ERROR',
      provider,
    }
  } finally {
    clearTimeout(timeout)
  }

  if (!response.ok) {
    return { status: 'failed', reason: `HTTP_${response.status}`, provider }
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    return { status: 'failed', reason: 'INVALID_JSON', provider }
  }
  const text = payload && typeof payload === 'object' && typeof (payload as Record<string, unknown>).text === 'string'
    ? ((payload as Record<string, unknown>).text as string).trim()
    : ''
  if (text === '') return { status: 'failed', reason: 'UNINTELLIGIBLE', provider }
  return { status: 'ok', text, provider }
}
