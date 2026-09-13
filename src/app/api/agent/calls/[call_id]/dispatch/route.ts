import { z } from 'zod';
import { dispatchCall } from '@/features/calls/application/dispatch-call';
import { PostgresCallStore } from '@/features/calls/adapters/postgres-call-store';
import { loadVoiceDispatchConfig } from '@/lib/config';
import { buildDispatchVoiceProvider } from './route-dependencies';

export const runtime = 'nodejs';

export async function POST(
  request: Request,
  context: { params: Promise<{ call_id: string }> },
): Promise<Response> {
  const parsedCallId = z.string().uuid().safeParse((await context.params).call_id);
  if (!parsedCallId.success) return Response.json({ error: 'INVALID_CALL_ID' }, { status: 400 });

  try {
    const settings = loadVoiceDispatchConfig();
    const { sql } = await import('@/lib/db/orchestrator');
    const store = new PostgresCallStore(sql);
    const provider = buildDispatchVoiceProvider(settings, sql);
    const workerId = (request.headers.get('x-request-id') ?? `dispatch:${parsedCallId.data}`).slice(0, 256);
    const result = await dispatchCall({ callId: parsedCallId.data, workerId }, { store, provider });
    const status = result.status === 'provider_accepted' ? 200 : result.status === 'failed' ? 502 : 202;
    return Response.json(result, { status });
  } catch (error) {
    const code = error instanceof Error && error.message === 'CALL_NOT_FOUND'
      ? 'CALL_NOT_FOUND'
      : 'AGENT_B_DISPATCH_ERROR';
    return Response.json({ error: code }, { status: code === 'CALL_NOT_FOUND' ? 404 : 500 });
  }
}
