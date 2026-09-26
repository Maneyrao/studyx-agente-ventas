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
import { logger } from '@/lib/observability/structured-log';

type PersistedLifecycleEvent = {
  readonly callId: string;
  readonly eventType: 'started' | 'ended' | 'analyzed';
};

type RetellWebhookDependencies = {
  readonly apiKey: string;
  readonly calls: CallStore & RetellCallCorrelationStore;
  readonly now?: () => Date;
  readonly afterPersisted?: (event: PersistedLifecycleEvent) => Promise<void>;
};

type XendraRelayDependencies = {
  readonly orchestratorSecret: string;
  readonly calls: CallStore & RetellCallCorrelationStore;
  readonly afterPersisted?: (event: PersistedLifecycleEvent) => Promise<void>;
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
  afterPersisted?: (event: PersistedLifecycleEvent) => Promise<void>,
): Promise<Response> {
  const parsed = RetellLifecycleWebhookSchema.safeParse(raw);
  if (!parsed.success) {
    logger.warn({
      event: 'retell.lifecycle.invalid_request',
      issues: parsed.error.issues.map((issue) => ({
        code: issue.code,
        path: issue.path.map(String).join('.'),
      })),
    });
    return errorResponse('INVALID_RETELL_EVENT', 400);
  }

  try {
    const correlation = await calls.resolveRetellCall({
      providerCallId: parsed.data.call.call_id,
      metadata: retellCorrelationMetadata(parsed.data),
    });
    if (
      parsed.data.event === 'call_analyzed'
      && parsed.data.call.call_analysis.custom_analysis_data.resultado === undefined
    ) {
      logger.info({
        event: 'retell.lifecycle.empty_analysis_ignored',
        call_id: correlation.callId,
        provider_call_id: parsed.data.call.call_id,
      });
      return new Response(null, { status: 204 });
    }
    const event = mapRetellLifecycleEvent(parsed.data, correlation.callId);
    if (event.event_type === 'requested') {
      throw new Error('RETELL_LIFECYCLE_REQUESTED_EVENT_INVALID');
    }
    await recordCallEvent(event, { store: calls });
    if (afterPersisted) {
      try {
        await afterPersisted({ callId: correlation.callId, eventType: event.event_type });
      } catch (error) {
        logger.error({
          event: 'retell.lifecycle.followup_failed',
          call_id: correlation.callId,
          event_type: event.event_type,
          error: String(error),
        });
      }
    }
    return new Response(null, { status: 204 });
  } catch (error) {
    if (error instanceof RetellCallCorrelationError) {
      const rawMetadata = parsed.data.call.metadata;
      logger.warn({
        event: 'retell.lifecycle.correlation_rejected',
        code: error.code,
        provider_call_id_present: parsed.data.call.call_id.trim().length > 0,
        internal_call_id_present: Boolean(rawMetadata?.internal_call_id),
        lead_id_present: Boolean(rawMetadata?.lead_id),
        conversation_id_present: Boolean(rawMetadata?.conversation_id),
        internal_call_id_match: rawMetadata?.internal_call_id
          ? error.diagnostics?.internalCallIdMatches ?? null
          : null,
        lead_id_match: rawMetadata?.lead_id
          ? error.diagnostics?.contactIdMatches ?? null
          : null,
        conversation_id_match: rawMetadata?.conversation_id
          ? error.diagnostics?.conversationIdMatches ?? null
          : null,
        provider_call_id_match: error.diagnostics?.providerCallIdMatches ?? null,
      });
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
  return persistLifecycleEvent(raw, dependencies.calls, dependencies.afterPersisted);
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

  return persistLifecycleEvent(raw, dependencies.calls, dependencies.afterPersisted);
}
