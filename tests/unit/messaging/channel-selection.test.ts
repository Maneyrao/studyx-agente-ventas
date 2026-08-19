import { describe, expect, it } from 'vitest';
import { isWithinReplyWindow, selectChannels } from '@/features/messaging/domain/channel-selection';
import type { ChannelIdentity } from '@/features/messaging/ports/channel-identity-store';

const NOW = new Date('2026-08-18T12:00:00Z');
const OPEN = '2026-08-18T20:00:00Z';
const EXPIRED = '2026-08-17T20:00:00Z';

const identity = (over: Partial<ChannelIdentity> = {}): ChannelIdentity => ({
  channel: 'telegram', provider: 'telegram', integrationId: 'telegram-bot',
  destination: '111', lastSeenAt: '2026-08-18T10:00:00Z', ...over,
});

const base = {
  replyWindowExpiresAt: {} as Record<string, string | null>,
  configuredChannels: ['whatsapp', 'telegram'] as const,
  preferenceOrder: ['whatsapp', 'telegram'] as const,
  now: NOW,
};

describe('isWithinReplyWindow', () => {
  it('treats Telegram as always open: it enforces no service window', () => {
    expect(isWithinReplyWindow('telegram', {}, NOW)).toBe(true);
  });

  it('treats WhatsApp with no recorded window as closed', () => {
    // No inbound has ever opened one, so a free-form message would be rejected.
    expect(isWithinReplyWindow('whatsapp', {}, NOW)).toBe(false);
  });

  it('treats an expired WhatsApp window as closed', () => {
    expect(isWithinReplyWindow('whatsapp', { whatsapp: EXPIRED }, NOW)).toBe(false);
  });

  it('treats a live WhatsApp window as open', () => {
    expect(isWithinReplyWindow('whatsapp', { whatsapp: OPEN }, NOW)).toBe(true);
  });
});

describe('selectChannels', () => {
  it('honours an explicit preference', () => {
    const result = selectChannels({
      ...base,
      identities: [identity({ channel: 'telegram' }), identity({ channel: 'whatsapp', destination: '+549' })],
      replyWindowExpiresAt: { whatsapp: OPEN },
      configuredChannels: ['whatsapp', 'telegram'],
      preferenceOrder: ['whatsapp', 'telegram'],
      preferredChannel: 'telegram',
    });
    expect(result[0].channel).toBe('telegram');
  });

  // The core fallback case: WhatsApp is preferred but its window has lapsed.
  it('falls back to Telegram when the WhatsApp window has expired', () => {
    const result = selectChannels({
      ...base,
      identities: [identity({ channel: 'whatsapp', destination: '+549' }), identity({ channel: 'telegram' })],
      replyWindowExpiresAt: { whatsapp: EXPIRED },
      configuredChannels: ['whatsapp', 'telegram'],
      preferenceOrder: ['whatsapp', 'telegram'],
      preferredChannel: 'whatsapp',
    });
    expect(result.map((r) => r.channel)).toEqual(['telegram']);
  });

  it('reports nobody reachable when no identity is usable', () => {
    const result = selectChannels({
      ...base,
      identities: [identity({ channel: 'whatsapp', destination: '+549' })],
      replyWindowExpiresAt: { whatsapp: EXPIRED },
      configuredChannels: ['whatsapp', 'telegram'],
      preferenceOrder: ['whatsapp', 'telegram'],
    });
    expect(result).toEqual([]);
  });

  it('skips a channel the deployment has no credentials for', () => {
    const result = selectChannels({
      ...base,
      identities: [identity({ channel: 'telegram' })],
      configuredChannels: ['whatsapp'],
      preferenceOrder: ['whatsapp', 'telegram'],
    });
    expect(result).toEqual([]);
  });

  it('orders by tenant preference when the caller states none', () => {
    const result = selectChannels({
      ...base,
      identities: [identity({ channel: 'telegram' }), identity({ channel: 'whatsapp', destination: '+549' })],
      replyWindowExpiresAt: { whatsapp: OPEN },
      configuredChannels: ['whatsapp', 'telegram'],
      preferenceOrder: ['telegram', 'whatsapp'],
    });
    expect(result.map((r) => r.channel)).toEqual(['telegram', 'whatsapp']);
  });

  // A non-deterministic order would make a failed send impossible to reproduce.
  it('breaks ties by recency and then stably, so the order is reproducible', () => {
    const input = {
      ...base,
      identities: [
        identity({ destination: 'b', lastSeenAt: '2026-08-18T09:00:00Z' }),
        identity({ destination: 'a', lastSeenAt: '2026-08-18T11:00:00Z' }),
        identity({ destination: 'c', lastSeenAt: '2026-08-18T09:00:00Z' }),
      ],
      configuredChannels: ['telegram'] as Array<'whatsapp' | 'telegram'>,
      preferenceOrder: ['telegram'] as Array<'whatsapp' | 'telegram'>,
    };
    expect(selectChannels({ ...input }).map((r) => r.destination)).toEqual(['a', 'b', 'c']);
    expect(selectChannels({ ...input }).map((r) => r.destination)).toEqual(['a', 'b', 'c']);
  });
});
