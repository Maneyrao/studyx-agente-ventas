import { describe, expect, it, vi } from 'vitest';

import {
  WHATSAPP_TYPING_START_TIMEOUT_MS,
  WHATSAPP_TYPING_STOP_TIMEOUT_MS,
  settleWhatsAppTypingStartV1,
  settleWhatsAppTypingStopV1,
} from '../../../botpress-agent/src/lib/channels/whatsapp-typing-presence';

describe('WhatsApp typing presence request', () => {
  it('accepts a provider acknowledgement', async () => {
    await expect(settleWhatsAppTypingStartV1(Promise.resolve({}))).resolves.toBe('started');
  });

  it('preserves a provider rejection for the workflow to record', async () => {
    await expect(settleWhatsAppTypingStartV1(Promise.reject(new Error('provider failed'))))
      .rejects.toThrow('provider failed');
  });

  it('times out a hung presence request without blocking the sales reply', async () => {
    vi.useFakeTimers();
    try {
      const pendingProvider = new Promise<Record<string, never>>(() => undefined);
      const result = settleWhatsAppTypingStartV1(pendingProvider);
      await vi.advanceTimersByTimeAsync(WHATSAPP_TYPING_START_TIMEOUT_MS);
      await expect(result).resolves.toBe('timed_out');
    } finally {
      vi.useRealTimers();
    }
  });

  it('times out a hung stop request without blocking the sales reply', async () => {
    vi.useFakeTimers();
    try {
      const pendingProvider = new Promise<Record<string, never>>(() => undefined);
      const result = settleWhatsAppTypingStopV1(pendingProvider);
      await vi.advanceTimersByTimeAsync(WHATSAPP_TYPING_STOP_TIMEOUT_MS);
      await expect(result).resolves.toBe('timed_out');
    } finally {
      vi.useRealTimers();
    }
  });
});
