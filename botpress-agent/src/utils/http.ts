import { configuration, secrets, z } from '@botpress/runtime'

const textEncoder = new TextEncoder()

export const ADDITIONAL_RETRIES = 3

/**
 * Matches `agent.config.ts`'s zod default for `requestTimeoutMs`. Belt and
 * suspenders: if a runtime ever hands us a config object where the field
 * failed to apply (undefined rather than the schema's default), a bare
 * `setTimeout(fn, undefined)` would leave the request effectively unbounded
 * instead of failing closed at a known value.
 */
export const DEFAULT_REQUEST_TIMEOUT_MS = 8_000

export function resolveRequestTimeoutMs(): number {
  return configuration.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
}

export type RetryOptions = {
  baseDelayMs?: number
  maxDelayMs?: number
  signal?: AbortSignal
  isRetryable?: (error: unknown) => boolean
  /**
   * Retries on top of the first attempt. Defaults to ADDITIONAL_RETRIES for
   * critical idempotent operations; degradable reads (catalog) pass 1 so a
   * missing catalog costs at most one extra round trip, never three.
   */
  additionalRetries?: number
}

export class StudyxHttpError extends Error {
  constructor(
    public readonly code: string,
    public readonly retryable: boolean,
    public readonly status: number | null = null,
    public readonly attempts = 1,
  ) {
    super(code)
    this.name = 'StudyxHttpError'
  }

  withAttempts(attempts: number): StudyxHttpError {
    return new StudyxHttpError(this.code, this.retryable, this.status, attempts)
  }
}

export function isRetryableStatus(status: number): boolean {
  return [408, 425, 429, 500, 502, 503, 504].includes(status)
}

function defaultRetryable(error: unknown): boolean {
  if (error instanceof StudyxHttpError) return error.retryable
  if (error instanceof DOMException && error.name === 'AbortError') return true
  return error instanceof TypeError
}

function randomDelay(
  retryIndex: number,
  baseDelayMs: number,
  maxDelayMs: number,
): number {
  const ceiling = Math.min(maxDelayMs, baseDelayMs * 2 ** retryIndex)
  return Math.floor(Math.random() * (ceiling + 1))
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted)
    return Promise.reject(new DOMException('Aborted', 'AbortError'))

  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(new DOMException('Aborted', 'AbortError'))
      },
      { once: true },
    )
  })
}

export async function withFullJitterRetry<T>(
  operation: (attempt: number) => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const baseDelayMs = options.baseDelayMs ?? configuration.retryBaseDelayMs
  const maxDelayMs = options.maxDelayMs ?? configuration.retryMaxDelayMs
  const retryable = options.isRetryable ?? defaultRetryable
  const additionalRetries = Math.max(
    0,
    options.additionalRetries ?? ADDITIONAL_RETRIES,
  )
  let lastError: unknown
  let attempts = 0

  for (let attempt = 0; attempt <= additionalRetries; attempt++) {
    attempts = attempt + 1
    if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError')

    try {
      return await operation(attempt)
    } catch (error) {
      lastError = error
      if (!retryable(error) || attempt === additionalRetries) break
      await sleep(randomDelay(attempt, baseDelayMs, maxDelayMs), options.signal)
    }
  }

  if (lastError instanceof StudyxHttpError) {
    throw lastError.withAttempts(attempts)
  }
  throw lastError
}

async function hmacHex(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    textEncoder.encode(value),
  )
  return Array.from(new Uint8Array(signature), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
}

function parseErrorCode(payload: unknown, fallback: string): string {
  if (
    payload &&
    typeof payload === 'object' &&
    'error' in payload &&
    typeof payload.error === 'string'
  ) {
    return payload.error.slice(0, 128)
  }
  return fallback
}

async function parseResponsePayload(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('application/json')) return null
  return response.json().catch(() => null)
}

export async function requestStudyxJson<T>(params: {
  path: string
  method?: 'GET' | 'POST'
  body?: unknown
  idempotencyKey: string
  traceId: string
  responseSchema: z.ZodType<T>
  /**
   * Statuses whose body carries the answer rather than an error.
   *
   * The claim endpoint uses 202/409/410 to say "you are not the owner", which
   * is a normal, expected outcome — turning it into a thrown error would make
   * the losing workflow look like a failure and invite a retry that must never
   * happen.
   */
  acceptStatuses?: number[]
  /** See RetryOptions.additionalRetries. Omit for the conservative default. */
  additionalRetries?: number
}): Promise<T> {
  const method = params.method ?? 'POST'
  const url = new URL(params.path, configuration.apiBaseUrl)
  const body = params.body === undefined ? '' : JSON.stringify(params.body)
  const requestId = `${params.traceId}:${params.idempotencyKey}`.slice(0, 512)

  return withFullJitterRetry(
    async (attempt) => {
      const attemptStartedAt = Date.now()
      // Content-free per-attempt telemetry: enough to compute p50/p95/p99 and
      // attempt counts per stage and trace, with no PII and no secrets.
      const logAttempt = (status: number | 'error', code: string | null) => {
        console.info(
          JSON.stringify({
            event: 'studyx.http.attempt',
            trace_id: params.traceId,
            path: url.pathname,
            method,
            attempt: attempt + 1,
            status,
            error_code: code,
            duration_ms: Date.now() - attemptStartedAt,
          })
        )
      }
      const timestamp = Date.now().toString()
      const canonical = [timestamp, method, url.pathname, body].join('\n')
      const signature = await hmacHex(secrets.STUDYX_SIGNING_SECRET, canonical)
      const controller = new AbortController()
      const timeout = setTimeout(
        () => controller.abort(),
        resolveRequestTimeoutMs(),
      )

      try {
        const response = await fetch(url, {
          method,
          headers: {
            'content-type': 'application/json',
            'x-orchestrator-key-id': configuration.orchestratorKeyId,
            'x-orchestrator-key': secrets.STUDYX_ORCHESTRATOR_KEY,
            'x-request-timestamp': timestamp,
            'x-signature': `v1=${signature}`,
            'x-request-id': requestId,
            'x-trace-id': params.traceId,
            'idempotency-key': params.idempotencyKey,
          },
          body: body || undefined,
          signal: controller.signal,
        })

        const payload = await parseResponsePayload(response)
        const accepted =
          response.ok ||
          (params.acceptStatuses?.includes(response.status) ?? false)
        if (!accepted) {
          throw new StudyxHttpError(
            parseErrorCode(payload, `HTTP_${response.status}`),
            isRetryableStatus(response.status),
            response.status,
          )
        }

        const parsed = params.responseSchema.safeParse(payload)
        if (!parsed.success) {
          throw new StudyxHttpError(
            'INVALID_STUDYX_RESPONSE',
            false,
            response.status,
          )
        }
        logAttempt(response.status, null)
        return parsed.data
      } catch (error) {
        const normalized =
          error instanceof StudyxHttpError
            ? error
            : error instanceof DOMException && error.name === 'AbortError'
              ? new StudyxHttpError('STUDYX_TIMEOUT', true)
              : error instanceof TypeError
                ? new StudyxHttpError('STUDYX_NETWORK_ERROR', true)
                : new StudyxHttpError('STUDYX_REQUEST_FAILED', false)
        logAttempt(normalized.status ?? 'error', normalized.code)
        throw normalized
      } finally {
        clearTimeout(timeout)
      }
    },
    { additionalRetries: params.additionalRetries },
  )
}
