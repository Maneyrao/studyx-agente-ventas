import {
  AmbiguousChannelError,
  ConfirmedChannelError,
  type MessageChannel,
  type MessagingChannelName,
  type SendTextInput,
  type SendTextResult,
} from '../ports/message-channel';
import { counter } from '@/lib/observability/counters';

export interface BotpressManagedChannelConfig {
  readonly apiUrl: string;
  readonly token: string;
  readonly botId: string;
  readonly timeoutMs: number;
}

function retryAfterSeconds(response: Response): number | null {
  const raw = response.headers.get('retry-after');
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function confirmedFailure(response: Response): ConfirmedChannelError {
  const code = `BOTPRESS_HTTP_${response.status}`;
  if (response.status === 404 || response.status === 410) {
    return new ConfirmedChannelError('permanent', code);
  }
  if (response.status === 401 || response.status === 403) {
    return new ConfirmedChannelError('config_error', code);
  }
  return new ConfirmedChannelError(
    'transient',
    code,
    response.status === 429 ? retryAfterSeconds(response) : null,
  );
}

/**
 * Sends through the channel connection already owned by Botpress (Telegram,
 * WhatsApp OAuth, etc.). The orchestrator never needs the provider's private
 * channel token and therefore cannot drift from the channel used by Agent A.
 */
export class BotpressManagedChannel implements MessageChannel {
  readonly provider = 'botpress';
  readonly integrationId: string;
  readonly maxTextLength = 4096;

  constructor(
    private readonly config: BotpressManagedChannelConfig,
    readonly channel: MessagingChannelName,
  ) {
    this.integrationId = `botpress:${config.botId}`;
  }

  async sendText(input: SendTextInput): Promise<SendTextResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
    let response: Response;
    try {
      response = await fetch(`${this.config.apiUrl.replace(/\/$/u, '')}/v1/chat/messages`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.config.token}`,
          'content-type': 'application/json',
          'x-bot-id': this.config.botId,
          'x-studyx-correlation-id': input.correlationId,
        },
        body: JSON.stringify({
          payload: { text: input.text },
          userId: this.config.botId,
          conversationId: input.destination,
          type: 'text',
          tags: {},
        }),
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new AmbiguousChannelError('BOTPRESS_SEND_TIMEOUT');
      }
      throw new AmbiguousChannelError('BOTPRESS_SEND_NETWORK_AMBIGUOUS');
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) throw confirmedFailure(response);

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new AmbiguousChannelError('BOTPRESS_RESPONSE_UNREADABLE');
    }
    const message = payload !== null && typeof payload === 'object'
      ? (payload as {
          message?: {
            id?: unknown;
            createdAt?: unknown;
            direction?: unknown;
            origin?: unknown;
          };
        }).message
      : null;
    if (!message || typeof message.id !== 'string') {
      throw new AmbiguousChannelError('BOTPRESS_MESSAGE_ID_MISSING');
    }
    // Botpress only forwards messages created *as the bot* to the installed
    // Telegram/WhatsApp integration. An incoming message can still have a
    // perfectly valid Botpress ID, but it remains internal and never reaches
    // the contact. Do not turn that persistence acknowledgement into a false
    // delivery success.
    if (message.direction !== 'outgoing') {
      counter.increment('botpress_managed_non_outgoing_messages');
      throw new ConfirmedChannelError('config_error', 'BOTPRESS_MESSAGE_NOT_OUTGOING');
    }
    if ('origin' in message && message.origin === 'synthetic') {
      counter.increment('botpress_managed_synthetic_messages');
      throw new ConfirmedChannelError(
        'config_error',
        'BOTPRESS_SYNTHETIC_MESSAGE_NOT_DELIVERED',
      );
    }
    counter.increment('botpress_managed_submissions_unreconciled');
    return {
      providerMessageId: message.id,
      acceptedAt: typeof message.createdAt === 'string'
        ? message.createdAt
        : new Date().toISOString(),
    };
  }
}
