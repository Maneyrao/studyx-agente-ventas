import { PostgresCallStore } from '@/features/calls/adapters/postgres-call-store';
import {
  handleRetellWebhook,
  handleXendraRelayedRetellWebhook,
} from '@/features/calls/application/retell-webhook';
import { createAgentAPostCallComposer } from '@/features/calls/adapters/agent-a-post-call-narrative';
import { runPostCallFollowup } from '@/features/calls/application/post-call-followup';
import { PostgresPostCallFollowupStore } from '@/features/calls/adapters/postgres-post-call-followup-store';
import { createManagedOutboundSender } from '@/features/messaging/adapters/managed-outbound';
import { logger } from '@/lib/observability/structured-log';
import { randomUUID } from 'node:crypto';
import { after } from 'next/server';
import type { CallStatus } from '@/features/calls/domain/call-state';

export const runtime = 'nodejs';
export const maxDuration = 180;

const POST_CALL_ANALYSIS_GRACE_MS = 125_000;

function waitForAnalysisGrace(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, POST_CALL_ANALYSIS_GRACE_MS));
}

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
      callStatus: CallStatus;
    }) => {
      if (event.eventType === 'started') return;
      const followUp = async (graceSeconds: number) => runPostCallFollowup(
        { trace_id: randomUUID(), call_id: event.callId, grace_seconds: graceSeconds },
        {
          store: new PostgresPostCallFollowupStore(sql),
          composeFollowup: createAgentAPostCallComposer(),
          sendOutbound: createManagedOutboundSender(sql),
          log: (name, fields) => logger.info({ event: name, ...fields }),
        },
      );

      const immediate = event.eventType === 'analyzed'
        || ['no_answer', 'timed_out', 'failed'].includes(event.callStatus);
      try {
        // Acknowledge the durable lifecycle event before composition: the
        // model's bounded 30s can exceed the provider webhook's HTTP deadline.
        after(async () => {
          try {
            if (!immediate) await waitForAnalysisGrace();
            await followUp(immediate ? 0 : 120);
          } catch {
            logger.error({ event: 'calls.retell_followup.failed', call_id: event.callId });
          }
        });
      } catch {
        // Scheduling cannot rewrite an event that has already been committed.
        // Its missing completion marker remains eligible for the daily sweep.
        logger.error({ event: 'calls.retell_followup.schedule_failed', call_id: event.callId });
      }
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
