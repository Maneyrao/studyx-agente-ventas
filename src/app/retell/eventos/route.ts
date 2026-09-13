import { PostgresCallStore } from '@/features/calls/adapters/postgres-call-store';
import {
  handleRetellWebhook,
  handleXendraRelayedRetellWebhook,
} from '@/features/calls/application/retell-webhook';

export const runtime = 'nodejs';

export async function POST(request: Request): Promise<Response> {
  const isXendraRelay = request.headers.has('x-studyx-orchestrator-secret')
    || request.headers.has('x-studyx-event');
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
    if (isXendraRelay) {
      return await handleXendraRelayedRetellWebhook(request, {
        orchestratorSecret: orchestratorSecret!,
        calls,
      });
    }
    return await handleRetellWebhook(request, {
      apiKey: apiKey!,
      calls,
    });
  } catch {
    return Response.json({ error: 'RETELL_EVENT_PERSISTENCE_FAILED' }, { status: 500 });
  }
}
