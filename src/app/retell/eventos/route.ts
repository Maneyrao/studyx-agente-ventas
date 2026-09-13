import { PostgresCallStore } from '@/features/calls/adapters/postgres-call-store';
import { handleRetellWebhook } from '@/features/calls/application/retell-webhook';

export const runtime = 'nodejs';

export async function POST(request: Request): Promise<Response> {
  const apiKey = process.env.RETELL_API_KEY?.trim();
  if (!apiKey) return Response.json({ error: 'RETELL_WEBHOOK_MISCONFIGURED' }, { status: 500 });

  try {
    const { sql } = await import('@/lib/db/orchestrator');
    return await handleRetellWebhook(request, {
      apiKey,
      calls: new PostgresCallStore(sql),
    });
  } catch {
    return Response.json({ error: 'RETELL_EVENT_PERSISTENCE_FAILED' }, { status: 500 });
  }
}
