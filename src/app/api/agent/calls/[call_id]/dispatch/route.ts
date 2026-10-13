import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { dispatchCall } from '@/features/calls/application/dispatch-call';
import { runPostCallFollowup } from '@/features/calls/application/post-call-followup';
import { PostgresCallStore } from '@/features/calls/adapters/postgres-call-store';
import { PostgresPostCallFollowupStore } from '@/features/calls/adapters/postgres-post-call-followup-store';
import { ConfirmedVoiceProviderError, type VoiceProvider } from '@/features/calls/ports/voice-provider';
import { createManagedOutboundSender } from '@/features/messaging/adapters/managed-outbound';
import { loadVoiceDispatchConfig } from '@/lib/config';
import { logger } from '@/lib/observability/structured-log';
import { buildDispatchVoiceProvider } from './route-dependencies';

export const runtime = 'nodejs';

export async function POST(
  request: Request,
  context: { params: Promise<{ call_id: string }> },
): Promise<Response> {
  const parsedCallId = z.string().uuid().safeParse((await context.params).call_id);
  if (!parsedCallId.success) return Response.json({ error: 'INVALID_CALL_ID' }, { status: 400 });

  try {
    const { sql } = await import('@/lib/db/orchestrator');
    const store = new PostgresCallStore(sql);
    const configuredProvider = () => buildDispatchVoiceProvider(loadVoiceDispatchConfig(), sql);
    const provider: VoiceProvider = {
      async placeCall(input) {
        let configured: VoiceProvider;
        try {
          // Construct only after dispatch owns the claim. Configuration
          // failures are conclusive before any provider request is made.
          configured = configuredProvider();
        } catch {
          throw new ConfirmedVoiceProviderError('VOICE_PROVIDER_CONFIGURATION_UNAVAILABLE');
        }
        return configured.placeCall(input);
      },
      // Lookup errors retain the existing ambiguous outcome in dispatchCall.
      findCallByInternalId: (callId) => configuredProvider().findCallByInternalId(callId),
      cancelCall: (providerCallId) => configuredProvider().cancelCall(providerCallId),
    };
    const workerId = (request.headers.get('x-request-id') ?? `dispatch:${parsedCallId.data}`).slice(0, 256);
    const result = await dispatchCall({ callId: parsedCallId.data, workerId }, { store, provider });
    if (result.status === 'failed') {
      // A rejected dispatch may never produce a webhook. Reuse the durable
      // post-call recovery now; its call-scoped idempotency also covers replay
      // and a later webhook. Unknown outcomes must remain fenced, not retried.
      const traceId = randomUUID();
      try {
        await runPostCallFollowup(
          { trace_id: traceId, call_id: parsedCallId.data, grace_seconds: 0 },
          {
            store: new PostgresPostCallFollowupStore(sql),
            sendOutbound: createManagedOutboundSender(sql),
            log: (name, fields) => logger.info({ event: name, ...fields }),
          },
        );
      } catch {
        // Keep the confirmed dispatch result even if the recovery store is
        // unavailable. The terminal call remains pending for replay or cron.
        logger.error({ event: 'calls.dispatch_followup.failed', trace_id: traceId, call_id: parsedCallId.data });
      }
    }
    const status = result.status === 'provider_accepted' ? 200 : result.status === 'failed' ? 502 : 202;
    return Response.json(result, { status });
  } catch (error) {
    const code = error instanceof Error && error.message === 'CALL_NOT_FOUND'
      ? 'CALL_NOT_FOUND'
      : 'AGENT_B_DISPATCH_ERROR';
    return Response.json({ error: code }, { status: code === 'CALL_NOT_FOUND' ? 404 : 500 });
  }
}
