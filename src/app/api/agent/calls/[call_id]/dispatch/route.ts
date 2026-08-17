import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { dispatchCall } from '@/features/calls/application/dispatch-call';
import { PostgresCallStore } from '@/features/calls/adapters/postgres-call-store';
import { PostgresContextReceiptStore } from '@/features/calls/adapters/postgres-context-receipt-store';
import { TelegramBotApiClient } from '@/features/calls/adapters/telegram-bot-api.client';
import { TelegramSimVoiceProvider } from '@/features/calls/adapters/telegram-sim-voice.provider';
import { loadTelegramAgentBConfig } from '@/lib/config';

export const runtime = 'nodejs';

export async function POST(
  request: Request,
  context: { params: Promise<{ call_id: string }> },
): Promise<Response> {
  const parsedCallId = z.string().uuid().safeParse((await context.params).call_id);
  if (!parsedCallId.success) return Response.json({ error: 'INVALID_CALL_ID' }, { status: 400 });

  try {
    const settings = loadTelegramAgentBConfig();
    if (settings.voiceProvider !== 'telegram_sandbox') {
      return Response.json({ error: 'VOICE_PROVIDER_NOT_IMPLEMENTED' }, { status: 409 });
    }
    const { sql } = await import('@/lib/db/orchestrator');
    const store = new PostgresCallStore(sql);
    const receipts = new PostgresContextReceiptStore(sql, {
      expectedChatId: settings.smokeChatId,
      expectedUserId: settings.smokeUserId,
    });
    const provider = new TelegramSimVoiceProvider({
      receipts,
      destinationResolver: receipts,
      telegram: new TelegramBotApiClient({ token: settings.botToken, timeoutMs: settings.requestTimeoutMs }),
      nonce: () => randomBytes(16).toString('base64url'),
    });
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
