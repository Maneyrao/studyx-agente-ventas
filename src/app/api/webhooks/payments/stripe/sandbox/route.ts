import { runPostSalePipeline } from '@/features/fulfillment/post-sale/service';
import Stripe from 'stripe';
import { after, NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { sql } from '@/lib/db/orchestrator';
import { loadStripeWebhookConfig } from '@/lib/config';
import { processStripeWebhook } from '@/features/payments/application/process-stripe-webhook';
import { upsertVerifiedPaymentProjection } from '@/lib/services/projection.service';
import { flushSheetProjectionsAfterMutation } from '@/lib/services/sheet-projection-trigger';

export const maxDuration = 300;

/** Separate signing secret; only sandbox events may update sandbox payments. */
export async function POST(request: NextRequest) {
  let config: ReturnType<typeof loadStripeWebhookConfig>;
  try {
    config = loadStripeWebhookConfig({
      NODE_ENV: process.env.NODE_ENV,
      STRIPE_WEBHOOK_SECRET: process.env.STRIPE_SANDBOX_WEBHOOK_SECRET,
    });
  } catch {
    return NextResponse.json({ error: 'PAYMENT_WEBHOOK_UNCONFIGURED' }, { status: 503 });
  }
  const result = await processStripeWebhook(await request.text(), request.headers.get('stripe-signature'), {
    db: sql,
    stripe: new Stripe('sk_test_webhook_signature_verification_only'),
    webhookSecret: config.webhookSecret,
    expectedEnvironment: 'test',
  });
  if (result.verifiedPaymentId) {
    const paymentId = result.verifiedPaymentId;
    const traceId = randomUUID();
    after(async () => {
      await Promise.allSettled([
        runPostSalePipeline(paymentId),
        upsertVerifiedPaymentProjection({ paymentId, traceId }).then(() => flushSheetProjectionsAfterMutation({ traceId, source: 'payment' })),
      ]);

    });
  }
  return NextResponse.json(result.body, { status: result.status });
}
