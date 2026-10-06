import { createHmac, randomUUID } from 'node:crypto';
import {
  EnrollmentResponseV1,
  type EnrollmentRequestV1,
} from './contract';

export const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RETRY_AFTER_SECONDS = 3600;

/** v1= + hex(HMAC-SHA256(secret, `${timestamp}.${method}.${path}.${rawBody}`)). */
export function signRequest(input: {
  secret: string;
  timestamp: number | string;
  method: string;
  path: string;
  rawBody: string;
}): string {
  const message = `${input.timestamp}.${input.method}.${input.path}.${input.rawBody}`;
  return `v1=${createHmac('sha256', input.secret).update(message).digest('hex')}`;
}

export type EnrollmentCallOutcome =
  | { kind: 'success'; body: EnrollmentResponseV1 }
  | { kind: 'processing' }
  | { kind: 'not_found' }
  | { kind: 'retry'; code: string; retryAfterSeconds?: number }
  | { kind: 'dead_letter'; code: string };

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function centralErrorCode(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const error = (payload as { error?: unknown }).error;
  if (typeof error !== 'object' || error === null) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && /^[a-z0-9_]{1,64}$/.test(code) ? code : null;
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number.parseInt(value.trim(), 10);
  if (!Number.isFinite(seconds) || seconds < 0) return undefined;
  return Math.min(seconds, MAX_RETRY_AFTER_SECONDS);
}

/**
 * Contract §4/§6 classification. The HTTP status decides; the body `retryable`
 * hint is ignored. A 2xx whose body does not validate is ambiguous (the Central
 * may or may not have enrolled): retry, never success.
 */
export function classifyResponse(input: {
  method: 'GET' | 'POST';
  status: number;
  bodyText: string;
  retryAfterHeader?: string | null;
  paymentId: string;
}): EnrollmentCallOutcome {
  const { method, status } = input;
  const payload = parseJson(input.bodyText);

  if (status === 200 || status === 201 || status === 202) {
    const parsed = EnrollmentResponseV1.safeParse(payload);
    if (!parsed.success || parsed.data.payment_id !== input.paymentId) {
      return { kind: 'retry', code: 'invalid_response' };
    }
    if (status === 202 || parsed.data.enrollment_status === 'processing') {
      return { kind: 'processing' };
    }
    return { kind: 'success', body: parsed.data };
  }
  if (status >= 200 && status < 300) {
    return { kind: 'retry', code: 'unexpected_success_status' };
  }
  if (method === 'GET' && status === 404) return { kind: 'not_found' };
  if (status === 429) {
    return {
      kind: 'retry',
      code: 'rate_limited',
      retryAfterSeconds: parseRetryAfter(input.retryAfterHeader ?? null),
    };
  }
  if (status >= 500 && status <= 599) {
    return { kind: 'retry', code: `http_${status}` };
  }
  // 400/401/409/422 and every other 4xx (or 3xx): the request will not get
  // better by repeating it. Escalate.
  const central = centralErrorCode(payload);
  return { kind: 'dead_letter', code: central ? `central_${central}` : `http_${status}` };
}

export interface CentralCargaClientOptions {
  baseUrl: string;
  signingSecret: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
  requestId?: () => string;
}

export class CentralCargaClient {
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private readonly requestId: () => string;

  constructor(private readonly options: CentralCargaClientOptions) {
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
    this.now = options.now ?? Date.now;
    this.timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
    this.requestId = options.requestId ?? randomUUID;
  }

  createEnrollment(request: EnrollmentRequestV1): Promise<EnrollmentCallOutcome> {
    return this.send({
      method: 'POST',
      path: '/api/v1/enrollments',
      paymentId: request.payment_id,
      body: JSON.stringify(request),
    });
  }

  getEnrollment(paymentId: string): Promise<EnrollmentCallOutcome> {
    return this.send({
      method: 'GET',
      path: `/api/v1/enrollments/${encodeURIComponent(paymentId)}`,
      paymentId,
      body: '',
    });
  }

  private async send(input: {
    method: 'GET' | 'POST';
    path: string;
    paymentId: string;
    body: string;
  }): Promise<EnrollmentCallOutcome> {
    const url = new URL(`${this.options.baseUrl}${input.path}`);
    // The signed path is the full pathname of the final URL, deployment
    // prefix included (contract §2).
    const timestamp = Math.floor(this.now() / 1000);
    const headers: Record<string, string> = {
      'x-studyx-timestamp': String(timestamp),
      'x-studyx-signature': signRequest({
        secret: this.options.signingSecret,
        timestamp,
        method: input.method,
        path: url.pathname,
        rawBody: input.body,
      }),
      'x-request-id': this.requestId(),
    };
    if (input.method === 'POST') {
      headers['content-type'] = 'application/json';
      headers['idempotency-key'] = input.paymentId;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(url.toString(), {
        method: input.method,
        headers,
        body: input.method === 'POST' ? input.body : undefined,
        signal: controller.signal,
        // Never replay a signed request to a redirect target.
        redirect: 'manual',
      });
      const bodyText = await response.text();
      return classifyResponse({
        method: input.method,
        status: response.status,
        bodyText,
        retryAfterHeader: response.headers.get('retry-after'),
        paymentId: input.paymentId,
      });
    } catch (error) {
      const timedOut = controller.signal.aborted
        || (error instanceof Error && error.name === 'AbortError');
      return { kind: 'retry', code: timedOut ? 'timeout' : 'network_error' };
    } finally {
      clearTimeout(timer);
    }
  }
}
