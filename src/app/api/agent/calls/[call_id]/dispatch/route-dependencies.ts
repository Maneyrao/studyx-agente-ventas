import { randomBytes } from 'node:crypto';
import type postgres from 'postgres';
import { PostgresContextReceiptStore } from '@/features/calls/adapters/postgres-context-receipt-store';
import { RetellVoiceProvider } from '@/features/calls/adapters/retell-voice.provider';
import { TelegramBotApiClient } from '@/features/calls/adapters/telegram-bot-api.client';
import { TelegramSimVoiceProvider } from '@/features/calls/adapters/telegram-sim-voice.provider';
import { XendraVoiceProvider } from '@/features/calls/adapters/xendra-voice.provider';
import type { VoiceProvider } from '@/features/calls/ports/voice-provider';
import type { VoiceDispatchConfig } from '@/lib/config';
import { createSandboxLookup } from '@/lib/repositories/sandbox-identity.repository';
import type { SandboxLookup } from '@/lib/services/sandbox.service';

export function buildDispatchVoiceProvider(
  settings: VoiceDispatchConfig,
  db: postgres.Sql,
  dependencies: {
    fetch?: typeof fetch;
    now?: () => Date;
    nonce?: () => string;
    sandboxLookup?: SandboxLookup;
  } = {},
): VoiceProvider {
  if (settings.voiceProvider === 'retell') {
    return new RetellVoiceProvider(settings, {
      fetch: dependencies.fetch,
      now: dependencies.now,
      sandboxLookup: dependencies.sandboxLookup ?? createSandboxLookup(db),
    });
  }

  if (settings.voiceProvider === 'xendra') {
    return new XendraVoiceProvider(settings, {
      fetch: dependencies.fetch,
      now: dependencies.now,
      sandboxLookup: dependencies.sandboxLookup ?? createSandboxLookup(db),
    });
  }

  const receipts = new PostgresContextReceiptStore(db, {
    expectedChatId: settings.smokeChatId,
    expectedUserId: settings.smokeUserId,
  });
  return new TelegramSimVoiceProvider({
    receipts,
    destinationResolver: receipts,
    telegram: new TelegramBotApiClient({
      token: settings.botToken,
      timeoutMs: settings.requestTimeoutMs,
    }),
    nonce: dependencies.nonce ?? (() => randomBytes(16).toString('base64url')),
  });
}
