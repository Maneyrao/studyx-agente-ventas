import { describe, expect, it, vi } from 'vitest';
import {
  CentralCargaClient,
  classifyResponse,
  signRequest,
} from '@/features/fulfillment/central-carga/client';
import { CentralCargaConfigError, loadCentralCargaConfig } from '@/features/fulfillment/central-carga/config';
import {
  buildEnrollmentRequest,
  formatAmount,
  type EnrollmentSource,
} from '@/features/fulfillment/central-carga/contract';
import {
  computeBackoffSeconds,
  effectiveMaxAttempts,
  preflight,
} from '@/features/fulfillment/central-carga/policy';

const PAYMENT_ID = '6f1c2a9e-4b7d-4c1e-9a55-0d3e8b2f71aa';

function source(overrides: Partial<EnrollmentSource> = {}): EnrollmentSource {
  return {
    payment_id: PAYMENT_ID,
    workspace_id: '0b8d5a5e-1f3c-4d0a-8d6b-2f1d0c9a7e11',
    contact_id: 'c41e3b2a-6d5f-4e8a-9b7c-1a2b3c4d5e6f',
    environment: 'live',
    provider: 'stripe',
    provider_session_id: 'cs_live_abc',
    paid_at: new Date('2026-10-06T14:03:12Z'),
    amount: '45000',
    currency: 'ARS',
    plan_code: 'monthly_12',
    contact_name: ' María Pérez ',
    contact_email: ' Maria@Example.com ',
    contact_phone: '+5491155550000',
    contact_declared_phone: null,
    offering_code: 'ESTETICA-INTEGRAL',
    offering_display_name: 'Estética Integral',
    ...overrides,
  };
}

const okBody = {
  payment_id: PAYMENT_ID,
  enrollment_id: 'enr_1',
  student_id: 'stu_1',
  enrollment_status: 'active',
  student_was_created: true,
  access: { login_email: 'maria@example.com', welcome_sent: true },
  created_at: '2026-10-06T14:03:15Z',
};

describe('HMAC signature', () => {
  it('matches fixed vectors for POST (with deployment prefix) and GET (empty body)', () => {
    expect(signRequest({
      secret: 'test-secret-0123456789',
      timestamp: 1760000000,
      method: 'POST',
      path: '/central-carga/api/v1/enrollments',
      rawBody: '{"a":1}',
    })).toBe('v1=a47db128577d48396587826617dd466366249de2995f573ad766a6e4a06db913');
    expect(signRequest({
      secret: 'test-secret-0123456789',
      timestamp: '1760000000',
      method: 'GET',
      path: `/api/v1/enrollments/${PAYMENT_ID}`,
      rawBody: '',
    })).toBe('v1=7b51fee27dfe035e45c42265372dd777241f434a7329b58c5bfcf13067f8591e');
  });
});

describe('payload construction', () => {
  it('uses phone when there is no declared_phone, normalizes email and amount', () => {
    const parsed = buildEnrollmentRequest(source());
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.student).toEqual({
      full_name: 'María Pérez',
      email: 'maria@example.com',
      phone: '+5491155550000',
    });
    expect(parsed.data.payment.amount).toBe('45000.00');
    expect(parsed.data.payment.paid_at).toBe('2026-10-06T14:03:12.000Z');
  });

  it('prefers declared_phone over the channel phone', () => {
    const parsed = buildEnrollmentRequest(source({ contact_declared_phone: '+5491166667777' }));
    expect(parsed.success && parsed.data.student.phone).toBe('+5491166667777');
  });

  it('sends plan_code null for pre-correlation payments', () => {
    const parsed = buildEnrollmentRequest(source({ plan_code: null }));
    expect(parsed.success && parsed.data.payment.plan_code).toBeNull();
  });

  it('rejects incomplete identity or malformed phone without throwing', () => {
    expect(buildEnrollmentRequest(source({ contact_email: null })).success).toBe(false);
    expect(buildEnrollmentRequest(source({ contact_name: '  ' })).success).toBe(false);
    expect(buildEnrollmentRequest(source({ contact_declared_phone: '12345' })).success).toBe(false);
  });

  it('formats amounts with exactly two decimals', () => {
    expect(formatAmount('45000')).toBe('45000.00');
    expect(formatAmount('0.5')).toBe('0.50');
    expect(formatAmount('150000.00')).toBe('150000.00');
  });
});

describe('response classification', () => {
  const base = { paymentId: PAYMENT_ID };
  const text = (value: unknown) => JSON.stringify(value);

  it('maps 200/201 valid bodies to success and 202 to processing', () => {
    expect(classifyResponse({ ...base, method: 'POST', status: 201, bodyText: text(okBody) }).kind).toBe('success');
    expect(classifyResponse({ ...base, method: 'GET', status: 200, bodyText: text(okBody) }).kind).toBe('success');
    expect(classifyResponse({
      ...base, method: 'POST', status: 202,
      bodyText: text({ ...okBody, enrollment_status: 'processing' }),
    }).kind).toBe('processing');
  });

  it('never treats an invalid or mismatched 2xx as success', () => {
    for (const bodyText of ['not json', text({ ...okBody, enrollment_id: '' }), text({ ...okBody, payment_id: 'f'.repeat(8) + '-0000-4000-8000-000000000000' })]) {
      expect(classifyResponse({ ...base, method: 'POST', status: 201, bodyText })).toEqual({
        kind: 'retry', code: 'invalid_response',
      });
    }
    expect(classifyResponse({ ...base, method: 'POST', status: 204, bodyText: '' }).kind).toBe('retry');
  });

  it('retries 429 honoring retry-after and 5xx', () => {
    expect(classifyResponse({ ...base, method: 'POST', status: 429, bodyText: '', retryAfterHeader: '120' }))
      .toEqual({ kind: 'retry', code: 'rate_limited', retryAfterSeconds: 120 });
    expect(classifyResponse({ ...base, method: 'POST', status: 429, bodyText: '', retryAfterHeader: 'soon' }))
      .toEqual({ kind: 'retry', code: 'rate_limited', retryAfterSeconds: undefined });
    for (const status of [500, 502, 503, 504]) {
      expect(classifyResponse({ ...base, method: 'POST', status, bodyText: '' }).kind).toBe('retry');
    }
  });

  it('dead-letters 400/401/409/422 and other 4xx, keeping only a safe code', () => {
    const conflict = text({ error: { code: 'idempotency_conflict', message: 'x@y.com differs' } });
    expect(classifyResponse({ ...base, method: 'POST', status: 409, bodyText: conflict }))
      .toEqual({ kind: 'dead_letter', code: 'central_idempotency_conflict' });
    for (const status of [400, 401, 403, 422, 418]) {
      expect(classifyResponse({ ...base, method: 'POST', status, bodyText: '' }))
        .toEqual({ kind: 'dead_letter', code: `http_${status}` });
    }
    expect(classifyResponse({ ...base, method: 'POST', status: 422, bodyText: text({ error: { code: 'Has Spaces!' } }) }))
      .toEqual({ kind: 'dead_letter', code: 'http_422' });
  });

  it('GET 404 is not_found, but POST 404 is dead letter', () => {
    expect(classifyResponse({ ...base, method: 'GET', status: 404, bodyText: '' }).kind).toBe('not_found');
    expect(classifyResponse({ ...base, method: 'POST', status: 404, bodyText: '' }).kind).toBe('dead_letter');
  });
});

describe('backoff', () => {
  it('grows exponentially with bounded jitter and a cap', () => {
    expect(computeBackoffSeconds(1, () => 0.5)).toBe(30);
    expect(computeBackoffSeconds(2, () => 0.5)).toBe(60);
    expect(computeBackoffSeconds(3, () => 0.5)).toBe(120);
    expect(computeBackoffSeconds(1, () => 0)).toBe(23);
    expect(computeBackoffSeconds(1, () => 1)).toBe(38);
    expect(computeBackoffSeconds(30, () => 1)).toBeLessThanOrEqual(4500);
  });

  it('never allows more than three attempts', () => {
    expect(effectiveMaxAttempts(5)).toBe(3);
    expect(effectiveMaxAttempts(2)).toBe(2);
  });
});

describe('preflight', () => {
  const ctx = { paymentStatus: 'paid', sandboxContact: false, environment: 'live' as const, paidAfter: new Date('2026-10-01T00:00:00Z') };

  it('proceeds for an in-scope payment', () => {
    expect(preflight({ source: source(), ...ctx })).toEqual({ action: 'proceed' });
  });

  it.each([
    ['fake provider', { provider: 'fake' }, 'unsupported_provider'],
    ['test environment against live worker', { environment: 'test' }, 'environment_mismatch'],
    ['paid before cutoff', { paid_at: new Date('2026-09-30T23:59:59Z') }, 'before_enrollment_cutoff'],
    ['missing paid_at', { paid_at: null }, 'before_enrollment_cutoff'],
  ])('skips %s', (_label, overrides, code) => {
    expect(preflight({ source: source(overrides), ...ctx })).toEqual({ action: 'skip', code });
  });

  it('skips refunded payments and sandbox contacts', () => {
    expect(preflight({ source: source(), ...ctx, paymentStatus: 'refunded' })).toEqual({ action: 'skip', code: 'payment_not_paid' });
    expect(preflight({ source: source(), ...ctx, sandboxContact: true })).toEqual({ action: 'skip', code: 'sandbox_contact' });
  });

  it('dead-letters missing name or email', () => {
    expect(preflight({ source: source({ contact_email: null }), ...ctx })).toEqual({ action: 'dead_letter', code: 'missing_student_identity' });
    expect(preflight({ source: source({ contact_name: ' ' }), ...ctx })).toEqual({ action: 'dead_letter', code: 'missing_student_identity' });
  });
});

describe('config', () => {
  const full = {
    CENTRAL_CARGA_ENABLED: 'true',
    CENTRAL_CARGA_BASE_URL: 'https://example.test/central-carga/',
    CENTRAL_CARGA_SIGNING_SECRET: 'x'.repeat(32),
    CENTRAL_CARGA_ENVIRONMENT: 'live',
    CENTRAL_CARGA_ENROLL_PAID_AFTER: '2026-10-06T00:00:00Z',
  };

  it('is disabled by default and when not exactly true', () => {
    expect(loadCentralCargaConfig({})).toEqual({ enabled: false });
    expect(loadCentralCargaConfig({ ...full, CENTRAL_CARGA_ENABLED: 'yes' })).toEqual({ enabled: false });
  });

  it('requires every setting when enabled and never echoes values', () => {
    const withoutCutoff: Record<string, string | undefined> = { ...full };
    delete withoutCutoff.CENTRAL_CARGA_ENROLL_PAID_AFTER;
    expect(() => loadCentralCargaConfig(withoutCutoff)).toThrow(CentralCargaConfigError);
    expect(() => loadCentralCargaConfig({ ...full, CENTRAL_CARGA_SIGNING_SECRET: 'short' }))
      .toThrow(/CENTRAL_CARGA_SIGNING_SECRET/);
    try {
      loadCentralCargaConfig({ ...full, CENTRAL_CARGA_BASE_URL: 'http://evil.example' });
    } catch (error) {
      expect(String(error)).not.toContain('evil.example');
    }
    expect(() => loadCentralCargaConfig({ ...full, CENTRAL_CARGA_ENVIRONMENT: 'staging' })).toThrow();
  });

  it('parses a valid config and trims the trailing slash', () => {
    const config = loadCentralCargaConfig(full);
    expect(config.enabled && config.baseUrl).toBe('https://example.test/central-carga');
    expect(config.enabled && config.paidAfter.toISOString()).toBe('2026-10-06T00:00:00.000Z');
  });
});

describe('client request shape', () => {
  it('signs the full pathname (with prefix) and sends the contract headers', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(okBody), { status: 201 }));
    const client = new CentralCargaClient({
      baseUrl: 'https://example.test/central-carga',
      signingSecret: 'test-secret-0123456789',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => 1_760_000_000_000,
      requestId: () => 'req-1',
    });
    const request = buildEnrollmentRequest(source());
    if (!request.success) throw new Error('fixture invalid');
    const outcome = await client.createEnrollment(request.data);
    expect(outcome.kind).toBe('success');

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(url).toBe('https://example.test/central-carga/api/v1/enrollments');
    expect(headers['idempotency-key']).toBe(PAYMENT_ID);
    expect(headers['x-studyx-timestamp']).toBe('1760000000');
    expect(headers['x-request-id']).toBe('req-1');
    expect(headers['x-studyx-signature']).toBe(signRequest({
      secret: 'test-secret-0123456789',
      timestamp: 1760000000,
      method: 'POST',
      path: '/central-carga/api/v1/enrollments',
      rawBody: init.body as string,
    }));
  });

  it('classifies a thrown network error and an aborted request as retry', async () => {
    const make = (impl: typeof fetch, timeoutMs?: number) => new CentralCargaClient({
      baseUrl: 'https://example.test', signingSecret: 'x'.repeat(20), fetchImpl: impl, timeoutMs,
    });
    expect(await make((async () => { throw new TypeError('fetch failed'); }) as typeof fetch).getEnrollment(PAYMENT_ID))
      .toEqual({ kind: 'retry', code: 'network_error' });
    const hanging = ((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    })) as unknown as typeof fetch;
    expect(await make(hanging, 20).getEnrollment(PAYMENT_ID)).toEqual({ kind: 'retry', code: 'timeout' });
  });
});
