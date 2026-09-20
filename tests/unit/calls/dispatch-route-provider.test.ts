import { describe, expect, it, vi } from 'vitest';
import { RetellVoiceProvider } from '@/features/calls/adapters/retell-voice.provider';
import { TelegramSimVoiceProvider } from '@/features/calls/adapters/telegram-sim-voice.provider';
import { XendraVoiceProvider } from '@/features/calls/adapters/xendra-voice.provider';
import type { VoiceDispatchConfig } from '@/lib/config';
import { buildDispatchVoiceProvider } from '@/app/api/agent/calls/[call_id]/dispatch/route-dependencies';

const db = (() => undefined) as never;

describe('dispatch route provider selection', () => {
  it('builds Retell only for an explicitly selected Retell configuration', () => {
    const settings: VoiceDispatchConfig = {
      voiceProvider: 'retell',
      apiKey: 'test-api-key',
      fromNumber: '+14155550123',
      apiBaseUrl: 'https://retell.test',
      agentId: 'agent_d2c1a4ac7900ae95a47727156b',
      agentVersion: 0,
      llmId: 'llm_eea8f670b6569b44689e9394b150',
      llmVersion: 0,
      advisorName: 'Sofía',
      toolsSecret: 'test-tools-secret',
      requestTimeoutMs: 1000,
    };
    expect(buildDispatchVoiceProvider(settings, db, {
      fetch: vi.fn<typeof fetch>(),
      sandboxLookup: { findSandboxProvider: vi.fn(async () => null) },
    })).toBeInstanceOf(RetellVoiceProvider);
  });

  it('keeps the Telegram sandbox adapter for the existing configuration', () => {
    const settings: VoiceDispatchConfig = {
      voiceProvider: 'telegram_sandbox',
      botToken: 'token',
      webhookSecret: 'webhook',
      smokeChatId: 'chat',
      smokeUserId: 'user',
      requestTimeoutMs: 1000,
    };
    expect(buildDispatchVoiceProvider(settings, db, {
      nonce: () => 'nonce',
    })).toBeInstanceOf(TelegramSimVoiceProvider);
  });

  it('builds the Xendra gateway without Retell account credentials', () => {
    const settings: VoiceDispatchConfig = {
      voiceProvider: 'xendra',
      callUrl: 'https://xendra.test/api/studyx/llamar',
      orchestratorSecret: 'test-secret',
      advisorName: '',
      closerNumber: '',
      telegramCanaryContactIds: [],
      requestTimeoutMs: 1000,
    };
    expect(buildDispatchVoiceProvider(settings, db, {
      fetch: vi.fn<typeof fetch>(),
      sandboxLookup: { findSandboxProvider: vi.fn(async () => null) },
    })).toBeInstanceOf(XendraVoiceProvider);
  });

  it('keeps the Next route module limited to supported exports', async () => {
    vi.stubEnv('DATABASE_URL', 'postgresql://postgres@127.0.0.1:55432/studyx_test');
    const routeModule = await import('@/app/api/agent/calls/[call_id]/dispatch/route');
    expect(Object.keys(routeModule).sort()).toEqual(['POST', 'runtime']);
    vi.unstubAllEnvs();
  });
});
