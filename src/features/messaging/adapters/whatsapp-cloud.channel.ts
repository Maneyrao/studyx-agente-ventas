import {
  AmbiguousChannelError,
  ConfirmedChannelError,
  type ChannelFailureKind,
  type MessageChannel,
  type SendTextInput,
  type SendTextResult,
} from '../ports/message-channel';

const WHATSAPP_MAX_TEXT_LENGTH = 4096;

/** Meta rejects a free-form message once the 24h service window has shut. */
export const WHATSAPP_WINDOW_CLOSED_CODE = 131047;

/**
 * Classification by numeric `error.code`.
 *
 * `error_subcode` is deprecated and absent from v16.0+ responses, so the
 * numeric code is the whole contract. Anything unlisted is treated as transient
 * rather than permanent: wrongly retiring a working identity costs a reachable
 * contact, while a needless retry costs one request.
 */
const PERMANENT_CODES = new Set([131026, 131021, 131051]);
const CONFIG_CODES = new Set([133010, 131031, 131042, 190, 100]);
const TRANSIENT_CODES = new Set([130429, 80007, 4, 131056, 131048, 131000]);

export function classifyWhatsAppError(code: number): ChannelFailureKind {
  if (code === WHATSAPP_WINDOW_CLOSED_CODE) return 'window_closed';
  if (PERMANENT_CODES.has(code)) return 'permanent';
  if (CONFIG_CODES.has(code)) return 'config_error';
  if (TRANSIENT_CODES.has(code)) return 'transient';
  return 'transient';
}

type WhatsAppEnvelope = {
  messages?: Array<{ id?: string }>;
  error?: { code?: number; message?: string; error_data?: { details?: string } };
};

export class WhatsAppCloudChannel implements MessageChannel {
  readonly channel = 'whatsapp' as const;
  readonly provider = 'whatsapp_cloud';
  readonly maxTextLength = WHATSAPP_MAX_TEXT_LENGTH;

  constructor(private readonly options: {
    accessToken: string;
    phoneNumberId: string;
    /** Pinned in configuration; bumping it is a reviewed decision. */
    graphApiVersion: string;
    integrationId: string;
    timeoutMs: number;
    fetchImpl?: typeof fetch;
    now?: () => Date;
  }) {}

  get integrationId(): string {
    return this.options.integrationId;
  }

  async sendText(input: SendTextInput): Promise<SendTextResult> {
    if (input.text.length > this.maxTextLength) {
      throw new ConfirmedChannelError('config_error', 'WHATSAPP_TEXT_TOO_LONG');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      const response = await (this.options.fetchImpl ?? fetch)(
        `https://graph.facebook.com/${this.options.graphApiVersion}/${this.options.phoneNumberId}/messages`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${this.options.accessToken}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: input.destination,
            type: 'text',
            // Links stay clickable regardless; a preview is best-effort on the
            // client and not observable from here, so nothing depends on it.
            text: { preview_url: false, body: input.text },
          }),
          signal: controller.signal,
        },
      );

      const payload = await response.json().catch(() => ({})) as WhatsAppEnvelope;

      if (!response.ok || payload.error) {
        const code = payload.error?.code ?? response.status;
        const kind = classifyWhatsAppError(code);
        throw new ConfirmedChannelError(kind, `WHATSAPP_${code}`);
      }

      const messageId = payload.messages?.[0]?.id;
      if (typeof messageId !== 'string' || messageId.length === 0) {
        // A 200 we cannot read is not proof of anything either way.
        throw new AmbiguousChannelError('WHATSAPP_UNREADABLE_RESPONSE');
      }

      // `wamid.` is already globally unique, so unlike Telegram it needs no
      // composition to satisfy the ledger's uniqueness constraint.
      return {
        providerMessageId: messageId,
        acceptedAt: (this.options.now ?? (() => new Date()))().toISOString(),
      };
    } catch (error) {
      if (error instanceof ConfirmedChannelError || error instanceof AmbiguousChannelError) throw error;
      // Timeout or transport failure: the message may already be on its way.
      throw new AmbiguousChannelError('WHATSAPP_SEND_AMBIGUOUS');
    } finally {
      clearTimeout(timeout);
    }
  }
}
