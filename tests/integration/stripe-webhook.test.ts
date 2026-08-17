import { randomUUID } from 'node:crypto';
import Stripe from 'stripe';
import { afterAll, describe, expect, it } from 'vitest';
import { openLocalTestDatabase } from '../helpers/db';
import { reservePayment } from '@/features/payments/application/reserve-payment';
import { createCheckout } from '@/features/payments/application/create-checkout';
import { FakePaymentProvider } from '@/features/payments/adapters/fake-payment-provider';
import { processStripeWebhook } from '@/features/payments/application/process-stripe-webhook';

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const db = process.env.TEST_DATABASE_URL ? openLocalTestDatabase() : null;
afterAll(async () => db?.end());

const WEBHOOK_SECRET = 'whsec_test_secret_for_vitest';
const stripe = new Stripe('sk_test_dummy_key_never_used_for_network');

async function paymentFixture() {
  const workspaces = await db!<Array<{ id: string }>>`
    INSERT INTO workspaces (slug, display_name)
    VALUES (${`test-wh-${randomUUID().slice(0, 8)}`}, 'Webhook Test') RETURNING id
  `;
  const contacts = await db!<Array<{ id: string }>>`
    INSERT INTO contacts (phone, status, channel_origin)
    VALUES (${`+54911${Math.floor(10_000_000 + Math.random() * 89_999_999)}`}, 'prospecto', 'whatsapp')
    RETURNING id
  `;
  const offerings = await db!<Array<{ id: string }>>`
    INSERT INTO offerings (
      workspace_id, code, display_name, offering_type, status, description,
      price_type, price_amount, currency, billing_interval
    ) VALUES (
      ${workspaces[0].id}::uuid, ${`OFF-${randomUUID().slice(0, 8)}`}, 'Curso', 'course',
      'active', 'desc', 'fixed', '150000.00', 'ARS', 'one_time'
    ) RETURNING id
  `;
  await db!`
    INSERT INTO offering_payment_configs (offering_id, provider, stripe_price_id, checkout_mode, environment)
    VALUES (${offerings[0].id}::uuid, 'stripe', 'price_test', 'payment', 'test')
  `;
  const reserved = await reservePayment(db!, {
    workspace_id: workspaces[0].id,
    contact_id: contacts[0].id,
    offering_id: offerings[0].id,
    idempotency_key: `reserve:${randomUUID()}`,
  });
  return {
    workspaceId: workspaces[0].id,
    offeringId: offerings[0].id,
    paymentId: reserved.payment_id,
  };
}

async function pendingPaymentFixture() {
  const fixture = await paymentFixture();
  const checkout = await createCheckout(
    db!,
    { payment_id: fixture.paymentId },
    { provider: new FakePaymentProvider() }
  );
  return { ...fixture, sessionId: checkout.provider_session_id! };
}

function sessionEvent(input: {
  eventId?: string;
  type: string;
  sessionId: string;
  paymentId: string;
  workspaceId: string;
  offeringId: string;
  paymentStatus?: 'paid' | 'unpaid';
  amountTotalCents?: number;
  currency?: string;
}) {
  return JSON.stringify({
    id: input.eventId ?? `evt_${randomUUID().replaceAll('-', '')}`,
    object: 'event',
    type: input.type,
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        object: 'checkout.session',
        id: input.sessionId,
        payment_status: input.paymentStatus ?? 'paid',
        amount_total: input.amountTotalCents ?? 15_000_000,
        currency: (input.currency ?? 'ars').toLowerCase(),
        metadata: {
          payment_id: input.paymentId,
          workspace_id: input.workspaceId,
          offering_id: input.offeringId,
        },
      },
    },
  });
}

function signed(payload: string) {
  return stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
}

async function deliver(payload: string, signature: string | null) {
  return processStripeWebhook(payload, signature, {
    db: db!,
    stripe,
    webhookSecret: WEBHOOK_SECRET,
  });
}

async function paymentStatus(paymentId: string) {
  const rows = await db!<Array<{ status: string }>>`
    SELECT status FROM payments WHERE id = ${paymentId}::uuid
  `;
  return rows[0].status;
}

async function fulfillmentCount(paymentId: string) {
  const rows = await db!<Array<{ n: string }>>`
    SELECT count(*)::text AS n FROM fulfillment_jobs WHERE payment_id = ${paymentId}::uuid
  `;
  return Number(rows[0].n);
}

run('stripe payment webhook', () => {
  it('rejects a missing or invalid signature without touching the ledger', async () => {
    const fixture = await pendingPaymentFixture();
    const payload = sessionEvent({ type: 'checkout.session.completed', ...fixture });

    const missing = await deliver(payload, null);
    expect(missing.status).toBe(400);

    const invalid = await deliver(payload, 't=1,v1=deadbeef');
    expect(invalid.status).toBe(400);

    expect(await paymentStatus(fixture.paymentId)).toBe('pending');
    expect(await fulfillmentCount(fixture.paymentId)).toBe(0);
  });

  it('a completed paid session marks paid and enqueues exactly one fulfillment job', async () => {
    const fixture = await pendingPaymentFixture();
    const payload = sessionEvent({ type: 'checkout.session.completed', ...fixture });

    const result = await deliver(payload, signed(payload));
    expect(result.status).toBe(200);
    expect(await paymentStatus(fixture.paymentId)).toBe('paid');
    expect(await fulfillmentCount(fixture.paymentId)).toBe(1);
  });

  it('replaying the same webhook 10 times never duplicates payment or fulfillment', async () => {
    const fixture = await pendingPaymentFixture();
    const payload = sessionEvent({ type: 'checkout.session.completed', ...fixture });
    const signature = signed(payload);

    for (let i = 0; i < 10; i++) {
      const result = await deliver(payload, signature);
      expect(result.status).toBe(200);
    }
    expect(await paymentStatus(fixture.paymentId)).toBe('paid');
    expect(await fulfillmentCount(fixture.paymentId)).toBe(1);
  });

  it('a completed session with payment_status unpaid stays pending until the async payment succeeds', async () => {
    const fixture = await pendingPaymentFixture();
    const completedUnpaid = sessionEvent({
      type: 'checkout.session.completed', paymentStatus: 'unpaid', ...fixture,
    });
    await deliver(completedUnpaid, signed(completedUnpaid));
    expect(await paymentStatus(fixture.paymentId)).toBe('pending');
    expect(await fulfillmentCount(fixture.paymentId)).toBe(0);

    const succeeded = sessionEvent({
      type: 'checkout.session.async_payment_succeeded', ...fixture,
    });
    await deliver(succeeded, signed(succeeded));
    expect(await paymentStatus(fixture.paymentId)).toBe('paid');
    expect(await fulfillmentCount(fixture.paymentId)).toBe(1);
  });

  it('an async payment failure closes the payment as failed', async () => {
    const fixture = await pendingPaymentFixture();
    const failed = sessionEvent({
      type: 'checkout.session.async_payment_failed', paymentStatus: 'unpaid', ...fixture,
    });
    await deliver(failed, signed(failed));
    expect(await paymentStatus(fixture.paymentId)).toBe('failed');
    expect(await fulfillmentCount(fixture.paymentId)).toBe(0);
  });

  it('an expired session closes the payment; out-of-order expiry never regresses paid', async () => {
    const fixture = await pendingPaymentFixture();
    const paid = sessionEvent({ type: 'checkout.session.completed', ...fixture });
    await deliver(paid, signed(paid));

    const expired = sessionEvent({ type: 'checkout.session.expired', paymentStatus: 'unpaid', ...fixture });
    const result = await deliver(expired, signed(expired));
    expect(result.status).toBe(200);
    expect(await paymentStatus(fixture.paymentId)).toBe('paid');

    const fresh = await pendingPaymentFixture();
    const freshExpired = sessionEvent({ type: 'checkout.session.expired', paymentStatus: 'unpaid', ...fresh });
    await deliver(freshExpired, signed(freshExpired));
    expect(await paymentStatus(fresh.paymentId)).toBe('expired');
  });

  it('a manipulated amount or currency never marks paid', async () => {
    const wrongAmount = await pendingPaymentFixture();
    const tampered = sessionEvent({
      type: 'checkout.session.completed', amountTotalCents: 100, ...wrongAmount,
    });
    await deliver(tampered, signed(tampered));
    expect(await paymentStatus(wrongAmount.paymentId)).toBe('pending');
    expect(await fulfillmentCount(wrongAmount.paymentId)).toBe(0);

    const wrongCurrency = await pendingPaymentFixture();
    const tamperedCurrency = sessionEvent({
      type: 'checkout.session.completed', currency: 'usd', ...wrongCurrency,
    });
    await deliver(tamperedCurrency, signed(tamperedCurrency));
    expect(await paymentStatus(wrongCurrency.paymentId)).toBe('pending');
  });

  it('a session id that does not match the payment is ignored fail-closed', async () => {
    const fixture = await pendingPaymentFixture();
    const foreign = sessionEvent({
      type: 'checkout.session.completed',
      ...fixture,
      sessionId: `cs_foreign_${randomUUID().slice(0, 8)}`,
    });
    const result = await deliver(foreign, signed(foreign));
    expect(result.status).toBe(200);
    expect(await paymentStatus(fixture.paymentId)).toBe('pending');
    expect(await fulfillmentCount(fixture.paymentId)).toBe(0);
  });

  it('resolves a creation_ambiguous payment when the session webhook arrives', async () => {
    const fixture = await paymentFixture();
    // The checkout call died with an unknown outcome: no session persisted.
    const provider = new FakePaymentProvider();
    provider.failNextWith(Object.assign(new Error('timeout'), { name: 'AmbiguousCheckoutError', code: 'PROVIDER_TIMEOUT' }));
    await db!`
      UPDATE payments SET status = 'creating_checkout' WHERE id = ${fixture.paymentId}::uuid
    `;
    await db!`
      UPDATE payments SET status = 'creation_ambiguous' WHERE id = ${fixture.paymentId}::uuid
    `;

    const payload = sessionEvent({
      type: 'checkout.session.completed',
      sessionId: `cs_recovered_${randomUUID().slice(0, 8)}`,
      paymentId: fixture.paymentId,
      workspaceId: fixture.workspaceId,
      offeringId: fixture.offeringId,
    });
    const result = await deliver(payload, signed(payload));
    expect(result.status).toBe(200);
    expect(await paymentStatus(fixture.paymentId)).toBe('paid');
    expect(await fulfillmentCount(fixture.paymentId)).toBe(1);
  });

  it('an unrelated event type is acknowledged without touching the ledger', async () => {
    const fixture = await pendingPaymentFixture();
    const payload = JSON.stringify({
      id: `evt_${randomUUID().replaceAll('-', '')}`,
      object: 'event',
      type: 'invoice.created',
      data: { object: { object: 'invoice', id: 'in_123' } },
    });
    const result = await deliver(payload, signed(payload));
    expect(result.status).toBe(200);
    expect(await paymentStatus(fixture.paymentId)).toBe('pending');
  });
});
