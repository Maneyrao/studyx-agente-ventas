import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  CommercialFollowupNarrativeSchema,
  deliverCommercialFollowupV1,
} from '@/features/promotions/application/commercial-followup-service';

const Body = z.object({
  claim_token: z.string().uuid(),
  botpress_conversation_id: z.string().min(1).max(512),
  narrative: CommercialFollowupNarrativeSchema,
}).strict();

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const body = Body.safeParse(await request.json().catch(() => null));
  if (!z.string().uuid().safeParse(id).success || !body.success) {
    return NextResponse.json({ error: 'VALIDATION_ERROR' }, { status: 400 });
  }
  return NextResponse.json(await deliverCommercialFollowupV1(id, body.data));
}
