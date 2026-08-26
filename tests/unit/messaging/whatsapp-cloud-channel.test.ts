import { describe, expect, it, vi } from 'vitest';
import {
  classifyWhatsAppError,
  WhatsAppCloudChannel,
  WHATSAPP_WINDOW_CLOSED_CODE,
} from '@/features/messaging/adapters/whatsapp-cloud.channel';
import { AmbiguousChannelError, ConfirmedChannelError } from '@/features/messaging/ports/message-channel';

const respond = (status: number, body: Record<string, unknown>) =>
  vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json' },
  }));

const channel = (fetchImpl: typeof fetch) => new WhatsAppCloudChannel({
  accessToken: 'token', phoneNumberId: '999', graphApiVersion: 'v26.0',
  integrationId: 'whatsapp-cloud', timeoutMs: 100, fetchImpl,
});

const send = (fetchImpl: typeof fetch) =>
  channel(fetchImpl).sendText({ destination: '5491100000000', text: 'hola', correlationId: 'k1' });

describe('classifyWhatsAppError', () => {
  it('maps a closed service window to its own kind, not to a failure', () => {
    expect(classifyWhatsAppError(WHATSAPP_WINDOW_CLOSED_CODE)).toBe('window_closed');
  });

  it('maps an undeliverable recipient to permanent', () => {
    expect(classifyWhatsAppError(131026)).toBe('permanent');
  });

  it('maps throughput limits to transient', () => {
    for (const code of [130429, 80007, 4, 131056]) {
      expect(classifyWhatsAppError(code)).toBe('transient');
    }
  });

  it('maps account and token problems to configuration faults', () => {
    for (const code of [190, 133010, 131042, 131031]) {
      expect(classifyWhatsAppError(code)).toBe('config_error');
    }
  });

  // Wrongly retiring a working identity loses a reachable contact; a needless
  // retry costs one request. The asymmetry decides the default.
  it('defaults an unknown code to transient rather than permanent', () => {
    expect(classifyWhatsAppError(999999)).toBe('transient');
  });
});

describe('WhatsAppCloudChannel', () => {
  it('returns the global wamid without composing it', async () => {
    const result = await send(respond(200, {
      messages: [{ id: 'wamid.ABC123', message_status: 'accepted' }],
    }));
    expect(result.providerMessageId).toBe('wamid.ABC123');
  });

  it('calls the pinned Graph API version', async () => {
    const fetchImpl = respond(200, { messages: [{ id: 'wamid.X' }] });
    await send(fetchImpl);
    expect(String(fetchImpl.mock.calls[0][0])).toContain('/v26.0/999/messages');
  });

  it('surfaces a closed window as window_closed so the caller can switch channel', async () => {
    const error = await send(respond(403, {
      error: { code: WHATSAPP_WINDOW_CLOSED_CODE, message: 'Re-engagement message' },
    })).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConfirmedChannelError);
    expect((error as ConfirmedChannelError).kind).toBe('window_closed');
  });

  it('treats a 200 whose body has no message id as ambiguous', async () => {
    // We cannot tell whether Meta accepted it, so neither claim is safe.
    await expect(send(respond(200, {}))).rejects.toBeInstanceOf(AmbiguousChannelError);
  });

  it('treats a transport failure as ambiguous, never as permanent', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new Error('aborted'));
    await expect(send(fetchImpl)).rejects.toBeInstanceOf(AmbiguousChannelError);
  });

  it('refuses an over-long body instead of truncating it', async () => {
    // A payment link cut in half is worse than a message that never went out.
    const fetchImpl = respond(200, { messages: [{ id: 'wamid.X' }] });
    await expect(channel(fetchImpl).sendText({
      destination: '549', text: 'x'.repeat(4097), correlationId: 'k',
    })).rejects.toThrow(/WHATSAPP_TEXT_TOO_LONG/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
