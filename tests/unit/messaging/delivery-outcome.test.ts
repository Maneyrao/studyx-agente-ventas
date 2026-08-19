import { describe, expect, it } from 'vitest';
import { decideDeliveryOutcome, type ProviderResult } from '@/features/messaging/domain/delivery-outcome';

describe('decideDeliveryOutcome', () => {
  it('records acceptance as submitted, never as delivered', () => {
    const decision = decideDeliveryOutcome({ status: 'accepted', providerMessageId: 'chat:42' });
    // `delivered` would assert a device received it. Providers only confirm
    // that they accepted the message, and this version reads no status
    // callbacks, so the stronger claim has nothing behind it.
    expect(decision.state).toBe('submitted');
    expect(decision.outcome).toBe('sent');
    expect(decision.retireIdentity).toBe(false);
  });

  it('retires the identity on a permanent rejection', () => {
    const decision = decideDeliveryOutcome({ status: 'failed', kind: 'permanent', code: 'TELEGRAM_BLOCKED' });
    expect(decision.state).toBe('dead_letter');
    expect(decision.outcome).toBe('permanent');
    expect(decision.retireIdentity).toBe(true);
  });

  it('treats a closed window as information, not as a failure', () => {
    const decision = decideDeliveryOutcome({ status: 'failed', kind: 'window_closed', code: 'WHATSAPP_131047' });
    // Settling the ledger here would record a fault where the correct move is
    // simply to use another channel.
    expect(decision.state).toBeNull();
    expect(decision.outcome).toBeNull();
    expect(decision.closeWindow).toBe(true);
    expect(decision.tryNextChannel).toBe(true);
    expect(decision.retireIdentity).toBe(false);
  });

  it('keeps a rate limit retryable and carries its wait', () => {
    const decision = decideDeliveryOutcome({
      status: 'failed', kind: 'transient', code: 'RATE_LIMITED', retryAfterSeconds: 12,
    });
    expect(decision.state).toBe('failed_retryable');
    expect(decision.outcome).toBe('retryable');
    expect(decision.retryAfterSeconds).toBe(12);
  });

  it('does not retire an identity over our own misconfiguration', () => {
    const decision = decideDeliveryOutcome({ status: 'failed', kind: 'config_error', code: 'BAD_TOKEN' });
    expect(decision.state).toBe('failed_retryable');
    // A bad token is our deployment's fault; retiring the contact's identity
    // would punish every contact for it.
    expect(decision.retireIdentity).toBe(false);
  });

  it('keeps an ambiguous send retryable and never calls it sent', () => {
    const decision = decideDeliveryOutcome({ status: 'ambiguous', code: 'CHANNEL_SEND_AMBIGUOUS' });
    expect(decision.state).toBe('failed_retryable');
    expect(decision.outcome).toBe('retryable');
    expect(decision.retireIdentity).toBe(false);
  });

  // The invariant the whole feature rests on, asserted across every path.
  it('never produces submitted for anything but a confirmed acceptance', () => {
    const nonAcceptances: ProviderResult[] = [
      { status: 'ambiguous', code: 'TIMEOUT' },
      { status: 'failed', kind: 'permanent', code: 'BLOCKED' },
      { status: 'failed', kind: 'transient', code: 'RATE_LIMITED' },
      { status: 'failed', kind: 'window_closed', code: 'WINDOW' },
      { status: 'failed', kind: 'config_error', code: 'BAD_TOKEN' },
    ];
    for (const result of nonAcceptances) {
      const decision = decideDeliveryOutcome(result);
      expect(decision.state).not.toBe('submitted');
      expect(decision.state).not.toBe('delivered');
      expect(decision.outcome).not.toBe('sent');
    }
  });
});
