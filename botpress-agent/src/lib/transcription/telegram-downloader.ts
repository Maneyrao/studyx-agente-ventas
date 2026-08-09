/**
 * Pure Telegram file downloader. Two-step: getFile → fetch bytes. No SDK.
 *
 * Endpoints:
 *   1. https://api.telegram.org/bot<TOKEN>/getFile?file_id=<ID>
 *      → { ok: true, result: { file_id, file_path: "voice/file_1.oga", ... } }
 *   2. https://api.telegram.org/file/bot<TOKEN>/<file_path>
 *      → binary bytes
 *
 * The file_path expires quickly (Telegram limit ~1 hour). This function does
 * both steps back-to-back so the download completes inside the window.
 */

const TELEGRAM_API_BASE = 'https://api.telegram.org'
const DEFAULT_TIMEOUT_MS = 15_000
const MAX_FILE_BYTES = 20 * 1024 * 1024 // Telegram's upper limit; safety cap.

export type TelegramDownloadOk = {
  status: 'ok'
  bytes: Uint8Array
  file_path: string
  size_bytes: number
}

export type TelegramDownloadFailed = {
  status: 'failed'
  reason: string
}

export type TelegramDownloadResult = TelegramDownloadOk | TelegramDownloadFailed

export type TelegramDownloadInput = {
  file_id: string
  bot_token: string
  fetch_impl?: typeof fetch
  timeout_ms?: number
  api_base?: string
}

export async function downloadTelegramFile(
  input: TelegramDownloadInput,
): Promise<TelegramDownloadResult> {
  const fetchImpl = input.fetch_impl ?? fetch
  const apiBase = input.api_base ?? TELEGRAM_API_BASE
  const timeoutMs = input.timeout_ms ?? DEFAULT_TIMEOUT_MS

  // Step 1 — resolve file_path
  const filePathResult = await resolveFilePath(input.file_id, input.bot_token, fetchImpl, apiBase, timeoutMs)
  if (filePathResult.status === 'failed') return filePathResult

  // Step 2 — download bytes
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  const downloadUrl = `${apiBase}/file/bot${input.bot_token}/${filePathResult.file_path}`

  let response: Response
  try {
    response = await fetchImpl(downloadUrl, { method: 'GET', signal: controller.signal })
  } catch (err) {
    return {
      status: 'failed',
      reason: err instanceof Error && err.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_ERROR',
    }
  } finally {
    clearTimeout(timeout)
  }

  if (!response.ok) {
    return { status: 'failed', reason: `HTTP_${response.status}` }
  }

  const buffer = await response.arrayBuffer()
  if (buffer.byteLength > MAX_FILE_BYTES) {
    return { status: 'failed', reason: `FILE_TOO_LARGE_${buffer.byteLength}` }
  }
  const bytes = new Uint8Array(buffer)

  return {
    status: 'ok',
    bytes,
    file_path: filePathResult.file_path,
    size_bytes: bytes.length,
  }
}

async function resolveFilePath(
  file_id: string,
  bot_token: string,
  fetchImpl: typeof fetch,
  apiBase: string,
  timeoutMs: number,
): Promise<{ status: 'ok'; file_path: string } | TelegramDownloadFailed> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  const url = `${apiBase}/bot${bot_token}/getFile?file_id=${encodeURIComponent(file_id)}`

  let response: Response
  try {
    response = await fetchImpl(url, { method: 'GET', signal: controller.signal })
  } catch (err) {
    return {
      status: 'failed',
      reason: err instanceof Error && err.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_ERROR',
    }
  } finally {
    clearTimeout(timeout)
  }

  if (!response.ok) {
    return { status: 'failed', reason: `GETFILE_HTTP_${response.status}` }
  }

  let payload: { ok?: boolean; result?: { file_path?: string }; description?: string }
  try {
    payload = (await response.json()) as typeof payload
  } catch {
    return { status: 'failed', reason: 'INVALID_JSON' }
  }

  if (payload.ok !== true) {
    return { status: 'failed', reason: `TELEGRAM_${payload.description ?? 'UNKNOWN'}` }
  }
  const filePath = payload.result?.file_path
  if (typeof filePath !== 'string' || filePath === '') {
    return { status: 'failed', reason: 'NO_FILE_PATH' }
  }
  return { status: 'ok', file_path: filePath }
}
