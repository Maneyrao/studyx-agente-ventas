import Stripe from 'stripe';
import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db/orchestrator';
import { loadStripeWebhookConfig } from '@/lib/config';
import { processStripeWebhook } from '@/features/payments/application/process-stripe-webhook';

/**
 * POST /api/webhooks/payments/stripe
 *
 * Public only by exact-path match in the proxy; authentication is the
 * Stripe-Signature header verified against the RAW request body. The handler
 * persists (dedup by event id) and answers immediately — fulfillment, Sheets
 * and any enrollment run from their own queues, never from here.
 */
export async function POST(request: NextRequest) {
  let config: ReturnType<typeof loadStripeWebhookConfig>;
  try {
    config = loadStripeWebhookConfig();
  } catch (error) {
    return NextResponse.json({ error: 'PAYMENT_WEBHOOK_UNCONFIGURED', detail: String(error).slice(0, 80) }, { status: 503 });
  }

  const rawBody = await request.text();
  const result = await processStripeWebhook(
    rawBody,
    request.headers.get('stripe-signature'),
    {
      db: sql,
      stripe: new Stripe(config.secretKey),
      webhookSecret: config.webhookSecret,
    }
  );
  return NextResponse.json(result.body, { status: result.status });
}
