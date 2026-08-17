import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { openLocalTestDatabase } from '../helpers/db';
import { reservePayment, PaymentReservationError } from '@/features/payments/application/reserve-payment';
import { createCheckout } from '@/features/payments/application/create-checkout';
import { recordPaymentEvent } from '@/features/payments/application/record-payment-event';
import { FakePaymentProvider } from '@/features/payments/adapters/fake-payment-provider';
import { AmbiguousCheckoutError } from '@/features/payments/ports/payment-provider';

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const db = process.env.TEST_DATABASE_URL ? openLocalTestDatabase() : null;
afterAll(async () => db?.end());

async function workspaceFixture() {
  const rows = await db!<Array<{ id: string }>>`
    INSERT INTO workspaces (slug, display_name)
    VALUES (${`test-pay-${randomUUID().slice(0, 8)}`}, 'Pagos Test') RETURNING id
  `;
  return rows[0].id;
}

async function contactFixture() {
  const rows = await db!<Array<{ id: string }>>`
    INSERT INTO contacts (phone, status, channel_origin)
    VALUES (${`+54911${Math.floor(10_000_000 + Math.random() * 89_999_999)}`}, 'prospecto', 'whatsapp')
    RETURNING id
  `;
  return rows[0].id;
}

async function offeringFixture(input: {
  workspaceId: string;
  priceType?: 'fixed' | 'quote' | 'free';
  amount?: string;
  currency?: string;
  configStatus?: 'active' | 'inactive';
}) {
  const code = `OFF-${randomUUID().slice(0, 8)}`;
  const offerings = await db!<Array<{ id: string }>>`
    INSERT INTO offerings (
      workspace_id, code, display_name, offering_type, status, description,
      price_type, price_amount, currency, billing_interval
    ) VALUES (
      ${input.workspaceId}::uuid, ${code}, 'Curso Pago', 'course', 'active', 'desc',
      ${input.priceType ?? 'fixed'},
      ${input.priceType === 'quote' || input.priceType === 'free' ? null : (input.amount ?? '150000.00')},
      ${input.priceType === 'quote' || input.priceType === 'free' ? null : (input.currency ?? 'ARS')},
      'one_time'
    ) RETURNING id
  `;
  await db!`
    INSERT INTO offering_payment_configs (offering_id, provider, checkout_mode, environment, status)
    VALUES (${offerings[0].id}::uuid, 'fake', 'payment', 'test', ${input.configStatus ?? 'active'})
  `;
  return { id: offerings[0].id, code };
}

async function paymentRow(paymentId: string) {
  const rows = await db!<Array<{
    id: string; status: string; amount: string; currency: string;
    provider_session_id: string | null; checkout_url: string | null; paid_at: Date | null;
  }>>`
    SELECT id, status, amount::text AS amount, currency, provider_session_id, checkout_url, paid_at
    FROM payments WHERE id = ${paymentId}::uuid
  `;
  return rows[0];
}

async function reserveFixture(overrides: { priceType?: 'fixed' | 'quote' | 'free' } = {}) {
  const workspaceId = await workspaceFixture();
  const contactId = await contactFixture();
  const offering = await offeringFixture({ workspaceId, priceType: overrides.priceType });
  return { workspaceId, contactId, offering };
}

run('canonical payments — reservation', () => {
  it('reserves a fixed-price offering with the canonical amount, ignoring hostile input', async () => {
    const { workspaceId, contactId, offering } = await reserveFixture();

    const reserved = await reservePayment(db!, {
      workspace_id: workspaceId,
      contact_id: contactId,
      offering_id: offering.id,
      idempotency_key: `reserve:${randomUUID()}`,
      // Hostile extras a model or caller might smuggle in: they must be inert.
      ...({ amount: '1.00', currency: 'USD', stripe_price_id: 'price_evil' } as object),
    });

    const row = await paymentRow(reserved.payment_id);
    expect(row.status).toBe('reserved');
    expect(row.amount).toBe('150000.00');
    expect(row.currency).toBe('ARS');
  });

  it('replaying the same idempotency key 10 times keeps exactly one payment', async () => {
    const { workspaceId, contactId, offering } = await reserveFixture();
    const key = `reserve:${randomUUID()}`;

    const first = await reservePayment(db!, {
      workspace_id: workspaceId, contact_id: contactId,
      offering_id: offering.id, idempotency_key: key,
    });
    for (let i = 0; i < 9; i++) {
      const replay = await reservePayment(db!, {
        workspace_id: workspaceId, contact_id: contactId,
        offering_id: offering.id, idempotency_key: key,
      });
      expect(replay.payment_id).toBe(first.payment_id);
    }
    const count = await db!<Array<{ n: string }>>`
      SELECT count(*)::text AS n FROM payments WHERE idempotency_key = ${key}
    `;
    expect(count[0].n).toBe('1');
  });

  it('a quote offering cannot be paid without a confirmed, current quote', async () => {
    const { workspaceId, contactId, offering } = await reserveFixture({ priceType: 'quote' });

    await expect(reservePayment(db!, {
      workspace_id: workspaceId, contact_id: contactId,
      offering_id: offering.id, idempotency_key: `reserve:${randomUUID()}`,
    })).rejects.toMatchObject({ code: 'QUOTE_REQUIRED' });

    const draft = await db!<Array<{ id: string }>>`
      INSERT INTO commercial_quotes (workspace_id, contact_id, offering_id, amount, currency, status)
      VALUES (${workspaceId}::uuid, ${contactId}::uuid, ${offering.id}::uuid, '99000.00', 'ARS', 'draft')
      RETURNING id
    `;
    await expect(reservePayment(db!, {
      workspace_id: workspaceId, contact_id: contactId,
      offering_id: offering.id, quote_id: draft[0].id,
      idempotency_key: `reserve:${randomUUID()}`,
    })).rejects.toMatchObject({ code: 'QUOTE_NOT_CONFIRMED' });

    const stale = await db!<Array<{ id: string }>>`
      INSERT INTO commercial_quotes (workspace_id, contact_id, offering_id, amount, currency, status, valid_until)
      VALUES (${workspaceId}::uuid, ${contactId}::uuid, ${offering.id}::uuid, '99000.00', 'ARS', 'confirmed', now() - interval '1 day')
      RETURNING id
    `;
    await expect(reservePayment(db!, {
      workspace_id: workspaceId, contact_id: contactId,
      offering_id: offering.id, quote_id: stale[0].id,
      idempotency_key: `reserve:${randomUUID()}`,
    })).rejects.toMatchObject({ code: 'QUOTE_EXPIRED' });

    const confirmed = await db!<Array<{ id: string }>>`
      INSERT INTO commercial_quotes (workspace_id, contact_id, offering_id, amount, currency, status, valid_until)
      VALUES (${workspaceId}::uuid, ${contactId}::uuid, ${offering.id}::uuid, '99000.00', 'ARS', 'confirmed', now() + interval '7 days')
      RETURNING id
    `;
    const reserved = await reservePayment(db!, {
      workspace_id: workspaceId, contact_id: contactId,
      offering_id: offering.id, quote_id: confirmed[0].id,
      idempotency_key: `reserve:${randomUUID()}`,
    });
    const row = await paymentRow(reserved.payment_id);
    expect(row.amount).toBe('99000.00');
    expect(row.currency).toBe('ARS');
  });

  it('a free offering never produces a payment', async () => {
    const { workspaceId, contactId, offering } = await reserveFixture({ priceType: 'free' });
    await expect(reservePayment(db!, {
      workspace_id: workspaceId, contact_id: contactId,
      offering_id: offering.id, idempotency_key: `reserve:${randomUUID()}`,
    })).rejects.toBeInstanceOf(PaymentReservationError);
  });

  it('the payment identity is immutable at the database level', async () => {
    const { workspaceId, contactId, offering } = await reserveFixture();
    const reserved = await reservePayment(db!, {
      workspace_id: workspaceId, contact_id: contactId,
      offering_id: offering.id, idempotency_key: `reserve:${randomUUID()}`,
    });
    await expect(db!`
      UPDATE payments SET amount = '1.00' WHERE id = ${reserved.payment_id}::uuid
    `).rejects.toThrow(/immutable/);
  });
});

run('canonical payments — checkout creation', () => {
  async function reservedPayment() {
    const { workspaceId, contactId, offering } = await reserveFixture();
    const reserved = await reservePayment(db!, {
      workspace_id: workspaceId, contact_id: contactId,
      offering_id: offering.id, idempotency_key: `reserve:${randomUUID()}`,
    });
    return reserved.payment_id;
  }

  it('creates one checkout session with the exact idempotency key checkout:{payment_id}', async () => {
    const paymentId = await reservedPayment();
    const provider = new FakePaymentProvider();

    const result = await createCheckout(db!, { payment_id: paymentId }, { provider });
    expect(result.status).toBe('pending');
    expect(result.checkout_url).toBeTruthy();

    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0].idempotencyKey).toBe(`checkout:${paymentId}`);

    const row = await paymentRow(paymentId);
    expect(row.status).toBe('pending');
    expect(row.provider_session_id).toBeTruthy();
  });

  it('a duplicate createCheckout reuses the session without a second provider call', async () => {
    const paymentId = await reservedPayment();
    const provider = new FakePaymentProvider();

    const first = await createCheckout(db!, { payment_id: paymentId }, { provider });
    const second = await createCheckout(db!, { payment_id: paymentId }, { provider });
    expect(second.checkout_url).toBe(first.checkout_url);
    expect(provider.calls).toHaveLength(1);
  });

  it('two concurrent creations produce exactly one provider call', async () => {
    const paymentId = await reservedPayment();
    const provider = new FakePaymentProvider();

    const dbA = openLocalTestDatabase();
    const dbB = openLocalTestDatabase();
    try {
      await Promise.all([
        createCheckout(dbA, { payment_id: paymentId }, { provider }),
        createCheckout(dbB, { payment_id: paymentId }, { provider }),
      ]);
    } finally {
      await dbA.end();
      await dbB.end();
    }
    expect(provider.calls).toHaveLength(1);
    expect((await paymentRow(paymentId)).status).toBe('pending');
  });

  it('an unknown-outcome timeout parks the payment in creation_ambiguous and retries with the SAME key', async () => {
    const paymentId = await reservedPayment();
    const provider = new FakePaymentProvider();
    provider.failNextWith(new AmbiguousCheckoutError('PROVIDER_TIMEOUT'));

    const first = await createCheckout(db!, { payment_id: paymentId }, { provider });
    expect(first.status).toBe('creation_ambiguous');
    expect((await paymentRow(paymentId)).status).toBe('creation_ambiguous');

    const retry = await createCheckout(db!, { payment_id: paymentId }, { provider });
    expect(retry.status).toBe('pending');
    expect(provider.calls).toHaveLength(2);
    expect(provider.calls[0].idempotencyKey).toBe(provider.calls[1].idempotencyKey);
  });
});

run('canonical payments — event recording', () => {
  async function pendingPayment() {
    const { workspaceId, contactId, offering } = await reserveFixture();
    const reserved = await reservePayment(db!, {
      workspace_id: workspaceId, contact_id: contactId,
      offering_id: offering.id, idempotency_key: `reserve:${randomUUID()}`,
    });
    await createCheckout(db!, { payment_id: reserved.payment_id }, { provider: new FakePaymentProvider() });
    return reserved.payment_id;
  }

  async function fulfillmentJobs(paymentId: string) {
    return db!<Array<{ id: string; status: string }>>`
      SELECT id, status FROM fulfillment_jobs WHERE payment_id = ${paymentId}::uuid
    `;
  }

  it('a paid event marks paid and enqueues exactly one fulfillment job, even replayed x10', async () => {
    const paymentId = await pendingPayment();
    const eventId = `evt_${randomUUID()}`;

    for (let i = 0; i < 10; i++) {
      await recordPaymentEvent(db!, {
        payment_id: paymentId,
        provider: 'fake',
        provider_event_id: eventId,
        event: { type: 'checkout_completed_paid' },
        payload: { i },
      });
    }

    const row = await paymentRow(paymentId);
    expect(row.status).toBe('paid');
    expect(row.paid_at).not.toBeNull();
    expect(await fulfillmentJobs(paymentId)).toHaveLength(1);

    const events = await db!<Array<{ n: string }>>`
      SELECT count(*)::text AS n FROM payment_events
      WHERE provider = 'fake' AND provider_event_id = ${eventId}
    `;
    expect(events[0].n).toBe('1');
  });

  it('a completed session that is still unpaid never marks paid', async () => {
    const paymentId = await pendingPayment();
    const result = await recordPaymentEvent(db!, {
      payment_id: paymentId,
      provider: 'fake',
      provider_event_id: `evt_${randomUUID()}`,
      event: { type: 'checkout_completed_unpaid' },
      payload: {},
    });
    expect(result.outcome).toBe('ignored');
    expect((await paymentRow(paymentId)).status).toBe('pending');
    expect(await fulfillmentJobs(paymentId)).toHaveLength(0);
  });

  it('out-of-order events cannot regress a paid payment', async () => {
    const paymentId = await pendingPayment();
    await recordPaymentEvent(db!, {
      payment_id: paymentId, provider: 'fake',
      provider_event_id: `evt_${randomUUID()}`,
      event: { type: 'async_payment_succeeded' }, payload: {},
    });
    const late = await recordPaymentEvent(db!, {
      payment_id: paymentId, provider: 'fake',
      provider_event_id: `evt_${randomUUID()}`,
      event: { type: 'checkout_expired' }, payload: {},
    });
    expect(late.outcome).toBe('ignored');
    expect((await paymentRow(paymentId)).status).toBe('paid');
    expect(await fulfillmentJobs(paymentId)).toHaveLength(1);
  });

  it('payment_events is append-only', async () => {
    const paymentId = await pendingPayment();
    await recordPaymentEvent(db!, {
      payment_id: paymentId, provider: 'fake',
      provider_event_id: `evt_${randomUUID()}`,
      event: { type: 'checkout_expired' }, payload: {},
    });
    await expect(db!`
      UPDATE payment_events SET event_type = 'tampered' WHERE payment_id = ${paymentId}::uuid
    `).rejects.toThrow(/append-only/);
    await expect(db!`
      DELETE FROM payment_events WHERE payment_id = ${paymentId}::uuid
    `).rejects.toThrow(/append-only/);
  });
});
