import { describe, expect, it } from 'vitest';
import { isCentralCargaBonusEnabledForContact, isCentralCargaBonusFulfillmentAllowedForContact,
  isCentralCargaBonusConfigured, loadCentralCargaBonusConfig } from '@/features/fulfillment/central-carga/config';

const oldContact = '00000000-0000-4000-8000-000000000001';
const newContact = '00000000-0000-4000-8000-000000000002';
const phone = '+5491169004497';

describe('phone-scoped course bonus test permission', () => {
  it('normalizes and deduplicates configured international phones without enabling all contacts', () => {
    const config = loadCentralCargaBonusConfig({ CENTRAL_CARGA_BONUS_ENABLED: 'false',
      CENTRAL_CARGA_BONUS_CANARY_PHONE_E164S: ' +54 (9) 11 6900-4497,5491169004497,not-a-phone,+99912345678 ' });
    expect(config).toMatchObject({ enabled: false, canaryPhoneE164s: [phone] });
    expect(isCentralCargaBonusConfigured(config)).toBe(true);
    expect(isCentralCargaBonusEnabledForContact(config, newContact, '+15551234567')).toBe(false);
  });
  it('preserves the same phone permission across a lead reset that changes its contact ID', () => {
    const config = loadCentralCargaBonusConfig({ CENTRAL_CARGA_BONUS_ENABLED: 'false',
      CENTRAL_CARGA_BONUS_CANARY_PHONE_E164S: phone });
    expect(isCentralCargaBonusEnabledForContact(config, oldContact, phone)).toBe(true);
    expect(isCentralCargaBonusEnabledForContact(config, newContact, phone)).toBe(true);
    expect(isCentralCargaBonusEnabledForContact(config, newContact)).toBe(false);
  });
  it('uses the same phone permission for a paused fulfillment rollout', () => {
    const config = loadCentralCargaBonusConfig({ CENTRAL_CARGA_BONUS_FULFILLMENT_PAUSED: 'true',
      CENTRAL_CARGA_BONUS_CANARY_PHONE_E164S: phone });
    expect(isCentralCargaBonusFulfillmentAllowedForContact(config, newContact, phone)).toBe(true);
    expect(isCentralCargaBonusFulfillmentAllowedForContact(config, newContact, '+15551234567')).toBe(false);
  });
});
