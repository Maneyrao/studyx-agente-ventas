import { describe, expect, it } from 'vitest';
import {
  RealSideEffectRejectedError,
  assertRealSideEffectAllowed,
  isSandboxContact,
  type SandboxLookup,
} from '@/lib/services/sandbox.service';

function fakeLookup(map: Record<string, string | null>): SandboxLookup {
  return {
    async findSandboxProvider(contactId: string) {
      return contactId in map ? map[contactId] : null;
    },
  };
}

describe('assertRealSideEffectAllowed', () => {
  it('resolves silently for a contact with no sandbox row', async () => {
    const lookup = fakeLookup({ 'contact-prod-1': null });
    await expect(
      assertRealSideEffectAllowed(lookup, {
        contactId: 'contact-prod-1',
        effect: 'STRIPE_CHARGE',
      }),
    ).resolves.toBeUndefined();
  });

  it('throws RealSideEffectRejectedError for a telegram_sandbox contact', async () => {
    const lookup = fakeLookup({ 'contact-sandbox-1': 'telegram_sandbox' });
    await expect(
      assertRealSideEffectAllowed(lookup, {
        contactId: 'contact-sandbox-1',
        effect: 'RETELL_OUTBOUND_CALL',
      }),
    ).rejects.toBeInstanceOf(RealSideEffectRejectedError);
  });

  it('reports the attempted effect and provider on the error', async () => {
    const lookup = fakeLookup({ 'contact-sandbox-1': 'telegram_sandbox' });
    try {
      await assertRealSideEffectAllowed(lookup, {
        contactId: 'contact-sandbox-1',
        effect: 'WHATSAPP_OUTBOUND',
      });
      throw new Error('expected assertRealSideEffectAllowed to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(RealSideEffectRejectedError);
      const rejected = err as RealSideEffectRejectedError;
      expect(rejected.code).toBe('CONTACT_IS_SANDBOX');
      expect(rejected.provider).toBe('telegram_sandbox');
      expect(rejected.attemptedEffect).toBe('WHATSAPP_OUTBOUND');
      expect(rejected.contactId).toBe('contact-sandbox-1');
    }
  });

  it.each([
    'RETELL_OUTBOUND_CALL',
    'STRIPE_CHARGE',
    'WHATSAPP_OUTBOUND',
    'GOOGLE_SHEETS_ROW',
    'EMAIL_SEND',
  ])('rejects all real side effect names for sandbox contact: %s', async (effect) => {
    const lookup = fakeLookup({ 'sandbox': 'telegram_sandbox' });
    await expect(
      assertRealSideEffectAllowed(lookup, { contactId: 'sandbox', effect }),
    ).rejects.toBeInstanceOf(RealSideEffectRejectedError);
  });
});

describe('isSandboxContact', () => {
  it('returns true when the lookup returns a provider', async () => {
    const lookup = fakeLookup({ c1: 'telegram_sandbox' });
    expect(await isSandboxContact(lookup, 'c1')).toBe(true);
  });

  it('returns false when the lookup returns null', async () => {
    const lookup = fakeLookup({ c1: null });
    expect(await isSandboxContact(lookup, 'c1')).toBe(false);
  });

  it('returns false for an unknown contact id', async () => {
    const lookup = fakeLookup({});
    expect(await isSandboxContact(lookup, 'unknown')).toBe(false);
  });
});
