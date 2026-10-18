import { describe, expect, it, vi } from 'vitest';
import type { DbClient } from '@/lib/db/types';

describe('loadLatestPaymentVerificationV1', () => {
  it('maps the durable enrollment and access notification attached to the paid attempt', async () => {
    vi.stubEnv('DATABASE_URL', 'postgres://unit:unit@localhost:5432/unit');
    const { loadLatestPaymentVerificationV1 } = await import(
      '@/features/payments/application/read-payment-verification'
    );
    const db = (async () => [{
      status: 'paid',
      offering_code: 'ingles_3',
      plan_code: 'monthly_12',
      paid_at: new Date('2026-10-18T13:05:32.316Z'),
      enrollment_status: 'active',
      access_message_status: 'sent',
      access_sent_at: new Date('2026-10-18T13:05:36.693Z'),
    }]) as unknown as DbClient;

    await expect(loadLatestPaymentVerificationV1({
      workspace_slug: 'studyx',
      contact_id: '00000000-0000-4000-8000-000000000001',
      offering_code: 'ingles_3',
      plan_code: 'monthly_12',
    }, db)).resolves.toEqual({
      status: 'paid',
      offering_code: 'ingles_3',
      plan_code: 'monthly_12',
      paid_at: '2026-10-18T13:05:32.316Z',
      fulfillment: {
        enrollment_status: 'active',
        access_message_status: 'sent',
        access_sent_at: '2026-10-18T13:05:36.693Z',
      },
    });
  });
});
