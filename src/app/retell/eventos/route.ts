import { PostgresCallStore } from '@/features/calls/adapters/postgres-call-store';
import {
  handleRetellWebhook,
  handleXendraRelayedRetellWebhook,
} from '@/features/calls/application/retell-webhook';
import { runPostCallFollowup } from '@/features/calls/application/post-call-followup';
import { PostgresPostCallFollowupStore } from '@/features/calls/adapters/postgres-post-call-followup-store';
import { createPostCallOutboundSender } from '@/features/calls/adapters/post-call-outbound';
import { logger } from '@/lib/observability/structured-log';
import { randomUUID } from 'node:crypto';

export const runtime = 'nodejs';

export async function POST(request: Request): Promise<Response> {
  const isXendraRelay = request.headers.has('x-studyx-orchestrator-secret')
    || request.headers.has('x-studyx-event');
  const isDirectRetell = request.headers.has('x-retell-signature');
  if (!isXendraRelay && !isDirectRetell) {
    return Response.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }
  const orchestratorSecret = process.env.XENDRA_ORCHESTRATOR_SECRET?.trim();
  const apiKey = process.env.RETELL_API_KEY?.trim();
  if (isXendraRelay && !orchestratorSecret) {
    return Response.json({ error: 'XENDRA_RELAY_MISCONFIGURED' }, { status: 500 });
  }
  if (!isXendraRelay && !apiKey) {
    return Response.json({ error: 'RETELL_WEBHOOK_MISCONFIGURED' }, { status: 500 });
  }

  try {
    const { sql } = await import('@/lib/db/orchestrator');
    const calls = new PostgresCallStore(sql);
    const afterPersisted = async (event: {
      callId: string;
      eventType: 'started' | 'ended' | 'analyzed';
    }) => {
      if (event.eventType === 'started') return;
      await runPostCallFollowup(
        { trace_id: randomUUID(), call_id: event.callId, grace_seconds: 0 },
        {
          store: new PostgresPostCallFollowupStore(sql),
          sendOutbound: createPostCallOutboundSender(sql),
          log: (name, fields) => logger.info({ event: name, ...fields }),
        },
      );
    };
    if (isXendraRelay) {
      return await handleXendraRelayedRetellWebhook(request, {
        orchestratorSecret: orchestratorSecret!,
        calls,
        afterPersisted,
      });
    }
    return await handleRetellWebhook(request, {
      apiKey: apiKey!,
      calls,
      afterPersisted,
    });
  } catch {
    return Response.json({ error: 'RETELL_EVENT_PERSISTENCE_FAILED' }, { status: 500 });
  }
}
