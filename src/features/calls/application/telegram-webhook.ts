import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { TelegramBotClient } from '../adapters/telegram-bot-api.client';
import type { ContextReceiptStore, TelegramSmokeBindingStore } from '../ports/context-receipt-store';
import { verifyTelegramContext } from './verify-telegram-context';

const TelegramIdentitySchema = z.object({ id: z.union([z.number().int(), z.string().min(1)]) }).passthrough();
const TelegramMessageSchema = z.object({
  message_id: z.union([z.number().int(), z.string().min(1)]),
  date: z.number().int().nonnegative(),
  text: z.string().optional(),
  chat: TelegramIdentitySchema,
  from: TelegramIdentitySchema,
}).passthrough();
const TelegramCallbackSchema = z.object({
  id: z.string().min(1).max(512),
  data: z.string().min(1).max(64),
  from: TelegramIdentitySchema,
  message: TelegramMessageSchema,
}).passthrough();
export const TelegramAgentBUpdateSchema = z.object({
  update_id: z.union([z.number().int(), z.string().min(1)]),
  message: TelegramMessageSchema.optional(),
  callback_query: TelegramCallbackSchema.optional(),
}).passthrough().superRefine((update, context) => {
  if (update.message && update.callback_query) {
    context.addIssue({ code: 'custom', message: 'AMBIGUOUS_TELEGRAM_UPDATE' });
  }
});

function secretMatches(actual: string | null, expected: string): boolean {
  if (!actual) return false;
  const left = Buffer.from(actual, 'utf8');
  const right = Buffer.from(expected, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

type WebhookDependencies = {
  receipts: ContextReceiptStore & TelegramSmokeBindingStore;
  telegram: TelegramBotClient;
  webhookSecret: string;
  now?: () => Date;
};

export async function handleTelegramWebhook(
  request: Request,
  dependencies: WebhookDependencies,
): Promise<Response> {
  if (!secretMatches(request.headers.get('x-telegram-bot-api-secret-token'), dependencies.webhookSecret)) {
    return Response.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return Response.json({ error: 'INVALID_JSON' }, { status: 400 });
  }
  const parsed = TelegramAgentBUpdateSchema.safeParse(raw);
  if (!parsed.success) return Response.json({ error: 'INVALID_TELEGRAM_UPDATE' }, { status: 400 });
  const update = parsed.data;

  if (update.callback_query) {
    const callback = update.callback_query;
    const result = await verifyTelegramContext({
      updateId: String(update.update_id),
      callbackQueryId: callback.id,
      callbackData: callback.data,
      chatId: String(callback.message.chat.id),
      userId: String(callback.from.id),
      messageId: String(callback.message.message_id),
      receivedAt: (dependencies.now ?? (() => new Date()))().toISOString(),
    }, dependencies);
    return Response.json(result, { status: 200 });
  }

  if (update.message?.text?.match(/^\/start(?:\s|$)/)) {
    try {
      const result = await dependencies.receipts.registerBinding({
        chatId: String(update.message.chat.id),
        userId: String(update.message.from.id),
        startedAt: new Date(update.message.date * 1_000).toISOString(),
      });
      return Response.json({ status: result }, { status: 200 });
    } catch {
      return Response.json({ error: 'TELEGRAM_TESTER_NOT_AUTHORIZED' }, { status: 403 });
    }
  }

  return Response.json({ status: 'ignored' }, { status: 200 });
}
