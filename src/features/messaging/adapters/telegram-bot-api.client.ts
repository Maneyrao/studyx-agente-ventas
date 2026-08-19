export interface TelegramSendMessageInput {
  chatId: string;
  text: string;
  /**
   * Inline confirmation keyboard. Optional: the context-receipt flow needs the
   * two buttons, plain outbound messaging must not carry them.
   */
  correctCallbackData?: string;
  incorrectCallbackData?: string;
}

export interface TelegramBotClient {
  sendMessage(input: TelegramSendMessageInput): Promise<{ messageId: string; acceptedAt: string }>;
  answerCallbackQuery(input: { callbackQueryId: string; text: string }): Promise<void>;
}

/**
 * How the caller should act on a Telegram rejection.
 *
 * Classification is driven by `error_code`, never by `description`. Telegram's
 * official Bot API documentation publishes the error envelope but no table of
 * error strings; the observed wordings come from the server source and are not
 * a stable contract. Branching on them would make this adapter break the day
 * Telegram rephrases a message. Descriptions are kept for telemetry only.
 */
export type TelegramFailureKind = 'permanent' | 'transient' | 'config_error';

export class TelegramApiError extends Error {
  constructor(
    readonly code: 'TELEGRAM_REJECTED' | 'TELEGRAM_RATE_LIMITED',
    readonly retryable: boolean,
    readonly retryAfterSeconds: number | null = null,
    /** Acting classification derived from `error_code`. */
    readonly kind: TelegramFailureKind = 'permanent',
    /** Raw HTTP/Bot API code, kept for auditing. */
    readonly providerErrorCode: number | null = null,
    /** Raw description; telemetry only, never a branching condition. */
    readonly description: string | null = null,
    /**
     * Present when Telegram reports a group was upgraded to a supergroup: the
     * send can succeed against this new chat id.
     */
    readonly migrateToChatId: string | null = null,
  ) {
    super(code);
    this.name = 'TelegramApiError';
  }

  /**
   * A permanent rejection means this chat id will never accept a message
   * again — the user blocked the bot, deactivated the account, or the chat does
   * not exist. The identity should be retired rather than retried.
   */
  get retiresIdentity(): boolean {
    return this.kind === 'permanent';
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
  error_code?: number;
  description?: string;
  parameters?: { retry_after?: number; migrate_to_chat_id?: number };
};

/**
 * 401 — bad token: a deployment fault, not the contact's.
 * 403 — blocked, deactivated, or never started the bot: the identity is dead.
 * 400 — malformed or unknown chat, unless the group migrated to a supergroup,
 *       in which case the same send succeeds against the new chat id.
 * >=500 — Telegram's own fault; worth another attempt.
 */
function classifyTelegramError(
  status: number,
  payload: TelegramEnvelope,
): { kind: TelegramFailureKind; retryable: boolean } {
  const code = payload.error_code ?? status;
  if (code === 401) return { kind: 'config_error', retryable: false };
  if (code === 403) return { kind: 'permanent', retryable: false };
  if (code === 400) {
    return typeof payload.parameters?.migrate_to_chat_id === 'number'
      ? { kind: 'transient', retryable: true }
      : { kind: 'permanent', retryable: false };
  }
  if (code >= 500) return { kind: 'transient', retryable: true };
  return { kind: 'permanent', retryable: false };
}

export class TelegramBotApiClient implements TelegramBotClient {
  constructor(private readonly options: {
    token: string;
    fetchImpl?: typeof fetch;
    timeoutMs: number;
    now?: () => Date;
  }) {}

  async sendMessage(input: TelegramSendMessageInput): Promise<{ messageId: string; acceptedAt: string }> {
    const body: Record<string, unknown> = { chat_id: input.chatId, text: input.text };
    // Only the context-receipt flow supplies callbacks; a plain outbound
    // message must reach the user without a confirmation keyboard attached.
    if (input.correctCallbackData !== undefined && input.incorrectCallbackData !== undefined) {
      body.reply_markup = {
        inline_keyboard: [[
          { text: '✅ Información correcta', callback_data: input.correctCallbackData },
          { text: '❌ Información incorrecta', callback_data: input.incorrectCallbackData },
        ]],
      };
    }
    const payload = await this.request('sendMessage', body);
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
      if (response.status === 429 || payload.error_code === 429) {
        throw new TelegramApiError(
          'TELEGRAM_RATE_LIMITED',
          true,
          typeof payload.parameters?.retry_after === 'number' ? payload.parameters.retry_after : null,
          'transient',
          429,
          payload.description ?? null,
        );
      }
      if (!response.ok || payload.ok !== true) {
        const { kind, retryable } = classifyTelegramError(response.status, payload);
        throw new TelegramApiError(
          'TELEGRAM_REJECTED',
          retryable,
          null,
          kind,
          payload.error_code ?? response.status,
          payload.description ?? null,
          typeof payload.parameters?.migrate_to_chat_id === 'number'
            ? String(payload.parameters.migrate_to_chat_id)
            : null,
        );
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
