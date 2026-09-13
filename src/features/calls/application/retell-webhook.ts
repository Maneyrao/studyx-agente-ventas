import { ZodError } from 'zod';
import type { CallStore } from '../ports/call-store';
import {
  RetellCallCorrelationError,
  type RetellCallCorrelationStore,
} from '../ports/retell-call-correlation-store';
import {
  mapRetellLifecycleEvent,
  retellCorrelationMetadata,
  RetellLifecycleWebhookSchema,
  verifyRetellSignature,
} from '../adapters/retell-lifecycle';
import { recordCallEvent } from './record-call-event';
import { constantTimeSecretEqual } from '@/lib/security/shared-secret';

type RetellWebhookDependencies = {
  readonly apiKey: string;
  readonly calls: CallStore & RetellCallCorrelationStore;
  readonly now?: () => Date;
};

type XendraRelayDependencies = {
  readonly orchestratorSecret: string;
  readonly calls: CallStore & RetellCallCorrelationStore;
};

/**
 * Retell lifecycle fields are small; 256 KiB leaves room for provider metadata
 * while bounding callbacks that include transcripts or unrelated call data.
 */
export const RETELL_WEBHOOK_MAX_BODY_BYTES = 256 * 1_024;

type BoundedBody =
  | { readonly status: 'ok'; readonly bytes: Uint8Array }
  | { readonly status: 'too_large' }
  | { readonly status: 'read_failed' };

async function readBoundedBody(request: Request): Promise<BoundedBody> {
  const declaredLength = request.headers.get('content-length');
  if (declaredLength && /^\d+$/u.test(declaredLength)) {
    const parsedLength = Number(declaredLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength > RETELL_WEBHOOK_MAX_BODY_BYTES) {
      return { status: 'too_large' };
    }
  }

  if (!request.body) return { status: 'ok', bytes: new Uint8Array() };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > RETELL_WEBHOOK_MAX_BODY_BYTES) {
        try {
          await reader.cancel();
        } catch {
          // The request is already rejected; stream cancellation is best-effort.
        }
        return { status: 'too_large' };
      }
      chunks.push(next.value);
    }
  } catch {
    return { status: 'read_failed' };
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { status: 'ok', bytes };
}

function errorResponse(code: string, status: number): Response {
  return Response.json({ error: code }, { status });
}

async function persistLifecycleEvent(
  raw: unknown,
  calls: CallStore & RetellCallCorrelationStore,
): Promise<Response> {
  const parsed = RetellLifecycleWebhookSchema.safeParse(raw);
  if (!parsed.success) return errorResponse('INVALID_RETELL_EVENT', 400);

  try {
    const correlation = await calls.resolveRetellCall({
      providerCallId: parsed.data.call.call_id,
      metadata: retellCorrelationMetadata(parsed.data),
    });
    const event = mapRetellLifecycleEvent(parsed.data, correlation.callId);
    await recordCallEvent(event, { store: calls });
    return new Response(null, { status: 204 });
  } catch (error) {
    if (error instanceof RetellCallCorrelationError) {
      return errorResponse(error.code, error.code === 'CALL_CORRELATION_NOT_FOUND' ? 404 : 409);
    }
    if (error instanceof ZodError) return errorResponse('INVALID_RETELL_EVENT', 400);
    if (error instanceof Error && error.message === 'CALL_EVENT_REPLAY_CONFLICT') {
      return errorResponse('CALL_EVENT_REPLAY_CONFLICT', 409);
    }
    return errorResponse('RETELL_EVENT_PERSISTENCE_FAILED', 500);
  }
}

export async function handleRetellWebhook(
  request: Request,
  dependencies: RetellWebhookDependencies,
): Promise<Response> {
  const body = await readBoundedBody(request);
  if (body.status === 'too_large') return errorResponse('PAYLOAD_TOO_LARGE', 413);
  if (body.status === 'read_failed') return errorResponse('INVALID_BODY', 400);

  const verified = verifyRetellSignature({
    rawBody: body.bytes,
    signature: request.headers.get('x-retell-signature'),
    apiKey: dependencies.apiKey,
    nowMs: (dependencies.now ?? (() => new Date()))().getTime(),
  });
  if (!verified) return errorResponse('UNAUTHORIZED', 401);

  let rawBody: string;
  let raw: unknown;
  try {
    rawBody = new TextDecoder('utf-8', { fatal: true }).decode(body.bytes);
    raw = JSON.parse(rawBody) as unknown;
  } catch {
    return errorResponse('INVALID_JSON', 400);
  }
  return persistLifecycleEvent(raw, dependencies.calls);
}

export async function handleXendraRelayedRetellWebhook(
  request: Request,
  dependencies: XendraRelayDependencies,
): Promise<Response> {
  if (!constantTimeSecretEqual(
    request.headers.get('x-studyx-orchestrator-secret'),
    dependencies.orchestratorSecret,
  )) {
    return errorResponse('UNAUTHORIZED', 401);
  }

  const expectedEvent = request.headers.get('x-studyx-event');
  if (!expectedEvent || !['call_started', 'call_ended', 'call_analyzed'].includes(expectedEvent)) {
    return errorResponse('INVALID_XENDRA_EVENT_HEADER', 400);
  }

  const body = await readBoundedBody(request);
  if (body.status === 'too_large') return errorResponse('PAYLOAD_TOO_LARGE', 413);
  if (body.status === 'read_failed') return errorResponse('INVALID_BODY', 400);

  let raw: unknown;
  try {
    const rawBody = new TextDecoder('utf-8', { fatal: true }).decode(body.bytes);
    raw = JSON.parse(rawBody) as unknown;
  } catch {
    return errorResponse('INVALID_JSON', 400);
  }
  if (
    typeof raw !== 'object'
    || raw === null
    || !('event' in raw)
    || (raw as { event?: unknown }).event !== expectedEvent
  ) {
    return errorResponse('XENDRA_EVENT_MISMATCH', 400);
  }

  return persistLifecycleEvent(raw, dependencies.calls);
}
