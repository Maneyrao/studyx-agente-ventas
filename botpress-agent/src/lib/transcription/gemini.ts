/**
 * Pure Gemini transcription. No dependency on `@botpress/runtime` or the
 * Google SDK — uses raw fetch so the same code is unit-testable with a mocked
 * global fetch and portable to any runtime the ADK might bundle for.
 *
 * Uses `gemini-2.5-flash` by default (multimodal, cheap, 1M input tokens).
 */

const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta'
const DEFAULT_MODEL = 'gemini-2.5-flash'
const TRANSCRIPTION_INSTRUCTION =
  'Transcribí exactamente el audio a texto en el idioma original. Devolvé sólo el texto transcrito, sin comillas, sin comentarios, sin marcadores de tiempo, sin descripción de tonos ni ruidos. Si el audio está en silencio o es ininteligible, devolvé exactamente "[audio_ininteligible]".'

export type TranscriptionOk = {
  status: 'ok'
  text: string
  provider: string
}

export type TranscriptionFailed = {
  status: 'failed'
  reason: string
  provider: string
}

export type TranscriptionResult = TranscriptionOk | TranscriptionFailed

export type GeminiTranscribeInput = {
  audio_bytes: Uint8Array
  mime_type: string
  api_key: string
  model?: string
  fetch_impl?: typeof fetch
  timeout_ms?: number
}

function bytesToBase64(bytes: Uint8Array): string {
  // Node has Buffer; browsers/edge runtimes have btoa on a binary string.
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64')
  }
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  // eslint-disable-next-line no-restricted-globals
  return btoa(binary)
}

export async function transcribeWithGemini(input: GeminiTranscribeInput): Promise<TranscriptionResult> {
  const model = input.model ?? DEFAULT_MODEL
  const providerLabel = `gemini/${model}`
  const url = `${GEMINI_BASE_URL}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(input.api_key)}`

  const body = {
    contents: [
      {
        role: 'user',
        parts: [
          { text: TRANSCRIPTION_INSTRUCTION },
          {
            inline_data: {
              mime_type: input.mime_type,
              data: bytesToBase64(input.audio_bytes),
            },
          },
        ],
      },
    ],
    generation_config: {
      temperature: 0,
      max_output_tokens: 1024,
      response_mime_type: 'text/plain',
    },
  }

  const fetchImpl = input.fetch_impl ?? fetch
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), input.timeout_ms ?? 30_000)

  let response: Response
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
  } catch (err) {
    return {
      status: 'failed',
      reason: err instanceof Error && err.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_ERROR',
      provider: providerLabel,
    }
  } finally {
    clearTimeout(timeout)
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    return {
      status: 'failed',
      reason: `HTTP_${response.status}${detail ? `:${detail.slice(0, 200)}` : ''}`,
      provider: providerLabel,
    }
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    return { status: 'failed', reason: 'INVALID_JSON', provider: providerLabel }
  }

  const text = extractGeminiText(payload)
  if (text === null) {
    return { status: 'failed', reason: 'NO_TEXT_IN_RESPONSE', provider: providerLabel }
  }

  const trimmed = text.trim()
  if (trimmed === '' || trimmed === '[audio_ininteligible]') {
    return { status: 'failed', reason: 'UNINTELLIGIBLE', provider: providerLabel }
  }

  return { status: 'ok', text: trimmed, provider: providerLabel }
}

function extractGeminiText(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const p = payload as Record<string, unknown>
  const candidates = p.candidates
  if (!Array.isArray(candidates) || candidates.length === 0) return null
  const first = candidates[0] as Record<string, unknown> | undefined
  if (!first) return null
  const content = first.content as Record<string, unknown> | undefined
  if (!content) return null
  const parts = content.parts
  if (!Array.isArray(parts) || parts.length === 0) return null
  const textParts: string[] = []
  for (const part of parts) {
    if (part && typeof part === 'object' && typeof (part as Record<string, unknown>).text === 'string') {
      textParts.push((part as Record<string, unknown>).text as string)
    }
  }
  return textParts.length > 0 ? textParts.join('') : null
}
