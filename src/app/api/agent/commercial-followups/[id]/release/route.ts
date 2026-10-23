import { after, NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  releaseCommercialFollowupV1,
  scheduleCommercialFollowupRetryV1,
} from '@/features/promotions/application/commercial-followup-service';

const Body = z.object({ claim_token: z.string().uuid() }).strict();

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const body = Body.safeParse(await request.json().catch(() => null));
  if (!z.string().uuid().safeParse(id).success || !body.success) {
    return NextResponse.json({ error: 'VALIDATION_ERROR' }, { status: 400 });
  }
  const result = await releaseCommercialFollowupV1(id, body.data.claim_token);
  if (result.outcome === 'released') {
    after(() => scheduleCommercialFollowupRetryV1(id).then(() => undefined));
  }
  return NextResponse.json(result);
}
