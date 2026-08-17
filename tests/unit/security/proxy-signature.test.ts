import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy } from '@/proxy';

const originalKey = process.env.ORCHESTRATOR_API_KEY;
const originalKeyId = process.env.ORCHESTRATOR_KEY_ID;
const originalSecret = process.env.STUDYX_SIGNING_SECRET;

function inboundBody(message = 'hola') {
  return {
    source: 'botpress',
    integration_id: 'proxy-test',
    external_message_id: 'message-1',
    trace_id: '53b13d12-2a1d-4b28-b1fd-605b97ebef34',
    message,
  };
}

function signedRequest(
  body: string,
  timestamp = Date.now().toString(),
  signatureOverride?: string,
  headerOverrides: Record<string, string> = {}
) {
  const pathname = '/api/agent/ingest';
  const parsed = JSON.parse(body) as ReturnType<typeof inboundBody>;
  const idempotencyKey = `inbound:${parsed.source}:${parsed.integration_id}:${parsed.external_message_id}`;
  const signature = signatureOverride ?? createHmac('sha256', 'signing-secret')
    .update(`${timestamp}\nPOST\n${pathname}\n${body}`)
    .digest('hex');
  return new NextRequest(`http://localhost${pathname}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-orchestrator-key-id': 'botpress-test',
      'x-orchestrator-key': 'orchestrator-key',
      'x-request-timestamp': timestamp,
      'x-signature': `v1=${signature}`,
      'x-trace-id': parsed.trace_id,
      'idempotency-key': idempotencyKey,
      'x-request-id': `${parsed.trace_id}:${idempotencyKey}`,
      ...headerOverrides,
    },
    body,
  });
}

beforeEach(() => {
  process.env.ORCHESTRATOR_API_KEY = 'orchestrator-key';
  process.env.ORCHESTRATOR_KEY_ID = 'botpress-test';
  process.env.STUDYX_SIGNING_SECRET = 'signing-secret';
});

afterEach(() => {
  if (originalKey === undefined) delete process.env.ORCHESTRATOR_API_KEY;
  else process.env.ORCHESTRATOR_API_KEY = originalKey;
  if (originalKeyId === undefined) delete process.env.ORCHESTRATOR_KEY_ID;
  else process.env.ORCHESTRATOR_KEY_ID = originalKeyId;
  if (originalSecret === undefined) delete process.env.STUDYX_SIGNING_SECRET;
  else process.env.STUDYX_SIGNING_SECRET = originalSecret;
});

describe('API proxy authentication', () => {
  it('accepts the exact signed body without consuming the route request', async () => {
    const body = JSON.stringify(inboundBody());
    const request = signedRequest(body);
    const response = await proxy(request);
    expect(response.status).toBe(200);
    expect(response.headers.get('x-middleware-next')).toBe('1');
    await expect(request.json()).resolves.toEqual(inboundBody());
  });

  it('rejects a changed body signature', async () => {
    const signedBody = JSON.stringify(inboundBody('hola'));
    const timestamp = Date.now().toString();
    const signature = createHmac('sha256', 'signing-secret')
      .update(`${timestamp}\nPOST\n/api/agent/ingest\n${signedBody}`)
      .digest('hex');
    const response = await proxy(signedRequest(JSON.stringify(inboundBody('alterado')), timestamp, signature));
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: 'INVALID_SIGNATURE' });
  });

  it('rejects stale replay attempts', async () => {
    const stale = (Date.now() - 6 * 60 * 1000).toString();
    const response = await proxy(signedRequest(JSON.stringify(inboundBody()), stale));
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: 'STALE_REQUEST' });
  });

  it('rejects a wrong orchestrator key before checking HMAC', async () => {
    const request = signedRequest(JSON.stringify(inboundBody()));
    request.headers.set('x-orchestrator-key', 'wrong');
    const response = await proxy(request);
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: 'UNAUTHORIZED' });
  });

  it('rejects trace or idempotency headers that disagree with the signed body', async () => {
    const body = JSON.stringify(inboundBody());
    const wrongTrace = await proxy(signedRequest(body, undefined, undefined, {
      'x-trace-id': '13a56d87-2d10-4c88-af2c-90c669206868',
    }));
    expect(wrongTrace.status).toBe(409);
    await expect(wrongTrace.json()).resolves.toMatchObject({ error: 'TRACE_ID_MISMATCH' });

    const wrongIdempotency = await proxy(signedRequest(body, undefined, undefined, {
      'idempotency-key': 'inbound:wrong:key',
    }));
    expect(wrongIdempotency.status).toBe(409);
    await expect(wrongIdempotency.json()).resolves.toMatchObject({ error: 'IDEMPOTENCY_KEY_MISMATCH' });
  });

  it('binds the call dispatch idempotency key to the call_id in the path', async () => {
    const callId = '7f9f3f66-0b7c-4c8e-9a9e-2f8f0a1b2c3d';
    const traceId = '53b13d12-2a1d-4b28-b1fd-605b97ebef34';
    const dispatchRequest = (pathname: string, idempotencyKey: string) => {
      const body = JSON.stringify({ trace_id: traceId });
      const timestamp = Date.now().toString();
      const signature = createHmac('sha256', 'signing-secret')
        .update(`${timestamp}\nPOST\n${pathname}\n${body}`)
        .digest('hex');
      return new NextRequest(`http://localhost${pathname}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-orchestrator-key-id': 'botpress-test',
          'x-orchestrator-key': 'orchestrator-key',
          'x-request-timestamp': timestamp,
          'x-signature': `v1=${signature}`,
          'x-trace-id': traceId,
          'idempotency-key': idempotencyKey,
          'x-request-id': `${traceId}:${idempotencyKey}`,
        },
        body,
      });
    };

    const exact = await proxy(dispatchRequest(`/api/agent/calls/${callId}/dispatch`, `voice-call:${callId}`));
    expect(exact.status).toBe(200);
    expect(exact.headers.get('x-middleware-next')).toBe('1');

    const wrongKey = await proxy(dispatchRequest(`/api/agent/calls/${callId}/dispatch`, 'voice-call:something-else'));
    expect(wrongKey.status).toBe(409);
    await expect(wrongKey.json()).resolves.toMatchObject({ error: 'IDEMPOTENCY_KEY_MISMATCH' });

    const otherCallId = 'a1b2c3d4-1111-4222-8333-944455566677';
    const wrongCall = await proxy(dispatchRequest(`/api/agent/calls/${otherCallId}/dispatch`, `voice-call:${callId}`));
    expect(wrongCall.status).toBe(409);
    await expect(wrongCall.json()).resolves.toMatchObject({ error: 'IDEMPOTENCY_KEY_MISMATCH' });

    // Nearby-but-not-exact paths must not trip the dispatch matcher: no
    // expected key exists for them, so any signed key passes this check.
    const lookalike = await proxy(
      dispatchRequest(`/api/agent/calls/${callId}/dispatch/extra`, 'voice-call:unrelated')
    );
    expect(lookalike.status).toBe(200);
    expect(lookalike.headers.get('x-middleware-next')).toBe('1');
  });

  it('leaves cron authentication to the cron handler', async () => {
    delete process.env.ORCHESTRATOR_API_KEY;
    delete process.env.ORCHESTRATOR_KEY_ID;
    delete process.env.STUDYX_SIGNING_SECRET;
    const response = await proxy(new NextRequest('http://localhost/api/cron/retry-embeddings'));
    expect(response.status).toBe(200);
    expect(response.headers.get('x-middleware-next')).toBe('1');
  });
});
