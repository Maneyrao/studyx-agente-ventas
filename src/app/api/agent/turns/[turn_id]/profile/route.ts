import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withSerializableTransaction, isRetryableTransactionError } from '@/lib/db/transaction';
import { applyContactProfileUpdatesV1, ContactProfileClaimNotAuthorizedError } from '@/lib/repositories/contact-profile.repository';
import { ContactProfileUpdateV1Schema, CONTACT_PROFILE_MAX_UPDATES_V1 } from '@/shared/conversation/contact-profile-contract';

const InputSchema = z.object({
  trace_id: z.string().uuid(), turn_id: z.string().uuid(),
  batch_id: z.string().uuid(), claim_token: z.string().uuid(),
  expected_version: z.number().int().min(0),
  confirmed_phone: z.string().min(8).max(40).nullable().optional(),
  updates: z.array(ContactProfileUpdateV1Schema).max(CONTACT_PROFILE_MAX_UPDATES_V1),
}).strict();

/** Signed /api/agent authentication is enforced by proxy.ts. No conversational wording or business effects. */
export async function POST(request: NextRequest, context: { params: Promise<{ turn_id: string }> }) {
  const { turn_id } = await context.params;
  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 });
  }
  const parsed = InputSchema.safeParse(body);
  if (!parsed.success || parsed.data.turn_id !== turn_id) {
    return NextResponse.json({ error: 'INVALID_CONTACT_PROFILE_REQUEST' }, { status: 400 });
  }
  try {
    const receipt = await withSerializableTransaction(db => applyContactProfileUpdatesV1(db, parsed.data));
    return NextResponse.json(receipt);
  } catch (error) {
    if (error instanceof ContactProfileClaimNotAuthorizedError) {
      return NextResponse.json({ error: error.code }, { status: 409 });
    }
    return NextResponse.json({ error: isRetryableTransactionError(error)
      ? 'CONTACT_PROFILE_RETRYABLE' : 'CONTACT_PROFILE_UNAVAILABLE' }, { status: 503 });
  }
}
