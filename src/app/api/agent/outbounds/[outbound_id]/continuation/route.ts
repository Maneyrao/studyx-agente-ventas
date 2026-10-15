import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeDeliveryContinuation } from '@/lib/services/delivery-continuation.service';

const schema = z.object({ trace_id: z.string().uuid(), delivery_attempt: z.number().int().min(1).max(100) });
export async function POST(request: NextRequest, context: { params: Promise<{ outbound_id: string }> }) {
  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  const { outbound_id } = await context.params;
  if (!parsed.success || !z.string().uuid().safeParse(outbound_id).success) {
    return NextResponse.json({ error: 'VALIDATION_ERROR' }, { status: 400 });
  }
  return NextResponse.json(await authorizeDeliveryContinuation({ outbound_id, ...parsed.data }));
}
