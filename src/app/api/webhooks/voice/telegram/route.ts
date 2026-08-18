import { handleTelegramWebhook } from '@/features/calls/application/telegram-webhook';
import { TelegramBotApiClient } from '@/features/calls/adapters/telegram-bot-api.client';
import { PostgresContextReceiptStore } from '@/features/calls/adapters/postgres-context-receipt-store';
import { PostgresCallStore } from '@/features/calls/adapters/postgres-call-store';
import { loadTelegramAgentBConfig } from '@/lib/config';

export const runtime = 'nodejs';

export async function POST(request: Request): Promise<Response> {
  try {
    const settings = loadTelegramAgentBConfig();
    const { sql } = await import('@/lib/db/orchestrator');
    const receipts = new PostgresContextReceiptStore(sql, {
      expectedChatId: settings.smokeChatId,
      expectedUserId: settings.smokeUserId,
    });
    const calls = new PostgresCallStore(sql);
    const telegram = new TelegramBotApiClient({
      token: settings.botToken,
      timeoutMs: settings.requestTimeoutMs,
    });
    return await handleTelegramWebhook(request, {
      receipts,
      telegram,
      calls,
      webhookSecret: settings.webhookSecret,
    });
  } catch {
    return Response.json({ error: 'AGENT_B_MISCONFIGURED' }, { status: 500 });
  }
}
