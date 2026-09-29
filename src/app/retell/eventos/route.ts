import { PostgresCallStore } from '@/features/calls/adapters/postgres-call-store';
import {
  handleRetellWebhook,
  handleXendraRelayedRetellWebhook,
} from '@/features/calls/application/retell-webhook';
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
          sendOutbound: createManagedOutboundSender(sql),
          log: (name, fields) => logger.info({ event: name, ...fields }),
        },
      );

      if (event.eventType === 'analyzed') {
        await followUp(0);
        return;
      }

      // These terminal outcomes are already conclusive at call_ended and do
      // not receive useful call analysis. Process them now: sleeping inside
      // request-scoped background work can be terminated by the host before
      // the recovery message is emitted.
      if (['no_answer', 'timed_out', 'failed'].includes(event.callStatus)) {
        await followUp(0);
        return;
      }

      // Vercel Hobby only supports daily cron jobs. Keep the webhook fast and
      // use the request-scoped background lifetime for the short analysis
      // window; the daily cron remains the durable recovery sweep.
      after(async () => {
        await waitForAnalysisGrace();
        await followUp(120);
      });
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
