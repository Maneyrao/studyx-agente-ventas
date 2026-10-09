import { after, NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { deliverNotification, NarrativeSchema, runPostSalePipeline } from '@/features/fulfillment/post-sale/service';
const Body = z.object({ claim_token: z.string().uuid(), botpress_conversation_id: z.string().min(1), narrative: NarrativeSchema });
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const body = Body.safeParse(await request.json().catch(() => null));
  if (!z.string().uuid().safeParse(id).success || !body.success) return NextResponse.json({ error: 'VALIDATION_ERROR' }, { status: 400 });
  try {
    const result = await deliverNotification(id, body.data);
    if (result.outcome === 'sent') after(() => runPostSalePipeline().then(() => undefined));
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: 'POST_SALE_CONTENT_INVALID' }, { status: 422 });
  }
}
