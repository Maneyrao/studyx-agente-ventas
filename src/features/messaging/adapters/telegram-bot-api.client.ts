export interface TelegramSendMessageInput {
  chatId: string;
  text: string;
  correctCallbackData: string;
  incorrectCallbackData: string;
}

export interface TelegramBotClient {
  sendMessage(input: TelegramSendMessageInput): Promise<{ messageId: string; acceptedAt: string }>;
  answerCallbackQuery(input: { callbackQueryId: string; text: string }): Promise<void>;
}

export class TelegramApiError extends Error {
  constructor(
    readonly code: 'TELEGRAM_REJECTED' | 'TELEGRAM_RATE_LIMITED',
    readonly retryable: boolean,
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(code);
    this.name = 'TelegramApiError';
  }
}

export class TelegramAmbiguousError extends Error {
  readonly code = 'TELEGRAM_SEND_AMBIGUOUS' as const;

  constructor() {
    super('TELEGRAM_SEND_AMBIGUOUS');
    this.name = 'TelegramAmbiguousError';
  }
}

type TelegramEnvelope = {
  ok?: boolean;
  result?: unknown;
  parameters?: { retry_after?: number };
};

export class TelegramBotApiClient implements TelegramBotClient {
  constructor(private readonly options: {
    token: string;
    fetchImpl?: typeof fetch;
    timeoutMs: number;
    now?: () => Date;
  }) {}

  async sendMessage(input: TelegramSendMessageInput): Promise<{ messageId: string; acceptedAt: string }> {
    const payload = await this.request('sendMessage', {
      chat_id: input.chatId,
      text: input.text,
      reply_markup: {
        inline_keyboard: [[
          { text: '✅ Información correcta', callback_data: input.correctCallbackData },
          { text: '❌ Información incorrecta', callback_data: input.incorrectCallbackData },
        ]],
      },
    });
    const result = payload.result;
    if (result === null || typeof result !== 'object' || !('message_id' in result)) {
      throw new TelegramApiError('TELEGRAM_REJECTED', false);
    }
    const messageId = (result as { message_id: unknown }).message_id;
    if (typeof messageId !== 'string' && typeof messageId !== 'number') {
      throw new TelegramApiError('TELEGRAM_REJECTED', false);
    }
    return {
      messageId: String(messageId),
      acceptedAt: (this.options.now ?? (() => new Date()))().toISOString(),
    };
  }

  async answerCallbackQuery(input: { callbackQueryId: string; text: string }): Promise<void> {
    await this.request('answerCallbackQuery', {
      callback_query_id: input.callbackQueryId,
      text: input.text,
      show_alert: false,
    });
  }

  private async request(method: string, body: Record<string, unknown>): Promise<TelegramEnvelope> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      const response = await (this.options.fetchImpl ?? fetch)(
        `https://api.telegram.org/bot${this.options.token}/${method}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal,
        },
      );
      const payload = await response.json().catch(() => ({})) as TelegramEnvelope;
      if (response.status === 429) {
        throw new TelegramApiError(
          'TELEGRAM_RATE_LIMITED',
          true,
          typeof payload.parameters?.retry_after === 'number' ? payload.parameters.retry_after : null,
        );
      }
      if (!response.ok || payload.ok !== true) {
        throw new TelegramApiError('TELEGRAM_REJECTED', false);
      }
      return payload;
    } catch (error) {
      if (error instanceof TelegramApiError) throw error;
      throw new TelegramAmbiguousError();
    } finally {
      clearTimeout(timeout);
    }
  }
}
