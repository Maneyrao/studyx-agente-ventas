import { after, NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { releaseNotification, dispatchNotifications } from '@/features/fulfillment/post-sale/service';
export const maxDuration = 60;
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const body = z.object({ claim_token: z.string().uuid() }).safeParse(await request.json().catch(() => null));
  if (!z.string().uuid().safeParse(id).success || !body.success) return NextResponse.json({ error: 'VALIDATION_ERROR' }, { status: 400 });
  const result = await releaseNotification(id, body.data.claim_token);
  after(async () => {
    await new Promise(resolve => setTimeout(resolve, 31000));
    await dispatchNotifications();
  });
  return NextResponse.json(result);
}
