import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { beforeAll, describe, expect, it } from 'vitest';

beforeAll(() => {
  process.env.DATABASE_URL ??= 'postgresql://postgres@127.0.0.1:55435/studyx_test';
});

function jsonRequest(path: string, body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

describe('agent HTTP contract validation', () => {
  it('rejects the removed transferred conversation state before persistence', async () => {
    const { PATCH } = await import('@/app/api/conversations/[id]/route');
    const response = await PATCH(jsonRequest('/api/conversations/test-conversation', {
      status: 'transferred',
    }), { params: Promise.resolve({ id: randomUUID() }) });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: 'VALIDATION_ERROR' });
  });

  it('rejects an incomplete inbound envelope before touching the database', async () => {
    const { POST } = await import('@/app/api/agent/ingest/route');
    const response = await POST(jsonRequest('/api/agent/ingest', {
      schema_version: 1,
      source: 'botpress',
      channel: 'whatsapp',
      message: { text: 'hola' },
    }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: 'VALIDATION_ERROR' });
  });

  it('requires explicit idempotency for the legacy ingest adapter', async () => {
    const { POST } = await import('@/app/api/agent/ingest/route');
    const response = await POST(jsonRequest('/api/agent/ingest', {
      phone: '+5491100000099',
      content: 'hola',
      channel: 'whatsapp',
    }));
    expect(response.status).toBe(428);
    await expect(response.json()).resolves.toMatchObject({ error: 'IDEMPOTENCY_KEY_REQUIRED' });
  });

  it('fails closed when a Botpress envelope has no canonical phone identity', async () => {
    const { POST } = await import('@/app/api/agent/ingest/route');
    const response = await POST(jsonRequest('/api/agent/ingest', {
      schema_version: 1,
      source: 'botpress',
      channel: 'emulator',
      integration_id: 'contract-test',
      external_message_id: 'message-1',
      external_conversation_id: 'conversation-1',
      external_user_id: 'user-1',
      trace_id: randomUUID(),
      message: {
        type: 'text',
        text: 'hola',
        occurred_at: new Date().toISOString(),
        reply_to_external_message_id: null,
      },
    }));
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({ error: 'IDENTITY_REQUIRED' });
  });

  it('rejects disagreement between decision path and body identities', async () => {
    const pathTurnId = randomUUID();
    const { POST } = await import('@/app/api/agent/turns/[turn_id]/decision/route');
    const response = await POST(jsonRequest(`/api/agent/turns/${pathTurnId}/decision`, {
      turn_id: randomUUID(),
      trace_id: randomUUID(),
      decision: {
        schema_version: 2,
        intent: 'human_request',
        kind: 'reply',
        response: 'No puedo transferirte a una persona. Puedo ayudarte por acá.',
        response_type: 'automation_only',
        confidence: 1,
        reason_code: 'AUTOMATED_ASSISTANCE_ONLY',
        business_action: null,
        memory_candidates: [],
        missing_information: [],
        next_state: 'waiting_user',
      },
      model: { provider: 'botpress', model: 'test', prompt_version: 'v1' },
    }), { params: Promise.resolve({ turn_id: pathTurnId }) });
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: 'TURN_ID_MISMATCH' });
  });

  it('accepts groq-direct as decision provenance before checking identities', async () => {
    const pathTurnId = randomUUID();
    const { POST } = await import('@/app/api/agent/turns/[turn_id]/decision/route');
    const response = await POST(jsonRequest(`/api/agent/turns/${pathTurnId}/decision`, {
      turn_id: randomUUID(),
      trace_id: randomUUID(),
      decision: {
        schema_version: 3,
        intent: 'commercial',
        kind: 'reply',
        response: 'Te cuento.',
        response_type: 'commercial_reply',
        confidence: 1,
        reason_code: 'ANSWER',
        business_action: null,
        retrieval_used: null,
        memory_candidates: [],
        missing_information: [],
        next_state: 'waiting_user',
      },
      model: { provider: 'groq-direct', model: 'openai/gpt-oss-120b', prompt_version: 'v11' },
    }), { params: Promise.resolve({ turn_id: pathTurnId }) });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: 'TURN_ID_MISMATCH' });
  });

  it('rejects the previous decision contract before checking identities or persistence', async () => {
    const pathTurnId = randomUUID();
    const { POST } = await import('@/app/api/agent/turns/[turn_id]/decision/route');
    const response = await POST(jsonRequest(`/api/agent/turns/${pathTurnId}/decision`, {
      turn_id: randomUUID(),
      trace_id: randomUUID(),
      decision: {
        kind: 'reply',
        content: 'Hola',
        response_type: 'sales',
        business_action: null,
        reason_code: 'LEGACY',
        confidence: 1,
      },
      model: { provider: 'botpress', model: 'test', prompt_version: 'v1' },
    }), { params: Promise.resolve({ turn_id: pathTurnId }) });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: 'VALIDATION_ERROR' });
  });

  it('rejects disagreement between delivery path and body identities', async () => {
    const pathOutboundId = randomUUID();
    const { POST } = await import('@/app/api/agent/outbounds/[outbound_id]/delivery/route');
    const response = await POST(jsonRequest(`/api/agent/outbounds/${pathOutboundId}/delivery`, {
      outbound_id: randomUUID(),
      trace_id: randomUUID(),
      status: 'failed',
      botpress_message_id: null,
      replayed: false,
      error_code: 'TEST_FAILURE',
    }), { params: Promise.resolve({ outbound_id: pathOutboundId }) });
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: 'OUTBOUND_ID_MISMATCH' });
  });
});
