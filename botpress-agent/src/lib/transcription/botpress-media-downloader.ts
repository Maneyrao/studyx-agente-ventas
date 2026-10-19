const DEFAULT_TIMEOUT_MS = 15_000
const MAX_FILE_BYTES = 25 * 1024 * 1024

export type BotpressMediaDownloadResult =
  | { status: 'ok'; bytes: Uint8Array; size_bytes: number; mime_type: string }
  | { status: 'failed'; reason: string }

export type BotpressAudioDownloadResult = BotpressMediaDownloadResult

function trustedBotpressMediaUrl(raw: string): URL | null {
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:') return null
    if (url.hostname !== 'files.bpcontent.cloud' && !url.hostname.endsWith('.files.bpcontent.cloud')) return null
    return url
  } catch {
    return null
  }
}

async function downloadBotpressMedia(input: {
  url: string
  fetch_impl?: typeof fetch
  timeout_ms?: number
}, acceptsContentType: (mimeType: string) => boolean): Promise<BotpressMediaDownloadResult> {
  const url = trustedBotpressMediaUrl(input.url)
  if (!url) return { status: 'failed', reason: 'UNTRUSTED_MEDIA_URL' }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), input.timeout_ms ?? DEFAULT_TIMEOUT_MS)
  let response: Response
  try {
    response = await (input.fetch_impl ?? fetch)(url, { method: 'GET', signal: controller.signal })
  } catch (error) {
    return {
      status: 'failed',
      reason: error instanceof Error && error.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_ERROR',
    }
  } finally {
    clearTimeout(timeout)
  }

  if (!response.ok) return { status: 'failed', reason: `HTTP_${response.status}` }
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > MAX_FILE_BYTES) {
    return { status: 'failed', reason: 'FILE_TOO_LARGE' }
  }
  const mimeType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() ?? ''
  if (!acceptsContentType(mimeType)) {
    return { status: 'failed', reason: 'UNSUPPORTED_CONTENT_TYPE' }
  }
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength > MAX_FILE_BYTES) return { status: 'failed', reason: 'FILE_TOO_LARGE' }
  return {
    status: 'ok',
    bytes,
    size_bytes: bytes.byteLength,
    mime_type: mimeType === 'application/ogg' ? 'audio/ogg' : mimeType,
  }
}

export async function downloadBotpressAudio(input: {
  url: string
  fetch_impl?: typeof fetch
  timeout_ms?: number
}): Promise<BotpressAudioDownloadResult> {
  return downloadBotpressMedia(
    input,
    (mimeType) => mimeType.startsWith('audio/') || mimeType === 'application/ogg',
  )
}

export async function downloadBotpressImage(input: {
  url: string
  fetch_impl?: typeof fetch
  timeout_ms?: number
}): Promise<BotpressMediaDownloadResult> {
  return downloadBotpressMedia(
    input,
    (mimeType) => ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(mimeType),
  )
}
