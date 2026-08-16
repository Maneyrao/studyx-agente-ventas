import { NextRequest, NextResponse } from 'next/server';

function constantTimeEqual(left: string, right: string): boolean {
  const size = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < size; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

async function hmacHex(secret: string, value: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(value));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function expectedIdempotencyKey(pathname: string, body: Record<string, unknown>): string | null {
  if (pathname === '/api/agent/ingest') {
    if (
      typeof body.source !== 'string'
      || typeof body.integration_id !== 'string'
      || typeof body.external_message_id !== 'string'
    ) return null;
    return `inbound:${String(body.source)}:${String(body.integration_id)}:${String(body.external_message_id)}`;
  }
  // A claim is idempotent per batch: replaying the same signed request must not
  // be able to masquerade as a claim on a different window.
  const claim = pathname.match(/^\/api\/agent\/batches\/([^/]+)\/claim$/);
  if (claim) return `claim:${claim[1]}`;
  const decision = pathname.match(/^\/api\/agent\/turns\/([^/]+)\/decision$/);
  if (decision) return `decision:${decision[1]}`;
  const delivery = pathname.match(/^\/api\/agent\/outbounds\/([^/]+)\/delivery$/);
  if (delivery) {
    return `delivery:${delivery[1]}:${String(body.botpress_message_id ?? 'none')}:${String(body.status)}`;
  }
  return null;
}

/**
 * Routes that must be reachable without a Botpress credential.
 *
 * - `/api/health` and `/api/ready` are probed by load balancers and uptime
 *   checks, which have no orchestrator key and never will. Gating them behind
 *   one makes the process report unhealthy for the single reason it cannot
 *   avoid: the probe is unauthenticated.
 * - `/api/diagnostics` enforces `CRON_SECRET` in the handler. Answering 401
 *   here too would be indistinguishable from the handler's own 401 and send an
 *   operator after the wrong credential.
 *
 * Exact matches only. `/api/healthcheck-admin` is not `/api/health`.
 */
const UNAUTHENTICATED_PATHS = new Set([
  '/api/health',
  '/api/ready',
  '/api/diagnostics',
  // The handler validates X-Telegram-Bot-Api-Secret-Token. This exact path
  // must be reachable by Telegram, which cannot provide our orchestrator key.
  '/api/webhooks/voice/telegram',
]);

export async function proxy(request: NextRequest) {
  // Vercel Cron authenticates with Authorization: Bearer CRON_SECRET inside
  // each cron handler. Requiring the internal orchestrator key here would make
  // legitimate scheduled requests unreachable.
  if (request.nextUrl.pathname.startsWith('/api/cron/')) {
    return NextResponse.next();
  }

  if (UNAUTHENTICATED_PATHS.has(request.nextUrl.pathname)) {
    return NextResponse.next();
  }

  const key = request.headers.get('x-orchestrator-key');
  const expected = process.env.ORCHESTRATOR_API_KEY;

  if (!expected) {
    return NextResponse.json({ error: 'MISCONFIGURED' }, { status: 500 });
  }

  if (!key || !constantTimeEqual(key, expected)) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  if (request.nextUrl.pathname.startsWith('/api/agent/')) {
    const signingSecret = process.env.STUDYX_SIGNING_SECRET;
    const expectedKeyId = process.env.ORCHESTRATOR_KEY_ID;
    if (!signingSecret || !expectedKeyId) {
      return NextResponse.json({ error: 'SIGNATURE_MISCONFIGURED' }, { status: 500 });
    }
    const keyId = request.headers.get('x-orchestrator-key-id');
    if (!keyId || !constantTimeEqual(keyId, expectedKeyId)) {
      return NextResponse.json({ error: 'INVALID_KEY_ID' }, { status: 401 });
    }
    const timestamp = request.headers.get('x-request-timestamp');
    const signature = request.headers.get('x-signature');
    const requestId = request.headers.get('x-request-id');
    const traceId = request.headers.get('x-trace-id');
    const idempotencyKey = request.headers.get('idempotency-key');
    if (!requestId || !traceId || !idempotencyKey) {
      return NextResponse.json({ error: 'MISSING_REQUEST_HEADERS' }, { status: 400 });
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(traceId)) {
      return NextResponse.json({ error: 'INVALID_TRACE_ID' }, { status: 400 });
    }
    const timestampMs = timestamp ? Number(timestamp) : Number.NaN;
    if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > 5 * 60 * 1000) {
      return NextResponse.json({ error: 'STALE_REQUEST' }, { status: 401 });
    }
    if (!signature?.startsWith('v1=')) {
      return NextResponse.json({ error: 'INVALID_SIGNATURE' }, { status: 401 });
    }

    const rawBody = await request.clone().text();
    const canonical = [timestamp, request.method, request.nextUrl.pathname, rawBody].join('\n');
    const expectedSignature = await hmacHex(signingSecret, canonical);
    if (!constantTimeEqual(signature.slice(3), expectedSignature)) {
      return NextResponse.json({ error: 'INVALID_SIGNATURE' }, { status: 401 });
    }

    let parsedBody: Record<string, unknown> | null = null;
    try {
      const parsed = JSON.parse(rawBody) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        parsedBody = parsed as Record<string, unknown>;
      }
    } catch {
      // Route-level validation owns INVALID_JSON. The signature still protects
      // the exact bytes even when they are malformed JSON.
    }
    if (parsedBody) {
      if (typeof parsedBody.trace_id === 'string' && parsedBody.trace_id !== traceId) {
        return NextResponse.json({ error: 'TRACE_ID_MISMATCH' }, { status: 409 });
      }
      const expectedIdempotency = expectedIdempotencyKey(request.nextUrl.pathname, parsedBody);
      if (expectedIdempotency && !constantTimeEqual(idempotencyKey, expectedIdempotency)) {
        return NextResponse.json({ error: 'IDEMPOTENCY_KEY_MISMATCH' }, { status: 409 });
      }
      const expectedRequestId = `${traceId}:${idempotencyKey}`.slice(0, 512);
      if (!constantTimeEqual(requestId, expectedRequestId)) {
        return NextResponse.json({ error: 'REQUEST_ID_MISMATCH' }, { status: 409 });
      }
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/api/:path*'],
};
