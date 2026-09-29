import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { sql } from '@/lib/db/orchestrator';
import { loadBusinessWorkspaceConfig } from '@/lib/config';
import { reserveStripeVerificationLink } from '@/features/payments/application/reserve-payment-link';

const BodySchema = z.object({
  phone_e164: z.string().min(8).max(32),
  offering_code: z.string().min(1).max(128),
  test_run_id: z.string().min(1).max(128).optional(),
});

export async function POST(request: NextRequest) {
  const secret = process.env.STRIPE_VERIFICATION_SECRET?.trim();
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }
  const paymentLink = process.env.PAYMENT_LINK_STRIPE_VERIFICATION?.trim();
  if (!paymentLink) {
    return NextResponse.json({ error: 'STRIPE_VERIFICATION_DISABLED' }, { status: 503 });
  }
  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'VALIDATION_ERROR' }, { status: 400 });
  }
  const workspaceSlug = loadBusinessWorkspaceConfig().workspaceSlug;
  const targets = await sql<Array<{
    workspace_id: string;
    contact_id: string;
    offering_id: string;
  }>>`
    SELECT workspace.id AS workspace_id, contact.id AS contact_id, offering.id AS offering_id
    FROM workspaces AS workspace
    JOIN workspace_contacts AS workspace_contact ON workspace_contact.workspace_id = workspace.id
    JOIN contacts AS contact ON contact.id = workspace_contact.contact_id
    JOIN offerings AS offering
      ON offering.workspace_id = workspace.id
     AND offering.code = ${parsed.data.offering_code}
     AND offering.status = 'active'
    WHERE workspace.slug = ${workspaceSlug}
      AND workspace.status = 'active'
      AND (contact.phone = ${parsed.data.phone_e164} OR contact.declared_phone = ${parsed.data.phone_e164})
      AND contact.deleted_at IS NULL
    LIMIT 1
  `;
  const target = targets[0];
  if (!target) return NextResponse.json({ error: 'TEST_TARGET_NOT_FOUND' }, { status: 404 });

  const runId = parsed.data.test_run_id ?? randomUUID();
  const reserved = await reserveStripeVerificationLink(sql, {
    workspace_id: target.workspace_id,
    contact_id: target.contact_id,
    offering_id: target.offering_id,
    idempotency_key: `stripe-verification:${runId}`,
    payment_link_url: paymentLink,
  });
  return NextResponse.json({
    payment_id: reserved.payment_id,
    status: reserved.status,
    checkout_url: reserved.url,
    amount: 'USD 0.50',
    temporary: true,
  });
}
